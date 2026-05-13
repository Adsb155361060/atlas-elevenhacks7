/**
 * Send one test case through the deployed Worker and capture what came back.
 *
 * Hits the live `/v1/chat/completions` endpoint with the full tool registry
 * so we exercise the same translation + SSE path that ElevenLabs Conv-AI uses
 * in production. The eval is realistic — same prompts, same auth, same
 * Anthropic round-trip.
 *
 * Streaming response shapes we have to handle:
 *   - `data: {…}\n\n` — one OpenAI-format chunk per Claude event
 *   - `data: [DONE]\n\n` — end marker
 *   - on upstream error our SSE bridge yields a content delta containing
 *     `[upstream error: …]` plus `finish_reason: 'stop'`. The harness surfaces
 *     it as `result.error` instead of treating it as a missing tool_call.
 */

import { TOOL_REGISTRY, type ToolSpec } from '@atlas/contracts/tools';
import type { RouterResult, TestCase, ToolCallSeen } from './types.js';

const SYSTEM_PROMPT_FALLBACK =
  "You are a voice-first assistant. Use a tool if the user's request fits one; otherwise reply directly in 1–2 short sentences.";

export interface RouterClient {
  workerUrl: string;
  token: string;
  model?: string;
  /** Override the registry — useful for unit-style tests that pass a stub. */
  tools?: readonly ToolSpec[];
  /** System prompt to send. If omitted, a short voice-first fallback is used. */
  system?: string;
  /** Override the default per-call timeout. */
  timeoutMs?: number;
}

export async function routeOne(
  client: RouterClient,
  test: TestCase,
): Promise<RouterResult> {
  const tools = (client.tools ?? TOOL_REGISTRY).map(toolToOpenAI);
  const body = {
    model: client.model ?? 'claude-haiku-4-5-20251001',
    stream: true,
    max_tokens: 512,
    temperature: 0.0, // routing is a closed-form decision; minimise variance
    messages: [
      { role: 'system', content: client.system ?? SYSTEM_PROMPT_FALLBACK },
      { role: 'user', content: test.input },
    ],
    tools,
    tool_choice: 'auto',
  };

  const started = performance.now();
  const ctrl = new AbortController();
  const timeoutMs = client.timeoutMs ?? 45_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let firstChunkAt: number | null = null;
  let assistantText = '';
  const toolCallsByIndex = new Map<number, ToolCallSeen & { argsText: string }>();
  let finishReason: RouterResult['finish_reason'] = null;
  let upstreamError: string | undefined;

  try {
    const resp = await fetch(`${client.workerUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${client.token}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return errored(
        started,
        `HTTP ${resp.status}: ${txt.slice(0, 200)}`,
      );
    }
    if (!resp.body) return errored(started, 'no response body');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (firstChunkAt === null) firstChunkAt = performance.now();
      buf += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines.
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const dataLine = raw
          .split('\n')
          .find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const payload = dataLine.slice(6).trim();
        if (payload === '[DONE]') {
          // graceful end
          continue;
        }
        let evt: OpenAIChunk;
        try {
          evt = JSON.parse(payload) as OpenAIChunk;
        } catch {
          continue;
        }
        const choice = evt.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          assistantText += delta.content;
          if (delta.content.startsWith('[upstream error')) {
            upstreamError = delta.content;
          }
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (typeof idx !== 'number') continue;
            const existing = toolCallsByIndex.get(idx);
            if (!existing) {
              toolCallsByIndex.set(idx, {
                name: tc.function?.name ?? '',
                arguments: {},
                argsText: tc.function?.arguments ?? '',
              });
            } else {
              if (tc.function?.name) existing.name = tc.function.name;
              if (typeof tc.function?.arguments === 'string') {
                existing.argsText += tc.function.arguments;
              }
            }
          }
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason as RouterResult['finish_reason'];
        }
      }
    }
  } catch (err) {
    return errored(started, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }

  // Finalize tool_calls — parse accumulated JSON arg text.
  const tool_calls: ToolCallSeen[] = [];
  const ordered = [...toolCallsByIndex.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, partial] of ordered) {
    let parsedArgs: Record<string, unknown> = {};
    if (partial.argsText.length > 0) {
      try {
        parsedArgs = JSON.parse(partial.argsText) as Record<string, unknown>;
      } catch {
        parsedArgs = { __raw: partial.argsText };
      }
    }
    tool_calls.push({ name: partial.name, arguments: parsedArgs });
  }

  const totalMs = performance.now() - started;
  return {
    text: assistantText.trim(),
    tool_calls,
    finish_reason: finishReason,
    ttfb_ms: firstChunkAt !== null ? firstChunkAt - started : totalMs,
    total_ms: totalMs,
    error: upstreamError,
  };
}

// ───────────────────────── helpers ─────────────────────────

function errored(startedAt: number, message: string): RouterResult {
  const elapsed = performance.now() - startedAt;
  return {
    text: '',
    tool_calls: [],
    finish_reason: null,
    ttfb_ms: elapsed,
    total_ms: elapsed,
    error: message,
  };
}

function toolToOpenAI(spec: ToolSpec): {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
} {
  return {
    type: 'function',
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.params,
    },
  };
}

// ───────────────────────── inline SSE types ─────────────────────────

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
    index?: number;
  }>;
}
