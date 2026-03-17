/**
 * 서버 단위 테스트 — lib/jwt.ts
 * 1-09 auth-jwt.test.ts — 60개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/auth-jwt.test.ts
 *
 * 테스트 대상:
 *   parseDuration / signAccessToken / signRefreshToken / signAdminAccessToken
 *   verifyToken / verifyAccessToken / verifyRefreshToken / verifyAdminToken
 *   verifyAdminRefreshToken / verifyRefreshTokenWithFallback / verifyAdminTokenWithFallback / verifyAdminRefreshTokenWithFallback
 *   decodeTokenUnsafe / TokenExpiredError / TokenInvalidError
 */

import { describe, it, expect } from 'vitest';
import {
  parseDuration,
  signAccessToken,
  signRefreshToken,
  signAdminAccessToken,
  signAdminRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyAdminToken,
  verifyAdminRefreshToken,
  verifyRefreshTokenWithFallback,
  verifyAdminRefreshTokenWithFallback,
  decodeTokenUnsafe,
  TokenExpiredError,
  TokenInvalidError,
} from '../lib/jwt.js';

const SECRET = 'test-secret-for-unit-tests-must-be-long-enough';
const OTHER_SECRET = 'other-secret-for-rotation-must-be-long-enough-too';

// ─── A. parseDuration ────────────────────────────────────────────────────────

describe('parseDuration', () => {
  it('parses seconds: 30s → 30', () => {
    expect(parseDuration('30s')).toBe(30);
  });

  it('parses minutes: 15m → 900', () => {
    expect(parseDuration('15m')).toBe(900);
  });

  it('parses hours: 1h → 3600', () => {
    expect(parseDuration('1h')).toBe(3600);
  });

  it('parses days: 7d → 604800', () => {
    expect(parseDuration('7d')).toBe(604800);
  });

  it('parses 28d → 2419200', () => {
    expect(parseDuration('28d')).toBe(2419200);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('abc')).toThrow('Invalid duration');
  });

  it('throws on empty string', () => {
    expect(() => parseDuration('')).toThrow('Invalid duration');
  });

  it('throws on no unit', () => {
    expect(() => parseDuration('300')).toThrow('Invalid duration');
  });

  it('parses 0s → 0', () => {
    expect(parseDuration('0s')).toBe(0);
  });

  it('parses large value: 365d', () => {
    expect(parseDuration('365d')).toBe(365 * 86400);
  });
});

// ─── B. signAccessToken / verifyAccessToken ───────────────────────────────────

