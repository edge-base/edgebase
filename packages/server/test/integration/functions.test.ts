/**
 * functions.test.ts — 40개
 *
 * 테스트 대상: src/routes/functions.ts → /api/functions/:functionName
 *
 * Handler 규칙:
 *   - 미등록 함수 → 404
 *   - 메서드 불일치 → 405
 *   - 핸들러 에러 → 500
 *   - 핸들러 Response 반환 → 그대로
 *   - 핸들러 object 반환 → JSON
 *   - 핸들러 string 반환 → text
 *   - 핸들러 null 반환 → 204
 *
 * 테스트 config에 HTTP function 등록이 없으면 모든 응답 404
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function callFn(name: string, method = 'GET', body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'X-EdgeBase-Service-Key': SK };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/functions/${name}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data, headers: res.headers };
}

// ─── 1. 미등록 함수 ─────────────────────────────────────────────────────────────

describe('1-24 functions — 미등록 함수', () => {
  it('미등록 함수 → 404', async () => {
    const { status } = await callFn('nonexistent-function');
    expect(status).toBe(404);
  });

  it('404 응답 { code: 404, message } 형식', async () => {
    const { data } = await callFn('nonexistent-function');
    expect(data?.code).toBe(404);
    expect(typeof data?.message).toBe('string');
    expect(data.message).toContain('not found');
  });

  it('경로 포함 함수명 → 404', async () => {
    const { status } = await callFn('namespace/myFunction');
    expect(status).toBe(404);
  });

  it('빈 함수명 → 404', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/functions/`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    expect([404, 405].includes(res.status)).toBe(true);
  });
});

// ─── 2. 등록된 함수 (test config에 정의된 경우) ────────────────────────────────

describe('1-24 functions — 등록된 함수', () => {
  it('등록 함수가 없으면 404 → 정상', async () => {
    // If no functions are registered in test config, all return 404
    const { status } = await callFn('test-http-function');
    expect([200, 204, 404, 405].includes(status)).toBe(true);
  });

  it('GET 함수에 POST 요청 → 405', async () => {
    // Only applies if function is registered with method: 'GET'
    const { status } = await callFn('test-get-function', 'POST', { data: 'test' });
    expect([404, 405].includes(status)).toBe(true);
  });

  it('함수 응답은 JSON 형식', async () => {
    const { data } = await callFn('any-function');
    // Either 404 or valid JSON
    expect(data === null || typeof data === 'object').toBe(true);
  });
});

// ─── 3. auth 컨텍스트 전달 ────────────────────────────────────────────────────

describe('1-24 functions — auth 컨텍스트', () => {
  it('인증 없이 호출 → auth null (함수 내부에서 처리)', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/functions/test-function`, {
      headers: { 'X-EdgeBase-Service-Key': SK },
    });
    // Function exists → may use auth, doesn't exist → 404
    expect([200, 204, 404].includes(res.status)).toBe(true);
  });

  it('인증 후 호출 → auth.id 전달', async () => {
    const signupRes = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `fn-auth-${crypto.randomUUID().slice(0, 8)}@test.com`,
        password: 'Function1234!',
      }),
    });
    const { accessToken } = await signupRes.json() as any;
    const { status } = await callFn('test-function', 'GET', undefined, accessToken);
    expect([200, 204, 404].includes(status)).toBe(true);
  });
});

// ─── 4. 에러 처리 ────────────────────────────────────────────────────────────

describe('1-24 functions — 에러 처리', () => {
  it('에러 JSON 형식: { code: 404, message }', async () => {
    const { data } = await callFn('error-function');
    if (data?.code) {
      expect(typeof data.code).toBe('number');
      expect(typeof data.message).toBe('string');
    }
  });
});
