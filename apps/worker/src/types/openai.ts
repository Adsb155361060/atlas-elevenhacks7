/**
 * OpenAI Chat Completions API shapes — only the subset used by ElevenLabs
 * Conversational Agent's custom-LLM endpoint.
 *
 * These types intentionally do *not* import @types/openai or similar; we own
 * the contract and want it stable + minimal. Anything we don't translate is
 * dropped silently (with a warn log when in debug mode).
 */

import { z } from 'zod';

// ───────────────────────── Message content ─────────────────────────

export const OpenAITextPart = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const OpenAIImagePart = z.object({
  type: z.literal('image_url'),
  image_url: z.union([
    z.string(),
    z.object({ url: z.string(), detail: z.enum(['auto', 'low', 'high']).optional() }),
  ]),
});

export const OpenAIContentPart = z.union([OpenAITextPart, OpenAIImagePart]);

export const OpenAIToolCall = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(), // JSON-encoded, possibly streamed in deltas
  }),
});

export const OpenAISystemMessage = z.object({
  role: z.literal('system'),
  content: z.union([z.string(), z.array(OpenAITextPart)]),
  name: z.string().optional(),
});

export const OpenAIUserMessage = z.object({
  role: z.literal('user'),
  content: z.union([z.string(), z.array(OpenAIContentPart)]),
  name: z.string().optional(),
});

export const OpenAIAssistantMessage = z.object({
  role: z.literal('assistant'),
  content: z.union([z.string(), z.array(OpenAITextPart), z.null()]).optional(),
  tool_calls: z.array(OpenAIToolCall).optional(),
  name: z.string().optional(),
});

export const OpenAIToolMessage = z.object({
  role: z.literal('tool'),
  content: z.union([z.string(), z.array(OpenAITextPart)]),
  tool_call_id: z.string(),
});

export const OpenAIMessage = z.union([
  OpenAISystemMessage,
  OpenAIUserMessage,
  OpenAIAssistantMessage,
  OpenAIToolMessage,
]);
export type OpenAIMessage = z.infer<typeof OpenAIMessage>;

// ───────────────────────── Tools ─────────────────────────

export const OpenAITool = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
});
export type OpenAITool = z.infer<typeof OpenAITool>;

export const OpenAIToolChoice = z.union([
  z.literal('auto'),
  z.literal('none'),
  z.literal('required'),
  z.object({
    type: z.literal('function'),
    function: z.object({ name: z.string() }),
  }),
]);
export type OpenAIToolChoice = z.infer<typeof OpenAIToolChoice>;

// ───────────────────────── Request ─────────────────────────

export const OpenAIChatRequest = z.object({
  model: z.string(),
  messages: z.array(OpenAIMessage),
  tools: z.array(OpenAITool).optional(),
  tool_choice: OpenAIToolChoice.optional(),
  stream: z.boolean().optional().default(true),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  user: z.string().optional(),
  // Fields we accept but don't forward:
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  logit_bias: z.unknown().optional(),
  response_format: z.unknown().optional(),
  seed: z.number().optional(),
  n: z.number().optional(),
});
export type OpenAIChatRequest = z.infer<typeof OpenAIChatRequest>;

// ───────────────────────── Streaming response ─────────────────────────

export interface OpenAIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: null | 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
}

// ───────────────────────── Non-streaming response (rare path) ─────────────────────────

export interface OpenAIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
