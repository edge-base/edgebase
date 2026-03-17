import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setConfig } from '../../src/lib/do-router.js';
import testConfig from '../../edgebase.test.config.ts';
import { getRedirectFragmentParams } from './redirect-fragment.js';

const BASE = 'http://localhost';

function installRedirectConfig(): void {
  setConfig({
    ...testConfig,
    release: false,
    auth: {
      ...(testConfig.auth ?? {}),
      allowedRedirectUrls: ['http://localhost:4173'],
    },
  });
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function randomEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

beforeAll(() => {
  installRedirectConfig();
});

afterAll(() => {
  setConfig(testConfig);
});

describe('auth-email-redirects', () => {
  it('magic link request returns actionUrl with token, type, and state', async () => {
    const email = randomEmail('magic-redirect');
    const { status, data } = await api('POST', '/signin/magic-link', {
      email,
      redirectUrl: 'http://localhost:4173/auth/magic',
      state: 'magic-state',
    });

    expect(status).toBe(200);
    expect(typeof data.token).toBe('string');
    const actionUrl = new URL(data.actionUrl);
    const redirectParams = getRedirectFragmentParams(actionUrl);
    expect(actionUrl.origin).toBe('http://localhost:4173');
    expect(actionUrl.pathname).toBe('/auth/magic');
    expect(redirectParams.get('token')).toBe(data.token);
    expect(redirectParams.get('type')).toBe('magic-link');
    expect(redirectParams.get('state')).toBe('magic-state');
  });

  it('password reset request returns actionUrl with token, type, and state', async () => {
    const email = randomEmail('reset-redirect');
    await api('POST', '/signup', { email, password: 'ResetRedirect1234!' });

    const { status, data } = await api('POST', '/request-password-reset', {
      email,
      redirectUrl: 'http://localhost:4173/auth/reset',
      state: 'reset-state',
    });

    expect(status).toBe(200);
    expect(typeof data.token).toBe('string');
    const actionUrl = new URL(data.actionUrl);
    const redirectParams = getRedirectFragmentParams(actionUrl);
    expect(actionUrl.origin).toBe('http://localhost:4173');
    expect(actionUrl.pathname).toBe('/auth/reset');
    expect(redirectParams.get('token')).toBe(data.token);
    expect(redirectParams.get('type')).toBe('password-reset');
    expect(redirectParams.get('state')).toBe('reset-state');
  });

  it('email change request returns actionUrl with token, type, and state', async () => {
    const email = randomEmail('email-change-old');
    const newEmail = randomEmail('email-change-new');
    const signup = await api('POST', '/signup', { email, password: 'EmailChange1234!' });

    const { status, data } = await api('POST', '/change-email', {
      newEmail,
      password: 'EmailChange1234!',
      redirectUrl: 'http://localhost:4173/auth/change-email',
      state: 'email-change-state',
    }, signup.data.accessToken);

    expect(status).toBe(200);
    expect(typeof data.token).toBe('string');
    const actionUrl = new URL(data.actionUrl);
    const redirectParams = getRedirectFragmentParams(actionUrl);
    expect(actionUrl.origin).toBe('http://localhost:4173');
    expect(actionUrl.pathname).toBe('/auth/change-email');
    expect(redirectParams.get('token')).toBe(data.token);
    expect(redirectParams.get('type')).toBe('email-change');
    expect(redirectParams.get('state')).toBe('email-change-state');
  });

  it('rejects redirectUrl outside the allowlist', async () => {
    const { status, data } = await api('POST', '/signin/magic-link', {
      email: randomEmail('evil-redirect'),
      redirectUrl: 'https://evil.example.com/callback',
    });

    expect(status).toBe(400);
    expect(data.message).toContain('redirect_url');
  });
});
