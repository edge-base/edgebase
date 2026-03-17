/**
 * Auto-generated smoke tests for tag: admin
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

describe('Smoke: admin', () => {
  it('adminAuthGetUser: GET /api/auth/admin/users/{id} → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/admin/users/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthUpdateUser: PATCH /api/auth/admin/users/{id} → not 5xx', async () => {
    const { status, data } = await api('PATCH', '/api/auth/admin/users/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke-updated@test.com" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthUpdateUser: bad input → 400', async () => {
    const { status } = await api('PATCH', '/api/auth/admin/users/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminAuthDeleteUser: DELETE /api/auth/admin/users/{id} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/auth/admin/users/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthListUsers: GET /api/auth/admin/users → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/auth/admin/users', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthCreateUser: POST /api/auth/admin/users → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/admin/users', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: `smoke-admin-${Date.now()}@test.com`, password: "Admin1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthCreateUser: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/admin/users', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminAuthDeleteUserMfa: DELETE /api/auth/admin/users/{id}/mfa → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/api/auth/admin/users/smoke-test-id-000/mfa', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthSetClaims: PUT /api/auth/admin/users/{id}/claims → not 5xx', async () => {
    const { status, data } = await api('PUT', '/api/auth/admin/users/smoke-test-id-000/claims', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { claims: { role: "smoke" } },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthRevokeUserSessions: POST /api/auth/admin/users/{id}/revoke → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/admin/users/smoke-test-id-000/revoke', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthImportUsers: POST /api/auth/admin/users/import → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/auth/admin/users/import', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { users: [] },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminAuthImportUsers: bad input → 400', async () => {
    const { status } = await api('POST', '/api/auth/admin/users/import', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('databaseLiveBroadcast: POST /api/db/broadcast → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/db/broadcast', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('databaseLiveBroadcast: bad input → 400', async () => {
    const { status } = await api('POST', '/api/db/broadcast', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('executeSql: POST /api/sql → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/sql', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { namespace: "shared", sql: "SELECT 1" },
    });
    expect(status).toBeLessThan(500);
  });

  it('executeSql: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/sql', {
      body: { namespace: "shared", sql: "SELECT 1" },
    });
    expect([401, 403]).toContain(status);
  });

  it('executeSql: bad input → 400', async () => {
    const { status } = await api('POST', '/api/sql', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('kvOperation: POST /api/kv/{namespace} → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/kv/test', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { action: "get", key: "smoke-key" },
    });
    expect(status).toBeLessThan(500);
  });

  it('kvOperation: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/kv/test', {
      body: { action: "get", key: "smoke-key" },
    });
    expect([401, 403]).toContain(status);
  });

  it('kvOperation: bad input → 400', async () => {
    const { status } = await api('POST', '/api/kv/test', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('executeD1Query: POST /api/d1/{database} → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/d1/analytics', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { query: "SELECT 1" },
    });
    expect(status).toBeLessThan(500);
  });

  it('executeD1Query: no auth → 401/403', async () => {
    const { status } = await api('POST', '/api/d1/analytics', {
      body: { query: "SELECT 1" },
    });
    expect([401, 403]).toContain(status);
  });

  it('executeD1Query: bad input → 400', async () => {
    const { status } = await api('POST', '/api/d1/analytics', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('vectorizeOperation: POST /api/vectorize/{index} → not 5xx', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { operation: "query", vector: [0.1, 0.2, 0.3] },
    });
    expect(status).toBeLessThan(500);
  });

  it('vectorizeOperation: bad input → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('pushSend: POST /api/push/send → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/send', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { userId: "smoke-user", payload: { title: "smoke", body: "test" } },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushSend: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/send', {
      body: { userId: "smoke-user", payload: { title: "smoke", body: "test" } },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushSend: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/send', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('pushSendMany: POST /api/push/send-many → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/send-many', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { userIds: ["smoke-user"], payload: { title: "smoke", body: "test" } },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushSendMany: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/send-many', {
      body: { userIds: ["smoke-user"], payload: { title: "smoke", body: "test" } },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushSendMany: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/send-many', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('pushSendToToken: POST /api/push/send-to-token → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/send-to-token', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { token: "smoke-push-token", platform: "web", payload: { title: "smoke", body: "test" } },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushSendToToken: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/send-to-token', {
      body: { token: "smoke-push-token", platform: "web", payload: { title: "smoke", body: "test" } },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushSendToToken: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/send-to-token', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('pushSendToTopic: POST /api/push/send-to-topic → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/send-to-topic', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { topic: "smoke-topic", payload: { title: "smoke", body: "test" } },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushSendToTopic: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/send-to-topic', {
      body: { topic: "smoke-topic", payload: { title: "smoke", body: "test" } },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushSendToTopic: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/send-to-topic', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('pushBroadcast: POST /api/push/broadcast → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/api/push/broadcast', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { payload: { title: "smoke", body: "test" } },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('pushBroadcast: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/broadcast', {
      body: { payload: { title: "smoke", body: "test" } },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('pushBroadcast: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/api/push/broadcast', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('getPushLogs: GET /api/push/logs → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('GET', '/api/push/logs?userId=smoke-user', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('getPushLogs: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('GET', '/api/push/logs?userId=smoke-user');
    expect([401, 403]).toContain(status);
    });
  });

  it('getPushTokens: GET /api/push/tokens → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('GET', '/api/push/tokens?userId=smoke-user', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('getPushTokens: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('GET', '/api/push/tokens?userId=smoke-user');
    expect([401, 403]).toContain(status);
    });
  });

  it('putPushTokens: PUT /api/push/tokens → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('PUT', '/api/push/tokens', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { userId: "smoke-user", deviceId: "smoke-device-1", token: "smoke-push-token", platform: "web" },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('putPushTokens: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('PUT', '/api/push/tokens', {
      body: { userId: "smoke-user", deviceId: "smoke-device-1", token: "smoke-push-token", platform: "web" },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('putPushTokens: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('PUT', '/api/push/tokens', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('patchPushTokens: PATCH /api/push/tokens → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('PATCH', '/api/push/tokens', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { userId: "smoke-user", deviceId: "smoke-device-1", metadata: { source: "smoke" } },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('patchPushTokens: no auth → 401/403', async () => {
    await withPushMocks(async () => {
    const { status } = await api('PATCH', '/api/push/tokens', {
      body: { userId: "smoke-user", deviceId: "smoke-device-1", metadata: { source: "smoke" } },
    });
    expect([401, 403]).toContain(status);
    });
  });

  it('patchPushTokens: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('PATCH', '/api/push/tokens', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('queryAnalytics: GET /api/analytics/query → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/analytics/query', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('queryAnalytics: no auth → 401/403', async () => {
    const { status } = await api('GET', '/api/analytics/query');
    expect([401, 403]).toContain(status);
  });

  it('queryCustomEvents: GET /api/analytics/events → not 5xx', async () => {
    const { status, data } = await api('GET', '/api/analytics/events', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('queryCustomEvents: no auth → 401/403', async () => {
    const { status } = await api('GET', '/api/analytics/events');
    expect([401, 403]).toContain(status);
  });

  it('adminSetupStatus: GET /admin/api/setup/status → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/setup/status', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminSetup: POST /admin/api/setup → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/setup', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "admin@test.com", password: "Admin1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminSetup: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/setup', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminLogin: POST /admin/api/auth/login → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/auth/login', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "admin@test.com", password: "Admin1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminLogin: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/auth/login', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminRefresh: POST /admin/api/auth/refresh → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/auth/refresh', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { refreshToken: "smoke-refresh" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminRefresh: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/auth/refresh', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminResetPassword: POST /admin/api/internal/reset-password → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/internal/reset-password', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { token: "smoke-token", password: "Reset1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminResetPassword: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/internal/reset-password', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminListTables: GET /admin/api/data/tables → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/tables', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetTableRecords: GET /admin/api/data/tables/{name}/records → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/tables/posts/records', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCreateTableRecord: POST /admin/api/data/tables/{name}/records → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/tables/categories/records', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { name: `smoke-category-${Date.now()}`, slug: `smoke-category-${Date.now()}` },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCreateTableRecord: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/tables/categories/records', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminUpdateTableRecord: PUT /admin/api/data/tables/{name}/records/{id} → not 5xx', async () => {
    const { status, data } = await api('PUT', '/admin/api/data/tables/posts/records/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { title: "smoke-updated" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminUpdateTableRecord: bad input → 400', async () => {
    const { status } = await api('PUT', '/admin/api/data/tables/posts/records/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminDeleteTableRecord: DELETE /admin/api/data/tables/{name}/records/{id} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/admin/api/data/tables/posts/records/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminListUsers: GET /admin/api/data/users → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/users', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCreateUser: POST /admin/api/data/users → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/users', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: `smoke-admin-${Date.now()}@test.com`, password: "Admin1234!" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCreateUser: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/users', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminGetUser: GET /admin/api/data/users/{id} → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/users/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminUpdateUser: PUT /admin/api/data/users/{id} → not 5xx', async () => {
    const { status, data } = await api('PUT', '/admin/api/data/users/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { email: "smoke-updated@test.com" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminUpdateUser: bad input → 400', async () => {
    const { status } = await api('PUT', '/admin/api/data/users/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminDeleteUser: DELETE /admin/api/data/users/{id} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/admin/api/data/users/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetUserProfile: GET /admin/api/data/users/{id}/profile → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/users/smoke-test-id-000/profile', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminDeleteUserSessions: DELETE /admin/api/data/users/{id}/sessions → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/admin/api/data/users/smoke-test-id-000/sessions', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCleanupAnon: POST /admin/api/data/cleanup-anon → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/cleanup-anon', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminListBuckets: GET /admin/api/data/storage/buckets → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/storage/buckets', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminListBucketObjects: GET /admin/api/data/storage/buckets/{name}/objects → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/storage/buckets/documents/objects', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetBucketObject: GET /admin/api/data/storage/buckets/{name}/objects/{key} → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/storage/buckets/documents/objects/smoke-test-file.txt', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminDeleteBucketObject: DELETE /admin/api/data/storage/buckets/{name}/objects/{key} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/admin/api/data/storage/buckets/documents/objects/smoke-test-file.txt', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetBucketStats: GET /admin/api/data/storage/buckets/{name}/stats → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/storage/buckets/documents/stats', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCreateSignedUrl: POST /admin/api/data/storage/buckets/{name}/signed-url → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/storage/buckets/documents/signed-url', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCreateSignedUrl: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/storage/buckets/documents/signed-url', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminGetSchema: GET /admin/api/data/schema → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/schema', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminExportTable: GET /admin/api/data/tables/{name}/export → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/tables/posts/export', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetLogs: GET /admin/api/data/logs → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/logs', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetMonitoring: GET /admin/api/data/monitoring → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/monitoring', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetAnalytics: GET /admin/api/data/analytics → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/analytics', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetAnalyticsEvents: GET /admin/api/data/analytics/events → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/analytics/events', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetOverview: GET /admin/api/data/overview → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/overview', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetDevInfo: GET /admin/api/data/dev-info → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/dev-info', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminExecuteSql: POST /admin/api/data/sql → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/sql', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { namespace: "shared", sql: "SELECT 1" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminExecuteSql: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/sql', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminImportTable: POST /admin/api/data/tables/{name}/import → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/tables/posts/import', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { records: [] },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminImportTable: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/tables/posts/import', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminRulesTest: POST /admin/api/data/rules-test → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/rules-test', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { rules: "true", method: "GET", path: "/api/test" },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminRulesTest: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/rules-test', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminListFunctions: GET /admin/api/data/functions → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/functions', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetConfigInfo: GET /admin/api/data/config-info → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/config-info', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetRecentLogs: GET /admin/api/data/logs/recent → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/logs/recent', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetAuthSettings: GET /admin/api/data/auth/settings → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/auth/settings', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminGetEmailTemplates: GET /admin/api/data/email/templates → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/email/templates', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminDeleteUserMfa: DELETE /admin/api/data/users/{id}/mfa → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/admin/api/data/users/smoke-test-id-000/mfa', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminSendPasswordReset: POST /admin/api/data/users/{id}/send-password-reset → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/users/smoke-test-id-000/send-password-reset', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminUploadFile: POST /admin/api/data/storage/buckets/{name}/upload → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/storage/buckets/documents/upload', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('adminUploadFile: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/storage/buckets/documents/upload', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminGetPushTokens: GET /admin/api/data/push/tokens → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('GET', '/admin/api/data/push/tokens?userId=smoke-user', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('adminGetPushLogs: GET /admin/api/data/push/logs → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('GET', '/admin/api/data/push/logs?userId=smoke-user', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('adminTestPushSend: POST /admin/api/data/push/test-send → not 5xx', async () => {
    await withPushMocks(async () => {
    const { status, data } = await api('POST', '/admin/api/data/push/test-send', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { userId: "smoke-user", title: "smoke", body: "test" },
    });
    expect(status).toBeLessThan(500);
    });
  });

  it('adminTestPushSend: bad input → 400', async () => {
    await withPushMocks(async () => {
    const { status } = await api('POST', '/admin/api/data/push/test-send', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    });
  });

  it('adminBackupListDOs: POST /admin/api/data/backup/list-dos → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/backup/list-dos', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminBackupDumpDO: POST /admin/api/data/backup/dump-do → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/backup/dump-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('adminBackupDumpDO: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/backup/dump-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminBackupRestoreDO: POST /admin/api/data/backup/restore-do → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/backup/restore-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('adminBackupRestoreDO: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/backup/restore-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminBackupDumpD1: POST /admin/api/data/backup/dump-d1 → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/backup/dump-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminBackupRestoreD1: POST /admin/api/data/backup/restore-d1 → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/backup/restore-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('adminBackupRestoreD1: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/backup/restore-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminBackupGetConfig: GET /admin/api/data/backup/config → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/backup/config', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminListAdmins: GET /admin/api/data/admins → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/data/admins', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCreateAdmin: POST /admin/api/data/admins → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/data/admins', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('adminCreateAdmin: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/data/admins', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('adminDeleteAdmin: DELETE /admin/api/data/admins/{id} → not 5xx', async () => {
    const { status, data } = await api('DELETE', '/admin/api/data/admins/smoke-test-id-000', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('adminChangePassword: PUT /admin/api/data/admins/{id}/password → not 5xx', async () => {
    const { status, data } = await api('PUT', '/admin/api/data/admins/smoke-test-id-000/password', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('adminChangePassword: bad input → 400', async () => {
    const { status } = await api('PUT', '/admin/api/data/admins/smoke-test-id-000/password', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupListDOs: POST /admin/api/backup/list-dos → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/list-dos', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { namespaces: ["shared"] },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupGetConfig: GET /admin/api/backup/config → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/backup/config', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupCleanupPlugin: POST /admin/api/backup/cleanup-plugin → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/cleanup-plugin', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('backupCleanupPlugin: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/backup/cleanup-plugin', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupWipeDO: POST /admin/api/backup/wipe-do → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/wipe-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { namespace: "shared", instanceId: "default" },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupWipeDO: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/backup/wipe-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupDumpDO: POST /admin/api/backup/dump-do → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/dump-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { namespace: "shared", instanceId: "default" },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupDumpDO: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/backup/dump-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreDO: POST /admin/api/backup/restore-do → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/restore-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { namespace: "shared", instanceId: "default", data: {} },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreDO: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/backup/restore-do', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupDumpD1: POST /admin/api/backup/dump-d1 → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/dump-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreD1: POST /admin/api/backup/restore-d1 → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/restore-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { tables: {} },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreD1: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/backup/restore-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupDumpControlD1: POST /admin/api/backup/dump-control-d1 → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/dump-control-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreControlD1: POST /admin/api/backup/restore-control-d1 → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/restore-control-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreControlD1: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/backup/restore-control-d1', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupDumpData: POST /admin/api/backup/dump-data → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/dump-data', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('backupDumpData: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/backup/dump-data', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreData: POST /admin/api/backup/restore-data → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/restore-data', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: {},
    });
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreData: bad input → 400', async () => {
    const { status } = await api('POST', '/admin/api/backup/restore-data', {
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('backupDumpStorage: POST /admin/api/backup/dump-storage → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/dump-storage', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupRestoreStorage: POST /admin/api/backup/restore-storage → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/restore-storage', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupResyncUsersPublic: POST /admin/api/backup/resync-users-public → not 5xx', async () => {
    const { status, data } = await api('POST', '/admin/api/backup/resync-users-public', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

  it('backupExportTable: GET /admin/api/backup/export/{name} → not 5xx', async () => {
    const { status, data } = await api('GET', '/admin/api/backup/export/posts', {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(status).toBeLessThan(500);
  });

});
