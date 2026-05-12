/**
 * Tiered model routing.
 *
 * ADR 0010: Opus 4.7 is the conversational default; Sonnet 4.6 handles
 * tool-call routing and simple classification; Haiku 4.5 handles
 * high-throughput background tasks. The client can also pass an explicit
 * Anthropic model id and we honor it.
 */

import type { Env } from '../env.js';

/**
 * Resolve the OpenAI-side `model` field to an Anthropic model id.
 *
 * Accepted inputs (in order of precedence):
 *   1. An explicit Anthropic id like `claude-opus-4-7` → passes through.
 *   2. A named routing tier: `atlas/default`, `atlas/tool-router`, `atlas/triage`.
 *   3. Anything else → falls back to env.DEFAULT_ANTHROPIC_MODEL.
 */
export function resolveAnthropicModel(requested: string, env: Env): string {
  const r = (requested || '').trim();
  if (r.startsWith('claude-')) return r;
  switch (r) {
    case 'atlas/default':
      return env.DEFAULT_ANTHROPIC_MODEL;
    case 'atlas/tool-router':
      return env.ROUTER_TOOL_MODEL;
    case 'atlas/triage':
      return env.ROUTER_TRIAGE_MODEL;
    default:
      return env.DEFAULT_ANTHROPIC_MODEL;
  }
}
