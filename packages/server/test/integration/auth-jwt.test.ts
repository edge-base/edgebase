/**
 * jwt.test.ts — 60개 (기존 30 + 추가 30)
 *
 * 테스트 대상: src/lib/jwt.ts
 *   signAccessToken, signRefreshToken, signAdminAccessToken
 *   verifyAccessToken, verifyRefreshToken, verifyAdminToken
 *   verifyRefreshTokenWithFallback, verifyAdminTokenWithFallback
 *   decodeTokenUnsafe, parseDuration
 *   TokenExpiredError, TokenInvalidError
 */
import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  signRefreshToken,
  signAdminAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyAdminToken,
  verifyRefreshTokenWithFallback,
  verifyAdminTokenWithFallback,
  decodeTokenUnsafe,
  parseDuration,
  TokenExpiredError,
  TokenInvalidError,
} from '../../src/lib/jwt.js';
import { SignJWT, jwtVerify } from 'jose';

const USER_SECRET  = 'test-jwt-user-secret-32-chars!!';
const ADMIN_SECRET = 'test-jwt-admin-secret-32-chars!';
const OLD_SECRET   = 'old-test-jwt-user-secret-rotated';

function key(secret: string) { return new TextEncoder().encode(secret); }

// ─── parseDuration ────────────────────────────────────────────────────────────

describe('1-09 jwt — parseDuration', () => {
  it('"15m" → 900', () => expect(parseDuration('15m')).toBe(900));
  it('"1h" → 3600', () => expect(parseDuration('1h')).toBe(3600));
  it('"28d" → 2419200', () => expect(parseDuration('28d')).toBe(2419200));
  it('"60s" → 60', () => expect(parseDuration('60s')).toBe(60));
  it('"invalid" → throws', () => expect(() => parseDuration('invalid')).toThrow());
  it('"" → throws', () => expect(() => parseDuration('')).toThrow());
});

// ─── signAccessToken / verifyAccessToken ─────────────────────────────────────

