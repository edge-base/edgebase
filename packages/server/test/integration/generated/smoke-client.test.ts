/**
 * Auto-generated smoke tests for tag: client
 * DO NOT EDIT — regenerate with: npx tsx tools/smoke-gen/generate-smoke.ts
 */
import { describe, it, expect } from 'vitest';
import { fetchMock } from 'cloudflare:test';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
const MOCK_FCM_ORIGIN = 'http://localhost:9099';

function setupFcmMocks() {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  fetchMock.get(MOCK_FCM_ORIGIN)
    .intercept({ path: '/token', method: 'POST' })
    .reply(200, JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }), {
      headers: { 'content-type': 'application/json' },
    })
    .persist();

  fetchMock.get(MOCK_FCM_ORIGIN)
    .intercept({ path: /\/v1\/projects\/.*\/messages:send/, method: 'POST' })
    .reply(200, JSON.stringify({ name: 'projects/test-project/messages/fake-123' }), {
      headers: { 'content-type': 'application/json' },
    })
    .persist();

  fetchMock.get(MOCK_FCM_ORIGIN)
    .intercept({ path: /\/iid\//, method: 'POST' })
    .reply(200, '{}', { headers: { 'content-type': 'application/json' } })
    .persist();
}

async function withPushMocks<T>(fn: () => Promise<T>): Promise<T> {
  setupFcmMocks();
  try {
    return await fn();
  } finally {
    fetchMock.deactivate();
  }
}


async function api(method: string, path: string, opts?: { headers?: Record<string, string>; body?: unknown }) {
  const headers: Record<string, string> = { ...opts?.headers };
  if (opts?.body) headers['Content-Type'] = 'application/json';
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function wsConnect(path: string, headers?: Record<string, string>) {
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    headers: { Upgrade: 'websocket', ...(headers ?? {}) },
  });
  const ws = (res as any).webSocket as WebSocket | undefined;
  if (ws) {
    ws.accept();
    ws.close();
  }
  return { status: res.status };
}

