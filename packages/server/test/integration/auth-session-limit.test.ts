/**
 * auth-session-limit.test.ts — Session Limit integration tests
 *
 * Tests: maxActiveSessions config in createSession()
 *   - When maxActiveSessions=3, 4th login evicts the oldest session
 *   - Evicted session's refreshToken becomes invalid
 *   - Most recent sessions remain valid
 *   - GET /sessions reflects the correct count
 *
 * Test config: edgebase.test.config.js → auth.session.maxActiveSessions: 3
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost';

async function api(
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

function randomEmail() {
  return `sess-limit-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. maxActiveSessions=3 → 4번째 세션 생성 시 첫 세션 퇴출 ─────────────────

describe('auth-session-limit — eviction on exceed', () => {
  const email = randomEmail();
  const password = 'SessionLimit1!';
  const tokens: { accessToken: string; refreshToken: string }[] = [];

  beforeAll(async () => {
    // Signup creates session #1
    const { data: signupData } = await api('POST', '/signup', { email, password });
    tokens.push({ accessToken: signupData.accessToken, refreshToken: signupData.refreshToken });

    // Login creates sessions #2, #3, #4
    for (let i = 0; i < 3; i++) {
      const { data } = await api('POST', '/signin', { email, password });
      tokens.push({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    }
  });

  it('4번째 로그인 후 첫 번째 세션 refreshToken → 401 (퇴출됨)', async () => {
    const { status } = await api('POST', '/refresh', { refreshToken: tokens[0].refreshToken });
    expect(status).toBe(401);
  });

  it('4번째 로그인 후 두 번째 세션 refreshToken → 200 (유지됨)', async () => {
    const { status } = await api('POST', '/refresh', { refreshToken: tokens[1].refreshToken });
    expect(status).toBe(200);
  });

  it('4번째 로그인 후 세 번째 세션 refreshToken → 200 (유지됨)', async () => {
    const { status } = await api('POST', '/refresh', { refreshToken: tokens[2].refreshToken });
    expect(status).toBe(200);
  });

  it('4번째 세션 자체 refreshToken → 200 (유지됨)', async () => {
    const { status } = await api('POST', '/refresh', { refreshToken: tokens[3].refreshToken });
    expect(status).toBe(200);
  });

  it('GET /sessions → 세션 수 maxActiveSessions(3) 이하', async () => {
    // Use the latest accessToken (session #4)
    const { status, data } = await api('GET', '/sessions', undefined, tokens[3].accessToken);
    expect(status).toBe(200);
    const sessions = data.sessions ?? data;
    expect(sessions.length).toBeLessThanOrEqual(3);
  });
});

// ─── 2. maxActiveSessions 이하면 퇴출 없음 ──────────────────────────────────

describe('auth-session-limit — no eviction when within limit', () => {
  const email = randomEmail();
  const password = 'NoEvict1234!';
  const tokens: { accessToken: string; refreshToken: string }[] = [];

  beforeAll(async () => {
    // Signup creates session #1
    const { data: signupData } = await api('POST', '/signup', { email, password });
    tokens.push({ accessToken: signupData.accessToken, refreshToken: signupData.refreshToken });

    // Login creates sessions #2 and #3 (total 3 = max)
    for (let i = 0; i < 2; i++) {
      const { data } = await api('POST', '/signin', { email, password });
      tokens.push({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    }
  });

  it('maxActiveSessions 이하 → 모든 세션 refreshToken 유효', async () => {
    for (let i = 0; i < tokens.length; i++) {
      const { status } = await api('POST', '/refresh', { refreshToken: tokens[i].refreshToken });
      expect(status).toBe(200);
    }
  });

  it('GET /sessions → 세션 3개', async () => {
    const { status, data } = await api('GET', '/sessions', undefined, tokens[2].accessToken);
    expect(status).toBe(200);
    const sessions = data.sessions ?? data;
    expect(sessions.length).toBe(3);
  });
});

// ─── 3. 연속 초과 → 항상 가장 오래된 것부터 퇴출 ──────────────────────────────

describe('auth-session-limit — multiple exceed eviction', () => {
  const email = randomEmail();
  const password = 'MultiEvict1!';
  const tokens: { accessToken: string; refreshToken: string }[] = [];

  beforeAll(async () => {
    // Create 6 sessions (signup + 5 logins)
    const { data: signupData } = await api('POST', '/signup', { email, password });
    tokens.push({ accessToken: signupData.accessToken, refreshToken: signupData.refreshToken });

    for (let i = 0; i < 5; i++) {
      const { data } = await api('POST', '/signin', { email, password });
      tokens.push({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    }
  });

  it('6개 세션 생성 후 처음 3개 퇴출됨', async () => {
    // Sessions 0, 1, 2 should be evicted (only 3, 4, 5 remain)
    for (let i = 0; i < 3; i++) {
      const { status } = await api('POST', '/refresh', { refreshToken: tokens[i].refreshToken });
      expect(status).toBe(401);
    }
  });

  it('6개 세션 생성 후 최근 3개 유지됨', async () => {
    for (let i = 3; i < 6; i++) {
      const { status } = await api('POST', '/refresh', { refreshToken: tokens[i].refreshToken });
      expect(status).toBe(200);
    }
  });
});

// ─── 4. signout 후 세션 슬롯 확보 ──────────────────────────────────────────

describe('auth-session-limit — signout frees slot', () => {
  it('3개 중 1개 signout → 새 로그인 시 퇴출 없음', async () => {
    const email = randomEmail();
    const password = 'FreeSlot1234!';

    // Create 3 sessions (max)
    const { data: d1 } = await api('POST', '/signup', { email, password });
    const { data: d2 } = await api('POST', '/signin', { email, password });
    const { data: d3 } = await api('POST', '/signin', { email, password });

    // Sign out session #1 → frees a slot
    await api('POST', '/signout', { refreshToken: d1.refreshToken });

    // Create 4th session — should NOT evict d2 or d3
    const { data: d4 } = await api('POST', '/signin', { email, password });

    // d2 and d3 should still be valid
    const { status: s2 } = await api('POST', '/refresh', { refreshToken: d2.refreshToken });
    expect(s2).toBe(200);

    const { status: s3 } = await api('POST', '/refresh', { refreshToken: d3.refreshToken });
    expect(s3).toBe(200);

    // d4 should also be valid
    const { status: s4 } = await api('POST', '/refresh', { refreshToken: d4.refreshToken });
    expect(s4).toBe(200);
  });
});

// ─── 5. 서로 다른 사용자는 독립적 ────────────────────────────────────────────

describe('auth-session-limit — per-user isolation', () => {
  it('사용자 A의 세션 퇴출이 사용자 B에 영향 없음', async () => {
    const emailA = randomEmail();
    const emailB = randomEmail();
    const password = 'Isolation1234!';

    // User A: 4 sessions (exceed limit → 1 evicted)
    const { data: a1 } = await api('POST', '/signup', { email: emailA, password });
    await api('POST', '/signin', { email: emailA, password });
    await api('POST', '/signin', { email: emailA, password });
    await api('POST', '/signin', { email: emailA, password });

    // User B: 1 session
    const { data: b1 } = await api('POST', '/signup', { email: emailB, password });

    // User A's first session evicted
    const { status: sA } = await api('POST', '/refresh', { refreshToken: a1.refreshToken });
    expect(sA).toBe(401);

    // User B's session intact
    const { status: sB } = await api('POST', '/refresh', { refreshToken: b1.refreshToken });
    expect(sB).toBe(200);
  });
});
