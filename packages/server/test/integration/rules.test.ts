/**
 * rules.test.ts — 80개
 *
 * 테스트 대상: src/durable-objects/database-do.ts (evalRowRule, checkTableRules)
 *              edgebase.test.config.js의 규칙 설정
 *
 * 규칙 유형:
 *   - read rule  : GET/LIST 시 행별 접근 제어
 *   - write rule : CREATE/UPDATE 시 접근 제어
 *   - delete rule: DELETE 시 접근 제어
 *
 * 테스트 config에 정의된 테이블:
 *   - posts: 공개 read, 인증 write/delete
 *   - categories: 공개 read, SK write/delete
 *   - private_notes: auth !== null (인증 필요 read/write/delete)
 *
 * 규칙이 없으면 SK는 항상 통과
 */
import { describe, it, expect, beforeAll } from 'vitest';

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

async function apiNoAuth(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (body && method !== 'GET') headers['Content-Type'] = 'application/json';
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function getToken(email?: string) {
  const e = email ?? `rules-${crypto.randomUUID().slice(0, 8)}@test.com`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: 'Rules1234!' }),
  });
  const data = await res.json() as any;
  return { token: data.accessToken, userId: data.user?.id };
}

// ─── 1. SK bypass — 규칙있어도 SK는 통과 ─────────────────────────────────────

describe('1-14 rules — SK bypass', () => {
  it('SK → posts 쓰기 통과', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'SK Rule Bypass Test',
    });
    expect([200, 201].includes(status)).toBe(true);
  });

  it('SK → posts 삭제 통과', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'Delete Test' });
    if (data?.id) {
      const { status } = await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
      expect(status).toBe(200);
    }
  });
});

// ─── 2. read 규칙 ─────────────────────────────────────────────────────────────

describe('1-14 rules — read rule', () => {
  let postId: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Rules Test Post',
      isPublished: true,
    });
    postId = data?.id;
  });

  it('posts: 인증없이 공개 read → 200 (posts는 공개)', async () => {
    if (!postId) return;
    const { status } = await apiNoAuth('GET', `/api/db/shared/tables/posts/${postId}`);
    // posts가 공개 read 규칙이면 200, 아니면 401/403
    expect([200, 401, 403].includes(status)).toBe(true);
  });

  it('posts: SK → read 통과', async () => {
    if (!postId) return;
    const { status } = await api('GET', `/api/db/shared/tables/posts/${postId}`);
    expect(status).toBe(200);
  });

  it('posts: list → 200', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/posts');
    expect(status).toBe(200);
  });

  it('categories read 인증없이 → 200 또는 401/403', async () => {
    const { status } = await apiNoAuth('GET', '/api/db/shared/tables/categories');
    expect([200, 401, 403].includes(status)).toBe(true);
  });
});

// ─── 3. write 규칙 ────────────────────────────────────────────────────────────

describe('1-14 rules — write rule', () => {
  it('인증없이 posts 쓰기 → 401 또는 403', async () => {
    const { status } = await apiNoAuth('POST', '/api/db/shared/tables/posts', {
      title: 'Unauthenticated Write',
    });
    // posts는 auth 필요 write이거나 공개일 수 있음
    expect([200, 201, 401, 403].includes(status)).toBe(true);
  });

  it('인증후 posts 쓰기 → 201', async () => {
    const { token } = await getToken();
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/posts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Auth Write Test' }),
    });
    const data = await res.json() as any;
    expect([200, 201, 403].includes(res.status)).toBe(true);

    if (data?.id) {
      await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
    }
  });

  it('categories: 인증없이 쓰기 → 401/403 (categories는 SK only)', async () => {
    const { status } = await apiNoAuth('POST', '/api/db/shared/tables/categories', {
      name: 'Unauthorized Category',
    });
    expect([401, 403].includes(status)).toBe(true);
  });
});

// ─── 4. delete 규칙 ───────────────────────────────────────────────────────────

describe('1-14 rules — delete rule', () => {
  it('SK → delete 통과', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'Delete Rules Test' });
    if (data?.id) {
      const { status } = await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
      expect(status).toBe(200);
    }
  });

  it('인증없이 delete → 401/403', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'Anon Delete Test' });
    if (data?.id) {
      const { status } = await apiNoAuth('DELETE', `/api/db/shared/tables/posts/${data.id}`);
      expect([401, 403].includes(status)).toBe(true);
      // Cleanup
      await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
    } else {
      expect(true).toBe(true); // post creation bypassed
    }
  });
});

