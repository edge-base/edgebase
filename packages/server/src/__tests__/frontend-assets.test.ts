import { describe, expect, it } from 'vitest';
import {
  applyFrontendAssetHeaders,
  createFrontendAssetRequest,
  resolveFrontendAssetPath,
} from '../lib/frontend-assets.js';

describe('frontend asset path resolution', () => {
  it('serves index.html for the root mount path', () => {
    expect(resolveFrontendAssetPath('/', { mountPath: '/' })).toBe('/index.html');
  });

  it('serves index.html for custom mount roots', () => {
    expect(resolveFrontendAssetPath('/app', { mountPath: '/app' })).toBe('/app/index.html');
    expect(resolveFrontendAssetPath('/app/', { mountPath: '/app' })).toBe('/app/index.html');
  });

  it('keeps explicit asset paths intact', () => {
    expect(resolveFrontendAssetPath('/assets/main.js', { mountPath: '/' })).toBe('/assets/main.js');
    expect(resolveFrontendAssetPath('/app/assets/main.js', { mountPath: '/app' })).toBe('/app/assets/main.js');
  });

  it('falls back to index.html only for HTML navigation when enabled', () => {
    expect(resolveFrontendAssetPath('/dashboard/settings', {
      mountPath: '/',
      spaFallback: true,
      method: 'GET',
      accept: 'text/html,application/xhtml+xml',
    })).toBe('/index.html');

    expect(resolveFrontendAssetPath('/dashboard/settings', {
      mountPath: '/',
      spaFallback: true,
      method: 'GET',
      accept: 'application/json',
    })).toBe('/dashboard/settings');
  });

  it('returns null outside the configured mount path', () => {
    expect(resolveFrontendAssetPath('/dashboard', { mountPath: '/app' })).toBeNull();
  });

  it('rewrites requests without dropping the query string', () => {
    const request = new Request('http://localhost:8787/app/dashboard?tab=settings', {
      headers: { accept: 'text/html' },
    });
    const rewritten = createFrontendAssetRequest(request, {
      directory: './web/dist',
      mountPath: '/app',
      spaFallback: true,
    });
    const url = new URL(rewritten!.url);

    expect(url.pathname).toBe('/app/index.html');
    expect(url.search).toBe('?tab=settings');
  });
});

describe('frontend cache headers', () => {
  it('marks html and PWA entry files as no-cache', () => {
    const response = applyFrontendAssetHeaders(new Response('ok'), '/index.html');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');

    const manifest = applyFrontendAssetHeaders(new Response('ok'), '/manifest.webmanifest');
    expect(manifest.headers.get('Cache-Control')).toBe('no-cache');

    const worker = applyFrontendAssetHeaders(new Response('ok'), '/sw.js');
    expect(worker.headers.get('Cache-Control')).toBe('no-cache');

    // The generic hashed-filename heuristic would otherwise mistake the
    // eight-letter word "precache" for a content hash and cache this mutable,
    // unversioned update manifest as immutable for one year.
    const precache = applyFrontendAssetHeaders(new Response('ok'), '/sw-precache.json');
    expect(precache.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('marks hashed assets as immutable and unhashed assets as short-lived', () => {
    const hashed = applyFrontendAssetHeaders(new Response('ok'), '/assets/app-abc123def456.js');
    expect(hashed.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    const viteHash = applyFrontendAssetHeaders(new Response('ok'), '/assets/index-BwbIofh5.js');
    expect(viteHash.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    const urlSafeHash = applyFrontendAssetHeaders(new Response('ok'), '/assets/chunk-9WSbeU9-.css');
    expect(urlSafeHash.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');

    const plain = applyFrontendAssetHeaders(new Response('ok'), '/favicon.ico');
    expect(plain.headers.get('Cache-Control')).toBe('public, max-age=300');

    for (const name of ['site-precache.json', 'site-configuration.json', 'site-version2026.json']) {
      const metadata = applyFrontendAssetHeaders(new Response('ok'), `/assets/${name}`);
      expect(metadata.headers.get('Cache-Control')).toBe('public, max-age=300');
    }
  });

  it('applies configured security headers without dropping cache policy', () => {
    const response = applyFrontendAssetHeaders(
      new Response('ok'),
      '/index.html',
      {
        'Content-Security-Policy': "default-src 'self'",
        'X-Frame-Options': 'DENY',
      },
    );

    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
