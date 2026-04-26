import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { LinkPreviewMeta } from '../../shared/types';

const linkPreviewCache = new Map<string, { meta: LinkPreviewMeta; ts: number }>();
const LINK_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchLinkPreview(urlStr: string): Promise<LinkPreviewMeta> {
  // Check cache
  const cached = linkPreviewCache.get(urlStr);
  if (cached && Date.now() - cached.ts < LINK_CACHE_TTL) {
    return cached.meta;
  }

  const result: LinkPreviewMeta = {
    url: urlStr,
    title: null,
    description: null,
    image: null,
    favicon: null,
  };

  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return result;
    }

    // Block private/local addresses
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
        hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
        hostname.startsWith('172.') || hostname.endsWith('.local')) {
      return result;
    }

    const html = await fetchUrl(urlStr, 8000, 100 * 1024); // 8s timeout, 100KB max
    if (!html) return result;

    // Extract OG meta tags
    result.title = extractMeta(html, 'og:title') || extractTitle(html);
    result.description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    result.image = extractMeta(html, 'og:image');
    result.favicon = `${parsed.protocol}//${parsed.host}/favicon.ico`;

    linkPreviewCache.set(urlStr, { meta: result, ts: Date.now() });
  } catch (err) {
    console.error('[link-preview] Fetch failed:', err);
  }

  return result;
}

function fetchUrl(urlStr: string, timeout: number, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.get(urlStr, { timeout, headers: { 'User-Agent': 'Intent-LinkPreview/1.0' } }, (res) => {
      // Follow one redirect
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        fetchUrl(res.headers.location, timeout, maxBytes).then(resolve);
        return;
      }

      if (res.statusCode !== 200) {
        req.destroy();
        resolve(null);
        return;
      }

      let data = '';
      let bytes = 0;
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) {
          res.destroy();
          return;
        }
        data += chunk;
      });
      res.on('end', () => resolve(data));
      res.on('error', () => resolve(null));
    });

    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function extractMeta(html: string, property: string): string | null {
  // Try og: property first, then name
  const ogRegex = new RegExp(`<meta[^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]+content=["']([^"']+)["']`, 'i');
  const match = ogRegex.exec(html);
  if (match) return match[1];

  // Try reversed attribute order
  const revRegex = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
  const revMatch = revRegex.exec(html);
  return revMatch ? revMatch[1] : null;
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match ? match[1].trim() : null;
}
