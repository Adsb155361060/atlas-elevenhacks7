/**
 * Thin Anthropic client wrapper. The Anthropic SDK does the heavy lifting
 * (HTTP, retries, SSE parsing); we add: factory caching per-Worker-isolate,
 * a `streamMessages` helper that yields raw events.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env.js';

let cached: { key: string; client: Anthropic } | null = null;

export function getAnthropicClient(env: Env): Anthropic {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not configured — the legacy vision_qa route needs it. ' +
        'Either `wrangler secret put ANTHROPIC_API_KEY` or port vision_qa to Gemini.',
    );
  }
  if (cached && cached.key === apiKey) return cached.client;
  const client = new Anthropic({ apiKey });
  cached = { key: apiKey, client };
  return client;
}

/**
 * Begin a streaming Messages request and return the raw event iterable.
 * Caller is responsible for translating events into the wire shape it needs.
 *
 * SDK v0.95+ returns `APIPromise<Stream<…>>` from `messages.create` — i.e.
 * we have to `await` to get the iterable. The HTTP request is still in flight
 * by the time we await; the await just resolves the API-call envelope.
 */
export async function streamMessages(
  env: Env,
  params: Anthropic.Messages.MessageCreateParamsStreaming,
  init?: { signal?: AbortSignal },
): Promise<AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>> {
  const client = getAnthropicClient(env);
  const opts: Anthropic.RequestOptions = {};
  if (init?.signal) opts.signal = init.signal;
  return client.messages.create(params, opts);
}