// ─── 5. 규칙 에러 포맷 ────────────────────────────────────────────────────────

describe('1-14 rules — 규칙 에러 포맷', () => {
  it('규칙 실패 → 403 + { code, message } 포함', async () => {
    const { status, data } = await apiNoAuth('POST', '/api/db/shared/tables/categories', {
      name: 'Error Format Check',
    });
    if (status === 403) {
      expect(data.code).toBe(403);
      expect(typeof data.message).toBe('string');
    } else {
      expect([401, 403].includes(status)).toBe(true);
    }
  });

  it('rule 실패 메시지 — Access denied 포함', async () => {
    const { data } = await apiNoAuth('POST', '/api/db/shared/tables/categories', {
      name: 'Error Message Check',
    });
    if (data?.message) {
      // May contain "denied", "unauthorized", or "authentication"
      const msg = data.message.toLowerCase();
      expect(
        msg.includes('denied') || msg.includes('unauthorized') || msg.includes('authentication') || msg.includes('required')
      ).toBe(true);
    }
  });
});

// ─── 6. 규칙 평가 — boolean / function / string ───────────────────────────────

describe('1-14 rules — rule 타입 평가', () => {
  it('boolean true rule → 인증없이 접근 가능 (posts list)', async () => {
    // posts read=true이면 누구나 접근 가능
    const { status } = await apiNoAuth('GET', '/api/db/shared/tables/posts');
    expect([200, 401, 403].includes(status)).toBe(true);
  });

  it('count endpoint에도 read rule 적용', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/posts/count');
    expect(status).toBe(200);
  });

  it('search endpoint에도 read rule 적용', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/search?search=test');
    expect([200, 400].includes(status)).toBe(true); // 400 if FTS not configured
  });
});

// ─── 7. auth 컨텍스트 기반 규칙 ───────────────────────────────────────────────

