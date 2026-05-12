/**
 * Anthropic Messages streaming events → OpenAI Server-Sent Events.
 *
 * ElevenLabs Conversational Agent's custom-LLM consumer expects OpenAI's SSE
 * shape: a series of `data: {...}\n\n` lines, each carrying a
 * `chat.completion.chunk`, terminated by `data: [DONE]\n\n`.
 *
 * Anthropic events we handle:
 *   - message_start          → emit role=assistant chunk
 *   - content_block_start    → tool_use blocks emit a header chunk with the id+name
 *   - content_block_delta    → text_delta → delta.content; input_json_delta → delta.tool_calls
 *   - message_delta          → capture stop_reason for the final chunk
 *   - message_stop           → final chunk + [DONE]
 *   - ping                   → ignored (Anthropic keepalive)
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { OpenAIStreamChunk } from '../types/openai.js';

type AnthropicStreamEvent = Anthropic.Messages.RawMessageStreamEvent;
type AnthropicStopReason = Anthropic.Messages.Message['stop_reason'];

export interface BridgeOpts {
  /** Chat completion id used across every chunk of this stream. */
  id: string;
  /** Model id reported back to the client (the OpenAI-side model, not Anthropic's). */
  model: string;
  /** Epoch seconds; stable across chunks. */
  created: number;
}

/**
 * Translate an Anthropic stream into an async generator of OpenAI SSE lines.
 * Each yielded string already includes the `data: ` prefix and `\n\n` terminator.
 */
export async function* anthropicStreamToOpenAISSE(
  stream: AsyncIterable<AnthropicStreamEvent>,
  opts: BridgeOpts,
): AsyncGenerator<string, void, undefined> {
  // OpenAI tool_calls is a flat array; map Anthropic content block index → OpenAI tool_calls index.
  const blockToolIndex = new Map<number, number>();
  let nextToolIndex = 0;
  let stopReason: AnthropicStopReason | null = null;
  let emittedFirstChunk = false;
  let sawEvents = 0;

  try {
    for await (const event of stream) {
      sawEvents++;
    switch (event.type) {
      case 'message_start': {
        // Initial role marker (OpenAI streams send the role on the first chunk).
        yield sseChunk(opts, {
          delta: { role: 'assistant' },
          finish_reason: null,
        });
        emittedFirstChunk = true;
        break;
      }

      case 'content_block_start': {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          const toolIdx = nextToolIndex++;
          blockToolIndex.set(event.index, toolIdx);
          yield sseChunk(opts, {
            delta: {
              tool_calls: [
                {
                  index: toolIdx,
                  id: block.id,
                  type: 'function',
                  function: {
                    name: block.name,
                    arguments: '',
                  },
                },
              ],
            },
            finish_reason: null,
          });
        }
        // text blocks emit nothing on start; their first delta carries content.
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          if (delta.text.length === 0) break;
          yield sseChunk(opts, {
            delta: { content: delta.text },
            finish_reason: null,
          });
        } else if (delta.type === 'input_json_delta') {
          const toolIdx = blockToolIndex.get(event.index);
          if (toolIdx === undefined) break;
          yield sseChunk(opts, {
            delta: {
              tool_calls: [
                {
                  index: toolIdx,
                  function: { arguments: delta.partial_json },
                },
              ],
            },
            finish_reason: null,
          });
        }
        // Other delta types (citations_delta, thinking_delta, signature_delta)
        // intentionally not forwarded — they have no OpenAI equivalent and the
        // ElevenLabs side wouldn't know what to do with them.
        break;
      }

      case 'content_block_stop':
        // No-op: tool_use arguments terminate naturally once message_stop fires.
        break;

      case 'message_delta': {
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        break;
      }

      case 'message_stop': {
        if (!emittedFirstChunk) {
          // Defensive: still emit a role marker so consumers see a valid stream.
          yield sseChunk(opts, {
            delta: { role: 'assistant' },
            finish_reason: null,
          });
        }
        yield sseChunk(opts, {
          delta: {},
          finish_reason: mapStopReason(stopReason),
        });
        yield 'data: [DONE]\n\n';
        return;
      }

      default:
        // Unknown event types are ignored. Anthropic adds new ones over time;
        // forward-compat without crashes is the right default.
        break;
    }
    }
  } catch (err) {
    console.error('anthropic stream error after', sawEvents, 'events:', err);
    yield sseChunk(opts, {
      delta: {
        content:
          err instanceof Error
            ? `[upstream error: ${err.message}]`
            : '[upstream error]',
      },
      finish_reason: null,
    });
    yield sseChunk(opts, { delta: {}, finish_reason: 'stop' });
    yield 'data: [DONE]\n\n';
    return;
  }

  if (sawEvents === 0) {
    console.warn('anthropic stream produced no events');
  }
  // Stream ended without an explicit message_stop (rare; cancelled connection).
  yield sseChunk(opts, {
    delta: {},
    finish_reason: mapStopReason(stopReason),
  });
  yield 'data: [DONE]\n\n';
}

/**
 * Wrap the SSE generator in a ReadableStream suitable for Workers' Response body.
 */
export function sseReadableStream(
  source: AsyncIterable<AnthropicStreamEvent>,
  opts: BridgeOpts,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iter = anthropicStreamToOpenAISSE(source, opts);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iter.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(value));
      }
    },
    async cancel() {
      // Stop reading; the generator unwinds. Anthropic SDK closes the upstream
      // socket when the AsyncIterable is dropped.
    },
  });
}

// ───────────────────────── helpers ─────────────────────────

function sseChunk(
  opts: BridgeOpts,
  choice: Omit<OpenAIStreamChunk['choices'][number], 'index'>,
): string {
  const chunk: OpenAIStreamChunk = {
    id: opts.id,
    object: 'chat.completion.chunk',
    created: opts.created,
    model: opts.model,
    choices: [
      {
        index: 0,
        ...choice,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function mapStopReason(
  r: AnthropicStopReason | null,
): OpenAIStreamChunk['choices'][number]['finish_reason'] {
  switch (r) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'tool_use':
      return 'tool_calls';
    case 'max_tokens':
      return 'length';
    case 'pause_turn':
    case 'refusal':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/**
 * Generate a stable id for a chat completion stream.
 * Format mirrors OpenAI: `chatcmpl-` + 29 alphanumeric chars.
 */
export function generateChatCompletionId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(29);
  crypto.getRandomValues(bytes);
  let s = 'chatcmpl-';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    s += alphabet[b % alphabet.length];
  }
  return s;
}
