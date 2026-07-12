/**
 * Unit tests for lib/oauth-providers.ts
 *
 * Covers parseOIDCIdToken (pure JWT decode) and prefetchOIDCDiscovery (fetch mock).
 * Also tests parseAppleIdToken, isSupportedProvider, getOAuthProviderConfig, getAllowedOAuthProviders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  parseOIDCIdToken,
  prefetchOIDCDiscovery,
  parseAppleIdToken,
  isSupportedProvider,
  getOAuthProviderConfig,
  getAllowedOAuthProviders,
  verifyOIDCIdToken,
  verifyAppleIdToken,
  assertOIDCUserInfoSubject,
  createOAuthProvider,
  validateOIDCProviderSecurity,
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
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: expect.any(AbortSignal),
      }),
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

// ─── verifyOIDCIdToken ───

let oidcFixtureId = 0;

async function signedOIDCFixture(options: {
  algorithm?: 'RS256' | 'ES256';
  claims?: Record<string, unknown>;
  omit?: Array<'exp' | 'iat'>;
  signingKey?: CryptoKey;
} = {}) {
  const algorithm = options.algorithm ?? 'RS256';
  const issuer = `https://signed-${oidcFixtureId += 1}.issuer.example.com`;
  const clientId = 'signed-client';
  const nonce = 'signed-nonce';
  const now = Math.floor(Date.now() / 1000);
  const keys = await generateKeyPair(algorithm, { extractable: true });
  const publicJwk = {
    ...(await exportJWK(keys.publicKey)),
    alg: algorithm,
    kid: 'active-key',
    use: 'sig',
  };
  const claims: Record<string, unknown> = {
    iss: issuer,
    aud: clientId,
    sub: 'signed-user',
    nonce,
    exp: now + 300,
    iat: now,
    ...options.claims,
  };
  for (const claim of options.omit ?? []) delete claims[claim];
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: algorithm, kid: 'active-key', typ: 'JWT' })
    .sign(options.signingKey ?? keys.privateKey);
  const discovery = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) {
      return new Response(JSON.stringify(discovery), { status: 200 });
    }
    if (url === discovery.jwks_uri) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }
    throw new Error(`Unexpected OIDC URL: ${url}`);
  }));
  return {
    token,
    config: { issuer, clientId, clientSecret: 'secret' },
    nonce,
    payload: claims,
  };
}

describe('verifyOIDCIdToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['RS256', 'ES256'] as const)('verifies a real %s signature and JWKS', async (algorithm) => {
    const fixture = await signedOIDCFixture({ algorithm });
    await expect(verifyOIDCIdToken(fixture.token, fixture.config, fixture.nonce))
      .resolves.toMatchObject({ sub: 'signed-user', iss: fixture.config.issuer });
  });

  it('rejects a token signed by a key absent from JWKS', async () => {
    const attacker = await generateKeyPair('RS256');
    const fixture = await signedOIDCFixture({ signingKey: attacker.privateKey });
    await expect(verifyOIDCIdToken(fixture.token, fixture.config, fixture.nonce)).rejects.toThrow();
  });

  it.each([
    ['issuer', { iss: 'https://attacker.example.com' }, 'signed-nonce'],
    ['audience', { aud: 'other-client' }, 'signed-nonce'],
    ['nonce', {}, 'wrong-nonce'],
    ['expired token', { exp: Math.floor(Date.now() / 1000) - 10 }, 'signed-nonce'],
  ] as const)('rejects an invalid %s', async (_label, claims, expectedNonce) => {
    const fixture = await signedOIDCFixture({ claims });
    await expect(verifyOIDCIdToken(fixture.token, fixture.config, expectedNonce)).rejects.toThrow();
  });

  it.each(['exp', 'iat'] as const)('rejects a token missing required %s', async (claim) => {
    const fixture = await signedOIDCFixture({ omit: [claim] });
    await expect(verifyOIDCIdToken(fixture.token, fixture.config, fixture.nonce)).rejects.toThrow();
  });

  it('requires correct azp when aud contains multiple clients', async () => {
    const missing = await signedOIDCFixture({ claims: { aud: ['signed-client', 'other-client'] } });
    await expect(verifyOIDCIdToken(missing.token, missing.config, missing.nonce)).rejects.toThrow(/azp/);

    const wrong = await signedOIDCFixture({
      claims: { aud: ['signed-client', 'other-client'], azp: 'other-client' },
    });
    await expect(verifyOIDCIdToken(wrong.token, wrong.config, wrong.nonce)).rejects.toThrow(/azp/);

    const valid = await signedOIDCFixture({
      claims: { aud: ['signed-client', 'other-client'], azp: 'signed-client' },
    });
    await expect(verifyOIDCIdToken(valid.token, valid.config, valid.nonce)).resolves.toMatchObject({
      azp: 'signed-client',
    });
  });

  it('rejects an authenticated userinfo subject that differs from the verified token', async () => {
    const fixture = await signedOIDCFixture();
    const payload = await verifyOIDCIdToken(fixture.token, fixture.config, fixture.nonce);
    expect(() => assertOIDCUserInfoSubject(payload, { providerUserId: 'other-user' }))
      .toThrow(/subject mismatch/);
    expect(() => assertOIDCUserInfoSubject(payload, { providerUserId: 'signed-user' })).not.toThrow();
  });

  it('rejects an oversized discovery document before parsing it', async () => {
    const issuer = `https://oversized-${oidcFixtureId += 1}.issuer.example.com`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Length': String(1024 * 1024 + 1) },
    })));
    await expect(prefetchOIDCDiscovery(issuer)).rejects.toThrow(/too large/);
  });

  it('aborts a discovery request at the network deadline', async () => {
    vi.useFakeTimers();
    const issuer = `https://timeout-${oidcFixtureId += 1}.issuer.example.com`;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const pending = prefetchOIDCDiscovery(issuer);
    const rejection = expect(pending).rejects.toThrow(/aborted/i);
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
  });
});

describe('Apple and OIDC provider security validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('verifies a signed Apple id_token against the Apple JWKS, audience, and nonce', async () => {
    const keys = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = {
      ...(await exportJWK(keys.publicKey)),
      alg: 'RS256',
      kid: 'apple-test-key',
      use: 'sig',
    };
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: 'apple-user',
      email: 'apple@example.com',
      email_verified: 'true',
      nonce: 'apple-nonce',
      iat: now,
      exp: now + 300,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'apple-test-key' })
      .setIssuer('https://appleid.apple.com')
      .setAudience('apple-client')
      .sign(keys.privateKey);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ keys: [publicJwk] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(verifyAppleIdToken(token, 'apple-client', 'apple-nonce')).resolves.toMatchObject({
      providerUserId: 'apple-user',
      email: 'apple@example.com',
      emailVerified: true,
    });
  });

  it('rejects insecure public OIDC issuers while allowing loopback only outside release', () => {
    expect(() => validateOIDCProviderSecurity({
      issuer: 'http://issuer.example.com',
      clientId: 'client',
      clientSecret: 'secret',
    }, true)).toThrow(/HTTPS/);
    expect(() => validateOIDCProviderSecurity({
      issuer: 'http://127.0.0.1:4444',
      clientId: 'client',
      clientSecret: 'secret',
    }, false)).not.toThrow();
    expect(() => validateOIDCProviderSecurity({
      issuer: 'http://127.0.0.1:4444',
      clientId: 'client',
      clientSecret: 'secret',
    }, true)).toThrow(/HTTPS/);
  });
});

describe('OAuth provider network safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps Facebook client_secret, code, and access token out of request URLs', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'facebook-access-secret',
        token_type: 'bearer',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'facebook-user',
        name: 'Facebook User',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = createOAuthProvider('facebook', {
      clientId: 'facebook-client',
      clientSecret: 'facebook-client-secret',
    });

    const tokens = await provider.exchangeCode('facebook-code-secret', 'https://app.example.com/callback');
    await provider.getUserInfo(tokens.accessToken);

    const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://graph.facebook.com/v19.0/oauth/access_token');
    expect(tokenUrl).not.toContain('facebook-client-secret');
    expect(tokenUrl).not.toContain('facebook-code-secret');
    expect(tokenInit.method).toBe('POST');
    expect(String(tokenInit.body)).toContain('client_secret=facebook-client-secret');
    expect(tokenInit.redirect).toBe('manual');

    const [userinfoUrl, userinfoInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(userinfoUrl).not.toContain('facebook-access-secret');
    expect((userinfoInit.headers as Record<string, string>).Authorization)
      .toBe('Bearer facebook-access-secret');
  });

  it('bounds fixed-provider response bodies before JSON parsing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Length': String(1024 * 1024 + 1) },
    })));
    const provider = createOAuthProvider('google', { clientId: 'id', clientSecret: 'secret' });
    await expect(provider.exchangeCode('code', 'https://app.example.com/callback'))
      .rejects.toThrow(/too large/);
  });

  it('rejects provider redirects explicitly under the Workers-compatible manual mode', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://attacker.example/token' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = createOAuthProvider('google', { clientId: 'id', clientSecret: 'secret' });

    await expect(provider.exchangeCode('code', 'https://app.example.com/callback'))
      .rejects.toThrow(/redirects are not allowed/);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('aborts a fixed-provider request at the common network deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const provider = createOAuthProvider('google', { clientId: 'id', clientSecret: 'secret' });
    const pending = provider.exchangeCode('code', 'https://app.example.com/callback');
    const rejection = expect(pending).rejects.toThrow(/aborted/i);
    await vi.advanceTimersByTimeAsync(10_001);
    await rejection;
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
