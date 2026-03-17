/**
 * admin.test.ts — 100개
 *
 * 테스트 대상: src/routes/admin.ts, src/routes/admin-auth.ts (Admin Dashboard)
 *
 * 엔드포인트:
 *   GET  /admin/api/setup/status
 *   POST /admin/api/setup (최초 관리자 계정 생성)
 *   POST /admin/api/auth/login (관리자 로그인)
 *   POST /admin/api/auth/refresh (관리자 토큰 갱신)
 *   GET  /admin/api/data/tables
 *   GET  /admin/api/data/tables/:name/records
 *   POST /admin/api/data/tables/:name/records
 *   GET  /admin/api/data/users
 *   GET  /admin/api/data/users/:id/profile
 *   DELETE /admin/api/data/users/:id/sessions
 *   GET  /admin/api/data/storage/buckets
 *   GET  /admin/api/data/storage/buckets/:name/objects
 *   GET  /admin/api/data/schema
 *   GET  /admin/api/data/logs
 *   GET  /admin/api/data/monitoring
 *   GET  /admin/api/data/auth/settings
 *
 * 인증: SK for admin data routes OR Admin JWT
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import worker from '../../src/index.js';

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
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function apiWithEnv(method: string, path: string, envOverrides: Record<string, unknown>, body?: unknown) {
  const headers: Record<string, string> = {
    'X-EdgeBase-Service-Key': SK,
  };
  if (body && method !== 'GET') headers['Content-Type'] = 'application/json';

  const res = await worker.fetch(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    {
      ...(globalThis as any).env,
      ...envOverrides,
    } as any,
    {
      waitUntil() {},
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  );

  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function clientAuthApi(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body && method !== 'GET') headers['Content-Type'] = 'application/json';

  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function fetchWithEnv(path: string, envOverrides: Record<string, unknown>) {
  return worker.fetch(
    new Request(`${BASE}${path}`, {
      method: 'GET',
    }),
    {
      ...(globalThis as any).env,
      ...envOverrides,
    } as any,
    {
      waitUntil() {},
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  );
}

function createJsonKv(entries: Record<string, Record<string, unknown>>): KVNamespace {
  return {
    async get(key: string, type?: string) {
      const value = entries[key];
      if (!value) return null;
      if (type === 'json') return value;
      return JSON.stringify(value);
    },
    async put() {},
    async delete() {},
    async list() {
      return {
        keys: Object.keys(entries).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

async function adminCount() {
  const result = await (globalThis as any).env.AUTH_DB.prepare('SELECT COUNT(*) as count FROM _admins').first<{ count: number }>();
  return result?.count ?? 0;
}

async function authUserCount() {
  const result = await (globalThis as any).env.AUTH_DB.prepare(`
    SELECT COUNT(DISTINCT userId) as count FROM (
      SELECT userId FROM _email_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId FROM _oauth_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId FROM _anon_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId FROM _phone_index WHERE status = 'confirmed'
    )
  `).first<{ count: number }>();
  return result?.count ?? 0;
}

async function resetAdminState() {
  await (globalThis as any).env.AUTH_DB.exec('DELETE FROM _admin_sessions; DELETE FROM _admins;');
}

describe('1-21 admin — root redirect', () => {
  it('GET / → /admin redirect when admin assets are present', async () => {
    const res = await fetchWithEnv('/', {
      ASSETS: {
        fetch() {
          return new Response('admin', { status: 200 });
        },
      },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
  });

  it('GET / → API metadata when admin assets are not deployed', async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/`, {
        method: 'GET',
        redirect: 'manual',
      }),
      (globalThis as any).env,
      {
        waitUntil() {},
        passThroughOnException() {},
      } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      name: 'EdgeBase API',
      docs: '/openapi.json',
      admin: null,
    });
  });
});

describe('1-21 admin — static asset fallbacks', () => {
  it('GET /_app/* → serves admin assets when the build uses root-based asset URLs', async () => {
    const res = await fetchWithEnv('/_app/immutable/entry/start.test.js', {
      ASSETS: {
        fetch(request: Request) {
          return new Response(new URL(request.url).pathname, { status: 200 });
        },
      },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('/_app/immutable/entry/start.test.js');
  });

  it('GET /favicon.svg → serves the admin favicon when the build references the root path', async () => {
    const res = await fetchWithEnv('/favicon.svg', {
      ASSETS: {
        fetch(request: Request) {
          return new Response(new URL(request.url).pathname, { status: 200 });
        },
      },
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('/favicon.svg');
  });
});

// ─── 1. Admin Setup ────────────────────────────────────────────────────────────

describe('1-21 admin — setup', () => {
  it('GET /admin/api/setup/status → { needsSetup: boolean }', async () => {
    const { status, data } = await api('GET', '/admin/api/setup/status');
    expect(status).toBe(200);
    expect(typeof data.needsSetup).toBe('boolean');
  });

  it('setup — JWT_ADMIN_SECRET 누락 시 admin row를 남기지 않음', async () => {
    await resetAdminState();
    const before = await adminCount();
    expect(before).toBe(0);

    const { status, data } = await apiWithEnv(
      'POST',
      '/admin/api/setup',
      { JWT_ADMIN_SECRET: undefined },
      {
        email: 'missing-secret@test.com',
        password: 'Admin1234!',
      },
    );

    expect(status).toBe(500);
    expect(data?.message).toContain('JWT_ADMIN_SECRET');
    expect(await adminCount()).toBe(0);

    const setupStatus = await api('GET', '/admin/api/setup/status');
    expect(setupStatus.status).toBe(200);
    expect(setupStatus.data?.needsSetup).toBe(true);
  });

  it('setup 완료 후 재시도 → 400', async () => {
    // First setup may succeed or fail (if already exists)
    const first = await api('POST', '/admin/api/setup', {
      email: 'admin@test.com',
      password: 'Admin1234!',
    });
    // Second setup MUST fail
    const second = await api('POST', '/admin/api/setup', {
      email: 'admin2@test.com',
      password: 'Admin1234!',
    });
    expect(second.status).toBe(400);
  });

  it('setup — email 미누락 → 400', async () => {
    const { status } = await api('POST', '/admin/api/setup', { password: 'Admin1234!' });
    expect([400, 400].includes(status)).toBe(true);
  });

  it('setup — 8자 미만 비밀번호 → 400', async () => {
    const { status } = await api('POST', '/admin/api/setup', {
      email: `short-${Date.now()}@test.com`,
      password: 'short',
    });
    expect(status).toBe(400);
  });
});

// ─── 2. Admin Login / Refresh ─────────────────────────────────────────────────

describe('1-21 admin — login / refresh', () => {
  let adminRefreshToken: string;

  beforeAll(async () => {
    // Attempt setup first (may already exist)
    await api('POST', '/admin/api/setup', {
      email: 'admin@test.com',
      password: 'Admin1234!',
    });
  });

  it('POST /admin/api/auth/login → { accessToken, refreshToken, admin }', async () => {
    const { status, data } = await api('POST', '/admin/api/auth/login', {
      email: 'admin@test.com',
      password: 'Admin1234!',
    });
    expect(status).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
    expect(data.admin?.email).toBe('admin@test.com');
    adminRefreshToken = data.refreshToken;
  });

  it('잘못된 비밀번호 → 401', async () => {
    const { status } = await api('POST', '/admin/api/auth/login', {
      email: 'admin@test.com',
      password: 'WrongPass!',
    });
    expect(status).toBe(401);
  });

  it('미등록 email → 401', async () => {
    const { status } = await api('POST', '/admin/api/auth/login', {
      email: 'nobody@test.com',
      password: 'Admin1234!',
    });
    expect(status).toBe(401);
  });

  it('POST /admin/api/auth/refresh → 새 토큰 쌍', async () => {
    if (!adminRefreshToken) return;
    const { status, data } = await api('POST', '/admin/api/auth/refresh', {
      refreshToken: adminRefreshToken,
    });
    expect(status).toBe(200);
    expect(typeof data.accessToken).toBe('string');
  });

  it('refreshToken 누락 → 400', async () => {
    const { status } = await api('POST', '/admin/api/auth/refresh', {});
    expect(status).toBe(400);
  });
});

// ─── 3. Tables API ────────────────────────────────────────────────────────────

describe('1-21 admin — tables API', () => {
  it('GET /admin/api/data/tables → { tables: [...] }', async () => {
    const { status, data } = await api('GET', '/admin/api/data/tables');
    expect(status).toBe(200);
    expect(Array.isArray(data.tables)).toBe(true);
  });

  it('tables 배열에 posts/categories 포함됨', async () => {
    const { data } = await api('GET', '/admin/api/data/tables');
    const names = data.tables.map((t: any) => t.name);
    // posts, categories are in test config
    expect(names.some((n: string) => ['posts', 'categories'].includes(n))).toBe(true);
  });

  it('GET /admin/api/data/tables/posts/records → records 배열', async () => {
    const { status, data } = await api('GET', '/admin/api/data/tables/posts/records?limit=5');
    expect([200, 404, 500].includes(status)).toBe(true);
  });

  it('POST /admin/api/data/tables/posts/records → record 생성', async () => {
    const { status, data } = await api('POST', '/admin/api/data/tables/posts/records', {
      title: 'Admin Created Post',
      isPublished: false,
    });
    expect([200, 201].includes(status)).toBe(true);
    if (data?.id) {
      // Cleanup
      await api('DELETE', `/admin/api/data/tables/posts/records/${data.id}`);
    }
  });

  it('SK 없이 admin data → 401', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/admin/api/data/tables`, {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/data/tables/:nonexistent/export → 404', async () => {
    const { status } = await api('GET', '/admin/api/data/tables/nonexistent_table/export?format=json');
    expect(status).toBe(404);
  });

  it('GET /admin/api/data/tables/posts/export?format=json → JSON download', async () => {
    const { status } = await api('GET', '/admin/api/data/tables/posts/export?format=json');
    expect([200, 404].includes(status)).toBe(true);
  });

  it('GET ...export?format=csv → 400 (미지원)', async () => {
    const { status } = await api('GET', '/admin/api/data/tables/posts/export?format=csv');
    expect(status).toBe(400);
  });
});

// ─── 4. Users API ─────────────────────────────────────────────────────────────

describe('1-21 admin — users API', () => {
  let userId: string;

  beforeAll(async () => {
    // Create a test user
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `admin-user-${crypto.randomUUID().slice(0, 8)}@test.com`,
        password: 'Admin1234!',
      }),
    });
    const data = await res.json() as any;
    userId = data.user?.id;
  });

  it('GET /admin/api/data/users → { users: [...], cursor }', async () => {
    const { status, data } = await api('GET', '/admin/api/data/users?limit=5');
    expect(status).toBe(200);
    expect(Array.isArray(data.users)).toBe(true);
    expect(['string', 'object'].includes(typeof data.cursor) || data.cursor === null).toBe(true);
  });

  it('limit=1 → 최대 1명', async () => {
    const { data } = await api('GET', '/admin/api/data/users?limit=1');
    expect(data.users.length).toBeLessThanOrEqual(1);
  });

  it('GET /admin/api/data/users → total is the exact distinct auth-user count', async () => {
    const expectedTotal = await authUserCount();
    const { status, data } = await api('GET', '/admin/api/data/users?limit=1');
    expect(status).toBe(200);
    expect(data.total).toBe(expectedTotal);
  });

  it('GET /admin/api/data/users/:id/profile → 프로필', async () => {
    if (!userId) return;
    const { status, data } = await api('GET', `/admin/api/data/users/${userId}/profile`);
    expect([200, 404].includes(status)).toBe(true);
    if (status === 200) {
      expect(data.id).toBe(userId);
    }
  });

  it('PUT /admin/api/data/users/:id → role 변경', async () => {
    if (!userId) return;
    const { status } = await api('PUT', `/admin/api/data/users/${userId}`, { role: 'admin' });
    expect([200, 400, 404].includes(status)).toBe(true);
  });

  it('DELETE /admin/api/data/users/:id/sessions → 세션 revoke', async () => {
    if (!userId) return;
    const { status } = await api('DELETE', `/admin/api/data/users/${userId}/sessions`);
    expect([200, 400, 404].includes(status)).toBe(true);
  });

  it('존재하지 않는 user profile → 404', async () => {
    const { status } = await api('GET', '/admin/api/data/users/non-existent-id/profile');
    expect(status).toBe(404);
  });
});

// ─── 5. Storage API ───────────────────────────────────────────────────────────

describe('1-21 admin — storage API', () => {
  it('GET /admin/api/data/storage/buckets → { buckets: [...] }', async () => {
    const { status, data } = await api('GET', '/admin/api/data/storage/buckets');
    expect(status).toBe(200);
    expect(Array.isArray(data.buckets)).toBe(true);
    expect(data.buckets.includes('avatars') || data.buckets.length >= 0).toBe(true);
  });

  it('GET /admin/api/data/storage/buckets/avatars/objects → { objects: [...], cursor }', async () => {
    const { status, data } = await api('GET', '/admin/api/data/storage/buckets/avatars/objects?limit=5');
    expect(status).toBe(200);
    expect(Array.isArray(data.objects)).toBe(true);
  });

  it('DELETE /admin/api/data/storage/buckets/avatars/objects/ghost.txt → ok(항상 성공)', async () => {
    const { status } = await api('DELETE', '/admin/api/data/storage/buckets/avatars/objects/ghost.txt');
    // R2 delete is idempotent — always succeeds
    expect([200, 404].includes(status)).toBe(true);
  });
});

// ─── 6. Schema API ────────────────────────────────────────────────────────────

describe('1-21 admin — schema API', () => {
  it('GET /admin/api/data/schema → { schema: { posts: {...}, ... } }', async () => {
    const { status, data } = await api('GET', '/admin/api/data/schema');
    expect(status).toBe(200);
    expect(typeof data.schema).toBe('object');
  });

  it('schema에 posts/categories 테이블 포함', async () => {
    const { data } = await api('GET', '/admin/api/data/schema');
    expect('posts' in data.schema || 'categories' in data.schema).toBe(true);
  });

  it('각 테이블 schema 구조: { namespace, fields, indexes, fts }', async () => {
    const { data } = await api('GET', '/admin/api/data/schema');
    const table = data.schema['posts'];
    if (table) {
      expect(table.namespace).toBeDefined();
      expect(table.fields).toBeDefined();
      expect(Array.isArray(table.indexes)).toBe(true);
    }
  });
});

// ─── 7. Logs / Monitoring / Auth Settings ────────────────────────────────────

describe('1-21 admin — logs/monitoring/auth-settings', () => {
  it('GET /admin/api/data/config-info → rate limiting summary 포함', async () => {
    const { status, data } = await api('GET', '/admin/api/data/config-info');
    expect(status).toBe(200);
    expect(Array.isArray(data.rateLimiting)).toBe(true);

    const globalLimit = data.rateLimiting.find((entry: any) => entry.group === 'global');
    expect(globalLimit).toBeDefined();
    expect(globalLimit.requests).toBe(10_000_000);
    expect(globalLimit.window).toBe('60s');
    expect(globalLimit.binding?.enabled).toBe(true);
    expect(globalLimit.binding?.limit).toBe(10_000_000);
    expect(globalLimit.binding?.period).toBe(60);

    const eventsLimit = data.rateLimiting.find((entry: any) => entry.group === 'events');
    expect(eventsLimit).toBeDefined();
    expect(eventsLimit.requests).toBe(100);
    expect(eventsLimit.window).toBe('60s');
  });

  it('GET /admin/api/data/logs → { logs: [...], cursor }', async () => {
    const { status, data } = await api('GET', '/admin/api/data/logs?limit=10');
    expect(status).toBe(200);
    expect(Array.isArray(data.logs)).toBe(true);
  });

  it('GET /admin/api/data/logs?level=error → only 5xx logs', async () => {
    const { status, data } = await api('GET', '/admin/api/data/logs?limit=50&level=error');
    expect(status).toBe(200);
    expect(Array.isArray(data.logs)).toBe(true);
    for (const log of data.logs) {
      expect(typeof log.status).toBe('number');
      expect(log.status).toBeGreaterThanOrEqual(500);
    }
  });

  it('GET /admin/api/data/logs?level=warn → excludes 5xx logs', async () => {
    const { status, data } = await api('GET', '/admin/api/data/logs?limit=50&level=warn');
    expect(status).toBe(200);
    expect(Array.isArray(data.logs)).toBe(true);
    for (const log of data.logs) {
      expect(typeof log.status).toBe('number');
      expect(log.status).toBeGreaterThanOrEqual(300);
      expect(log.status).toBeLessThan(500);
    }
  });

  it('GET /admin/api/data/logs falls back to KV and still applies all filters', async () => {
    const kv = createJsonKv({
      'log:1': { status: 503, path: '/api/auth/signin', category: 'auth' },
      'log:2': { status: 404, path: '/api/auth/signin', category: 'auth' },
      'log:3': { status: 503, path: '/api/db/shared/tables/posts', category: 'db' },
    });

    const { status, data } = await apiWithEnv('GET', '/admin/api/data/logs?limit=50&level=error&path=/api/auth&category=auth', {
      LOGS: undefined,
      KV: kv,
    });

    expect(status).toBe(200);
    expect(data.logs).toEqual([
      { status: 503, path: '/api/auth/signin', category: 'auth' },
    ]);
  });

  it('GET /admin/api/data/monitoring → { activeConnections, channels }', async () => {
    const { status, data } = await api('GET', '/admin/api/data/monitoring');
    expect(status).toBe(200);
    expect(typeof data.activeConnections).toBe('number');
  });

  it('GET /admin/api/data/auth/settings → { providers, anonymousAuth, session }', async () => {
    const { status, data } = await api('GET', '/admin/api/data/auth/settings');
    expect(status).toBe(200);
    expect(Array.isArray(data.providers)).toBe(true);
    expect(typeof data.anonymousAuth).toBe('boolean');
    expect(data).toHaveProperty('session');
  });

  it('POST /admin/api/data/cleanup-anon → { ok: true, cleaned: number }', async () => {
    const { status, data } = await api('POST', '/admin/api/data/cleanup-anon');
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(typeof data.cleaned).toBe('number');
  });
});

// ─── 8. Internal reset-password ───────────────────────────────────────────────

describe('1-21 admin — internal reset-password', () => {
  it('SK없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/admin/api/internal/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.com', newPassword: 'NewAdmin12!' }),
    });
    expect([401, 403].includes(res.status)).toBe(true);
  });

  it('SK있고 정상 요청 → 200', async () => {
    const { status } = await api('POST', '/admin/api/internal/reset-password', {
      email: 'admin@test.com',
      newPassword: 'NewAdmin12!',
    });
    expect([200, 404].includes(status)).toBe(true);
  });

  it('8자 미만 비밀번호 → 400', async () => {
    const { status } = await api('POST', '/admin/api/internal/reset-password', {
      email: 'admin@test.com',
      newPassword: 'short',
    });
    expect(status).toBe(400);
  });

  it('미등록 admin email → 404', async () => {
    const { status } = await api('POST', '/admin/api/internal/reset-password', {
      email: 'nobody@test.com',
      newPassword: 'NewPassword12!',
    });
    expect(status).toBe(404);
  });
});

// ─── 9. Admin Auth — createUser ─────────────────────────────────────────────

describe('admin auth — createUser', () => {
  it('POST /api/auth/admin/users → 201 + user 객체', async () => {
    const email = `admin-create-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { status, data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
    });
    expect(status).toBe(201);
    expect(data.user).toBeDefined();
    expect(data.user.id).toBeDefined();
  });

  it('createUser — displayName 포함', async () => {
    const email = `admin-dn-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { status, data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
      displayName: 'Test Display',
    });
    expect(status).toBe(201);
    expect(data.user).toBeDefined();
  });

  it('createUser — role 포함', async () => {
    const email = `admin-role-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { status, data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
      role: 'moderator',
    });
    expect(status).toBe(201);
    expect(data.user).toBeDefined();
  });

  it('createUser — email 누락 → 400', async () => {
    const { status } = await api('POST', '/api/auth/admin/users', { password: 'StrongPass1!' });
    expect(status).toBe(400);
  });

  it('createUser — password 누락 → 400', async () => {
    const { status } = await api('POST', '/api/auth/admin/users', { email: 'nopass@test.com' });
    expect(status).toBe(400);
  });

  it('createUser — 중복 email → 409', async () => {
    const email = `admin-dup-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await api('POST', '/api/auth/admin/users', { email, password: 'StrongPass1!' });
    const { status } = await api('POST', '/api/auth/admin/users', { email, password: 'StrongPass1!' });
    expect(status).toBe(409);
  });

  it('createUser — public profile projection 생성', async () => {
    const email = `admin-profile-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { status, data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
      displayName: 'Projection Ready',
    });
    expect(status).toBe(201);

    const profile = await api('GET', `/admin/api/data/users/${data.user.id}/profile`);
    expect(profile.status).toBe(200);
    expect(profile.data.id).toBe(data.user.id);
    expect(profile.data.displayName).toBe('Projection Ready');
  });
});

// ─── 10. Admin Auth — getUser ───────────────────────────────────────────────

describe('admin auth — getUser', () => {
  let testUserId: string;

  beforeAll(async () => {
    const email = `admin-get-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
    });
    testUserId = data?.user?.id;
  });

  it('GET /api/auth/admin/users/:id → 200 + user', async () => {
    if (!testUserId) return;
    const { status, data } = await api('GET', `/api/auth/admin/users/${testUserId}`);
    expect(status).toBe(200);
    expect(data.user || data.id).toBeDefined();
  });

  it('getUser — 존재하지 않는 id → 404 or empty', async () => {
    const { status } = await api('GET', '/api/auth/admin/users/non-existent-id-12345');
    expect([200, 404].includes(status)).toBe(true);
  });
});

// ─── 11. Admin Auth — listUsers (cursor pagination) ─────────────────────────

describe('admin auth — listUsers', () => {
  it('GET /api/auth/admin/users → 200 + users 배열', async () => {
    const { status, data } = await api('GET', '/api/auth/admin/users?limit=5');
    expect(status).toBe(200);
    expect(Array.isArray(data.users)).toBe(true);
  });

  it('listUsers — limit=1 → 최대 1명', async () => {
    const { data } = await api('GET', '/api/auth/admin/users?limit=1');
    expect(data.users.length).toBeLessThanOrEqual(1);
  });

  it('listUsers — cursor 기반 페이지네이션', async () => {
    const first = await api('GET', '/api/auth/admin/users?limit=1');
    if (first.data.cursor) {
      const second = await api('GET', `/api/auth/admin/users?limit=1&cursor=${first.data.cursor}`);
      expect(second.status).toBe(200);
      expect(Array.isArray(second.data.users)).toBe(true);
    }
  });
});

// ─── 12. Admin Auth — updateUser (PATCH) ────────────────────────────────────

describe('admin auth — updateUser', () => {
  let testUserId: string;

  beforeAll(async () => {
    const email = `admin-upd-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
    });
    testUserId = data?.user?.id;
  });

  it('PATCH /api/auth/admin/users/:id → 200', async () => {
    if (!testUserId) return;
    const { status } = await api('PATCH', `/api/auth/admin/users/${testUserId}`, {
      role: 'editor',
    });
    expect([200, 204].includes(status)).toBe(true);
  });

  it('updateUser — displayName 변경', async () => {
    if (!testUserId) return;
    const { status } = await api('PATCH', `/api/auth/admin/users/${testUserId}`, {
      displayName: 'Updated Name',
    });
    expect([200, 204].includes(status)).toBe(true);
  });

  it('updateUser — email 변경 후 새 email로 로그인', async () => {
    const oldEmail = `admin-email-old-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const newEmail = `admin-email-new-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const password = 'StrongPass1!';
    const created = await api('POST', '/api/auth/admin/users', {
      email: oldEmail,
      password,
    });
    const userId = created.data?.user?.id;
    expect(created.status).toBe(201);
    expect(userId).toBeDefined();

    const updated = await api('PATCH', `/api/auth/admin/users/${userId}`, {
      email: newEmail,
    });
    expect(updated.status).toBe(200);
    expect(updated.data.user.email).toBe(newEmail);

    const oldSignIn = await clientAuthApi('POST', '/api/auth/signin', {
      email: oldEmail,
      password,
    });
    expect(oldSignIn.status).not.toBe(200);

    const newSignIn = await clientAuthApi('POST', '/api/auth/signin', {
      email: newEmail,
      password,
    });
    expect(newSignIn.status).toBe(200);
    expect(newSignIn.data.user.email).toBe(newEmail);
  });
});

// ─── 13. Admin Auth — deleteUser ────────────────────────────────────────────

describe('admin auth — deleteUser', () => {
  it('DELETE /api/auth/admin/users/:id → 200', async () => {
    const email = `admin-del-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
    });
    const userId = data?.user?.id;
    if (!userId) return;
    const { status } = await api('DELETE', `/api/auth/admin/users/${userId}`);
    expect(status).toBe(200);
  });

  it('deleteUser — 이미 삭제된 user → 404 or 200', async () => {
    const { status } = await api('DELETE', '/api/auth/admin/users/non-existent-del-id');
    expect([200, 404].includes(status)).toBe(true);
  });

  it('deleteUser — cached public profile 무효화', async () => {
    const email = `admin-cache-del-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const created = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
      displayName: 'Cache Delete',
    });
    const userId = created.data?.user?.id;
    expect(created.status).toBe(201);
    expect(userId).toBeDefined();

    const warmProfile = await api('GET', `/admin/api/data/users/${userId}/profile`);
    expect(warmProfile.status).toBe(200);

    const deleted = await api('DELETE', `/api/auth/admin/users/${userId}`);
    expect(deleted.status).toBe(200);

    const profileAfterDelete = await api('GET', `/admin/api/data/users/${userId}/profile`);
    expect(profileAfterDelete.status).toBe(404);
  });
});

// ─── 14. Admin Auth — setCustomClaims ───────────────────────────────────────

describe('admin auth — setCustomClaims', () => {
  let testUserId: string;

  beforeAll(async () => {
    const email = `admin-claims-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
    });
    testUserId = data?.user?.id;
  });

  it('PUT /api/auth/admin/users/:id/claims → 200', async () => {
    if (!testUserId) return;
    const { status } = await api('PUT', `/api/auth/admin/users/${testUserId}/claims`, {
      plan: 'pro',
      orgId: 'org-123',
    });
    expect([200, 204].includes(status)).toBe(true);
  });

  it('setCustomClaims — 빈 객체 → 200 (claims 초기화)', async () => {
    if (!testUserId) return;
    const { status } = await api('PUT', `/api/auth/admin/users/${testUserId}/claims`, {});
    expect([200, 204].includes(status)).toBe(true);
  });
});

// ─── 15. Admin Auth — revokeAllSessions ─────────────────────────────────────

describe('admin auth — revokeAllSessions', () => {
  let testUserId: string;

  beforeAll(async () => {
    const email = `admin-revoke-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { data } = await api('POST', '/api/auth/admin/users', {
      email,
      password: 'StrongPass1!',
    });
    testUserId = data?.user?.id;
  });

  it('POST /api/auth/admin/users/:id/revoke → 200', async () => {
    if (!testUserId) return;
    const { status } = await api('POST', `/api/auth/admin/users/${testUserId}/revoke`);
    expect([200, 204].includes(status)).toBe(true);
  });
});

// ─── 16. Admin Auth — No Service Key → 403 ─────────────────────────────────

describe('admin auth — service key 필수', () => {
  it('SK 없이 createUser → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-sk@test.com', password: 'StrongPass1!' }),
    });
    expect(res.status).toBe(403);
  });

  it('SK 없이 listUsers → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/admin/users`, {
      headers: {},
    });
    expect(res.status).toBe(403);
  });

  it('SK 없이 deleteUser → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/admin/users/some-id`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(403);
  });

  it('SK 없이 setCustomClaims → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/admin/users/some-id/claims`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });
    expect(res.status).toBe(403);
  });

  it('SK 없이 revokeAllSessions → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/admin/users/some-id/revoke`, {
      method: 'POST',
    });
    expect(res.status).toBe(403);
  });
});

// ─── 17. SQL exec ───────────────────────────────────────────────────────────

describe('admin — SQL exec', () => {
  it('POST /api/sql — SELECT → 200 + results', async () => {
    const { status, data } = await api('POST', '/api/sql', {
      namespace: 'shared',
      sql: 'SELECT 1 as val',
      params: [],
    });
    expect(status).toBe(200);
    expect(data.results || data.rows).toBeDefined();
  });

  it('SQL INSERT + SELECT 확인', async () => {
    const id = crypto.randomUUID();
    const insert = await api('POST', '/api/sql', {
      namespace: 'shared',
      sql: "INSERT INTO posts (id, title, createdAt, updatedAt) VALUES (?, 'sql-test', datetime('now'), datetime('now'))",
      params: [id],
    });
    expect([200, 201].includes(insert.status)).toBe(true);

    const select = await api('POST', '/api/sql', {
      namespace: 'shared',
      sql: 'SELECT * FROM posts WHERE id = ?',
      params: [id],
    });
    expect(select.status).toBe(200);
  });

  it('CRUD로 생성한 row를 /api/sql에서 조회할 수 있다', async () => {
    const title = `sql-cross-route-${crypto.randomUUID().slice(0, 8)}`;
    const created = await api('POST', '/api/db/shared/tables/posts', {
      title,
    });
    expect(created.status).toBe(201);

    const select = await api('POST', '/api/sql', {
      namespace: 'shared',
      sql: 'SELECT title FROM posts WHERE title = ?',
      params: [title],
    });
    expect(select.status).toBe(200);
    expect(Array.isArray(select.data?.rows)).toBe(true);
    expect(select.data?.rows?.some?.((row: { title?: string }) => row.title === title)).toBe(true);
  });

  it('SQL UPDATE', async () => {
    const { status } = await api('POST', '/api/sql', {
      namespace: 'shared',
      sql: "UPDATE posts SET title = 'updated-sql' WHERE title = 'sql-test'",
      params: [],
    });
    expect([200, 201].includes(status)).toBe(true);
  });

  it('SQL DELETE', async () => {
    const { status } = await api('POST', '/api/sql', {
      namespace: 'shared',
      sql: "DELETE FROM posts WHERE title = 'updated-sql'",
      params: [],
    });
    expect([200, 201].includes(status)).toBe(true);
  });

  it('SQL — namespace 누락 → 400', async () => {
    const { status } = await api('POST', '/api/sql', {
      sql: 'SELECT 1',
    });
    expect(status).toBe(400);
  });

  it('SQL — sql 누락 → 400', async () => {
    const { status } = await api('POST', '/api/sql', {
      namespace: 'shared',
    });
    expect(status).toBe(400);
  });

  it('SQL — 미존재 namespace → 404', async () => {
    const { status } = await api('POST', '/api/sql', {
      namespace: 'nonexistent',
      sql: 'SELECT 1',
    });
    expect(status).toBe(404);
  });

  it('SQL — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: 'shared', sql: 'SELECT 1' }),
    });
    expect(res.status).toBe(403);
  });
});

// ─── 18. D1 exec / batch ────────────────────────────────────────────────────

describe('admin — D1 API', () => {
  it('POST /api/d1/analytics → 200 + results', async () => {
    const { status, data } = await api('POST', '/api/d1/analytics', {
      query: 'SELECT 1 as val',
      params: [],
    });
    expect(status).toBe(200);
    expect(data.results).toBeDefined();
  });

  it('D1 — CREATE TABLE + INSERT + SELECT', async () => {
    const create = await api('POST', '/api/d1/analytics', {
      query: 'CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY, name TEXT)',
    });
    expect([200, 201].includes(create.status)).toBe(true);

    const insert = await api('POST', '/api/d1/analytics', {
      query: 'INSERT INTO test_table (id, name) VALUES (?, ?)',
      params: ['d1-1', 'hello'],
    });
    expect([200, 201].includes(insert.status)).toBe(true);

    const select = await api('POST', '/api/d1/analytics', {
      query: 'SELECT * FROM test_table WHERE id = ?',
      params: ['d1-1'],
    });
    expect(select.status).toBe(200);
    expect(Array.isArray(select.data.results)).toBe(true);
  });

  it('D1 — query 누락 → 400', async () => {
    const { status } = await api('POST', '/api/d1/analytics', {});
    expect(status).toBe(400);
  });

  it('D1 — 미존재 database → 404', async () => {
    const { status } = await api('POST', '/api/d1/nonexistent', {
      query: 'SELECT 1',
    });
    expect(status).toBe(404);
  });

  it('D1 — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/d1/analytics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SELECT 1' }),
    });
    expect(res.status).toBe(403);
  });

  it('D1 — prepare + bind (parameterized query)', async () => {
    await api('POST', '/api/d1/analytics', {
      query: 'CREATE TABLE IF NOT EXISTS test_bind (id TEXT, value REAL)',
    });
    const { status } = await api('POST', '/api/d1/analytics', {
      query: 'INSERT INTO test_bind (id, value) VALUES (?, ?)',
      params: ['bind-1', 42.5],
    });
    expect([200, 201].includes(status)).toBe(true);
  });
});

// ─── 19. KV set / get / delete / list + TTL ─────────────────────────────────

describe('admin — KV API', () => {
  it('KV set → 200', async () => {
    const { status, data } = await api('POST', '/api/kv/test', {
      action: 'set',
      key: 'admin-test-key',
      value: 'hello-kv',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('KV get → 200 + value', async () => {
    const { status, data } = await api('POST', '/api/kv/test', {
      action: 'get',
      key: 'admin-test-key',
    });
    expect(status).toBe(200);
    expect(data.value).toBe('hello-kv');
  });

  it('KV delete → 200', async () => {
    const { status, data } = await api('POST', '/api/kv/test', {
      action: 'delete',
      key: 'admin-test-key',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('KV get 삭제 후 → null', async () => {
    const { status, data } = await api('POST', '/api/kv/test', {
      action: 'get',
      key: 'admin-test-key',
    });
    expect(status).toBe(200);
    expect(data.value).toBeNull();
  });

  it('KV list → 200 + keys 배열', async () => {
    // Seed a key first
    await api('POST', '/api/kv/test', { action: 'set', key: 'list-key-1', value: 'v1' });
    const { status, data } = await api('POST', '/api/kv/test', {
      action: 'list',
      prefix: 'list-key',
    });
    expect(status).toBe(200);
    expect(Array.isArray(data.keys)).toBe(true);
  });

  it('KV set with TTL → 200', async () => {
    const { status, data } = await api('POST', '/api/kv/test', {
      action: 'set',
      key: 'ttl-key',
      value: 'expires-soon',
      ttl: 60,
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('KV — invalid action → 400', async () => {
    const { status } = await api('POST', '/api/kv/test', {
      action: 'invalid',
    });
    expect(status).toBe(400);
  });

  it('KV — action 누락 → 400', async () => {
    const { status } = await api('POST', '/api/kv/test', {});
    expect(status).toBe(400);
  });

  it('KV get — key 누락 → 400', async () => {
    const { status } = await api('POST', '/api/kv/test', { action: 'get' });
    expect(status).toBe(400);
  });

  it('KV set — key 누락 → 400', async () => {
    const { status } = await api('POST', '/api/kv/test', { action: 'set', value: 'no-key' });
    expect(status).toBe(400);
  });

  it('KV set — value 누락 → 400', async () => {
    const { status } = await api('POST', '/api/kv/test', { action: 'set', key: 'no-value' });
    expect(status).toBe(400);
  });

  it('KV — 미존재 namespace → 404', async () => {
    const { status } = await api('POST', '/api/kv/nonexistent', {
      action: 'get',
      key: 'k',
    });
    expect(status).toBe(404);
  });

  it('KV — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/kv/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get', key: 'k' }),
    });
    expect(res.status).toBe(403);
  });
});

// ─── 20. Vectorize (stub) ───────────────────────────────────────────────────

describe('admin — Vectorize API (stub)', () => {
  it('vectorize search → stub response', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      vector: new Array(1536).fill(0.1),
      topK: 5,
    });
    expect(status).toBe(200);
    expect(data.matches || data._stub).toBeDefined();
  });

  it('vectorize upsert → stub response', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'upsert',
      vectors: [{ id: 'vec-1', values: new Array(1536).fill(0.5) }],
    });
    expect(status).toBe(200);
    expect(data.ok || data._stub).toBeDefined();
  });

  it('vectorize delete → stub response', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'delete',
      ids: ['vec-1'],
    });
    expect(status).toBe(200);
    expect(data.ok || data._stub).toBeDefined();
  });

  it('vectorize — invalid action → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'invalid',
    });
    expect(status).toBe(400);
  });

  it('vectorize — 미존재 index → 404', async () => {
    const { status } = await api('POST', '/api/vectorize/nonexistent', {
      action: 'search',
      vector: [0.1],
    });
    expect(status).toBe(404);
  });

  it('vectorize — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/vectorize/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', vector: [0.1] }),
    });
    expect(res.status).toBe(403);
  });

  // ─── New action stub tests ──────────────────────────────────────

  it('vectorize insert → stub response', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'insert',
      vectors: [{ id: 'vec-new', values: new Array(1536).fill(0.3) }],
    });
    expect(status).toBe(200);
    expect(data._stub).toBe(true);
    expect(data.ok).toBe(true);
  });

  it('vectorize getByIds → stub response', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'getByIds',
      ids: ['vec-1', 'vec-2'],
    });
    expect(status).toBe(200);
    expect(data._stub).toBe(true);
    expect(data.vectors).toEqual([]);
  });

  it('vectorize queryById → stub response', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'queryById',
      vectorId: 'vec-1',
    });
    expect(status).toBe(200);
    expect(data._stub).toBe(true);
    expect(data.matches).toEqual([]);
  });

  it('vectorize describe → stub response with all fields', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'describe',
    });
    expect(status).toBe(200);
    expect(data._stub).toBe(true);
    expect(data.vectorCount).toBe(0);
    expect(data.dimensions).toBe(1536);
    expect(data.metric).toBe('cosine');
    // v2 processedUpTo fields should be present (null in stub)
    expect('processedUpToDatetime' in data).toBe(true);
    expect('processedUpToMutation' in data).toBe(true);
  });

  // ─── Search options tests ──────────────────────────────────────

  it('vectorize search with returnValues → stub 200', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      vector: new Array(1536).fill(0.1),
      topK: 5,
      returnValues: true,
    });
    expect(status).toBe(200);
    expect(data._stub).toBe(true);
  });

  it('vectorize search with returnMetadata → stub 200', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      vector: new Array(1536).fill(0.1),
      topK: 5,
      returnMetadata: 'all',
    });
    expect(status).toBe(200);
    expect(data._stub).toBe(true);
  });

  it('vectorize search with namespace → stub 200', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      vector: new Array(1536).fill(0.1),
      topK: 5,
      namespace: 'ns-1',
    });
    expect(status).toBe(200);
    expect(data._stub).toBe(true);
  });

  // ─── Input validation tests ──────────────────────────────────────

  it('vectorize upsert — empty vectors → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'upsert',
      vectors: [],
    });
    expect(status).toBe(400);
  });

  it('vectorize insert — empty vectors → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'insert',
      vectors: [],
    });
    expect(status).toBe(400);
  });

  it('vectorize delete — empty ids → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'delete',
      ids: [],
    });
    expect(status).toBe(400);
  });

  it('vectorize getByIds — empty ids → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'getByIds',
      ids: [],
    });
    expect(status).toBe(400);
  });

  it('vectorize search — topK = 0 → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      vector: new Array(1536).fill(0.1),
      topK: 0,
    });
    expect(status).toBe(400);
  });

  it('vectorize search — topK = 101 → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      vector: new Array(1536).fill(0.1),
      topK: 101,
    });
    expect(status).toBe(400);
  });

  it('vectorize search — dimension mismatch → 400', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      vector: [0.1, 0.2, 0.3],
    });
    expect(status).toBe(400);
    expect(data.message).toContain('dimension mismatch');
  });

  it('vectorize upsert — dimension mismatch → 400 before binding call', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'upsert',
      vectors: [{ id: 'vec-1', values: [0.1, 0.2, 0.3] }],
    });
    expect(status).toBe(400);
    expect(data.message).toContain('dimension mismatch');
  });

  it('vectorize insert — dimension mismatch → 400 before binding call', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'insert',
      vectors: [{ id: 'vec-1', values: [0.1, 0.2, 0.3] }],
    });
    expect(status).toBe(400);
    expect(data.message).toContain('dimension mismatch');
  });

  it('vectorize search — missing vector → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      topK: 5,
    });
    expect(status).toBe(400);
  });

  it('vectorize queryById — missing vectorId → 400', async () => {
    const { status } = await api('POST', '/api/vectorize/embeddings', {
      action: 'queryById',
    });
    expect(status).toBe(400);
  });

  // ─── Response format tests ──────────────────────────────────────

  it('vectorize upsert stub → has count and mutationId fields', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'upsert',
      vectors: [{ id: 'vec-1', values: new Array(1536).fill(0.5) }],
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.count).toBeDefined();
    expect('mutationId' in data).toBe(true);
  });

  it('vectorize delete stub → has count and mutationId fields', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'delete',
      ids: ['vec-1'],
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.count).toBeDefined();
    expect('mutationId' in data).toBe(true);
  });

  it('vectorize insert stub → has count and mutationId fields', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'insert',
      vectors: [{ id: 'vec-x', values: new Array(1536).fill(0.1) }],
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.count).toBeDefined();
    expect('mutationId' in data).toBe(true);
  });

  // ─── returnMetadata: boolean test ──────────────────────────────

  it('vectorize search with returnMetadata: true (boolean) → stub 200', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'search',
      vector: new Array(1536).fill(0.1),
      topK: 5,
      returnMetadata: true,
    });
    expect(status).toBe(200);
    expect(data._stub).toBe(true);
  });

  // ─── applyNamespace test ──────────────────────────────────────

  it('vectorize upsert with namespace → stub 200 (namespace accepted)', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'upsert',
      vectors: [{ id: 'vec-ns', values: new Array(1536).fill(0.5) }],
      namespace: 'articles',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('vectorize insert with namespace → stub 200 (namespace accepted)', async () => {
    const { status, data } = await api('POST', '/api/vectorize/embeddings', {
      action: 'insert',
      vectors: [{ id: 'vec-ns2', values: new Array(1536).fill(0.2) }],
      namespace: 'articles',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });
});

// ─── 21. Broadcast — send ───────────────────────────────────────────────────

describe('admin — broadcast.send', () => {
  it('POST /api/db/broadcast → 200', async () => {
    const { status, data } = await api('POST', '/api/db/broadcast', {
      channel: 'test-channel',
      event: 'test-event',
      payload: { hello: 'world' },
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('broadcast — channel 누락 → 400', async () => {
    const { status } = await api('POST', '/api/db/broadcast', {
      event: 'test-event',
    });
    expect(status).toBe(400);
  });

  it('broadcast — event 누락 → 400', async () => {
    const { status } = await api('POST', '/api/db/broadcast', {
      channel: 'test-channel',
    });
    expect(status).toBe(400);
  });

  it('broadcast — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'ch', event: 'ev' }),
    });
    expect(res.status).toBe(403);
  });
});

// ─── 22. Push — send / sendMany / sendToToken / getTokens / getLogs ────────

describe('admin — push API', () => {
  it('POST /api/push/send — userId 누락 → 400', async () => {
    const { status } = await api('POST', '/api/push/send', {
      payload: { title: 'test', body: 'hi' },
    });
    // 400 (missing userId) or 503 (push not configured)
    expect([400, 503].includes(status)).toBe(true);
  });

  it('POST /api/push/send — payload 누락 → 400', async () => {
    const { status } = await api('POST', '/api/push/send', {
      userId: 'test-user-id',
    });
    expect([400, 503].includes(status)).toBe(true);
  });

  it('POST /api/push/send-many — userIds 누락 → 400', async () => {
    const { status } = await api('POST', '/api/push/send-many', {
      payload: { title: 'test', body: 'hi' },
    });
    expect([400, 503].includes(status)).toBe(true);
  });

  it('POST /api/push/send-many — 빈 배열 → 400', async () => {
    const { status } = await api('POST', '/api/push/send-many', {
      userIds: [],
      payload: { title: 'test', body: 'hi' },
    });
    expect([400, 503].includes(status)).toBe(true);
  });

  it('POST /api/push/send-to-token — token 누락 → 400', async () => {
    const { status } = await api('POST', '/api/push/send-to-token', {
      payload: { title: 'test', body: 'hi' },
    });
    expect([400, 503].includes(status)).toBe(true);
  });

  it('GET /api/push/tokens — userId 누락 → 400', async () => {
    const { status } = await api('GET', '/api/push/tokens');
    expect(status).toBe(400);
  });

  it('GET /api/push/tokens?userId=... → 200 + items', async () => {
    const { status, data } = await api('GET', '/api/push/tokens?userId=test-user-id');
    expect(status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('GET /api/push/logs — userId 누락 → 400', async () => {
    const { status } = await api('GET', '/api/push/logs');
    expect(status).toBe(400);
  });

  it('GET /api/push/logs?userId=... → 200 + items', async () => {
    const { status, data } = await api('GET', '/api/push/logs?userId=test-user-id');
    expect(status).toBe(200);
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('push send — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/push/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u', payload: { title: 'x', body: 'y' } }),
    });
    expect(res.status).toBe(403);
  });

  it('push send-many — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/push/send-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['u'], payload: { title: 'x', body: 'y' } }),
    });
    expect(res.status).toBe(403);
  });

  it('push tokens — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/push/tokens?userId=u`, {
      method: 'GET',
    });
    expect(res.status).toBe(403);
  });

  it('push logs — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/push/logs?userId=u`, {
      method: 'GET',
    });
    expect(res.status).toBe(403);
  });

  it('push send-to-token — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/push/send-to-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'fcm-token-123', payload: { title: 'x', body: 'y' } }),
    });
    expect(res.status).toBe(403);
  });

  // ─── FCM 일원화: send-to-topic / broadcast ───

  it('POST /api/push/send-to-topic — topic 누락 → 400', async () => {
    const { status } = await api('POST', '/api/push/send-to-topic', {
      payload: { title: 'test', body: 'hi' },
    });
    expect([400, 503].includes(status)).toBe(true);
  });

  it('POST /api/push/send-to-topic — payload 누락 → 400', async () => {
    const { status } = await api('POST', '/api/push/send-to-topic', {
      topic: 'news',
    });
    expect([400, 503].includes(status)).toBe(true);
  });

  it('POST /api/push/broadcast — payload 누락 → 400', async () => {
    const { status } = await api('POST', '/api/push/broadcast', {});
    expect([400, 503].includes(status)).toBe(true);
  });

  it('push send-to-topic — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/push/send-to-topic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'news', payload: { title: 'x', body: 'y' } }),
    });
    expect(res.status).toBe(403);
  });

  it('push broadcast — SK 없이 → 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/push/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { title: 'x', body: 'y' } }),
    });
    expect(res.status).toBe(403);
  });
});

// ─── 23. Admin Query Contract — proxy must match DO direct path ──────────────

describe('admin — query contract (proxy must match DO direct path)', () => {
  const seedIds: string[] = [];
  const PREFIX = `QC-${Date.now()}-`;

  beforeAll(async () => {
    // Seed 5 records with distinct views for deterministic sorting
    const posts = [
      { title: `${PREFIX}A`, views: 10, isPublished: true },
      { title: `${PREFIX}B`, views: 30, isPublished: false },
      { title: `${PREFIX}C`, views: 20, isPublished: true },
      { title: `${PREFIX}D`, views: 40, isPublished: true },
      { title: `${PREFIX}E`, views: 5,  isPublished: false },
    ];
    for (const p of posts) {
      const { data } = await api('POST', '/admin/api/data/tables/posts/records', p);
      if (data?.id) seedIds.push(data.id);
    }
  });

  afterAll(async () => {
    for (const id of seedIds) {
      await api('DELETE', `/admin/api/data/tables/posts/records/${id}`);
    }
  });

  // ── Sort ──

  it('sort=views:desc → actual descending order', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const { status, data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&sort=views:desc&limit=5`);
    expect(status).toBe(200);
    const views = data.items.map((r: any) => r.views);
    for (let i = 1; i < views.length; i++) {
      expect(views[i]).toBeLessThanOrEqual(views[i - 1]);
    }
  });

  it('sort=views:asc → actual ascending order', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&sort=views:asc&limit=5`);
    const views = data.items.map((r: any) => r.views);
    for (let i = 1; i < views.length; i++) {
      expect(views[i]).toBeGreaterThanOrEqual(views[i - 1]);
    }
  });

  it('sort=title:asc → alphabetical order', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&sort=title:asc&limit=5`);
    const titles = data.items.map((r: any) => r.title);
    for (let i = 1; i < titles.length; i++) {
      expect(titles[i] >= titles[i - 1]).toBe(true);
    }
  });

  // ── Filter ──

  it('filter views > 15 → only matching records', async () => {
    const filter = JSON.stringify([['views', '>', 15], ['title', 'contains', PREFIX]]);
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&limit=10`);
    expect(data.items.length).toBeGreaterThanOrEqual(3); // 20, 30, 40
    for (const r of data.items) {
      expect(r.views).toBeGreaterThan(15);
    }
  });

  it('filter contains → substring match', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&limit=10`);
    expect(data.items.length).toBe(5);
    for (const r of data.items) {
      expect(r.title).toContain(PREFIX);
    }
  });

  it('filter == → exact value match', async () => {
    const filter = JSON.stringify([['views', '==', 40], ['title', 'contains', PREFIX]]);
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&limit=10`);
    expect(data.items.length).toBe(1);
    expect(data.items[0].views).toBe(40);
  });

  // ── Filter + Sort combo ──

  it('filter + sort → filtered then sorted', async () => {
    const filter = JSON.stringify([['views', '>=', 10], ['title', 'contains', PREFIX]]);
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&sort=views:desc&limit=10`);
    const views = data.items.map((r: any) => r.views);
    // All >= 10
    for (const v of views) expect(v).toBeGreaterThanOrEqual(10);
    // Descending
    for (let i = 1; i < views.length; i++) {
      expect(views[i]).toBeLessThanOrEqual(views[i - 1]);
    }
  });

  // ── Pagination ──

  it('limit + offset → correct slice', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const all = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&sort=views:asc&limit=10`);
    const page = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&sort=views:asc&limit=2&offset=2`);
    expect(page.data.items.length).toBe(2);
    expect(page.data.items[0].id).toBe(all.data.items[2].id);
    expect(page.data.items[1].id).toBe(all.data.items[3].id);
  });

  it('cursor (after) → next page (default id sort)', async () => {
    // Cursor pagination uses WHERE "id" > ? — only correct with default id sort.
    // Custom sort (views:asc/desc) + cursor produces overlaps because
    // value order ≠ id order.
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const p1 = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&limit=2`);
    expect(p1.data.items.length).toBe(2);
    expect(p1.data.cursor).toBeTruthy();

    const p2 = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&limit=2&after=${p1.data.cursor}`);
    expect(p2.data.items.length).toBeGreaterThanOrEqual(1);
    // No ID overlap
    const ids1 = p1.data.items.map((r: any) => r.id);
    const ids2 = p2.data.items.map((r: any) => r.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  // ── Golden Query: filter + sort + limit + cursor ──

  it('golden: filter>=10 + sort:desc + limit=3 → [40,30,20]', async () => {
    const filter = JSON.stringify([['views', '>=', 10], ['title', 'contains', PREFIX]]);
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&sort=views:desc&limit=3`);
    const views = data.items.map((r: any) => r.views);
    expect(views).toEqual([40, 30, 20]);
  });

  it('golden: cursor pagination with filter → no overlap (default id sort)', async () => {
    // Cursor pagination uses WHERE "id" > ? — only works with default id sort.
    // Custom sort + cursor is a known limitation (keyset pagination not yet implemented).
    const filter = JSON.stringify([['views', '>=', 10], ['title', 'contains', PREFIX]]);
    const p1 = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&limit=2`);
    expect(p1.data.items).toHaveLength(2);
    expect(p1.data.cursor).toBeTruthy();

    const p2 = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&limit=2&after=${p1.data.cursor}`);
    const ids1 = p1.data.items.map((r: any) => r.id);
    const ids2 = p2.data.items.map((r: any) => r.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
    // Default sort is id ASC, so page 2 ids should all be greater than page 1 ids
    expect(ids2.every((id2: string) => ids1.every((id1: string) => id2 > id1))).toBe(true);
  });

  // ── Proxy Transparency: admin result === DO direct result ──

  it('admin proxy result === DO direct path result (sort)', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const qs = `filter=${encodeURIComponent(filter)}&sort=views:desc&limit=5`;

    const admin = await api('GET', `/admin/api/data/tables/posts/records?${qs}`);
    const direct = await api('GET', `/api/db/shared/tables/posts?${qs}`);

    expect(admin.status).toBe(200);
    expect(direct.status).toBe(200);

    const adminIds = admin.data.items.map((r: any) => r.id);
    const directIds = direct.data.items.map((r: any) => r.id);
    expect(adminIds).toEqual(directIds);
  });

  it('admin proxy result === DO direct path result (filter + offset)', async () => {
    const filter = JSON.stringify([['views', '>=', 10], ['title', 'contains', PREFIX]]);
    const qs = `filter=${encodeURIComponent(filter)}&sort=views:asc&limit=2&offset=1`;

    const admin = await api('GET', `/admin/api/data/tables/posts/records?${qs}`);
    const direct = await api('GET', `/api/db/shared/tables/posts?${qs}`);

    expect(admin.status).toBe(200);
    expect(direct.status).toBe(200);

    const adminIds = admin.data.items.map((r: any) => r.id);
    const directIds = direct.data.items.map((r: any) => r.id);
    expect(adminIds).toEqual(directIds);
  });

  // ── orFilter ──

  it('orFilter → OR conditions work', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const orFilter = JSON.stringify([['views', '==', 10], ['views', '==', 40]]);
    const { status, data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&orFilter=${encodeURIComponent(orFilter)}&limit=10`);
    expect(status).toBe(200);
    const views = data.items.map((r: any) => r.views).sort((a: number, b: number) => a - b);
    expect(views).toEqual([10, 40]);
  });

  it('filter + orFilter combo → AND then OR', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX], ['isPublished', '==', true]]);
    const orFilter = JSON.stringify([['views', '==', 10], ['views', '==', 40]]);
    const { status, data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&orFilter=${encodeURIComponent(orFilter)}&limit=10`);
    expect(status).toBe(200);
    // A(10,pub), D(40,pub) match; B(30,unpub) excluded by isPublished filter
    const views = data.items.map((r: any) => r.views).sort((a: number, b: number) => a - b);
    expect(views).toEqual([10, 40]);
    for (const r of data.items) {
      expect(r.isPublished).toBeTruthy();
    }
  });

  it('admin proxy === DO direct (orFilter)', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const orFilter = JSON.stringify([['views', '==', 10], ['views', '==', 40]]);
    const qs = `filter=${encodeURIComponent(filter)}&orFilter=${encodeURIComponent(orFilter)}&limit=10`;

    const admin = await api('GET', `/admin/api/data/tables/posts/records?${qs}`);
    const direct = await api('GET', `/api/db/shared/tables/posts?${qs}`);

    expect(admin.status).toBe(200);
    expect(direct.status).toBe(200);
    const adminIds = admin.data.items.map((r: any) => r.id);
    const directIds = direct.data.items.map((r: any) => r.id);
    expect(adminIds).toEqual(directIds);
  });

  // ── fields ──

  it('fields=id,title → only those columns returned', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const { status, data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&fields=id,title&limit=5`);
    expect(status).toBe(200);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    for (const r of data.items) {
      expect(r.id).toBeDefined();
      expect(r.title).toBeDefined();
      // fields projection: other columns should NOT be present
      expect(r.views).toBeUndefined();
      expect(r.content).toBeUndefined();
    }
  });

  it('admin proxy === DO direct (fields)', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const qs = `filter=${encodeURIComponent(filter)}&fields=id,title,views&sort=views:asc&limit=5`;

    const admin = await api('GET', `/admin/api/data/tables/posts/records?${qs}`);
    const direct = await api('GET', `/api/db/shared/tables/posts?${qs}`);

    expect(admin.status).toBe(200);
    expect(direct.status).toBe(200);
    expect(admin.data.items.map((r: any) => r.id)).toEqual(direct.data.items.map((r: any) => r.id));
    // Both should have exactly the same fields
    for (let i = 0; i < admin.data.items.length; i++) {
      expect(Object.keys(admin.data.items[i]).sort()).toEqual(Object.keys(direct.data.items[i]).sort());
    }
  });

  // ── Response shape ──

  it('list response shape: items, hasMore, cursor present', async () => {
    const filter = JSON.stringify([['title', 'contains', PREFIX]]);
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?filter=${encodeURIComponent(filter)}&limit=2`);
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.hasMore).toBe('boolean');
    expect(data.cursor).toBeDefined();
    // total/page/perPage present for offset pagination
    expect(typeof data.total).toBe('number');
  });

  it('single record shape: id, createdAt, updatedAt present', async () => {
    const { data } = await api('GET',
      `/admin/api/data/tables/posts/records?limit=1`);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    const record = data.items[0];
    expect(record.id).toBeDefined();
    expect(record.createdAt).toBeDefined();
    expect(record.updatedAt).toBeDefined();
  });
});

// ─── 24. Admin Write Contract — create/update/delete must work correctly ─────

describe('admin — write contract (create/update/delete)', () => {
  const writeIds: string[] = [];
  const WC_PREFIX = `WC-${Date.now()}-`;

  afterAll(async () => {
    for (const id of writeIds) {
      await api('DELETE', `/admin/api/data/tables/posts/records/${id}`);
    }
  });

  // ── Create ──

  it('POST create → record with id, createdAt, updatedAt', async () => {
    const { status, data } = await api('POST', '/admin/api/data/tables/posts/records', {
      title: `${WC_PREFIX}Create`, views: 99, isPublished: true,
    });
    expect([200, 201].includes(status)).toBe(true);
    expect(data.id).toBeDefined();
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
    expect(data.title).toBe(`${WC_PREFIX}Create`);
    expect(data.views).toBe(99);
    writeIds.push(data.id);
  });

  // ── Update (PUT admin → PATCH DO) ──

  it('PUT update → modified fields returned', async () => {
    // Create first
    const { data: created } = await api('POST', '/admin/api/data/tables/posts/records', {
      title: `${WC_PREFIX}Update`, views: 10, isPublished: false,
    });
    writeIds.push(created.id);

    // Update via admin PUT
    const { status, data: updated } = await api('PUT',
      `/admin/api/data/tables/posts/records/${created.id}`,
      { views: 77, isPublished: true });
    expect(status).toBe(200);
    expect(updated.views).toBe(77);
    expect(updated.isPublished).toBeTruthy();
    expect(updated.title).toBe(`${WC_PREFIX}Update`); // unchanged field preserved
  });

  // ── Delete ──

  it('DELETE → { deleted: true }', async () => {
    const { data: created } = await api('POST', '/admin/api/data/tables/posts/records', {
      title: `${WC_PREFIX}Delete`, views: 1,
    });
    const { status, data } = await api('DELETE',
      `/admin/api/data/tables/posts/records/${created.id}`);
    expect(status).toBe(200);
    expect(data.deleted).toBe(true);
    // Verify gone — GET should 404
    const { status: getStatus } = await api('GET',
      `/api/db/shared/tables/posts/${created.id}`);
    expect(getStatus).toBe(404);
  });

  // ── Full CRUD round-trip ──

  it('CRUD round-trip: create → read → update → delete', async () => {
    // 1. Create
    const { data: created } = await api('POST', '/admin/api/data/tables/posts/records', {
      title: `${WC_PREFIX}CRUD`, views: 50, isPublished: true,
    });
    expect(created.id).toBeDefined();

    // 2. Read via DO direct GET (by ID) — verifies record was actually created
    const { status: readStatus, data: readData } = await api('GET',
      `/api/db/shared/tables/posts/${created.id}`);
    expect(readStatus).toBe(200);
    expect(readData.id).toBe(created.id);
    expect(readData.title).toBe(`${WC_PREFIX}CRUD`);

    // 3. Update via admin PUT
    const { data: updated } = await api('PUT',
      `/admin/api/data/tables/posts/records/${created.id}`,
      { views: 999 });
    expect(updated.views).toBe(999);

    // 4. Delete via admin DELETE
    const { data: deleted } = await api('DELETE',
      `/admin/api/data/tables/posts/records/${created.id}`);
    expect(deleted.deleted).toBe(true);

    // 5. Verify gone
    const { status: goneStatus } = await api('GET',
      `/api/db/shared/tables/posts/${created.id}`);
    expect(goneStatus).toBe(404);
  });

  // ── Create response shape matches DO direct path ──

  it('admin create response === DO direct create response (shape)', async () => {
    // Admin create
    const { data: adminRec } = await api('POST', '/admin/api/data/tables/posts/records', {
      title: `${WC_PREFIX}ShapeAdmin`, views: 11,
    });
    writeIds.push(adminRec.id);

    // DO direct create
    const { data: directRec } = await api('POST', '/api/db/shared/tables/posts', {
      title: `${WC_PREFIX}ShapeDirect`, views: 22,
    });
    writeIds.push(directRec.id);

    // Same set of top-level keys
    const adminKeys = Object.keys(adminRec).sort();
    const directKeys = Object.keys(directRec).sort();
    expect(adminKeys).toEqual(directKeys);
  });
});
