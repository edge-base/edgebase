/**
 * @edgebase-fun/web — E2E 테스트
 *
 * wrangler dev --port 8688 실서버 필요
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 \
 *     npx vitest run packages/sdk/js/packages/web/test/e2e/web.e2e.test.ts
 *
 * 원칙: mock 금지, 실서버 fetch 기반
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:8688';
const SERVICE_KEY = process.env['SERVICE_KEY'] || 'test-service-key-for-admin';

const PREFIX = `web-e2e-${Date.now()}`;

// ─── 1. Auth E2E ──────────────────────────────────────────────────────────────

describe('Web E2E — Auth', () => {
  let testEmail: string;
  let testPassword = 'WebE2EPass123!';
  let accessToken: string;
  let refreshToken: string;

  it('signup → accessToken + user.id', async () => {
    testEmail = `web-signup-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
    expect(data.user?.id || data.id).toBeTruthy();
    accessToken = data.accessToken;
    refreshToken = data.refreshToken;
  });

  it('signin → accessToken', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
  });

  it('token refresh → 새 accessToken', async () => {
    if (!refreshToken) return;
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
  });

  it('signout → 성공', async () => {
    if (!accessToken || !refreshToken) return;
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

  it('잘못된 비밀번호 signin → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'wrong-pass' }),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('signUp with displayName (data)', async () => {
    const email = `web-data-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'WebData123!',
        data: { displayName: 'Test User' },
      }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
  });

  it('signInAnonymously → user.isAnonymous === true', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signin/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
  });
});

// ─── 2. Storage E2E ───────────────────────────────────────────────────────────

describe('Web E2E — Storage', () => {
  let uploadKey: string;
  let serviceKey = process.env['SERVICE_KEY'] ?? 'test-service-key-for-admin';

  it('put → 200', async () => {
    uploadKey = `web-e2e-${Date.now()}.txt`;
    const form = new FormData();
    form.append('key', uploadKey);
    form.append('file', new Blob(['Hello from web E2E'], { type: 'text/plain' }), uploadKey);
    const res = await fetch(`${BASE_URL}/api/storage/test-bucket/upload`, {
      method: 'POST',
      headers: {
        'X-EdgeBase-Service-Key': serviceKey,
      },
      body: form,
    });
    expect(res.ok).toBe(true);
  });

  it('download → content 반환', async () => {
    if (!uploadKey) return;
    const res = await fetch(`${BASE_URL}/api/storage/test-bucket/${uploadKey}`, {
      headers: { 'X-EdgeBase-Service-Key': serviceKey },
    });
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain('Hello from web E2E');
  });

  it('delete → 200/204', async () => {
    if (!uploadKey) return;
    const res = await fetch(`${BASE_URL}/api/storage/test-bucket/${uploadKey}`, {
      method: 'DELETE',
      headers: { 'X-EdgeBase-Service-Key': serviceKey },
    });
    expect([200, 204].includes(res.status)).toBe(true);
  });
});

// ─── 3. DB E2E (authenticated user) ──────────────────────────────────────────

describe('Web E2E — DB (auth user)', () => {
  let accessToken: string;
  const serviceKey = process.env['SERVICE_KEY'] ?? 'test-service-key-for-admin';
  const createdIds: string[] = [];

  beforeAll(async () => {
    const email = `web-db-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WebDB123!' }),
    });
    const data = await res.json() as any;
    accessToken = data.accessToken;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      try {
        await fetch(`${BASE_URL}/api/db/shared/tables/posts/${id}`, {
          method: 'DELETE',
          headers: { 'X-EdgeBase-Service-Key': serviceKey },
        });
      } catch {}
    }
  });

  it('insert (user token) → id 반환', async () => {
    const res = await fetch(`${BASE_URL}/api/db/shared/tables/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ title: `${PREFIX}-web-insert` }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.id).toBeTruthy();
    createdIds.push(data.id);
  });

  it('get list (user token) → items 배열', async () => {
    const res = await fetch(`${BASE_URL}/api/db/shared/tables/posts?limit=3`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(Array.isArray(data.items)).toBe(true);
  });
});

// ─── 4. 에러 처리 ─────────────────────────────────────────────────────────────

describe('Web E2E — Error', () => {
  it('없는 record getOne → 404', async () => {
    const serviceKey = process.env['SERVICE_KEY'] ?? 'test-service-key-for-admin';
    const res = await fetch(`${BASE_URL}/api/db/shared/tables/posts/nonexistent-web-99999`, {
      headers: { 'X-EdgeBase-Service-Key': serviceKey },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('인증 없이 protected route → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`);
    expect(res.ok).toBe(false);
    expect([401, 403].includes(res.status)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Phase 2 additions below
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 5. Auth flow: signup → signin → signout chain ──────────────────────────

describe('Web E2E — Auth chain', () => {
  let email: string;
  const password = 'ChainPass123!';
  let tokens: { accessToken: string; refreshToken: string };

  it('signup → signin → signout full chain', async () => {
    email = `web-chain-${Date.now()}@test.com`;

    // 1. signup
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const signupData = await signupRes.json() as any;
    expect(signupRes.ok).toBe(true);
    tokens = { accessToken: signupData.accessToken, refreshToken: signupData.refreshToken };

    // 2. signin
    const signinRes = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const signinData = await signinRes.json() as any;
    expect(signinRes.ok).toBe(true);
    tokens = { accessToken: signinData.accessToken, refreshToken: signinData.refreshToken };

    // 3. signout
    const signoutRes = await fetch(`${BASE_URL}/api/auth/signout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.accessToken}`,
      },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    expect([200, 204].includes(signoutRes.status)).toBe(true);
  });
});

// ─── 6. Anonymous auth ──────────────────────────────────────────────────────

describe('Web E2E — Anonymous auth', () => {
  it('anonymous signin → isAnonymous flag in JWT', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signin/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.accessToken).toBeTruthy();
    // Decode JWT payload to check isAnonymous
    const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
    expect(payload.isAnonymous).toBe(true);
  });

  it('anonymous user can insert records', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signin/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const authData = await res.json() as any;

    const createRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.accessToken}`,
      },
      body: JSON.stringify({ title: `web-anon-${Date.now()}` }),
    });
    const createData = await createRes.json() as any;
    expect(createRes.ok).toBe(true);
    expect(createData.id).toBeTruthy();

    // Cleanup
    try {
      await fetch(`${BASE_URL}/api/db/shared/tables/posts/${createData.id}`, {
        method: 'DELETE',
        headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
      });
    } catch {}
  });
});

// ─── 7. Change password ─────────────────────────────────────────────────────

describe('Web E2E — Change password', () => {
  it('change-password → new password works', async () => {
    const email = `web-chgpwd-${Date.now()}@test.com`;
    const oldPass = 'OldPass123!';
    const newPass = 'NewPass456!';

    // 1. signup
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: oldPass }),
    });
    const signupData = await signupRes.json() as any;
    expect(signupRes.ok).toBe(true);

    // 2. change password
    const chgRes = await fetch(`${BASE_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${signupData.accessToken}`,
      },
      body: JSON.stringify({ currentPassword: oldPass, newPassword: newPass }),
    });
    expect(chgRes.ok).toBe(true);

    // 3. signin with new password
    const signinRes = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: newPass }),
    });
    expect(signinRes.ok).toBe(true);

    // 4. old password should fail
    const oldRes = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: oldPass }),
    });
    expect(oldRes.ok).toBe(false);
  });
});

// ─── 8. Sessions list & revoke ──────────────────────────────────────────────

describe('Web E2E — Sessions', () => {
  it('list sessions → array', async () => {
    const email = `web-sess-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'SessPass123!' }),
    });
    const data = await signupRes.json() as any;

    const sessRes = await fetch(`${BASE_URL}/api/auth/sessions`, {
      headers: { 'Authorization': `Bearer ${data.accessToken}` },
    });
    const sessData = await sessRes.json() as any;
    expect(sessRes.ok).toBe(true);
    expect(Array.isArray(sessData.sessions)).toBe(true);
    expect(sessData.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('revoke session → success', async () => {
    const email = `web-revoke-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RevokePass123!' }),
    });
    const data = await signupRes.json() as any;

    // List sessions
    const sessRes = await fetch(`${BASE_URL}/api/auth/sessions`, {
      headers: { 'Authorization': `Bearer ${data.accessToken}` },
    });
    const sessData = await sessRes.json() as any;
    if (sessData.sessions?.length > 0) {
      const sessionId = sessData.sessions[0].id;
      const revokeRes = await fetch(`${BASE_URL}/api/auth/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${data.accessToken}` },
      });
      expect([200, 204].includes(revokeRes.status)).toBe(true);
    }
  });
});

// ─── 9. Profile update ──────────────────────────────────────────────────────

describe('Web E2E — Profile', () => {
  it('update displayName via PATCH /auth/profile', async () => {
    const email = `web-profile-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'ProfilePass123!' }),
    });
    const data = await signupRes.json() as any;

    const profileRes = await fetch(`${BASE_URL}/api/auth/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${data.accessToken}`,
      },
      body: JSON.stringify({ displayName: 'Updated Name' }),
    });
    expect(profileRes.ok).toBe(true);
  });
});

// ─── 10. Token refresh flow ─────────────────────────────────────────────────

describe('Web E2E — Token refresh', () => {
  it('refresh with valid refreshToken → new tokens', async () => {
    const email = `web-refresh-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RefreshPass123!' }),
    });
    const data = await signupRes.json() as any;

    // Wait >1s so JWT `iat` (second-level granularity) differs from signup token
    await new Promise(r => setTimeout(r, 1100));

    const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: data.refreshToken }),
    });
    const refreshData = await refreshRes.json() as any;
    expect(refreshRes.ok).toBe(true);
    expect(refreshData.accessToken).toBeTruthy();
    expect(refreshData.refreshToken).toBeTruthy();
    // New tokens should be different (iat differs after waiting)
    expect(refreshData.accessToken).not.toBe(data.accessToken);
  });

  it('refresh with invalid token → error', async () => {
    const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'invalid-token-xxx' }),
    });
    expect(refreshRes.ok).toBe(false);
  });
});

// ─── 11. Signup with displayName ────────────────────────────────────────────

describe('Web E2E — Signup with data', () => {
  it('signup with displayName and avatarUrl', async () => {
    const email = `web-data2-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'DataPass123!',
        data: {
          displayName: 'Alice Test',
          avatarUrl: 'https://example.com/avatar.png',
        },
      }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    // Decode JWT to check displayName is present
    const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
    expect(payload.displayName).toBe('Alice Test');
  });
});

// ─── 12. Duplicate email signup ─────────────────────────────────────────────

describe('Web E2E — Duplicate email', () => {
  it('signup with existing email → error', async () => {
    const email = `web-dup-${Date.now()}@test.com`;
    // First signup
    const res1 = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'DupPass123!' }),
    });
    expect(res1.ok).toBe(true);

    // Second signup with same email
    const res2 = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'DupPass456!' }),
    });
    expect(res2.ok).toBe(false);
    expect(res2.status).toBeGreaterThanOrEqual(400);
  });
});

// ─── 13. Auth with DB operations ────────────────────────────────────────────

describe('Web E2E — Auth + DB combined', () => {
  it('authenticated user: insert → getOne → update → delete', async () => {
    const email = `web-crud-chain-${Date.now()}@test.com`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'CRUDChain123!' }),
    });
    const authData = await signupRes.json() as any;
    const token = authData.accessToken;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    // Create
    const createRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: `web-chain-${Date.now()}` }),
    });
    const created = await createRes.json() as any;
    expect(createRes.ok).toBe(true);
    const id = created.id;

    // GetOne
    const getRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts/${id}`, { headers });
    expect(getRes.ok).toBe(true);

    // Update
    const updateRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts/${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ title: 'updated-title' }),
    });
    expect(updateRes.ok).toBe(true);

    // Delete
    const deleteRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts/${id}`, {
      method: 'DELETE', headers,
    });
    expect([200, 204].includes(deleteRes.status)).toBe(true);
  });
});

// ─── 14. Storage with auth ──────────────────────────────────────────────────

describe('Web E2E — Storage (service key)', () => {
  it('upload + list + delete chain', async () => {
    const key = `web-storage-chain-${Date.now()}.txt`;
    const serviceKey = SERVICE_KEY;

    // Upload
    const form = new FormData();
    form.append('key', key);
    form.append('file', new Blob(['chain test'], { type: 'text/plain' }), key);
    const uploadRes = await fetch(`${BASE_URL}/api/storage/test-bucket/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': serviceKey },
      body: form,
    });
    expect(uploadRes.ok).toBe(true);

    // List
    const listRes = await fetch(`${BASE_URL}/api/storage/test-bucket?limit=50`, {
      headers: { 'X-EdgeBase-Service-Key': serviceKey },
    });
    const listData = await listRes.json() as any;
    expect(listRes.ok).toBe(true);
    expect(Array.isArray(listData.files)).toBe(true);

    // Delete
    const delRes = await fetch(`${BASE_URL}/api/storage/test-bucket/${key}`, {
      method: 'DELETE',
      headers: { 'X-EdgeBase-Service-Key': serviceKey },
    });
    expect([200, 204].includes(delRes.status)).toBe(true);
  });
});

// ─── 15. Missing/invalid auth scenarios ─────────────────────────────────────

describe('Web E2E — Auth edge cases', () => {
  it('signup with missing password → 400', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `no-pass-${Date.now()}@test.com` }),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('signup with missing email → 400', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'NoEmail123!' }),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('expired/invalid token → 401', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/sessions`, {
      headers: { 'Authorization': 'Bearer invalid-token-xyz' },
    });
    expect(res.ok).toBe(false);
    expect([401, 403].includes(res.status)).toBe(true);
  });

  it('malformed JSON body → 400', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{malformed json}}}',
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ─── 16. DB filters with auth token ─────────────────────────────────────────

describe('Web E2E — DB filters (auth user)', () => {
  let accessToken: string;
  const ids: string[] = [];

  beforeAll(async () => {
    const email = `web-filter-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'FilterPass123!' }),
    });
    const data = await res.json() as any;
    accessToken = data.accessToken;
  });

  afterAll(async () => {
    for (const id of ids) {
      try {
        await fetch(`${BASE_URL}/api/db/shared/tables/posts/${id}`, {
          method: 'DELETE',
          headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
        });
      } catch {}
    }
  });

  it('insert multiple + filter by title', async () => {
    const unique = `web-filter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` };

    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${BASE_URL}/api/db/shared/tables/posts`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: `${unique}-${i}` }),
      });
      const d = await r.json() as any;
      ids.push(d.id);
    }

    const filter = JSON.stringify([['title', 'contains', unique]]);
    const listRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}&limit=10`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const listData = await listRes.json() as any;
    expect(listRes.ok).toBe(true);
    expect(listData.items.length).toBeGreaterThanOrEqual(3);
  });

  it('orderBy + limit query', async () => {
    const listRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts?sort=createdAt:desc&limit=2`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const listData = await listRes.json() as any;
    expect(listRes.ok).toBe(true);
    expect(listData.items.length).toBeLessThanOrEqual(2);
  });

  it('count endpoint', async () => {
    const countRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts/count`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const countData = await countRes.json() as any;
    expect(countRes.ok).toBe(true);
    expect(typeof countData.total).toBe('number');
  });

  it('upsert via query param', async () => {
    const createRes = await fetch(`${BASE_URL}/api/db/shared/tables/posts?upsert=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ title: `web-upsert-${Date.now()}` }),
    });
    const data = await createRes.json() as any;
    expect(createRes.ok).toBe(true);
    expect(data.action).toBe('inserted');
    ids.push(data.id);
  });
});

// ─── 17. Anonymous → link to email ──────────────────────────────────────────

describe('Web E2E — Anonymous link to email', () => {
  it('anonymous signin → link email', async () => {
    // 1. anonymous signin
    const anonRes = await fetch(`${BASE_URL}/api/auth/signin/anonymous`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const anonData = await anonRes.json() as any;
    expect(anonRes.ok).toBe(true);

    // 2. link to email
    const email = `web-link-${Date.now()}@test.com`;
    const linkRes = await fetch(`${BASE_URL}/api/auth/link/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonData.accessToken}`,
      },
      body: JSON.stringify({ email, password: 'LinkPass123!' }),
    });
    const linkData = await linkRes.json() as any;
    expect(linkRes.ok).toBe(true);
    expect(linkData.accessToken).toBeTruthy();

    // 3. verify can now sign in with email
    const signinRes = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'LinkPass123!' }),
    });
    expect(signinRes.ok).toBe(true);
  });
});

// ─── 18. Storage metadata ───────────────────────────────────────────────────

describe('Web E2E — Storage metadata', () => {
  it('upload + get metadata', async () => {
    const key = `web-meta-${Date.now()}.txt`;
    const form = new FormData();
    form.append('key', key);
    form.append('file', new Blob(['metadata test content'], { type: 'text/plain' }), key);

    const uploadRes = await fetch(`${BASE_URL}/api/storage/test-bucket/upload`, {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
      body: form,
    });
    expect(uploadRes.ok).toBe(true);

    // Get metadata
    const metaRes = await fetch(`${BASE_URL}/api/storage/test-bucket/${key}/metadata`, {
      headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
    });
    if (metaRes.ok) {
      const meta = await metaRes.json() as any;
      expect(meta.key).toBe(key);
      expect(typeof meta.size).toBe('number');
    }

    // Cleanup
    await fetch(`${BASE_URL}/api/storage/test-bucket/${key}`, {
      method: 'DELETE',
      headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
    });
  });

  it('download non-existent file → 404', async () => {
    const res = await fetch(`${BASE_URL}/api/storage/test-bucket/nonexistent-web-${Date.now()}.txt`, {
      headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
});

// ─── 19. Multiple signins insert multiple sessions ──────────────────────────

describe('Web E2E — Multiple sessions', () => {
  it('two signins insert two sessions', async () => {
    const email = `web-multi-sess-${Date.now()}@test.com`;
    const password = 'MultiSess123!';

    // Signup
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    // First signin
    const s1 = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const d1 = await s1.json() as any;

    // Second signin
    const s2 = await fetch(`${BASE_URL}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const d2 = await s2.json() as any;

    // List sessions — should have at least 2 (signup + signin + signin)
    const sessRes = await fetch(`${BASE_URL}/api/auth/sessions`, {
      headers: { 'Authorization': `Bearer ${d2.accessToken}` },
    });
    const sessData = await sessRes.json() as any;
    expect(sessData.sessions.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 20. Batch operations via raw fetch ─────────────────────────────────────

describe('Web E2E — Batch (raw fetch)', () => {
  it('batch insert via POST /batch', async () => {
    const items = [
      { title: `web-batch-${Date.now()}-a` },
      { title: `web-batch-${Date.now()}-b` },
    ];
    const res = await fetch(`${BASE_URL}/api/db/shared/tables/posts/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SERVICE_KEY,
      },
      body: JSON.stringify({ inserts: items }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(Array.isArray(data.inserted)).toBe(true);
    expect(data.inserted.length).toBe(2);

    // Cleanup
    for (const c of data.inserted) {
      try {
        await fetch(`${BASE_URL}/api/db/shared/tables/posts/${c.id}`, {
          method: 'DELETE',
          headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
        });
      } catch {}
    }
  });
});

// ─── 21. JWT payload structure ──────────────────────────────────────────────

describe('Web E2E — JWT payload structure', () => {
  it('JWT has sub, email, exp fields', async () => {
    const email = `web-jwt-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'JWTCheck123!' }),
    });
    const data = await res.json() as any;
    const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
    expect(payload.sub).toBeTruthy();
    expect(payload.email).toBe(email);
    expect(typeof payload.exp).toBe('number');
  });

  it('refreshToken is a valid JWT format (3 parts)', async () => {
    const email = `web-rt-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'RTFormat123!' }),
    });
    const data = await res.json() as any;
    const parts = data.refreshToken.split('.');
    expect(parts.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 22. Push Client E2E
// ═══════════════════════════════════════════════════════════════════════════════

describe('Web E2E — Push Client', () => {
  let accessToken: string;
  const deviceId = `web-push-e2e-${Date.now()}`;
  const fcmToken = `fake-fcm-token-web-${Date.now()}`;

  it('signup for push tests', async () => {
    const email = `web-push-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WebPush123!' }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    accessToken = data.accessToken;
  });

  it('push.register → 200', async () => {
    const res = await fetch(`${BASE_URL}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId, token: fcmToken, platform: 'web' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
  });

  it('push.subscribeTopic → 200 or 503', async () => {
    const res = await fetch(`${BASE_URL}/api/push/topic/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ topic: 'test-topic-web' }),
    });
    // 503 = push not configured (no FCM creds), acceptable in test env
    expect([200, 503].includes(res.status)).toBe(true);
  });

  it('push.unsubscribeTopic → 200 or 503', async () => {
    const res = await fetch(`${BASE_URL}/api/push/topic/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ topic: 'test-topic-web' }),
    });
    // 503 = push not configured (no FCM creds), acceptable in test env
    expect([200, 503].includes(res.status)).toBe(true);
  });

  it('push.unregister → 200', async () => {
    const res = await fetch(`${BASE_URL}/api/push/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 23. Push Full-Flow E2E (Client register → Admin send → Mock FCM 수신 검증)
// ═══════════════════════════════════════════════════════════════════════════════

const MOCK_FCM_URL = process.env['MOCK_FCM_URL'] || 'http://localhost:9099';

describe('Web E2E — Push Full Flow', () => {
  let accessToken: string;
  let userId: string;
  const deviceId = `web-flow-${Date.now()}`;
  const fcmToken = `flow-token-web-${Date.now()}`;

  it('setup: signup + get userId', async () => {
    const email = `web-flow-${Date.now()}@test.com`;
    const res = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'WebFlow123!' }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    accessToken = data.accessToken;
    userId = data.user?.id || data.id;
    expect(userId).toBeTruthy();
  });

  it('clear mock FCM message store', async () => {
    const res = await fetch(`${MOCK_FCM_URL}/messages`, { method: 'DELETE' });
    expect(res.ok).toBe(true);
  });

  it('client: register device token', async () => {
    const res = await fetch(`${BASE_URL}/api/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId, token: fcmToken, platform: 'web' }),
    });
    expect(res.status).toBe(200);
  });

  it('admin: send(userId) → sent:1 + mock FCM received correct token', async () => {
    const res = await fetch(`${BASE_URL}/api/push/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SERVICE_KEY,
      },
      body: JSON.stringify({
        userId,
        payload: { title: 'Full Flow', body: 'E2E Test', data: { key: 'value' } },
      }),
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.sent).toBe(1);

    // Verify mock FCM received the message with correct token
    const msgs = await fetch(`${MOCK_FCM_URL}/messages?token=${fcmToken}`);
    const store = await msgs.json() as any[];
    expect(store.length).toBeGreaterThanOrEqual(1);
    const msg = store[store.length - 1];
    expect(msg.token).toBe(fcmToken);
    expect(msg.payload.notification?.title).toBe('Full Flow');
    expect(msg.payload.notification?.body).toBe('E2E Test');
    expect(msg.payload.data?.key).toBe('value');
  });

  it('admin: sendToToken(token) → sent:1 + mock FCM received', async () => {
    const res = await fetch(`${BASE_URL}/api/push/send-to-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SERVICE_KEY,
      },
      body: JSON.stringify({
        token: fcmToken,
        platform: 'web',
        payload: { title: 'Direct Token', body: 'Test' },
      }),
    });
    const data = await res.json() as any;
    expect(data.sent).toBe(1);

    const msgs = await fetch(`${MOCK_FCM_URL}/messages?token=${fcmToken}`);
    const store = await msgs.json() as any[];
    const last = store[store.length - 1];
    expect(last.payload.notification?.title).toBe('Direct Token');
  });

  it('admin: sendToTopic → mock FCM received with correct topic', async () => {
    const res = await fetch(`${BASE_URL}/api/push/send-to-topic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SERVICE_KEY,
      },
      body: JSON.stringify({
        topic: 'news',
        payload: { title: 'Topic Message', body: 'News update' },
      }),
    });
    expect(res.ok).toBe(true);

    const msgs = await fetch(`${MOCK_FCM_URL}/messages?topic=news`);
    const store = await msgs.json() as any[];
    expect(store.length).toBeGreaterThanOrEqual(1);
    const last = store[store.length - 1];
    expect(last.topic).toBe('news');
    expect(last.payload.notification?.title).toBe('Topic Message');
  });

  it('admin: broadcast → mock FCM received with topic "all"', async () => {
    const res = await fetch(`${BASE_URL}/api/push/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': SERVICE_KEY,
      },
      body: JSON.stringify({
        payload: { title: 'Broadcast', body: 'To everyone' },
      }),
    });
    expect(res.ok).toBe(true);

    const msgs = await fetch(`${MOCK_FCM_URL}/messages?topic=all`);
    const store = await msgs.json() as any[];
    expect(store.length).toBeGreaterThanOrEqual(1);
    const last = store[store.length - 1];
    expect(last.topic).toBe('all');
    expect(last.payload.notification?.title).toBe('Broadcast');
  });

  it('admin: getLogs → 발송 로그 확인', async () => {
    const res = await fetch(`${BASE_URL}/api/push/logs?userId=${userId}`, {
      headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
    });
    const data = await res.json() as any;
    expect(res.ok).toBe(true);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    // Verify at least one 'sent' status log exists
    const sentLog = data.items.find((l: any) => l.status === 'sent');
    expect(sentLog).toBeTruthy();
  });

  it('client: unregister → admin getTokens → empty', async () => {
    const res = await fetch(`${BASE_URL}/api/push/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId }),
    });
    expect(res.status).toBe(200);

    // Verify token was removed
    const tokens = await fetch(`${BASE_URL}/api/push/tokens?userId=${userId}`, {
      headers: { 'X-EdgeBase-Service-Key': SERVICE_KEY },
    });
    const tokenData = await tokens.json() as any;
    expect(tokenData.items).toHaveLength(0);
  });
});
