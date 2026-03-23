/**
 * auth-d1-service.ts — Auth service layer (supports D1 + PostgreSQL backends)
 *
 * Uses the AuthDb adapter interface for provider-agnostic database access.
 * All SQL uses `?` bind params — the adapter converts to `$1, $2, ...` for PostgreSQL.
 *
 * Key patterns:
 * - No `RETURNING *` — re-fetch after INSERT/UPDATE (portable across D1/pg)
 * - `db.batch()` → atomic transaction (D1 batch / pg BEGIN/COMMIT)
 * - `datetime('now')` replaced with JS `new Date().toISOString()` (portable)
 * - `INSERT OR IGNORE` → adapter converts to `ON CONFLICT DO NOTHING` for pg
 *
 * All functions are async (both D1 and pg are HTTP-based).
 */

import type { AuthDb } from './auth-db-adapter.js';

// ─── Types ───

export interface CreateUserInput {
  userId: string;
  email: string | null;
  passwordHash: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  emailVisibility?: string;
  role?: string;
  verified?: boolean;
  locale?: string;
  metadata?: Record<string, unknown> | null;
  appMetadata?: Record<string, unknown> | null;
}

export interface UpdateUserInput {
  email?: string;
  passwordHash?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  emailVisibility?: string;
  role?: string;
  verified?: boolean | number;
  isAnonymous?: boolean | number;
  customClaims?: Record<string, unknown> | string | null;
  phone?: string | null;
  phoneVerified?: boolean | number;
  metadata?: Record<string, unknown> | string | null;
  appMetadata?: Record<string, unknown> | string | null;
  disabled?: boolean | number;
  status?: string;
  locale?: string;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: string;
  metadata?: string | null;
  previousRefreshToken?: string | null;
  rotatedAt?: string | null;
}

export interface CreateOAuthAccountInput {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
}

export interface CreateEmailTokenInput {
  token: string;
  userId: string;
  type: string;
  expiresAt: string;
}

export interface CreateMfaFactorInput {
  id: string;
  userId: string;
  type?: string;
  secret: string;
}

export interface CreateWebAuthnCredentialInput {
  id: string;
  userId: string;
  credentialId: string;
  credentialPublicKey: string;
  counter?: number;
  transports?: string | null;
}

// ─── A. User CRUD ───

/**
 * Create a new user record.
 * INSERT + re-fetch (portable, works on both D1 and pg).
 */
export async function createUser(
  db: AuthDb,
  input: CreateUserInput,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null;
  const appMetadataStr = input.appMetadata ? JSON.stringify(input.appMetadata) : null;

  await db.run(
    `INSERT INTO _users (id, email, passwordHash, displayName, avatarUrl, emailVisibility, role, verified, isAnonymous, locale, metadata, appMetadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.email,
      input.passwordHash,
      input.displayName ?? null,
      input.avatarUrl ?? null,
      input.emailVisibility ?? 'private',
      input.role ?? 'user',
      input.verified ? 1 : 0,
      input.locale ?? 'en',
      metadataStr,
      appMetadataStr,
      now,
      now,
    ],
  );

  // Re-fetch
  const user = await db.first(`SELECT * FROM _users WHERE id = ?`, [input.userId]);
  return user as Record<string, unknown>;
}

/**
 * Create an anonymous user record.
 * INSERT + re-fetch.
 */
export async function createAnonymousUser(
  db: AuthDb,
  userId: string,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO _users (id, email, passwordHash, displayName, avatarUrl, emailVisibility, role, verified, isAnonymous, createdAt, updatedAt)
     VALUES (?, NULL, NULL, NULL, NULL, 'private', 'user', 0, 1, ?, ?)`,
    [userId, now, now],
  );

  // Re-fetch
  const user = await db.first(`SELECT * FROM _users WHERE id = ?`, [userId]);
  return user as Record<string, unknown>;
}

/**
 * Get user by ID.
 */
export async function getUserById(
  db: AuthDb,
  userId: string,
): Promise<Record<string, unknown> | null> {
  return await db.first(`SELECT * FROM _users WHERE id = ?`, [userId]);
}

