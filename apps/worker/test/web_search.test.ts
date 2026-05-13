import { describe, expect, it } from 'vitest';
import { BraveSearchError, webSearch } from '../src/tools/web_search.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('webSearch', () => {
  it('normalizes Brave response into {title, url, snippet}', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get('q')).toBe('lagos population');
      expect(url.searchParams.get('count')).toBe('5');
      return jsonResponse({
        web: {
          results: [
            {
              title: 'Lagos - Wikipedia',
              url: 'https://en.wikipedia.org/wiki/Lagos',
              description: '<b>Lagos</b> is the largest city in Nigeria.',
            },
            {
              title: 'Population Stats',
              url: 'https://example.com/lagos',
              description: 'Estimated 24 million metro.',
            },
          ],
        },
      });
    };

    const result = await webSearch('test-key', { query: 'lagos population' }, fetcher);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({
      title: 'Lagos - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Lagos',
      snippet: 'Lagos is the largest city in Nigeria.',
    });
  });

  it('clamps count to [1, 10]', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get('count')).toBe('10');
      return jsonResponse({ web: { results: [] } });
    };
    await webSearch('k', { query: 'q', count: 50 }, fetcher);

    const fetcher2 = async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get('count')).toBe('1');
      return jsonResponse({ web: { results: [] } });
    };
    await webSearch('k', { query: 'q', count: 0 }, fetcher2);
  });

  it('clips results to requested count even if Brave returns more', async () => {
    const fetcher = async () =>
      jsonResponse({
        web: {
          results: Array.from({ length: 8 }, (_, i) => ({
            title: `r${i}`,
            url: `https://x/${i}`,
            description: `s${i}`,
          })),
        },
      });
    const result = await webSearch('k', { query: 'x', count: 3 }, fetcher);
    expect(result.results).toHaveLength(3);
  });

  it('strips simple HTML tags from snippets', async () => {
    const fetcher = async () =>
      jsonResponse({
        web: {
          results: [
            {
              title: 't',
              url: 'https://x',
              description: 'a <b>bold</b> and <em>emphatic</em> result',
            },
          ],
        },
      });
    const result = await webSearch('k', { query: 'x' }, fetcher);
    expect(result.results[0]?.snippet).toBe('a bold and emphatic result');
  });

  it('rejects empty query', async () => {
    const fetcher = async () => jsonResponse({});
    await expect(webSearch('k', { query: '' }, fetcher)).rejects.toBeInstanceOf(BraveSearchError);
    await expect(webSearch('k', { query: '   ' }, fetcher)).rejects.toBeInstanceOf(BraveSearchError);
  });

  it('throws BraveSearchError on non-200', async () => {
    const fetcher = async () => new Response('rate limited', { status: 429 });
    await expect(webSearch('k', { query: 'q' }, fetcher)).rejects.toMatchObject({
      name: 'BraveSearchError',
      status: 429,
    });
  });

  it('handles missing web.results gracefully', async () => {
    const fetcher = async () => jsonResponse({});
    const result = await webSearch('k', { query: 'q' }, fetcher);
    expect(result.results).toEqual([]);
  });
});
