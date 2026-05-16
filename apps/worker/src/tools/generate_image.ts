/**
 * Gemini Imagen proxy.
 *
 * `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:predict`
 * returns base64-encoded PNG bytes. We wrap them in a `data:image/png;base64,…`
 * URI for the desktop's `<img>` renderer.
 *
 * Model: `imagen-4.0-fast-generate-001` — chosen for voice-loop latency.
 * Standard `imagen-4.0-generate-001` and `imagen-4.0-ultra-generate-001` are
 * also available; fast trades a touch of quality for ~2s shorter wall time,
 * which matters when the agent is mid-conversation.
 *
 * Why Gemini Imagen (not OpenAI gpt-image-1 or DALL-E):
 * - GEMINI_API_KEY is already configured for the chat + vision paths.
 * - Free tier covers demo usage.
 *
 * History: this used to call `imagen-3.0-generate-002`; Google retired that
 * model on the v1beta endpoint (404 on every call) — replaced with Imagen 4.
 */

const IMAGE_MODEL = 'imagen-4.0-fast-generate-001';
const ENDPOINT_PREFIX = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:predict`;

export class ImageGenError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
    this.name = 'ImageGenError';
  }
}

export interface ImageGenInput {
  prompt: string;
  /** "1:1" | "16:9" | "9:16" | "3:4" | "4:3". Default "1:1". */
  aspect_ratio?: string;
  /** Imagen returns a single image per call by default; cap at 4. */
  count?: number;
}

export interface ImageGenResult {
  /** Array of `data:image/png;base64,<…>` URIs. */
  images: string[];
  prompt: string;
}

export async function generateImage(
  apiKey: string,
  input: ImageGenInput,
  fetcher: typeof fetch = fetch,
): Promise<ImageGenResult> {
  if (!input.prompt || input.prompt.trim().length === 0) {
    throw new ImageGenError(400, 'prompt is required');
  }
  const count = clampCount(input.count);
  const body = {
    instances: [{ prompt: input.prompt.trim() }],
    parameters: {
      sampleCount: count,
      aspectRatio: validAspect(input.aspect_ratio),
      safetyFilterLevel: 'block_only_high',
      personGeneration: 'allow_adult',
    },
  };

  const resp = await fetcher(`${ENDPOINT_PREFIX}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new ImageGenError(
      resp.status,
      `gemini imagen ${resp.status}: ${text.slice(0, 200)}`,
      text,
    );
  }
  const parsed = (await resp.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };
  const preds = parsed.predictions ?? [];
  if (preds.length === 0) {
    throw new ImageGenError(502, 'gemini imagen returned no predictions');
  }
  const images = preds
    .map((p) => {
      const data = p.bytesBase64Encoded;
      const mime = p.mimeType ?? 'image/png';
      return data ? `data:${mime};base64,${data}` : null;
    })
    .filter((x): x is string => x !== null);
  if (images.length === 0) {
    throw new ImageGenError(502, 'gemini imagen returned empty bytes');
  }
  return { images, prompt: input.prompt.trim() };
}

function clampCount(input: number | undefined): number {
  const n =
    typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 1;
  return Math.max(1, Math.min(4, n));
}

function validAspect(input: string | undefined): string {
  const allowed = ['1:1', '16:9', '9:16', '3:4', '4:3'];
  if (input && allowed.includes(input)) return input;
  return '1:1';
}
