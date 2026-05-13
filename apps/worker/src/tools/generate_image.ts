/**
 * Gemini Imagen 3 proxy.
 *
 * `POST https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict`
 * returns base64-encoded PNG bytes. We wrap them in a `data:image/png;base64,…`
 * URI for the desktop's `<img>` renderer.
 *
 * Why Gemini Imagen (not OpenAI gpt-image-1 or DALL-E):
 * - The user already has `GEMINI_API_KEY` configured for Phase 11 fallback.
 * - Imagen 3 is fast (~3-5s) and produces high-quality PNGs.
 * - Free tier covers demo usage.
 */

const ENDPOINT_PREFIX =
  'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict';

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
