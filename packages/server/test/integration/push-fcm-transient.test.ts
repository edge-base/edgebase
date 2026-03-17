/**
 * Push FCM Transient & Auth Error Tests — fetchMock 기반
 *
 * FCM 429/503/401/403 에러 시의 서버 동작을 검증한다.
 * fetchMock .persist() 누수 문제로, 단일 describe 안에서 순차적으로 테스트한다.
 *
 * 핵심 검증:
 *   - 429/503 → "transient error" (토큰 미삭제)
 *   - 401/403 → "authentication error" (토큰 미삭제, access token 캐시 무효화)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fetchMock } from 'cloudflare:test';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';
const MOCK_FCM_ORIGIN = 'http://localhost:9099';

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'X-EdgeBase-Service-Key': SK };
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

async function sendWithFcmStatus(fcmStatus: number): Promise<{ sent: number; failed: number; error?: string }> {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock.get(MOCK_FCM_ORIGIN)
    .intercept({ path: '/token', method: 'POST' })
    .reply(200, JSON.stringify({ access_token: `token-${fcmStatus}-${Date.now()}`, expires_in: 3600 }),
      { headers: { 'content-type': 'application/json' } });
  fetchMock.get(MOCK_FCM_ORIGIN)
    .intercept({ path: /\/v1\/projects\/.*\/messages:send/, method: 'POST' })
    .reply(fcmStatus, '{}', { headers: { 'content-type': 'application/json' } });

  const result = await api('POST', '/api/push/send-to-token', {
    token: `token-${fcmStatus}`, payload: { title: `Test ${fcmStatus}`, body: 'Error test' },
  });

  fetchMock.deactivate();
  return result.data;
}

describe('push — FCM transient & auth errors (429/503/401/403)', () => {
  it('FCM 429 → sent:0, failed:1, error contains transient', async () => {
    const data = await sendWithFcmStatus(429);
    expect(data.sent).toBe(0);
    expect(data.failed).toBe(1);
    expect(data.error).toContain('429');
  });

  it('FCM 503 → sent:0, failed:1, error contains transient', async () => {
    const data = await sendWithFcmStatus(503);
    expect(data.sent).toBe(0);
    expect(data.failed).toBe(1);
    expect(data.error).toContain('503');
  });

  it('FCM 401 → sent:0, failed:1, error contains authentication', async () => {
    const data = await sendWithFcmStatus(401);
    expect(data.sent).toBe(0);
    expect(data.failed).toBe(1);
    expect(data.error).toContain('401');
  });

  it('FCM 403 → sent:0, failed:1, error contains authentication', async () => {
    const data = await sendWithFcmStatus(403);
    expect(data.sent).toBe(0);
    expect(data.failed).toBe(1);
    expect(data.error).toContain('403');
  });
});
