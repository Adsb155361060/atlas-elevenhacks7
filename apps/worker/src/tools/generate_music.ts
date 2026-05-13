/**
 * ElevenLabs Music API proxy.
 *
 * `POST https://api.elevenlabs.io/v1/music` returns a binary MP3. Tool callers
 * expect JSON, so we base64-encode the MP3 into a `data:audio/mpeg;base64,…`
 * URI the desktop can drop straight into an `<audio>` element.
 *
 * Reference: https://elevenlabs.io/docs/api-reference/music/compose
 */

const ENDPOINT = 'https://api.elevenlabs.io/v1/music';
const MAX_DURATION_MS = 180_000; // 3 minutes; protect against runaway generation cost
const MIN_DURATION_MS = 5_000;

export class MusicGenError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
    this.name = 'MusicGenError';
  }
}

export interface MusicGenInput {
  prompt: string;
  /** ~ms; clamped to [5_000, 180_000]. Default 30s. */
  duration_ms?: number;
  /** ElevenLabs flag — forbid lyrics when you only want an instrumental backing. */
  instrumental?: boolean;
}

export interface MusicGenResult {
  /** `data:audio/mpeg;base64,<…>` — pluggable into HTML `<audio src>`. */
  audio_data_uri: string;
  duration_ms: number;
  prompt: string;
}

export async function generateMusic(
  apiKey: string,
  input: MusicGenInput,
  fetcher: typeof fetch = fetch,
): Promise<MusicGenResult> {
  if (!input.prompt || input.prompt.trim().length === 0) {
    throw new MusicGenError(400, 'prompt is required');
  }
  const duration = clampDuration(input.duration_ms);
  const body = {
    prompt: input.prompt.trim(),
    music_length_ms: duration,
    model_id: 'music_v1',
    force_instrumental: input.instrumental ?? false,
  };

  const resp = await fetcher(`${ENDPOINT}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new MusicGenError(
      resp.status,
      `elevenlabs music ${resp.status}: ${text.slice(0, 200)}`,
      text,
    );
  }
  const buf = new Uint8Array(await resp.arrayBuffer());
  const base64 = bytesToBase64(buf);
  return {
    audio_data_uri: `data:audio/mpeg;base64,${base64}`,
    duration_ms: duration,
    prompt: body.prompt,
  };
}

function clampDuration(input: number | undefined): number {
  const n =
    typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 30_000;
  return Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, n));
}

/**
 * Base64-encode raw bytes without ever materialising the whole buffer as a
 * string of chars (that's what `String.fromCharCode(...bytes)` does and it
 * blows the stack at ~125k samples). Chunked variant works for arbitrarily
 * large MP3s.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}
