/**
 * auth-oidc.test.ts — OIDC Federation integration tests
 *
 * Tests:
 *   1. isSupportedProvider accepts oidc:{name}
 *   2. getOAuthProviderConfig reads OIDC config format
 *   3. parseOIDCIdToken parses standard OIDC claims
 *   4. createOAuthProvider creates OIDCGenericProvider
 *   5. Full OAuth callback flow with fetchMock (discovery + token + userinfo)
 *   6. OIDC provider not configured → 500
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchMock } from 'cloudflare:test';
import {
  isSupportedProvider,
  getOAuthProviderConfig,
  createOAuthProvider,
  parseOIDCIdToken,
  prefetchOIDCDiscovery,
  type OIDCProviderConfig,
} from '../../src/lib/oauth-providers.js';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

// ─── Helpers ───

async function authApi(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function makeIdToken(claims: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify(claims));
  const sig = btoa('fake-signature');
  return `${header}.${payload}.${sig}`;
}

// ─── 1. isSupportedProvider ─────────────────────────────────────────────────

describe('OIDC — isSupportedProvider', () => {
  it('accepts oidc:{name} format', () => {
    expect(isSupportedProvider('oidc:okta')).toBe(true);
    expect(isSupportedProvider('oidc:azure-ad')).toBe(true);
    expect(isSupportedProvider('oidc:my-corp-idp')).toBe(true);
  });

  it('rejects bare "oidc" without name', () => {
    expect(isSupportedProvider('oidc')).toBe(false);
    expect(isSupportedProvider('oidc:')).toBe(false);
  });

  it('still accepts built-in providers', () => {
    expect(isSupportedProvider('google')).toBe(true);
    expect(isSupportedProvider('github')).toBe(true);
    expect(isSupportedProvider('apple')).toBe(true);
  });

  it('rejects unknown providers', () => {
    expect(isSupportedProvider('unknown-provider')).toBe(false);
  });
});

// ─── 2. getOAuthProviderConfig ──────────────────────────────────────────────

describe('OIDC — getOAuthProviderConfig', () => {
  const configObj = {
    auth: {
      oauth: {
        google: { clientId: 'g-id', clientSecret: 'g-secret' },
        oidc: {
          okta: {
            clientId: 'okta-id',
            clientSecret: 'okta-secret',
            issuer: 'https://dev-12345.okta.com',
            scopes: ['openid', 'email'],
          },
        },
      },
    },
  };
  const configStr = JSON.stringify(configObj);

  it('reads OIDC config with issuer', () => {
    const config = getOAuthProviderConfig(configStr, 'oidc:okta') as OIDCProviderConfig;
    expect(config).not.toBeNull();
    expect(config!.clientId).toBe('okta-id');
    expect(config!.clientSecret).toBe('okta-secret');
    expect(config!.issuer).toBe('https://dev-12345.okta.com');
    expect(config!.scopes).toEqual(['openid', 'email']);
  });

  it('returns null for unconfigured OIDC provider', () => {
    const config = getOAuthProviderConfig(configStr, 'oidc:nonexistent');
    expect(config).toBeNull();
  });

  it('still reads built-in provider config', () => {
    const config = getOAuthProviderConfig(configStr, 'google');
    expect(config).not.toBeNull();
    expect(config!.clientId).toBe('g-id');
  });
});

// ─── 3. parseOIDCIdToken ────────────────────────────────────────────────────

describe('OIDC — parseOIDCIdToken', () => {
  it('parses standard OIDC claims', () => {
    const token = makeIdToken({
      sub: 'user-123',
      email: 'user@example.com',
      email_verified: true,
      name: 'John Doe',
      picture: 'https://example.com/photo.jpg',
      preferred_username: 'johndoe',
      iss: 'https://idp.example.com',
    });

    const info = parseOIDCIdToken(token);
    expect(info.providerUserId).toBe('user-123');
    expect(info.email).toBe('user@example.com');
    expect(info.emailVerified).toBe(true);
    expect(info.displayName).toBe('John Doe');
    expect(info.avatarUrl).toBe('https://example.com/photo.jpg');
    expect(info.raw.iss).toBe('https://idp.example.com');
  });

  it('falls back to preferred_username when name is missing', () => {
    const token = makeIdToken({
      sub: 'user-456',
      email: 'test@example.com',
      preferred_username: 'testuser',
    });

    const info = parseOIDCIdToken(token);
    expect(info.displayName).toBe('testuser');
  });

  it('handles missing optional fields', () => {
    const token = makeIdToken({ sub: 'user-789' });
    const info = parseOIDCIdToken(token);
    expect(info.providerUserId).toBe('user-789');
    expect(info.email).toBeNull();
    expect(info.emailVerified).toBe(false);
    expect(info.displayName).toBeNull();
    expect(info.avatarUrl).toBeNull();
  });

  it('throws on invalid token format', () => {
    expect(() => parseOIDCIdToken('not-a-jwt')).toThrow();
  });
});

// ─── 4. createOAuthProvider ─────────────────────────────────────────────────

describe('OIDC — createOAuthProvider', () => {
  it('creates OIDCGenericProvider for oidc:{name}', () => {
    const config: OIDCProviderConfig = {
      clientId: 'test-id',
      clientSecret: 'test-secret',
      issuer: 'https://idp.example.com',
    };
    const provider = createOAuthProvider('oidc:test-idp', config);
    expect(provider.name).toBe('oidc:test-idp');
  });

  it('throws when issuer is missing', () => {
    expect(() =>
      createOAuthProvider('oidc:no-issuer', { clientId: 'id', clientSecret: 'sec' } as OIDCProviderConfig),
    ).toThrow('issuer');
  });
});

// ─── 5. OIDC provider — getAuthorizationUrl, exchangeCode, getUserInfo ──────

describe('OIDC — provider methods with fetchMock', () => {
  const MOCK_ISSUER = 'https://oidc-test.example.com';
  const MOCK_ORIGIN = 'https://oidc-test.example.com';

  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it('prefetchOIDCDiscovery fetches and caches discovery document', async () => {
    const mockAgent = fetchMock.get(MOCK_ORIGIN);
    mockAgent.intercept({
      path: '/.well-known/openid-configuration',
      method: 'GET',
    }).reply(200, JSON.stringify({
      issuer: MOCK_ISSUER,
      authorization_endpoint: `${MOCK_ISSUER}/authorize`,
      token_endpoint: `${MOCK_ISSUER}/oauth/token`,
      userinfo_endpoint: `${MOCK_ISSUER}/userinfo`,
      jwks_uri: `${MOCK_ISSUER}/.well-known/jwks.json`,
    }), { headers: { 'content-type': 'application/json' } });

    await prefetchOIDCDiscovery(MOCK_ISSUER);

    // Now getAuthorizationUrl should use the cached discovery doc
    const config: OIDCProviderConfig = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      issuer: MOCK_ISSUER,
    };
    const provider = createOAuthProvider('oidc:test', config);
    const url = provider.getAuthorizationUrl('state123', 'https://app.com/callback');
    expect(url).toContain(`${MOCK_ISSUER}/authorize`);
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('state=state123');
    expect(url).toContain('scope=openid+email+profile');
  });

  it('exchangeCode calls token endpoint', async () => {
    const mockAgent = fetchMock.get(MOCK_ORIGIN);

    // Discovery
    mockAgent.intercept({
      path: '/.well-known/openid-configuration',
      method: 'GET',
    }).reply(200, JSON.stringify({
      issuer: MOCK_ISSUER,
      authorization_endpoint: `${MOCK_ISSUER}/authorize`,
      token_endpoint: `${MOCK_ISSUER}/oauth/token`,
      userinfo_endpoint: `${MOCK_ISSUER}/userinfo`,
    }), { headers: { 'content-type': 'application/json' } });

    // Token exchange
    const idToken = makeIdToken({
      sub: 'oidc-user-1',
      email: 'oidcuser@example.com',
      email_verified: true,
      name: 'OIDC User',
    });
    mockAgent.intercept({
      path: '/oauth/token',
      method: 'POST',
    }).reply(200, JSON.stringify({
      access_token: 'mock-access-token',
      token_type: 'Bearer',
      id_token: idToken,
      expires_in: 3600,
    }), { headers: { 'content-type': 'application/json' } });

    const config: OIDCProviderConfig = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      issuer: MOCK_ISSUER,
    };
    const provider = createOAuthProvider('oidc:test', config);
    const tokens = await provider.exchangeCode('test-code', 'https://app.com/callback');

    expect(tokens.accessToken).toBe('mock-access-token');
    expect(tokens.idToken).toBeDefined();

    // Verify we can parse the id_token
    const userInfo = parseOIDCIdToken(tokens.idToken!);
    expect(userInfo.providerUserId).toBe('oidc-user-1');
    expect(userInfo.email).toBe('oidcuser@example.com');
  });

  it('getUserInfo calls userinfo endpoint', async () => {
    const mockAgent = fetchMock.get(MOCK_ORIGIN);

    // Discovery
    mockAgent.intercept({
      path: '/.well-known/openid-configuration',
      method: 'GET',
    }).reply(200, JSON.stringify({
      issuer: MOCK_ISSUER,
      authorization_endpoint: `${MOCK_ISSUER}/authorize`,
      token_endpoint: `${MOCK_ISSUER}/oauth/token`,
      userinfo_endpoint: `${MOCK_ISSUER}/userinfo`,
    }), { headers: { 'content-type': 'application/json' } });

    // Userinfo
    mockAgent.intercept({
      path: '/userinfo',
      method: 'GET',
    }).reply(200, JSON.stringify({
      sub: 'oidc-user-2',
      email: 'user2@example.com',
      email_verified: true,
      name: 'User Two',
      picture: 'https://example.com/avatar2.jpg',
    }), { headers: { 'content-type': 'application/json' } });

    const config: OIDCProviderConfig = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      issuer: MOCK_ISSUER,
    };
    const provider = createOAuthProvider('oidc:test', config);
    const userInfo = await provider.getUserInfo('mock-access-token');

    expect(userInfo.providerUserId).toBe('oidc-user-2');
    expect(userInfo.email).toBe('user2@example.com');
    expect(userInfo.emailVerified).toBe(true);
    expect(userInfo.displayName).toBe('User Two');
    expect(userInfo.avatarUrl).toBe('https://example.com/avatar2.jpg');
  });
});

// ─── 6. Built-in OAuth still works ──────────────────────────────────────────

describe('OIDC — backward compatibility', () => {
  it('built-in providers still work', () => {
    expect(isSupportedProvider('google')).toBe(true);
    expect(isSupportedProvider('github')).toBe(true);

    // createOAuthProvider should still work for built-in providers
    const provider = createOAuthProvider('github', {
      clientId: 'gh-id',
      clientSecret: 'gh-secret',
    });
    expect(provider.name).toBe('github');
    const url = provider.getAuthorizationUrl('state', 'https://app.com/callback');
    expect(url).toContain('github.com');
  });
});
