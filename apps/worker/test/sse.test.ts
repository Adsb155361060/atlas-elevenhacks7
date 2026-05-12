import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  anthropicStreamToOpenAISSE,
  generateChatCompletionId,
  sseReadableStream,
} from '../src/claude/sse.js';

type StreamEvent = Anthropic.Messages.RawMessageStreamEvent;

const OPTS = { id: 'chatcmpl-test', model: 'claude-opus-4-7', created: 1700000000 };

/**
 * Anthropic's `RawMessageStreamEvent` union has many auxiliary fields the bridge
 * never reads. We construct events with only the fields under test, then cast.
 */
function ev(input: unknown): StreamEvent {
  return input as StreamEvent;
}

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function collect(events: StreamEvent[]): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of anthropicStreamToOpenAISSE(asyncIter(events), OPTS)) {
    out.push(chunk);
  }
  return out;
}

function parseChunk(line: string): {
  delta: Record<string, unknown>;
  finish_reason: string | null;
} {
  expect(line.startsWith('data: ')).toBe(true);
  expect(line.endsWith('\n\n')).toBe(true);
  const raw = line.slice('data: '.length, -2);
  if (raw === '[DONE]') return { delta: { __done: true }, finish_reason: null };
  const parsed = JSON.parse(raw);
  expect(parsed.id).toBe(OPTS.id);
  expect(parsed.object).toBe('chat.completion.chunk');
  expect(parsed.model).toBe(OPTS.model);
  expect(parsed.choices[0].index).toBe(0);
  return {
    delta: parsed.choices[0].delta,
    finish_reason: parsed.choices[0].finish_reason,
  };
}

// ───────────────────────── event builders ─────────────────────────

const messageStart = ev({
  type: 'message_start',
  message: {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    content: [],
    model: 'claude-opus-4-7',
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  },
});

const messageStopOnly = ev({ type: 'message_stop' });

function textBlockStart(index = 0): StreamEvent {
  return ev({
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '' },
  });
}

function toolBlockStart(index: number, id: string, name: string): StreamEvent {
  return ev({
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name, input: {} },
  });
}

function textDelta(index: number, text: string): StreamEvent {
  return ev({
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  });
}

function inputJsonDelta(index: number, partial_json: string): StreamEvent {
  return ev({
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json },
  });
}

function contentBlockStop(index: number): StreamEvent {
  return ev({ type: 'content_block_stop', index });
}

function messageDelta(stop_reason: string): StreamEvent {
  return ev({
    type: 'message_delta',
    delta: { stop_reason, stop_sequence: null },
    usage: { output_tokens: 0 },
  });
}

// ───────────────────────── text-stream tests ─────────────────────────

describe('anthropicStreamToOpenAISSE — text stream', () => {
  it('emits role marker, content deltas, and stop with [DONE]', async () => {
    const chunks = await collect([
      messageStart,
      textBlockStart(0),
      textDelta(0, 'Hello'),
      textDelta(0, ' world'),
      contentBlockStop(0),
      messageDelta('end_turn'),
      messageStopOnly,
    ]);

    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(parseChunk(chunks[0]!).delta).toEqual({ role: 'assistant' });
    expect(parseChunk(chunks[1]!).delta).toEqual({ content: 'Hello' });
    expect(parseChunk(chunks[2]!).delta).toEqual({ content: ' world' });

    const final = parseChunk(chunks[chunks.length - 2]!);
    expect(final.delta).toEqual({});
    expect(final.finish_reason).toBe('stop');
    expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');
  });

  it('skips empty text_deltas', async () => {
    const chunks = await collect([
      messageStart,
      textBlockStart(0),
      textDelta(0, ''),
      textDelta(0, 'ok'),
      contentBlockStop(0),
      messageDelta('end_turn'),
      messageStopOnly,
    ]);
    const contentChunks = chunks
      .map(parseChunk)
      .filter((c) => 'content' in (c.delta as Record<string, unknown>));
    expect(contentChunks).toHaveLength(1);
    expect(contentChunks[0]?.delta.content).toBe('ok');
  });
});