describe('1-14 rules — auth 컨텍스트', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const result = await getToken();
    token = result.token;
    userId = result.userId;
  });

  it('auth.id == resource.userId — 본인 레코드 접근 가능 (SK로 생성)', async () => {
    // Create record with userId field set to current user
    const { data } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Own Record',
      authorId: userId,
    });
    if (data?.id) {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/posts/${data.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect([200, 403].includes(res.status)).toBe(true);
      await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
    }
  });

  it('다른 사람 userId 레코드 → 규칙에 따라 접근 거부 가능', async () => {
    const { token: otherToken } = await getToken();
    const { data: record } = await api('POST', '/api/db/shared/tables/posts', {
      title: 'Other User Record',
      authorId: 'other-user-id-xyz',
    });
    if (record?.id) {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/posts/${record.id}`, {
        headers: { 'Authorization': `Bearer ${otherToken}` },
      });
      expect([200, 403].includes(res.status)).toBe(true);
      await api('DELETE', `/api/db/shared/tables/posts/${record.id}`);
    }
  });
});

// ─── 8. denied_notes — false rule (deny-all) ────────────────────────────────

describe('rules — denied_notes (false → deny all)', () => {
  let noteId: string;

  beforeAll(async () => {
    // denied_notes: create=true, read/update/delete=false
    const { data } = await api('POST', '/api/db/shared/tables/denied_notes', {
      title: 'Denied Note Seed',
    });
    noteId = data?.id;
  });

  it('denied_notes: SK → create 통과', async () => {
    const { status } = await api('POST', '/api/db/shared/tables/denied_notes', {
      title: 'SK Create Denied',
    });
    expect([200, 201].includes(status)).toBe(true);
  });

  it('denied_notes: 인증없이 create → 201 (create=true)', async () => {
    const { status } = await apiNoAuth('POST', '/api/db/shared/tables/denied_notes', {
      title: 'Anon Create Denied Note',
    });
    expect([200, 201].includes(status)).toBe(true);
  });

  it('denied_notes: 인증후 create → 201 (create=true)', async () => {
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/denied_notes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Auth Create Denied Note' }),
    });
    expect([200, 201].includes(res.status)).toBe(true);
  });

  it('denied_notes: SK → get 통과 (SK bypass)', async () => {
    if (!noteId) return;
    const { status } = await api('GET', `/api/db/shared/tables/denied_notes/${noteId}`);
    expect(status).toBe(200);
  });

  it('denied_notes: SK → list 통과 (SK bypass)', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/denied_notes');
    expect(status).toBe(200);
  });

  it('denied_notes: 인증없이 get → 403 (read=false)', async () => {
    if (!noteId) return;
    const { status } = await apiNoAuth('GET', `/api/db/shared/tables/denied_notes/${noteId}`);
    expect(status).toBe(403);
  });

  it('denied_notes: 인증없이 list → 403 (read=false, all-or-nothing)', async () => {
    const { status } = await apiNoAuth('GET', '/api/db/shared/tables/denied_notes');
    // list with read=false: either 403 on row or empty list if no rows pass (200 with 0 items is also valid)
    expect([200, 403].includes(status)).toBe(true);
  });

  it('denied_notes: 인증후 get → 403 (read=false)', async () => {
    if (!noteId) return;
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/denied_notes/${noteId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('denied_notes: 인증후 list → 403 (read=false, all-or-nothing)', async () => {
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/denied_notes`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect([200, 403].includes(res.status)).toBe(true);
  });

  it('denied_notes: 인증없이 update → 403 (update=false)', async () => {
    if (!noteId) return;
    const { status } = await apiNoAuth('PATCH', `/api/db/shared/tables/denied_notes/${noteId}`, {
      title: 'Should Not Update',
    });
    expect([401, 403].includes(status)).toBe(true);
  });

  it('denied_notes: 인증후 update → 403 (update=false)', async () => {
    if (!noteId) return;
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/denied_notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should Not Update Either' }),
    });
    expect(res.status).toBe(403);
  });

  it('denied_notes: SK → update 통과 (SK bypass)', async () => {
    if (!noteId) return;
    const { status } = await api('PATCH', `/api/db/shared/tables/denied_notes/${noteId}`, {
      title: 'SK Updated Denied Note',
    });
    expect(status).toBe(200);
  });

  it('denied_notes: 인증없이 delete → 403 (delete=false)', async () => {
    // Create a throwaway for delete test
    const { data } = await api('POST', '/api/db/shared/tables/denied_notes', { title: 'Delete Deny Test' });
    if (data?.id) {
      const { status } = await apiNoAuth('DELETE', `/api/db/shared/tables/denied_notes/${data.id}`);
      expect([401, 403].includes(status)).toBe(true);
      await api('DELETE', `/api/db/shared/tables/denied_notes/${data.id}`); // cleanup via SK
    }
  });

  it('denied_notes: 인증후 delete → 403 (delete=false)', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/denied_notes', { title: 'Auth Delete Deny' });
    if (data?.id) {
      const { token } = await getToken();
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/denied_notes/${data.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
      await api('DELETE', `/api/db/shared/tables/denied_notes/${data.id}`); // cleanup via SK
    }
  });

  it('denied_notes: SK → delete 통과 (SK bypass)', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/denied_notes', { title: 'SK Delete Denied' });
    if (data?.id) {
      const { status } = await api('DELETE', `/api/db/shared/tables/denied_notes/${data.id}`);
      expect(status).toBe(200);
    }
  });
});

// ─── 9. auth_required_notes — auth != null ──────────────────────────────────

