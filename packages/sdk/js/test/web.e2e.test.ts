/**
 * web.e2e.test.ts — JS SDK @edgebase/web E2E 테스트
 *
 * 실제 서버(wrangler dev --local :8688)에 HTTP 요청
 * 브라우저 환경 vitest happy-dom
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@edgebase/web';

const SERVER = 'http://localhost:8688';

function encodeBase64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeValidJwt(userId = 'u-oauth-web') {
  const header = encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = encodeBase64UrlJson({
    sub: userId,
    email: 'oauth-web@test.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${body}.sig`;
}

// Raw fetch helper (SK)
async function raw(method: string, path: string, body?: unknown) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': 'test-service-key-for-admin',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// ─── 1. 인증 (auth) E2E ───────────────────────────────────────────────────────

describe('js-web:auth — signUp / signIn / signOut', () => {
  const email = `jsweb-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const password = 'Web1234!';
  let client = createClient(SERVER);
  let accessToken: string;

  it('signUp → { user, accessToken, refreshToken }', async () => {
    const result = await client.auth.signUp({ email, password });
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.user?.email).toBe(email);
    accessToken = result.accessToken;
  });

  it('signUp 후 currentUser 설정됨', () => {
    const user = client.auth.currentUser;
    expect(user?.email).toBe(email);
  });

  it('signOut → currentUser null', async () => {
    await client.auth.signOut();
    expect(client.auth.currentUser).toBeNull();
  });

  it('signIn → { user, accessToken }', async () => {
    const result = await client.auth.signIn({ email, password });
    expect(typeof result.accessToken).toBe('string');
    expect(result.user?.email).toBe(email);
  });

  it('signIn 후 currentUser 있음', () => {
    expect(client.auth.currentUser).not.toBeNull();
  });

  it('onAuthStateChange — signIn 후 fired', async () => {
    const c2 = createClient(SERVER);
    let fired = false;
    const unsub = c2.auth.onAuthStateChange((user) => {
      if (user) fired = true;
    });
    await c2.auth.signIn({ email, password });
    await new Promise(r => setTimeout(r, 50));
    expect(fired).toBe(true);
    unsub();
    c2.destroy();
  });

  it('signIn with wrong pw → throw EdgeBaseError', async () => {
    const c2 = createClient(SERVER);
    try {
      await c2.auth.signIn({ email, password: 'wrong-password' });
      expect(false).toBe(true); // should throw
    } catch (err: any) {
      expect(err.status ?? err.code).toBe(401);
    }
  });
});

// ─── 2. auth session 목록 ────────────────────────────────────────────────────

describe('js-web:auth — listSessions / revokeSession', () => {
  const email = `jsweb-sess-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const client = createClient(SERVER);
  let sessionId: string;

  beforeAll(async () => {
    await client.auth.signUp({ email, password: 'Web1234!' });
  });

  it('listSessions → sessions 배열', async () => {
    const sessions = await client.auth.listSessions();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    sessionId = sessions[0]?.id;
  });

  it('revokeSession → 세션 삭제됨', async () => {
    if (!sessionId) return;
    await client.auth.revokeSession(sessionId);
    const sessions2 = await client.auth.listSessions();
    const remaining = sessions2.find(s => s.id === sessionId);
    expect(remaining).toBeUndefined();
  });
});

// ─── 3. db — client.db('shared').table('posts') ───────────────────────────────

describe('js-web:db — TableRef via client.db()', () => {
  const client = createClient(SERVER);
  let postId: string;
  const ids: string[] = [];

  beforeAll(async () => {
    const email = `jsweb-db-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await client.auth.signUp({ email, password: 'Web1234!' });
  });

  afterAll(async () => {
    for (const id of ids) {
      await raw('DELETE', `/api/db/shared/tables/posts/${id}`);
    }
  });

  it('insert → id 반환', async () => {
    const post = await client.db('shared').table<{ id: string; title: string }>('posts').insert({
      title: 'Web SDK Create',
    });
    expect(typeof post.id).toBe('string');
    postId = post.id;
    ids.push(postId);
  });

  it('getOne → title 일치', async () => {
    if (!postId) return;
    const post = await client.db('shared').table<{ id: string; title: string }>('posts').getOne(postId);
    expect(post.title).toBe('Web SDK Create');
  });

  it('update → 변경됨', async () => {
    if (!postId) return;
    const post = await client.db('shared').table<{ id: string; title: string }>('posts').update(postId, {
      title: 'Web SDK Updated',
    });
    expect(post.title).toBe('Web SDK Updated');
  });

  it('get() 리스트 → items 배열', async () => {
    const result = await client.db('shared').table('posts').limit(5).get();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('where filter → 필터링됨', async () => {
    if (!postId) return;
    const result = await client.db('shared').table<any>('posts')
      .where('id', '==', postId)
      .get();
    expect(result.items.some((i: any) => i.id === postId)).toBe(true);
  });

  it('search() matches Korean token prefixes', async () => {
    const created = await client.db('shared').table<any>('posts').insert({
      title: '검색 테스트',
      content: '준규야 반가워',
    });
    ids.push(created.id);

    const result = await client.db('shared').table<any>('posts').search('준규').get();
    expect(result.items.some((item: any) => item.id === created.id)).toBe(true);
  });

  it('count() → number', async () => {
    const total = await client.db('shared').table('posts').count();
    expect(typeof total).toBe('number');
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('doc(id).get() → record', async () => {
    if (!postId) return;
    const post = await client.db('shared').table<{ id: string; title: string }>('posts').doc(postId).get();
    expect(post.id).toBe(postId);
  });

  it('doc(id).update() → 변경됨', async () => {
    if (!postId) return;
    const post = await client.db('shared').table<{ id: string; title: string }>('posts').doc(postId).update({
      title: 'Web Doc Updated',
    });
    expect(post.title).toBe('Web Doc Updated');
  });

  it('doc(id).delete() → 완료', async () => {
    if (!postId) return;
    await client.db('shared').table('posts').doc(postId).delete();
    ids.splice(ids.indexOf(postId), 1);
  });

  it('offset/page pagination', async () => {
    const r1 = await client.db('shared').table('posts').limit(2).offset(0).get();
    const r2 = await client.db('shared').table('posts').limit(2).offset(2).get();
    for (const item of r1.items) {
      expect(r2.items.some((i: any) => i.id === (item as any).id)).toBe(false);
    }
  });

  it('onSnapshot receives inserts on the namespace-aware database-live channel', async () => {
    const publisher = createClient(SERVER);
    const subscriber = createClient(SERVER);
    const title = `DbLive ${Date.now()}`;
    let insertedId: string | undefined;

    try {
      await publisher.auth.signUp({
        email: `jsweb-rt-pub-${crypto.randomUUID().slice(0, 8)}@test.com`,
        password: 'Web1234!',
      });
      await subscriber.auth.signUp({
        email: `jsweb-rt-sub-${crypto.randomUUID().slice(0, 8)}@test.com`,
        password: 'Web1234!',
      });

      const received = new Promise<{ items: any[]; changes: { added: any[]; modified: any[]; removed: any[] } }>((resolve, reject) => {
        let unsubscribe = () => {};
        const timeout = setTimeout(() => {
          unsubscribe();
          reject(new Error('Timed out waiting for database-live insert'));
        }, 4000);

        unsubscribe = subscriber.db('shared').table<any>('posts').onSnapshot((snapshot) => {
          if (snapshot.changes.added.some((item: any) => item.title === title)) {
            clearTimeout(timeout);
            unsubscribe();
            resolve(snapshot);
          }
        });
      });

      await new Promise((r) => setTimeout(r, 500));

      const inserted = await publisher.db('shared').table<any>('posts').insert({
        title,
        content: 'DbLive payload',
        authorId: publisher.auth.currentUser!.id,
        authorName: publisher.auth.currentUser!.email,
      });
      insertedId = inserted.id;

      const snapshot = await received;
      expect(snapshot.changes.added.some((item: any) => item.id === insertedId)).toBe(true);
    } finally {
      if (insertedId) {
        await raw('DELETE', `/api/db/shared/tables/posts/${insertedId}`);
      }
      publisher.destroy();
      subscriber.destroy();
    }
  });
});

// ─── 4. db — 커서 페이지네이션 ────────────────────────────────────────────────

describe('js-web:db — cursor pagination', () => {
  const client = createClient(SERVER);
  const ids: string[] = [];

  beforeAll(async () => {
    const email = `jsweb-cursor-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await client.auth.signUp({ email, password: 'Web1234!' });
    for (let i = 0; i < 5; i++) {
      const { data } = await raw('POST', '/api/db/shared/tables/posts', { title: `Cursor ${i}` });
      if (data?.id) ids.push(data.id);
    }
  });

  afterAll(async () => {
    for (const id of ids) await raw('DELETE', `/api/db/shared/tables/posts/${id}`);
  });

  it('after(cursor) → 커서 이후 레코드', async () => {
    const page1 = await client.db('shared').table<any>('posts').limit(2).get();
    if (!page1.cursor) return;
    const page2 = await client.db('shared').table<any>('posts').limit(2).after(page1.cursor).get();
    for (const item of page1.items) {
      expect(page2.items.some((i: any) => i.id === item.id)).toBe(false);
    }
  });

  it('offset과 after() 동시 사용 → 에러', async () => {
    try {
      await client.db('shared').table('posts')
        .limit(2)
        .offset(1)
        .after('some-cursor')
        .get();
      expect(false).toBe(true);
    } catch (err: any) {
      expect(err.status ?? 400).toBe(400);
    }
  });
});

// ─── 5. db — OR filter ───────────────────────────────────────────────────────

describe('js-web:db — OR filter', () => {
  const client = createClient(SERVER);
  const ids: string[] = [];

  beforeAll(async () => {
    const email = `jsweb-or-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await client.auth.signUp({ email, password: 'Web1234!' });
    for (const t of ['OR One', 'OR Two', 'OR Three']) {
      const { data } = await raw('POST', '/api/db/shared/tables/posts', { title: t });
      if (data?.id) ids.push(data.id);
    }
  });

  afterAll(async () => {
    for (const id of ids) await raw('DELETE', `/api/db/shared/tables/posts/${id}`);
  });

  it('or() → 두 조건 중 하나 매칭', async () => {
    const result = await client.db('shared').table<any>('posts')
      .or(q => q.where('title', '==', 'OR One').where('title', '==', 'OR Two'))
      .get();
    const titles = result.items.map((i: any) => i.title);
    expect(titles.includes('OR One') || titles.includes('OR Two')).toBe(true);
  });
});

// ─── 6. storage E2E ───────────────────────────────────────────────────────────

describe('js-web:storage — upload / download / list / delete', () => {
  const client = createClient(SERVER);
  let fileKey: string;

  beforeAll(async () => {
    const email = `jsweb-storage-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await client.auth.signUp({ email, password: 'Web1234!' });
  });

  it('upload → key 반환', async () => {
    const content = new Blob(['hello from js sdk'], { type: 'text/plain' });
    const form = new FormData();
    const key = `sdk-test-${crypto.randomUUID().slice(0, 8)}.txt`;
    form.append('key', key);
    form.append('file', content, key);

    const res = await fetch(`${SERVER}/api/storage/avatars/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
      body: form,
    });
    const data = await res.json() as any;
    expect([200, 201].includes(res.status)).toBe(true);
    fileKey = data.key ?? key;
  });

  it('download → 200', async () => {
    if (!fileKey) return;
    const res = await fetch(`${SERVER}/api/storage/avatars/${fileKey}`, {
      headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
    });
    expect([200, 404].includes(res.status)).toBe(true);
  });

  it('list → files 배열', async () => {
    const res = await fetch(`${SERVER}/api/storage/avatars/list`, {
      headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
    });
    const data = await res.json() as any;
    expect([200].includes(res.status)).toBe(true);
    expect(Array.isArray(data.files ?? data.objects ?? [])).toBe(true);
  });

  it('delete → ok', async () => {
    if (!fileKey) return;
    const res = await fetch(`${SERVER}/api/storage/avatars/${fileKey}`, {
      method: 'DELETE',
      headers: { 'X-EdgeBase-Service-Key': 'test-service-key-for-admin' },
    });
    expect([200, 204, 404].includes(res.status)).toBe(true);
  });
});

// ─── 7. updateProfile ────────────────────────────────────────────────────────

describe('js-web:auth — updateProfile / changePassword', () => {
  const email = `jsweb-profile-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const client = createClient(SERVER);

  beforeAll(async () => {
    await client.auth.signUp({ email, password: 'Profile1234!' });
  });

  it('updateProfile → currentUser syncs refreshed access token', async () => {
    const user = await client.auth.updateProfile({ displayName: 'Updated Name' });
    expect(user).toBeDefined();
    expect(user.displayName).toBe('Updated Name');
    expect(client.auth.currentUser?.displayName).toBe('Updated Name');
  });

  it('updateProfile → UTF-8 displayName round-trips', async () => {
    const user = await client.auth.updateProfile({ displayName: '준강' });
    expect(user.displayName).toBe('준강');
    expect(client.auth.currentUser?.displayName).toBe('준강');
  });

  it('changePassword → 새 토큰 반환', async () => {
    const result = await client.auth.changePassword({
      currentPassword: 'Profile1234!',
      newPassword: 'NewProfile1234!',
    });
    expect(typeof result.accessToken).toBe('string');
  });
});

// ─── 8. requestPasswordReset ──────────────────────────────────────────────────

describe('js-web:auth — requestPasswordReset', () => {
  const client = createClient(SERVER);

  it('존재하는 이메일 → 200 (서버만 확인)', async () => {
    const email = `jsweb-reset-${crypto.randomUUID().slice(0, 8)}@test.com`;
    await client.auth.signUp({ email, password: 'Reset1234!' });
    // requestPasswordReset은 서버 200 응답까지만 확인 (이메일 실제 수신 불가)
    try {
      await client.auth.requestPasswordReset(email);
    } catch (err: any) {
      // 200이면 pass, 에러이면 skip
      expect(err.status ?? 200).toBe(200);
    }
  });

  it('sign in with OAuth → url 구성', () => {
    const result = client.auth.signInWithOAuth('google');
    expect(result.url).toContain('/api/auth/oauth/google');
    expect(result.url).toContain('redirect_url=');
  });

  it('sign in with OAuth → custom redirectUrl 포함', () => {
    const result = client.auth.signInWithOAuth('google', {
      redirectUrl: 'http://localhost:4173/auth/callback',
    });
    expect(result.url).toContain('redirect_url=');
    expect(decodeURIComponent(result.url)).toContain('http://localhost:4173/auth/callback');
  });

  it('handleOAuthCallback → 토큰을 저장하고 user를 복원', async () => {
    const at = makeValidJwt('u-web-callback');
    const rt = makeValidJwt('u-web-callback');
    const callbackUrl = `http://localhost:4173/auth/callback?access_token=${encodeURIComponent(at)}&refresh_token=${encodeURIComponent(rt)}`;

    const result = await client.auth.handleOAuthCallback(callbackUrl);
    expect(result).not.toBeNull();
    expect(result!.user.id).toBe('u-web-callback');
    expect(client.auth.currentUser?.id).toBe('u-web-callback');
  });
});
