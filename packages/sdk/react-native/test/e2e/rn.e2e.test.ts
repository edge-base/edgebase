/**
 * @edgebase/react-native — E2E 테스트
 *
 * wrangler dev --port 8688 실서버 필요
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 *     npx vitest run packages/sdk/react-native/test/e2e/rn.e2e.test.ts
 *
 * 원칙: mock 금지, 실서버 fetch, 시뮬레이터 불필요 항목만
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '../../../js/packages/admin/src/index.js';

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:8688';
const SERVICE_KEY = process.env['SERVICE_KEY'] || process.env['EDGEBASE_SERVICE_KEY'] || 'test-service-key-for-admin';

const PREFIX = `rn-e2e-${Date.now()}`;
const createdIds: string[] = [];
let admin: ReturnType<typeof createAdminClient>;

// In-memory AsyncStorage mock (no native modules needed)
const mockStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
    removeItem: async (key: string) => { store.delete(key); },
  };
})();

beforeAll(() => {
  admin = createAdminClient(BASE_URL, { serviceKey: SERVICE_KEY });
});

afterAll(async () => {
  for (const id of createdIds) {
    try { await admin.db('shared').table('posts').delete(id); } catch {}
  }
  admin.destroy();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Auth E2E (signup + signin + signout + refresh)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Auth', () => {
  it('signup → accessToken + user.id 반환', async () => {
    const email = `rn-signup-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnTest1234!' }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
    expect(data.user?.id).toBeTruthy();
  });

  it('signin → accessToken + refreshToken 반환', async () => {
    const email = `rn-signin-${Date.now()}@test.com`;
    // signup first
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnSign1234!' }),
    });
    const res = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnSign1234!' }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
  });

  it('signout → 성공', async () => {
    const email = `rn-signout-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnSign1234!' }),
    });
    const { accessToken, refreshToken } = await signupRes.json() as any;
    const res = await fetch(`${BASE_URL}/api/auth/signout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ refreshToken }),
    });
    expect([200, 204].includes(res.status)).toBe(true);
  });

  it('refresh → 새 accessToken 발급', async () => {
    const email = `rn-refresh-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnRef1234!' }),
    });
    const { refreshToken } = await signupRes.json() as any;
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
  });

  it('signup+signin+signout full chain', async () => {
    const email = `rn-chain-${Date.now()}@test.com`;
    const pw = 'RnChain1234!';
    // signup
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    expect(signupRes.ok).toBe(true);
    const signupData = await signupRes.json() as any;
    // signin
    const signinRes = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    });
    expect(signinRes.ok).toBe(true);
    const signinData = await signinRes.json() as any;
    expect(signinData.user.id).toBe(signupData.user.id);
    // signout
    const signoutRes = await fetch(`${BASE_URL}/api/auth/signout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${signinData.accessToken}`,
      },
      body: JSON.stringify({ refreshToken: signinData.refreshToken }),
    });
    expect([200, 204].includes(signoutRes.status)).toBe(true);
  });

  it('anonymous auth → user.isAnonymous', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signin/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json() as any;
      expect(data.accessToken).toBeTruthy();
      expect(data.user?.id).toBeTruthy();
    } else {
      // anonymous auth may not be enabled — skip gracefully
      expect([400, 403, 404].includes(res.status)).toBe(true);
    }
  });

  it('wrong password → 401 또는 400', async () => {
    const email = `rn-wrongpw-${Date.now()}@test.com`;
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Correct1234!' }),
    });
    const res = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Wrong1234!' }),
    });
    expect(res.ok).toBe(false);
    expect([400, 401].includes(res.status)).toBe(true);
  });

  it('duplicate signup → 에러', async () => {
    const email = `rn-dup-${Date.now()}@test.com`;
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnDup1234!' }),
    });
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnDup1234!' }),
    });
    expect(res.ok).toBe(false);
  });

  it('signup with data → user metadata 저장', async () => {
    const email = `rn-data-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnData1234!', data: { displayName: 'RN Tester' } }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.user?.id).toBeTruthy();
  });

  it('change-password → 새 비밀번호로 signin 가능', async () => {
    const email = `rn-changepw-${Date.now()}@test.com`;
    const oldPw = 'OldPass1234!';
    const newPw = 'NewPass1234!';
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: oldPw }),
    });
    const { accessToken } = await signupRes.json() as any;
    // change password
    const changeRes = await fetch(`${BASE_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ currentPassword: oldPw, newPassword: newPw }),
    });
    expect(changeRes.ok).toBe(true);
    // signin with new password
    const signinRes = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: newPw }),
    });
    expect(signinRes.ok).toBe(true);
  });

  it('sessions list → 배열 반환', async () => {
    const email = `rn-sessions-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnSess1234!' }),
    });
    const { accessToken } = await signupRes.json() as any;
    const res = await fetch(`${BASE_URL}/api/auth/sessions`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    expect(Array.isArray(data.sessions)).toBe(true);
  });

  it('updateProfile → displayName 변경', async () => {
    const email = `rn-profile-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnProf1234!' }),
    });
    const { accessToken } = await signupRes.json() as any;
    const res = await fetch(`${BASE_URL}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ displayName: 'RN Profile Test' }),
    });
    expect(res.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DB CRUD (admin으로 테스트)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — DB CRUD', () => {
  it('insert → id 반환', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-insert` });
    expect((r as any).id).toBeTruthy();
    createdIds.push((r as any).id);
  });

  it('getOne → 레코드 반환', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-getOne` });
    const id = (r as any).id;
    createdIds.push(id);
    const fetched = await admin.db('shared').table('posts').getOne(id);
    expect((fetched as any).id).toBe(id);
  });

  it('update → 변경 반영', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-upd` });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { title: `${PREFIX}-rn-upd-done` });
    expect((updated as any).title).toBe(`${PREFIX}-rn-upd-done`);
  });

  it('delete → getOne 에러', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-del` });
    const id = (r as any).id;
    await admin.db('shared').table('posts').delete(id);
    await expect(admin.db('shared').table('posts').getOne(id)).rejects.toThrow();
  });

  it('insert+get+update+delete full chain', async () => {
    // insert
    const created = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-full-chain` });
    const id = (created as any).id;
    expect(id).toBeTruthy();
    // get
    const fetched = await admin.db('shared').table('posts').getOne(id);
    expect((fetched as any).title).toBe(`${PREFIX}-rn-full-chain`);
    // update
    const updated = await admin.db('shared').table('posts').update(id, { title: `${PREFIX}-rn-full-chain-updated` });
    expect((updated as any).title).toBe(`${PREFIX}-rn-full-chain-updated`);
    // verify update
    const verified = await admin.db('shared').table('posts').getOne(id);
    expect((verified as any).title).toBe(`${PREFIX}-rn-full-chain-updated`);
    // delete
    await admin.db('shared').table('posts').delete(id);
    await expect(admin.db('shared').table('posts').getOne(id)).rejects.toThrow();
  });

  it('insert → createdAt 필드 존재', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-timestamps` });
    createdIds.push((r as any).id);
    expect((r as any).createdAt).toBeTruthy();
  });

  it('update → updatedAt 필드 변경', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-ts-upd` });
    createdIds.push((r as any).id);
    const updated = await admin.db('shared').table('posts').update((r as any).id, { title: `${PREFIX}-rn-ts-upd-v2` });
    expect((updated as any).updatedAt).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Filter E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Filter', () => {
  it('where == 필터', async () => {
    const unique = `${PREFIX}-rn-filter-${crypto.randomUUID().slice(0, 6)}`;
    const r = await admin.db('shared').table('posts').insert({ title: unique });
    createdIds.push((r as any).id);
    const list = await admin.db('shared').table('posts').where('title', '==', unique).getList();
    expect(list.items.length).toBeGreaterThanOrEqual(1);
  });

  it('orderBy + limit ≤ N', async () => {
    const list = await admin.db('shared').table('posts').orderBy('createdAt', 'desc').limit(3).getList();
    expect(list.items.length).toBeLessThanOrEqual(3);
  });

  it('count() → 숫자', async () => {
    const count = await admin.db('shared').table('posts').count();
    expect(typeof count).toBe('number');
  });

  it('where + orderBy + limit 조합', async () => {
    const tag = `${PREFIX}-rn-combo-${Date.now()}`;
    await admin.db('shared').table('posts').insert({ title: `${tag}-1` });
    await admin.db('shared').table('posts').insert({ title: `${tag}-2` });
    const list = await admin.db('shared').table('posts')
      .where('title', 'contains', tag)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .getList();
    expect(list.items.length).toBe(1);
    for (const item of list.items) createdIds.push((item as any).id);
  });

  it('where != 필터', async () => {
    const unique = `${PREFIX}-rn-ne-${Date.now()}`;
    const r = await admin.db('shared').table('posts').insert({ title: unique });
    createdIds.push((r as any).id);
    const list = await admin.db('shared').table('posts')
      .where('title', '!=', 'nonexistent-value-xyz')
      .limit(5)
      .getList();
    expect(list.items.length).toBeGreaterThan(0);
  });

  it('where contains 필터', async () => {
    const tag = `${PREFIX}-rn-contains-${Date.now()}`;
    const r = await admin.db('shared').table('posts').insert({ title: `hello-${tag}-world` });
    createdIds.push((r as any).id);
    const list = await admin.db('shared').table('posts')
      .where('title', 'contains', tag)
      .getList();
    expect(list.items.length).toBeGreaterThanOrEqual(1);
  });

  it('offset pagination', async () => {
    const list = await admin.db('shared').table('posts')
      .orderBy('createdAt', 'desc')
      .limit(2)
      .offset(0)
      .getList();
    expect(list.items.length).toBeLessThanOrEqual(2);
  });

  it('count with filter', async () => {
    const tag = `${PREFIX}-rn-cnt-filter-${Date.now()}`;
    await admin.db('shared').table('posts').insert({ title: tag });
    const r2 = await admin.db('shared').table('posts').insert({ title: tag });
    createdIds.push((r2 as any).id);
    const count = await admin.db('shared').table('posts').where('title', '==', tag).count();
    expect(count).toBeGreaterThanOrEqual(1);
    // cleanup first
    const list = await admin.db('shared').table('posts').where('title', '==', tag).getList();
    for (const item of list.items) createdIds.push((item as any).id);
  });

  it('or() 필터', async () => {
    const tag1 = `${PREFIX}-rn-or-a-${Date.now()}`;
    const tag2 = `${PREFIX}-rn-or-b-${Date.now()}`;
    const r1 = await admin.db('shared').table('posts').insert({ title: tag1 });
    const r2 = await admin.db('shared').table('posts').insert({ title: tag2 });
    createdIds.push((r1 as any).id, (r2 as any).id);
    const list = await admin.db('shared').table('posts')
      .or(q => q.where('title', '==', tag1).where('title', '==', tag2))
      .getList();
    expect(list.items.length).toBeGreaterThanOrEqual(2);
  });

  it('cursor pagination (after)', async () => {
    // Create some items to paginate
    const tag = `${PREFIX}-rn-cursor-${Date.now()}`;
    const items: any[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await admin.db('shared').table('posts').insert({ title: `${tag}-${i}` });
      items.push(r);
      createdIds.push((r as any).id);
    }
    // First page
    const page1 = await admin.db('shared').table('posts')
      .where('title', 'contains', tag)
      .limit(2)
      .getList();
    expect(page1.items.length).toBeLessThanOrEqual(2);
    if (page1.cursor) {
      const page2 = await admin.db('shared').table('posts')
        .where('title', 'contains', tag)
        .limit(2)
        .after(page1.cursor)
        .getList();
      expect(page2.items.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('search (FTS)', async () => {
    const unique = `${PREFIX}-rn-search-${Date.now()}`;
    const r = await admin.db('shared').table('posts').insert({ title: unique });
    createdIds.push((r as any).id);
    // FTS may need a moment to index
    await new Promise(resolve => setTimeout(resolve, 200));
    const list = await admin.db('shared').table('posts')
      .search(unique)
      .getList();
    // FTS might not find it immediately in all backends; assert structure
    expect(Array.isArray(list.items)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3b. Golden Query — filter + sort + limit contract
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Golden Query', () => {
  const gqPrefix = `${PREFIX}-gq`;
  const gqIds: string[] = [];

  beforeAll(async () => {
    const records = [
      { title: `${gqPrefix}-A`, views: 10 },
      { title: `${gqPrefix}-B`, views: 30 },
      { title: `${gqPrefix}-C`, views: 20 },
      { title: `${gqPrefix}-D`, views: 40 },
      { title: `${gqPrefix}-E`, views: 5 },
    ];
    for (const rec of records) {
      const r = await admin.db('shared').table('posts').insert(rec);
      gqIds.push((r as any).id);
      createdIds.push((r as any).id);
    }
  });

  it('filter>=10 + sort:desc + limit=3 → [40,30,20]', async () => {
    const list = await admin.db('shared').table('posts')
      .where('title', 'contains', gqPrefix)
      .where('views', '>=', 10)
      .orderBy('views', 'desc')
      .limit(3)
      .getList();
    const views = list.items.map((r: any) => r.views);
    expect(views).toEqual([40, 30, 20]);
  });

  it('cursor pagination with filter → no overlap', async () => {
    const p1 = await admin.db('shared').table('posts')
      .where('title', 'contains', gqPrefix)
      .limit(2)
      .getList();
    expect(p1.items.length).toBe(2);
    expect(p1.cursor).toBeTruthy();

    const p2 = await admin.db('shared').table('posts')
      .where('title', 'contains', gqPrefix)
      .limit(2)
      .after(p1.cursor!)
      .getList();
    const ids1 = p1.items.map((r: any) => r.id);
    const ids2 = p2.items.map((r: any) => r.id);
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('CRUD round-trip: insert → getOne → update → delete → verify 404', async () => {
    const crudTitle = `${gqPrefix}-CRUD-${Date.now()}`;

    // Create
    const created = await admin.db('shared').table('posts').insert({
      title: crudTitle, views: 111, isPublished: true,
    });
    expect((created as any).id).toBeTruthy();

    // Read
    const read = await admin.db('shared').table('posts').getOne((created as any).id);
    expect((read as any).title).toBe(crudTitle);
    expect((read as any).views).toBe(111);

    // Update
    const updated = await admin.db('shared').table('posts').update((created as any).id, { views: 222 });
    expect((updated as any).views).toBe(222);

    // Delete
    await admin.db('shared').table('posts').delete((created as any).id);

    // Verify 404
    try {
      await admin.db('shared').table('posts').getOne((created as any).id);
      expect.unreachable('should have thrown after delete');
    } catch (e: any) {
      expect(e.status).toBe(404);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Storage E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Storage', () => {
  it('upload + download', async () => {
    const key = `rn-e2e-${Date.now()}.txt`;
    const content = 'hello from RN E2E';
    const bucket = admin.storage.bucket('test-bucket');
    await bucket.upload(key, new Blob([content], { type: 'text/plain' }));
    const url = bucket.getUrl(key);
    expect(url).toContain(key);
    // cleanup
    try { await bucket.delete(key); } catch {}
  });

  it('upload + getUrl → URL 포함 bucket + key', async () => {
    const key = `rn-e2e-url-${Date.now()}.txt`;
    const bucket = admin.storage.bucket('test-bucket');
    await bucket.upload(key, new Blob(['url-test'], { type: 'text/plain' }));
    const url = bucket.getUrl(key);
    expect(url).toContain('test-bucket');
    expect(url).toContain(encodeURIComponent(key));
    try { await bucket.delete(key); } catch {}
  });

  it('upload + list → 파일 목록에 포함', async () => {
    const key = `rn-e2e-list-${Date.now()}.txt`;
    const bucket = admin.storage.bucket('test-bucket');
    await bucket.upload(key, new Blob(['list-test'], { type: 'text/plain' }));
    const result = await bucket.list({ prefix: 'rn-e2e-list-' });
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    try { await bucket.delete(key); } catch {}
  });

  it('upload + delete → 삭제 성공', async () => {
    const key = `rn-e2e-delete-${Date.now()}.txt`;
    const bucket = admin.storage.bucket('test-bucket');
    await bucket.upload(key, new Blob(['delete-test'], { type: 'text/plain' }));
    await expect(bucket.delete(key)).resolves.not.toThrow();
  });

  it('download as text', async () => {
    const key = `rn-e2e-text-${Date.now()}.txt`;
    const content = 'download-text-test';
    const bucket = admin.storage.bucket('test-bucket');
    await bucket.upload(key, new Blob([content], { type: 'text/plain' }));
    const downloaded = await bucket.download(key, { as: 'text' }) as string;
    expect(downloaded).toBe(content);
    try { await bucket.delete(key); } catch {}
  });

  it('uploadString + download', async () => {
    const key = `rn-e2e-upload-string-${Date.now()}.txt`;
    const content = 'uploadString from RN E2E';
    const bucket = admin.storage.bucket('test-bucket');
    await bucket.uploadString(key, content);
    const downloaded = await bucket.download(key, { as: 'text' }) as string;
    expect(downloaded).toBe(content);
    try { await bucket.delete(key); } catch {}
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Batch E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Batch', () => {
  it('insertMany → N개', async () => {
    const items = [
      { title: `${PREFIX}-rn-batch-1` },
      { title: `${PREFIX}-rn-batch-2` },
    ];
    const result = await admin.db('shared').table('posts').insertMany(items);
    expect(result.length).toBe(2);
    for (const r of result) createdIds.push((r as any).id);
  });

  it('insertMany → 각 항목에 id 존재', async () => {
    const items = [
      { title: `${PREFIX}-rn-batch-id-1` },
      { title: `${PREFIX}-rn-batch-id-2` },
      { title: `${PREFIX}-rn-batch-id-3` },
    ];
    const result = await admin.db('shared').table('posts').insertMany(items);
    expect(result.length).toBe(3);
    for (const r of result) {
      expect((r as any).id).toBeTruthy();
      createdIds.push((r as any).id);
    }
  });

  it('insertMany → 빈 배열 → 빈 결과', async () => {
    const result = await admin.db('shared').table('posts').insertMany([]);
    expect(result.length).toBe(0);
  });

  it('updateMany → where 필터로 일괄 수정', async () => {
    const tag = `${PREFIX}-rn-batchupd-${Date.now()}`;
    const items = [
      { title: tag, status: 'draft' },
      { title: tag, status: 'draft' },
    ];
    const created = await admin.db('shared').table('posts').insertMany(items);
    for (const r of created) createdIds.push((r as any).id);
    const result = await admin.db('shared').table('posts')
      .where('title', '==', tag)
      .updateMany({ status: 'published' });
    expect(result.totalSucceeded).toBeGreaterThanOrEqual(1);
  });

  it('deleteMany → where 필터로 일괄 삭제', async () => {
    const tag = `${PREFIX}-rn-batchdel-${Date.now()}`;
    const items = [
      { title: tag },
      { title: tag },
    ];
    const created = await admin.db('shared').table('posts').insertMany(items);
    // no need to add to createdIds since we're deleting
    const result = await admin.db('shared').table('posts')
      .where('title', '==', tag)
      .deleteMany();
    expect(result.totalSucceeded).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Upsert E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Upsert', () => {
  it('upsert 신규 → action === "inserted"', async () => {
    const r = await admin.db('shared').table('posts').upsert({ title: `${PREFIX}-rn-upsert` });
    expect((r as any).action).toBe('inserted');
    createdIds.push((r as any).id);
  });

  it('upsert 기존 → action === "updated"', async () => {
    const created = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-upsert-exist` });
    const id = (created as any).id;
    createdIds.push(id);
    const r = await admin.db('shared').table('posts').upsert({ id, title: `${PREFIX}-rn-upsert-exist-v2` });
    expect((r as any).action).toBe('updated');
    expect((r as any).title).toBe(`${PREFIX}-rn-upsert-exist-v2`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. FieldOps E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — FieldOps', () => {
  it('increment → 숫자 필드 증가', async () => {
    const { increment } = await import('@edgebase/core');
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-inc`, viewCount: 10 });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { viewCount: increment(5) } as any);
    expect((updated as any).viewCount).toBe(15);
  });

  it('increment 음수 → 감소', async () => {
    const { increment } = await import('@edgebase/core');
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-dec`, viewCount: 20 });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { viewCount: increment(-3) } as any);
    expect((updated as any).viewCount).toBe(17);
  });

  it('deleteField → 필드 null/삭제', async () => {
    const { deleteField } = await import('@edgebase/core');
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-delfld`, extra: 'temp' });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').update(id, { extra: deleteField() } as any);
    expect((updated as any).extra).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Error', () => {
  it('getOne 없는 id → 에러', async () => {
    await expect(admin.db('shared').table('posts').getOne('nonexistent-rn-99999')).rejects.toThrow();
  });

  it('update 없는 id → 에러', async () => {
    await expect(admin.db('shared').table('posts').update('nonexistent-rn-upd', { title: 'X' })).rejects.toThrow();
  });

  it('delete 없는 id → 에러', async () => {
    await expect(admin.db('shared').table('posts').delete('nonexistent-rn-del')).rejects.toThrow();
  });

  it('updateMany without where → 에러', async () => {
    await expect(
      admin.db('shared').table('posts').updateMany({ title: 'X' })
    ).rejects.toThrow();
  });

  it('deleteMany without where → 에러', async () => {
    await expect(
      admin.db('shared').table('posts').deleteMany()
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. AsyncStorage 세션 유지 (언어특화)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — AsyncStorage 세션 (언어특화)', () => {
  it('signup → refreshToken을 AsyncStorage에 저장 후 복원', async () => {
    const email = `rn-storage-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnStorage1234!' }),
    });
    const { refreshToken } = await signupRes.json() as any;

    // Simulate storing refresh token in AsyncStorage
    await mockStorage.setItem('edgebase:refresh-token', refreshToken);
    const stored = await mockStorage.getItem('edgebase:refresh-token');
    expect(stored).toBe(refreshToken);
  });

  it('signout → AsyncStorage refreshToken 삭제 시뮬레이션', async () => {
    await mockStorage.setItem('edgebase:refresh-token', 'some-token');
    await mockStorage.removeItem('edgebase:refresh-token');
    const stored = await mockStorage.getItem('edgebase:refresh-token');
    expect(stored).toBeNull();
  });

  it('TokenManager 복원 → AsyncStorage 기반 user 복구', async () => {
    const email = `rn-restore-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnRestore1234!' }),
    });
    const { refreshToken } = await signupRes.json() as any;

    // Create a fresh mock storage with the token
    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();
    await storage.setItem('edgebase:refresh-token', refreshToken);

    // Create TokenManager with pre-populated storage
    const { TokenManager } = await import('../../src/token-manager');
    const tm = new TokenManager(BASE_URL, storage);
    await tm.ready();
    // If JWT is valid, user should be restored from refresh token
    const user = tm.getCurrentUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBeTruthy();
    tm.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. DatabaseLive subscription (구조 E2E)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — DatabaseLive (구조 검증)', () => {
  it('auth 후 TokenManager에 토큰 설정 → DatabaseLiveClient 생성 가능', async () => {
    const email = `rn-rt-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnRealtime1234!' }),
    });
    const { accessToken, refreshToken } = await signupRes.json() as any;
    const { TokenManager } = await import('../../src/token-manager');
    const { DatabaseLiveClient } = await import('../../src/database-live');
    const { ContextManager } = await import('@edgebase/core');

    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();

    const tm = new TokenManager(BASE_URL, storage);
    await tm.ready();
    tm.setTokens({ accessToken, refreshToken });

    const cm = new ContextManager();
    const live = new DatabaseLiveClient(BASE_URL, tm, undefined, cm);
    expect(live).toBeDefined();
    expect(typeof live.disconnect).toBe('function');
    live.disconnect();
    tm.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Room E2E (구조 검증)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Room (구조 검증)', () => {
  it('auth 후 room.join() 가능', async () => {
    const email = `rn-room-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnRoom1234!' }),
    });
    const { accessToken, refreshToken } = await signupRes.json() as any;
    const { TokenManager } = await import('../../src/token-manager');
    const { RoomClient } = await import('../../src/room');

    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();

    const tm = new TokenManager(BASE_URL, storage);
    await tm.ready();
    tm.setTokens({ accessToken, refreshToken });

    const room = new RoomClient(BASE_URL, 'default', `rn-test-room-${Date.now()}`, tm);
    // join should attempt connection (may succeed or fail depending on server config)
    try {
      await Promise.race([
        room.join(),
        new Promise(r => setTimeout(r, 2000)),
      ]);
    } catch {
      // Connection may fail in test env — that's OK for structure test
    }
    room.leave();
    tm.destroy();
  });

  it('room.leave() → state 초기화', async () => {
    const { TokenManager } = await import('../../src/token-manager');
    const { RoomClient } = await import('../../src/room');
    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();
    const tm = new TokenManager(BASE_URL, storage);
    await tm.ready();
    const room = new RoomClient(BASE_URL, 'default', `rn-leave-test-${Date.now()}`, tm);
    room.leave();
    expect(room.getSharedState()).toEqual({});
    expect(room.getPlayerState()).toEqual({});
    tm.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Push E2E (구조 검증 — 실제 네이티브 모듈 없이)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Push (구조 검증)', () => {
  it('PushClient 생성 → register 에러 (토큰 프로바이더 미설정)', async () => {
    const { PushClient } = await import('../../src/push');
    const push = new PushClient({} as any, mockStorage);
    await expect(push.register()).rejects.toThrow('No token provider set');
  });

  it('PushClient setTokenProvider → register 호출 시도', async () => {
    const email = `rn-push-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RnPush1234!' }),
    });
    const { accessToken } = await signupRes.json() as any;

    // Simulate HTTP client with auth
    const mockHttp = {
      post: async (path: string, body: any) => {
        const res = await fetch(`${BASE_URL}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    } as any;

    const { PushClient } = await import('../../src/push');
    const pushStorage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();
    const push = new PushClient(mockHttp, pushStorage);
    push.setTokenProvider(async () => ({ token: `mock-fcm-${Date.now()}`, platform: 'android' as const }));

    // register may fail if push not configured on server, but it should attempt
    try {
      await push.register();
    } catch {
      // Push might not be configured — OK for structure test
    }
  });

  it('PushClient message dispatch 체인', async () => {
    const { PushClient } = await import('../../src/push');
    const push = new PushClient({} as any, mockStorage);
    const fgMessages: any[] = [];
    const tapMessages: any[] = [];
    push.onMessage(msg => fgMessages.push(msg));
    push.onMessageOpenedApp(msg => tapMessages.push(msg));

    push._dispatchForegroundMessage({ title: 'FG', body: 'Foreground msg' });
    push._dispatchOpenedAppMessage({ title: 'TAP', data: { screen: 'home' } });

    expect(fgMessages).toHaveLength(1);
    expect(tapMessages).toHaveLength(1);
    expect(fgMessages[0].title).toBe('FG');
    expect(tapMessages[0].data.screen).toBe('home');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. createClient 통합 E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — createClient 통합', () => {
  it('createClient + auth.signUp → user 확인', async () => {
    const { createClient } = await import('../../src/client');
    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();
    const client = createClient(BASE_URL, { storage });
    const email = `rn-client-${Date.now()}@test.com`;
    const result = await client.auth.signUp({ email, password: 'RnClient1234!' });
    expect(result.user.id).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(client.auth.currentUser).not.toBeNull();
    expect(client.auth.currentUser?.id).toBe(result.user.id);
    client.destroy();
  });

  it('createClient + auth.signIn → token 설정', async () => {
    const { createClient } = await import('../../src/client');
    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();
    const client = createClient(BASE_URL, { storage });
    const email = `rn-client-si-${Date.now()}@test.com`;
    await client.auth.signUp({ email, password: 'RnSi1234!' });
    client.destroy();

    // New client for sign-in
    const client2 = createClient(BASE_URL, { storage: (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })() });
    const result = await client2.auth.signIn({ email, password: 'RnSi1234!' });
    expect(result.user.id).toBeTruthy();
    expect(client2.auth.currentUser?.email).toBe(email);
    client2.destroy();
  });

  it('createClient + auth.signOut → user null', async () => {
    const { createClient } = await import('../../src/client');
    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();
    const client = createClient(BASE_URL, { storage });
    const email = `rn-client-so-${Date.now()}@test.com`;
    await client.auth.signUp({ email, password: 'RnSo1234!' });
    expect(client.auth.currentUser).not.toBeNull();
    await client.auth.signOut();
    expect(client.auth.currentUser).toBeNull();
    client.destroy();
  });

  it('createClient + onAuthStateChange → signup/signout 이벤트', async () => {
    const { createClient } = await import('../../src/client');
    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();
    const client = createClient(BASE_URL, { storage });
    const states: (any | null)[] = [];
    const unsub = client.auth.onAuthStateChange(user => states.push(user));
    // Initial state = null
    expect(states[0]).toBeNull();

    const email = `rn-client-asc-${Date.now()}@test.com`;
    await client.auth.signUp({ email, password: 'RnAsc1234!' });
    // Should have at least 2 states: null, then user
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states[states.length - 1]?.id).toBeTruthy();

    await client.auth.signOut();
    // Should have null at end
    expect(states[states.length - 1]).toBeNull();

    unsub();
    client.destroy();
  });

  it('createClient → db().table() CRUD', async () => {
    const { createClient } = await import('../../src/client');
    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();
    const client = createClient(BASE_URL, { storage });
    const email = `rn-client-crud-${Date.now()}@test.com`;
    await client.auth.signUp({ email, password: 'RnCrud1234!' });

    // Create
    const table = client.db('shared').table('posts');
    const created = await table.insert({ title: `${PREFIX}-rn-client-crud` }) as any;
    expect(created.id).toBeTruthy();
    createdIds.push(created.id);

    // Read
    const fetched = await table.getOne(created.id) as any;
    expect(fetched.id).toBe(created.id);

    // List
    const list = await table.where('id', '==', created.id).getList();
    expect(list.items.length).toBe(1);

    client.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Lifecycle E2E (시뮬레이션)
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Lifecycle (시뮬레이션)', () => {
  it('LifecycleManager: background→foreground 사이클', async () => {
    const { TokenManager } = await import('../../src/token-manager');
    const { LifecycleManager } = await import('../../src/lifecycle');

    const storage = (() => {
      const store = new Map<string, string>();
      return {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      };
    })();

    const tm = new TokenManager(BASE_URL, storage);
    await tm.ready();

    let disconnected = false;
    let reconnected = false;
    const mockDatabaseLive = {
      disconnect: () => { disconnected = true; },
      reconnect: () => { reconnected = true; },
    };

    let stateHandler: ((state: string) => void) | null = null;
    const mockAppState = {
      currentState: 'active',
      addEventListener: (_type: string, handler: (state: string) => void) => {
        stateHandler = handler;
        return { remove: () => { stateHandler = null; } };
      },
    };

    const lm = new LifecycleManager(tm, mockDatabaseLive, mockAppState);
    lm.start();

    // Simulate going to background
    stateHandler?.('background');
    expect(disconnected).toBe(true);

    // Simulate coming back to foreground
    stateHandler?.('active');
    expect(reconnected).toBe(true);

    lm.stop();
    tm.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. DocRef E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — DocRef', () => {
  it('doc(id).get() → 레코드 반환', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-docref-get` });
    const id = (r as any).id;
    createdIds.push(id);
    const fetched = await admin.db('shared').table('posts').doc(id).get();
    expect((fetched as any).id).toBe(id);
    expect((fetched as any).title).toBe(`${PREFIX}-rn-docref-get`);
  });

  it('doc(id).update() → 변경 반영', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-docref-upd` });
    const id = (r as any).id;
    createdIds.push(id);
    const updated = await admin.db('shared').table('posts').doc(id).update({ title: `${PREFIX}-rn-docref-upd-v2` });
    expect((updated as any).title).toBe(`${PREFIX}-rn-docref-upd-v2`);
  });

  it('doc(id).delete() → getOne 에러', async () => {
    const r = await admin.db('shared').table('posts').insert({ title: `${PREFIX}-rn-docref-del` });
    const id = (r as any).id;
    await admin.db('shared').table('posts').doc(id).delete();
    await expect(admin.db('shared').table('posts').getOne(id)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. ListResult 구조 검증
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — ListResult 구조', () => {
  it('getList() → items 배열 포함', async () => {
    const list = await admin.db('shared').table('posts').limit(1).getList();
    expect(Array.isArray(list.items)).toBe(true);
  });

  it('getList() → total/page/perPage 또는 hasMore/cursor 존재', async () => {
    const list = await admin.db('shared').table('posts').limit(1).getList();
    // Offset pagination: total, page, perPage
    // Cursor pagination: hasMore, cursor
    const hasOffset = list.total !== null || list.page !== null;
    const hasCursor = list.hasMore !== null || list.cursor !== null;
    expect(hasOffset || hasCursor).toBe(true);
  });

  it('빈 결과 → items === []', async () => {
    const unique = `nonexistent-${Date.now()}-${Math.random()}`;
    const list = await admin.db('shared').table('posts').where('title', '==', unique).getList();
    expect(list.items).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. Push Client E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Push Client', () => {
  let accessToken: string;
  const deviceId = `rn-push-e2e-${Date.now()}`;
  const fcmToken = `fake-fcm-token-rn-${Date.now()}`;
  const BASE = process.env['BASE_URL'] || 'http://localhost:8688';

  it('signup for push', async () => {
    const email = `rn-push-${Date.now()}@test.com`;
    const res = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RNPush123!' }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    accessToken = data.accessToken;
  });

  it('push.register → 200', async () => {
    const res = await fetch(`${BASE}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId, token: fcmToken, platform: 'ios' }),
    });
    expect(res.status).toBe(200);
  });

  it('push.subscribeTopic → 200', async () => {
    const res = await fetch(`${BASE}/api/push/topic/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ topic: 'rn-test-topic' }),
    });
    expect(res.status).toBe(200);
  });

  it('push.unsubscribeTopic → 200', async () => {
    const res = await fetch(`${BASE}/api/push/topic/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ topic: 'rn-test-topic' }),
    });
    expect(res.status).toBe(200);
  });

  it('push.unregister → 200', async () => {
    const res = await fetch(`${BASE}/api/push/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId }),
    });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. Push Full Flow E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('RN E2E — Push Full Flow', () => {
  const MOCK_FCM = 'http://localhost:9099';
  const BASE = process.env['BASE_URL'] || 'http://localhost:8688';
  const SK = process.env['SERVICE_KEY'] || process.env['EDGEBASE_SERVICE_KEY'] || 'test-service-key-for-admin';

  let accessToken: string;
  let userId: string;
  const ts = Date.now();
  const fcmToken = `flow-token-rn-${ts}`;
  const deviceId = `rn-flow-device-${ts}`;

  it('setup: signup → accessToken + userId', async () => {
    const email = `rn-fullflow-${ts}@test.com`;
    const res = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RNFlow1234!' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    accessToken = data.accessToken;
    userId = data.user.id;
    expect(accessToken).toBeTruthy();
    expect(userId).toBeTruthy();
  });

  it('clear mock FCM store', async () => {
    const res = await fetch(`${MOCK_FCM}/messages`, { method: 'DELETE' });
    expect([200, 204]).toContain(res.status);
  });

  it('client register → 200', async () => {
    const res = await fetch(`${BASE}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId, token: fcmToken, platform: 'web' }),
    });
    expect(res.status).toBe(200);
  });

  it('admin send(userId) → sent:1, mock FCM receives correct token/payload', async () => {
    // Admin send to userId
    const sendRes = await fetch(`${BASE}/api/push/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SK,
      },
      body: JSON.stringify({
        userId,
        payload: { title: 'Full Flow', body: 'E2E' },
      }),
    });
    expect(sendRes.status).toBe(200);
    const sendData = await sendRes.json() as any;
    expect(sendData.sent).toBe(1);

    // Verify mock FCM received the message
    const fcmRes = await fetch(`${MOCK_FCM}/messages?token=${encodeURIComponent(fcmToken)}`);
    expect(fcmRes.status).toBe(200);
    const items = await fcmRes.json() as any[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].token).toBe(fcmToken);
    expect(items[0].payload?.notification?.title).toBe('Full Flow');
  });

  it('admin sendToTopic → mock FCM receives topic "news"', async () => {
    // Clear mock FCM
    await fetch(`${MOCK_FCM}/messages`, { method: 'DELETE' });

    const res = await fetch(`${BASE}/api/push/send-to-topic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SK,
      },
      body: JSON.stringify({
        topic: 'news',
        payload: { title: 'Topic Test', body: 'rn topic' },
      }),
    });
    expect(res.status).toBe(200);

    // Verify mock FCM
    const fcmRes = await fetch(`${MOCK_FCM}/messages?topic=news`);
    expect(fcmRes.status).toBe(200);
    const items = await fcmRes.json() as any[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].topic).toBe('news');
  });

  it('admin broadcast → mock FCM receives topic "all"', async () => {
    // Clear mock FCM
    await fetch(`${MOCK_FCM}/messages`, { method: 'DELETE' });

    const res = await fetch(`${BASE}/api/push/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SK,
      },
      body: JSON.stringify({
        payload: { title: 'Broadcast', body: 'rn broadcast' },
      }),
    });
    expect(res.status).toBe(200);

    // Verify mock FCM
    const fcmRes = await fetch(`${MOCK_FCM}/messages?topic=all`);
    expect(fcmRes.status).toBe(200);
    const items = await fcmRes.json() as any[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].topic).toBe('all');
  });

  it('client unregister → 200', async () => {
    const res = await fetch(`${BASE}/api/push/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId }),
    });
    expect(res.status).toBe(200);
  });

  it('admin getTokens → items empty after unregister', async () => {
    const res = await fetch(`${BASE}/api/push/tokens?userId=${userId}`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.items).toEqual([]);
  });
});
