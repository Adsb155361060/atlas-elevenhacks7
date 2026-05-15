import { describe, expect, it } from 'vitest';
import { BraveSearchError, webSearch } from '../src/tools/web_search.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A minimal Gemini `generateContent` response with grounding metadata. */
function geminiResponse(text: string, sources: Array<{ uri: string; title?: string }>) {
  return jsonResponse({
    candidates: [
      {
        content: { parts: [{ text }] },
        groundingMetadata: {
          groundingChunks: sources.map((s) => ({ web: s })),
        },
        finishReason: 'STOP',
      },
    ],
    modelVersion: 'gemini-2.5-flash',
  });
}

describe('webSearch (Gemini + Google Search grounding)', () => {
  it('POSTs to Gemini generateContent with the google_search tool and x-goog-api-key', async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input.toString()).toContain(
        '/v1beta/models/gemini-2.5-flash:generateContent',
      );
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers ?? {});
      expect(headers.get('x-goog-api-key')).toBe('test-key');
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.tools).toEqual([{ google_search: {} }]);
      expect(body.contents[0].parts[0].text).toBe('latest news');
      return geminiResponse('Top story today: markets rose two percent.', [
        { uri: 'https://news.example.com/markets', title: 'Markets rise' },
      ]);
    };

    const result = await webSearch('test-key', { query: 'latest news' }, fetcher);
    expect(result.answer).toBe('Top story today: markets rose two percent.');
    expect(result.results).toEqual([
      { title: 'Markets rise', url: 'https://news.example.com/markets', snippet: '' },
    ]);
  });

  it('joins multi-part answers and dedupes grounding sources', async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'Part one. ' }, { text: 'Part two.' }] },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://a.com', title: 'A' } },
                { web: { uri: 'https://a.com', title: 'A dup' } },
                { web: { uri: 'https://b.com', title: 'B' } },
              ],
            },
          },
        ],
      });
    const result = await webSearch('k', { query: 'q' }, fetcher);
    expect(result.answer).toBe('Part one. Part two.');
    expect(result.results.map((r) => r.url)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('clamps the number of sources returned to count [1, 10]', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      uri: `https://x/${i}`,
      title: `r${i}`,
    }));
    const fetcher: typeof fetch = async () => geminiResponse('answer', many);
    const three = await webSearch('k', { query: 'q', count: 3 }, fetcher);
    expect(three.results).toHaveLength(3);
    const clampedHigh = await webSearch('k', { query: 'q', count: 50 }, fetcher);
    expect(clampedHigh.results).toHaveLength(10);
  });

  it('tolerates an answer with no grounding sources', async () => {
    const fetcher: typeof fetch = async () => geminiResponse('A plain answer.', []);
    const result = await webSearch('k', { query: 'q' }, fetcher);
    expect(result.answer).toBe('A plain answer.');
    expect(result.results).toEqual([]);
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

  it('throws when Gemini returns an error object', async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({ error: { message: 'quota exceeded', code: 429 } });
    await expect(webSearch('k', { query: 'q' }, fetcher)).rejects.toMatchObject({
      name: 'BraveSearchError',
      status: 502,
    });
  });

  it('throws when Gemini returns no text', async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({ candidates: [{ content: { parts: [] } }] });
    await expect(webSearch('k', { query: 'q' }, fetcher)).rejects.toMatchObject({
      name: 'BraveSearchError',
      status: 502,
    });
  });
});
