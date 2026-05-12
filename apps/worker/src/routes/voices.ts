/**
 * `/v1/voices/*` — voice picker support routes used by the desktop app's
 * onboarding flow (Phase 0.F).
 *
 * - `GET  /v1/voices`        → list stock voices (proxies ElevenLabs /v2/voices)
 * - `POST /v1/voices/clone`  → Instant Voice Clone (forwards multipart to
 *                              ElevenLabs /v1/voices/add)
 *
 * Auth uses the same Bearer-token mechanism as `/v1/chat/completions` so the
 * desktop only needs one shared secret in `ATLAS_WORKER_BEARER`.
 */

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { allowedTokens } from '../env.js';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

export const voices = new Hono<{ Bindings: Env }>();

voices.use('*', async (c, next) => {
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
  if (!c.env.ELEVENLABS_API_KEY) {
    return c.json(
      {
        error: {
          message:
            'ELEVENLABS_API_KEY not configured on worker — set it via `wrangler secret put`',
          type: 'configuration_error',
        },
      },
      500,
    );
  }
  await next();
});

/** Paginated stock voice listing. Returns the upstream payload as-is so the
 *  frontend doesn't have to keep up with ElevenLabs response evolution. */
voices.get('/', async (c) => {
  const url = new URL(c.req.url);
  // Forward useful query params (search, category, page_size, next_page_token).
  const upstream = new URL(`${ELEVENLABS_BASE}/v2/voices`);
  for (const [k, v] of url.searchParams) {
    upstream.searchParams.set(k, v);
  }
  const resp = await fetch(upstream.toString(), {
    headers: {
      'xi-api-key': c.env.ELEVENLABS_API_KEY!,
      accept: 'application/json',
    },
  });
  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: {
      'Content-Type': resp.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'private, max-age=60',
    },
  });
});

/**
 * Instant Voice Clone.
 *
 * Accepts multipart/form-data with at least:
 *   - `name`         (required) display name for the cloned voice
 *   - `files`        (required, one or more) audio samples; ≥30s recommended
 *   - `description?` optional human-readable description
 *   - `labels?`      optional JSON string of key/value pairs
 *
 * Forwards verbatim to ElevenLabs `/v1/voices/add`, which returns
 * `{ voice_id, requires_verification }`.
 */
voices.post('/clone', async (c) => {
  // Cloudflare Workers' Request.formData() does the multipart parsing for us.
  // We rebuild the upstream FormData rather than passing the body stream
  // through, because we need the (rare) ability to add headers and to log
  // size for cost accounting in a later phase.
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch (err) {
    return c.json(
      {
        error: {
          message: `invalid multipart body: ${err instanceof Error ? err.message : String(err)}`,
          type: 'invalid_request_error',
        },
      },
      400,
    );
  }

  if (!form.get('name')) {
    return c.json(
      {
        error: {
          message: 'multipart field "name" is required',
          type: 'invalid_request_error',
        },
      },
      400,
    );
  }
  const fileCount = form.getAll('files').length;
  if (fileCount === 0) {
    return c.json(
      {
        error: {
          message: 'at least one "files" entry is required',
          type: 'invalid_request_error',
        },
      },
      400,
    );
  }

  const upstreamForm = new FormData();
  form.forEach((value, key) => {
    upstreamForm.append(key, value);
  });

  const upstream = await fetch(`${ELEVENLABS_BASE}/v1/voices/add`, {
    method: 'POST',
    headers: {
      'xi-api-key': c.env.ELEVENLABS_API_KEY!,
    },
    body: upstreamForm,
  });

  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'application/json',
    },
  });
});
