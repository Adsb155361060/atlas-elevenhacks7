import { z } from 'zod';

/**
 * Runtime environment schema. Bindings injected by Cloudflare Workers
 * (secrets + [vars] from wrangler.toml). We validate once at request entry
 * so the rest of the code can treat env as fully typed and non-optional.
 *
 * Test-time: pass a plain object to `parseEnv` to short-circuit Cloudflare bindings.
 */

const ModelId = z.string().min(1);
const NonEmpty = z.string().min(1);

export const EnvSchema = z.object({
  // Secrets (wrangler secret put)
  GEMINI_API_KEY: NonEmpty.describe(
    'Google AI Studio API key — backs /v1/chat/completions via the Gemini streaming endpoint.',
  ),
  ALLOWED_AGENT_TOKENS: NonEmpty.describe(
    'Comma-separated list of acceptable Bearer tokens for the ElevenLabs custom-LLM endpoint. Use multiple to enable zero-downtime rotation.',
  ),

  // Optional secrets
  ANTHROPIC_API_KEY: z.string().optional().describe(
    'Optional. Required only if the legacy Anthropic-backed vision_qa route is still in use; the main chat path runs on Gemini.',
  ),
  ELEVENLABS_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional().describe(
    'Firecrawl bearer token. Backs the web_search tool — Firecrawl does search + scrape in one call so the agent gets cleaned article markdown, not bare SERP snippets.',
  ),
  // Kept optional for back-compat; the legacy web_search route used it. Safe
  // to drop entirely once we're sure nothing else references it.
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Plain vars (wrangler.toml [vars])
  WORKER_VERSION: z.string().default('0.0.0'),
  DEFAULT_LLM_MODEL: ModelId.default('gemini-2.5-flash'),
  FALLBACK_LLM_MODEL: ModelId.default('gemini-2.5-flash-lite').describe(
    'Used by the chat completions client when the primary returns 429 / 5xx / model-not-found. Set to an empty string in test envs to disable.',
  ),
  ROUTER_TOOL_MODEL: ModelId.default('gemini-2.5-flash'),
  ROUTER_TRIAGE_MODEL: ModelId.default('gemini-2.5-flash-lite'),
  // Legacy alias — still consumed by the Anthropic-backed vision_qa route.
  DEFAULT_ANTHROPIC_MODEL: ModelId.default('claude-opus-4-7'),
  DAILY_LLM_BUDGET_USD: z.string().default('20'),
  RATE_LIMIT_PER_DAY: z.string().default('200'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  // KV binding for per-IP daily counters. `unknown` because zod can't
  // describe a Workers KV namespace shape; the consumer casts.
  ATLAS_RATELIMIT: z.unknown().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(input: unknown): Env {
  return EnvSchema.parse(input);
}

/**
 * Set of allowed tokens for the Authorization: Bearer header.
 * Comma-separated in env so we can rotate without a deploy.
 */
export function allowedTokens(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_AGENT_TOKENS.split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  );
}
