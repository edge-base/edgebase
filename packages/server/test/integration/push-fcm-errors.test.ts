/**
 * Push FCM Error Scenario Tests — fetchMock 기반
 *
 * FCM이 에러를 반환할 때의 동작을 테스트한다.
 * 별도 파일로 분리해야 fetchMock의 persist 상태가
 * 성공 시나리오 테스트와 충돌하지 않는다.
 *
 * Mock origin은 edgebase.test.config.js의 endpoints와 일치 (localhost:9099).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchMock } from 'cloudflare:test';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
const MOCK_FCM_ORIGIN = 'http://localhost:9099';

// ─── Helpers ───

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
  const e = email ?? `push-err-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Push1234!' }),
  });
  const data = (await res.json()) as any;
  return { accessToken: data.accessToken, userId: data.user?.id };
}

// ─── FCM 404 → Token Auto-Cleanup ───

describe('push — FCM 404 → token cleanup', () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();

    // OAuth2 — always success
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }),
        { headers: { 'content-type': 'application/json' } })
      .persist();

    // FCM — 404 (token invalid)
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/v1\/projects\/.*\/messages:send/, method: 'POST' })
      .reply(404, '{}', { headers: { 'content-type': 'application/json' } })
      .persist();

    // IID — always success
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/iid\//, method: 'POST' })
      .reply(200, '{}', { headers: { 'content-type': 'application/json' } })
      .persist();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it('FCM 404 응답 → 토큰 자동 정리', async () => {
    const { accessToken, userId } = await getToken();

    // Register stores to KV (IID subscribe best-effort, register always succeeds)
    const reg = await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'bad-token', platform: 'web',
    }, accessToken);
    expect(reg.status).toBe(200);

    // Verify token was stored
    const tokensBefore = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokensBefore.data.items).toHaveLength(1);

    // Send — FCM returns 404 → should remove the token
    const send = await api('POST', '/api/push/send', {
      userId,
      payload: { title: 'Test', body: 'Cleanup' },
    });
    expect(send.status).toBe(200);
    expect(send.data.removed).toBe(1);

    // Token should be cleaned up from KV
    const tokensAfter = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokensAfter.data.items).toHaveLength(0);
  });
});

// ─── FCM 500 → send-to-token Failure ───

describe('push — FCM 500 → send-to-token failure', () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();

    // OAuth2 — always success
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }),
        { headers: { 'content-type': 'application/json' } })
      .persist();

    // FCM — 500 (server error)
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/v1\/projects\/.*\/messages:send/, method: 'POST' })
      .reply(500, '{}', { headers: { 'content-type': 'application/json' } })
      .persist();

    // IID — always success
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/iid\//, method: 'POST' })
      .reply(200, '{}', { headers: { 'content-type': 'application/json' } })
      .persist();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  it('send-to-token FCM 실패 → { sent: 0, failed: 1, error }', async () => {
    const send = await api('POST', '/api/push/send-to-token', {
      token: 'bad-token',
      payload: { title: 'Fail', body: 'Test' },
    });
    expect(send.status).toBe(200);
    expect(send.data.sent).toBe(0);
    expect(send.data.failed).toBe(1);
    expect(send.data.error).toBeDefined();
  });
});

// ─── FCM 410 (Gone) → Token Auto-Cleanup ───

describe('push — FCM 410 → token cleanup', () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }),
        { headers: { 'content-type': 'application/json' } })
      .persist();
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/v1\/projects\/.*\/messages:send/, method: 'POST' })
      .reply(410, '{}', { headers: { 'content-type': 'application/json' } })
      .persist();
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/iid\//, method: 'POST' })
      .reply(200, '{}', { headers: { 'content-type': 'application/json' } })
      .persist();
  });
  afterEach(() => { fetchMock.deactivate(); });

  it('FCM 410 → remove:true → 토큰 자동 정리', async () => {
    const { accessToken, userId } = await getToken();
    await api('POST', '/api/push/register', {
      deviceId: 'dev-410', token: 'gone-token', platform: 'web',
    }, accessToken);

    const send = await api('POST', '/api/push/send', {
      userId, payload: { title: 'Gone', body: 'Test' },
    });
    expect(send.data.removed).toBe(1);

    const tokens = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokens.data.items).toHaveLength(0);
  });
});

// ─── FCM 400 + UNREGISTERED → Token Auto-Cleanup ───

describe('push — FCM 400 UNREGISTERED → token cleanup', () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }),
        { headers: { 'content-type': 'application/json' } })
      .persist();
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/v1\/projects\/.*\/messages:send/, method: 'POST' })
      .reply(400,
        JSON.stringify({ error: { code: 400, details: [{ errorCode: 'UNREGISTERED' }] } }),
        { headers: { 'content-type': 'application/json' } })
      .persist();
    fetchMock.get(MOCK_FCM_ORIGIN)
      .intercept({ path: /\/iid\//, method: 'POST' })
      .reply(200, '{}', { headers: { 'content-type': 'application/json' } })
      .persist();
  });
  afterEach(() => { fetchMock.deactivate(); });

  it('FCM 400 UNREGISTERED → remove:true → 토큰 자동 정리', async () => {
    const { accessToken, userId } = await getToken();
    await api('POST', '/api/push/register', {
      deviceId: 'dev-unreg', token: 'unregistered-token', platform: 'android',
    }, accessToken);

    const send = await api('POST', '/api/push/send', {
      userId, payload: { title: 'Unreg', body: 'Test' },
    });
    expect(send.data.removed).toBe(1);

    const tokens = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokens.data.items).toHaveLength(0);
  });
});