/**
 * Get user by email.
 */
export async function getUserByEmail(
  db: AuthDb,
  email: string,
): Promise<Record<string, unknown> | null> {
  return await db.first(`SELECT * FROM _users WHERE email = ?`, [email]);
}

/**
 * Get user by phone.
 */
export async function getUserByPhone(
  db: AuthDb,
  phone: string,
): Promise<Record<string, unknown> | null> {
  return await db.first(`SELECT * FROM _users WHERE phone = ?`, [phone]);
}

/**
 * Update user with dynamic fields.
 * Builds SET clause dynamically. Re-fetches after UPDATE.
 */
export async function updateUser(
  db: AuthDb,
  userId: string,
  updates: UpdateUserInput,
): Promise<Record<string, unknown> | null> {
  // Allowlist of _users columns that can be updated
  const ALLOWED_COLUMNS = new Set([
    'email', 'passwordHash', 'displayName', 'avatarUrl', 'emailVisibility',
    'role', 'status', 'verified', 'isAnonymous', 'locale', 'metadata', 'appMetadata',
    'customClaims', 'phone', 'phoneVerified', 'disabled', 'bannedUntil',
    'lastSignInAt', 'lastSignedInAt', 'updatedAt',
  ]);

  const sets: string[] = [];
  const params: unknown[] = [];

  const normalizeRoleValue = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  };

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'createdAt') continue;
    // Skip unknown columns to prevent errors from arbitrary input
    if (!ALLOWED_COLUMNS.has(key)) continue;
    // Skip non-bindable values (Symbol, Function, etc.)
    if (typeof value === 'symbol' || typeof value === 'function') continue;

    // Enum validation: reject invalid values for constrained fields
    if (key === 'status' && !['active', 'suspended', 'banned', 'disabled'].includes(value as string)) continue;
    if (key === 'emailVisibility' && !['public', 'private'].includes(value as string)) continue;

    if (key === 'role') {
      const normalizedRole = normalizeRoleValue(value);
      if (!normalizedRole) continue;
      sets.push('"role" = ?');
      params.push(normalizedRole);
      continue;
    }

    // JSON fields: serialize to string
    if ((key === 'customClaims' || key === 'metadata' || key === 'appMetadata') && value !== null && typeof value === 'object') {
      sets.push(`"${key}" = ?`);
      params.push(JSON.stringify(value));
    }
    // Boolean fields: convert to integer
    else if ((key === 'verified' || key === 'isAnonymous' || key === 'phoneVerified' || key === 'disabled') && typeof value === 'boolean') {
      sets.push(`"${key}" = ?`);
      params.push(value ? 1 : 0);
    }
    else {
      sets.push(`"${key}" = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return null;

  const now = new Date().toISOString();
  sets.push('"updatedAt" = ?');
  params.push(now);
  params.push(userId);

  await db.run(
    `UPDATE _users SET ${sets.join(', ')} WHERE "id" = ?`,
    params,
  );

  // Re-fetch
  return await db.first(`SELECT * FROM _users WHERE id = ?`, [userId]);
}

/**
 * Delete user and all related records (cascade).
 * Uses db.batch() for atomic transaction.
 * Returns cleanup info for index cleanup.
 */
export async function deleteUserCascade(
  db: AuthDb,
  userId: string,
): Promise<{
  email: string | null;
  phone: string | null;
  oauthAccounts: Array<{ provider: string; providerUserId: string }>;
}> {
  // First, gather data needed for external cleanup before deleting
  const user = await db.first<{ email: string | null; phone: string | null }>(
    `SELECT email, phone FROM _users WHERE id = ?`,
    [userId],
  );

  const oauthAccounts = await db.query<{ provider: string; providerUserId: string }>(
    `SELECT provider, providerUserId FROM _oauth_accounts WHERE userId = ?`,
    [userId],
  );

  // Batch delete all related records + user
  await db.batch([
    { sql: `DELETE FROM _email_tokens WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _sessions WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _oauth_accounts WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _mfa_recovery_codes WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _mfa_factors WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _webauthn_credentials WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _users WHERE id = ?`, params: [userId] },
  ]);

  return {
    email: user?.email ?? null,
    phone: user?.phone ?? null,
    oauthAccounts: oauthAccounts.map((a) => ({
      provider: a.provider,
      providerUserId: a.providerUserId,
    })),
  };
}

/**
 * List users with pagination.
 */
export async function listUsers(
  db: AuthDb,
  limit: number,
  offset: number,
): Promise<{ users: Record<string, unknown>[]; total: number }> {
  const countResult = await db.first<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM _users`,
  );
  const total = countResult?.cnt ?? 0;

  const users = await db.query(
    `SELECT * FROM _users ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  return { users, total };
}

/**
 * Batch get users by IDs.
 */
export async function batchGetUsers(
  db: AuthDb,
  userIds: string[],
): Promise<Record<string, unknown>[]> {
  if (userIds.length === 0) return [];

  const placeholders = userIds.map(() => '?').join(', ');
  return await db.query(
    `SELECT * FROM _users WHERE id IN (${placeholders})`,
    userIds,
  );
}

// ─── B. Session CRUD ───

/**
 * Create a new session.
 * INSERT + re-fetch.
 */
export async function createSession(
  db: AuthDb,
  input: CreateSessionInput,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO _sessions (id, userId, refreshToken, previousRefreshToken, rotatedAt, expiresAt, createdAt, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.userId,
      input.refreshToken,
      input.previousRefreshToken ?? null,
      input.rotatedAt ?? null,
      input.expiresAt,
      now,
      input.metadata ?? null,
    ],
  );

  // Re-fetch
  const session = await db.first(`SELECT * FROM _sessions WHERE id = ?`, [input.id]);
  return session as Record<string, unknown>;
}

/**
 * Get session by refresh token.
 * Also checks previousRefreshToken for grace period handling.
 * Returns { session, matchType: 'current' | 'previous' | null }
 */
export async function getSessionByRefreshToken(
  db: AuthDb,
  token: string,
  userId: string,
): Promise<{ session: Record<string, unknown>; matchType: 'current' | 'previous' } | null> {
  // Step 1: Check current refreshToken match
  const currentSession = await db.first(
    `SELECT * FROM _sessions WHERE refreshToken = ? AND userId = ?`,
    [token, userId],
  );

  if (currentSession) {
    return { session: currentSession, matchType: 'current' };
  }

  // Step 2: Check previousRefreshToken (Grace Period)
  const prevSession = await db.first(
    `SELECT * FROM _sessions WHERE previousRefreshToken = ? AND userId = ?`,
    [token, userId],
  );

  if (prevSession) {
    return { session: prevSession, matchType: 'previous' };
  }

  return null;
}

/**
 * Rotate refresh token on a session.
 * current -> previous, new -> current.
 *
 * Uses dialect-aware SQL for json_set (SQLite) vs jsonb_set (PostgreSQL).
 */
export async function rotateRefreshToken(
  db: AuthDb,
  sessionId: string,
  newRefreshToken: string,
  oldRefreshToken: string,
  newExpiresAt: string,
): Promise<void> {
  const now = new Date().toISOString();

  if (db.dialect === 'postgres') {
    // PostgreSQL: use jsonb_set + to_jsonb for JSONB column
    await db.run(
      `UPDATE _sessions SET "refreshToken" = ?, "previousRefreshToken" = ?, "rotatedAt" = ?, "expiresAt" = ?, metadata = jsonb_set(COALESCE(metadata::jsonb, '{}'), '{lastActiveAt}', to_jsonb(?::text))::text WHERE id = ?`,
      [newRefreshToken, oldRefreshToken, now, newExpiresAt, now, sessionId],
    );
  } else {
    // SQLite (D1): use json_set
    await db.run(
      `UPDATE _sessions SET refreshToken = ?, previousRefreshToken = ?, rotatedAt = ?, expiresAt = ?, metadata = json_set(COALESCE(metadata, '{}'), '$.lastActiveAt', ?) WHERE id = ?`,
      [newRefreshToken, oldRefreshToken, now, newExpiresAt, now, sessionId],
    );
  }
}

/**
 * Delete a single session by ID.
 */
export async function deleteSession(
  db: AuthDb,
  sessionId: string,
): Promise<void> {
  await db.run(`DELETE FROM _sessions WHERE id = ?`, [sessionId]);
}

/**
 * Delete a session by refresh token (signout).
 * Also checks previousRefreshToken for grace period cleanup.
 */
export async function deleteSessionByRefreshToken(
  db: AuthDb,
  refreshToken: string,
): Promise<void> {
  await db.batch([
    { sql: `DELETE FROM _sessions WHERE refreshToken = ?`, params: [refreshToken] },
    { sql: `DELETE FROM _sessions WHERE previousRefreshToken = ?`, params: [refreshToken] },
  ]);
}

/**
 * Find session userId by refresh token (for signout hooks).
 */
export async function findSessionUserByRefreshToken(
  db: AuthDb,
  refreshToken: string,
): Promise<string | null> {
  const session = await db.first<{ userId: string }>(
    `SELECT userId FROM _sessions WHERE refreshToken = ? OR previousRefreshToken = ?`,
    [refreshToken, refreshToken],
  );

  return session?.userId ?? null;
}

/**
 * Delete all sessions for a user.
 */
export async function deleteAllUserSessions(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.run(`DELETE FROM _sessions WHERE userId = ?`, [userId]);
}

/**
 * List sessions for a user.
 * Parses metadata JSON for ip, userAgent, lastActiveAt.
 */
export async function listUserSessions(
  db: AuthDb,
  userId: string,
): Promise<Array<{
  id: string;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
  lastActiveAt: string | null;
}>> {
  const results = await db.query<{ id: string; createdAt: string; expiresAt: string; metadata: string | null }>(
    `SELECT id, createdAt, expiresAt, metadata FROM _sessions WHERE userId = ? ORDER BY createdAt DESC`,
    [userId],
  );

  return results.map((s) => {
    const meta = s.metadata ? JSON.parse(s.metadata) : {};
    return {
      id: s.id,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      ip: meta.ip || null,
      userAgent: meta.userAgent || null,
      lastActiveAt: meta.lastActiveAt || null,
    };
  });
}

/**
 * Delete a session for a specific user (ownership check).
 */
export async function deleteSessionForUser(
  db: AuthDb,
  sessionId: string,
  userId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _sessions WHERE id = ? AND userId = ?`,
    [sessionId, userId],
  );
}