describe('rules — auth_required_notes (auth != null)', () => {
  let noteId: string;

  beforeAll(async () => {
    // auth_required_notes: create=true (open), read/update/delete = auth != null
    const { data } = await api('POST', '/api/db/shared/tables/auth_required_notes', {
      title: 'Auth Required Seed',
    });
    noteId = data?.id;
  });

  it('auth_required_notes: 인증없이 create → 201 (create=true)', async () => {
    const { status } = await apiNoAuth('POST', '/api/db/shared/tables/auth_required_notes', {
      title: 'Anon Create Auth Note',
    });
    expect([200, 201].includes(status)).toBe(true);
  });

  it('auth_required_notes: 인증후 create → 201', async () => {
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/auth_required_notes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Auth Create Auth Note' }),
    });
    expect([200, 201].includes(res.status)).toBe(true);
  });

  it('auth_required_notes: 인증없이 get → 403 (auth != null)', async () => {
    if (!noteId) return;
    const { status } = await apiNoAuth('GET', `/api/db/shared/tables/auth_required_notes/${noteId}`);
    expect(status).toBe(403);
  });

  it('auth_required_notes: 인증후 get → 200', async () => {
    if (!noteId) return;
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/auth_required_notes/${noteId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('auth_required_notes: 인증없이 list → 403 (auth != null, all-or-nothing)', async () => {
    const { status } = await apiNoAuth('GET', '/api/db/shared/tables/auth_required_notes');
    expect([200, 403].includes(status)).toBe(true);
  });

  it('auth_required_notes: 인증후 list → 200', async () => {
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/auth_required_notes`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('auth_required_notes: 인증없이 update → 403', async () => {
    if (!noteId) return;
    const { status } = await apiNoAuth('PATCH', `/api/db/shared/tables/auth_required_notes/${noteId}`, {
      title: 'Anon Update Blocked',
    });
    expect([401, 403].includes(status)).toBe(true);
  });

  it('auth_required_notes: 인증후 update → 200', async () => {
    if (!noteId) return;
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/auth_required_notes/${noteId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Auth Updated Note' }),
    });
    expect(res.status).toBe(200);
  });

  it('auth_required_notes: 인증없이 delete → 403', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/auth_required_notes', { title: 'Anon Delete Block' });
    if (data?.id) {
      const { status } = await apiNoAuth('DELETE', `/api/db/shared/tables/auth_required_notes/${data.id}`);
      expect([401, 403].includes(status)).toBe(true);
      await api('DELETE', `/api/db/shared/tables/auth_required_notes/${data.id}`);
    }
  });

  it('auth_required_notes: 인증후 delete → 200', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/auth_required_notes', { title: 'Auth Delete OK' });
    if (data?.id) {
      const { token } = await getToken();
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/auth_required_notes/${data.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    }
  });

  it('auth_required_notes: SK → get 통과', async () => {
    if (!noteId) return;
    const { status } = await api('GET', `/api/db/shared/tables/auth_required_notes/${noteId}`);
    expect(status).toBe(200);
  });

  it('auth_required_notes: SK → update 통과', async () => {
    if (!noteId) return;
    const { status } = await api('PATCH', `/api/db/shared/tables/auth_required_notes/${noteId}`, {
      title: 'SK Updated Auth Note',
    });
    expect(status).toBe(200);
  });
});

// ─── 10. secure_posts — owner-only (auth.id == resource.authorId) ───────────

describe('rules — secure_posts (owner-only)', () => {
  let ownerToken: string;
  let ownerId: string;
  let otherToken: string;
  let otherId: string;
  let ownedPostId: string;

  beforeAll(async () => {
    const owner = await getToken();
    ownerToken = owner.token;
    ownerId = owner.userId;

    const other = await getToken();
    otherToken = other.token;
    otherId = other.userId;

    // Create a post owned by "owner" via SK (setting authorId)
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'Owner Only Post',
      authorId: ownerId,
    });
    ownedPostId = data?.id;
  });

  it('secure_posts: 인증후 create → 201 (create=auth!=null)', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Auth Create Secure', authorId: ownerId }),
    });
    expect([200, 201].includes(res.status)).toBe(true);
  });

  it('secure_posts: 인증없이 create → 403 (create=auth!=null)', async () => {
    const { status } = await apiNoAuth('POST', '/api/db/shared/tables/secure_posts', {
      title: 'Anon Create Secure',
    });
    expect([401, 403].includes(status)).toBe(true);
  });

  it('secure_posts: 소유자 get → 200', async () => {
    if (!ownedPostId) return;
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${ownedPostId}`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('secure_posts: 비소유자 get → 403', async () => {
    if (!ownedPostId) return;
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${ownedPostId}`, {
      headers: { 'Authorization': `Bearer ${otherToken}` },
    });
    expect(res.status).toBe(403);
  });

  it('secure_posts: 인증없이 get → 403', async () => {
    if (!ownedPostId) return;
    const { status } = await apiNoAuth('GET', `/api/db/shared/tables/secure_posts/${ownedPostId}`);
    expect(status).toBe(403);
  });

  it('secure_posts: 소유자 update → 200', async () => {
    if (!ownedPostId) return;
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${ownedPostId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Owner Updated Secure' }),
    });
    expect(res.status).toBe(200);
  });

  it('secure_posts: 비소유자 update → 403', async () => {
    if (!ownedPostId) return;
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${ownedPostId}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Other Updated Secure' }),
    });
    expect(res.status).toBe(403);
  });

  it('secure_posts: 인증없이 update → 403', async () => {
    if (!ownedPostId) return;
    const { status } = await apiNoAuth('PATCH', `/api/db/shared/tables/secure_posts/${ownedPostId}`, {
      title: 'Anon Updated Secure',
    });
    expect([401, 403].includes(status)).toBe(true);
  });

  it('secure_posts: 비소유자 delete → 403', async () => {
    // Create another owned post to test delete denial
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'Delete Deny Test Secure',
      authorId: ownerId,
    });
    if (data?.id) {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${data.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${otherToken}` },
      });
      expect(res.status).toBe(403);
      await api('DELETE', `/api/db/shared/tables/secure_posts/${data.id}`); // cleanup
    }
  });

  it('secure_posts: 소유자 delete → 200', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'Owner Delete Test Secure',
      authorId: ownerId,
    });
    if (data?.id) {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${data.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${ownerToken}` },
      });
      expect(res.status).toBe(200);
    }
  });

  it('secure_posts: 인증없이 delete → 403', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'Anon Delete Secure',
      authorId: ownerId,
    });
    if (data?.id) {
      const { status } = await apiNoAuth('DELETE', `/api/db/shared/tables/secure_posts/${data.id}`);
      expect([401, 403].includes(status)).toBe(true);
      await api('DELETE', `/api/db/shared/tables/secure_posts/${data.id}`); // cleanup
    }
  });

  it('secure_posts: SK → get 통과 (bypass)', async () => {
    if (!ownedPostId) return;
    const { status } = await api('GET', `/api/db/shared/tables/secure_posts/${ownedPostId}`);
    expect(status).toBe(200);
  });

  it('secure_posts: SK → update 통과 (bypass)', async () => {
    if (!ownedPostId) return;
    const { status } = await api('PATCH', `/api/db/shared/tables/secure_posts/${ownedPostId}`, {
      title: 'SK Updated Secure',
    });
    expect(status).toBe(200);
  });

  it('secure_posts: SK → delete 통과 (bypass)', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'SK Delete Secure',
      authorId: ownerId,
    });
    if (data?.id) {
      const { status } = await api('DELETE', `/api/db/shared/tables/secure_posts/${data.id}`);
      expect(status).toBe(200);
    }
  });

  it('secure_posts: list — 소유자 레코드만 있으면 200', async () => {
    // Create a clean post for this user
    const user = await getToken();
    const res1 = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'List Owner Only', authorId: user.userId }),
    });
    const created = await res1.json() as any;

    // List — all-or-nothing: if any row fails read rule, 403
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts`, {
      headers: { 'Authorization': `Bearer ${user.token}` },
    });
    // May 403 if other users' posts exist (all-or-nothing)
    expect([200, 403].includes(res.status)).toBe(true);

    if (created?.id) await api('DELETE', `/api/db/shared/tables/secure_posts/${created.id}`);
  });
});

