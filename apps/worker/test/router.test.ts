import { describe, expect, it } from 'vitest';
import { resolveAnthropicModel } from '../src/claude/router.js';
import type { Env } from '../src/env.js';

const ENV: Env = {
  ANTHROPIC_API_KEY: 'sk-fake',
  ALLOWED_AGENT_TOKENS: 'tok',
  WORKER_VERSION: '0.0.0',
  DEFAULT_ANTHROPIC_MODEL: 'claude-opus-4-7',
  ROUTER_TOOL_MODEL: 'claude-sonnet-4-6',
  ROUTER_TRIAGE_MODEL: 'claude-haiku-4-5-20251001',
  DAILY_ANTHROPIC_BUDGET_USD: '20',
  LOG_LEVEL: 'info',
};

describe('resolveAnthropicModel', () => {
  it('passes claude- ids through unchanged', () => {
    expect(resolveAnthropicModel('claude-opus-4-7', ENV)).toBe('claude-opus-4-7');
    expect(resolveAnthropicModel('claude-haiku-4-5-20251001', ENV)).toBe(
      'claude-haiku-4-5-20251001',
    );
  });

  it('resolves atlas/ aliases via env tiers', () => {
    expect(resolveAnthropicModel('atlas/default', ENV)).toBe('claude-opus-4-7');
    expect(resolveAnthropicModel('atlas/tool-router', ENV)).toBe('claude-sonnet-4-6');
    expect(resolveAnthropicModel('atlas/triage', ENV)).toBe(
      'claude-haiku-4-5-20251001',
    );
  });

  it('falls back to default for unknown labels', () => {
    expect(resolveAnthropicModel('gpt-4o', ENV)).toBe('claude-opus-4-7');
    expect(resolveAnthropicModel('', ENV)).toBe('claude-opus-4-7');
  });
});
