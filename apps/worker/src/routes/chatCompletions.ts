/**
 * POST /v1/chat/completions — the OpenAI-compatible endpoint that ElevenLabs
 * Conversational Agent's custom-LLM feature calls on every turn.
 *
 * Pipeline:
 *   1. Auth: verify Bearer token against ALLOWED_AGENT_TOKENS.
 *   2. Validate body via zod (OpenAIChatRequest).
 *   3. Resolve the requested model to an Anthropic id (router).
 *   4. Translate OpenAI request → Anthropic params (with cache_control markers).
 *   5. Open the Anthropic stream and pipe events back as OpenAI SSE.
 *
 * Streaming is mandatory. The voice loop is realtime-only; non-streaming
 * requests are rejected with a clear 400 so the agent fails loudly rather than
 * silently buffering a full response.
 */

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { allowedTokens } from '../env.js';
import { OpenAIChatRequest } from '../types/openai.js';
import { openaiRequestToAnthropic } from '../claude/translate.js';
import { streamMessages } from '../claude/client.js';
import {
  anthropicStreamToOpenAISSE,
  generateChatCompletionId,
  sseReadableStream,
} from '../claude/sse.js';
import { resolveAnthropicModel } from '../claude/router.js';

export const chatCompletions = new Hono<{ Bindings: Env }>();

chatCompletions.post('/', async (c) => {
  // ─── 1. Auth ───
  const auth = c.req.header('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : '';
  if (!token || !allowedTokens(c.env).has(token)) {
    return c.json(
      {
        error: {
          message: 'invalid or missing bearer token',
          type: 'authentication_error',
          code: 'invalid_api_key',
        },
      },
      401,
    );
  }

  // ─── 2. Validate body ───
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          message: 'request body must be valid JSON',
          type: 'invalid_request_error',
          code: 'bad_json',
        },
      },
      400,
    );
  }

  const parsed = OpenAIChatRequest.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          message: 'invalid chat completion request shape',
          type: 'invalid_request_error',
          code: 'schema_validation_failed',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }
  const req = parsed.data;

  if (req.stream === false) {
    return c.json(
      {
        error: {
          message:
            'atlas-worker requires stream:true. The realtime voice loop is streaming-only.',
          type: 'invalid_request_error',
          code: 'streaming_required',
        },
      },
      400,
    );
  }

  // ─── 3. Route model ───
  const anthropicModel = resolveAnthropicModel(req.model, c.env);

  // ─── 4. Translate request ───
  const params = openaiRequestToAnthropic(req, {
    model: anthropicModel,
    enablePromptCaching: true,
  });

  // ─── 5. Open Anthropic stream and bridge to OpenAI SSE ───
  const id = generateChatCompletionId();
  const created = Math.floor(Date.now() / 1000);

  let upstream: AsyncIterable<Awaited<ReturnType<typeof streamMessages>> extends AsyncIterable<infer E> ? E : never>;
  try {
    upstream = streamMessages(c.env, params);
  } catch (err) {
    return c.json(
      {
        error: {
          message: errorMessage(err),
          type: 'upstream_error',
          code: 'anthropic_request_failed',
        },
      },
      502,
    );
  }

  const sseStream = sseReadableStream(upstream, {
    id,
    model: req.model,
    created,
  });

  return new Response(sseStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Atlas-Worker': c.env.WORKER_VERSION,
      'X-Atlas-Model': anthropicModel,
    },
  });
});

// Expose the generator directly for tests / non-Worker contexts.
export { anthropicStreamToOpenAISSE };

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'unknown error';
}
