/**
 * Bidirectional shape translation between the OpenAI Chat Completions API
 * (what ElevenLabs Conversational Agent's custom-LLM endpoint sends us) and
 * the Anthropic Messages API (what we forward to Claude).
 *
 * The forward path (OpenAI → Anthropic) is the hot path; we apply prompt
 * caching markers here on the system + tools blocks (both stable per turn).
 *
 * The reverse path is implemented in `./sse.ts` because it's streaming-shaped.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type {
  OpenAIChatRequest,
  OpenAIMessage,
  OpenAITool,
  OpenAIToolChoice,
} from '../types/openai.js';

// Anthropic SDK input types (alias for readability)
type AnthropicMessageCreateParams = Anthropic.Messages.MessageCreateParamsStreaming;
type AnthropicMessageParam = Anthropic.Messages.MessageParam;
type AnthropicContentBlock = Anthropic.Messages.ContentBlockParam;
type AnthropicTool = Anthropic.Messages.Tool;
type AnthropicToolChoice = Anthropic.Messages.ToolChoice;
type AnthropicTextBlock = Anthropic.Messages.TextBlockParam;

const DEFAULT_MAX_TOKENS = 2048;

export interface TranslateOpts {
  /** Anthropic model id (post-routing). */
  model: string;
  /** Default max_tokens when client didn't set it. */
  defaultMaxTokens?: number;
  /** Apply ephemeral prompt-caching markers on system + last tool. */
  enablePromptCaching?: boolean;
}

/**
 * Convert an OpenAI Chat Completions request into Anthropic Messages params.
 * Streaming flag is always true at the call site — Atlas's voice loop is realtime-only.
 */
export function openaiRequestToAnthropic(
  req: OpenAIChatRequest,
  opts: TranslateOpts,
): AnthropicMessageCreateParams {
  const { system, conversation } = extractSystemAndConversation(req.messages);

  const messages = coalesceToolResultsIntoUserMessages(
    conversation.map(openaiMessageToAnthropic),
  );

  const enableCaching = opts.enablePromptCaching ?? true;

  const params: AnthropicMessageCreateParams = {
    model: opts.model,
    max_tokens: req.max_tokens ?? opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    messages,
    stream: true,
  };

  // System: array form so we can attach cache_control. Skip when empty.
  if (system.length > 0) {
    const sysBlocks: AnthropicTextBlock[] = system.map((text, idx, arr) => {
      const block: AnthropicTextBlock = { type: 'text', text };
      const isLast = idx === arr.length - 1;
      if (enableCaching && isLast && text.length > 0) {
        block.cache_control = { type: 'ephemeral' };
      }
      return block;
    });
    params.system = sysBlocks;
  }

  // Tools: array form. Cache the *last* tool definition; Anthropic propagates
  // the cache breakpoint over all preceding tools, which is exactly what we want.
  if (req.tools && req.tools.length > 0) {
    const anthropicTools: AnthropicTool[] = req.tools.map(openaiToolToAnthropic);
    if (enableCaching && anthropicTools.length > 0) {
      const last = anthropicTools[anthropicTools.length - 1];
      if (last) {
        last.cache_control = { type: 'ephemeral' };
      }
    }
    params.tools = anthropicTools;
  }

  if (req.tool_choice !== undefined) {
    const tc = openaiToolChoiceToAnthropic(req.tool_choice);
    if (tc) params.tool_choice = tc;
  }

  if (req.temperature !== undefined) params.temperature = req.temperature;
  if (req.top_p !== undefined) params.top_p = req.top_p;
  if (req.stop !== undefined) {
    params.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  }
  if (req.user !== undefined) params.metadata = { user_id: req.user };

  return params;
}

// ───────────────────────── system + conversation split ─────────────────────────

function extractSystemAndConversation(messages: OpenAIMessage[]): {
  system: string[];
  conversation: OpenAIMessage[];
} {
  const system: string[] = [];
  const conversation: OpenAIMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system.push(stringifyTextContent(m.content));
    } else {
      conversation.push(m);
    }
  }
  return { system, conversation };
}

function stringifyTextContent(
  content: string | Array<{ type: 'text'; text: string }> | null | undefined,
): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content.map((p) => p.text).join('\n');
}

// ───────────────────────── per-message conversion ─────────────────────────

/**
 * Convert one OpenAI message to the equivalent Anthropic MessageParam.
 *
 * Tool messages translate to user-role messages with `tool_result` content
 * blocks; downstream coalescing merges consecutive ones (Anthropic requires
 * tool_results to live in a single user message between assistant turns).
 */