describe('signAccessToken + verifyAccessToken', () => {
  it('signs and verifies with correct secret', async () => {
    const token = await signAccessToken({ sub: 'user-1' }, SECRET);
    const payload = await verifyAccessToken(token, SECRET);
    expect(payload.sub).toBe('user-1');
  });

  it('issuer is edgebase:user', async () => {
    const token = await signAccessToken({ sub: 'user-1' }, SECRET);
    const payload = await verifyAccessToken(token, SECRET);
    expect(payload.iss).toBe('edgebase:user');
  });

  it('contains exp and iat', async () => {
    const token = await signAccessToken({ sub: 'user-1' }, SECRET);
    const payload = await verifyAccessToken(token, SECRET);
    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    expect(payload.exp).toBeGreaterThan(payload.iat as number);
  });

  it('includes email claim', async () => {
    const token = await signAccessToken({ sub: 'u1', email: 'test@example.com' }, SECRET);
    const payload = await verifyAccessToken(token, SECRET);
    expect(payload.email).toBe('test@example.com');
  });

  it('includes role claim', async () => {
    const token = await signAccessToken({ sub: 'u1', role: 'admin' }, SECRET);
    const payload = await verifyAccessToken(token, SECRET);
    expect(payload.role).toBe('admin');
  });

  it('includes custom claims', async () => {
    const token = await signAccessToken({ sub: 'u1', custom: { plan: 'pro' } }, SECRET);
    const payload = await verifyAccessToken(token, SECRET);
    expect((payload.custom as any)?.plan).toBe('pro');
  });

  it('wrong secret → TokenInvalidError', async () => {
    const token = await signAccessToken({ sub: 'u1' }, SECRET);
    await expect(verifyAccessToken(token, OTHER_SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('expired token → TokenExpiredError', async () => {
    const token = await signAccessToken({ sub: 'u1' }, SECRET, '1s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow(TokenExpiredError);
  });

  it('malformed token → TokenInvalidError', async () => {
    await expect(verifyAccessToken('not.a.valid.jwt', SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('admin token rejected by verifyAccessToken (wrong issuer)', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-1' }, SECRET);
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow(TokenInvalidError);
  });
});

// ─── C. signRefreshToken / verifyRefreshToken ─────────────────────────────────

describe('signRefreshToken + verifyRefreshToken', () => {
  it('signs and verifies refresh token', async () => {
    const token = await signRefreshToken({ sub: 'user-1', type: 'refresh' }, SECRET);
    const payload = await verifyRefreshToken(token, SECRET);
    expect(payload.sub).toBe('user-1');
    expect(payload.type).toBe('refresh');
  });

  it('type must be refresh', async () => {
    // If token doesn't have type=refresh, verifyRefreshToken throws
    const accessToken = await signAccessToken({ sub: 'u1' }, SECRET);
    await expect(verifyRefreshToken(accessToken, SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('includes jti when provided', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh', jti: 'session-abc' }, SECRET);
    const payload = await verifyRefreshToken(token, SECRET);
    expect(payload.jti).toBe('session-abc');
  });

  it('issuer is edgebase:user', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, SECRET);
    const payload = await verifyRefreshToken(token, SECRET);
    expect(payload.iss).toBe('edgebase:user');
  });

  it('wrong secret → TokenInvalidError', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, SECRET);
    await expect(verifyRefreshToken(token, OTHER_SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('expired token → TokenExpiredError', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, SECRET, '1s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyRefreshToken(token, SECRET)).rejects.toThrow(TokenExpiredError);
  });
});

// ─── D. signAdminAccessToken / verifyAdminToken ─────────────────────────────────────

describe('signAdminAccessToken + verifyAdminToken', () => {
  it('signs and verifies admin token', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-1' }, SECRET);
    const payload = await verifyAdminToken(token, SECRET);
    expect(payload.sub).toBe('admin-1');
  });

  it('issuer is edgebase:admin', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-1' }, SECRET);
    const payload = await verifyAdminToken(token, SECRET);
    expect(payload.iss).toBe('edgebase:admin');
  });

  it('user token rejected by verifyAdminToken (wrong issuer)', async () => {
    const token = await signAccessToken({ sub: 'u1' }, SECRET);
    await expect(verifyAdminToken(token, SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('wrong secret → TokenInvalidError', async () => {
    const token = await signAdminAccessToken({ sub: 'a1' }, SECRET);
    await expect(verifyAdminToken(token, OTHER_SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('expired admin token → TokenExpiredError', async () => {
    const token = await signAdminAccessToken({ sub: 'a1' }, SECRET, '1s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyAdminToken(token, SECRET)).rejects.toThrow(TokenExpiredError);
  });
});

describe('signAdminRefreshToken + verifyAdminRefreshToken', () => {
  it('signs and verifies admin refresh token', async () => {
    const token = await signAdminRefreshToken({ sub: 'admin-1' }, SECRET);
    const payload = await verifyAdminRefreshToken(token, SECRET);
    expect(payload.sub).toBe('admin-1');
    expect(payload.type).toBe('refresh');
  });

  it('rejects admin access token', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-1' }, SECRET);
    await expect(verifyAdminRefreshToken(token, SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('expired admin refresh token → TokenExpiredError', async () => {
    const token = await signAdminRefreshToken({ sub: 'admin-1' }, SECRET, '1s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyAdminRefreshToken(token, SECRET)).rejects.toThrow(TokenExpiredError);
  });
});

// ─── E. verifyRefreshTokenWithFallback ────────────────────────────────────────

describe('verifyRefreshTokenWithFallback', () => {
  it('verifies with current secret normally', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, SECRET);
    const payload = await verifyRefreshTokenWithFallback(token, SECRET, OTHER_SECRET, new Date().toISOString());
    expect(payload.sub).toBe('u1');
  });

  it('falls back to old secret within 28d grace period', async () => {
    // Sign with OTHER_SECRET (simulating old key)
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, OTHER_SECRET);
    const recentOldAt = new Date(Date.now() - 1000).toISOString(); // 1 second ago
    // Verify with current=SECRET, fallback=OTHER_SECRET
    const payload = await verifyRefreshTokenWithFallback(token, SECRET, OTHER_SECRET, recentOldAt);
    expect(payload.sub).toBe('u1');
  });

  it('rejects old key beyond 28d grace period', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, OTHER_SECRET);
    const expiredOldAt = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      verifyRefreshTokenWithFallback(token, SECRET, OTHER_SECRET, expiredOldAt),
    ).rejects.toThrowError();
  });

  it('expired token is not rescued by fallback (expiry takes priority)', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, SECRET, '1s');
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyRefreshTokenWithFallback(token, SECRET)).rejects.toThrow(TokenExpiredError);
  });

  it('no old secret provided → throws on wrong key', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, OTHER_SECRET);
    await expect(verifyRefreshTokenWithFallback(token, SECRET)).rejects.toThrowError();
  });

  it('oldAt missing → fallback not triggered', async () => {
    const token = await signRefreshToken({ sub: 'u1', type: 'refresh' }, OTHER_SECRET);
    await expect(verifyRefreshTokenWithFallback(token, SECRET, OTHER_SECRET)).rejects.toThrowError();
  });
});

describe('verifyAdminRefreshTokenWithFallback', () => {
  it('verifies with current secret normally', async () => {
    const token = await signAdminRefreshToken({ sub: 'admin-1' }, SECRET);
    const payload = await verifyAdminRefreshTokenWithFallback(
      token,
      SECRET,
      OTHER_SECRET,
      new Date().toISOString(),
    );
    expect(payload.sub).toBe('admin-1');
  });

  it('falls back to old secret within 28d grace period', async () => {
    const token = await signAdminRefreshToken({ sub: 'admin-1' }, OTHER_SECRET);
    const recentOldAt = new Date(Date.now() - 1000).toISOString();
    const payload = await verifyAdminRefreshTokenWithFallback(
      token,
      SECRET,
      OTHER_SECRET,
      recentOldAt,
    );
    expect(payload.sub).toBe('admin-1');
  });

  it('rejects old key beyond 28d grace period', async () => {
    const token = await signAdminRefreshToken({ sub: 'admin-1' }, OTHER_SECRET);
    const expiredOldAt = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      verifyAdminRefreshTokenWithFallback(token, SECRET, OTHER_SECRET, expiredOldAt),
    ).rejects.toThrowError();
  });
});

// ─── F. decodeTokenUnsafe ─────────────────────────────────────────────────────

describe('decodeTokenUnsafe', () => {
  it('decodes valid JWT payload without verification', async () => {
    const token = await signAccessToken({ sub: 'u1', email: 'x@test.com' }, SECRET);
    const payload = decodeTokenUnsafe(token);
    expect(payload?.sub).toBe('u1');
    expect(payload?.email).toBe('x@test.com');
  });

  it('returns null for malformed token', () => {
    expect(decodeTokenUnsafe('not.a.token')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeTokenUnsafe('')).toBeNull();
  });

  it('returns null for 2-part token', () => {
    expect(decodeTokenUnsafe('header.payload')).toBeNull();
  });

  it('does not verify signature (returns payload even for wrong secret token)', async () => {
    const token = await signAccessToken({ sub: 'u-unsafe' }, SECRET);
    // decodeTokenUnsafe doesn't verify — should return payload
    const payload = decodeTokenUnsafe(token);
    expect(payload?.sub).toBe('u-unsafe');
  });
});

// ─── G-1. Token Type Enforcement ──────────────────────────────────────────────

describe('token type enforcement', () => {
  it('user refresh token rejected by verifyAccessToken', async () => {
    const token = await signRefreshToken({ sub: 'user-1', type: 'refresh' }, SECRET);
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('admin refresh token rejected by verifyAdminToken', async () => {
    const token = await signAdminRefreshToken({ sub: 'admin-1' }, SECRET);
    await expect(verifyAdminToken(token, SECRET)).rejects.toThrow(TokenInvalidError);
  });

  it('admin access token accepted by verifyAdminToken', async () => {
    const token = await signAdminAccessToken({ sub: 'admin-1' }, SECRET);
    const payload = await verifyAdminToken(token, SECRET);
    expect(payload.sub).toBe('admin-1');
    expect(payload.type).toBe('access');
  });

  it('legacy admin token (no type field) accepted by verifyAdminToken', async () => {
    // Simulate a legacy token without type by using jose directly.
    const { SignJWT } = await import('jose');
    const legacyToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('edgebase:admin')
      .setSubject('admin-legacy')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

    const payload = await verifyAdminToken(legacyToken, SECRET);
    expect(payload.sub).toBe('admin-legacy');
    expect(payload.type).toBeUndefined();
  });

  it('signAdminAccessToken includes type=access', async () => {
    const token = await signAdminAccessToken({ sub: 'a1' }, SECRET);
    const payload = decodeTokenUnsafe(token);
    expect(payload?.type).toBe('access');
  });

  it('signAdminRefreshToken includes type=refresh', async () => {
    const token = await signAdminRefreshToken({ sub: 'a1' }, SECRET);
    const payload = decodeTokenUnsafe(token);
    expect(payload?.type).toBe('refresh');
  });

  it('legacy admin token with 1h TTL (access-like) accepted', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('edgebase:admin')
      .setSubject('admin-legacy-access')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));

    const payload = await verifyAdminToken(token, SECRET);
    expect(payload.sub).toBe('admin-legacy-access');
  });

  it('legacy admin token with 28d TTL (refresh-like) rejected', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('edgebase:admin')
      .setSubject('admin-legacy-refresh')
      .setExpirationTime('28d')
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifyAdminToken(token, SECRET)).rejects.toThrow(TokenInvalidError);
  });
});

// ─── G. TokenExpiredError / TokenInvalidError ─────────────────────────────────

describe('token error classes', () => {
  it('TokenExpiredError extends Error', () => {
    const err = new TokenExpiredError('expired');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TokenExpiredError);
    expect(err.name).toBe('TokenExpiredError');
    expect(err.message).toBe('expired');
  });

  it('TokenInvalidError extends Error', () => {
    const err = new TokenInvalidError('invalid');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TokenInvalidError);
    expect(err.name).toBe('TokenInvalidError');
    expect(err.message).toBe('invalid');
  });

  it('TokenExpiredError and TokenInvalidError are distinct', () => {
    const expired = new TokenExpiredError('e');
    const invalid = new TokenInvalidError('i');
    expect(expired).not.toBeInstanceOf(TokenInvalidError);
    expect(invalid).not.toBeInstanceOf(TokenExpiredError);
  });
});
