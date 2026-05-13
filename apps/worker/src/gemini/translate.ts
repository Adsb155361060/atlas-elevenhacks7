/**
 * OpenAI Chat Completions request → Google Gemini `:streamGenerateContent`
 * request body.
 *
 * Mapping notes:
 *   • OpenAI role:system            → Gemini `systemInstruction.parts[].text`
 *   • OpenAI role:user (text)       → Gemini `contents[].role:"user" parts[].text`
 *   • OpenAI role:user (image_url)  → Gemini `contents[].parts[].inlineData` (data:)
 *                                     or `parts[].fileData.fileUri` (https:)
 *   • OpenAI role:assistant (text)  → Gemini `role:"model" parts[].text`
 *   • OpenAI role:assistant tool_calls
 *                                   → Gemini `role:"model" parts[].functionCall`
 *   • OpenAI role:tool              → Gemini `role:"user"  parts[].functionResponse`
 *   • OpenAI tools                  → Gemini `tools[].functionDeclarations`
 *   • OpenAI tool_choice            → Gemini `toolConfig.functionCallingConfig.mode`
 *
 * Gemini doesn't have a separate prompt-cache marker the way Anthropic does;
 * caching on Gemini is implicit (free for prefixes ≥ 1024 tokens on 2.5 Flash
 * and Pro), so we drop the cache_control side channel.
 */

import type {
  OpenAIChatRequest,
  OpenAIMessage,
  OpenAITool,
  OpenAIToolChoice,
} from '../types/openai.js';

const DEFAULT_MAX_TOKENS = 2048;

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType?: string; fileUri: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
  toolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE';
      allowedFunctionNames?: string[];
    };
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
}

export interface TranslateOpts {
  /** Gemini model id (post-routing) — used only for the URL, not the body. */
  model: string;
  /** Default max_tokens when client didn't set it. */
  defaultMaxTokens?: number;
}

export function openaiRequestToGemini(
  req: OpenAIChatRequest,
  opts: TranslateOpts,
): GeminiRequestBody {
  const { system, conversation } = extractSystemAndConversation(req.messages);

  const contents: GeminiContent[] = [];
  // We need to map a flat OpenAI message list (with sometimes-many tool
  // messages between assistant + user turns) into Gemini's strictly-alternating
  // user/model contents. Consecutive same-role messages are merged; tool
  // results piggyback onto a `user` content as functionResponse parts.
  for (const m of conversation) {
    appendOpenAIMessageToContents(m, contents);
  }

  const body: GeminiRequestBody = { contents };

  if (system.length > 0) {
    body.systemInstruction = {
      parts: system.filter((t) => t.length > 0).map((text) => ({ text })),
    };
  }

  if (req.tools && req.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: req.tools.map(openaiToolToGemini),
      },
    ];
  }

  if (req.tool_choice !== undefined) {
    const tc = openaiToolChoiceToGemini(req.tool_choice);
    if (tc) body.toolConfig = tc;
  }

  const generationConfig: NonNullable<GeminiRequestBody['generationConfig']> = {};
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.top_p !== undefined) generationConfig.topP = req.top_p;
  generationConfig.maxOutputTokens =
    req.max_tokens ?? opts.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  if (req.stop !== undefined) {
    generationConfig.stopSequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  void opts.model; // model goes in the URL, not the body — silence unused
  return body;
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

function appendOpenAIMessageToContents(m: OpenAIMessage, out: GeminiContent[]): void {
  switch (m.role) {
    case 'user': {
      const parts = userContentToGeminiParts(m.content);
      pushOrMerge(out, { role: 'user', parts });
      return;
    }
    case 'assistant': {
      const parts: GeminiPart[] = [];
      const text = stringifyTextContent(m.content ?? '');
      if (text.length > 0) parts.push({ text });
      if (m.tool_calls) {
        for (const call of m.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            args = { __raw: call.function.arguments };
          }
          parts.push({ functionCall: { name: call.function.name, args } });
        }
      }
      if (parts.length === 0) parts.push({ text: '' });
      pushOrMerge(out, { role: 'model', parts });
      return;
    }
    case 'tool': {
      // OpenAI sends per-call tool messages; Gemini wants them on a user-role
      // content as functionResponse parts. We need the *name* of the function
      // the call was for, but the OpenAI message only carries tool_call_id.
      // The agent's preceding assistant turn already declared the names; we
      // recover the name by walking back through `out` for the matching call.
      const name = findFunctionNameForCallId(out, m.tool_call_id) ?? 'unknown';
      const responseText = stringifyTextContent(m.content);
      const part: GeminiPart = {
        functionResponse: {
          name,
          response: { result: responseText },
        },
      };
      pushOrMerge(out, { role: 'user', parts: [part] });
      return;
    }
    case 'system':
      throw new Error('translate: system message leaked into conversation');
  }
}

