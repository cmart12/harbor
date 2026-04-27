import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { webFetchHandler } from './web-fetch';

const originalFetch = globalThis.fetch;

function mockFetch(response: { ok: boolean; status?: number; statusText?: string; headers?: Record<string, string>; body?: string }) {
  const headers = new Map(Object.entries(response.headers || {}));
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.statusText ?? (response.ok ? 'OK' : 'Internal Server Error'),
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: vi.fn().mockResolvedValue(response.body ?? ''),
  });
}

describe('webFetchHandler', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns error for missing url', async () => {
    const result = await webFetchHandler({ url: '' });
    expect(result).toContain('Error');
  });

  it('returns error for invalid url', async () => {
    const result = await webFetchHandler({ url: 'not-a-url' });
    expect(result).toContain('Error: Invalid URL');
  });

  it('rejects non-http protocols', async () => {
    const result = await webFetchHandler({ url: 'ftp://example.com/file' });
    expect(result).toContain('Only http and https');
  });

  it('fetches plain text successfully', async () => {
    mockFetch({
      ok: true,
      headers: { 'content-type': 'text/plain' },
      body: 'Hello, world!',
    });

    const result = await webFetchHandler({ url: 'https://example.com/test.txt' });
    expect(result).toBe('Hello, world!');
  });

  it('extracts readable content from HTML', async () => {
    const html = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <nav>Navigation stuff</nav>
          <article>
            <h1>Test Page</h1>
            <p>This is the main content of the page with enough text to be considered readable content by the Readability algorithm. We need several sentences to make this work properly.</p>
            <p>Here is another paragraph with more content to help the algorithm identify this as the main article content of the page.</p>
            <p>And a third paragraph because Readability needs a certain amount of text to properly identify the main content area of the page.</p>
          </article>
          <footer>Footer stuff</footer>
        </body>
      </html>
    `;
    mockFetch({
      ok: true,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: html,
    });

    const result = await webFetchHandler({ url: 'https://example.com' });
    expect(result).toContain('main content');
    // Should not contain raw HTML tags
    expect(result).not.toContain('<article>');
  });

  it('returns raw HTML when raw=true', async () => {
    const html = '<html><body><p>Hello</p></body></html>';
    mockFetch({
      ok: true,
      headers: { 'content-type': 'text/html' },
      body: html,
    });

    const result = await webFetchHandler({ url: 'https://example.com', raw: true });
    expect(result).toContain('<p>Hello</p>');
  });

  it('truncates long responses', async () => {
    const longText = 'a'.repeat(1000);
    mockFetch({
      ok: true,
      headers: { 'content-type': 'text/plain' },
      body: longText,
    });

    const result = await webFetchHandler({ url: 'https://example.com/big', maxLength: 100 });
    expect(result.length).toBeLessThanOrEqual(125); // 100 + truncation message
    expect(result).toContain('[Content truncated]');
  });

  it('handles HTTP errors', async () => {
    mockFetch({ ok: false, status: 404, statusText: 'Not Found' });

    const result = await webFetchHandler({ url: 'https://example.com/missing' });
    expect(result).toBe('Error: HTTP 404 Not Found');
  });

  it('handles fetch failures', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await webFetchHandler({ url: 'https://example.com' });
    expect(result).toContain('Error: Network error');
  });

  it('handles timeout (AbortError)', async () => {
    const abortErr = new DOMException('The operation was aborted', 'AbortError');
    globalThis.fetch = vi.fn().mockRejectedValue(abortErr);

    const result = await webFetchHandler({ url: 'https://example.com' });
    expect(result).toContain('timed out');
  });

  it('rejects responses that are too large', async () => {
    mockFetch({
      ok: true,
      headers: { 'content-type': 'text/plain', 'content-length': '10000000' },
      body: '',
    });

    const result = await webFetchHandler({ url: 'https://example.com/huge' });
    expect(result).toContain('too large');
  });

  it('caps maxLength at 100000', async () => {
    const text = 'x'.repeat(200_000);
    mockFetch({
      ok: true,
      headers: { 'content-type': 'text/plain' },
      body: text,
    });

    const result = await webFetchHandler({ url: 'https://example.com', maxLength: 999_999 });
    // Should be capped at 100000 + truncation suffix
    expect(result.length).toBeLessThanOrEqual(100_025);
  });
});
