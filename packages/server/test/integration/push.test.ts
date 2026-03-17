/**
 * Push Notification Integration Tests — fetchMock 기반 FCM Mocking
 *
 * edgebase.test.config.js의 endpoints 설정으로 FCM 관련 URL이
 * localhost:9099를 가리킨다. fetchMock이 해당 origin을 가로채서
 * register → KV 저장 → send → FCM mock → 토큰 정리 → 로그 기록까지
 * 전체 push 흐름을 테스트한다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchMock } from 'cloudflare:test';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
const utf8Encoder = new TextEncoder();

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
  const e = email ?? `push-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Push1234!' }),
  });
  const data = (await res.json()) as any;
  return { accessToken: data.accessToken, userId: data.user?.id };
}

function createOversizedMultibyteMetadata() {
  return { note: '한'.repeat(400) };
}

// ─── Mock Setup ───
// Matches edgebase.test.config.js push.fcm.endpoints (localhost:9099)
const MOCK_FCM_ORIGIN = 'http://localhost:9099';

function setupFcmMocks() {
  fetchMock.activate();
  fetchMock.disableNetConnect();

  // OAuth2 token exchange (mock endpoint)
  fetchMock.get(MOCK_FCM_ORIGIN)
    .intercept({ path: '/token', method: 'POST' })
    .reply(200, JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }),
      { headers: { 'content-type': 'application/json' } })
    .persist();

  // FCM HTTP v1 send (mock endpoint)
  fetchMock.get(MOCK_FCM_ORIGIN)
    .intercept({ path: /\/v1\/projects\/.*\/messages:send/, method: 'POST' })
    .reply(200, JSON.stringify({ name: 'projects/test-project/messages/fake-123' }),
      { headers: { 'content-type': 'application/json' } })
    .persist();

  // IID topic subscribe/unsubscribe (mock endpoint)
  fetchMock.get(MOCK_FCM_ORIGIN)
    .intercept({ path: /\/iid\//, method: 'POST' })
    .reply(200, '{}', { headers: { 'content-type': 'application/json' } })
    .persist();
}

// ─── Tests ───

describe('push — full flow (fetchMock)', () => {
  beforeEach(() => {
    setupFcmMocks();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  // ─── A. Token Registration & Storage ───

  it('register → 200 + GET /tokens 확인', async () => {
    const { accessToken, userId } = await getToken();

    const reg = await api('POST', '/api/push/register', {
      deviceId: 'dev-1',
      token: 'fcm-token-aaa',
      platform: 'web',
    }, accessToken);
    expect(reg.status).toBe(200);
    expect(reg.data.ok).toBe(true);

    // Verify KV storage via GET /tokens
    const tokens = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokens.status).toBe(200);
    expect(tokens.data.items).toHaveLength(1);
    expect(tokens.data.items[0].deviceId).toBe('dev-1');
    expect(tokens.data.items[0].token).toBe('fcm-token-aaa');
    expect(tokens.data.items[0].platform).toBe('web');
  });

  it('같은 유저 두번째 디바이스 등록 → 배열 2개', async () => {
    const { accessToken, userId } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'fcm-1', platform: 'web',
    }, accessToken);
    await api('POST', '/api/push/register', {
      deviceId: 'dev-2', token: 'fcm-2', platform: 'android',
    }, accessToken);

    const tokens = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokens.data.items).toHaveLength(2);
  });

  it('동일 deviceId 재등록 → 토큰 업데이트', async () => {
    const { accessToken, userId } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'old-token', platform: 'web',
    }, accessToken);
    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'new-token', platform: 'web',
    }, accessToken);

    const tokens = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokens.data.items).toHaveLength(1);
    expect(tokens.data.items[0].token).toBe('new-token');
  });

  it('11번째 디바이스 등록 → max 10, 가장 오래된 것 제거', async () => {
    const { accessToken, userId } = await getToken();

    for (let i = 1; i <= 11; i++) {
      await api('POST', '/api/push/register', {
        deviceId: `dev-${i}`, token: `fcm-${i}`, platform: 'web',
      }, accessToken);
    }

    const tokens = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokens.data.items).toHaveLength(10);
    // dev-1 (oldest) should be evicted
    const ids = tokens.data.items.map((d: any) => d.deviceId);
    expect(ids).not.toContain('dev-1');
    expect(ids).toContain('dev-11');
  });

  it('인증 없이 register → 401', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 'd', token: 't', platform: 'web' }),
    });
    expect(res.status).toBe(401);
  });

  it('register rejects metadata that exceeds 1KB in UTF-8 bytes', async () => {
    const { accessToken } = await getToken();
    const metadata = createOversizedMultibyteMetadata();

    expect(JSON.stringify(metadata).length).toBeLessThan(1024);
    expect(utf8Encoder.encode(JSON.stringify(metadata)).length).toBeGreaterThan(1024);

    const reg = await api('POST', '/api/push/register', {
      deviceId: 'dev-utf8-register',
      token: 'fcm-token-utf8-register',
      platform: 'web',
      metadata,
    }, accessToken);

    expect(reg.status).toBe(400);
    expect(reg.data.message).toContain('metadata exceeds 1024 byte limit');
  });

  // ─── B. Token Unregistration ───

  it('unregister → 200 + GET /tokens에서 사라짐', async () => {
    const { accessToken, userId } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'fcm-1', platform: 'web',
    }, accessToken);
    await api('POST', '/api/push/register', {
      deviceId: 'dev-2', token: 'fcm-2', platform: 'android',
    }, accessToken);

    const unreg = await api('POST', '/api/push/unregister', {
      deviceId: 'dev-1',
    }, accessToken);
    expect(unreg.status).toBe(200);

    const tokens = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokens.data.items).toHaveLength(1);
    expect(tokens.data.items[0].deviceId).toBe('dev-2');
  });

  it('존재하지 않는 deviceId unregister → 200 (idempotent)', async () => {
    const { accessToken } = await getToken();

    const unreg = await api('POST', '/api/push/unregister', {
      deviceId: 'nonexistent',
    }, accessToken);
    expect(unreg.status).toBe(200);
  });

  // ─── C. Send to User ───

  it('1대 등록 + send → { sent: 1, failed: 0 }', async () => {
    const { accessToken, userId } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'fcm-1', platform: 'web',
    }, accessToken);

    const send = await api('POST', '/api/push/send', {
      userId,
      payload: { title: 'Hello', body: 'World' },
    });
    expect(send.status).toBe(200);
    expect(send.data.sent).toBe(1);
    expect(send.data.failed).toBe(0);
  });

  it('2대 등록 + send → { sent: 2, failed: 0 }', async () => {
    const { accessToken, userId } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'fcm-1', platform: 'web',
    }, accessToken);
    await api('POST', '/api/push/register', {
      deviceId: 'dev-2', token: 'fcm-2', platform: 'android',
    }, accessToken);

    const send = await api('POST', '/api/push/send', {
      userId,
      payload: { title: 'Multi', body: 'Device' },
    });
    expect(send.status).toBe(200);
    expect(send.data.sent).toBe(2);
    expect(send.data.failed).toBe(0);
  });

  // FCM 404 test moved to separate describe block below (requires different mock setup)

  it('미등록 유저에게 send → { sent: 0, failed: 0 }', async () => {
    const send = await api('POST', '/api/push/send', {
      userId: 'no-such-user',
      payload: { title: 'Test', body: 'Nobody' },
    });
    expect(send.status).toBe(200);
    expect(send.data.sent).toBe(0);
    expect(send.data.failed).toBe(0);
  });

  // ─── D. Send to Token (#140) ───

  it('send-to-token → { sent: 1, failed: 0 }', async () => {
    const send = await api('POST', '/api/push/send-to-token', {
      token: 'any-fcm-token',
      payload: { title: 'Direct', body: 'Send' },
    });
    expect(send.status).toBe(200);
    expect(send.data.sent).toBe(1);
    expect(send.data.failed).toBe(0);
  });

  // send-to-token FCM failure test moved to separate describe block below

  // ─── E. Send Many ───

  it('2명 각 1대 → send-many → sent 합산', async () => {
    const u1 = await getToken();
    const u2 = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-a', token: 'fcm-a', platform: 'web',
    }, u1.accessToken);
    await api('POST', '/api/push/register', {
      deviceId: 'dev-b', token: 'fcm-b', platform: 'android',
    }, u2.accessToken);

    const send = await api('POST', '/api/push/send-many', {
      userIds: [u1.userId, u2.userId],
      payload: { title: 'Bulk', body: 'Notification' },
    });
    expect(send.status).toBe(200);
    expect(send.data.sent).toBe(2);
    expect(send.data.failed).toBe(0);
  });

  // ─── F. Topics ───

  it('topic/subscribe → 200', async () => {
    const { accessToken } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'fcm-1', platform: 'web',
    }, accessToken);

    const sub = await api('POST', '/api/push/topic/subscribe', {
      topic: 'news',
    }, accessToken);
    expect(sub.status).toBe(200);
  });

  it('topic/unsubscribe → 200', async () => {
    const { accessToken } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'fcm-1', platform: 'web',
    }, accessToken);

    const unsub = await api('POST', '/api/push/topic/unsubscribe', {
      topic: 'news',
    }, accessToken);
    expect(unsub.status).toBe(200);
  });

  it('send-to-topic → 200', async () => {
    const send = await api('POST', '/api/push/send-to-topic', {
      topic: 'news',
      payload: { title: 'Topic', body: 'Message' },
    });
    expect(send.status).toBe(200);
  });

  it('broadcast → 200', async () => {
    const send = await api('POST', '/api/push/broadcast', {
      payload: { title: 'Broadcast', body: 'All' },
    });
    expect(send.status).toBe(200);
  });

  // ─── G. Logs ───

  it('send 후 GET /logs → 로그 엔트리 존재', async () => {
    const { accessToken, userId } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'fcm-1', platform: 'web',
    }, accessToken);

    await api('POST', '/api/push/send', {
      userId,
      payload: { title: 'Log', body: 'Test' },
    });

    const logs = await api('GET', `/api/push/logs?userId=${userId}`);
    expect(logs.status).toBe(200);
    expect(logs.data.items.length).toBeGreaterThanOrEqual(1);
    expect(logs.data.items[0].status).toBe('sent');
    expect(logs.data.items[0].userId).toBe(userId);
  });

  // ─── H. PATCH /tokens (metadata) ───

  it('PATCH /tokens → metadata 업데이트', async () => {
    const { accessToken, userId } = await getToken();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-1', token: 'fcm-1', platform: 'web',
    }, accessToken);

    const patch = await api('PATCH', '/api/push/tokens', {
      userId,
      deviceId: 'dev-1',
      metadata: { lang: 'ko', theme: 'dark' },
    });
    expect(patch.status).toBe(200);

    const tokens = await api('GET', `/api/push/tokens?userId=${userId}`);
    expect(tokens.data.items[0].metadata).toEqual({ lang: 'ko', theme: 'dark' });
  });

  it('PUT /tokens rejects metadata that exceeds 1KB in UTF-8 bytes', async () => {
    const { userId } = await getToken();
    const metadata = createOversizedMultibyteMetadata();

    const put = await api('PUT', '/api/push/tokens', {
      userId,
      deviceId: 'dev-utf8-put',
      token: 'fcm-token-utf8-put',
      platform: 'web',
      metadata,
    });

    expect(put.status).toBe(400);
    expect(put.data.message).toContain('metadata exceeds 1024 byte limit');
  });

  it('PATCH /tokens rejects metadata that exceeds 1KB in UTF-8 bytes', async () => {
    const { accessToken, userId } = await getToken();
    const metadata = createOversizedMultibyteMetadata();

    await api('POST', '/api/push/register', {
      deviceId: 'dev-utf8-patch',
      token: 'fcm-token-utf8-patch',
      platform: 'web',
    }, accessToken);

    const patch = await api('PATCH', '/api/push/tokens', {
      userId,
      deviceId: 'dev-utf8-patch',
      metadata,
    });

    expect(patch.status).toBe(400);
    expect(patch.data.message).toContain('metadata exceeds 1024 byte limit');
  });
});

// ─── FCM Error Scenarios → see push-fcm-errors.test.ts ───
