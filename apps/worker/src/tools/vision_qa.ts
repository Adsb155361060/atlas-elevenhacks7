/**
 * Vision QA — Gemini reads an image and answers a question about it.
 *
 * The desktop captures the screen (or a webcam frame), uploads it as
 * multipart, and the Worker forwards it to Google Gemini's
 * `generateContent` endpoint as an inlineData image part.
 *
 * Why on the Worker, not the desktop direct: keeps the Gemini key off the
 * user's machine, gives us one place to add budget/limit/audit logic, and
 * matches the same auth pattern as our other cloud tools.
 *
 * Gemini vision reference:
 * https://ai.google.dev/gemini-api/docs/vision
 */

import type { Env } from '../env.js';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_MEDIA_TYPES = new Set<MediaType>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
type MediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const SYSTEM_PROMPT =
  "You are the vision module of a voice-first assistant called Atlas. The user has shared a screenshot or photo and asked a question. Answer in one or two short, factual sentences suitable to be read aloud. Don't read URLs, hashes, or long strings — describe them by category instead. If you can't see anything relevant, say so plainly.";

/** Same Gemini Flash family the chat path uses. Vision quality on 2.5 Flash
 *  is plenty for one-shot Q&A and the latency is well within voice
 *  expectations (~1s). */
const VISION_MODEL = 'gemini-2.5-flash';

// Public class name kept (and re-exported) for callers / tests. It's no
// longer specifically about Anthropic but stable surface beats churn.
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

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  modelVersion?: string;
  error?: { message?: string; code?: number; status?: string };
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
  if (!env.GEMINI_API_KEY) {
    throw new VisionQAError(
      500,
      'GEMINI_API_KEY not configured on worker — wrangler secret put',
    );
  }

  const base64 = bytesToBase64(input.image_bytes);

  // Non-streaming generateContent: vision Q&A is one short answer, no
  // need for SSE plumbing.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    VISION_MODEL,
  )}:generateContent`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: media, data: base64 } },
          { text: input.question.trim() },
        ],
      },
    ],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.2,
      // 2048 leaves headroom for Gemini's thinking-token budget so the
      // visible answer doesn't get cut off by `finishReason: "length"`.
      maxOutputTokens: 2048,
    },
  };

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new VisionQAError(502, `gemini vision network: ${(err as Error).message}`);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new VisionQAError(
      resp.status,
      `gemini vision ${resp.status}: ${errText.slice(0, 300)}`,
    );
  }

  const parsed = (await resp.json()) as GeminiGenerateResponse;
  if (parsed.error) {
    throw new VisionQAError(502, `gemini vision: ${parsed.error.message ?? 'unknown'}`);
  }

  const text = (parsed.candidates ?? [])
    .flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('\n')
    .trim();
  if (!text) {
    throw new VisionQAError(502, 'gemini returned no text');
  }
  return { answer: text, model: parsed.modelVersion ?? VISION_MODEL };
}

// ───────────────────────── helpers ─────────────────────────

function normaliseMediaType(input: string): MediaType {
  const lower = input.toLowerCase().trim();
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
