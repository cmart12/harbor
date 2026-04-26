import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock for http/https ─────────────────────────
const { mockGet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
}));

vi.mock('https', () => ({ get: mockGet }));
vi.mock('http', () => ({ get: mockGet }));

import { fetchLinkPreview } from './link-preview';

// Helper to simulate an HTTP response
function simulateResponse(body: string, statusCode = 200) {
  mockGet.mockImplementation((_url: string, _opts: any, cb: Function) => {
    const res = {
      statusCode,
      headers: {},
      setEncoding: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'data') handler(body);
        if (event === 'end') handler();
      }),
      destroy: vi.fn(),
    };
    cb(res);
    return {
      on: vi.fn(),
      destroy: vi.fn(),
    };
  });
}

function simulateError() {
  mockGet.mockImplementation((_url: string, _opts: any, _cb: Function) => {
    const req = {
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'error') handler(new Error('network error'));
      }),
      destroy: vi.fn(),
    };
    return req;
  });
}

describe('fetchLinkPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the module-level cache between tests by re-importing would be complex,
    // so we use unique URLs for cache tests.
  });

  it('returns empty result for non-HTTP URL', async () => {
    const result = await fetchLinkPreview('ftp://example.com/file');

    expect(result.url).toBe('ftp://example.com/file');
    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
    expect(result.image).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns empty result for mailto URL', async () => {
    const result = await fetchLinkPreview('mailto:user@example.com');

    expect(result.title).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  describe('blocks private/local addresses', () => {
    it.each([
      'http://localhost/page',
      'http://127.0.0.1/page',
      'http://192.168.1.1/page',
      'http://10.0.0.1/page',
      'http://myhost.local/page',
    ])('blocks %s', async (url) => {
      const result = await fetchLinkPreview(url);

      expect(result.title).toBeNull();
      expect(result.description).toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  it('extracts OG title, description, and image', async () => {
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Test Page" />
          <meta property="og:description" content="A test description" />
          <meta property="og:image" content="https://example.com/img.jpg" />
        </head>
        <body></body>
      </html>
    `;
    simulateResponse(html);

    const result = await fetchLinkPreview('https://unique-og-test.example.com/page');

    expect(result.title).toBe('Test Page');
    expect(result.description).toBe('A test description');
    expect(result.image).toBe('https://example.com/img.jpg');
    expect(result.favicon).toBe('https://unique-og-test.example.com/favicon.ico');
  });

  it('falls back to <title> tag when og:title is missing', async () => {
    const html = `
      <html>
        <head><title>Fallback Title</title></head>
        <body></body>
      </html>
    `;
    simulateResponse(html);

    const result = await fetchLinkPreview('https://unique-title-test.example.com/page');

    expect(result.title).toBe('Fallback Title');
  });

  it('falls back to meta name="description" when og:description is missing', async () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Meta description" />
        </head>
        <body></body>
      </html>
    `;
    simulateResponse(html);

    const result = await fetchLinkPreview('https://unique-metadesc-test.example.com/page');

    expect(result.description).toBe('Meta description');
  });

  it('caches results on second call', async () => {
    const html = `<html><head><title>Cached Page</title></head></html>`;
    simulateResponse(html);

    const url = 'https://unique-cache-test.example.com/cached';
    const first = await fetchLinkPreview(url);
    const second = await fetchLinkPreview(url);

    expect(first.title).toBe('Cached Page');
    expect(second.title).toBe('Cached Page');
    // HTTP should only be called once — second call hits cache
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('returns empty result on fetch error', async () => {
    simulateError();

    const result = await fetchLinkPreview('https://unique-error-test.example.com/fail');

    expect(result.title).toBeNull();
    expect(result.description).toBeNull();
  });

  it('returns empty result for non-200 status', async () => {
    simulateResponse('', 404);

    const result = await fetchLinkPreview('https://unique-404-test.example.com/missing');

    expect(result.title).toBeNull();
  });
});
