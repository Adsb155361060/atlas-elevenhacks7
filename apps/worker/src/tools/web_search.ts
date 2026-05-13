/**
 * Brave Search proxy. Translates `{query, count?}` to the Brave Web Search
 * API and normalises the response to our internal shape
 * `{results: [{title, url, snippet}]}`.
 *
 * Why a proxy and not direct from the agent: keeps the Brave subscription
 * key off the agent side (Conv-AI workspace), avoids per-deploy rotation
 * pain, and lets us layer caching + rate limits before the upstream call
 * when we need them.
 *
 * Reference: https://api.search.brave.com/app/documentation/web-search/get-started
 */

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
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
 * Call Brave Search. Caller passes the API key explicitly so this module
 * can be unit-tested without Cloudflare bindings.
 *
 * `fetcher` defaults to the global `fetch`; pass a stub in tests.
 */
export async function webSearch(
  apiKey: string,
  input: SearchInput,
  fetcher: typeof fetch = fetch,
): Promise<SearchResponse> {
  if (!input.query || input.query.trim().length === 0) {
    throw new BraveSearchError(400, 'query is required');
  }
  const count = clampCount(input.count);

  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set('q', input.query.trim());
  url.searchParams.set('count', String(count));
  // Safer defaults for a voice assistant: moderate safesearch, no
  // sensitive-content surfacing without explicit user opt-in.
  url.searchParams.set('safesearch', 'moderate');

  const resp = await fetcher(url.toString(), {
    headers: {
      accept: 'application/json',
      'accept-encoding': 'gzip',
      'x-subscription-token': apiKey,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new BraveSearchError(
      resp.status,
      `brave search ${resp.status}: ${body.slice(0, 200)}`,
      body,
    );
  }
  const json = (await resp.json()) as BraveResponse;
  const rawResults = json.web?.results ?? [];
  const results: SearchResult[] = rawResults.slice(0, count).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: (r.description ?? '').replace(/<\/?[^>]+>/g, '').trim(),
  }));
  return { results };
}

function clampCount(input: number | undefined): number {
  const n = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 5;
  return Math.max(1, Math.min(10, n));
}
