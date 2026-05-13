/**
 * Streaming HTTP client for Google Gemini's `:streamGenerateContent` endpoint.
 *
 * No SDK on the worker side — Cloudflare Workers run a slim subset of Node and
 * we want zero install-time overhead. `fetch` returns an SSE body we parse
 * line-by-line. Each `data: { ... }` chunk is yielded as a parsed object.
 */

import type { Env } from '../env.js';
import type { GeminiRequestBody } from './translate.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      role?: 'model' | 'user';
      parts?: Array<{
        text?: string;
        functionCall?: { name: string; args: Record<string, unknown> };
      }>;
    };
    finishReason?: string;
    index?: number;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export async function openGeminiStream(
  env: Env,
  model: string,
  body: GeminiRequestBody,
): Promise<AsyncGenerator<GeminiStreamChunk, void, void>> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY missing on worker — set via `wrangler secret put`');
  }

  const url = `${BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Gemini ${resp.status} ${resp.statusText}: ${errText.slice(0, 500)}`);
  }

  return iterateSse(resp.body);
}

/**
 * Read an SSE-shaped ReadableStream and yield each parsed JSON `data:` event.
 *
 * Gemini's SSE protocol is "vanilla" — one `data: <json>` per event, separated
 * by blank lines. We accumulate bytes into a decoded string, split on `\n\n`,
 * and parse each chunk's `data:` line.
 */
async function* iterateSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<GeminiStreamChunk, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line (\n\n). Anything before the
      // last `\n\n` is a complete event we can process; the tail (possibly a
      // partial event) stays in `buffer` for the next read.
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const eventText = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const parsed = parseSseEvent(eventText);
        if (parsed) yield parsed;
      }
    }
    // Flush any trailing partial event.
    if (buffer.trim().length > 0) {
      const parsed = parseSseEvent(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseEvent(eventText: string): GeminiStreamChunk | null {
  // One event may span multiple `data:` lines — Gemini doesn't do this in
  // practice but the SSE spec allows it, so we concatenate just in case.
  const lines = eventText.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join('');
  if (payload === '[DONE]') return null;
  try {
    return JSON.parse(payload) as GeminiStreamChunk;
  } catch {
    return null;
  }
}
