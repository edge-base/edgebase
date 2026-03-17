/**
 * Unit tests for lib/oauth-providers.ts
 *
 * Covers parseOIDCIdToken (pure JWT decode) and prefetchOIDCDiscovery (fetch mock).
 * Also tests parseAppleIdToken, isSupportedProvider, getOAuthProviderConfig, getAllowedOAuthProviders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseOIDCIdToken,
  prefetchOIDCDiscovery,
  parseAppleIdToken,
  isSupportedProvider,
  getOAuthProviderConfig,
  getAllowedOAuthProviders,
} from '../lib/oauth-providers.js';

// ─── Helpers ───

/** Create a fake JWT with given payload (no signature verification needed) */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const sig = 'fake-signature';
  return `${header}.${body}.${sig}`;
}

/** Create a fake JWT using base64url (with - and _ instead of + and /) */
function fakeJwtUrl(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = 'fake-signature';
  return `${header}.${body}.${sig}`;
}

// ─── parseOIDCIdToken ───

describe('parseOIDCIdToken', () => {
  it('decodes a valid JWT payload', () => {
    const token = fakeJwt({
      sub: 'user-123',
      email: 'test@example.com',
      email_verified: true,
      name: 'Test User',
      picture: 'https://example.com/avatar.png',
    });
    const result = parseOIDCIdToken(token);

    expect(result.providerUserId).toBe('user-123');
    expect(result.email).toBe('test@example.com');
    expect(result.emailVerified).toBe(true);
    expect(result.displayName).toBe('Test User');
    expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.raw.sub).toBe('user-123');
  });

  it('falls back to preferred_username when name is absent', () => {
    const token = fakeJwt({
      sub: 'u-456',
      preferred_username: 'jdoe',
    });
    const result = parseOIDCIdToken(token);
    expect(result.displayName).toBe('jdoe');
  });

  it('returns null for missing optional fields', () => {
    const token = fakeJwt({ sub: 'u-789' });
    const result = parseOIDCIdToken(token);

    expect(result.providerUserId).toBe('u-789');
    expect(result.email).toBeNull();
    expect(result.emailVerified).toBe(false);
    expect(result.displayName).toBeNull();
    expect(result.avatarUrl).toBeNull();
  });

  it('handles base64url encoded tokens (- and _ chars)', () => {
    const token = fakeJwtUrl({
      sub: 'url-user',
      email: 'url@test.com',
      email_verified: true,
    });
    const result = parseOIDCIdToken(token);
    expect(result.providerUserId).toBe('url-user');
    expect(result.email).toBe('url@test.com');
  });

  it('throws on invalid token (not 3 parts)', () => {
    expect(() => parseOIDCIdToken('only-two.parts')).toThrow('Invalid OIDC id_token');
    expect(() => parseOIDCIdToken('')).toThrow('Invalid OIDC id_token');
    expect(() => parseOIDCIdToken('a.b.c.d')).toThrow('Invalid OIDC id_token');
  });

  it('preserves raw payload with all original fields', () => {
    const token = fakeJwt({
      sub: 'u1',
      iss: 'https://issuer.example.com',
      aud: 'client-id',
      exp: 1234567890,
      custom_field: 'custom_value',
    });
    const result = parseOIDCIdToken(token);
    expect(result.raw.iss).toBe('https://issuer.example.com');
    expect(result.raw.custom_field).toBe('custom_value');
  });
});

// ─── prefetchOIDCDiscovery ───

describe('prefetchOIDCDiscovery', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Clear the module-level discovery cache by importing fresh
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches .well-known/openid-configuration from issuer', async () => {
    const mockDiscovery = {
      authorization_endpoint: 'https://issuer.example.com/authorize',
      token_endpoint: 'https://issuer.example.com/token',
      userinfo_endpoint: 'https://issuer.example.com/userinfo',
      issuer: 'https://issuer.example.com',
    };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(mockDiscovery), { status: 200 }),
    );

    // Should not throw
    await prefetchOIDCDiscovery('https://issuer.example.com');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://issuer.example.com/.well-known/openid-configuration',
      { headers: { Accept: 'application/json' } },
    );
  });

  it('strips trailing slash from issuer URL', async () => {
    const mockDiscovery = {
      authorization_endpoint: 'https://issuer.example.com/authorize',
      token_endpoint: 'https://issuer.example.com/token',
      issuer: 'https://issuer.example.com',
    };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(mockDiscovery), { status: 200 }),
    );

    await prefetchOIDCDiscovery('https://issuer.example.com/');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://issuer.example.com/.well-known/openid-configuration',
      expect.any(Object),
    );
  });

  it('throws on non-OK response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    );

    await expect(
      prefetchOIDCDiscovery('https://bad-issuer.example.com'),
    ).rejects.toThrow('OIDC discovery failed');
  });

  it('throws when discovery doc is missing required endpoints', async () => {
    const incomplete = { issuer: 'https://issuer.example.com' };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(incomplete), { status: 200 }),
    );

    await expect(
      prefetchOIDCDiscovery('https://incomplete.example.com'),
    ).rejects.toThrow('missing required endpoints');
  });
});

