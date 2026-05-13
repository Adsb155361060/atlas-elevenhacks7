import { describe, expect, it } from 'vitest';
import { resolveGeminiModel } from '../src/gemini/router.js';
import type { Env } from '../src/env.js';

const ENV: Env = {
  GEMINI_API_KEY: 'g-fake',
  ALLOWED_AGENT_TOKENS: 'tok',
  WORKER_VERSION: '0.0.0',
  DEFAULT_LLM_MODEL: 'gemini-2.5-pro',
  FALLBACK_LLM_MODEL: 'gemini-2.5-flash',
  ROUTER_TOOL_MODEL: 'gemini-2.5-flash',
  ROUTER_TRIAGE_MODEL: 'gemini-2.5-flash-lite',
  DEFAULT_ANTHROPIC_MODEL: 'claude-opus-4-7',
  DAILY_LLM_BUDGET_USD: '20',
  RATE_LIMIT_PER_DAY: '200',
  LOG_LEVEL: 'info',
};

describe('resolveGeminiModel', () => {
  it('passes gemini- ids through unchanged', () => {
    expect(resolveGeminiModel('gemini-2.5-pro', ENV)).toBe('gemini-2.5-pro');
    expect(resolveGeminiModel('gemini-2.5-flash-lite', ENV)).toBe('gemini-2.5-flash-lite');
  });

  it('maps legacy Anthropic hints to Gemini tiers', () => {
    expect(resolveGeminiModel('claude-haiku-4-5', ENV)).toBe('gemini-2.5-flash-lite');
    expect(resolveGeminiModel('claude-sonnet-4-6', ENV)).toBe('gemini-2.5-flash');
    expect(resolveGeminiModel('claude-opus-4-7', ENV)).toBe('gemini-2.5-pro');
  });

  it('falls back to default for unknown labels', () => {
    expect(resolveGeminiModel('gpt-4o', ENV)).toBe('gemini-2.5-pro');
    expect(resolveGeminiModel('', ENV)).toBe('gemini-2.5-pro');
  });
});