/**
 * Clean expired sessions.
 * Uses JS-computed timestamp (portable across D1/pg).
 */
export async function cleanExpiredSessions(
  db: AuthDb,
): Promise<void> {
  const now = new Date().toISOString();
  await db.run(`DELETE FROM _sessions WHERE expiresAt < ?`, [now]);
}

/**
 * Clean expired sessions for a specific user (lazy cleanup).
 */
export async function cleanExpiredSessionsForUser(
  db: AuthDb,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `DELETE FROM _sessions WHERE userId = ? AND expiresAt < ?`,
    [userId, now],
  );
}

/**
 * Evict oldest sessions if maxActiveSessions is exceeded.
 */
export async function evictOldestSessions(
  db: AuthDb,
  userId: string,
  maxSessions: number,
): Promise<void> {
  if (maxSessions <= 0) return;

  const countResult = await db.first<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM _sessions WHERE userId = ?`,
    [userId],
  );
  const currentCount = countResult?.cnt ?? 0;

  if (currentCount >= maxSessions) {
    const excess = currentCount - maxSessions + 1;
    await db.run(
      `DELETE FROM _sessions WHERE id IN (SELECT id FROM _sessions WHERE userId = ? ORDER BY createdAt ASC LIMIT ?)`,
      [userId, excess],
    );
  }
}

// ─── C. OAuth ───

/**
 * Create an OAuth account link.
 * Uses INSERT OR IGNORE (adapter converts to ON CONFLICT DO NOTHING for pg).
 */
export async function createOAuthAccount(
  db: AuthDb,
  input: CreateOAuthAccountInput,
): Promise<void> {
  const now = new Date().toISOString();

  await db.run(
    `INSERT OR IGNORE INTO _oauth_accounts (id, userId, provider, providerUserId, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [input.id, input.userId, input.provider, input.providerUserId, now],
  );
}

