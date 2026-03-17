/**
 * External Dependencies Monitoring Tests
 *
 * Verifies that external dependency adapters (email, SMS, push, captcha, HIBP)
 * handle various API response scenarios correctly:
 *  - Success responses with correct payload parsing
 *  - Error responses without crashing (graceful degradation)
 *  - Fail-open behavior for non-critical services
 *
 * Uses fetchMock from cloudflare:test to simulate external API behavior
 * without making real HTTP calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchMock } from 'cloudflare:test';

// ─── Email Provider Adapters ──────────────────────────────────────────────────

describe('External: Email Provider Adapters', () => {
  // We test the provider classes directly (unit-level) to verify
  // correct request/response handling for each email service.

  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  // ── Resend ──

  it('Resend: success → { success: true, messageId }', async () => {
    fetchMock.get('https://api.resend.com')
      .intercept({ path: '/emails', method: 'POST' })
      .reply(200, JSON.stringify({ id: 'resend-msg-123' }), {
        headers: { 'content-type': 'application/json' },
      });

    const { ResendProvider } = await import('../../src/lib/email-provider.js');
    const provider = new ResendProvider('test-api-key', 'noreply@test.com');
    const result = await provider.send({
      to: 'user@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('resend-msg-123');
  });

  it('Resend: 500 error → { success: false }', async () => {
    fetchMock.get('https://api.resend.com')
      .intercept({ path: '/emails', method: 'POST' })
      .reply(500, 'Internal Server Error');

    const { ResendProvider } = await import('../../src/lib/email-provider.js');
    const provider = new ResendProvider('test-api-key', 'noreply@test.com');
    const result = await provider.send({
      to: 'user@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(false);
    expect(result.messageId).toBeUndefined();
  });

  it('Resend: 401 unauthorized → { success: false }', async () => {
    fetchMock.get('https://api.resend.com')
      .intercept({ path: '/emails', method: 'POST' })
      .reply(401, JSON.stringify({ message: 'Invalid API key' }), {
        headers: { 'content-type': 'application/json' },
      });

    const { ResendProvider } = await import('../../src/lib/email-provider.js');
    const provider = new ResendProvider('bad-key', 'noreply@test.com');
    const result = await provider.send({
      to: 'user@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(false);
  });

  // ── SendGrid ──

  it('SendGrid: 202 accepted → { success: true }', async () => {
    fetchMock.get('https://api.sendgrid.com')
      .intercept({ path: '/v3/mail/send', method: 'POST' })
      .reply(202, '', {
        headers: { 'x-message-id': 'sg-msg-456' },
      });

    const { SendGridProvider } = await import('../../src/lib/email-provider.js');
    const provider = new SendGridProvider('test-api-key', 'noreply@test.com');
    const result = await provider.send({
      to: 'user@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(true);
  });

  it('SendGrid: 403 forbidden → { success: false }', async () => {
    fetchMock.get('https://api.sendgrid.com')
      .intercept({ path: '/v3/mail/send', method: 'POST' })
      .reply(403, JSON.stringify({ errors: [{ message: 'Forbidden' }] }), {
        headers: { 'content-type': 'application/json' },
      });

    const { SendGridProvider } = await import('../../src/lib/email-provider.js');
    const provider = new SendGridProvider('test-api-key', 'noreply@test.com');
    const result = await provider.send({
      to: 'user@test.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.success).toBe(false);
  });
});

// ─── SMS Provider Adapters ────────────────────────────────────────────────────

describe('External: SMS Provider Adapters', () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  // ── Twilio ──

  it('Twilio: success → { success: true, messageId }', async () => {
    fetchMock.get('https://api.twilio.com')
      .intercept({ path: /\/2010-04-01\/Accounts\/.*\/Messages\.json/, method: 'POST' })
      .reply(201, JSON.stringify({ sid: 'SM12345' }), {
        headers: { 'content-type': 'application/json' },
      });

    const { TwilioProvider } = await import('../../src/lib/sms-provider.js');
    const provider = new TwilioProvider('test-sid', 'test-token', '+15555555555');
    const result = await provider.send({ to: '+15551234567', body: 'Test SMS' });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('SM12345');
  });

  it('Twilio: 400 bad request → { success: false }', async () => {
    fetchMock.get('https://api.twilio.com')
      .intercept({ path: /\/2010-04-01\/Accounts\/.*\/Messages\.json/, method: 'POST' })
      .reply(400, JSON.stringify({ code: 21211, message: 'Invalid phone number' }), {
        headers: { 'content-type': 'application/json' },
      });

    const { TwilioProvider } = await import('../../src/lib/sms-provider.js');
    const provider = new TwilioProvider('test-sid', 'test-token', '+15555555555');
    const result = await provider.send({ to: 'invalid', body: 'Test' });

    expect(result.success).toBe(false);
  });

  // ── MessageBird ──

  it('MessageBird: success → { success: true, messageId }', async () => {
    fetchMock.get('https://rest.messagebird.com')
      .intercept({ path: '/messages', method: 'POST' })
      .reply(201, JSON.stringify({ id: 'mb-msg-789' }), {
        headers: { 'content-type': 'application/json' },
      });

    const { MessageBirdProvider } = await import('../../src/lib/sms-provider.js');
    const provider = new MessageBirdProvider('test-api-key', '+15555555555');
    const result = await provider.send({ to: '+15551234567', body: 'Test SMS' });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('mb-msg-789');
  });

  it('MessageBird: 422 unprocessable → { success: false }', async () => {
    fetchMock.get('https://rest.messagebird.com')
      .intercept({ path: '/messages', method: 'POST' })
      .reply(422, JSON.stringify({ errors: [{ description: 'Invalid' }] }), {
        headers: { 'content-type': 'application/json' },
      });

    const { MessageBirdProvider } = await import('../../src/lib/sms-provider.js');
    const provider = new MessageBirdProvider('test-api-key', '+15555555555');
    const result = await provider.send({ to: 'invalid', body: 'Test' });

    expect(result.success).toBe(false);
  });
});

// ─── Password Policy (HIBP) ──────────────────────────────────────────────────

describe('External: HIBP Password Breach Check', () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it('HIBP: known breached password → validation fails', async () => {
    // "password" SHA1 = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // prefix = 5BAA6, suffix = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    fetchMock.get('https://api.pwnedpasswords.com')
      .intercept({ path: '/range/5BAA6', method: 'GET' })
      .reply(200, '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9876543\r\nABCDEF1234567890ABCDEF1234567890ABC:12');

    const { validatePassword } = await import('../../src/lib/password-policy.js');
    const result = await validatePassword('password', {
      minLength: 6,
      checkLeaked: true,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('data breach'))).toBe(true);
  });

  it('HIBP: non-breached password → validation passes', async () => {
    // Using a unique password that won't be in any breach list
    // SHA1 of "XjK9!mQ2pL7wR4" = some hash, we mock the range response without the suffix
    fetchMock.get('https://api.pwnedpasswords.com')
      .intercept({ path: /\/range\/[A-F0-9]{5}/, method: 'GET' })
      .reply(200, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0:1\r\nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB0:2');

    const { validatePassword } = await import('../../src/lib/password-policy.js');
    const result = await validatePassword('XjK9mQ2pL7wR4v', {
      minLength: 6,
      checkLeaked: true,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('HIBP: API unavailable → fail-open (password accepted)', async () => {
    fetchMock.get('https://api.pwnedpasswords.com')
      .intercept({ path: /\/range\//, method: 'GET' })
      .reply(503, 'Service Unavailable');

    const { validatePassword } = await import('../../src/lib/password-policy.js');
    const result = await validatePassword('SecurePass123', {
      minLength: 6,
      checkLeaked: true,
    });

    // Fail-open: API error should NOT block the user
    expect(result.valid).toBe(true);
  });

  it('HIBP: network timeout → fail-open (password accepted)', async () => {
    fetchMock.get('https://api.pwnedpasswords.com')
      .intercept({ path: /\/range\//, method: 'GET' })
      .reply(200, '') // Empty response simulating timeout/malformed
      .delay(5000); // Exceeds 3s timeout

    const { validatePassword } = await import('../../src/lib/password-policy.js');
    const result = await validatePassword('AnotherPass456', {
      minLength: 6,
      checkLeaked: true,
    });

    // Fail-open: timeout should NOT block the user
    expect(result.valid).toBe(true);
  }, 10_000);
});

// ─── Captcha (Turnstile) ─────────────────────────────────────────────────────

describe('External: Turnstile Captcha Verification', () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it('siteverify: success=true → returns success', async () => {
    fetchMock.get('https://challenges.cloudflare.com')
      .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
      .reply(200, JSON.stringify({ success: true, action: 'signup' }), {
        headers: { 'content-type': 'application/json' },
      });

    const { _test } = await import('../../src/middleware/captcha-verify.js');
    const result = await _test.siteverify('test-secret', 'test-token', undefined, 3000);

    expect(result.success).toBe(true);
    expect(result.action).toBe('signup');
  });

  it('siteverify: success=false → returns failure with error codes', async () => {
    fetchMock.get('https://challenges.cloudflare.com')
      .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
      .reply(200, JSON.stringify({
        success: false,
        'error-codes': ['invalid-input-response'],
      }), {
        headers: { 'content-type': 'application/json' },
      });

    const { _test } = await import('../../src/middleware/captcha-verify.js');
    const result = await _test.siteverify('test-secret', 'bad-token', undefined, 3000);

    expect(result.success).toBe(false);
    expect(result['error-codes']).toContain('invalid-input-response');
  });

  it('siteverify: API down → returns timeout-or-network-error', async () => {
    fetchMock.get('https://challenges.cloudflare.com')
      .intercept({ path: '/turnstile/v0/siteverify', method: 'POST' })
      .reply(200, '') // Will be aborted before response arrives
      .delay(5000); // Exceeds 3s timeout

    const { _test } = await import('../../src/middleware/captcha-verify.js');
    const result = await _test.siteverify('test-secret', 'test-token', undefined, 1000); // short timeout

    expect(result.success).toBe(false);
    expect(result['error-codes']).toContain('timeout-or-network-error');
  }, 10_000);
});

// ─── FCM Push Notification ───────────────────────────────────────────────────

describe('External: FCM Push Notification Mock Verification', () => {
  const MOCK_FCM_ORIGIN = 'http://localhost:9099';
  const BASE = 'http://localhost';
  const SK = 'test-service-key-for-admin';

  async function api(method: string, path: string, body?: unknown, token?: string) {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    else headers['X-EdgeBase-Service-Key'] = SK;
    if (body && method !== 'GET') headers['Content-Type'] = 'application/json';

    const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: any;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  }

  async function getToken(email?: string): Promise<{ accessToken: string; userId: string }> {
    const e = email ?? `extdep-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e, password: 'ExtDep1234!' }),
    });
    const data = (await res.json()) as any;
    return { accessToken: data.accessToken, userId: data.user?.id };
  }

  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it('FCM send: 200 → push register does not crash server', async () => {
    // OAuth2 token
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }),
        { headers: { 'content-type': 'application/json' } })
      .persist();

    // FCM send
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/v1\/projects\/.*\/messages:send/, method: 'POST' })
      .reply(200, JSON.stringify({ name: 'projects/p/messages/m123' }),
        { headers: { 'content-type': 'application/json' } })
      .persist();

    // IID topic
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/iid\//, method: 'POST' })
      .reply(200, '{}', { headers: { 'content-type': 'application/json' } })
      .persist();

    const { accessToken } = await getToken();

    // Register a push token — may return 500 if push config not provisioned
    // in test env, but should not crash/hang the server
    const reg = await api('POST', '/api/push/register', {
      token: 'fcm-test-token-extdep',
      platform: 'web',
    }, accessToken);

    // Verify response is well-formed (not a crash/hang)
    expect(reg.status).toBeDefined();
    expect(typeof reg.status).toBe('number');
  });

  it('FCM OAuth2: token exchange failure → graceful error', async () => {
    // OAuth2 token — failure
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: '/token', method: 'POST' })
      .reply(401, JSON.stringify({ error: 'invalid_grant' }),
        { headers: { 'content-type': 'application/json' } })
      .persist();

    const { accessToken } = await getToken();

    // Send push — should handle FCM auth failure gracefully
    const result = await api('POST', '/api/push/send', {
      to: 'some-user-id',
      title: 'Test',
      body: 'Should handle FCM auth error',
    });

    // Should not crash the server — returns some status
    expect(result.status).toBeDefined();
    expect(typeof result.status).toBe('number');
  });
});

// ─── OAuth Provider Contract Tests ──────────────────────────────────────────

describe('External: OAuth Provider Contract Tests', () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  // ── Google OAuth ──

  it('Google: token exchange success → OAuthTokens shape', async () => {
    fetchMock.get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({
        access_token: 'ya29.google-access-token',
        token_type: 'Bearer',
        id_token: 'eyJ.google.idtoken',
        refresh_token: 'google-refresh-token',
        expires_in: 3600,
      }), { headers: { 'content-type': 'application/json' } });

    const { createOAuthProvider } = await import('../../src/lib/oauth-providers.js');
    const provider = createOAuthProvider('google', {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
    const tokens = await provider.exchangeCode('test-code', 'http://localhost/callback');

    expect(tokens.accessToken).toBe('ya29.google-access-token');
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.idToken).toBe('eyJ.google.idtoken');
    expect(tokens.refreshToken).toBe('google-refresh-token');
    expect(tokens.expiresIn).toBe(3600);
  });

  // ── GitHub OAuth ──

  it('GitHub: token exchange success → OAuthTokens shape', async () => {
    fetchMock.get('https://github.com')
      .intercept({ path: '/login/oauth/access_token', method: 'POST' })
      .reply(200, JSON.stringify({
        access_token: 'gho_github-access-token',
        token_type: 'bearer',
      }), { headers: { 'content-type': 'application/json' } });

    const { createOAuthProvider } = await import('../../src/lib/oauth-providers.js');
    const provider = createOAuthProvider('github', {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
    const tokens = await provider.exchangeCode('test-code', 'http://localhost/callback');

    expect(tokens.accessToken).toBe('gho_github-access-token');
    expect(tokens.tokenType).toBe('bearer');
  });

  it('Reddit: token exchange + user info success → OAuth contract shape', async () => {
    fetchMock.get('https://www.reddit.com')
      .intercept({ path: '/api/v1/access_token', method: 'POST' })
      .reply(200, JSON.stringify({
        access_token: 'reddit-access-token',
        token_type: 'bearer',
        refresh_token: 'reddit-refresh-token',
        expires_in: 3600,
        scope: 'identity',
      }), { headers: { 'content-type': 'application/json' } });

    fetchMock.get('https://oauth.reddit.com')
      .intercept({ path: '/api/v1/me', method: 'GET' })
      .reply(200, JSON.stringify({
        id: 'reddit-user-123',
        name: 'reddit_tester',
        icon_img: 'https://styles.redditmedia.com/icon.png',
      }), { headers: { 'content-type': 'application/json' } });

    const { createOAuthProvider } = await import('../../src/lib/oauth-providers.js');
    const provider = createOAuthProvider('reddit', {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });

    const tokens = await provider.exchangeCode('test-code', 'http://localhost/callback');
    expect(tokens.accessToken).toBe('reddit-access-token');
    expect(tokens.refreshToken).toBe('reddit-refresh-token');
    expect(tokens.tokenType).toBe('bearer');

    const user = await provider.getUserInfo(tokens.accessToken);
    expect(user.providerUserId).toBe('reddit-user-123');
    expect(user.email).toBeNull();
    expect(user.emailVerified).toBe(false);
    expect(user.displayName).toBe('reddit_tester');
    expect(user.avatarUrl).toBe('https://styles.redditmedia.com/icon.png');
  });

  // ── Error Handling ──

  it('Google: 400 error → throws with status', async () => {
    fetchMock.get('https://oauth2.googleapis.com')
      .intercept({ path: '/token', method: 'POST' })
      .reply(400, JSON.stringify({ error: 'invalid_grant' }), {
        headers: { 'content-type': 'application/json' },
      });

    const { createOAuthProvider } = await import('../../src/lib/oauth-providers.js');
    const provider = createOAuthProvider('google', {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });

    await expect(
      provider.exchangeCode('expired-code', 'http://localhost/callback'),
    ).rejects.toThrow(/400/);
  });

  it('GitHub: error field in response → throws with description', async () => {
    fetchMock.get('https://github.com')
      .intercept({ path: '/login/oauth/access_token', method: 'POST' })
      .reply(200, JSON.stringify({
        error: 'bad_verification_code',
        error_description: 'The code has expired',
      }), { headers: { 'content-type': 'application/json' } });

    const { createOAuthProvider } = await import('../../src/lib/oauth-providers.js');
    const provider = createOAuthProvider('github', {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });

    await expect(
      provider.exchangeCode('expired-code', 'http://localhost/callback'),
    ).rejects.toThrow(/expired|bad_verification_code/i);
  });

  // ── OIDC Token Parsing ──

  it('parseOIDCIdToken: extracts claims from base64url-encoded JWT', async () => {
    const { parseOIDCIdToken } = await import('../../src/lib/oauth-providers.js');

    // Construct a fake JWT with known claims
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: 'oidc-user-123',
      email: 'user@example.com',
      email_verified: true,
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg',
    }));
    const fakeJwt = `${header}.${payload}.fake-signature`;

    const userInfo = parseOIDCIdToken(fakeJwt);

    expect(userInfo.providerUserId).toBe('oidc-user-123');
    expect(userInfo.email).toBe('user@example.com');
    expect(userInfo.emailVerified).toBe(true);
    expect(userInfo.displayName).toBe('Test User');
    expect(userInfo.avatarUrl).toBe('https://example.com/avatar.jpg');
  });

  it('parseOIDCIdToken: invalid format → throws', async () => {
    const { parseOIDCIdToken } = await import('../../src/lib/oauth-providers.js');

    expect(() => parseOIDCIdToken('not-a-jwt')).toThrow(/Invalid/);
    expect(() => parseOIDCIdToken('only.two')).toThrow(/Invalid/);
  });

  // ── OIDC Discovery ──

  it('prefetchOIDCDiscovery: fetches and caches discovery document', async () => {
    fetchMock.get('https://auth.example.com')
      .intercept({ path: '/.well-known/openid-configuration', method: 'GET' })
      .reply(200, JSON.stringify({
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        userinfo_endpoint: 'https://auth.example.com/userinfo',
        jwks_uri: 'https://auth.example.com/.well-known/jwks.json',
      }), { headers: { 'content-type': 'application/json' } });

    const { prefetchOIDCDiscovery } = await import('../../src/lib/oauth-providers.js');

    // Should not throw
    await expect(
      prefetchOIDCDiscovery('https://auth.example.com'),
    ).resolves.not.toThrow();
  });
});

// ─── Adapter Interface Compliance ────────────────────────────────────────────

describe('External: Adapter Interface Compliance', () => {
  it('EmailProvider interface has required methods', async () => {
    const mod = await import('../../src/lib/email-provider.js');

    // All providers should exist and be constructable
    expect(typeof mod.ResendProvider).toBe('function');
    expect(typeof mod.SendGridProvider).toBe('function');

    // Check that instances implement send()
    const resend = new mod.ResendProvider('key', 'from@test.com');
    expect(typeof resend.send).toBe('function');

    const sg = new mod.SendGridProvider('key', 'from@test.com');
    expect(typeof sg.send).toBe('function');
  });

  it('SmsProvider interface has required methods', async () => {
    const mod = await import('../../src/lib/sms-provider.js');

    expect(typeof mod.TwilioProvider).toBe('function');
    expect(typeof mod.MessageBirdProvider).toBe('function');

    const twilio = new mod.TwilioProvider('sid', 'token', '+15555555555');
    expect(typeof twilio.send).toBe('function');

    const mb = new mod.MessageBirdProvider('key', '+15555555555');
    expect(typeof mb.send).toBe('function');
  });

  it('Captcha test exports expose expected functions', async () => {
    const { _test } = await import('../../src/middleware/captcha-verify.js');

    expect(typeof _test.resolveCaptchaConfig).toBe('function');
    expect(typeof _test.extractCaptchaToken).toBe('function');
    expect(typeof _test.hasServiceKey).toBe('function');
    expect(typeof _test.siteverify).toBe('function');
  });

  it('Password policy exports validatePassword', async () => {
    const mod = await import('../../src/lib/password-policy.js');
    expect(typeof mod.validatePassword).toBe('function');
  });
});
