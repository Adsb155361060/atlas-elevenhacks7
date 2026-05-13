/**
 * Per-IP daily rate limit, backed by Workers KV (`ATLAS_RATELIMIT`).
 *
 * Keyed `rl:YYYY-MM-DD:<ip>` so counters auto-roll at UTC midnight and
 * KV's eventual consistency doesn't matter — even with stale reads we
 * undercount, never over.
 *
 * Two design choices for the Path-A judges build:
 *
 *   1. **Per-IP, not per-token.** The baked bundle ships one shared
 *      Bearer token to every judge. Per-token counters would limit the
 *      hackathon to one judge total. cf-connecting-ip gives Cloudflare-
 *      attested IPs that are stable for a session.
 *
 *   2. **Best-effort, fail-open.** If KV is unreachable for any reason
 *      we allow the request through and log. A rate-limit failure must
 *      not break a live demo. The trade-off: an attacker who can fault-
 *      inject KV gets unlimited requests; for a hackathon-grade demo
 *      this is fine.
 */

import type { Context, Next } from 'hono';
import type { Env } from './env.js';

const TTL_SECONDS = 60 * 60 * 26; // 26h — covers any timezone slop around UTC midnight

interface KVLike {
  get: (key: string) => Promise<string | null>;
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>;
}

export async function rateLimit(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const kv = c.env.ATLAS_RATELIMIT as KVLike | undefined;
  if (!kv) {
    // No binding — typical in dev / tests / pre-deploy. Skip the gate.
    await next();
    return;
  }

  const cap = parseInt(c.env.RATE_LIMIT_PER_DAY, 10);
  if (!Number.isFinite(cap) || cap <= 0) {
    await next();
    return;
  }

  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'anonymous';

  const key = `rl:${ymd()}:${ip}`;

  let current = 0;
  try {
    const raw = await kv.get(key);
    if (raw) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n)) current = n;
    }
  } catch (err) {
    console.warn('ratelimit: KV read failed; fail-open', err);
    await next();
    return;
  }

  if (current >= cap) {
    return c.json(
      {
        error: {
          message: `daily rate limit reached (${cap} requests per IP per day). Try again tomorrow or contact the hackathon team.`,
          type: 'rate_limit_error',
          code: 'rate_limit_per_ip_per_day',
        },
      },
      429,
    );
  }

  // Fire-and-forget increment. KV writes are async-eventually-consistent;
  // we don't await beyond the put returning — the Worker's
  // `c.executionCtx.waitUntil` would extend the lifetime but isn't
  // strictly needed here since put resolves fast.
  try {
    await kv.put(key, String(current + 1), { expirationTtl: TTL_SECONDS });
  } catch (err) {
    console.warn('ratelimit: KV write failed; fail-open', err);
  }

  await next();
}

function ymd(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
