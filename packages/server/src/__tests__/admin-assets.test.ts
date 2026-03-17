import { describe, it, expect } from 'vitest';
import {
  createAdminAssetRequest,
  createHarnessAssetRequest,
  resolveAdminAssetPath,
  resolveHarnessAssetPath,
} from '../lib/admin-assets.js';

describe('admin asset path resolution', () => {
  it('serves index for the admin root', () => {
    expect(resolveAdminAssetPath('/admin')).toBe('/');
    expect(resolveAdminAssetPath('/admin/')).toBe('/');
  });

  it('strips the /admin prefix for built assets', () => {
    expect(resolveAdminAssetPath('/admin/_app/version.json')).toBe('/_app/version.json');
    expect(resolveAdminAssetPath('/admin/favicon.png')).toBe('/favicon.png');
  });

  it('falls back to index for client-side admin routes', () => {
    expect(resolveAdminAssetPath('/admin/login')).toBe('/');
    expect(resolveAdminAssetPath('/admin/database/tables')).toBe('/');
  });

  it('rewrites requests without dropping the query string', () => {
    const request = new Request('http://localhost:8787/admin/login?next=%2Fadmin%2Fdatabase');
    const rewritten = createAdminAssetRequest(request);
    const url = new URL(rewritten.url);

    expect(url.pathname).toBe('/');
    expect(url.search).toBe('?next=%2Fadmin%2Fdatabase');
  });
});

describe('harness asset path resolution', () => {
  it('serves index for the harness root and client-side routes', () => {
    expect(resolveHarnessAssetPath('/harness')).toBe('/harness.html');
    expect(resolveHarnessAssetPath('/harness/')).toBe('/harness.html');
    expect(resolveHarnessAssetPath('/harness/scenarios/registered')).toBe('/harness.html');
  });

  it('preserves explicit asset paths under /harness', () => {
    expect(resolveHarnessAssetPath('/harness/assets/main.js')).toBe('/harness/assets/main.js');
    expect(resolveHarnessAssetPath('/harness/favicon.svg')).toBe('/harness/favicon.svg');
  });

  it('rewrites harness requests without dropping the query string', () => {
    const request = new Request('http://localhost:8787/harness/scenarios?mode=golden');
    const rewritten = createHarnessAssetRequest(request);
    const url = new URL(rewritten.url);

    expect(url.pathname).toBe('/harness.html');
    expect(url.search).toBe('?mode=golden');
  });
});