/**
 * Get OAuth account by provider + providerUserId.
 */
export async function getOAuthAccount(
  db: AuthDb,
  provider: string,
  providerUserId: string,
): Promise<Record<string, unknown> | null> {
  return await db.first(
    `SELECT * FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?`,
    [provider, providerUserId],
  );
}

/**
 * List OAuth accounts for a user.
 */
export async function listOAuthAccounts(
  db: AuthDb,
  userId: string,
): Promise<Record<string, unknown>[]> {
  return await db.query(
    `SELECT * FROM _oauth_accounts WHERE userId = ?`,
    [userId],
  );
}

/**
 * Delete an OAuth account by ID.
 */
export async function deleteOAuthAccount(
  db: AuthDb,
  id: string,
): Promise<void> {
  await db.run(`DELETE FROM _oauth_accounts WHERE id = ?`, [id]);
}

/**
 * Delete an OAuth account by provider + providerUserId.
 */
export async function deleteOAuthAccountByProvider(
  db: AuthDb,
  provider: string,
  providerUserId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?`,
    [provider, providerUserId],
  );
}

// ─── D. Email Tokens ───

/**
 * Create an email token (verify, password-reset, magic-link).
 */
export async function createEmailToken(
  db: AuthDb,
  input: CreateEmailTokenInput,
): Promise<void> {
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO _email_tokens (token, userId, type, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [input.token, input.userId, input.type, input.expiresAt, now],
  );
}

/**
 * Get email token by token string.
 * Returns null if not found or expired.
 */
export async function getEmailToken(
  db: AuthDb,
  token: string,
): Promise<Record<string, unknown> | null> {
  const row = await db.first(
    `SELECT * FROM _email_tokens WHERE token = ?`,
    [token],
  );

  if (!row) return null;

  // Check expiration
  if (new Date(row.expiresAt as string) < new Date()) {
    // Clean up expired token
    await db.run(`DELETE FROM _email_tokens WHERE token = ?`, [token]);
    return null;
  }

  return row;
}

/**
 * Get email token by token string and type.
 * Does NOT auto-delete on expiry (caller decides).
 */
export async function getEmailTokenByType(
  db: AuthDb,
  token: string,
  type: string,
): Promise<Record<string, unknown> | null> {
  return await db.first(
    `SELECT * FROM _email_tokens WHERE token = ? AND type = ?`,
    [token, type],
  );
}

/**
 * Delete a specific email token.
 */
export async function deleteEmailToken(
  db: AuthDb,
  token: string,
): Promise<void> {
  await db.run(`DELETE FROM _email_tokens WHERE token = ?`, [token]);
}

/**
 * Delete all email tokens for a user (by type).
 */
export async function deleteEmailTokensByUserAndType(
  db: AuthDb,
  userId: string,
  type: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _email_tokens WHERE userId = ? AND type = ?`,
    [userId, type],
  );
}

