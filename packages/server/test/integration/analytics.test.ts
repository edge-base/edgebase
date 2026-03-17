/**
 * analytics.test.ts — Analytics API 통합 테스트
 *
 * 테스트 대상: src/routes/analytics-api.ts
 *   GET  /api/analytics/query   — 요청 로그 메트릭 조회 (Service Key 필수)
 *   POST /api/analytics/track   — 커스텀 이벤트 수집 (JWT / Service Key / anonymous)
 *   GET  /api/analytics/events  — 커스텀 이벤트 조회 (Service Key 필수)
 *
 * 테스트 환경: Miniflare (vitest-pool-workers)
 * LOGS DO 바인딩 필요 (wrangler.test.toml에 LogsDO 등록)
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

// ─── Helpers ───

async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const h: Record<string, string> = { ...headers };
  if (body && method !== 'GET') h['Content-Type'] = 'application/json';
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function apiSK(method: string, path: string, body?: unknown) {
  return api(method, path, body, { 'X-EdgeBase-Service-Key': SK });
}

async function getToken(email?: string): Promise<{ accessToken: string; userId: string }> {
  const e = email ?? `analytics-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Analytics1234!' }),
  });
  const data = (await res.json()) as any;
  return { accessToken: data.accessToken, userId: data.user?.id };
}

// ─── 1. GET /api/analytics/query — 인증 ─────────────────────────────────────

describe('analytics/query — 인증', () => {
  it('Service Key 없이 → 403', async () => {
    const { status } = await api('GET', '/api/analytics/query');
    expect(status).toBe(403);
  });

  it('잘못된 Service Key → 401', async () => {
    const { status } = await api('GET', '/api/analytics/query', undefined, {
      'X-EdgeBase-Service-Key': 'wrong-key',
    });
    expect(status).toBe(401);
  });

  it('올바른 Service Key → 200', async () => {
    const { status, data } = await apiSK('GET', '/api/analytics/query');
    expect(status).toBe(200);
    expect(data).toBeTruthy();
  });
});

// ─── 2. GET /api/analytics/query — 파라미터 ─────────────────────────────────

describe('analytics/query — 파라미터', () => {
  it('기본 overview → timeSeries + summary + breakdown + topItems', async () => {
    const { status, data } = await apiSK('GET', '/api/analytics/query?metric=overview');
    expect(status).toBe(200);
    // LogsDO 기반이므로 빈 결과라도 구조는 반환
    expect(data).toHaveProperty('timeSeries');
    expect(data).toHaveProperty('summary');
  });

  it('range=7d + groupBy=day → 200', async () => {
    const { status } = await apiSK('GET', '/api/analytics/query?range=7d&groupBy=day');
    expect(status).toBe(200);
  });

  it('metric=timeSeries → timeSeries 배열', async () => {
    const { status, data } = await apiSK('GET', '/api/analytics/query?metric=timeSeries');
    expect(status).toBe(200);
    expect(data).toHaveProperty('timeSeries');
    expect(Array.isArray(data.timeSeries)).toBe(true);
  });
});

// ─── 3. POST /api/analytics/track — 이벤트 수집 ─────────────────────────────

describe('analytics/track — 이벤트 수집', () => {
  it('익명 이벤트 전송 → 200', async () => {
    const { status, data } = await api('POST', '/api/analytics/track', {
      events: [{ name: 'test_event', properties: { key: 'value' } }],
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.count).toBe(1);
  });

  it('JWT 인증 이벤트 → userId 자동 할당', async () => {
    const { accessToken } = await getToken();
    const { status, data } = await api('POST', '/api/analytics/track', {
      events: [{ name: 'user_action' }],
    }, { Authorization: `Bearer ${accessToken}` });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.count).toBe(1);
  });

  it('Service Key + userId 명시 → 200', async () => {
    const { status, data } = await api('POST', '/api/analytics/track', {
      events: [{ name: 'server_event', userId: 'user-123' }],
    }, { 'X-EdgeBase-Service-Key': SK });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('배치 이벤트 (5개) → count=5', async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      name: `batch_event_${i}`,
      properties: { index: i },
    }));
    const { status, data } = await api('POST', '/api/analytics/track', { events });
    expect(status).toBe(200);
    expect(data.count).toBe(5);
  });

  it('빈 events 배열 → 400', async () => {
    const { status } = await api('POST', '/api/analytics/track', { events: [] });
    expect(status).toBe(400);
  });

  it('events 없음 → 400', async () => {
    const { status } = await api('POST', '/api/analytics/track', { data: 'wrong' });
    expect(status).toBe(400);
  });

  it('이벤트 name 없음 → 400', async () => {
    const { status } = await api('POST', '/api/analytics/track', {
      events: [{ properties: { key: 'value' } }],
    });
    expect(status).toBe(400);
  });

  it('properties가 배열이면 → 400', async () => {
    const { status } = await api('POST', '/api/analytics/track', {
      events: [{ name: 'test', properties: [1, 2, 3] }],
    });
    expect(status).toBe(400);
  });

  it('properties 50키 초과 → 400', async () => {
    const properties: Record<string, string> = {};
    for (let i = 0; i < 51; i++) properties[`key_${i}`] = `val_${i}`;
    const { status } = await api('POST', '/api/analytics/track', {
      events: [{ name: 'too_many_props', properties }],
    });
    expect(status).toBe(400);
  });

  it('100개 초과 이벤트 → 400', async () => {
    const events = Array.from({ length: 101 }, (_, i) => ({ name: `event_${i}` }));
    const { status } = await api('POST', '/api/analytics/track', { events });
    expect(status).toBe(400);
  });

  it('잘못된 JSON body → 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });
});

// ─── 4. GET /api/analytics/events — 커스텀 이벤트 조회 ───────────────────────

describe('analytics/events — 이벤트 조회', () => {
  it('Service Key 없이 → 403', async () => {
    const { status } = await api('GET', '/api/analytics/events');
    expect(status).toBe(403);
  });

  it('잘못된 Service Key → 401', async () => {
    const { status } = await api('GET', '/api/analytics/events', undefined, {
      'X-EdgeBase-Service-Key': 'wrong-key',
    });
    expect(status).toBe(401);
  });

  it('기본 list → events 배열 반환', async () => {
    // 먼저 이벤트 추가
    await api('POST', '/api/analytics/track', {
      events: [{ name: 'query_test_event' }],
    });

    const { status, data } = await apiSK('GET', '/api/analytics/events?metric=list');
    expect(status).toBe(200);
    expect(data).toHaveProperty('events');
    expect(Array.isArray(data.events)).toBe(true);
  });

  it('metric=count → totalEvents + uniqueUsers', async () => {
    const { status, data } = await apiSK('GET', '/api/analytics/events?metric=count');
    expect(status).toBe(200);
    expect(data).toHaveProperty('totalEvents');
    expect(data).toHaveProperty('uniqueUsers');
    expect(typeof data.totalEvents).toBe('number');
  });

  it('metric=timeSeries → timeSeries 배열', async () => {
    const { status, data } = await apiSK('GET', '/api/analytics/events?metric=timeSeries');
    expect(status).toBe(200);
    expect(data).toHaveProperty('timeSeries');
    expect(Array.isArray(data.timeSeries)).toBe(true);
  });

  it('metric=topEvents → topEvents 배열', async () => {
    const { status, data } = await apiSK('GET', '/api/analytics/events?metric=topEvents');
    expect(status).toBe(200);
    expect(data).toHaveProperty('topEvents');
    expect(Array.isArray(data.topEvents)).toBe(true);
  });

  it('event 이름 필터 → 해당 이벤트만', async () => {
    const uniqueName = `filter_test_${Date.now()}`;
    await api('POST', '/api/analytics/track', {
      events: [{ name: uniqueName }],
    });

    const { status, data } = await apiSK(
      'GET',
      `/api/analytics/events?metric=list&event=${encodeURIComponent(uniqueName)}`,
    );
    expect(status).toBe(200);
    if (data.events && data.events.length > 0) {
      for (const e of data.events) {
        expect(e.eventName).toBe(uniqueName);
      }
    }
  });

  it('range 파라미터 → 200', async () => {
    const { status } = await apiSK('GET', '/api/analytics/events?range=7d&metric=list');
    expect(status).toBe(200);
  });
});

// ─── 5. 이벤트 수집 → 조회 통합 플로우 ──────────────────────────────────────

describe('analytics — track → query 통합', () => {
  it('track 후 events 조회에서 확인', async () => {
    const uniqueName = `integration_${Date.now()}_${crypto.randomUUID().slice(0, 4)}`;

    // 이벤트 전송
    const { status: trackStatus } = await api('POST', '/api/analytics/track', {
      events: [
        { name: uniqueName, properties: { source: 'test' } },
        { name: uniqueName, properties: { source: 'test2' } },
      ],
    });
    expect(trackStatus).toBe(200);

    // 이벤트 조회
    const { status, data } = await apiSK(
      'GET',
      `/api/analytics/events?metric=list&event=${encodeURIComponent(uniqueName)}`,
    );
    expect(status).toBe(200);
    expect(data.events.length).toBe(2);
    expect(data.events[0].eventName).toBe(uniqueName);
  });

  it('Service Key로 userId 지정 → 해당 userId로 조회', async () => {
    const uniqueName = `sk_user_${Date.now()}`;
    const testUserId = `test-user-${Date.now()}`;

    await api('POST', '/api/analytics/track', {
      events: [{ name: uniqueName, userId: testUserId }],
    }, { 'X-EdgeBase-Service-Key': SK });

    const { status, data } = await apiSK(
      'GET',
      `/api/analytics/events?metric=list&event=${encodeURIComponent(uniqueName)}&userId=${encodeURIComponent(testUserId)}`,
    );
    expect(status).toBe(200);
    expect(data.events.length).toBeGreaterThanOrEqual(1);
    expect(data.events[0].userId).toBe(testUserId);
  });

  it('count metric → 총 이벤트 수 확인', async () => {
    const uniqueName = `count_${Date.now()}`;

    await api('POST', '/api/analytics/track', {
      events: [
        { name: uniqueName },
        { name: uniqueName },
        { name: uniqueName },
      ],
    });

    const { status, data } = await apiSK(
      'GET',
      `/api/analytics/events?metric=count&event=${encodeURIComponent(uniqueName)}`,
    );
    expect(status).toBe(200);
    expect(data.totalEvents).toBe(3);
  });
});
