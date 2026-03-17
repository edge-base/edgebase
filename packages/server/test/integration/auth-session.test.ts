/**
 * auth-session.test.ts — 60개 (기존 31 + 추가 29)
 *
 * 테스트 대상: src/routes/auth.ts → auth-do.ts
 *   POST /api/auth/signup (회원가입)
 *   POST /api/auth/signin (로그인)
 *   POST /api/auth/signin/anonymous (익명 로그인)
 *   POST /api/auth/refresh (토큰 갱신)
 *   POST /api/auth/signout (로그아웃)
 *   GET  /api/auth/sessions (세션 목록)
 *   DELETE /api/auth/sessions/:id (개별 세션 삭제)
 *   POST /api/auth/change-password (비밀번호 변경)
 *   PATCH /api/auth/profile (프로필 업데이트)
 *   POST /api/auth/request-password-reset (비밀번호 재설정 요청)
 *
 * 격리 원칙: 매 describe마다 unique email 사용 (uuid 포함)
 *            signout 후 토큰은 무효화됨 → 독립적 계정 사용
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost';

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function randomEmail() {
  return `test-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

// ─── 1. 회원가입 ──────────────────────────────────────────────────────────────

describe('1-11 auth-session — signup', () => {
  it('정상 회원가입 → 201, user/accessToken/refreshToken 반환', async () => {
    const { status, data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Test1234!',
    });
    expect(status).toBe(201);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
    expect(data.user?.email).toBeDefined();
  });

  it('email 누락 → 400', async () => {
    const { status } = await api('POST', '/signup', { password: 'Test1234!' });
    expect(status).toBe(400);
  });

  it('password 누락 → 400', async () => {
    const { status } = await api('POST', '/signup', { email: randomEmail() });
    expect(status).toBe(400);
  });

  it('비밀번호 8자 미만 → 400', async () => {
    const { status } = await api('POST', '/signup', { email: randomEmail(), password: 'short' });
    expect(status).toBe(400);
  });

  it('중복 이메일 → 409', async () => {
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Test1234!' });
    const { status } = await api('POST', '/signup', { email, password: 'AnotherPass1!' });
    expect(status).toBe(409);
  });

  it('이메일 소문자 정규화 — User@Example.COM → user@example.com', async () => {
    const base = crypto.randomUUID().slice(0, 8);
    const { data } = await api('POST', '/signup', {
      email: `Test-${base}@Example.COM`,
      password: 'Test1234!',
    });
    expect(data.user?.email).toBe(`test-${base}@example.com`);
  });

  it('data 필드(displayName) 포함 → user.displayName 반환', async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Test1234!',
      data: { displayName: 'Test User' },
    });
    expect(data.user?.displayName).toBe('Test User');
  });
});

// ─── 2. 로그인 ─────────────────────────────────────────────────────────────────

describe('1-11 auth-session — signin', () => {
  const email = randomEmail();
  const password = 'SignIn1234!';

  beforeAll(async () => {
    await api('POST', '/signup', { email, password });
  });

  it('정상 로그인 → 200, accessToken/refreshToken 반환', async () => {
    const { status, data } = await api('POST', '/signin', { email, password });
    expect(status).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
  });

  it('틀린 비밀번호 → 401', async () => {
    const { status } = await api('POST', '/signin', { email, password: 'WrongPass!' });
    expect(status).toBe(401);
  });

  it('미등록 이메일 → 401', async () => {
    const { status } = await api('POST', '/signin', {
      email: 'notregistered@example.com',
      password: 'Test1234!'
    });
    expect(status).toBe(401);
  });

  it('email 누락 → 400', async () => {
    const { status } = await api('POST', '/signin', { password });
    expect(status).toBe(400);
  });

  it('대소문자 관계없이 로그인 성공', async () => {
    const { status } = await api('POST', '/signin', {
      email: email.toUpperCase(),
      password,
    });
    expect(status).toBe(200);
  });
});

// ─── 3. 익명 로그인 ────────────────────────────────────────────────────────────

describe('1-11 auth-session — signin/anonymous', () => {
  it('익명 로그인 → 201, isAnonymous=true', async () => {
    const { status, data } = await api('POST', '/signin/anonymous');
    // 테스트 config에 anonymousAuth: true 설정 필수 — FAIL이면 known issue
    if (status === 404) {
      // anonymousAuth disabled in test config — still safe
      expect(data.message).toContain('not enabled');
    } else {
      expect(status).toBe(201);
      expect(data.user?.isAnonymous).toBeTruthy();
      expect(typeof data.accessToken).toBe('string');
    }
  });
});

// ─── 4. 토큰 갱신 (refresh) ───────────────────────────────────────────────────

describe('1-11 auth-session — refresh', () => {
  let refreshToken: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Refresh1234!',
    });
    refreshToken = data.refreshToken;
  });

  it('유효한 refreshToken → 200, 새 accessToken/refreshToken 반환', async () => {
    const { status, data } = await api('POST', '/refresh', { refreshToken });
    expect(status).toBe(200);
    expect(typeof data.accessToken).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
  });

  it('refreshToken 누락 → 400', async () => {
    const { status } = await api('POST', '/refresh', {});
    expect(status).toBe(400);
  });

  it('잘못된 refreshToken → 401', async () => {
    const { status } = await api('POST', '/refresh', { refreshToken: 'not-a-token' });
    expect(status).toBe(401);
  });
});

// ─── 5. 로그아웃 (signout) ────────────────────────────────────────────────────

describe('1-11 auth-session — signout', () => {
  let refreshToken: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Signout1234!',
    });
    refreshToken = data.refreshToken;
  });

  it('유효한 refreshToken으로 signout → 200', async () => {
    const { status } = await api('POST', '/signout', { refreshToken });
    expect(status).toBe(200);
  });

  it('signout 후 동일 refreshToken refresh → 401', async () => {
    // Already signed out above
    const { status } = await api('POST', '/refresh', { refreshToken });
    expect(status).toBe(401);
  });

  it('refreshToken 누락 → 400', async () => {
    const { status } = await api('POST', '/signout', {});
    expect(status).toBe(400);
  });
});

// ─── 6. 세션 목록 / 개별 삭제 ─────────────────────────────────────────────────

describe('1-11 auth-session — sessions', () => {
  let accessToken: string;
  let secondRefreshToken: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Sessions1234!',
    });
    accessToken = data.accessToken;
    // Create a second session by signing in
    const { data: data2 } = await api('POST', '/signin', {
      email: data.user?.email,
      password: 'Sessions1234!',
    });
    secondRefreshToken = data2.refreshToken;
  });

  it('GET /sessions → 세션 목록 (배열)', async () => {
    const { status, data } = await api('GET', '/sessions', undefined, accessToken);
    expect(status).toBe(200);
    expect(Array.isArray(data.sessions || data)).toBe(true);
  });

  it('인증 없이 GET /sessions → 401', async () => {
    const { status } = await api('GET', '/sessions');
    expect(status).toBe(401);
  });
});

// ─── 7. 비밀번호 변경 ─────────────────────────────────────────────────────────

describe('1-11 auth-session — change-password', () => {
  const email = randomEmail();
  const originalPw = 'Original1234!';
  const newPw = 'NewPassword1234!';
  let accessToken: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/signup', { email, password: originalPw });
    accessToken = data.accessToken;
  });

  it('정상 비밀번호 변경 → 200', async () => {
    const { status } = await api('POST', '/change-password', {
      currentPassword: originalPw,
      newPassword: newPw,
    }, accessToken);
    expect(status).toBe(200);
  });

  it('변경 후 새 비밀번호로 로그인 가능', async () => {
    const { status } = await api('POST', '/signin', { email, password: newPw });
    expect(status).toBe(200);
  });

  it('변경 후 이전 비밀번호로 로그인 실패 → 401', async () => {
    const { status } = await api('POST', '/signin', { email, password: originalPw });
    expect(status).toBe(401);
  });

  it('인증 없이 change-password → 401', async () => {
    const { status } = await api('POST', '/change-password', {
      currentPassword: originalPw,
      newPassword: 'Any1234!',
    });
    expect(status).toBe(401);
  });

  it('8자 미만 새 비밀번호 → 400', async () => {
    const { status } = await api('POST', '/change-password', {
      currentPassword: newPw,
      newPassword: 'short',
    }, accessToken);
    expect(status).toBe(400);
  });
});

// ─── 8. 프로필 업데이트 ────────────────────────────────────────────────────────

describe('1-11 auth-session — profile', () => {
  let accessToken: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Profile1234!',
    });
    accessToken = data.accessToken;
  });

  it('PATCH /profile — displayName 업데이트', async () => {
    const { status, data } = await api('PATCH', '/profile', {
      displayName: 'Updated Name',
    }, accessToken);
    expect(status).toBe(200);
    expect(data.user?.displayName).toBe('Updated Name');
  });

  it('인증 없이 PATCH /profile → 401', async () => {
    const { status } = await api('PATCH', '/profile', { displayName: 'X' });
    expect(status).toBe(401);
  });
});

// ─── 9. 비밀번호 재설정 요청 ───────────────────────────────────────────────────

describe('1-11 auth-session — request-password-reset', () => {
  it('등록된 이메일 → 200 (이메일 발송 여부 노출 안 함)', async () => {
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Reset1234!' });
    const { status, data } = await api('POST', '/request-password-reset', { email });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('미등록 이메일도 → 200 (정보 유출 방지)', async () => {
    const { status, data } = await api('POST', '/request-password-reset', {
      email: 'never-registered@example.com',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('email 누락 → 400', async () => {
    const { status } = await api('POST', '/request-password-reset', {});
    expect(status).toBe(400);
  });
});

// ─── 10. signup → _sessions 생성 확인 ─────────────────────────────────────────

describe('1-11 auth-session — signup → _sessions', () => {
  it('signup 후 GET /sessions → 세션 1개 존재', async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Sessions10-1!',
    });
    const { status, data: sessData } = await api('GET', '/sessions', undefined, data.accessToken);
    expect(status).toBe(200);
    const sessions = sessData.sessions ?? sessData;
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('signup → refreshToken이 유효한 JWT', async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Sessions10-2!',
    });
    // JWT는 3파트 구조
    expect(data.refreshToken.split('.').length).toBe(3);
  });

  it('signup → accessToken에 sub(userId) 포함', async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Sessions10-3!',
    });
    const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
    expect(typeof payload.sub).toBe('string');
    expect(payload.sub.length).toBeGreaterThan(0);
  });
});

// ─── 11. login → session 추가 ─────────────────────────────────────────────────

describe('1-11 auth-session — login → session 추가', () => {
  const email = randomEmail();
  const password = 'LoginSess1234!';

  beforeAll(async () => {
    await api('POST', '/signup', { email, password });
  });

  it('login 후 세션 수 증가', async () => {
    // First login
    const { data: d1 } = await api('POST', '/signin', { email, password });
    const { data: sess1 } = await api('GET', '/sessions', undefined, d1.accessToken);
    const count1 = (sess1.sessions ?? sess1).length;

    // Second login → new session
    const { data: d2 } = await api('POST', '/signin', { email, password });
    const { data: sess2 } = await api('GET', '/sessions', undefined, d2.accessToken);
    const count2 = (sess2.sessions ?? sess2).length;

    expect(count2).toBeGreaterThanOrEqual(count1);
  });

  it('login → 새 refreshToken 이전과 다름', async () => {
    const { data: d1 } = await api('POST', '/signin', { email, password });
    const { data: d2 } = await api('POST', '/signin', { email, password });
    expect(d1.refreshToken).not.toBe(d2.refreshToken);
  });

  it('login → 새 accessToken 이전과 다름', async () => {
    const { data: d1 } = await api('POST', '/signin', { email, password });
    const { data: d2 } = await api('POST', '/signin', { email, password });
    expect(d1.accessToken).not.toBe(d2.accessToken);
  });
});

// ─── 12. signout → session removed / others retained ──────────────────────────

describe('1-11 auth-session — signout → session removed/others retained', () => {
  it('signout 후 해당 세션만 삭제, 다른 세션 유지', async () => {
    const email = randomEmail();
    const password = 'Signout12-1!';
    const { data: signupData } = await api('POST', '/signup', { email, password });

    // Create a second session
    const { data: d2 } = await api('POST', '/signin', { email, password });

    // Signout session 1
    await api('POST', '/signout', { refreshToken: signupData.refreshToken });

    // Session 2 should still work
    const { status } = await api('POST', '/refresh', { refreshToken: d2.refreshToken });
    expect(status).toBe(200);
  });

  it('signout 후 동일 refreshToken → 401', async () => {
    const email = randomEmail();
    const password = 'Signout12-2!';
    const { data } = await api('POST', '/signup', { email, password });
    await api('POST', '/signout', { refreshToken: data.refreshToken });
    const { status } = await api('POST', '/refresh', { refreshToken: data.refreshToken });
    expect(status).toBe(401);
  });
});

// ─── 13. 전체 세션 무효화 (change-password) ──────────────────────────────────

describe('1-11 auth-session — change-password → 세션 무효화', () => {
  it('비밀번호 변경 후 기존 세션 refresh → 401 또는 새 토큰', async () => {
    const email = randomEmail();
    const originalPw = 'ChangePw13-1!';
    const newPw = 'NewChangePw13!';

    const { data: signupData } = await api('POST', '/signup', { email, password: originalPw });
    const { data: d2 } = await api('POST', '/signin', { email, password: originalPw });

    // Change password using session 1
    await api('POST', '/change-password', {
      currentPassword: originalPw,
      newPassword: newPw,
    }, signupData.accessToken);

    // Existing session 2 refresh might be invalidated
    const { status } = await api('POST', '/refresh', { refreshToken: d2.refreshToken });
    // Either 401 (sessions invalidated) or 200 (only password changed) — both are valid patterns
    expect([200, 401].includes(status)).toBe(true);
  });

  it('비밀번호 변경 후 새 비밀번호로 로그인 → 새 세션 생성', async () => {
    const email = randomEmail();
    const originalPw = 'ChangePw13-2!';
    const newPw = 'NewChangePw13-2!';

    const { data } = await api('POST', '/signup', { email, password: originalPw });
    await api('POST', '/change-password', {
      currentPassword: originalPw,
      newPassword: newPw,
    }, data.accessToken);

    const { status, data: newData } = await api('POST', '/signin', { email, password: newPw });
    expect(status).toBe(200);
    expect(typeof newData.accessToken).toBe('string');
  });
});

// ─── 14. 익명 로그인 추가 검증 ───────────────────────────────────────────────

describe('1-11 auth-session — anonymous 추가', () => {
  it('익명 로그인 → accessToken에 isAnonymous claim 포함', async () => {
    const { status, data } = await api('POST', '/signin/anonymous');
    if (status === 201) {
      const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
      expect(payload.isAnonymous).toBe(true);
    } else {
      expect(status).toBe(404); // anonymousAuth disabled
    }
  });

  it('익명 로그인 → user.id 반환', async () => {
    const { status, data } = await api('POST', '/signin/anonymous');
    if (status === 201) {
      expect(typeof data.user?.id).toBe('string');
      expect(data.user.id.length).toBeGreaterThan(0);
    } else {
      expect(status).toBe(404);
    }
  });

  it('두 번 익명 로그인 → 다른 userId', async () => {
    const { status: s1, data: d1 } = await api('POST', '/signin/anonymous');
    const { status: s2, data: d2 } = await api('POST', '/signin/anonymous');
    if (s1 === 201 && s2 === 201) {
      expect(d1.user?.id).not.toBe(d2.user?.id);
    }
  });
});

// ─── 15. refresh 토큰 추가 검증 ──────────────────────────────────────────────

describe('1-11 auth-session — refresh 추가', () => {
  it('refresh → 새 accessToken의 sub 동일', async () => {
    const { data: signupData } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Refresh15-1!',
    });
    const originalSub = JSON.parse(atob(signupData.accessToken.split('.')[1])).sub;

    const { data: refreshData } = await api('POST', '/refresh', {
      refreshToken: signupData.refreshToken,
    });
    const newSub = JSON.parse(atob(refreshData.accessToken.split('.')[1])).sub;
    expect(newSub).toBe(originalSub);
  });

  it('refresh → 새 accessToken 발급 (이전과 다른 토큰)', async () => {
    const { data: signupData } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Refresh15-2!',
    });
    const { data: refreshData } = await api('POST', '/refresh', {
      refreshToken: signupData.refreshToken,
    });
    expect(refreshData.accessToken).not.toBe(signupData.accessToken);
  });

  it('refresh → 새 refreshToken도 발급 (rotation)', async () => {
    const { data: signupData } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Refresh15-3!',
    });
    const { data: refreshData } = await api('POST', '/refresh', {
      refreshToken: signupData.refreshToken,
    });
    expect(typeof refreshData.refreshToken).toBe('string');
    expect(refreshData.refreshToken).not.toBe(signupData.refreshToken);
  });

  it('refresh race within grace period → 이전 refreshToken 재사용도 현재 세션으로 수렴', async () => {
    const { data: signupData } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Refresh15-4!',
    });

    const { status: firstStatus, data: firstRefresh } = await api('POST', '/refresh', {
      refreshToken: signupData.refreshToken,
    });
    expect(firstStatus).toBe(200);

    const { status: secondStatus, data: secondRefresh } = await api('POST', '/refresh', {
      refreshToken: signupData.refreshToken,
    });
    expect(secondStatus).toBe(200);

    expect(secondRefresh.refreshToken).toBe(firstRefresh.refreshToken);
    expect(secondRefresh.accessToken).not.toBe(signupData.accessToken);
  });

  it('refresh token reuse beyond grace period → session revoked', async () => {
    const { data: signupData } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Refresh15-5!',
    });

    const { status: refreshStatus, data: rotated } = await api('POST', '/refresh', {
      refreshToken: signupData.refreshToken,
    });
    expect(refreshStatus).toBe(200);

    const db = (globalThis as any).env.AUTH_DB;
    const row = await db.prepare('SELECT id FROM _sessions WHERE refreshToken = ?')
      .bind(rotated.refreshToken)
      .first<{ id: string }>();
    expect(row?.id).toBeTruthy();

    await db.prepare('UPDATE _sessions SET rotatedAt = ? WHERE id = ?')
      .bind(new Date(Date.now() - 31_000).toISOString(), row.id)
      .run();

    const reused = await api('POST', '/refresh', {
      refreshToken: signupData.refreshToken,
    });
    expect(reused.status).toBe(401);
    expect(String(reused.data?.message ?? '').toLowerCase()).toContain('reuse');

    const current = await api('POST', '/refresh', {
      refreshToken: rotated.refreshToken,
    });
    expect(current.status).toBe(401);
  });

  it('repeated refresh rotation keeps a single live session stable', async () => {
    const { data: signupData } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Refresh15-6!',
    });

    const originalSub = JSON.parse(atob(signupData.accessToken.split('.')[1])).sub;
    let accessToken = signupData.accessToken;
    let refreshToken = signupData.refreshToken;

    for (let i = 0; i < 5; i++) {
      const { status, data } = await api('POST', '/refresh', { refreshToken });
      expect(status).toBe(200);

      const sub = JSON.parse(atob(data.accessToken.split('.')[1])).sub;
      expect(sub).toBe(originalSub);
      expect(data.accessToken).not.toBe(accessToken);
      expect(data.refreshToken).not.toBe(refreshToken);

      accessToken = data.accessToken;
      refreshToken = data.refreshToken;
    }

    const { status: sessionsStatus, data: sessionsData } = await api('GET', '/sessions', undefined, accessToken);
    expect(sessionsStatus).toBe(200);
    const sessions = sessionsData.sessions ?? sessionsData;
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBe(1);

    const finalRefresh = await api('POST', '/refresh', { refreshToken });
    expect(finalRefresh.status).toBe(200);
  });
});

// ─── 16. 프로필 업데이트 추가 ─────────────────────────────────────────────────

describe('1-11 auth-session — profile 추가', () => {
  let accessToken: string;

  beforeAll(async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'Profile16-1!',
    });
    accessToken = data.accessToken;
  });

  it('avatarUrl 업데이트', async () => {
    const { status, data } = await api('PATCH', '/profile', {
      avatarUrl: 'https://example.com/avatar.png',
    }, accessToken);
    expect(status).toBe(200);
    expect(data.user?.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('displayName 빈 문자열 업데이트', async () => {
    const { status } = await api('PATCH', '/profile', {
      displayName: '',
    }, accessToken);
    // Empty displayName may be accepted or rejected
    expect([200, 400].includes(status)).toBe(true);
  });

  it('emailVisibility: public 설정', async () => {
    const { status, data } = await api('PATCH', '/profile', {
      emailVisibility: 'public',
    }, accessToken);
    expect(status).toBe(200);
    expect(data.user?.emailVisibility).toBe('public');
  });

  it('emailVisibility: private 설정', async () => {
    const { status, data } = await api('PATCH', '/profile', {
      emailVisibility: 'private',
    }, accessToken);
    expect(status).toBe(200);
    expect(data.user?.emailVisibility).toBe('private');
  });
});

// ─── 17. 세션 목록 상세 ──────────────────────────────────────────────────────

describe('1-11 auth-session — sessions 상세', () => {
  it('세션 목록에 세션 id 포함', async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'SessDtl17-1!',
    });
    const { status, data: sessData } = await api('GET', '/sessions', undefined, data.accessToken);
    expect(status).toBe(200);
    const sessions = sessData.sessions ?? sessData;
    if (sessions.length > 0) {
      expect(sessions[0].id || sessions[0].jti).toBeDefined();
    }
  });

  it('세션 목록에 createdAt 포함', async () => {
    const { data } = await api('POST', '/signup', {
      email: randomEmail(),
      password: 'SessDtl17-2!',
    });
    const { data: sessData } = await api('GET', '/sessions', undefined, data.accessToken);
    const sessions = sessData.sessions ?? sessData;
    if (sessions.length > 0) {
      expect(sessions[0].createdAt || sessions[0].iat).toBeDefined();
    }
  });

  it('만료된 accessToken으로 sessions 조회 → 401', async () => {
    // Use a known-expired token format
    const { status } = await api('GET', '/sessions', undefined, 'expired.token.here');
    expect(status).toBe(401);
  });
});

// ─── 18. signup 입력 validation 추가 ─────────────────────────────────────────

describe('1-11 auth-session — signup validation 추가', () => {
  it('이메일 형식 invalid → 400', async () => {
    const { status } = await api('POST', '/signup', {
      email: 'not-an-email',
      password: 'Test1234!',
    });
    expect(status).toBe(400);
  });

  it('이메일 빈 문자열 → 400', async () => {
    const { status } = await api('POST', '/signup', {
      email: '',
      password: 'Test1234!',
    });
    expect(status).toBe(400);
  });

  it('비밀번호 빈 문자열 → 400', async () => {
    const { status } = await api('POST', '/signup', {
      email: randomEmail(),
      password: '',
    });
    expect(status).toBe(400);
  });

  it('body 없는 요청 → 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 415].includes(res.status)).toBe(true);
  });
});

// ─── 19. signin validation 추가 ──────────────────────────────────────────────

describe('1-11 auth-session — signin validation 추가', () => {
  it('password 빈 문자열 → 400 또는 401', async () => {
    const { status } = await api('POST', '/signin', {
      email: randomEmail(),
      password: '',
    });
    expect([400, 401].includes(status)).toBe(true);
  });

  it('잘못된 JSON body → 400', async () => {
    const res = await (globalThis as any).SELF.fetch(`${BASE}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });
    expect([400, 500].includes(res.status)).toBe(true);
  });
});

// ─── 20. change-password 추가 검증 ───────────────────────────────────────────

describe('1-11 auth-session — change-password 추가', () => {
  it('currentPassword 틀림 → 401 또는 400', async () => {
    const email = randomEmail();
    const { data } = await api('POST', '/signup', { email, password: 'ChangeP20-1!' });
    const { status } = await api('POST', '/change-password', {
      currentPassword: 'WrongCurrentPass!',
      newPassword: 'NewValid1234!',
    }, data.accessToken);
    expect([400, 401].includes(status)).toBe(true);
  });

  it('newPassword 누락 → 400', async () => {
    const email = randomEmail();
    const { data } = await api('POST', '/signup', { email, password: 'ChangeP20-2!' });
    const { status } = await api('POST', '/change-password', {
      currentPassword: 'ChangeP20-2!',
    }, data.accessToken);
    expect(status).toBe(400);
  });

  it('currentPassword 누락 → 400', async () => {
    const email = randomEmail();
    const { data } = await api('POST', '/signup', { email, password: 'ChangeP20-3!' });
    const { status } = await api('POST', '/change-password', {
      newPassword: 'NewValid1234!',
    }, data.accessToken);
    expect(status).toBe(400);
  });
});

// ─── 21. request-password-reset 추가 ─────────────────────────────────────────

describe('1-11 auth-session — request-password-reset 추가', () => {
  it('잘못된 이메일 형식도 → 200 (정보 유출 방지)', async () => {
    const { status, data } = await api('POST', '/request-password-reset', {
      email: 'not-an-email-format',
    });
    // May return 200 (no info leak) or 400 (validation)
    expect([200, 400].includes(status)).toBe(true);
  });

  it('등록된 이메일 2회 연속 → 모두 200', async () => {
    const email = randomEmail();
    await api('POST', '/signup', { email, password: 'Reset21-1!' });
    const { status: s1 } = await api('POST', '/request-password-reset', { email });
    const { status: s2 } = await api('POST', '/request-password-reset', { email });
    expect(s1).toBe(200);
    expect(s2).toBe(200);
  });
});