/**
 * Delete all email tokens for a user (all types).
 */
export async function deleteEmailTokensByUser(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.run(`DELETE FROM _email_tokens WHERE userId = ?`, [userId]);
}

// ─── E. MFA ───

/**
 * Create an MFA factor (unverified by default).
 * INSERT + re-fetch.
 */
export async function createMfaFactor(
  db: AuthDb,
  input: CreateMfaFactorInput,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO _mfa_factors (id, userId, type, secret, verified, createdAt)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [input.id, input.userId, input.type ?? 'totp', input.secret, now],
  );

  // Re-fetch
  const factor = await db.first(`SELECT * FROM _mfa_factors WHERE id = ?`, [input.id]);
  return factor as Record<string, unknown>;
}

/**
 * Get MFA factor by ID.
 */
export async function getMfaFactor(
  db: AuthDb,
  factorId: string,
): Promise<Record<string, unknown> | null> {
  return await db.first(`SELECT * FROM _mfa_factors WHERE id = ?`, [factorId]);
}

/**
 * Get MFA factor by ID and userId (ownership check).
 */
export async function getMfaFactorForUser(
  db: AuthDb,
  factorId: string,
  userId: string,
  type?: string,
): Promise<Record<string, unknown> | null> {
  let query = `SELECT * FROM _mfa_factors WHERE id = ? AND userId = ?`;
  const params: unknown[] = [factorId, userId];

  if (type) {
    query += ` AND type = ?`;
    params.push(type);
  }

  return await db.first(query, params);
}

