/**
 * auth-passkeys.test.ts — Passkeys/WebAuthn integration tests
 *
 * Tests: Passkeys registration and authentication flow
 *   POST /api/auth/passkeys/register-options  (generate registration options)
 *   POST /api/auth/passkeys/register          (verify + store credential)
 *   POST /api/auth/passkeys/auth-options       (generate authentication options)
 *   POST /api/auth/passkeys/authenticate       (verify assertion + create session)
 *   GET  /api/auth/passkeys                    (list passkeys)
 *   DELETE /api/auth/passkeys/:credentialId    (delete a passkey)
 *
 * Test config: edgebase.test.config.js → auth.passkeys: { enabled: true, rpName: 'EdgeBase Test', rpID: 'localhost', origin: 'http://localhost' }
 *
 * Note: Full WebAuthn end-to-end crypto verification requires a real browser + authenticator.
 * These tests cover the API contracts, configuration validation, error paths, and the
 * registration options generation (which doesn't require actual crypto).
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
  return `passkey-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

async function createUserAndLogin(): Promise<{ email: string; accessToken: string; userId: string }> {
  const email = randomEmail();
  const password = 'TestPass1234!';
  const { data } = await api('POST', '/signup', { email, password });
  return { email, accessToken: data.accessToken, userId: data.user.id };
}

// ─── 1. POST /passkeys/register-options — 등록 옵션 생성 ─────────────────────

describe('auth-passkeys — register-options', () => {
  it('인증된 유저 → 200, registration options 반환', async () => {
    const { accessToken } = await createUserAndLogin();
    const { status, data } = await api('POST', '/passkeys/register-options', {}, accessToken);
    expect(status).toBe(200);
    expect(data.options).toBeDefined();
    expect(data.options.rp).toBeDefined();
    expect(data.options.rp.name).toBe('EdgeBase Test');
    expect(data.options.rp.id).toBe('localhost');
    expect(data.options.challenge).toBeDefined();
    expect(typeof data.options.challenge).toBe('string');
    expect(data.options.user).toBeDefined();
    expect(data.options.pubKeyCredParams).toBeDefined();
    expect(Array.isArray(data.options.pubKeyCredParams)).toBe(true);
  });

  it('미인증 → 401', async () => {
    const { status } = await api('POST', '/passkeys/register-options', {});
    expect(status).toBe(401);
  });

  it('잘못된 토큰 → 401', async () => {
    const { status } = await api('POST', '/passkeys/register-options', {}, 'invalid-token');
    expect(status).toBe(401);
  });

  it('등록 옵션에 authenticatorSelection 포함', async () => {
    const { accessToken } = await createUserAndLogin();
    const { data } = await api('POST', '/passkeys/register-options', {}, accessToken);
    expect(data.options.authenticatorSelection).toBeDefined();
    expect(data.options.authenticatorSelection.residentKey).toBe('preferred');
    expect(data.options.authenticatorSelection.userVerification).toBe('preferred');
  });

  it('등록 옵션에 user 정보 포함 (email)', async () => {
    const { accessToken, email } = await createUserAndLogin();
    const { data } = await api('POST', '/passkeys/register-options', {}, accessToken);
    expect(data.options.user.name).toBe(email);
  });
});

// ─── 2. POST /passkeys/register — 등록 검증 ─────────────────────────────────

describe('auth-passkeys — register', () => {
  it('미인증 → 401', async () => {
    const { status } = await api('POST', '/passkeys/register', { response: {} });
    expect(status).toBe(401);
  });

  it('response 누락 → 400', async () => {
    const { accessToken } = await createUserAndLogin();
    const { status } = await api('POST', '/passkeys/register', {}, accessToken);
    expect(status).toBe(400);
  });

  it('잘못된 response → 400 (challenge 만료/미존재)', async () => {
    const { accessToken } = await createUserAndLogin();
    // Without requesting register-options first, there's no challenge
    const { status, data } = await api('POST', '/passkeys/register', {
      response: {
        id: 'fake-credential-id',
        rawId: 'fake-raw-id',
        type: 'public-key',
        response: {
          clientDataJSON: btoa(JSON.stringify({ type: 'webauthn.create', challenge: 'fake', origin: 'http://localhost' })),
          attestationObject: 'fake',
        },
      },
    }, accessToken);
    expect(status).toBe(400);
    expect(data.message).toContain('Challenge');
  });
});

// ─── 3. POST /passkeys/auth-options — 인증 옵션 생성 ─────────────────────────

describe('auth-passkeys — auth-options', () => {
  it('이메일 없이 요청 → 200, discoverable credential 옵션', async () => {
    const { status, data } = await api('POST', '/passkeys/auth-options', {});
    expect(status).toBe(200);
    expect(data.options).toBeDefined();
    expect(data.options.rpId).toBe('localhost');
    expect(data.options.challenge).toBeDefined();
    expect(typeof data.options.challenge).toBe('string');
  });

  it('존재하지 않는 이메일 → 404', async () => {
    const { status } = await api('POST', '/passkeys/auth-options', { email: 'nonexistent@example.com' });
    expect(status).toBe(404);
  });

  it('패스키 미등록 유저의 이메일 → 400', async () => {
    const { email } = await createUserAndLogin();
    const { status, data } = await api('POST', '/passkeys/auth-options', { email });
    expect(status).toBe(400);
    expect(data.message).toContain('No passkeys');
  });
});

// ─── 4. POST /passkeys/authenticate — 인증 ──────────────────────────────────

describe('auth-passkeys — authenticate', () => {
  it('response 누락 → 400', async () => {
    const { status } = await api('POST', '/passkeys/authenticate', {});
    expect(status).toBe(400);
  });

  it('credential ID 누락 → 400', async () => {
    const { status } = await api('POST', '/passkeys/authenticate', {
      response: { type: 'public-key' },
    });
    expect(status).toBe(400);
  });

  it('존재하지 않는 credential → 400', async () => {
    const { status, data } = await api('POST', '/passkeys/authenticate', {
      response: {
        id: 'nonexistent-credential-id',
        rawId: 'nonexistent',
        type: 'public-key',
        response: {
          clientDataJSON: btoa(JSON.stringify({ type: 'webauthn.get', challenge: 'fake', origin: 'http://localhost' })),
          authenticatorData: 'fake',
          signature: 'fake',
        },
      },
    });
    expect(status).toBe(400);
    expect(data.message).toContain('Unknown credential');
  });
});

// ─── 5. GET /passkeys — 패스키 목록 ─────────────────────────────────────────

describe('auth-passkeys — list passkeys', () => {
  it('인증된 유저 → 200, 빈 배열', async () => {
    const { accessToken } = await createUserAndLogin();
    const { status, data } = await api('GET', '/passkeys', undefined, accessToken);
    expect(status).toBe(200);
    expect(data.passkeys).toBeDefined();
    expect(Array.isArray(data.passkeys)).toBe(true);
    expect(data.passkeys.length).toBe(0);
  });

  it('미인증 → 401', async () => {
    const { status } = await api('GET', '/passkeys');
    expect(status).toBe(401);
  });
});

// ─── 6. DELETE /passkeys/:credentialId — 패스키 삭제 ────────────────────────

describe('auth-passkeys — delete passkey', () => {
  it('미인증 → 401', async () => {
    const { status } = await api('DELETE', '/passkeys/fake-credential-id');
    expect(status).toBe(401);
  });

  it('존재하지 않는 credential → 404', async () => {
    const { accessToken } = await createUserAndLogin();
    const { status, data } = await api('DELETE', '/passkeys/nonexistent-cred', undefined, accessToken);
    expect(status).toBe(404);
    expect(data.message).toContain('not found');
  });
});

// ─── 7. Registration Options → Register 전체 플로우 테스트 ──────────────────

describe('auth-passkeys — registration flow', () => {
  it('register-options → options에 올바른 RP 정보', async () => {
    const { accessToken, email } = await createUserAndLogin();
    const { data } = await api('POST', '/passkeys/register-options', {}, accessToken);

    // Verify RP info
    expect(data.options.rp.name).toBe('EdgeBase Test');
    expect(data.options.rp.id).toBe('localhost');

    // Verify user info
    expect(data.options.user.name).toBe(email);
    expect(data.options.user.id).toBeDefined();

    // Verify challenge exists and is base64url-like
    expect(data.options.challenge.length).toBeGreaterThan(10);

    // Verify attestation type (SimpleWebAuthn uses 'attestation' in the output)
    expect(data.options.attestation).toBe('none');
  });

  it('연속 register-options 호출 → 서로 다른 challenge', async () => {
    const { accessToken } = await createUserAndLogin();

    const { data: data1 } = await api('POST', '/passkeys/register-options', {}, accessToken);
    const { data: data2 } = await api('POST', '/passkeys/register-options', {}, accessToken);

    expect(data1.options.challenge).not.toBe(data2.options.challenge);
  });
});

// ─── 8. Authentication Options 전체 플로우 테스트 ────────────────────────────

describe('auth-passkeys — authentication options flow', () => {
  it('discoverable flow → allowCredentials 없음 또는 빈 배열', async () => {
    const { data } = await api('POST', '/passkeys/auth-options', {});
    expect(data.options).toBeDefined();
    // Discoverable credentials: no allowCredentials restriction
    if (data.options.allowCredentials) {
      expect(data.options.allowCredentials.length).toBe(0);
    }
  });

  it('auth-options → rpId 포함', async () => {
    const { data } = await api('POST', '/passkeys/auth-options', {});
    expect(data.options.rpId).toBe('localhost');
  });

  it('auth-options → userVerification 포함', async () => {
    const { data } = await api('POST', '/passkeys/auth-options', {});
    expect(data.options.userVerification).toBe('preferred');
  });
});