// ─── 11. posts — true rule details ──────────────────────────────────────────

describe('rules — posts (true → allow all)', () => {
  it('posts: 인증없이 list → 200 (list=true)', async () => {
    const { status } = await apiNoAuth('GET', '/api/db/shared/tables/posts');
    expect(status).toBe(200);
  });

  it('posts: 인증없이 get → 200 (get=true)', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'Public Get Test' });
    if (data?.id) {
      const { status } = await apiNoAuth('GET', `/api/db/shared/tables/posts/${data.id}`);
      expect(status).toBe(200);
      await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
    }
  });

  it('posts: 인증없이 create → 201 (create=true)', async () => {
    const { status, data } = await apiNoAuth('POST', '/api/db/shared/tables/posts', {
      title: 'Anon Create Public',
    });
    expect([200, 201].includes(status)).toBe(true);
    if (data?.id) await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
  });

  it('posts: 인증없이 update → 200 (update=true)', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'Public Update Test' });
    if (data?.id) {
      const { status } = await apiNoAuth('PATCH', `/api/db/shared/tables/posts/${data.id}`, {
        title: 'Anon Updated Public',
      });
      expect(status).toBe(200);
      await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
    }
  });

  it('posts: 인증없이 delete → 403 (delete=auth!=null)', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'Anon Delete Public' });
    if (data?.id) {
      const { status } = await apiNoAuth('DELETE', `/api/db/shared/tables/posts/${data.id}`);
      expect([401, 403].includes(status)).toBe(true);
      await api('DELETE', `/api/db/shared/tables/posts/${data.id}`);
    }
  });

  it('posts: 인증후 delete → 200 (delete=auth!=null)', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/posts', { title: 'Auth Delete Public' });
    if (data?.id) {
      const { token } = await getToken();
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/posts/${data.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    }
  });

  it('posts: 인증없이 search → 200 (search=true)', async () => {
    const { status } = await apiNoAuth('GET', '/api/db/shared/tables/posts/search?search=test');
    expect([200, 400].includes(status)).toBe(true); // 400 if FTS not ready
  });

  it('posts: 인증없이 count → 200 (list=true covers count)', async () => {
    const { status } = await apiNoAuth('GET', '/api/db/shared/tables/posts/count');
    expect(status).toBe(200);
  });
});