// ───────────────────────── tool-call tests ─────────────────────────

describe('anthropicStreamToOpenAISSE — tool call stream', () => {
  it('emits tool_calls header on block_start and arguments on input_json_delta', async () => {
    const chunks = (
      await collect([
        messageStart,
        toolBlockStart(0, 'toolu_abc', 'web_search'),
        inputJsonDelta(0, '{"q":'),
        inputJsonDelta(0, '"lagos"}'),
        contentBlockStop(0),
        messageDelta('tool_use'),
        messageStopOnly,
      ])
    ).map(parseChunk);

    const headerChunk = chunks.find(
      (c) => Array.isArray(c.delta.tool_calls) && (c.delta.tool_calls as Array<Record<string, unknown>>)[0]?.id !== undefined,
    );
    expect(headerChunk).toBeDefined();
    const tc = (headerChunk!.delta.tool_calls as Array<Record<string, unknown>>)[0]!;
    expect(tc.index).toBe(0);
    expect(tc.id).toBe('toolu_abc');
    expect(tc.type).toBe('function');
    expect(tc.function).toEqual({ name: 'web_search', arguments: '' });

    const argChunks = chunks.filter((c) => {
      const calls = c.delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (!calls || calls.length === 0) return false;
      const first = calls[0] as Record<string, unknown> | undefined;
      return first?.id === undefined && first?.function !== undefined;
    });
    const joined = argChunks
      .map((c) => {
        const calls = c.delta.tool_calls as Array<{ function?: { arguments?: string } }>;
        return calls[0]?.function?.arguments ?? '';
      })
      .join('');
    expect(joined).toBe('{"q":"lagos"}');

    expect(chunks[chunks.length - 2]?.finish_reason).toBe('tool_calls');
    expect(chunks[chunks.length - 1]).toEqual({ delta: { __done: true }, finish_reason: null });
  });

  it('indexes multiple parallel tool calls correctly', async () => {
    const chunks = (
      await collect([
        messageStart,
        toolBlockStart(0, 'toolu_1', 'a'),
        inputJsonDelta(0, '{}'),
        contentBlockStop(0),
        toolBlockStart(1, 'toolu_2', 'b'),
        inputJsonDelta(1, '{}'),
        contentBlockStop(1),
        messageDelta('tool_use'),
        messageStopOnly,
      ])
    ).map(parseChunk);

    const headerIndices = chunks
      .filter((c) => {
        const calls = c.delta.tool_calls as Array<Record<string, unknown>> | undefined;
        return calls && calls[0]?.id !== undefined;
      })
      .map((c) => (c.delta.tool_calls as Array<{ index: number }>)[0]?.index);
    expect(headerIndices).toEqual([0, 1]);
  });
});

// ───────────────────────── id + ReadableStream tests ─────────────────────────

describe('generateChatCompletionId', () => {
  it('matches OpenAI prefix and is sufficiently long', () => {
    const id = generateChatCompletionId();
    expect(id.startsWith('chatcmpl-')).toBe(true);
    expect(id.length).toBeGreaterThanOrEqual(30);
  });

  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateChatCompletionId()));
    expect(ids.size).toBe(50);
  });
});

describe('sseReadableStream', () => {
  it('produces a ReadableStream that yields the same SSE bytes', async () => {
    const rs = sseReadableStream(
      asyncIter([
        messageStart,
        textBlockStart(0),
        textDelta(0, 'hi'),
        messageDelta('end_turn'),
        messageStopOnly,
      ]),
      OPTS,
    );
    const reader = rs.getReader();
    const decoder = new TextDecoder();
    let body = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      body += decoder.decode(value);
    }
    expect(body).toContain('"delta":{"role":"assistant"}');
    expect(body).toContain('"delta":{"content":"hi"}');
    expect(body.endsWith('data: [DONE]\n\n')).toBe(true);
  });
});
