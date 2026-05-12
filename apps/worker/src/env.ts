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
  ANTHROPIC_API_KEY: NonEmpty,
  ALLOWED_AGENT_TOKENS: NonEmpty.describe(
    'Comma-separated list of acceptable Bearer tokens for the ElevenLabs custom-LLM endpoint. Use multiple to enable zero-downtime rotation.',
  ),

  // Optional secrets — present once their respective phases land
  ELEVENLABS_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Plain vars (wrangler.toml [vars])
  WORKER_VERSION: z.string().default('0.0.0'),
  DEFAULT_ANTHROPIC_MODEL: ModelId.default('claude-opus-4-7'),
  ROUTER_TOOL_MODEL: ModelId.default('claude-sonnet-4-6'),
  ROUTER_TRIAGE_MODEL: ModelId.default('claude-haiku-4-5-20251001'),
  DAILY_ANTHROPIC_BUDGET_USD: z.string().default('20'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
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
