import { describe, expect, it } from 'vitest';
import { BraveSearchError, webSearch } from '../src/tools/web_search.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('webSearch (Firecrawl backend)', () => {
  it('POSTs to /v1/search with bearer auth + scrape options, normalises to {title, url, snippet}', async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toBe('https://api.firecrawl.dev/v1/search');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers ?? {});
      expect(headers.get('authorization')).toBe('Bearer test-key');
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body).toMatchObject({
        query: 'lagos population',
        limit: 5,
        scrapeOptions: { formats: ['markdown'] },
      });
      return jsonResponse({
        success: true,
        data: [
          {
            title: 'Lagos - Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Lagos',
            markdown: 'Lagos is the largest city in Nigeria.\n\nIt has X people.',
          },
          {
            title: 'Population Stats',
            url: 'https://example.com/lagos',
            description: 'Estimated 24 million metro.',
          },
        ],
      });
    };

    const result = await webSearch('test-key', { query: 'lagos population' }, fetcher);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      title: 'Lagos - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Lagos',
      // Markdown content preferred over the SERP description.
      snippet: 'Lagos is the largest city in Nigeria.\n\nIt has X people.',
    });
    // Falls back to description when markdown is absent.
    expect(result.results[1]?.snippet).toBe('Estimated 24 million metro.');
  });

  it('clamps count to [1, 10]', async () => {
    let captured: number | undefined;
    const capture: typeof fetch = async (_input, init) => {
      captured = JSON.parse(String(init?.body ?? '{}')).limit;
      return jsonResponse({ success: true, data: [] });
    };
    await webSearch('k', { query: 'q', count: 50 }, capture);
    expect(captured).toBe(10);
    await webSearch('k', { query: 'q', count: 0 }, capture);
    expect(captured).toBe(1);
  });

  it('clips results to requested count even if upstream returns more', async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({
        success: true,
        data: Array.from({ length: 8 }, (_, i) => ({
          title: `r${i}`,
          url: `https://x/${i}`,
          markdown: `s${i}`,
        })),
      });
    const result = await webSearch('k', { query: 'x', count: 3 }, fetcher);
    expect(result.results).toHaveLength(3);
  });

  it('truncates very long markdown snippets', async () => {
    const big = 'a'.repeat(5000);
    const fetcher: typeof fetch = async () =>
      jsonResponse({
        success: true,
        data: [{ title: 't', url: 'https://x', markdown: big }],
      });
    const result = await webSearch('k', { query: 'x' }, fetcher);
    const snippet = result.results[0]?.snippet ?? '';
    expect(snippet.length).toBeLessThanOrEqual(1501); // 1500 + ellipsis char
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('strips simple HTML tags from fallback descriptions', async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({
        success: true,
        data: [
          {
            title: 't',
            url: 'https://x',
            description: 'a <b>bold</b> and <em>emphatic</em> result',
          },
        ],
      });
    const result = await webSearch('k', { query: 'x' }, fetcher);
    expect(result.results[0]?.snippet).toBe('a bold and emphatic result');
  });

  it('rejects empty query', async () => {
    const fetcher: typeof fetch = async () => jsonResponse({});
    await expect(webSearch('k', { query: '' }, fetcher)).rejects.toBeInstanceOf(BraveSearchError);
    await expect(webSearch('k', { query: '   ' }, fetcher)).rejects.toBeInstanceOf(BraveSearchError);
  });

  it('throws BraveSearchError on non-200', async () => {
    const fetcher: typeof fetch = async () => new Response('rate limited', { status: 429 });
    await expect(webSearch('k', { query: 'q' }, fetcher)).rejects.toMatchObject({
      name: 'BraveSearchError',
      status: 429,
    });
  });

  it('throws when upstream reports success=false', async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({ success: false, error: 'over quota' });
    await expect(webSearch('k', { query: 'q' }, fetcher)).rejects.toMatchObject({
      name: 'BraveSearchError',
      status: 502,
    });
  });

  it('handles missing data array gracefully', async () => {
    const fetcher: typeof fetch = async () => jsonResponse({ success: true });
    const result = await webSearch('k', { query: 'q' }, fetcher);
    expect(result.results).toEqual([]);
  });
});
