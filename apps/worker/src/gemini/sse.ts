/**
 * Gemini stream chunks → OpenAI Chat Completions SSE event stream.
 *
 * The downstream consumer (ElevenLabs Conversational Agent) only understands
 * the OpenAI shape. Each Gemini chunk arrives with one or more `parts` that we
 * fan out into one OpenAI `data:` event per content piece:
 *
 *   • A `text` part        → `choices[0].delta.content`
 *   • A `functionCall`     → `choices[0].delta.tool_calls[]` (single chunk;
 *                            we emit the full args object since Gemini doesn't
 *                            stream tool args char-by-char like Anthropic)
 *   • finishReason="STOP"  → final chunk with `finish_reason:"stop"`
 *   • finishReason="TOOL_USE"|"OTHER" → finish_reason mapped accordingly
 *
 * We also emit a leading `role:"assistant"` delta on the first chunk so the
 * OpenAI client sees a valid assistant turn start.
 */

import type { GeminiStreamChunk } from './client.js';

export interface SseFrameMeta {
  id: string;
  model: string;
  created: number;
}

/**
 * Async generator that walks Gemini stream chunks and yields the OpenAI
 * `chat.completion.chunk` payloads (as plain JS objects). Caller is
 * responsible for serializing to `data: <json>\n\n` and appending `[DONE]`.
 */
export async function* geminiStreamToOpenAIChunks(
  upstream: AsyncIterable<GeminiStreamChunk>,
  meta: SseFrameMeta,
): AsyncGenerator<OpenAIChunk, void, void> {
  let emittedRole = false;
  let toolCallIndex = 0;
  let finishReason: string | null = null;

  for await (const chunk of upstream) {
    const candidate = chunk.candidates?.[0];
    if (!candidate) continue;

    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        const delta: OpenAIChunkDelta = emittedRole
          ? { content: part.text }
          : { role: 'assistant', content: part.text };
        emittedRole = true;
        yield buildChunk(meta, delta, null);
      } else if (part.functionCall) {
        const delta: OpenAIChunkDelta = {
          ...(emittedRole ? {} : { role: 'assistant', content: null }),
          tool_calls: [
            {
              index: toolCallIndex,
              id: `call_${randomToolId()}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args ?? {}),
              },
            },
          ],
        };
        emittedRole = true;
        toolCallIndex += 1;
        yield buildChunk(meta, delta, null);
      }
    }

    if (candidate.finishReason) {
      finishReason = candidate.finishReason;
    }
  }

  // Emit a final empty-delta chunk with the finish reason. ElevenLabs expects
  // this to know the turn ended.
  //
  // Gemini quirk: when its only output for the turn is a `functionCall`, it
  // *still* sets `finishReason: "STOP"`. The OpenAI contract is that any turn
  // ending in tool calls must report `finish_reason: "tool_calls"`. If we
  // forward STOP → "stop" verbatim, downstream consumers (ElevenLabs Conv-AI)
  // see "stop with no content" and bail with custom_llm_error. Override here.
  const finalReason: OpenAIChunk['choices'][number]['finish_reason'] =
    toolCallIndex > 0 ? 'tool_calls' : mapFinishReason(finishReason);
  yield buildChunk(meta, {}, finalReason);
}

/**
 * Serialize the chunk generator into the SSE wire format (`data: <json>\n\n`)
 * followed by a `data: [DONE]\n\n` terminator. Returns a ReadableStream
 * suitable for `new Response(stream, { status: 200, … })`.
 */
export function sseReadableStream(
  upstream: AsyncIterable<GeminiStreamChunk>,
  meta: SseFrameMeta,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const iter = geminiStreamToOpenAIChunks(upstream, meta);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iter.next();
      if (next.done) {
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(`data: ${JSON.stringify(next.value)}\n\n`));
    },
    async cancel() {
      // Drain so upstream resources release.
      for await (const _ of iter) void _;
    },
  });
}

export function generateChatCompletionId(): string {
  return `chatcmpl-${randomBase58(24)}`;
}

// ───────────────────────── helpers ─────────────────────────

interface OpenAIChunkDelta {
  role?: 'assistant';
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAIChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: OpenAIChunkDelta;
    finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
  }>;
}

function buildChunk(
  meta: SseFrameMeta,
  delta: OpenAIChunkDelta,
  finishReason: OpenAIChunk['choices'][number]['finish_reason'],
): OpenAIChunk {
  return {
    id: meta.id,
    object: 'chat.completion.chunk',
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function mapFinishReason(
  reason: string | null,
): OpenAIChunk['choices'][number]['finish_reason'] {
  if (!reason) return 'stop';
  switch (reason.toUpperCase()) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
      return 'content_filter';
    case 'TOOL_USE':
    case 'FUNCTION_CALL':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function randomBase58(len: number): string {
  let s = '';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) s += ALPHABET[buf[i]! % ALPHABET.length];
  return s;
}

function randomToolId(): string {
  return randomBase58(20);
}