function pushOrMerge(out: GeminiContent[], next: GeminiContent): void {
  const prev = out[out.length - 1];
  if (prev && prev.role === next.role) {
    prev.parts.push(...next.parts);
    return;
  }
  out.push(next);
}

function findFunctionNameForCallId(
  contents: GeminiContent[],
  _callId: string,
): string | undefined {
  // OpenAI's `tool_call_id` is opaque to Gemini; we don't carry it across.
  // The pragmatic fix: assume the most-recent functionCall in the prior
  // model turn is the one being responded to. Sufficient for single-tool
  // turns, which is the only path the ElevenLabs agent uses today.
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i]!;
    if (c.role !== 'model') continue;
    for (let j = c.parts.length - 1; j >= 0; j--) {
      const p = c.parts[j]!;
      if (p.functionCall) return p.functionCall.name;
    }
  }
  return undefined;
}

function userContentToGeminiParts(
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | {
            type: 'image_url';
            image_url: string | { url: string; detail?: 'auto' | 'low' | 'high' };
          }
      >,
): GeminiPart[] {
  if (typeof content === 'string') {
    return [{ text: content }];
  }
  const parts: GeminiPart[] = [];
  for (const item of content) {
    if (item.type === 'text') {
      parts.push({ text: item.text });
    } else if (item.type === 'image_url') {
      const url = typeof item.image_url === 'string' ? item.image_url : item.image_url.url;
      parts.push(imageUrlToGeminiPart(url));
    }
  }
  return parts;
}

function imageUrlToGeminiPart(url: string): GeminiPart {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([a-zA-Z]+\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (match) {
      const mimeType = match[1]!;
      const data = match[2]!;
      return { inlineData: { mimeType, data } };
    }
  }
  // Gemini supports fileData for https URIs but only when previously uploaded
  // via the Files API. For arbitrary public URLs we'd need a fetch-and-inline.
  // The desktop's vision tool always sends data: URIs, so this branch is
  // currently unused but kept for parity.
  return { fileData: { fileUri: url } };
}

// ───────────────────────── tools + tool_choice ─────────────────────────

function openaiToolToGemini(tool: OpenAITool): GeminiFunctionDeclaration {
  const params = tool.function.parameters;
  const out: GeminiFunctionDeclaration = { name: tool.function.name };
  if (tool.function.description) out.description = tool.function.description;
  if (params) out.parameters = sanitizeJsonSchema(params);
  return out;
}

/**
 * Gemini's function-declaration schema is a JSON Schema subset and rejects
 * unknown keywords (`$schema`, `additionalProperties`, etc.). We strip them
 * and recurse into nested object/array shapes.
 */
function sanitizeJsonSchema(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const allow = new Set([
    'type',
    'description',
    'enum',
    'properties',
    'items',
    'required',
    'nullable',
    'format',
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
  ]);
  for (const [k, v] of Object.entries(src)) {
    if (!allow.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        props[pk] = sanitizeJsonSchema(pv);
      }
      out[k] = props;
    } else if (k === 'items' && v && typeof v === 'object') {
      out[k] = sanitizeJsonSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function openaiToolChoiceToGemini(
  choice: OpenAIToolChoice,
): GeminiRequestBody['toolConfig'] | undefined {
  if (choice === 'auto') {
    return { functionCallingConfig: { mode: 'AUTO' } };
  }
  if (choice === 'required') {
    return { functionCallingConfig: { mode: 'ANY' } };
  }
  if (choice === 'none') {
    return { functionCallingConfig: { mode: 'NONE' } };
  }
  if (typeof choice === 'object' && choice.type === 'function') {
    return {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: [choice.function.name],
      },
    };
  }
  return undefined;
}