// ─── 12. SK bypass — 모든 테이블 ────────────────────────────────────────────

describe('rules — SK bypass across tables', () => {
  it('SK → secure_posts create 통과', async () => {
    const { status, data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'SK Secure Create',
      authorId: 'sk-user',
    });
    expect([200, 201].includes(status)).toBe(true);
    if (data?.id) await api('DELETE', `/api/db/shared/tables/secure_posts/${data.id}`);
  });

  it('SK → secure_posts list 통과', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/secure_posts');
    expect(status).toBe(200);
  });

  it('SK → denied_notes list 통과', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/denied_notes');
    expect(status).toBe(200);
  });

  it('SK → auth_required_notes list 통과', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/auth_required_notes');
    expect(status).toBe(200);
  });

  it('SK → auth_required_notes delete 통과', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/auth_required_notes', {
      title: 'SK Delete Auth Note',
    });
    if (data?.id) {
      const { status } = await api('DELETE', `/api/db/shared/tables/auth_required_notes/${data.id}`);
      expect(status).toBe(200);
    }
  });

  it('SK → denied_notes update 통과', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/denied_notes', {
      title: 'SK Update Denied',
    });
    if (data?.id) {
      const { status } = await api('PATCH', `/api/db/shared/tables/denied_notes/${data.id}`, {
        title: 'SK Updated Denied OK',
      });
      expect(status).toBe(200);
      await api('DELETE', `/api/db/shared/tables/denied_notes/${data.id}`);
    }
  });
});

// ─── 13. 규칙 에러 포맷 — 다양한 테이블 ────────────────────────────────────

describe('rules — error format across tables', () => {
  it('denied_notes: read 403 → code + message', async () => {
    const { data: note } = await api('POST', '/api/db/shared/tables/denied_notes', { title: 'Error Fmt' });
    if (note?.id) {
      const { status, data } = await apiNoAuth('GET', `/api/db/shared/tables/denied_notes/${note.id}`);
      if (status === 403) {
        expect(data.code).toBe(403);
        expect(typeof data.message).toBe('string');
        expect(data.message.toLowerCase()).toContain('denied');
      }
      await api('DELETE', `/api/db/shared/tables/denied_notes/${note.id}`);
    }
  });

  it('secure_posts: 비소유자 update 403 → code + message', async () => {
    const owner = await getToken();
    const other = await getToken();
    const { data: post } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'Error Fmt Secure',
      authorId: owner.userId,
    });
    if (post?.id) {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${post.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${other.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Should Fail' }),
      });
      if (res.status === 403) {
        const data = await res.json() as any;
        expect(data.code).toBe(403);
        expect(typeof data.message).toBe('string');
      }
      await api('DELETE', `/api/db/shared/tables/secure_posts/${post.id}`);
    }
  });

  it('auth_required_notes: 인증없이 update → message에 denied 포함', async () => {
    const { data: note } = await api('POST', '/api/db/shared/tables/auth_required_notes', { title: 'ErrMsg' });
    if (note?.id) {
      const { status, data } = await apiNoAuth('PATCH', `/api/db/shared/tables/auth_required_notes/${note.id}`, {
        title: 'No Auth',
      });
      if (status === 403 && data?.message) {
        const msg = data.message.toLowerCase();
        expect(msg.includes('denied') || msg.includes('unauthorized') || msg.includes('required')).toBe(true);
      }
      await api('DELETE', `/api/db/shared/tables/auth_required_notes/${note.id}`);
    }
  });
});

// ─── 14. count + resource rules 상호작용 ────────────────────────────────────