/**
 * Get the first verified MFA factor for a user (by type).
 */
export async function getMfaFactorByUser(
  db: AuthDb,
  userId: string,
  type: string = 'totp',
  verifiedOnly: boolean = true,
): Promise<Record<string, unknown> | null> {
  const verifiedClause = verifiedOnly ? ` AND verified = 1` : '';
  return await db.first(
    `SELECT * FROM _mfa_factors WHERE userId = ? AND type = ?${verifiedClause} LIMIT 1`,
    [userId, type],
  );
}

/**
 * List MFA factors for a user (id, type, verified, createdAt).
 */
export async function listMfaFactors(
  db: AuthDb,
  userId: string,
): Promise<Array<{ id: string; type: string; verified: boolean; createdAt: string }>> {
  const results = await db.query<{ id: string; type: string; verified: number; createdAt: string }>(
    `SELECT id, type, verified, createdAt FROM _mfa_factors WHERE userId = ?`,
    [userId],
  );

  return results.map((f) => ({
    id: f.id,
    type: f.type,
    verified: f.verified === 1,
    createdAt: f.createdAt,
  }));
}

/**
 * List verified MFA factors (id + type only, for MFA check during signin).
 */
export async function listVerifiedMfaFactors(
  db: AuthDb,
  userId: string,
): Promise<Array<{ id: string; type: string }>> {
  return await db.query<{ id: string; type: string }>(
    `SELECT id, type FROM _mfa_factors WHERE userId = ? AND verified = 1`,
    [userId],
  );
}

/**
 * Verify (confirm) an MFA factor. UPDATE verified=1.
 */
export async function verifyMfaFactor(
  db: AuthDb,
  factorId: string,
): Promise<void> {
  await db.run(`UPDATE _mfa_factors SET verified = 1 WHERE id = ?`, [factorId]);
}

/**
 * Delete an MFA factor by ID.
 */
export async function deleteMfaFactor(
  db: AuthDb,
  factorId: string,
): Promise<void> {
  await db.run(`DELETE FROM _mfa_factors WHERE id = ?`, [factorId]);
}

/**
 * Delete all MFA factors for a user (used by disable MFA).
 */
export async function deleteAllMfaFactors(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.run(`DELETE FROM _mfa_factors WHERE userId = ?`, [userId]);
}

/**
 * Delete unverified (pending) MFA factors for a user by type.
 */
export async function deleteUnverifiedMfaFactors(
  db: AuthDb,
  userId: string,
  type: string = 'totp',
): Promise<void> {
  await db.run(
    `DELETE FROM _mfa_factors WHERE userId = ? AND type = ? AND verified = 0`,
    [userId, type],
  );
}

/**
 * Delete all MFA factors AND recovery codes for a user (atomic disable).
 * Uses db.batch() for atomic transaction.
 */
export async function disableMfa(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.batch([
    { sql: `DELETE FROM _mfa_factors WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _mfa_recovery_codes WHERE userId = ?`, params: [userId] },
  ]);
}

/**
 * Create recovery codes (batch insert).
 */
