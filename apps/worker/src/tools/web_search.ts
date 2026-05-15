/**
 * `web_search` — current-events answers via Gemini + Google Search grounding.
 *
 * No third-party search API. We hand the query to Gemini's `generateContent`
 * with the built-in `google_search` tool enabled: Gemini runs the searches,
 * reads the results, and returns a synthesised answer plus `groundingMetadata`
 * listing the web sources it used.
 *
 * Why this replaced Firecrawl: Firecrawl's `/v1/search` rate-limited a normal
 * voice session within a handful of calls (HTTP 429 → "unable to fetch the
 * news right now"), and it billed per scraped page. Google Search grounding
 * shares the GEMINI_API_KEY the rest of the worker already uses, has no extra
 * quota to exhaust, and returns an answer that's already shaped for the ear.
 *
 * Reference: https://ai.google.dev/gemini-api/docs/google-search
 */

/** Same Gemini Flash family the chat + vision paths use. */
const SEARCH_MODEL = 'gemini-2.5-flash';

/** Trim each source title we hand back for on-screen display. */
const TITLE_MAX_CHARS = 120;

const SYSTEM_PROMPT =
  "You are the web-search module of a voice-first assistant called Atlas. " +
  "Use Google Search to answer the user's query with current, factual information. " +
  "Reply in two to four short sentences meant to be read aloud — no markdown, " +
  "no bullet points, no URLs, no citations in the text. Lead with the single most " +
  "important fact. If it's a news query, give the top headlines in plain prose. " +
  "If the search turns up nothing useful, say so plainly.";

/** A grounding source Gemini used to answer. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  /** Synthesised, voice-ready answer — the agent reads this aloud. */
  answer: string;
  /** Web sources behind the answer — for on-screen display / artifacts. */
  results: SearchResult[];
}

export interface SearchInput {
  query: string;
  count?: number;
}

// Public name kept (and re-exported) for callers / tests across the Brave →
// Firecrawl → Gemini migrations. Stable surface beats churn.
export class BraveSearchError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message);
    this.name = 'BraveSearchError';
  }
}

interface GeminiGroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GeminiSearchResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: GeminiGroundingChunk[] };
    finishReason?: string;
  }>;
  modelVersion?: string;
  error?: { message?: string; code?: number; status?: string };
}

/**
 * Run a grounded web search. `apiKey` is the Gemini API key; the caller passes
 * it explicitly so this module is unit-testable without Cloudflare bindings.
 * `fetcher` defaults to global `fetch`; pass a stub in tests.
 */
export async function webSearch(
  apiKey: string,
  input: SearchInput,
  fetcher: typeof fetch = fetch,
): Promise<SearchResponse> {
  if (!input.query || input.query.trim().length === 0) {
    throw new BraveSearchError(400, 'query is required');
  }
  const limit = clampCount(input.count);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    SEARCH_MODEL,
  )}:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: input.query.trim() }] }],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    // The built-in grounding tool — Gemini decides what to search for.
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.3,
      // Headroom for Gemini's thinking-token budget so the visible answer
      // isn't truncated by `finishReason: "length"`.
      maxOutputTokens: 2048,
    },
  };

  let resp: Response;
  try {
    resp = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new BraveSearchError(502, `gemini search network: ${(err as Error).message}`);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new BraveSearchError(
      resp.status,
      `gemini search ${resp.status}: ${errText.slice(0, 200)}`,
      errText,
    );
  }

  const json = (await resp.json()) as GeminiSearchResponse;
  if (json.error) {
    throw new BraveSearchError(502, `gemini search: ${json.error.message ?? 'unknown error'}`);
  }

  const candidate = (json.candidates ?? [])[0];
  const answer = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!answer) {
    throw new BraveSearchError(502, 'gemini search returned no text');
  }

  // Map the grounding sources to our `results` shape for on-screen display.
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const ch of chunks) {
    const u = (ch.web?.uri ?? '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    results.push({
      title: clampTitle(ch.web?.title ?? u),
      url: u,
      snippet: '',
    });
    if (results.length >= limit) break;
  }

  return { answer, results };
}

function clampTitle(t: string): string {
  const s = t.trim();
  return s.length > TITLE_MAX_CHARS ? s.slice(0, TITLE_MAX_CHARS).trimEnd() + '…' : s;
}

function clampCount(input: number | undefined): number {
  const n = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 5;
  return Math.max(1, Math.min(10, n));
}