function openaiMessageToAnthropic(m: OpenAIMessage): AnthropicMessageParam {
  switch (m.role) {
    case 'user': {
      const content = userContentToAnthropic(m.content);
      return { role: 'user', content };
    }

    case 'assistant': {
      const blocks: AnthropicContentBlock[] = [];
      const textContent = stringifyTextContent(m.content ?? '');
      if (textContent.length > 0) {
        blocks.push({ type: 'text', text: textContent });
      }
      if (m.tool_calls) {
        for (const call of m.tool_calls) {
          let input: unknown = {};
          try {
            input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            // Anthropic accepts only structured input. If the OpenAI side sent
            // malformed JSON args, fall back to wrapping the raw string.
            input = { __raw: call.function.arguments };
          }
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.function.name,
            input: input as Record<string, unknown>,
          });
        }
      }
      if (blocks.length === 0) {
        // Anthropic requires non-empty content. Emit a placeholder text block.
        blocks.push({ type: 'text', text: '' });
      }
      return { role: 'assistant', content: blocks };
    }

    case 'tool': {
      // Becomes a user-role message with a tool_result block. The coalescer
      // merges this with adjacent tool messages.
      const resultText = stringifyTextContent(m.content);
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: resultText,
          },
        ],
      };
    }

    case 'system':
      // Already extracted upstream; should never reach here.
      throw new Error('translate: system message leaked into conversation');
  }
}

function userContentToAnthropic(
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | {
            type: 'image_url';
            image_url: string | { url: string; detail?: 'auto' | 'low' | 'high' };
          }
      >,
): string | AnthropicContentBlock[] {
  if (typeof content === 'string') return content;

  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url.url;
      blocks.push(imageUrlToAnthropic(url));
    }
  }
  return blocks;
}

function imageUrlToAnthropic(url: string): AnthropicContentBlock {
  // Anthropic supports two source forms: `url` (recent) and `base64` (always).
  // For data: URLs we extract media type + base64 payload; otherwise pass URL through.
  if (url.startsWith('data:')) {
    const match = url.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
    if (match) {
      const mediaType = match[1] as
        | 'image/jpeg'
        | 'image/png'
        | 'image/gif'
        | 'image/webp';
      const data = match[2];
      if (mediaType && data) {
        return {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data },
        };
      }
    }
  }
  return {
    type: 'image',
    source: { type: 'url', url },
  };
}

// ───────────────────────── tool definitions + choice ─────────────────────────

function openaiToolToAnthropic(tool: OpenAITool): AnthropicTool {
  const params = tool.function.parameters;
  // Anthropic requires the input_schema to be a JSON Schema object of type 'object'.
  const input_schema: AnthropicTool['input_schema'] =
    params && (params as { type?: string }).type === 'object'
      ? (params as AnthropicTool['input_schema'])
      : {
          type: 'object',
          properties: (params as Record<string, unknown> | undefined) ?? {},
        };
  const out: AnthropicTool = {
    name: tool.function.name,
    input_schema,
  };
  if (tool.function.description) out.description = tool.function.description;
  return out;
}

function openaiToolChoiceToAnthropic(
  choice: OpenAIToolChoice,
): AnthropicToolChoice | undefined {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  if (choice === 'none') return { type: 'none' };
  if (typeof choice === 'object' && choice.type === 'function') {
    return { type: 'tool', name: choice.function.name };
  }
  return undefined;
}

// ───────────────────────── tool-result coalescing ─────────────────────────

/**
 * Anthropic requires that consecutive tool_result blocks live in a *single*
 * user message between assistant turns. OpenAI sends each tool response as its
 * own message with role:tool. After `openaiMessageToAnthropic` converts each
 * to a one-block user message, we merge runs of adjacent user messages whose
 * content is exclusively tool_results.
 */
export function coalesceToolResultsIntoUserMessages(
  messages: AnthropicMessageParam[],
): AnthropicMessageParam[] {
  const out: AnthropicMessageParam[] = [];
  for (const m of messages) {
    const isToolResultBundle =
      m.role === 'user' &&
      Array.isArray(m.content) &&
      m.content.length > 0 &&
      m.content.every((b) => typeof b === 'object' && b.type === 'tool_result');
    const prev = out[out.length - 1];
    if (
      isToolResultBundle &&
      prev &&
      prev.role === 'user' &&
      Array.isArray(prev.content) &&
      prev.content.every((b) => typeof b === 'object' && b.type === 'tool_result')
    ) {
      // Merge into the previous tool-result bundle.
      prev.content = [
        ...(prev.content as AnthropicContentBlock[]),
        ...(m.content as AnthropicContentBlock[]),
      ];
    } else {
      out.push(m);
    }
  }
  return out;
}