export async function createRecoveryCodes(
  db: AuthDb,
  userId: string,
  codes: Array<{ id: string; codeHash: string }>,
): Promise<void> {
  if (codes.length === 0) return;

  const now = new Date().toISOString();

  await db.batch(
    codes.map((code) => ({
      sql: `INSERT INTO _mfa_recovery_codes (id, userId, codeHash, used, createdAt)
         VALUES (?, ?, ?, 0, ?)`,
      params: [code.id, userId, code.codeHash, now],
    })),
  );
}

/**
 * List unused recovery codes for a user.
 */
export async function listRecoveryCodes(
  db: AuthDb,
  userId: string,
): Promise<Record<string, unknown>[]> {
  return await db.query(
    `SELECT * FROM _mfa_recovery_codes WHERE userId = ? AND used = 0`,
    [userId],
  );
}

/**
 * Mark a recovery code as used. UPDATE used=1.
 */
export async function useRecoveryCode(
  db: AuthDb,
  codeId: string,
): Promise<void> {
  await db.run(`UPDATE _mfa_recovery_codes SET used = 1 WHERE id = ?`, [codeId]);
}

// ─── F. WebAuthn ───

/**
 * Create a WebAuthn credential.
 * INSERT + re-fetch.
 */
export async function createWebAuthnCredential(
  db: AuthDb,
  input: CreateWebAuthnCredentialInput,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO _webauthn_credentials (id, userId, credentialId, credentialPublicKey, counter, transports, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.userId,
      input.credentialId,
      input.credentialPublicKey,
      input.counter ?? 0,
      input.transports ?? null,
      now,
    ],
  );

  // Re-fetch
  const cred = await db.first(`SELECT * FROM _webauthn_credentials WHERE id = ?`, [input.id]);
  return cred as Record<string, unknown>;
}

/**
 * Get WebAuthn credential by credentialId.
 */
export async function getWebAuthnCredential(
  db: AuthDb,
  credentialId: string,
): Promise<Record<string, unknown> | null> {
  return await db.first(
    `SELECT * FROM _webauthn_credentials WHERE credentialId = ?`,
    [credentialId],
  );
}

/**
 * List WebAuthn credentials for a user.
 */
export async function listWebAuthnCredentials(
  db: AuthDb,
  userId: string,
): Promise<Array<{
  id: string;
  credentialId: string;
  credentialPublicKey: string;
  counter: number;
  transports: string | null;
  createdAt: string;
}>> {
  return await db.query<{
    id: string;
    credentialId: string;
    credentialPublicKey: string;
    counter: number;
    transports: string | null;
    createdAt: string;
  }>(
    `SELECT id, credentialId, credentialPublicKey, counter, transports, createdAt FROM _webauthn_credentials WHERE userId = ?`,
    [userId],
  );
}

/**
 * Update WebAuthn credential counter.
 */
export async function updateWebAuthnCounter(
  db: AuthDb,
  credentialId: string,
  counter: number,
): Promise<void> {
  await db.run(
    `UPDATE _webauthn_credentials SET counter = ? WHERE credentialId = ?`,
    [counter, credentialId],
  );
}

/**
 * Delete a WebAuthn credential by credentialId + userId (ownership check).
 */
export async function deleteWebAuthnCredential(
  db: AuthDb,
  credentialId: string,
  userId?: string,
): Promise<void> {
  if (userId) {
    await db.run(
      `DELETE FROM _webauthn_credentials WHERE credentialId = ? AND userId = ?`,
      [credentialId, userId],
    );
  } else {
    await db.run(
      `DELETE FROM _webauthn_credentials WHERE credentialId = ?`,
      [credentialId],
    );
  }
}

// ─── G. Cleanup ───

/**
 * Clean stale anonymous accounts older than retentionDays.
 * Finds anonymous users, batch deletes sessions + users.
 * Uses JS-computed cutoff date (portable across D1/pg).
 */
