/**
 * `/v1/tools/*` — cloud-side tool execution endpoints called by the
 * ElevenLabs Conv-AI server_tools mechanism.
 *
 * Auth uses the same Bearer pattern as `/v1/chat/completions` so we only
 * have one shared secret per agent. Each tool gets its own route under
 * `/v1/tools/<name>`.
 *
 * Phase 1.1 ships `web_search`. Future cloud tools (`fetch_data`,
 * `generate_image`, `render_*`, `vision_qa`, `search_memory`) land in
 * later phases under the same router.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env.js';
import { allowedTokens } from '../env.js';
import { BraveSearchError, webSearch } from '../tools/web_search.js';

export const tools = new Hono<{ Bindings: Env }>();

// Bearer auth gate — same as chat-completions/voices.
tools.use('*', async (c, next) => {
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
        },
      },
      401,
    );
  }
  await next();
});

const WebSearchBody = z.object({
  query: z.string().min(1, 'query is required'),
  count: z.number().int().min(1).max(10).optional(),
});

tools.post('/web_search', async (c) => {
  if (!c.env.BRAVE_SEARCH_API_KEY) {
    return c.json(
      {
        error: {
          message:
            'BRAVE_SEARCH_API_KEY not configured on the worker — wrangler secret put',
          type: 'configuration_error',
        },
      },
      500,
    );
  }
  let parsed;
  try {
    const body = (await c.req.json()) as unknown;
    parsed = WebSearchBody.parse(body);
  } catch (err) {
    const message = err instanceof z.ZodError ? err.message : (err as Error).message;
    return c.json(
      {
        error: { message, type: 'invalid_request_error' },
      },
      400,
    );
  }
  try {
    const result = await webSearch(c.env.BRAVE_SEARCH_API_KEY, parsed);
    return c.json(result, 200);
  } catch (err) {
    if (err instanceof BraveSearchError) {
      // 4xx from Brave we surface as 4xx; 5xx as 502 (upstream failure).
      const status: 400 | 401 | 403 | 429 | 502 =
        err.status === 401 || err.status === 403
          ? 401
          : err.status === 429
            ? 429
            : err.status >= 400 && err.status < 500
              ? 400
              : 502;
      return c.json(
        {
          error: {
            message: err.message,
            type: 'upstream_error',
            code: `brave_${err.status}`,
          },
        },
        status,
      );
    }
    console.error('web_search unexpected error:', err);
    return c.json(
      {
        error: {
          message: (err as Error).message ?? 'web_search failed',
          type: 'internal_error',
        },
      },
      500,
    );
  }
});
