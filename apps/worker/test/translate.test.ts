import { describe, expect, it } from 'vitest';
import {
  openaiRequestToAnthropic,
  coalesceToolResultsIntoUserMessages,
} from '../src/claude/translate.js';
import type { OpenAIChatRequest } from '../src/types/openai.js';

const OPTS = { model: 'claude-opus-4-7', enablePromptCaching: true };

function makeReq(overrides: Partial<OpenAIChatRequest>): OpenAIChatRequest {
  return {
    model: 'claude-opus-4-7',
    stream: true,
    messages: [],
    ...overrides,
  } as OpenAIChatRequest;
}

describe('openaiRequestToAnthropic', () => {
  it('extracts system messages into top-level system block with cache_control on the last block', () => {
    const req = makeReq({
      messages: [
        { role: 'system', content: 'You are Atlas.' },
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'hi' },
      ],
    });
    const out = openaiRequestToAnthropic(req, OPTS);
    expect(Array.isArray(out.system)).toBe(true);
    const sys = out.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    expect(sys).toHaveLength(2);
    expect(sys[0]?.text).toBe('You are Atlas.');
    expect(sys[1]?.text).toBe('Be concise.');
    expect(sys[0]?.cache_control).toBeUndefined();
    expect(sys[1]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(out.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('passes through a simple text turn', () => {
    const out = openaiRequestToAnthropic(
      makeReq({ messages: [{ role: 'user', content: 'hello' }] }),
      OPTS,
    );
    expect(out.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(out.system).toBeUndefined();
    expect(out.stream).toBe(true);
    expect(out.model).toBe('claude-opus-4-7');
  });

  it('translates an assistant message with text + tool_calls', () => {
    const out = openaiRequestToAnthropic(
      makeReq({
        messages: [
          { role: 'user', content: 'what time is it in tokyo' },
          {
            role: 'assistant',
            content: 'let me check',
            tool_calls: [
              {
                id: 'toolu_abc',
                type: 'function',
                function: { name: 'get_time', arguments: '{"tz":"Asia/Tokyo"}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'toolu_abc', content: '14:30 JST' },
        ],
      }),
      OPTS,
    );
    expect(out.messages).toHaveLength(3);
    const assistant = out.messages[1];
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.content).toEqual([
      { type: 'text', text: 'let me check' },
      {
        type: 'tool_use',
        id: 'toolu_abc',
        name: 'get_time',
        input: { tz: 'Asia/Tokyo' },
      },
    ]);
    const toolResult = out.messages[2];
    expect(toolResult?.role).toBe('user');
    expect(toolResult?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_abc', content: '14:30 JST' },
    ]);
  });

  it('falls back to wrapping unparsable tool_call arguments', () => {
    const out = openaiRequestToAnthropic(
      makeReq({
        messages: [
          { role: 'user', content: 'do the thing' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'toolu_x',
                type: 'function',
                function: { name: 'noop', arguments: 'not json{' },
              },
            ],
          },
        ],
      }),
      OPTS,
    );
    const assistant = out.messages[1];
    const blocks = assistant?.content as Array<{
      type: string;
      input?: Record<string, unknown>;
    }>;
    const toolUse = blocks.find((b) => b.type === 'tool_use');
    expect(toolUse?.input).toEqual({ __raw: 'not json{' });
  });

  it('coalesces consecutive tool results into a single user message', () => {
    const out = openaiRequestToAnthropic(
      makeReq({
        messages: [
          { role: 'user', content: 'do two things' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'a', arguments: '{}' },
              },
              {
                id: 'toolu_2',
                type: 'function',
                function: { name: 'b', arguments: '{}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'toolu_1', content: 'A done' },
          { role: 'tool', tool_call_id: 'toolu_2', content: 'B done' },
        ],
      }),
      OPTS,
    );
    expect(out.messages).toHaveLength(3); // user, assistant, merged tool-result-user
    const merged = out.messages[2];
    expect(merged?.role).toBe('user');
    expect(merged?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'A done' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: 'B done' },
    ]);
  });

  it('handles multimodal user content (text + image_url)', () => {
    const out = openaiRequestToAnthropic(
      makeReq({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this' },
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/cup.jpg' },
              },
              {
                type: 'image_url',
                image_url:
                  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=',
              },
            ],
          },
        ],
      }),
      OPTS,
    );
    const blocks = out.messages[0]?.content as Array<{
      type: string;
      text?: string;
      source?: { type: string; url?: string; media_type?: string; data?: string };
    }>;
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: 'what is this' });
    expect(blocks[1]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/cup.jpg' },
    });
    expect(blocks[2]?.type).toBe('image');
    expect(blocks[2]?.source?.type).toBe('base64');
    expect(blocks[2]?.source?.media_type).toBe('image/png');
    expect(blocks[2]?.source?.data).toContain('iVBORw0KGgo');
  });

  it('marks the last tool with cache_control when caching is enabled', () => {
    const out = openaiRequestToAnthropic(
      makeReq({
        messages: [{ role: 'user', content: 'go' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'a',
              description: 'first',
              parameters: { type: 'object', properties: {} },
            },
          },
          {
            type: 'function',
            function: {
              name: 'b',
              description: 'second',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      }),
      OPTS,
    );
    expect(out.tools).toHaveLength(2);
    const tools = out.tools as Array<{ name: string; cache_control?: unknown }>;
    expect(tools[0]?.cache_control).toBeUndefined();
    expect(tools[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('maps tool_choice variants', () => {
    const auto = openaiRequestToAnthropic(
      makeReq({
        messages: [{ role: 'user', content: 'x' }],
        tool_choice: 'auto',
      }),
      OPTS,
    );
    expect(auto.tool_choice).toEqual({ type: 'auto' });

    const required = openaiRequestToAnthropic(
      makeReq({
        messages: [{ role: 'user', content: 'x' }],
        tool_choice: 'required',
      }),
      OPTS,
    );
    expect(required.tool_choice).toEqual({ type: 'any' });

    const none = openaiRequestToAnthropic(
      makeReq({
        messages: [{ role: 'user', content: 'x' }],
        tool_choice: 'none',
      }),
      OPTS,
    );
    expect(none.tool_choice).toEqual({ type: 'none' });

    const specific = openaiRequestToAnthropic(
      makeReq({
        messages: [{ role: 'user', content: 'x' }],
        tool_choice: { type: 'function', function: { name: 'web_search' } },
      }),
      OPTS,
    );
    expect(specific.tool_choice).toEqual({ type: 'tool', name: 'web_search' });
  });

  it('uses max_tokens override and falls back to default', () => {
    const a = openaiRequestToAnthropic(
      makeReq({
        messages: [{ role: 'user', content: 'x' }],
        max_tokens: 64,
      }),
      OPTS,
    );
    expect(a.max_tokens).toBe(64);

    const b = openaiRequestToAnthropic(
      makeReq({ messages: [{ role: 'user', content: 'x' }] }),
      OPTS,
    );
    expect(b.max_tokens).toBe(2048); // default

    const c = openaiRequestToAnthropic(
      makeReq({ messages: [{ role: 'user', content: 'x' }] }),
      { ...OPTS, defaultMaxTokens: 512 },
    );
    expect(c.max_tokens).toBe(512);
  });

  it('forwards stop sequences as an array', () => {
    const single = openaiRequestToAnthropic(
      makeReq({
        messages: [{ role: 'user', content: 'x' }],
        stop: 'END',
      }),
      OPTS,
    );
    expect(single.stop_sequences).toEqual(['END']);
    const multi = openaiRequestToAnthropic(
      makeReq({
        messages: [{ role: 'user', content: 'x' }],
        stop: ['END', 'STOP'],
      }),
      OPTS,
    );
    expect(multi.stop_sequences).toEqual(['END', 'STOP']);
  });

  it('disables caching when opt-in flag is false', () => {
    const out = openaiRequestToAnthropic(
      makeReq({
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 't',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      }),
      { ...OPTS, enablePromptCaching: false },
    );
    const sys = out.system as Array<{ cache_control?: unknown }>;
    expect(sys.every((b) => b.cache_control === undefined)).toBe(true);
    const tools = out.tools as Array<{ cache_control?: unknown }>;
    expect(tools.every((t) => t.cache_control === undefined)).toBe(true);
  });

  it('preserves a fully-empty assistant turn as a placeholder text block', () => {
    const out = openaiRequestToAnthropic(
      makeReq({
        messages: [
          { role: 'user', content: 'x' },
          { role: 'assistant' }, // no content, no tool_calls
        ],
      }),
      OPTS,
    );
    const assistant = out.messages[1];
    expect(assistant?.content).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('coalesceToolResultsIntoUserMessages', () => {
  it('does not merge a tool-result bundle with a regular user message', () => {
    const merged = coalesceToolResultsIntoUserMessages([
      { role: 'user', content: 'plain' },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }],
      },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('merges multiple tool-result bundles', () => {
    const merged = coalesceToolResultsIntoUserMessages([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't2', content: 'r2' }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't3', content: 'r3' }],
      },
    ]);
    expect(merged).toHaveLength(1);
    const blocks = merged[0]?.content as Array<{ tool_use_id: string }>;
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['t1', 't2', 't3']);
  });
});
