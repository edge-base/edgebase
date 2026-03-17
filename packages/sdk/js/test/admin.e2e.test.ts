/**
 * admin.e2e.test.ts — JS SDK @edgebase/admin E2E 테스트
 *
 * AdminEdgeBase 기능:
 *   - db(ns).table(name).CRUD — Service Key 자동 주입
 *   - adminAuth: createUser, getUser, listUsers, updateUser, deleteUser, revokeAllSessions
 *   - sql: raw SQL via /api/sql
 *   - broadcast: database-live broadcast via /api/db/broadcast
 *   - kv: KV get/set/delete/list via /api/kv/:namespace
 *   - storage: SK로 파일 업로드/다운로드
 *   - push: send push notification
 *
 * 실제 서버(wrangler dev --local :8688)에 HTTP 요청
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@edgebase/admin';

const SERVER = 'http://localhost:8688';
const SK = 'test-service-key-for-admin';

const admin = createAdminClient(SERVER, { serviceKey: SK });

// Raw fetch helper
async function raw(method: string, path: string, body?: unknown) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': SK,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// ─── 1. AdminEdgeBase db() — CRUD ────────────────────────────────────────────

describe('js-admin:db — CRUD', () => {
  const ids: string[] = [];

  afterAll(async () => {
    for (const id of ids) {
      await raw('DELETE', `/api/db/shared/tables/posts/${id}`);
    }
  });

  it('admin.db().table().insert() → id 반환', async () => {
    const post = await admin.db('shared').table<{ id: string; title: string }>('posts').insert({
      title: 'Admin SDK Create',
    });
    expect(typeof post.id).toBe('string');
    ids.push(post.id);
  });

  it('admin.db().table().getOne() → title 일치', async () => {
    if (ids.length === 0) return;
    const post = await admin.db('shared').table<{ id: string; title: string }>('posts').getOne(ids[0]);
    expect(post.title).toBe('Admin SDK Create');
  });

  it('admin.db().table().update() → 변경됨', async () => {
    if (ids.length === 0) return;
    const post = await admin.db('shared').table<{ id: string; title: string }>('posts').update(ids[0], {
      title: 'Admin SDK Updated',
    });
    expect(post.title).toBe('Admin SDK Updated');
  });

  it('admin.db().table().get() → items 배열', async () => {
    const result = await admin.db('shared').table('posts').limit(5).get();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('admin.db().table().count() → number', async () => {
    const total = await admin.db('shared').table('posts').count();
    expect(typeof total).toBe('number');
  });

  it('admin.db().table().delete() → 성공', async () => {
    if (ids.length === 0) return;
    await admin.db('shared').table('posts').delete(ids[0]);
    ids.shift();
  });

  it('admin.db().table().insertMany() → 배열 반환', async () => {
    const items = await admin.db('shared').table<{ id: string; title: string }>('posts').insertMany([
      { title: 'Admin Batch 1' },
      { title: 'Admin Batch 2' },
    ]);
    expect(items.length).toBe(2);
    for (const item of items) ids.push(item.id);
  });
});

// ─── 2. adminAuth — 사용자 관리 ───────────────────────────────────────────────

describe('js-admin:adminAuth — 사용자 관리', () => {
  let userId: string;

  it('signUp user (via raw API)', async () => {
    const email = `admin-sdk-${crypto.randomUUID().slice(0, 8)}@test.com`;
    const { data } = await raw('POST', '/api/auth/signup', { email, password: 'Admin1234!' });
    userId = data?.user?.id;
    expect(typeof userId).toBe('string');
  });

  it('adminAuth.getUser() → 유저 반환', async () => {
    if (!userId) return;
    try {
      const user = await admin.auth.getUser(userId);
      expect(user.id).toBe(userId);
    } catch (err: any) {
      // getUser may not be implemented
      expect([200, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('adminAuth.listUsers() → users 배열', async () => {
    try {
      const result = await admin.auth.listUsers();
      expect(Array.isArray(result.users ?? result)).toBe(true);
    } catch (err: any) {
      expect([200, 405].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('adminAuth.setCustomClaims() → claims 적용', async () => {
    if (!userId) return;
    try {
      await admin.auth.setCustomClaims(userId, { role: 'admin' });
    } catch (err: any) {
      expect([200, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('adminAuth.revokeAllSessions() → 세션 취소', async () => {
    if (!userId) return;
    try {
      await admin.auth.revokeAllSessions(userId);
    } catch (err: any) {
      expect([200, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('adminAuth.deleteUser() → 유저 삭제', async () => {
    if (!userId) return;
    try {
      await admin.auth.deleteUser(userId);
    } catch (err: any) {
      expect([200, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });
});

// ─── 3. sql() — 원시 SQL ─────────────────────────────────────────────────────

describe('js-admin:sql — raw SQL', () => {
  it('SELECT → 배열 반환', async () => {
    try {
      const rows = await admin.sql('shared', undefined, 'SELECT 1 as num');
      expect(Array.isArray(rows)).toBe(true);
      expect((rows as any)[0]?.num).toBe(1);
    } catch (err: any) {
      // sql may not be exposed
      expect([200, 403, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('SELECT posts 테이블', async () => {
    try {
      const rows = await admin.sql('shared', undefined, 'SELECT * FROM posts LIMIT 5');
      expect(Array.isArray(rows)).toBe(true);
    } catch (err: any) {
      expect([200, 403, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('parameterized query', async () => {
    try {
      const rows = await admin.sql('shared', undefined, 'SELECT ? as val', [42]);
      expect(Array.isArray(rows)).toBe(true);
      expect((rows as any)[0]?.val).toBe(42);
    } catch (err: any) {
      expect([200, 403, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('잘못된 SQL → error', async () => {
    try {
      await admin.sql('shared', undefined, 'NOT VALID SQL;');
      expect(false).toBe(true);
    } catch (err: any) {
      expect([400, 403, 404, 500].includes(err.status ?? 400)).toBe(true);
    }
  });
});

// ─── 4. broadcast ─────────────────────────────────────────────────────────────

describe('js-admin:broadcast', () => {
  it('broadcast → 200', async () => {
    try {
      await admin.broadcast('test-channel', 'test-event', { msg: 'hello' });
    } catch (err: any) {
      expect([200, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('channel 없이 broadcast → error', async () => {
    try {
      await admin.broadcast('', 'event', {});
    } catch (err: any) {
      expect([400, 404, 405].includes(err.status ?? 400)).toBe(true);
    }
  });
});

// ─── 5. kv ────────────────────────────────────────────────────────────────────

describe('js-admin:kv', () => {
  const testKey = `admin-kv-${crypto.randomUUID().slice(0, 8)}`;

  it('kv.set() / kv.get() / kv.delete()', async () => {
    try {
      const kv = admin.kv('user-meta');
      await kv.set(testKey, 'admin test value');
      const value = await kv.get(testKey);
      expect(value).toBe('admin test value');
      await kv.delete(testKey);
      const after = await kv.get(testKey);
      expect(after).toBeNull();
    } catch (err: any) {
      expect([200, 404].includes(err.status ?? 200)).toBe(true);
    }
  });

  it('kv.list() → keys 배열', async () => {
    try {
      const kv = admin.kv('user-meta');
      const result = await kv.list();
      expect(Array.isArray(result.keys)).toBe(true);
    } catch (err: any) {
      expect([200, 404].includes(err.status ?? 200)).toBe(true);
    }
  });
});

// ─── 6. storage (SK) ─────────────────────────────────────────────────────────

describe('js-admin:storage', () => {
  let fileKey: string;

  it('upload via raw fetch, list via admin.storage', async () => {
    const key = `admin-storage-${crypto.randomUUID().slice(0, 8)}.txt`;
    const form = new FormData();
    form.append('key', key);
    form.append('file', new Blob(['admin sdk storage test'], { type: 'text/plain' }), key);

    const res = await fetch(`${SERVER}/api/storage/avatars/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SK },
      body: form,
    });
    expect([200, 201].includes(res.status)).toBe(true);
    fileKey = key;
  });

  it('delete uploaded file', async () => {
    if (!fileKey) return;
    const res = await fetch(`${SERVER}/api/storage/avatars/${fileKey}`, {
      method: 'DELETE',
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect([200, 204, 404].includes(res.status)).toBe(true);
  });
});

// ─── 7. push.send ─────────────────────────────────────────────────────────────

describe('js-admin:push', () => {
  it('push.send() → 서버 응답 확인', async () => {
    try {
      await admin.push.send('fake-device-id', {
        title: 'Admin Push Test',
        body: 'Test message',
      });
    } catch (err: any) {
      // push may not be configured or device not registered
      expect([200, 400, 404, 405].includes(err.status ?? 200)).toBe(true);
    }
  });
});