export async function cleanStaleAnonymousAccounts(
  db: AuthDb,
  retentionDays: number,
): Promise<string[]> {
  // Compute cutoff date in JS (portable)
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();

  // Find stale anonymous user IDs
  const staleUsers = await db.query<{ id: string }>(
    `SELECT id FROM _users WHERE isAnonymous = 1 AND updatedAt < ?`,
    [cutoff],
  );

  if (staleUsers.length === 0) return [];

  const userIds = staleUsers.map((u) => u.id);

  // Batch delete in chunks of 50
  for (let i = 0; i < userIds.length; i += 50) {
    const chunk = userIds.slice(i, i + 50);
    const stmts: { sql: string; params: unknown[] }[] = [];

    for (const uid of chunk) {
      stmts.push({ sql: `DELETE FROM _sessions WHERE userId = ?`, params: [uid] });
      stmts.push({ sql: `DELETE FROM _email_tokens WHERE userId = ?`, params: [uid] });
      stmts.push({ sql: `DELETE FROM _oauth_accounts WHERE userId = ?`, params: [uid] });
      stmts.push({ sql: `DELETE FROM _mfa_recovery_codes WHERE userId = ?`, params: [uid] });
      stmts.push({ sql: `DELETE FROM _mfa_factors WHERE userId = ?`, params: [uid] });
      stmts.push({ sql: `DELETE FROM _webauthn_credentials WHERE userId = ?`, params: [uid] });
      stmts.push({ sql: `DELETE FROM _users WHERE id = ?`, params: [uid] });
    }

    await db.batch(stmts);
  }

  return userIds;
}

// ─── H. Sanitization ───

/**
 * Remove sensitive fields from user record for client response.
 * - Strips passwordHash
 * - Strips appMetadata (unless includeAppMetadata is true)
 * - Parses JSON TEXT fields (customClaims, metadata, appMetadata)
 * - Converts INTEGER booleans (0/1) to true/false
 */
export function sanitizeUser(
  user: Record<string, unknown>,
  opts?: { includeAppMetadata?: boolean },
): Record<string, unknown> {
  const {
    passwordHash: _passwordHash,
    appMetadata: rawAppMetadata,
    ...safe
  } = user;

  // Parse customClaims JSON
  if (safe.customClaims && typeof safe.customClaims === 'string') {
    try {
      safe.customClaims = JSON.parse(safe.customClaims as string);
    } catch {
      safe.customClaims = null;
    }
  }

  // Parse metadata JSON
  if (safe.metadata && typeof safe.metadata === 'string') {
    try {
      safe.metadata = JSON.parse(safe.metadata as string);
    } catch {
      safe.metadata = null;
    }
  }

  // Include appMetadata only for admin requests
  if (opts?.includeAppMetadata && rawAppMetadata) {
    try {
      safe.appMetadata = typeof rawAppMetadata === 'string'
        ? JSON.parse(rawAppMetadata as string)
        : rawAppMetadata;
    } catch {
      safe.appMetadata = null;
    }
  }

  // Convert isAnonymous from INTEGER (0/1) to boolean
  if (typeof safe.isAnonymous === 'number') {
    safe.isAnonymous = safe.isAnonymous === 1;
  }

  // Convert verified from INTEGER (0/1) to boolean
  if (typeof safe.verified === 'number') {
    safe.verified = safe.verified === 1;
  }

  // Convert phoneVerified from INTEGER (0/1) to boolean
  if (typeof safe.phoneVerified === 'number') {
    safe.phoneVerified = safe.phoneVerified === 1;
  }

  // Convert disabled from INTEGER (0/1) to boolean
  if (typeof safe.disabled === 'number') {
    safe.disabled = safe.disabled === 1;
  }

  return safe;
}

/**
 * Build public user data for _users_public sync.
 * Only exposes email if emailVisibility is 'public'.
 */
export function buildPublicUserData(user: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {
    displayName: user.displayName ?? null,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role ?? 'user',
    isAnonymous: user.isAnonymous ?? 0,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  // Email only if emailVisibility is 'public'
  if (user.emailVisibility === 'public' && user.email) {
    data.email = user.email;
  } else {
    data.email = null;
  }

  return data;
}
