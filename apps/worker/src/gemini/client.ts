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

/**
 * Open a streaming generation against the configured primary model. On a
 * "capacity-class" failure (429 rate-limited, 5xx upstream, 404 model not
 * found / unavailable) and when `FALLBACK_LLM_MODEL` is non-empty + different
 * from the primary, retry against the fallback once. All other failures
 * (4xx auth, malformed request, network errors) propagate immediately so we
 * don't mask real bugs.
 */
export async function openGeminiStream(
  env: Env,
  model: string,
  body: GeminiRequestBody,
): Promise<AsyncGenerator<GeminiStreamChunk, void, void>> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY missing on worker — set via `wrangler secret put`');
  }

  try {
    return await callGemini(apiKey, model, body);
  } catch (err) {
    const fallback = env.FALLBACK_LLM_MODEL?.trim();
    if (
      fallback &&
      fallback !== model &&
      err instanceof GeminiUpstreamError &&
      err.isCapacityClass()
    ) {
      console.warn(
        `gemini ${model} failed (${err.status}); falling back to ${fallback}`,
      );
      return await callGemini(apiKey, fallback, body);
    }
    throw err;
  }
}

async function callGemini(
  apiKey: string,
  model: string,
  body: GeminiRequestBody,
): Promise<AsyncGenerator<GeminiStreamChunk, void, void>> {
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
    throw new GeminiUpstreamError(
      resp.status,
      `Gemini ${resp.status} ${resp.statusText}: ${errText.slice(0, 500)}`,
    );
  }

  return iterateSse(resp.body);
}

export class GeminiUpstreamError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GeminiUpstreamError';
    this.status = status;
  }
  /**
   * Classes of failures that warrant a fallback retry rather than surfacing
   * the error. 503 (overloaded), 429 (rate-limited), 5xx in general, and 404
   * (model not found / not yet rolled out to the project) are all transient
   * or model-specific.
   */
  isCapacityClass(): boolean {
    return (
      this.status === 404 ||
      this.status === 429 ||
      (this.status >= 500 && this.status < 600)
    );
  }
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

  // Gemini 2.5 Pro emits CRLF (`\r\n`) line endings; Flash emits LF (`\n`).
  // Normalise both before searching so the event splitter works either way.
  const normalize = (s: string): string => s.replace(/\r\n/g, '\n');

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += normalize(decoder.decode(value, { stream: true }));

      // Events are separated by `\n\n`. Anything before the last separator is
      // a complete event; the tail (possibly partial) stays in the buffer.
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const eventText = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const parsed = parseSseEvent(eventText);
        if (parsed) yield parsed;
      }
    }
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
