/**
 * Vision QA — Claude reads an image and answers a question about it.
 *
 * The desktop captures the screen (or in the future, a webcam frame),
 * uploads it as multipart, and the Worker forwards it to Anthropic's
 * Messages API as an image content block.
 *
 * Why on the Worker, not the desktop direct: keeps the Anthropic key off
 * the user's machine, gives us one place to add budget/limit/audit logic,
 * and matches the same auth pattern as our other cloud tools.
 *
 * Anthropic vision reference:
 * https://docs.anthropic.com/en/docs/build-with-claude/vision
 */

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '../claude/client.js';
import type { Env } from '../env.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — Anthropic's per-image cap; we enforce client-side too
const SUPPORTED_MEDIA_TYPES = new Set<MediaType>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
type MediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const SYSTEM_PROMPT =
  "You are the vision module of a voice-first assistant called Atlas. The user has shared a screenshot or photo and asked a question. Answer in one or two short, factual sentences suitable to be read aloud. Don't read URLs, hashes, or long strings — describe them by category instead. If you can't see anything relevant, say so plainly.";

export class VisionQAError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'VisionQAError';
  }
}

export interface VisionQAInput {
  question: string;
  image_bytes: Uint8Array;
  media_type: string;
}

export interface VisionQAResult {
  answer: string;
  model: string;
}

export async function visionQA(env: Env, input: VisionQAInput): Promise<VisionQAResult> {
  if (!input.question || input.question.trim().length === 0) {
    throw new VisionQAError(400, 'question is required');
  }
  if (input.image_bytes.length === 0) {
    throw new VisionQAError(400, 'image is empty');
  }
  if (input.image_bytes.length > MAX_IMAGE_BYTES) {
    throw new VisionQAError(
      413,
      `image too large: ${input.image_bytes.length} bytes > ${MAX_IMAGE_BYTES}`,
    );
  }
  const media = normaliseMediaType(input.media_type);
  if (!SUPPORTED_MEDIA_TYPES.has(media)) {
    throw new VisionQAError(
      415,
      `media_type '${input.media_type}' not supported; use png/jpeg/gif/webp`,
    );
  }

  const client = getAnthropicClient(env);
  const base64 = bytesToBase64(input.image_bytes);

  const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: env.DEFAULT_ANTHROPIC_MODEL,
    max_tokens: 512,
    temperature: 0.2,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: media,
              data: base64,
            },
          },
          {
            type: 'text',
            text: input.question.trim(),
          },
        ],
      },
    ],
  };

  let message: Anthropic.Messages.Message;
  try {
    message = await client.messages.create(params);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    throw new VisionQAError(
      status,
      `anthropic vision ${status}: ${(err as Error).message}`,
    );
  }

  const text = message.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) {
    throw new VisionQAError(502, 'anthropic returned no text');
  }
  return { answer: text, model: message.model };
}

// ───────────────────────── helpers ─────────────────────────

function normaliseMediaType(input: string): MediaType {
  const lower = input.toLowerCase().trim();
  // Strip optional charset suffix.
  const head = lower.split(';')[0]!.trim();
  if (head === 'image/jpg') return 'image/jpeg';
  return head as MediaType;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}