// ─── parseAppleIdToken ───

describe('parseAppleIdToken', () => {
  it('decodes Apple JWT payload', () => {
    const token = fakeJwt({
      sub: 'apple-user-001',
      email: 'apple@privaterelay.appleid.com',
      email_verified: true,
    });
    const result = parseAppleIdToken(token);

    expect(result.providerUserId).toBe('apple-user-001');
    expect(result.email).toBe('apple@privaterelay.appleid.com');
    expect(result.emailVerified).toBe(true);
    expect(result.displayName).toBeNull(); // Apple sends name only on first sign-in
    expect(result.avatarUrl).toBeNull();
  });

  it('throws on invalid token', () => {
    expect(() => parseAppleIdToken('invalid')).toThrow('Invalid Apple id_token');
  });
});

// ─── isSupportedProvider ───

describe('isSupportedProvider', () => {
  it.each([
    'google', 'github', 'apple', 'discord',
    'microsoft', 'facebook', 'kakao', 'naver',
    'x', 'reddit', 'line', 'slack', 'spotify', 'twitch',
  ])('returns true for %s', (provider) => {
    expect(isSupportedProvider(provider)).toBe(true);
  });

  it('returns true for oidc: prefixed providers', () => {
    expect(isSupportedProvider('oidc:okta')).toBe(true);
    expect(isSupportedProvider('oidc:auth0')).toBe(true);
  });

  it('returns false for oidc: with no name', () => {
    expect(isSupportedProvider('oidc:')).toBe(false);
  });

  it('returns false for unknown providers', () => {
    expect(isSupportedProvider('myspace')).toBe(false);
    expect(isSupportedProvider('')).toBe(false);
  });
});

// ─── getOAuthProviderConfig ───

describe('getOAuthProviderConfig', () => {
  it('returns null for undefined config', () => {
    expect(getOAuthProviderConfig(undefined, 'google')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(getOAuthProviderConfig('not-json', 'google')).toBeNull();
  });

  it('returns config for built-in provider', () => {
    const config = JSON.stringify({
      auth: { oauth: { google: { clientId: 'gid', clientSecret: 'gsec' } } },
    });
    const result = getOAuthProviderConfig(config, 'google');
    expect(result).toEqual({ clientId: 'gid', clientSecret: 'gsec' });
  });

  it('returns null when provider config is missing clientId', () => {
    const config = JSON.stringify({
      auth: { oauth: { google: { clientSecret: 'gsec' } } },
    });
    expect(getOAuthProviderConfig(config, 'google')).toBeNull();
  });

  it('returns OIDC config with issuer', () => {
    const config = JSON.stringify({
      auth: {
        oauth: {
          oidc: {
            okta: {
              clientId: 'oid',
              clientSecret: 'osec',
              issuer: 'https://okta.example.com',
              scopes: ['openid', 'profile'],
            },
          },
        },
      },
    });
    const result = getOAuthProviderConfig(config, 'oidc:okta');
    expect(result).toEqual({
      clientId: 'oid',
      clientSecret: 'osec',
      issuer: 'https://okta.example.com',
      scopes: ['openid', 'profile'],
    });
  });

  it('returns null for OIDC missing issuer', () => {
    const config = JSON.stringify({
      auth: { oauth: { oidc: { okta: { clientId: 'oid', clientSecret: 'osec' } } } },
    });
    expect(getOAuthProviderConfig(config, 'oidc:okta')).toBeNull();
  });
});

describe('getOAuthProviderConfig', () => {
  it('accepts already-materialized config objects', () => {
    const config = {
      auth: { oauth: { google: { clientId: 'runtime-id', clientSecret: 'runtime-secret' } } },
    };

    expect(getOAuthProviderConfig(config, 'google')).toEqual({
      clientId: 'runtime-id',
      clientSecret: 'runtime-secret',
    });
  });

  it('returns null when provider is missing from config object', () => {
    const config = {
      auth: { oauth: { github: { clientId: 'gh', clientSecret: 'gs' } } },
    };

    expect(getOAuthProviderConfig(config, 'google')).toBeNull();
  });
});

// ─── getAllowedOAuthProviders ───

describe('getAllowedOAuthProviders', () => {
  it('returns empty array for undefined config', () => {
    expect(getAllowedOAuthProviders(undefined)).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    expect(getAllowedOAuthProviders('bad')).toEqual([]);
  });

  it('returns empty array when allowedOAuthProviders is not an array', () => {
    const config = JSON.stringify({ auth: { allowedOAuthProviders: 'google' } });
    expect(getAllowedOAuthProviders(config)).toEqual([]);
  });

  it('filters out unsupported providers', () => {
    const config = JSON.stringify({
      auth: { allowedOAuthProviders: ['google', 'myspace', 'github', 'oidc:okta'] },
    });
    expect(getAllowedOAuthProviders(config)).toEqual(['google', 'github', 'oidc:okta']);
  });
});
