/**
 * Thin Anthropic client wrapper. The Anthropic SDK does the heavy lifting
 * (HTTP, retries, SSE parsing); we add: factory caching per-Worker-isolate,
 * a `streamMessages` helper that yields raw events.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env.js';

let cached: { key: string; client: Anthropic } | null = null;

export function getAnthropicClient(env: Env): Anthropic {
  if (cached && cached.key === env.ANTHROPIC_API_KEY) return cached.client;
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    // Cloudflare Workers don't expose Node fetch; the SDK uses globalThis.fetch.
    // Workers ≥ 2024-09-23 + nodejs_compat flag handles it correctly.
  });
  cached = { key: env.ANTHROPIC_API_KEY, client };
  return client;
}

/**
 * Begin a streaming Messages request and return the raw event iterable.
 * Caller is responsible for translating events into the wire shape it needs.
 */
export function streamMessages(
  env: Env,
  params: Anthropic.Messages.MessageCreateParamsStreaming,
  init?: { signal?: AbortSignal },
): AsyncIterable<Anthropic.Messages.RawMessageStreamEvent> {
  const client = getAnthropicClient(env);
  const opts: Anthropic.RequestOptions = {};
  if (init?.signal) opts.signal = init.signal;
  // The SDK returns a Stream<...> which is itself AsyncIterable.
  return client.messages.create(params, opts) as unknown as AsyncIterable<
    Anthropic.Messages.RawMessageStreamEvent
  >;
}
