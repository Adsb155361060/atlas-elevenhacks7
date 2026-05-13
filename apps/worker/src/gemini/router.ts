/**
 * Pick the right Gemini model id given the model hint that ElevenLabs (or a
 * test caller) sends in the OpenAI request body. We accept either an explicit
 * Gemini id, an Anthropic-shaped legacy hint (kept for back-compat while the
 * agent dashboard still references claude-opus-*), or fall through to the
 * worker-wide default.
 */

import type { Env } from '../env.js';

/**
 * Map a request.model string to a real Gemini model id.
 *
 * Examples handled:
 *   "gemini-2.5-pro"          → "gemini-2.5-pro"
 *   "gemini-2.5-flash"        → "gemini-2.5-flash"
 *   "claude-opus-4-7"         → DEFAULT_LLM_MODEL  (legacy passthrough)
 *   "claude-haiku-4-5"        → ROUTER_TRIAGE_MODEL
 *   "claude-sonnet-4-6"       → ROUTER_TOOL_MODEL
 *   ""                        → DEFAULT_LLM_MODEL
 */
export function resolveGeminiModel(requested: string, env: Env): string {
  const req = (requested ?? '').trim().toLowerCase();
  if (req.startsWith('gemini-')) return req;
  if (req.includes('haiku')) return env.ROUTER_TRIAGE_MODEL;
  if (req.includes('sonnet')) return env.ROUTER_TOOL_MODEL;
  // Default + everything else (claude-opus-*, gpt-*, empty) → main model.
  return env.DEFAULT_LLM_MODEL;
}
