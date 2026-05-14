/**
 * Firecrawl `/v1/search` proxy. Translates `{query, count?}` to Firecrawl's
 * search endpoint (which both *searches* and *scrapes* the top N hits in one
 * call) and normalises the response to our internal shape:
 *   `{results: [{title, url, snippet}]}`.
 *
 * Why Firecrawl over a plain search API:
 *   • One round-trip gets us both the SERP and the cleaned-up page content
 *     for each result (we'd otherwise have to do search → fetch each → strip).
 *   • Snippets become real summarisable chunks of the article rather than
 *     two-line SERP descriptions, which gives the agent meaningfully better
 *     context to ground its answer in.
 *
 * Reference: https://docs.firecrawl.dev/api-reference/endpoint/search
 */

const FIRECRAWL_SEARCH_ENDPOINT = 'https://api.firecrawl.dev/v1/search';

/** How much of each scraped page we feed back to the agent. Firecrawl can
 *  return tens of kilobytes per result; the conversational LLM doesn't need
 *  that much, and a long prompt hurts latency for a voice loop. 600 chars
 *  is roughly a tight paragraph — enough for grounded answers without
 *  pushing the post-tool LLM call past ElevenLabs's orchestrator timeout
 *  on top of however many tool calls Gemini decides to chain. */
const SNIPPET_MAX_CHARS = 600;

interface FirecrawlSearchResult {
  title?: string;
  url?: string;
  description?: string;
  markdown?: string;
  content?: string;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  data?: FirecrawlSearchResult[];
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface SearchInput {
  query: string;
  count?: number;
}

// Public name kept (and re-exported) for callers / tests. It's no longer
// strictly a Brave error, but stable surface beats churn.
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

/**
 * Call Firecrawl Search. `apiKey` is the Firecrawl bearer token; the caller
 * passes it explicitly so this module can be unit-tested without Cloudflare
 * bindings. `fetcher` defaults to the global `fetch`; pass a stub in tests.
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

  const resp = await fetcher(FIRECRAWL_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: input.query.trim(),
      limit,
      scrapeOptions: { formats: ['markdown'] },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new BraveSearchError(
      resp.status,
      `firecrawl search ${resp.status}: ${body.slice(0, 200)}`,
      body,
    );
  }
  const json = (await resp.json()) as FirecrawlSearchResponse;
  if (json.success === false) {
    throw new BraveSearchError(
      502,
      `firecrawl search reported failure: ${json.error ?? 'unknown error'}`,
    );
  }
  const raw = Array.isArray(json.data) ? json.data : [];
  const results: SearchResult[] = raw.slice(0, limit).map((r) => ({
    title: (r.title ?? '').trim(),
    url: (r.url ?? '').trim(),
    snippet: extractSnippet(r),
  }));
  return { results };
}

function extractSnippet(r: FirecrawlSearchResult): string {
  // Prefer the scraped page content (cleaned markdown) over the SERP
  // description — agents do meaningfully better with article body text.
  const md = (r.markdown ?? r.content ?? '').trim();
  if (md.length > 0) {
    return md.length > SNIPPET_MAX_CHARS
      ? md.slice(0, SNIPPET_MAX_CHARS).trimEnd() + '…'
      : md;
  }
  return (r.description ?? '').replace(/<\/?[^>]+>/g, '').trim();
}

function clampCount(input: number | undefined): number {
  const n = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 5;
  return Math.max(1, Math.min(10, n));
}
