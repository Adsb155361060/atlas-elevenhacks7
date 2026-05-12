import { describe, expect, it } from 'vitest';
import { parseEnv, allowedTokens } from '../src/env.js';

describe('parseEnv', () => {
  it('accepts minimal env and applies defaults', () => {
    const env = parseEnv({
      ANTHROPIC_API_KEY: 'sk-test',
      ALLOWED_AGENT_TOKENS: 'tok1',
    });
    expect(env.WORKER_VERSION).toBe('0.0.0');
    expect(env.DEFAULT_ANTHROPIC_MODEL).toBe('claude-opus-4-7');
    expect(env.ROUTER_TOOL_MODEL).toBe('claude-sonnet-4-6');
    expect(env.ROUTER_TRIAGE_MODEL).toBe('claude-haiku-4-5-20251001');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects when required secret is missing', () => {
    expect(() => parseEnv({ ALLOWED_AGENT_TOKENS: 'tok' })).toThrow();
    expect(() => parseEnv({ ANTHROPIC_API_KEY: 'sk' })).toThrow();
  });

  it('rejects empty strings for required secrets', () => {
    expect(() =>
      parseEnv({ ANTHROPIC_API_KEY: '', ALLOWED_AGENT_TOKENS: 'tok' }),
    ).toThrow();
  });
});

describe('allowedTokens', () => {
  it('splits comma-separated tokens and trims whitespace', () => {
    const env = parseEnv({
      ANTHROPIC_API_KEY: 'sk',
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
      ANTHROPIC_API_KEY: 'sk',
      ALLOWED_AGENT_TOKENS: 'tok-a,,tok-b',
    });
    expect(allowedTokens(env).size).toBe(2);
  });
});
