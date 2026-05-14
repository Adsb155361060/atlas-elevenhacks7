import { describe, expect, it } from 'vitest';
import { parseEnv, allowedTokens } from '../src/env.js';

describe('parseEnv', () => {
  it('accepts minimal env and applies defaults', () => {
    const env = parseEnv({
      GEMINI_API_KEY: 'g-test',
      ALLOWED_AGENT_TOKENS: 'tok1',
    });
    expect(env.WORKER_VERSION).toBe('0.0.0');
    expect(env.DEFAULT_LLM_MODEL).toBe('gemini-3-flash-preview');
    expect(env.FALLBACK_LLM_MODEL).toBe('gemini-2.5-flash');
    expect(env.ROUTER_TOOL_MODEL).toBe('gemini-3-flash-preview');
    expect(env.ROUTER_TRIAGE_MODEL).toBe('gemini-2.5-flash-lite');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects when required secret is missing', () => {
    expect(() => parseEnv({ ALLOWED_AGENT_TOKENS: 'tok' })).toThrow();
    expect(() => parseEnv({ GEMINI_API_KEY: 'g-test' })).toThrow();
  });

  it('rejects empty strings for required secrets', () => {
    expect(() =>
      parseEnv({ GEMINI_API_KEY: '', ALLOWED_AGENT_TOKENS: 'tok' }),
    ).toThrow();
  });
});

describe('allowedTokens', () => {
  it('splits comma-separated tokens and trims whitespace', () => {
    const env = parseEnv({
      GEMINI_API_KEY: 'g-test',
      ALLOWED_AGENT_TOKENS: 'tok-a, tok-b ,tok-c',
    });
    const set = allowedTokens(env);
    expect(set.has('tok-a')).toBe(true);
    expect(set.has('tok-b')).toBe(true);
    expect(set.has('tok-c')).toBe(true);
    expect(set.size).toBe(3);
  });

  it('drops empty entries from doubled commas', () => {
    const env = parseEnv({
      GEMINI_API_KEY: 'g-test',
      ALLOWED_AGENT_TOKENS: 'tok-a,,tok-b',
    });
    expect(allowedTokens(env).size).toBe(2);
  });
});