describe('Smoke: client', () => {
  it('getHealth: GET /api/health → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/health', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    if (data) expect(data).not.toHaveProperty('error');
  });

  it('authSignup: POST /api/auth/signup → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/signup', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: `smoke-signup-${Date.now()}@test.com`, password: "SmokeTest1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authSignup: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/signup', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authSignin: POST /api/auth/signin → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/signin', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke@test.com", password: "SmokeTest1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authSignin: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/signin', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authSigninAnonymous: POST /api/auth/signin/anonymous → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/signin/anonymous', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('authSigninMagicLink: POST /api/auth/signin/magic-link → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/signin/magic-link', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke@test.com" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authSigninMagicLink: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/signin/magic-link', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authVerifyMagicLink: POST /api/auth/verify-magic-link → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/verify-magic-link', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { token: "smoke-magic-link-token" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authVerifyMagicLink: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/verify-magic-link', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authSigninPhone: POST /api/auth/signin/phone → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/signin/phone', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { phone: "+15551234567" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authSigninPhone: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/signin/phone', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authVerifyPhone: POST /api/auth/verify-phone → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/verify-phone', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { phone: "+15551234567", code: "123456" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authVerifyPhone: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/verify-phone', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authLinkPhone: POST /api/auth/link/phone → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/link/phone', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { phone: "+15551234567" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authLinkPhone: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/link/phone', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authVerifyLinkPhone: POST /api/auth/verify-link-phone → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/verify-link-phone', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { phone: "+15551234567", code: "123456" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authVerifyLinkPhone: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/verify-link-phone', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authSigninEmailOtp: POST /api/auth/signin/email-otp → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/signin/email-otp', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke@test.com" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authSigninEmailOtp: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/signin/email-otp', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authVerifyEmailOtp: POST /api/auth/verify-email-otp → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/verify-email-otp', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke@test.com", code: "123456" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authVerifyEmailOtp: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/verify-email-otp', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authMfaTotpEnroll: POST /api/auth/mfa/totp/enroll → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/mfa/totp/enroll', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authMfaTotpEnroll: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/auth/mfa/totp/enroll');
    expect([401, 403]).toContain(status);
  });

  it('authMfaTotpVerify: POST /api/auth/mfa/totp/verify → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/mfa/totp/verify', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { factorId: "smoke-factor", code: "123456" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authMfaTotpVerify: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/auth/mfa/totp/verify', {
      body: { factorId: "smoke-factor", code: "123456" },
    });
    expect([401, 403]).toContain(status);
  });

  it('authMfaTotpVerify: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/mfa/totp/verify', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authMfaVerify: POST /api/auth/mfa/verify → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/mfa/verify', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { mfaTicket: "smoke-ticket", code: "123456" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authMfaVerify: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/mfa/verify', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authMfaRecovery: POST /api/auth/mfa/recovery → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/mfa/recovery', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { mfaTicket: "smoke-ticket", recoveryCode: "smoke-recovery-code" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authMfaRecovery: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/mfa/recovery', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authMfaTotpDelete: DELETE /api/auth/mfa/totp → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/auth/mfa/totp', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { password: "SmokeTest1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authMfaTotpDelete: no auth → 401/403', async () => {
    const { status } = await api('DELETE', '/api/auth/mfa/totp', {
      body: { password: "SmokeTest1234!" },
    });
    expect([401, 403]).toContain(status);
  });

  it('authMfaTotpDelete: bad input → 400', async () => {
    const { status } = await api('DELETE', '/api/auth/mfa/totp', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authMfaFactors: GET /api/auth/mfa/factors → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/mfa/factors', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authMfaFactors: no auth → 401/403', async () => {
    const { status } = await api('GET', '/api/auth/mfa/factors');
    expect([401, 403]).toContain(status);
  });

  it('authRefresh: POST /api/auth/refresh → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/refresh', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { refreshToken: "smoke-refresh-token" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authRefresh: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/refresh', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authSignout: POST /api/auth/signout → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/signout', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('authSignout: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/signout', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authChangePassword: POST /api/auth/change-password → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/change-password', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { currentPassword: "Old1234!", newPassword: "New1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authChangePassword: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/change-password', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authChangeEmail: POST /api/auth/change-email → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/change-email', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke-change@test.com" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authChangeEmail: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/change-email', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authVerifyEmailChange: POST /api/auth/verify-email-change → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/verify-email-change', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { token: "smoke-verify-token" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authVerifyEmailChange: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/verify-email-change', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysRegisterOptions: POST /api/auth/passkeys/register-options → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/passkeys/register-options', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysRegisterOptions: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/auth/passkeys/register-options');
    expect([401, 403]).toContain(status);
  });

  it('authPasskeysRegister: POST /api/auth/passkeys/register → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/passkeys/register', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { response: {} },
    });
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysRegister: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/auth/passkeys/register', {
      body: { response: {} },
    });
    expect([401, 403]).toContain(status);
  });

  it('authPasskeysRegister: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/passkeys/register', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysAuthOptions: POST /api/auth/passkeys/auth-options → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/passkeys/auth-options', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysAuthenticate: POST /api/auth/passkeys/authenticate → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/passkeys/authenticate', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { response: { id: "smoke-credential", type: "public-key" } },
    });
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysAuthenticate: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/passkeys/authenticate', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysList: GET /api/auth/passkeys → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/passkeys', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysList: no auth → 401/403', async () => {
    const { status } = await api('GET', '/api/auth/passkeys');
    expect([401, 403]).toContain(status);
  });

  it('authPasskeysDelete: DELETE /api/auth/passkeys/{credentialId} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/auth/passkeys/smoke-cred-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authPasskeysDelete: no auth → 401/403', async () => {
    const { status } = await api('DELETE', '/api/auth/passkeys/smoke-cred-id-000');
    expect([401, 403]).toContain(status);
  });

  it('authGetMe: GET /api/auth/me → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/me', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authUpdateProfile: PATCH /api/auth/profile → not 5xx', async () => {
    const { status, data } = await api('PATCH', '/api/auth/profile', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { displayName: "Smoke Test" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authUpdateProfile: bad input → 400', async () => {
    const { status } = await api('PATCH', '/api/auth/profile', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authGetSessions: GET /api/auth/sessions → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/sessions', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authDeleteSession: DELETE /api/auth/sessions/{id} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/auth/sessions/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authGetIdentities: GET /api/auth/identities → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/identities', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authGetIdentities: no auth → 401/403', async () => {
    const { status } = await api('GET', '/api/auth/identities');
    expect([401, 403]).toContain(status);
  });

  it('authDeleteIdentity: DELETE /api/auth/identities/{identityId} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/auth/identities/smoke-identityId', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('authDeleteIdentity: no auth → 401/403', async () => {
    const { status } = await api('DELETE', '/api/auth/identities/smoke-identityId');
    expect([401, 403]).toContain(status);
  });

  it('authLinkEmail: POST /api/auth/link/email → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/link/email', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke-link@test.com", password: "Link1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authLinkEmail: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/link/email', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authRequestEmailVerification: POST /api/auth/request-email-verification → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/request-email-verification', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('authRequestEmailVerification: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/auth/request-email-verification', {
      body: {},
    });
    expect([401, 403]).toContain(status);
  });

  it('authRequestEmailVerification: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/request-email-verification', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authVerifyEmail: POST /api/auth/verify-email → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/verify-email', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { token: "smoke-verify-token" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authVerifyEmail: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/verify-email', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authRequestPasswordReset: POST /api/auth/request-password-reset → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/request-password-reset', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke@test.com" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authRequestPasswordReset: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/request-password-reset', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('authResetPassword: POST /api/auth/reset-password → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/reset-password', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { token: "smoke-token", password: "Reset1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('authResetPassword: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/reset-password', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('oauthRedirect: GET /api/auth/oauth/{provider} → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/oauth/smoke-provider', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('oauthCallback: GET /api/auth/oauth/{provider}/callback → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/oauth/smoke-provider/callback', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('oauthLinkStart: POST /api/auth/oauth/link/{provider} → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/oauth/link/smoke-provider', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('oauthLinkCallback: GET /api/auth/oauth/link/{provider}/callback → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/oauth/link/smoke-provider/callback', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleCountRecords: GET /api/db/{namespace}/tables/{table}/count → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/test/tables/posts/count', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleSearchRecords: GET /api/db/{namespace}/tables/{table}/search → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/test/tables/posts/search', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleGetRecord: GET /api/db/{namespace}/tables/{table}/{id} → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/test/tables/posts/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleUpdateRecord: PATCH /api/db/{namespace}/tables/{table}/{id} → not 5xx', async () => {
    const { status, data } = await api('PATCH', '/api/db/test/tables/posts/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleUpdateRecord: bad input → 400', async () => {
    const { status } = await api('PATCH', '/api/db/test/tables/posts/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('dbSingleDeleteRecord: DELETE /api/db/{namespace}/tables/{table}/{id} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/db/test/tables/posts/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleListRecords: GET /api/db/{namespace}/tables/{table} → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/test/tables/posts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleInsertRecord: POST /api/db/{namespace}/tables/{table} → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/db/test/tables/posts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleInsertRecord: bad input → 400', async () => {
    const { status } = await api('POST', '/api/db/test/tables/posts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('dbSingleBatchRecords: POST /api/db/{namespace}/tables/{table}/batch → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/db/test/tables/posts/batch', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { records: [{ title: "smoke-batch" }] },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleBatchByFilter: POST /api/db/{namespace}/tables/{table}/batch-by-filter → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/db/test/tables/posts/batch-by-filter', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { filter: [["title", "==", "smoke"]], data: { views: 0 } },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSingleBatchByFilter: bad input → 400', async () => {
    const { status } = await api('POST', '/api/db/test/tables/posts/batch-by-filter', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('dbCountRecords: GET /api/db/{namespace}/{instanceId}/tables/{table}/count → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/test/default/tables/posts/count', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbSearchRecords: GET /api/db/{namespace}/{instanceId}/tables/{table}/search → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/test/default/tables/posts/search', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbGetRecord: GET /api/db/{namespace}/{instanceId}/tables/{table}/{id} → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/test/default/tables/posts/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbUpdateRecord: PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id} → not 5xx', async () => {
    const { status, data } = await api('PATCH', '/api/db/test/default/tables/posts/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('dbUpdateRecord: bad input → 400', async () => {
    const { status } = await api('PATCH', '/api/db/test/default/tables/posts/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('dbDeleteRecord: DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/db/test/default/tables/posts/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbListRecords: GET /api/db/{namespace}/{instanceId}/tables/{table} → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/test/default/tables/posts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbInsertRecord: POST /api/db/{namespace}/{instanceId}/tables/{table} → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/db/test/default/tables/posts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('dbInsertRecord: bad input → 400', async () => {
    const { status } = await api('POST', '/api/db/test/default/tables/posts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('dbBatchRecords: POST /api/db/{namespace}/{instanceId}/tables/{table}/batch → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/db/test/default/tables/posts/batch', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { records: [{ title: "smoke-batch" }] },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbBatchByFilter: POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/db/test/default/tables/posts/batch-by-filter', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { filter: [["title", "==", "smoke"]], data: { views: 0 } },
    });
    expect(status).toBeLessThan(500);
  });

  it('dbBatchByFilter: bad input → 400', async () => {
    const { status } = await api('POST', '/api/db/test/default/tables/posts/batch-by-filter', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('checkDatabaseSubscriptionConnection: GET /api/db/connect-check → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/db/connect-check?namespace=test&table=posts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('connectDatabaseSubscription: GET /api/db/subscribe → not 5xx', async () => {
    const { status } = await wsConnect('/api/db/subscribe?namespace=shared&table=posts');
    expect(status).toBe(101);
  });

  it('getSchema: GET /api/schema → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/schema', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('getSchema: no auth → 401/403', async () => {
    const { status } = await api('GET', '/api/schema');
    expect([401, 403]).toContain(status);
  });

  it('uploadFile: POST /api/storage/{bucket}/upload → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/upload', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('uploadFile: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/upload', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('getFileMetadata: GET /api/storage/{bucket}/{key}/metadata → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/storage/documents/smoke-test-file.txt/metadata', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('updateFileMetadata: PATCH /api/storage/{bucket}/{key}/metadata → not 5xx', async () => {
    const { status, data } = await api('PATCH', '/api/storage/documents/smoke-test-file.txt/metadata', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('updateFileMetadata: bad input → 400', async () => {
    const { status } = await api('PATCH', '/api/storage/documents/smoke-test-file.txt/metadata', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('downloadFile: GET /api/storage/{bucket}/{key} → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/storage/documents/smoke-test-file.txt', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('deleteFile: DELETE /api/storage/{bucket}/{key} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/storage/documents/smoke-test-file.txt', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('getUploadParts: GET /api/storage/{bucket}/uploads/{uploadId}/parts → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/storage/documents/uploads/smoke-upload-id-000/parts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('listFiles: GET /api/storage/{bucket} → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/storage/documents', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('listFiles: no auth → 401/403', async () => {
    const { status } = await api('GET', '/api/storage/documents');
    expect([401, 403]).toContain(status);
  });

  it('deleteBatch: POST /api/storage/{bucket}/delete-batch → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/delete-batch', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { keys: ["smoke-key"] },
    });
    expect(status).toBeLessThan(500);
  });

  it('deleteBatch: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/delete-batch', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('createSignedDownloadUrl: POST /api/storage/{bucket}/signed-url → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/signed-url', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { key: "smoke-file.txt" },
    });
    expect(status).toBeLessThan(500);
  });

  it('createSignedDownloadUrl: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/storage/documents/signed-url', {
      body: { key: "smoke-file.txt" },
    });
    expect([401, 403]).toContain(status);
  });

  it('createSignedDownloadUrl: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/signed-url', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('createSignedDownloadUrls: POST /api/storage/{bucket}/signed-urls → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/signed-urls', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { keys: ["smoke-file.txt"] },
    });
    expect(status).toBeLessThan(500);
  });

  it('createSignedDownloadUrls: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/storage/documents/signed-urls', {
      body: { keys: ["smoke-file.txt"] },
    });
    expect([401, 403]).toContain(status);
  });

  it('createSignedDownloadUrls: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/signed-urls', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('createSignedUploadUrl: POST /api/storage/{bucket}/signed-upload-url → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/signed-upload-url', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { key: "smoke-upload.txt", contentType: "text/plain" },
    });
    expect(status).toBeLessThan(500);
  });

  it('createSignedUploadUrl: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/storage/documents/signed-upload-url', {
      body: { key: "smoke-upload.txt", contentType: "text/plain" },
    });
    expect([401, 403]).toContain(status);
  });

  it('createSignedUploadUrl: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/signed-upload-url', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('createMultipartUpload: POST /api/storage/{bucket}/multipart/create → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/multipart/create', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { key: "smoke-multipart.txt" },
    });
    expect(status).toBeLessThan(500);
  });

  it('createMultipartUpload: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/storage/documents/multipart/create', {
      body: { key: "smoke-multipart.txt" },
    });
    expect([401, 403]).toContain(status);
  });

  it('createMultipartUpload: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/multipart/create', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('uploadPart: POST /api/storage/{bucket}/multipart/upload-part → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/multipart/upload-part', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { uploadId: "smoke-upload", partNumber: 1 },
    });
    expect(status).toBeLessThan(500);
  });

  it('uploadPart: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/storage/documents/multipart/upload-part', {
      body: { uploadId: "smoke-upload", partNumber: 1 },
    });
    expect([401, 403]).toContain(status);
  });

  it('uploadPart: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/multipart/upload-part', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('completeMultipartUpload: POST /api/storage/{bucket}/multipart/complete → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/multipart/complete', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { uploadId: "smoke-upload", parts: [] },
    });
    expect(status).toBeLessThan(500);
  });

  it('completeMultipartUpload: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/multipart/complete', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('abortMultipartUpload: POST /api/storage/{bucket}/multipart/abort → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/storage/documents/multipart/abort', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { uploadId: "smoke-upload" },
    });
    expect(status).toBeLessThan(500);
  });

  it('abortMultipartUpload: bad input → 400', async () => {
    const { status } = await api('POST', '/api/storage/documents/multipart/abort', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('getConfig: GET /api/config → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/config', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    if (data) expect(data).not.toHaveProperty('error');
  });

  it('pushRegister: POST /api/push/register → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/register', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { deviceId: "smoke-device-1", token: "smoke-push-token", platform: "web" },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushRegister: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/register', {
      body: { deviceId: "smoke-device-1", token: "smoke-push-token", platform: "web" },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushRegister: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/register', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('pushUnregister: POST /api/push/unregister → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/unregister', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { deviceId: "smoke-device-1" },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushUnregister: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/unregister', {
      body: { deviceId: "smoke-device-1" },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushUnregister: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/unregister', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('pushTopicSubscribe: POST /api/push/topic/subscribe → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/topic/subscribe', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { topic: "smoke-topic" },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushTopicSubscribe: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/topic/subscribe', {
      body: { topic: "smoke-topic" },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushTopicSubscribe: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/topic/subscribe', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('pushTopicUnsubscribe: POST /api/push/topic/unsubscribe → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/topic/unsubscribe', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { topic: "smoke-topic" },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushTopicUnsubscribe: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/topic/unsubscribe', {
      body: { topic: "smoke-topic" },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushTopicUnsubscribe: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/topic/unsubscribe', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('checkRoomConnection: GET /api/room/connect-check → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/room/connect-check?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('connectRoom: GET /api/room → not 5xx', async () => {
    const { status } = await wsConnect('/api/room?namespace=test-game&id=smoke-room');
    expect(status).toBe(101);
  });

  it('getRoomMetadata: GET /api/room/metadata → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/room/metadata?namespace=test-metadata&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('getRoomRealtimeSession: GET /api/room/media/realtime/session → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/room/media/realtime/session?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('getRoomRealtimeSession: no auth → 401/403', async () => {
    const { status } = await api('GET', '/api/room/media/realtime/session?namespace=test-game&id=smoke-room');
    expect([401, 403]).toContain(status);
  });

  it('createRoomRealtimeSession: POST /api/room/media/realtime/session → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/room/media/realtime/session?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('createRoomRealtimeSession: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/room/media/realtime/session?namespace=test-game&id=smoke-room', {
      body: {},
    });
    expect([401, 403]).toContain(status);
  });

  it('createRoomRealtimeSession: bad input → 400', async () => {
    const { status } = await api('POST', '/api/room/media/realtime/session?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('createRoomRealtimeIceServers: POST /api/room/media/realtime/turn → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/room/media/realtime/turn?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('createRoomRealtimeIceServers: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/room/media/realtime/turn?namespace=test-game&id=smoke-room', {
      body: {},
    });
    expect([401, 403]).toContain(status);
  });

  it('createRoomRealtimeIceServers: bad input → 400', async () => {
    const { status } = await api('POST', '/api/room/media/realtime/turn?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('addRoomRealtimeTracks: POST /api/room/media/realtime/tracks/new → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/room/media/realtime/tracks/new?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { sessionId: "smoke-session", tracks: [{ location: "local", trackName: "audio-track", kind: "audio" }] },
    });
    expect(status).toBeLessThan(500);
  });

  it('addRoomRealtimeTracks: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/room/media/realtime/tracks/new?namespace=test-game&id=smoke-room', {
      body: { sessionId: "smoke-session", tracks: [{ location: "local", trackName: "audio-track", kind: "audio" }] },
    });
    expect([401, 403]).toContain(status);
  });

  it('addRoomRealtimeTracks: bad input → 400', async () => {
    const { status } = await api('POST', '/api/room/media/realtime/tracks/new?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('renegotiateRoomRealtimeSession: PUT /api/room/media/realtime/renegotiate → not 5xx', async () => {
    const { status, data } = await api('PUT', '/api/room/media/realtime/renegotiate?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { sessionId: "smoke-session", sessionDescription: { sdp: "v=0\r\n", type: "offer" } },
    });
    expect(status).toBeLessThan(500);
  });

  it('renegotiateRoomRealtimeSession: no auth → 401/403', async () => {
    const { status } = await api('PUT', '/api/room/media/realtime/renegotiate?namespace=test-game&id=smoke-room', {
      body: { sessionId: "smoke-session", sessionDescription: { sdp: "v=0\r\n", type: "offer" } },
    });
    expect([401, 403]).toContain(status);
  });

  it('renegotiateRoomRealtimeSession: bad input → 400', async () => {
    const { status } = await api('PUT', '/api/room/media/realtime/renegotiate?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('closeRoomRealtimeTracks: PUT /api/room/media/realtime/tracks/close → not 5xx', async () => {
    const { status, data } = await api('PUT', '/api/room/media/realtime/tracks/close?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { sessionId: "smoke-session", tracks: [{ mid: "0" }] },
    });
    expect(status).toBeLessThan(500);
  });

  it('closeRoomRealtimeTracks: no auth → 401/403', async () => {
    const { status } = await api('PUT', '/api/room/media/realtime/tracks/close?namespace=test-game&id=smoke-room', {
      body: { sessionId: "smoke-session", tracks: [{ mid: "0" }] },
    });
    expect([401, 403]).toContain(status);
  });

  it('closeRoomRealtimeTracks: bad input → 400', async () => {
    const { status } = await api('PUT', '/api/room/media/realtime/tracks/close?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('createRoomCloudflareRealtimeKitSession: POST /api/room/media/cloudflare_realtimekit/session → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/room/media/cloudflare_realtimekit/session?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('createRoomCloudflareRealtimeKitSession: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/room/media/cloudflare_realtimekit/session?namespace=test-game&id=smoke-room', {
      body: {},
    });
    expect([401, 403]).toContain(status);
  });

  it('createRoomCloudflareRealtimeKitSession: bad input → 400', async () => {
    const { status } = await api('POST', '/api/room/media/cloudflare_realtimekit/session?namespace=test-game&id=smoke-room', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('trackEvents: POST /api/analytics/track → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/analytics/track', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { events: [{ name: "smoke_test", timestamp: 0 }] },
    });
    expect(status).toBeLessThan(500);
  });

  it('trackEvents: bad input → 400', async () => {
    const { status } = await api('POST', '/api/analytics/track', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

});
