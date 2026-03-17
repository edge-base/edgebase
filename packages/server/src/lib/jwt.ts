/**
 * JWT utilities — Access Token / Refresh Token / Admin Token
 *
 * Uses `jose` (Web Crypto API native, Cloudflare Workers compatible).
 * HS256 symmetric signing with Workers Secrets.
 */
import { SignJWT, jwtVerify } from 'jose';

// ─── Types ───

export interface AccessTokenPayload {
  sub: string;          // userId
  email?: string | null;
  displayName?: string | null;
  role?: string;
  isAnonymous?: boolean;
  custom?: Record<string, unknown>;  // customClaims
  jti?: string;         // unique token ID — ensures uniqueness within same second
}

export interface RefreshTokenPayload {
  sub: string;          // userId
  type: 'refresh';
  jti?: string;         // unique session ID for token uniqueness
}

export interface AdminTokenPayload {
  sub: string;          // adminId
}

export interface VerifiedToken {
  sub: string;
  iss: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

// ─── Constants ───

const USER_ISSUER = 'edgebase:user';
const ADMIN_ISSUER = 'edgebase:admin';
const ALGORITHM = 'HS256';

// ─── Helpers ───

function textToKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Parse duration string like '15m', '7d', '1h' to seconds.
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${duration}`);
  const [, value, unit] = match;
  const num = parseInt(value, 10);
  const MAX_DAYS = 365; // 1 year max
  const seconds = (() => {
    switch (unit) {
      case 's': return num;
      case 'm': return num * 60;
      case 'h': return num * 3600;
      case 'd': return num * 86400;
      default: throw new Error(`Invalid duration unit: ${unit}`);
    }
  })();
  if (seconds > MAX_DAYS * 86400) {
    throw new Error(`Duration exceeds maximum of ${MAX_DAYS} days: ${duration}`);
  }
  return seconds;
}

// ─── Sign ───

/**
 * Sign a user Access Token (short TTL, default 15m).
 */
export async function signAccessToken(
  payload: AccessTokenPayload,
  secret: string,
  ttl: string = '15m',
): Promise<string> {
  const jwt = new SignJWT({
    ...payload,
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setIssuer(USER_ISSUER)
    .setSubject(payload.sub)
    .setExpirationTime(ttl)
    .setJti(payload.jti ?? crypto.randomUUID());

  return jwt.sign(textToKey(secret));
}

/**
 * Sign a Refresh Token (long TTL, default 28d).
 * Refresh Token is also JWT — allows Registry-free shardId calculation.
 */
export async function signRefreshToken(
  payload: RefreshTokenPayload,
  secret: string,
  ttl: string = '28d',
): Promise<string> {
  const builder = new SignJWT({
    type: 'refresh',
  })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setIssuer(USER_ISSUER)
    .setSubject(payload.sub)
    .setExpirationTime(ttl);

  if (payload.jti) {
    builder.setJti(payload.jti);
  }

  return builder.sign(textToKey(secret));
}

/**
 * Sign an Admin Access Token.
 */
export async function signAdminAccessToken(
  payload: AdminTokenPayload,
  secret: string,
  ttl: string = '1h',
): Promise<string> {
  const jwt = new SignJWT({ type: 'access' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setIssuer(ADMIN_ISSUER)
    .setSubject(payload.sub)
    .setExpirationTime(ttl);

  return jwt.sign(textToKey(secret));
}

/**
 * Sign an Admin Refresh Token.
 */
export async function signAdminRefreshToken(
  payload: AdminTokenPayload,
  secret: string,
  ttl: string = '28d',
): Promise<string> {
  const jwt = new SignJWT({ type: 'refresh' })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setIssuer(ADMIN_ISSUER)
    .setSubject(payload.sub)
    .setExpirationTime(ttl);

  return jwt.sign(textToKey(secret));
}

// ─── Verify ───

/**
 * Verify and decode a JWT.
 * Returns decoded payload or throws.
 */
export async function verifyToken(
  token: string,
  secret: string,
  expectedIssuer?: string,
): Promise<VerifiedToken> {
  try {
    const { payload } = await jwtVerify(token, textToKey(secret), {
      issuer: expectedIssuer,
    });
    return payload as unknown as VerifiedToken;
  } catch (err: unknown) {
    // Use error `code` property instead of `instanceof` — jose error class
    // identity can break across module boundaries in Workers/vitest-pool-workers.
    const code = (err as { code?: string })?.code;
    if (code === 'ERR_JWT_EXPIRED') {
      throw new TokenExpiredError('Token expired');
    }
    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      throw new TokenInvalidError(`Token claim validation failed: ${(err as Error).message}`);
    }
    throw new TokenInvalidError('Invalid token');
  }
}

/**
 * Verify a user Access Token.
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<VerifiedToken> {
  const payload = await verifyToken(token, secret, USER_ISSUER);
  if (payload.type === 'refresh') {
    throw new TokenInvalidError('Refresh token cannot be used as access token');
  }
  return payload;
}

/**
 * Verify a Refresh Token.
 */
export async function verifyRefreshToken(
  token: string,
  secret: string,
): Promise<VerifiedToken> {
  const payload = await verifyToken(token, secret, USER_ISSUER);
  if (payload.type !== 'refresh') {
    throw new TokenInvalidError('Not a refresh token');
  }
  return payload;
}

/**
 * Verify an Admin Token.
 */
export async function verifyAdminToken(
  token: string,
  secret: string,
): Promise<VerifiedToken> {
  const payload = await verifyToken(token, secret, ADMIN_ISSUER);
  // Explicitly reject refresh tokens used as access tokens.
  if (payload.type === 'refresh') {
    throw new TokenInvalidError('Refresh token cannot be used as access token');
  }
  // Legacy tokens (no type field): reject if TTL exceeds 2 hours.
  // Admin access tokens have 1h TTL; refresh tokens have 28d TTL.
  // This catches legacy refresh tokens that lack the type field.
  if (!payload.type && payload.iat && payload.exp) {
    const tokenLifetime = payload.exp - payload.iat;
    const MAX_ACCESS_LIFETIME = 7200; // 2 hours (generous margin over 1h access TTL)
    if (tokenLifetime > MAX_ACCESS_LIFETIME) {
      throw new TokenInvalidError('Legacy token with excessive lifetime rejected');
    }
  }
  return payload;
}

/**
 * Verify an Admin Refresh Token.
 */
export async function verifyAdminRefreshToken(
  token: string,
  secret: string,
): Promise<VerifiedToken> {
  const payload = await verifyToken(token, secret, ADMIN_ISSUER);
  if (payload.type !== 'refresh') {
    throw new TokenInvalidError('Not a refresh token');
  }
  return payload;
}

// ─── Grace Period Fallback Verify ───

/**
 * Verify a Refresh Token with old-key fallback for JWT key rotation grace period.
 * Grace period: 28 days (matches Refresh Token TTL).
 * new key → old key (within 28d) → reject.
 */
export async function verifyRefreshTokenWithFallback(
  token: string,
  secret: string,
  oldSecret?: string,
  oldAt?: string,
): Promise<VerifiedToken> {
  try {
    return await verifyRefreshToken(token, secret);
  } catch (err) {
    // Only fall back to old key on signature mismatch (not expiry)
    if (!(err instanceof TokenExpiredError) && err instanceof TokenInvalidError && oldSecret && oldAt) {
      const elapsed = Date.now() - new Date(oldAt).getTime();
      const GRACE_MS = 28 * 24 * 60 * 60 * 1000;
      if (elapsed <= GRACE_MS) {
        return await verifyRefreshToken(token, oldSecret);
      }
    }
    throw err;
  }
}

/**
 * Verify an Admin Token with old-key fallback for JWT key rotation grace period.
 */
export async function verifyAdminTokenWithFallback(
  token: string,
  secret: string,
  oldSecret?: string,
  oldAt?: string,
): Promise<VerifiedToken> {
  try {
    return await verifyAdminToken(token, secret);
  } catch (err) {
    if (!(err instanceof TokenExpiredError) && err instanceof TokenInvalidError && oldSecret && oldAt) {
      const elapsed = Date.now() - new Date(oldAt).getTime();
      const GRACE_MS = 28 * 24 * 60 * 60 * 1000;
      if (elapsed <= GRACE_MS) {
        return await verifyAdminToken(token, oldSecret);
      }
    }
    throw err;
  }
}

/**
 * Verify an Admin Refresh Token with old-key fallback for JWT key rotation grace period.
 */
export async function verifyAdminRefreshTokenWithFallback(
  token: string,
  secret: string,
  oldSecret?: string,
  oldAt?: string,
): Promise<VerifiedToken> {
  try {
    return await verifyAdminRefreshToken(token, secret);
  } catch (err) {
    if (!(err instanceof TokenExpiredError) && err instanceof TokenInvalidError && oldSecret && oldAt) {
      const elapsed = Date.now() - new Date(oldAt).getTime();
      const GRACE_MS = 28 * 24 * 60 * 60 * 1000;
      if (elapsed <= GRACE_MS) {
        return await verifyAdminRefreshToken(token, oldSecret);
      }
    }
    throw err;
  }
}


/**
 * Decode JWT payload without verification (for extracting userId from Refresh Token).
 * Used for shardId routing where verification happens at the shard level.
 */
export function decodeTokenUnsafe(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch {
    return null;
  }
}

// ─── Error Classes ───

export class TokenExpiredError extends Error {
  override name = 'TokenExpiredError';
}

export class TokenInvalidError extends Error {
  override name = 'TokenInvalidError';
}
