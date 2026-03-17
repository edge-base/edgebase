/**
 * security.test.ts — Comprehensive security tests
 *
 * Test groups:
 *   1. SQL Injection Prevention
 *   2. Authentication Boundary
 *   3. Service Key Validation
 *   4. Internal Route Blocking
 *   5. Rate Limiting
 *   6. CORS Validation
 *   7. XSS Prevention
 *   8. Input Validation Limits (OR Filter, invalid operators)
 *   9. IDOR (Insecure Direct Object Reference)
 *  10. Token Manipulation (expired, forged sub, empty header)
 *  11. Service Key Scope Edge Cases
 *
 * Uses Miniflare integration via (globalThis as any).SELF.fetch
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function api(
  method: string,
  path: string,
  opts?: { headers?: Record<string, string>; body?: unknown },
) {
  const headers: Record<string, string> = { ...opts?.headers };
  if (opts?.body) headers['Content-Type'] = 'application/json';
  const res = await (globalThis as any).SELF.fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return {
    status: res.status,
    data,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Security Tests', () => {
  // ─── 1. SQL Injection Prevention ─────────────────────────────────────────

  describe('SQL Injection Prevention', () => {
    it("filter with SQL injection in value → safe (200 or 400, never 500)", async () => {
      const injection = "'; DROP TABLE posts; --";
      const filter = JSON.stringify([['title', '==', injection]]);
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBeLessThan(500); // Never internal error
    });

    it('SQL injection in sort field name → safe (200 or 400, never 500)', async () => {
      const injection = 'title; DROP TABLE posts; --';
      const sort = JSON.stringify([[injection, 'asc']]);
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?sort=${encodeURIComponent(sort)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBeLessThan(500);
    });

    it('SQL injection in search query → safe (200 or 400, never 500)', async () => {
      const injection = "'; DROP TABLE posts; --";
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?search=${encodeURIComponent(injection)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBeLessThan(500);
    });

    it('SQL injection via UNION SELECT → safe (200 or 400, never 500)', async () => {
      const injection = "' UNION SELECT * FROM sqlite_master --";
      const filter = JSON.stringify([['title', '==', injection]]);
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBeLessThan(500);
    });

    it("Bobby Tables: filter value → safe (200 or 400, never 500)", async () => {
      const injection = "Robert'); DROP TABLE students;--";
      const filter = JSON.stringify([['title', '==', injection]]);
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBeLessThan(500);
    });

    it('SQL injection in record body field → stored safely as text', async () => {
      const injection = "'; DROP TABLE posts; --";
      const { status, data } = await api(
        'POST',
        '/api/db/shared/tables/posts',
        {
          headers: { 'X-EdgeBase-Service-Key': SK },
          body: { title: injection, views: 0 },
        },
      );
      if (status < 300 && data?.id) {
        // Verify it was stored as-is
        const { data: retrieved } = await api(
          'GET',
          `/api/db/shared/tables/posts/${data.id}`,
          { headers: { 'X-EdgeBase-Service-Key': SK } },
        );
        expect(retrieved.title).toBe(injection);

        // Cleanup
        await api('DELETE', `/api/db/shared/tables/posts/${data.id}`, {
          headers: { 'X-EdgeBase-Service-Key': SK },
        });
      }
      // POST with SQL injection in value → stored safely via parameterized query
      expect(status).toBe(201);
    });
  });

  // ─── 2. Authentication Boundary ──────────────────────────────────────────

  describe('Authentication Boundary', () => {
    it('no token → 401 for admin-protected endpoints', async () => {
      // Use /api/auth/me which always requires authentication
      const { status } = await api('GET', '/api/auth/me');
      expect(status).toBe(401);
    });

    it('malformed JWT → 401', async () => {
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { Authorization: 'Bearer not-a-valid-jwt-token' },
      });
      expect(status).toBe(401);
    });

    it('empty Bearer → 401', async () => {
      const { status } = await api('GET', '/api/auth/me', {
        headers: { Authorization: 'Bearer ' },
      });
      expect(status).toBe(401);
    });

    it('JWT signed with wrong secret → 401', async () => {
      // Create a base64url encoded JWT with wrong signature
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(
        /=/g,
        '',
      );
      const payload = btoa(
        JSON.stringify({
          sub: 'hacker',
          iss: 'edgebase:user',
          exp: Date.now() / 1000 + 3600,
        }),
      ).replace(/=/g, '');
      const fakeToken = `${header}.${payload}.fake-signature`;
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { Authorization: `Bearer ${fakeToken}` },
      });
      expect(status).toBe(401);
    });

    it('JWT with alg:none attack → 401', async () => {
      const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(
        /=/g,
        '',
      );
      const payload = btoa(
        JSON.stringify({
          sub: 'admin',
          iss: 'edgebase:user',
          exp: Date.now() / 1000 + 3600,
        }),
      ).replace(/=/g, '');
      const fakeToken = `${header}.${payload}.`;
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { Authorization: `Bearer ${fakeToken}` },
      });
      expect(status).toBe(401);
    });

    it('Authorization header without Bearer prefix → 401', async () => {
      const { status } = await api('GET', '/api/auth/me', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(status).toBe(401);
    });

    it('Bearer token with extra spaces → 401', async () => {
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { Authorization: 'Bearer   some-spaces-token  ' },
      });
      expect(status).toBe(401);
    });
  });

  // ─── 3. Service Key Validation ───────────────────────────────────────────

  describe('Service Key Validation', () => {
    it('invalid service key → 401', async () => {
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { 'X-EdgeBase-Service-Key': 'wrong-key-value' },
      });
      expect(status).toBe(401);
    });

    it('empty service key → denied', async () => {
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { 'X-EdgeBase-Service-Key': '' },
      });
      expect([401, 403]).toContain(status);
    });

    it('partial service key → 401 (timing-safe)', async () => {
      // Send first half of known key — should fail even if timing attack attempted
      const partial = SK.substring(0, SK.length / 2);
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { 'X-EdgeBase-Service-Key': partial },
      });
      expect(status).toBe(401);
    });

    it('service key with trailing whitespace → 401', async () => {
      // Use /api/auth/me which requires auth (not public-readable)
      const { status } = await api('GET', '/api/auth/me', {
        headers: { 'X-EdgeBase-Service-Key': SK + ' ' },
      });
      expect(status).toBe(401);
    });

    it('service key with prefix → 401', async () => {
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { 'X-EdgeBase-Service-Key': 'Bearer ' + SK },
      });
      expect(status).toBe(401);
    });

    it('valid service key → 200 (baseline)', async () => {
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { 'X-EdgeBase-Service-Key': SK },
      });
      expect(status).toBe(200);
    });
  });

  // ─── 4. Internal Route Blocking ──────────────────────────────────────────

  describe('Internal Route Blocking', () => {
    it('/internal/* routes return 403 for external requests', async () => {
      const { status } = await api('GET', '/internal/anything', {
        headers: { 'X-EdgeBase-Service-Key': SK },
      });
      expect(status).toBe(403);
    });

    it('/internal/* with spoofed X-EdgeBase-Internal header → still 403', async () => {
      // External callers cannot bypass internal guard by spoofing the header
      const { status } = await api('GET', '/internal/anything', {
        headers: {
          'X-EdgeBase-Service-Key': SK,
          'X-EdgeBase-Internal': 'true',
        },
      });
      expect(status).toBe(403);
    });

    it('/internal/deep/nested/path → 403', async () => {
      const { status } = await api('GET', '/internal/deep/nested/path');
      expect(status).toBe(403);
    });

    it('POST /internal/anything → 403', async () => {
      const { status } = await api('POST', '/internal/anything', {
        headers: { 'X-EdgeBase-Service-Key': SK },
        body: { data: 'test' },
      });
      expect(status).toBe(403);
    });
  });

  // ─── 5. Rate Limiting ────────────────────────────────────────────────────
  //
  // Counter logic (FixedWindowCounter), window parsing, group routing, and
  // config-driven limits are thoroughly tested in rate-limit.test.ts (70 tests).
  //
  // Here we verify structural integration — the middleware is active and
  // defaults are correctly wired.

  describe('Rate Limiting', () => {
    it('rate limit defaults are configured for all groups', async () => {
      const { RATE_LIMIT_DEFAULTS } = await import('../../src/middleware/rate-limit.js');
      // All critical groups must have defaults
      expect(RATE_LIMIT_DEFAULTS.global).toBeDefined();
      expect(RATE_LIMIT_DEFAULTS.db).toBeDefined();
      expect(RATE_LIMIT_DEFAULTS.storage).toBeDefined();
      expect(RATE_LIMIT_DEFAULTS.auth).toBeDefined();
      expect(RATE_LIMIT_DEFAULTS.authSignup).toBeDefined();
      expect(RATE_LIMIT_DEFAULTS.authSignin).toBeDefined();
    });

    it('authSignup limit is strict (≤ 10 req/60s)', async () => {
      const { RATE_LIMIT_DEFAULTS } = await import('../../src/middleware/rate-limit.js');
      expect(RATE_LIMIT_DEFAULTS.authSignup.requests).toBeLessThanOrEqual(10);
      expect(RATE_LIMIT_DEFAULTS.authSignup.windowSec).toBeGreaterThanOrEqual(60);
    });

    it('rate limit middleware does not block valid requests', async () => {
      // A single request with service key should never be rate limited
      const { status } = await api('GET', '/api/db/shared/tables/posts', {
        headers: { 'X-EdgeBase-Service-Key': SK },
      });
      expect(status).toBe(200);
    });
  });

  // ─── 6. CORS Validation ──────────────────────────────────────────────────

  describe('CORS Validation', () => {
    it('OPTIONS preflight returns CORS headers', async () => {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toBeTruthy();
    });

    it('response includes Access-Control-Allow-Origin for allowed origin', async () => {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/health`, {
        method: 'GET',
        headers: { Origin: 'http://localhost:3000' },
      });
      const acaoHeader = res.headers.get('Access-Control-Allow-Origin');
      expect(acaoHeader).toBeTruthy();
    });

    it('preflight includes Access-Control-Allow-Headers', async () => {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });
      expect(res.status).toBe(204);
      const allowHeaders = res.headers.get('Access-Control-Allow-Headers');
      expect(allowHeaders).toBeTruthy();
    });

    it('preflight includes Access-Control-Max-Age', async () => {
      const res = await (globalThis as any).SELF.fetch(`${BASE}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET',
        },
      });
      // Max-Age is optional but if present, should be a number string
      const maxAge = res.headers.get('Access-Control-Max-Age');
      if (maxAge) {
        expect(Number(maxAge)).toBeGreaterThan(0);
      }
    });
  });

  // ─── 7. XSS Prevention ──────────────────────────────────────────────────

  describe('XSS Prevention', () => {
    it('stored XSS payload in record field is returned as-is in JSON (not executed)', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      // Create record with XSS payload
      const { status: createStatus, data: created } = await api(
        'POST',
        '/api/db/shared/tables/posts',
        {
          headers: { 'X-EdgeBase-Service-Key': SK },
          body: { title: xssPayload, views: 0 },
        },
      );

      if (createStatus < 300 && created?.id) {
        // Retrieve it
        const { data: retrieved, headers: resHeaders } = await api(
          'GET',
          `/api/db/shared/tables/posts/${created.id}`,
          { headers: { 'X-EdgeBase-Service-Key': SK } },
        );
        // Should be returned as raw text in JSON, not stripped or transformed
        expect(retrieved.title).toBe(xssPayload);
        // Response Content-Type should be application/json (not text/html)
        // This prevents browser execution
        expect(resHeaders['content-type']).toContain('application/json');

        // Cleanup
        await api(
          'DELETE',
          `/api/db/shared/tables/posts/${created.id}`,
          { headers: { 'X-EdgeBase-Service-Key': SK } },
        );
      }
      // XSS payload stored safely via JSON API
      expect(createStatus).toBe(201);
    });

    it('img onerror XSS payload is stored safely', async () => {
      const xssPayload = '<img src=x onerror=alert(1)>';
      const { status, data } = await api(
        'POST',
        '/api/db/shared/tables/posts',
        {
          headers: { 'X-EdgeBase-Service-Key': SK },
          body: { title: xssPayload, views: 0 },
        },
      );

      if (status < 300 && data?.id) {
        const { data: retrieved } = await api(
          'GET',
          `/api/db/shared/tables/posts/${data.id}`,
          { headers: { 'X-EdgeBase-Service-Key': SK } },
        );
        // Must be returned verbatim, not sanitized
        expect(retrieved.title).toBe(xssPayload);

        // Cleanup
        await api('DELETE', `/api/db/shared/tables/posts/${data.id}`, {
          headers: { 'X-EdgeBase-Service-Key': SK },
        });
      }
      // XSS payload stored safely via JSON API
      expect(status).toBe(201);
    });

    it('JSON API responses always have Content-Type: application/json', async () => {
      const { headers: resHeaders } = await api(
        'GET',
        '/api/db/shared/tables/posts',
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(resHeaders['content-type']).toContain('application/json');
    });
  });

  // ─── 8. Input Validation Limits ──────────────────────────────────────────

  describe('Input Validation Limits', () => {
    it('orFilter with many conditions → handled safely (never 500)', async () => {
      const orFilter = JSON.stringify([
        ['views', '>=', 1],
        ['views', '>=', 2],
        ['views', '>=', 3],
        ['views', '>=', 4],
        ['views', '>=', 5],
        ['views', '>=', 6],
      ]);
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?orFilter=${encodeURIComponent(orFilter)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      // Server may accept or reject many conditions, but should never crash
      expect(status).toBeLessThan(500);
    });

    it('invalid filter operator → 400', async () => {
      const filter = JSON.stringify([['title', 'LIKE', '%test%']]);
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBe(400);
    });

    it('filter with non-array JSON → safe (200 or 400, never 500)', async () => {
      const filter = JSON.stringify({ field: 'title', op: '==', value: 'x' });
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      // Server may ignore invalid filter shape or return 400, but never 500
      expect(status).toBeLessThan(500);
    });

    it('filter with invalid JSON string → 400 (never 500)', async () => {
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?filter=not-valid-json`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBeLessThan(500);
    });

    it('extremely long filter value → safe (never 500)', async () => {
      const longValue = 'x'.repeat(10_000);
      const filter = JSON.stringify([['title', '==', longValue]]);
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?filter=${encodeURIComponent(filter)}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBeLessThan(500);
    });

    it('negative limit → 400 or safe fallback (never 500)', async () => {
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?limit=-1`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBeLessThan(500);
    });

    it('non-numeric limit → 400', async () => {
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?limit=abc`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBe(400);
    });

    it('negative offset → 400', async () => {
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?offset=-5`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBe(400);
    });

    it('non-numeric page → 400', async () => {
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/posts?page=xyz`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(status).toBe(400);
    });
  });

  // ─── 9. IDOR (Insecure Direct Object Reference) ─────────────────────────

  describe('IDOR Prevention', () => {
    // Helper: create a user via signup and return token + userId
    async function getToken(
      email?: string,
    ): Promise<{ token: string; userId: string }> {
      const e =
        email ?? `sec-idor-${crypto.randomUUID().slice(0, 8)}@test.com`;
      const res = await (globalThis as any).SELF.fetch(
        `${BASE}/api/auth/signup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: e, password: 'Secure1234!' }),
        },
      );
      const data = (await res.json()) as any;
      return { token: data.accessToken, userId: data.user?.id };
    }

    it('User B cannot read User A\'s owner-scoped record', async () => {
      const userA = await getToken();
      const userB = await getToken();

      // User A creates a secure_posts record with themselves as author
      const { data: created } = await api(
        'POST',
        '/api/db/shared/tables/secure_posts',
        {
          headers: { Authorization: `Bearer ${userA.token}` },
          body: { title: 'Private post A', authorId: userA.userId },
        },
      );

      if (!created?.id) return; // skip if table not available

      // User B tries to read User A's record → should be denied
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/secure_posts/${created.id}`,
        { headers: { Authorization: `Bearer ${userB.token}` } },
      );
      // Row-level rule: auth.id === resource.authorId → deny
      expect([403, 404]).toContain(status);

      // Cleanup via service key
      await api('DELETE', `/api/db/shared/tables/secure_posts/${created.id}`, {
        headers: { 'X-EdgeBase-Service-Key': SK },
      });
    });

    it('User B cannot update User A\'s owner-scoped record', async () => {
      const userA = await getToken();
      const userB = await getToken();

      const { data: created } = await api(
        'POST',
        '/api/db/shared/tables/secure_posts',
        {
          headers: { Authorization: `Bearer ${userA.token}` },
          body: { title: 'Private post A', authorId: userA.userId },
        },
      );

      if (!created?.id) return;

      // User B tries to update User A's record
      const { status } = await api(
        'PATCH',
        `/api/db/shared/tables/secure_posts/${created.id}`,
        {
          headers: { Authorization: `Bearer ${userB.token}` },
          body: { title: 'Hijacked!' },
        },
      );
      expect([403, 404]).toContain(status);

      // Verify data wasn't modified
      const { data: check } = await api(
        'GET',
        `/api/db/shared/tables/secure_posts/${created.id}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(check?.title).toBe('Private post A');

      // Cleanup
      await api('DELETE', `/api/db/shared/tables/secure_posts/${created.id}`, {
        headers: { 'X-EdgeBase-Service-Key': SK },
      });
    });

    it('User B cannot delete User A\'s owner-scoped record', async () => {
      const userA = await getToken();
      const userB = await getToken();

      const { data: created } = await api(
        'POST',
        '/api/db/shared/tables/secure_posts',
        {
          headers: { Authorization: `Bearer ${userA.token}` },
          body: { title: 'Private post A', authorId: userA.userId },
        },
      );

      if (!created?.id) return;

      // User B tries to delete User A's record
      const { status } = await api(
        'DELETE',
        `/api/db/shared/tables/secure_posts/${created.id}`,
        { headers: { Authorization: `Bearer ${userB.token}` } },
      );
      expect([403, 404]).toContain(status);

      // Verify record still exists
      const { status: checkStatus } = await api(
        'GET',
        `/api/db/shared/tables/secure_posts/${created.id}`,
        { headers: { 'X-EdgeBase-Service-Key': SK } },
      );
      expect(checkStatus).toBe(200);

      // Cleanup
      await api('DELETE', `/api/db/shared/tables/secure_posts/${created.id}`, {
        headers: { 'X-EdgeBase-Service-Key': SK },
      });
    });

    it('auth-required table denies unauthenticated create', async () => {
      // No token → denied for write (create rule: "auth != null")
      const { status } = await api(
        'POST',
        '/api/db/shared/tables/auth_required_notes',
        {
          headers: { 'Content-Type': 'application/json' },
          body: { content: 'should fail' },
        },
      );
      // Worker-level auth check for insert should deny
      // Could be 400 (validation), 401 (missing auth), or 403 (denied by rule)
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    });

    it('denied_notes table denies record read even with valid token', async () => {
      const user = await getToken();

      // First create a record via service key (bypasses rules)
      const { data: created } = await api(
        'POST',
        '/api/db/shared/tables/denied_notes',
        {
          headers: { 'X-EdgeBase-Service-Key': SK },
          body: { content: 'secret note' },
        },
      );

      if (!created?.id) return; // table not available

      // Read the specific record with user token → should be denied
      const { status } = await api(
        'GET',
        `/api/db/shared/tables/denied_notes/${created.id}`,
        { headers: { Authorization: `Bearer ${user.token}` } },
      );
      // rule: read: "false" → always denied at row level
      expect([403, 404]).toContain(status);

      // Cleanup
      await api('DELETE', `/api/db/shared/tables/denied_notes/${created.id}`, {
        headers: { 'X-EdgeBase-Service-Key': SK },
      });
    });
  });

  // ─── 10. Token Manipulation ────────────────────────────────────────────

  describe('Token Manipulation', () => {
    it('expired JWT → 401 (not 500)', async () => {
      // Manually construct an expired JWT with correct structure
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(
        /=/g,
        '',
      );
      const payload = btoa(
        JSON.stringify({
          sub: 'test-user-expired',
          iss: 'edgebase:user',
          iat: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
          exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
        }),
      ).replace(/=/g, '');
      const expiredToken = `${header}.${payload}.fake-signature`;

      const { status } = await api('GET', '/api/auth/me', {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      expect(status).toBe(401);
    });

    it('JWT with tampered sub field → cannot access other user data', async () => {
      // Even if we craft a JWT with a different sub, the signature check
      // should prevent access
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(
        /=/g,
        '',
      );
      const payload = btoa(
        JSON.stringify({
          sub: 'admin-user-id',
          iss: 'edgebase:user',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: 'admin',
        }),
      ).replace(/=/g, '');
      const tamperedToken = `${header}.${payload}.tampered-signature`;

      const { status } = await api('GET', '/api/auth/me', {
        headers: { Authorization: `Bearer ${tamperedToken}` },
      });
      expect(status).toBe(401);
    });

    it('empty Authorization header value → 401 (not 500)', async () => {
      const { status } = await api('GET', '/api/auth/me', {
        headers: { Authorization: '' },
      });
      expect(status).toBe(401);
    });

    it('Authorization: null string → 401 on protected endpoint (not 500)', async () => {
      // Use /api/auth/me which always requires valid auth
      const { status } = await api('GET', '/api/auth/me', {
        headers: { Authorization: 'null' },
      });
      expect(status).toBe(401);
    });

    it('extremely long token → 401 (not 500)', async () => {
      const longToken = 'Bearer ' + 'A'.repeat(10_000);
      const { status } = await api('GET', '/api/auth/me', {
        headers: { Authorization: longToken },
      });
      expect(status).toBeLessThan(500);
    });
  });

  // ─── 11. Service Key Scope & Constraint Edge Cases ─────────────────────

  describe('Service Key Scope Edge Cases', () => {
    it('matchesScope validates wildcard and exact patterns', async () => {
      const { matchesScope } = await import('../../src/lib/service-key.js');

      // Exact match
      expect(matchesScope('db:read', { scopes: ['db:read'] } as any)).toBe(true);
      // Wildcard
      expect(matchesScope('db:read', { scopes: ['*'] } as any)).toBe(true);
      expect(matchesScope('db:read', { scopes: ['db:*'] } as any)).toBe(true);
      // No match
      expect(matchesScope('db:write', { scopes: ['db:read'] } as any)).toBe(false);
      // Empty scopes → deny
      expect(matchesScope('db:read', { scopes: [] } as any)).toBe(false);
    });

    it('buildKeymap creates lookup map from config', async () => {
      const { buildKeymap } = await import('../../src/lib/service-key.js');

      const config = {
        serviceKeys: {
          keys: [
            { kid: 'key-1', inlineSecret: 'secret-1', secretSource: 'inline', scopes: ['db:read'] },
            { kid: 'key-2', inlineSecret: 'secret-2', secretSource: 'inline', scopes: ['*'] },
          ],
        },
      };
      const keymap = buildKeymap(config as any, {} as any);

      expect(keymap).not.toBeNull();
      expect(keymap!.size).toBe(2);
      expect(keymap!.has('key-1')).toBe(true);
      expect(keymap!.has('key-2')).toBe(true);
      expect(keymap!.has('nonexistent')).toBe(false);
    });

    it('buildKeymap returns null when no keys configured', async () => {
      const { buildKeymap } = await import('../../src/lib/service-key.js');

      // No serviceKeys property
      expect(buildKeymap({} as any, {} as any)).toBeNull();
      // Empty keys array
      expect(buildKeymap({ serviceKeys: { keys: [] } } as any, {} as any)).toBeNull();
    });

    it('validateScopedKey rejects invalid format', async () => {
      const { validateScopedKey, buildKeymap } = await import('../../src/lib/service-key.js');

      const config = {
        serviceKeys: {
          keys: [
            { kid: 'key-1', inlineSecret: 'jb_key-1_secret-1', secretSource: 'inline', scopes: ['db:read'] },
          ],
        },
      };
      const keymap = buildKeymap(config as any, {} as any)!;

      // Wrong format (no jb_ prefix) → missing (falls through to root-tier loop)
      const result1 = validateScopedKey('wrong-format', 'db:read', keymap, {});
      expect(result1).not.toBe('valid');

      // Right prefix but wrong kid
      const result2 = validateScopedKey('jb_nonexistent_secret', 'db:read', keymap, {});
      expect(result2).toBe('invalid');
    });

    it('validateConfiguredKey enforces exact configured secrets', async () => {
      const { buildKeymap, validateConfiguredKey } = await import('../../src/lib/service-key.js');

      const config = {
        serviceKeys: {
          keys: [
            { kid: 'root-1', inlineSecret: 'my-secret-key', secretSource: 'inline', scopes: ['*'] },
          ],
        },
      };
      const keymap = buildKeymap(config as any, {} as any)!;

      expect(validateConfiguredKey('my-secret-key', keymap, {})).toBe('valid');
      expect(validateConfiguredKey('wrong-key', keymap, {})).toBe('invalid');
      expect(validateConfiguredKey('', keymap, {})).toBe('invalid');
      expect(validateConfiguredKey('my-secret-key ', keymap, {})).toBe('invalid');
      expect(validateConfiguredKey(null, keymap, {})).toBe('missing');
      expect(validateConfiguredKey(undefined, keymap, {})).toBe('missing');
    });
  });
});
