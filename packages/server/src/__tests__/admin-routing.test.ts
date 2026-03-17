import { describe, expect, it } from 'vitest';
import { resolveAdminFaviconTarget, resolveAdminRedirectTarget } from '../lib/admin-routing.js';

describe('admin routing redirects', () => {
  const adminOrigin = 'https://room-realtime-suite-admin.pages.dev';

  it('redirects worker root to the external admin origin', () => {
    expect(resolveAdminRedirectTarget('https://suite.example.workers.dev/', adminOrigin))
      .toBe('https://room-realtime-suite-admin.pages.dev/');
  });

  it('maps /admin deep links to root-based admin routes', () => {
    expect(
      resolveAdminRedirectTarget(
        'https://suite.example.workers.dev/admin/database/tables?limit=25',
        adminOrigin,
      ),
    ).toBe('https://room-realtime-suite-admin.pages.dev/database/tables?limit=25');
  });

  it('keeps favicon redirects on the external admin origin', () => {
    expect(resolveAdminFaviconTarget(adminOrigin))
      .toBe('https://room-realtime-suite-admin.pages.dev/favicon.svg');
  });

  it('returns null when external admin origin is not configured', () => {
    expect(resolveAdminRedirectTarget('https://suite.example.workers.dev/admin', undefined))
      .toBeNull();
    expect(resolveAdminFaviconTarget(undefined)).toBeNull();
  });
});
