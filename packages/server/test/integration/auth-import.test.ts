/**
 * auth-import.test.ts — User Import integration tests
 *
 * Tests: Admin user import endpoint
 *   POST /api/auth/admin/users/import  (batch import users)
 *
 * Requires service key authentication (X-EdgeBase-Service-Key header).
 * Tests import with plaintext passwords, pre-hashed passwords (PBKDF2 + bcrypt),
 * duplicate email handling, and batch processing.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost';

let SERVICE_KEY: string;

beforeAll(async () => {
  // Get service key from env — exposed via test setup
  SERVICE_KEY = (globalThis as any).__EDGEBASE_SERVICE_KEY__ ||
    (globalThis as any).env?.SERVICE_KEY ||
    'test-service-key';
});

async function adminApi(
  method: string,
  path: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-EdgeBase-Service-Key': SERVICE_KEY,
  };
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/admin${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function authApi(
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

async function adminDashboardApi(
  method: string,
  path: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {
    'X-EdgeBase-Service-Key': SERVICE_KEY,
  };
  if (body && method !== 'GET') headers['Content-Type'] = 'application/json';
  const res = await (globalThis as any).SELF.fetch(`${BASE}/admin/api/data${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function randomEmail() {
  return `import-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. Basic Import ─────────────────────────────────────────────────────────

describe('auth-import — basic import', () => {
  it('단일 유저 import (plaintext password) → 200, created', async () => {
    const email = randomEmail();
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{ email, password: 'TestPass1234!' }],
    });
    expect(status).toBe(200);
    expect(data.imported).toBe(1);
    expect(data.errors).toBe(0);
    expect(data.results).toHaveLength(1);
    expect(data.results[0].status).toBe('created');
    expect(data.results[0].email).toBe(email);
  });

  it('다수 유저 batch import → 200, 전체 created', async () => {
    const users = Array.from({ length: 5 }, () => ({
      email: randomEmail(),
      password: 'BatchPass123!',
    }));
    const { status, data } = await adminApi('POST', '/users/import', { users });
    expect(status).toBe(200);
    expect(data.imported).toBe(5);
    expect(data.errors).toBe(0);
  });

  it('import 후 로그인 가능', async () => {
    const email = randomEmail();
    const password = 'LoginTest123!';
    await adminApi('POST', '/users/import', {
      users: [{ email, password }],
    });

    const { status, data } = await authApi('POST', '/signin', { email, password });
    expect(status).toBe(200);
    expect(data.accessToken).toBeDefined();
    expect(data.user.email).toBe(email);
  });

  it('import 후 public profile projection 생성', async () => {
    const email = randomEmail();
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{ email, password: 'Projection123!' }],
    });
    expect(status).toBe(200);
    expect(data.results[0].status).toBe('created');

    const profile = await adminDashboardApi('GET', `/users/${data.results[0].id}/profile`);
    expect(profile.status).toBe(200);
    expect(profile.data.id).toBe(data.results[0].id);
  });
});

// ─── 2. Password Hash Preservation ──────────────────────────────────────────

describe('auth-import — password hash preservation', () => {
  it('PBKDF2 hash 직접 import → 200, created', async () => {
    const email = randomEmail();
    // Pre-generate a PBKDF2 hash for 'TestPassword123!'
    // We'll create a user first, get the hash, then import another user with it
    const { data: signupData } = await authApi('POST', '/signup', {
      email: `hash-source-${crypto.randomUUID().slice(0, 8)}@example.com`,
      password: 'TestPassword123!',
    });

    // Get the user to retrieve the password hash (via admin)
    const userId = signupData.user.id;
    // We can't easily get the passwordHash via API, so we test the flow differently
    // Instead, import with passwordHash field set to a known PBKDF2 hash format
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{ email, passwordHash: 'pbkdf2:sha256:100000:dGVzdHNhbHQ=:dGVzdGhhc2g=' }],
    });
    expect(status).toBe(200);
    expect(data.imported).toBe(1);
    expect(data.results[0].status).toBe('created');
  });

  it('bcrypt hash import → 200, created', async () => {
    const email = randomEmail();
    // bcrypt hash for 'password123' with cost 10
    // Generated with: bcryptjs.hashSync('password123', 10)
    const bcryptHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{ email, passwordHash: bcryptHash }],
    });
    expect(status).toBe(200);
    expect(data.imported).toBe(1);
  });
});

// ─── 3. Custom User Fields ──────────────────────────────────────────────────

describe('auth-import — custom fields', () => {
  it('displayName, role, verified 설정', async () => {
    const email = randomEmail();
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{
        email,
        password: 'Test1234!',
        displayName: 'Test User',
        role: 'admin',
        verified: true,
      }],
    });
    expect(status).toBe(200);
    expect(data.imported).toBe(1);

    // Verify user data
    const userId = data.results[0].id;
    const { data: userData } = await adminApi('GET', `/users/${userId}`);
    expect(userData.user.displayName).toBe('Test User');
    expect(userData.user.role).toBe('admin');
    expect(userData.user.verified).toBe(true);
  });

  it('metadata + appMetadata 설정', async () => {
    const email = randomEmail();
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{
        email,
        password: 'Test1234!',
        metadata: { theme: 'dark', lang: 'ko' },
        appMetadata: { plan: 'pro', stripeId: 'cus_xxx' },
      }],
    });
    expect(status).toBe(200);
    expect(data.imported).toBe(1);

    // Verify metadata
    const userId = data.results[0].id;
    const { data: userData } = await adminApi('GET', `/users/${userId}`);
    expect(userData.user.metadata).toEqual({ theme: 'dark', lang: 'ko' });
    expect(userData.user.appMetadata).toEqual({ plan: 'pro', stripeId: 'cus_xxx' });
  });

  it('custom id 지정', async () => {
    const email = randomEmail();
    const customId = `custom-${crypto.randomUUID()}`;
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{ id: customId, email, password: 'Test1234!' }],
    });
    expect(status).toBe(200);
    expect(data.imported).toBe(1);
    expect(data.results[0].id).toBe(customId);
  });
});

// ─── 4. Error Handling ──────────────────────────────────────────────────────

describe('auth-import — error handling', () => {
  it('빈 users 배열 → 400', async () => {
    const { status } = await adminApi('POST', '/users/import', { users: [] });
    expect(status).toBe(400);
  });

  it('users 누락 → 400', async () => {
    const { status } = await adminApi('POST', '/users/import', {});
    expect(status).toBe(400);
  });

  it('중복 이메일 → skipped', async () => {
    const email = randomEmail();
    // First, create a user
    await authApi('POST', '/signup', { email, password: 'Test1234!' });

    // Try to import with same email
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{ email, password: 'Test1234!' }],
    });
    expect(status).toBe(200);
    expect(data.skipped).toBe(1);
    expect(data.imported).toBe(0);
    expect(data.results[0].status).toBe('skipped');
    expect(data.results[0].error).toContain('already registered');
  });

  it('배치 내 중복 이메일 → error', async () => {
    const email = randomEmail();
    const { status, data } = await adminApi('POST', '/users/import', {
      users: [
        { email, password: 'Test1234!' },
        { email, password: 'Test5678!' },
      ],
    });
    expect(status).toBe(200);
    // First one should succeed, second should error as duplicate in batch
    const errors = data.results.filter((r: any) => r.status === 'error');
    expect(errors.length).toBe(1);
    expect(errors[0].error).toContain('Duplicate');
  });

  it('서비스 키 없이 호출 → 401 or 403', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/admin/users/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: [{ email: 'test@test.com', password: 'Test1234!' }] }),
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});

// ─── 5. Mixed Success/Error Batch ───────────────────────────────────────────

describe('auth-import — mixed batch', () => {
  it('일부 성공 + 일부 중복 → mixed results', async () => {
    const existingEmail = randomEmail();
    await authApi('POST', '/signup', { email: existingEmail, password: 'Test1234!' });

    const newEmail1 = randomEmail();
    const newEmail2 = randomEmail();

    const { status, data } = await adminApi('POST', '/users/import', {
      users: [
        { email: newEmail1, password: 'Test1234!' },
        { email: existingEmail, password: 'Test1234!' }, // duplicate
        { email: newEmail2, password: 'Test5678!' },
      ],
    });
    expect(status).toBe(200);
    expect(data.imported).toBe(2);
    expect(data.skipped).toBe(1);
  });
});

// ─── 6. Email Normalization ─────────────────────────────────────────────────

describe('auth-import — email normalization', () => {
  it('이메일 소문자 정규화', async () => {
    const base = crypto.randomUUID().slice(0, 8);
    const email = `Import-Test-${base}@EXAMPLE.COM`;
    const normalizedEmail = email.trim().toLowerCase();

    const { status, data } = await adminApi('POST', '/users/import', {
      users: [{ email, password: 'Test1234!' }],
    });
    expect(status).toBe(200);
    expect(data.imported).toBe(1);

    // Verify the email was normalized
    const userId = data.results[0].id;
    const { data: userData } = await adminApi('GET', `/users/${userId}`);
    expect(userData.user.email).toBe(normalizedEmail);
  });
});
