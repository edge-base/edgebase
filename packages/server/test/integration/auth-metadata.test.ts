/**
 * auth-metadata.test.ts — User Metadata + Disabled flag integration tests
 *
 * Tests: metadata (user-writable) and disabled flag
 *   PATCH /api/auth/profile — metadata field update
 *   User metadata returned in user object on signup, signin, profile
 *   disabled field prevents signin and token refresh
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
  return `meta-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. metadata via profile update ────────────────────────────────────

describe('auth-metadata — profile metadata', () => {
  let accessToken: string;
  let email: string;

  beforeAll(async () => {
    email = randomEmail();
    const { data } = await api('POST', '/signup', {
      email,
      password: 'Metadata1234!',
    });
    accessToken = data.accessToken;
  });

  it('PATCH /profile with metadata → 200, metadata 반환', async () => {
    const { status, data } = await api('PATCH', '/profile', {
      metadata: { theme: 'dark', lang: 'ko' },
    }, accessToken);
    expect(status).toBe(200);
    expect(data.user.metadata).toEqual({ theme: 'dark', lang: 'ko' });
  });

  it('metadata 업데이트 후 로그인 시 metadata 포함', async () => {
    const { status, data } = await api('POST', '/signin', {
      email,
      password: 'Metadata1234!',
    });
    expect(status).toBe(200);
    expect(data.user.metadata).toEqual({ theme: 'dark', lang: 'ko' });
  });

  it('metadata 덮어쓰기', async () => {
    const { status, data } = await api('PATCH', '/profile', {
      metadata: { theme: 'light' },
    }, accessToken);
    expect(status).toBe(200);
    expect(data.user.metadata).toEqual({ theme: 'light' });
    // lang key should be gone since we replaced the whole object
    expect(data.user.metadata.lang).toBeUndefined();
  });

  it('metadata null로 초기화', async () => {
    const { status, data } = await api('PATCH', '/profile', {
      metadata: null,
    }, accessToken);
    expect(status).toBe(200);
    expect(data.user.metadata).toBeNull();
  });

  it('signup 직후 metadata는 null', async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Fresh1234!',
    });
    // metadata should be null/undefined for new user
    expect(data.user.metadata == null).toBe(true);
  });
});

// ─── 2. appMetadata는 client에 노출되지 않음 ───────────────────────────

describe('auth-metadata — appMetadata not exposed to client', () => {
  it('signup 응답에 appMetadata 없음', async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'AppMeta1234!',
    });
    expect(data.user.appMetadata).toBeUndefined();
  });

  it('signin 응답에 appMetadata 없음', async () => {
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'AppMeta1234!' });
    const { data } = await api('POST', '/signin', { email, password: 'AppMeta1234!' });
    expect(data.user.appMetadata).toBeUndefined();
  });
});