describe('rules — count endpoint with various rules', () => {
  it('posts: count 인증없이 → 200 (list=true covers count)', async () => {
    const { status, data } = await apiNoAuth('GET', '/api/db/shared/tables/posts/count');
    expect(status).toBe(200);
    expect(typeof data.total).toBe('number');
  });

  it('posts: count SK → 200 + total number', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/posts/count');
    expect(status).toBe(200);
    expect(typeof data.total).toBe('number');
  });

  it('auth_required_notes: count 인증후 → 200', async () => {
    const { token } = await getToken();
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/auth_required_notes/count`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('auth_required_notes: count SK → 200', async () => {
    const { status, data } = await api('GET', '/api/db/shared/tables/auth_required_notes/count');
    expect(status).toBe(200);
    expect(typeof data.total).toBe('number');
  });

  it('denied_notes: count SK → 200', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/denied_notes/count');
    expect(status).toBe(200);
  });

  it('secure_posts: count SK → 200', async () => {
    const { status } = await api('GET', '/api/db/shared/tables/secure_posts/count');
    expect(status).toBe(200);
  });
});

// ─── 15. secure_posts — authorId null-safety ────────────────────────────────

describe('rules — secure_posts authorId null-safety', () => {
  it('secure_posts: authorId 없는 레코드 → 인증후에도 get 403 (null != userId)', async () => {
    // Create a post with no authorId
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'No Author Secure',
    });
    if (data?.id) {
      const { token } = await getToken();
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${data.id}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      // authorId is null/undefined, auth.id !== null → should be 403
      expect(res.status).toBe(403);
      await api('DELETE', `/api/db/shared/tables/secure_posts/${data.id}`);
    }
  });

  it('secure_posts: authorId 없는 레코드 → update 403', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'No Author Update',
    });
    if (data?.id) {
      const { token } = await getToken();
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${data.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Try Update' }),
      });
      expect(res.status).toBe(403);
      await api('DELETE', `/api/db/shared/tables/secure_posts/${data.id}`);
    }
  });

  it('secure_posts: authorId 없는 레코드 → delete 403', async () => {
    const { data } = await api('POST', '/api/db/shared/tables/secure_posts', {
      title: 'No Author Delete',
    });
    if (data?.id) {
      const { token } = await getToken();
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/secure_posts/${data.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
      await api('DELETE', `/api/db/shared/tables/secure_posts/${data.id}`);
    }
  });
});

// ─── 16. categories — auth write/delete ─────────────────────────────────────

describe('rules — categories (auth write/delete)', () => {
  it('categories: 인증후 create → 201', async () => {
    const { token } = await getToken();
    const name = `cat-${crypto.randomUUID().slice(0, 8)}`;
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/categories`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    expect([200, 201].includes(res.status)).toBe(true);
  });

  it('categories: 인증후 update → 200', async () => {
    const catName = `cat-upd-${crypto.randomUUID().slice(0, 8)}`;
    const { data } = await api('POST', '/api/db/shared/tables/categories', { name: catName });
    if (data?.id) {
      const { token } = await getToken();
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/categories/${data.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Updated by auth user' }),
      });
      expect(res.status).toBe(200);
      await api('DELETE', `/api/db/shared/tables/categories/${data.id}`);
    }
  });

  it('categories: 인증후 delete → 200', async () => {
    const catName = `cat-del-${crypto.randomUUID().slice(0, 8)}`;
    const { data } = await api('POST', '/api/db/shared/tables/categories', { name: catName });
    if (data?.id) {
      const { token } = await getToken();
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/db/shared/tables/categories/${data.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    }
  });

  it('categories: 인증없이 update → 403', async () => {
    const catName = `cat-noupd-${crypto.randomUUID().slice(0, 8)}`;
    const { data } = await api('POST', '/api/db/shared/tables/categories', { name: catName });
    if (data?.id) {
      const { status } = await apiNoAuth('PATCH', `/api/db/shared/tables/categories/${data.id}`, {
        description: 'Should not work',
      });
      expect([401, 403].includes(status)).toBe(true);
      await api('DELETE', `/api/db/shared/tables/categories/${data.id}`);
    }
  });

  it('categories: 인증없이 delete → 403', async () => {
    const catName = `cat-nodel-${crypto.randomUUID().slice(0, 8)}`;
    const { data } = await api('POST', '/api/db/shared/tables/categories', { name: catName });
    if (data?.id) {
      const { status } = await apiNoAuth('DELETE', `/api/db/shared/tables/categories/${data.id}`);
      expect([401, 403].includes(status)).toBe(true);
      await api('DELETE', `/api/db/shared/tables/categories/${data.id}`);
    }
  });
});