describe('1-09 jwt — signAccessToken', () => {
  it('유효한 토큰 서명 — verifyAccessToken 성공', async () => {
    const token = await signAccessToken({ sub: 'user-001', email: 'u@test.com', role: 'user' }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.sub).toBe('user-001');
    expect(payload.email).toBe('u@test.com');
    expect(payload.role).toBe('user');
    expect(payload.iss).toBe('edgebase:user');
  });

  it('sub, iss, exp, iat 모두 포함', async () => {
    const token = await signAccessToken({ sub: 'user-002' }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.sub).toMatch(/user-002/);
    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('custom claims 포함', async () => {
    const token = await signAccessToken({ sub: 'u003', custom: { tier: 'pro' } }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect((payload as any).custom?.tier).toBe('pro');
  });

  it('isAnonymous: true 포함', async () => {
    const token = await signAccessToken({ sub: 'anon-001', isAnonymous: true }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.isAnonymous).toBe(true);
  });
});

// ─── 만료 토큰 ───────────────────────────────────────────────────────────────

describe('1-09 jwt — 만료 / 서명 오류', () => {
  it('만료 토큰 → TokenExpiredError', async () => {
    const expired = await new SignJWT({ sub: 'user-exp' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .setIssuer('edgebase:user')
      .sign(key(USER_SECRET));

    await expect(verifyAccessToken(expired, USER_SECRET)).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('잘못된 서명 → TokenInvalidError', async () => {
    const token = await signAccessToken({ sub: 'u001' }, USER_SECRET);
    await expect(verifyAccessToken(token, 'wrong-secret-key')).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('임의 문자열 → TokenInvalidError', async () => {
    await expect(verifyAccessToken('not.a.jwt', USER_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('admin JWT → user verifyAccessToken issuer mismatch → TokenInvalidError', async () => {
    const adminToken = await signAdminAccessToken({ sub: 'admin-001' }, ADMIN_SECRET);
    await expect(verifyAccessToken(adminToken, USER_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });
});

// ─── signRefreshToken / verifyRefreshToken ───────────────────────────────────

describe('1-09 jwt — refreshToken', () => {
  it('refresh token 서명 및 검증 성공', async () => {
    const token = await signRefreshToken({ sub: 'user-001', type: 'refresh', jti: 'sess-001' }, USER_SECRET);
    const payload = await verifyRefreshToken(token, USER_SECRET);
    expect(payload.sub).toBe('user-001');
    expect(payload.type).toBe('refresh');
  });

  it('jti 포함 확인', async () => {
    const token = await signRefreshToken({ sub: 'u001', type: 'refresh', jti: 'unique-session-id' }, USER_SECRET);
    const payload = await verifyRefreshToken(token, USER_SECRET);
    expect(payload.jti).toBe('unique-session-id');
  });

  it('access token을 refresh verify에 사용 → TokenInvalidError (type != refresh)', async () => {
    const accessToken = await signAccessToken({ sub: 'u001' }, USER_SECRET);
    await expect(verifyRefreshToken(accessToken, USER_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('만료 refresh token → TokenExpiredError', async () => {
    const expired = await new SignJWT({ type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .setIssuer('edgebase:user')
      .sign(key(USER_SECRET));
    await expect(verifyRefreshToken(expired, USER_SECRET)).rejects.toBeInstanceOf(TokenExpiredError);
  });
});

// ─── signAdminAccessToken / verifyAdminToken ───────────────────────────────────────

describe('1-09 jwt — adminToken', () => {
  it('admin token 서명 및 검증', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-001' }, ADMIN_SECRET);
    const payload = await verifyAdminToken(token, ADMIN_SECRET);
    expect(payload.sub).toBe('admin-001');
    expect(payload.iss).toBe('edgebase:admin');
  });

  it('admin token → user verifyAccessToken → TokenInvalidError', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-001' }, ADMIN_SECRET);
    await expect(verifyAccessToken(token, USER_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('user token → admin verifyAdminToken → TokenInvalidError', async () => {
    const token = await signAccessToken({ sub: 'u001' }, USER_SECRET);
    await expect(verifyAdminToken(token, ADMIN_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });
});

// ─── verifyRefreshTokenWithFallback ───────────────────────────────────────────

describe('1-09 jwt — verifyRefreshTokenWithFallback', () => {
  const OLD_ADMIN_SECRET = 'old-test-jwt-admin-secret-rotated';

  it('현재 키로 검증 성공', async () => {
    const token = await signRefreshToken({ sub: 'u001', type: 'refresh' }, USER_SECRET);
    const p = await verifyRefreshTokenWithFallback(token, USER_SECRET, OLD_SECRET, '2099-01-01T00:00:00.000Z');
    expect(p.sub).toBe('u001');
  });

  it('이전 키 서명 + grace 기간 내 → 폴백 성공', async () => {
    const token = await signRefreshToken({ sub: 'u002', type: 'refresh' }, OLD_SECRET);
    // oldAt = now, so within grace period
    const oldAt = new Date().toISOString();
    const p = await verifyRefreshTokenWithFallback(token, USER_SECRET, OLD_SECRET, oldAt);
    expect(p.sub).toBe('u002');
  });

  it('이전 키 서명 + grace 기간 초과 → 에러', async () => {
    const token = await signRefreshToken({ sub: 'u003', type: 'refresh' }, OLD_SECRET);
    // oldAt = 30 days ago → grace exceeded
    const oldAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      verifyRefreshTokenWithFallback(token, USER_SECRET, OLD_SECRET, oldAt)
    ).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('만료 토큰 → 폴백 없이 TokenExpiredError (만료는 폴백 대상 아님)', async () => {
    const expired = await new SignJWT({ type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .setIssuer('edgebase:user')
      .sign(key(USER_SECRET));
    await expect(
      verifyRefreshTokenWithFallback(expired, USER_SECRET, OLD_SECRET, '2099-01-01T00:00:00.000Z')
    ).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('oldSecret/oldAt 미설정 → 폴백 없이 에러', async () => {
    const token = await signRefreshToken({ sub: 'u004', type: 'refresh' }, OLD_SECRET);
    await expect(
      verifyRefreshTokenWithFallback(token, USER_SECRET)
    ).rejects.toBeDefined();
  });
});

// ─── decodeTokenUnsafe ────────────────────────────────────────────────────────

describe('1-09 jwt — decodeTokenUnsafe', () => {
  it('유효한 JWT → payload 객체 반환', async () => {
    const token = await signAccessToken({ sub: 'u001' }, USER_SECRET);
    const decoded = decodeTokenUnsafe(token);
    expect(decoded).not.toBeNull();
    expect((decoded as any).sub).toBe('u001');
  });

  it('임의 문자열 → null', () => {
    expect(decodeTokenUnsafe('not-a-jwt')).toBeNull();
  });

  it('두 파트짜리 문자열 → null', () => {
    expect(decodeTokenUnsafe('a.b')).toBeNull();
  });

  it('잘못된 base64 payload → null', () => {
    expect(decodeTokenUnsafe('header.!!!.sig')).toBeNull();
  });
});

// ─── signAccessToken: 추가 ───────────────────────────────────────────────────

describe('1-09 jwt — signAccessToken 추가', () => {
  it('기본 TTL 15m → exp - iat ≈ 900초', async () => {
    const token = await signAccessToken({ sub: 'u-ttl-1' }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    const diff = payload.exp - payload.iat;
    expect(diff).toBe(900);
  });

  it('custom TTL "1h" → exp - iat = 3600초', async () => {
    const token = await signAccessToken({ sub: 'u-ttl-2' }, USER_SECRET, '1h');
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('email: null 포함 가능', async () => {
    const token = await signAccessToken({ sub: 'u-null-email', email: null }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.sub).toBe('u-null-email');
  });

  it('role: admin 포함', async () => {
    const token = await signAccessToken({ sub: 'u-admin', role: 'admin' }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.role).toBe('admin');
  });

  it('custom claims 빈 객체 → 에러 없음', async () => {
    const token = await signAccessToken({ sub: 'u-empty-custom', custom: {} }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.sub).toBe('u-empty-custom');
  });

  it('custom claims 중첩 객체', async () => {
    const token = await signAccessToken({
      sub: 'u-nested',
      custom: { org: { id: 'org-1', role: 'owner' } },
    }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect((payload as any).custom?.org?.id).toBe('org-1');
  });

  it('sub에 UUID 형식 사용 가능', async () => {
    const uuid = crypto.randomUUID();
    const token = await signAccessToken({ sub: uuid }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.sub).toBe(uuid);
  });
});

// ─── verifyAccessToken: issuer 검증 ──────────────────────────────────────────

describe('1-09 jwt — verifyAccessToken issuer 검증', () => {
  it('issuer edgebase:user → verifyAccessToken 성공', async () => {
    const token = await signAccessToken({ sub: 'u-iss-1' }, USER_SECRET);
    const payload = await verifyAccessToken(token, USER_SECRET);
    expect(payload.iss).toBe('edgebase:user');
  });

  it('issuer edgebase:admin → verifyAccessToken 실패', async () => {
    const token = await new SignJWT({ sub: 'u-iss-2' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('edgebase:admin')
      .setExpirationTime('15m')
      .sign(key(USER_SECRET));
    await expect(verifyAccessToken(token, USER_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('issuer 없는 JWT → verifyAccessToken 실패', async () => {
    const token = await new SignJWT({ sub: 'u-no-iss' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key(USER_SECRET));
    await expect(verifyAccessToken(token, USER_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('issuer 임의 문자열 → verifyAccessToken 실패', async () => {
    const token = await new SignJWT({ sub: 'u-bad-iss' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('random:issuer')
      .setExpirationTime('15m')
      .sign(key(USER_SECRET));
    await expect(verifyAccessToken(token, USER_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });
});

// ─── signRefreshToken: 추가 ──────────────────────────────────────────────────

describe('1-09 jwt — signRefreshToken 추가', () => {
  it('기본 TTL 28d → exp - iat = 2419200초', async () => {
    const token = await signRefreshToken({ sub: 'u-ref-1', type: 'refresh' }, USER_SECRET);
    const payload = await verifyRefreshToken(token, USER_SECRET);
    expect(payload.exp - payload.iat).toBe(2419200);
  });

  it('custom TTL "7d" → exp - iat = 604800초', async () => {
    const token = await signRefreshToken({ sub: 'u-ref-2', type: 'refresh' }, USER_SECRET, '7d');
    const payload = await verifyRefreshToken(token, USER_SECRET);
    expect(payload.exp - payload.iat).toBe(604800);
  });

  it('type: refresh 페이로드에 포함됨', async () => {
    const token = await signRefreshToken({ sub: 'u-ref-3', type: 'refresh' }, USER_SECRET);
    const payload = await verifyRefreshToken(token, USER_SECRET);
    expect(payload.type).toBe('refresh');
  });

  it('jti 없이 서명 → jti undefined', async () => {
    const token = await signRefreshToken({ sub: 'u-ref-4', type: 'refresh' }, USER_SECRET);
    const payload = await verifyRefreshToken(token, USER_SECRET);
    expect(payload.jti).toBeUndefined();
  });

  it('refresh token → verifyAdminToken → TokenInvalidError', async () => {
    const token = await signRefreshToken({ sub: 'u-ref-5', type: 'refresh' }, USER_SECRET);
    await expect(verifyAdminToken(token, ADMIN_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });
});

// ─── signAdminAccessToken: 추가 ────────────────────────────────────────────────────

describe('1-09 jwt — signAdminAccessToken 추가', () => {
  it('기본 TTL 1h → exp - iat = 3600초', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-ttl-1' }, ADMIN_SECRET);
    const payload = await verifyAdminToken(token, ADMIN_SECRET);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it('issuer = edgebase:admin', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-iss' }, ADMIN_SECRET);
    const payload = await verifyAdminToken(token, ADMIN_SECRET);
    expect(payload.iss).toBe('edgebase:admin');
  });

  it('admin token → verifyRefreshToken → TokenInvalidError (type 필드 없음)', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-cross-1' }, ADMIN_SECRET);
    await expect(verifyRefreshToken(token, ADMIN_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('admin 시크릿으로 서명 → user 시크릿으로 검증 → TokenInvalidError', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-cross-2' }, ADMIN_SECRET);
    await expect(verifyAdminToken(token, USER_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('user 시크릿으로 서명한 admin-issuer JWT → admin 시크릿 검증 → TokenInvalidError', async () => {
    const token = await new SignJWT({ sub: 'fake-admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('edgebase:admin')
      .setExpirationTime('1h')
      .sign(key(USER_SECRET));
    await expect(verifyAdminToken(token, ADMIN_SECRET)).rejects.toBeInstanceOf(TokenInvalidError);
  });
});

// ─── verifyAdminTokenWithFallback ────────────────────────────────────────────

describe('1-09 jwt — verifyAdminTokenWithFallback', () => {
  const OLD_ADMIN_SECRET = 'old-test-jwt-admin-secret-rotated';

  it('현재 admin 키로 검증 성공', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-fb-1' }, ADMIN_SECRET);
    const p = await verifyAdminTokenWithFallback(token, ADMIN_SECRET, OLD_ADMIN_SECRET, '2099-01-01T00:00:00.000Z');
    expect(p.sub).toBe('admin-fb-1');
  });

  it('이전 admin 키 서명 + grace 기간 내 → 폴백 성공', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-fb-2' }, OLD_ADMIN_SECRET);
    const oldAt = new Date().toISOString();
    const p = await verifyAdminTokenWithFallback(token, ADMIN_SECRET, OLD_ADMIN_SECRET, oldAt);
    expect(p.sub).toBe('admin-fb-2');
  });

  it('이전 admin 키 서명 + grace 초과 → TokenInvalidError', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-fb-3' }, OLD_ADMIN_SECRET);
    const oldAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      verifyAdminTokenWithFallback(token, ADMIN_SECRET, OLD_ADMIN_SECRET, oldAt)
    ).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('만료 admin token → TokenExpiredError (폴백 대상 아님)', async () => {
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .setIssuer('edgebase:admin')
      .sign(key(ADMIN_SECRET));
    await expect(
      verifyAdminTokenWithFallback(expired, ADMIN_SECRET, OLD_ADMIN_SECRET, '2099-01-01T00:00:00.000Z')
    ).rejects.toBeInstanceOf(TokenExpiredError);
  });

  it('oldSecret/oldAt 미설정 → 현재 키 실패 시 에러', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-fb-5' }, OLD_ADMIN_SECRET);
    await expect(
      verifyAdminTokenWithFallback(token, ADMIN_SECRET)
    ).rejects.toBeDefined();
  });
});

// ─── verifyRefreshTokenWithFallback: 추가 ─────────────────────────────────────

describe('1-09 jwt — verifyRefreshTokenWithFallback 추가', () => {
  it('grace 경계 28일 정확히 → 폴백 성공', async () => {
    const token = await signRefreshToken({ sub: 'u-grace-exact', type: 'refresh' }, OLD_SECRET);
    // oldAt = exactly 28 days ago (within grace)
    const oldAt = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
    const p = await verifyRefreshTokenWithFallback(token, USER_SECRET, OLD_SECRET, oldAt);
    expect(p.sub).toBe('u-grace-exact');
  });

  it('grace 경계 28일 + 1ms → 폴백 실패', async () => {
    const token = await signRefreshToken({ sub: 'u-grace-over', type: 'refresh' }, OLD_SECRET);
    // oldAt = 28 days + 1 second ago
    const oldAt = new Date(Date.now() - (28 * 24 * 60 * 60 * 1000 + 1000)).toISOString();
    await expect(
      verifyRefreshTokenWithFallback(token, USER_SECRET, OLD_SECRET, oldAt)
    ).rejects.toBeInstanceOf(TokenInvalidError);
  });

  it('완전히 잘못된 키로 서명 → oldSecret도 아닌 경우 → 에러', async () => {
    const wrongKey = 'completely-wrong-key-not-old!!!!';
    const token = await signRefreshToken({ sub: 'u-wrong-key', type: 'refresh' }, wrongKey);
    await expect(
      verifyRefreshTokenWithFallback(token, USER_SECRET, OLD_SECRET, new Date().toISOString())
    ).rejects.toBeDefined();
  });

  it('oldAt 미래 날짜 → grace 기간 내로 처리 (정상 폴백)', async () => {
    const token = await signRefreshToken({ sub: 'u-future-oldat', type: 'refresh' }, OLD_SECRET);
    const oldAt = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // 1 hour in future
    const p = await verifyRefreshTokenWithFallback(token, USER_SECRET, OLD_SECRET, oldAt);
    expect(p.sub).toBe('u-future-oldat');
  });
});

// ─── decodeTokenUnsafe: 추가 ─────────────────────────────────────────────────

describe('1-09 jwt — decodeTokenUnsafe 추가', () => {
  it('만료 토큰도 디코딩 가능 (검증 없음)', async () => {
    const expired = await new SignJWT({ sub: 'u-decode-exp' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .setIssuer('edgebase:user')
      .sign(key(USER_SECRET));
    const decoded = decodeTokenUnsafe(expired);
    expect(decoded).not.toBeNull();
    expect((decoded as any).sub).toBe('u-decode-exp');
  });

  it('잘못된 서명 토큰도 디코딩 가능 (검증 없음)', async () => {
    const token = await signAccessToken({ sub: 'u-decode-wrong' }, USER_SECRET);
    // decodeTokenUnsafe doesn't verify signature
    const decoded = decodeTokenUnsafe(token);
    expect(decoded).not.toBeNull();
    expect((decoded as any).sub).toBe('u-decode-wrong');
  });

  it('admin token 디코딩 → iss edgebase:admin 확인', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-decode' }, ADMIN_SECRET);
    const decoded = decodeTokenUnsafe(token);
    expect(decoded).not.toBeNull();
    expect((decoded as any).iss).toBe('edgebase:admin');
  });

  it('빈 문자열 → null', () => {
    expect(decodeTokenUnsafe('')).toBeNull();
  });
});

// ─── parseDuration: 추가 ─────────────────────────────────────────────────────

describe('1-09 jwt — parseDuration 추가', () => {
  it('"30m" → 1800', () => expect(parseDuration('30m')).toBe(1800));
  it('"7d" → 604800', () => expect(parseDuration('7d')).toBe(604800));
  it('"2h" → 7200', () => expect(parseDuration('2h')).toBe(7200));
  it('"120s" → 120', () => expect(parseDuration('120s')).toBe(120));
  it('"0s" → 0', () => expect(parseDuration('0s')).toBe(0));
  it('"abc123" → throws', () => expect(() => parseDuration('abc123')).toThrow());
  it('"10x" → throws (invalid unit)', () => expect(() => parseDuration('10x')).toThrow());
  it('"m10" → throws (wrong order)', () => expect(() => parseDuration('m10')).toThrow());
});
