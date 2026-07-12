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
import { authSecretLookupKeys, hashAuthSecret } from './auth-token.js';

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

export interface FinalizeOAuthIdentityInput {
  oauthAccount: CreateOAuthAccountInput;
  oauthReservationId: string;
  emailReservation?: {
    email: string;
    userId: string;
    reservationId: string;
  };
  user:
    | { mode: 'create'; input: CreateUserInput }
    | { mode: 'update'; userId: string; updates: UpdateUserInput; expectedAuthRevision: number };
  deleteAnonymousIndex?: boolean;
  revokeSessionsOnUpgrade?: boolean;
}

export interface FinalizeOAuthIdentityResult {
  /** True only when this committed transaction inserted the user row. */
  created: boolean;
}

export interface DeleteOAuthIdentityInput {
  accountId: string;
  userId: string;
  provider: string;
  providerUserId: string;
  remainingMethodGuard?: RemainingMethodGuard;
}

export interface RemainingMethodGuard {
  independentMethodCount: number;
  includePasskeys: boolean;
  expectedAuthRevision: number;
}

export interface FinalizeContactIdentityInput {
  userId: string;
  expectedAuthRevision: number;
  value: string;
  reservationId: string;
  updates: UpdateUserInput;
  previousValue?: string | null;
  deleteAnonymousIndex?: boolean;
  revokeSessionsOnUpgrade?: boolean;
}

export interface ManagedContactChange {
  kind: 'email' | 'phone';
  previousValue: string | null;
  nextValue: string | null;
  reservationId?: string;
}

export interface FinalizeManagedUserUpdateInput {
  userId: string;
  expectedAuthRevision: number;
  updates: UpdateUserInput;
  contacts: ManagedContactChange[];
}

export interface FinalizeManagedUserCreationInput {
  user: CreateUserInput;
  emailReservationId: string;
}

export interface CreateEmailTokenInput {
  token: string;
  userId: string;
  type: string;
  expiresAt: string;
}

export interface IssueAuthChallengeInput {
  kind: string;
  lookupKey: string;
  userId?: string | null;
  subject?: string | null;
  secretHash?: string | null;
  payload?: string | null;
  ttlSeconds?: number;
  maxAttempts?: number;
  replaceUserKind?: boolean;
}

export interface AuthChallengeRecord {
  key: string;
  kind: string;
  userId: string | null;
  subject: string | null;
  secretHash: string | null;
  payload: string | null;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  createdAt: string;
}

export interface FinalizeAnonymousPhoneUpgradeInput {
  userId: string;
  expectedAuthRevision: number;
  phone: string;
  previousPhone?: string | null;
  reservationId: string;
  challengeKey: string;
  challengeSecretHash: string;
  encryptedCompletion: string;
  completionExpiresAt: string;
  replacementSession: CreateSessionInput;
}

export interface FinalizeAnonymousEmailUpgradeInput {
  userId: string;
  initiatingSessionId: string;
  expectedAuthRevision: number;
  email: string;
  previousEmail?: string | null;
  passwordHash: string;
  reservationId: string;
  passwordProof: string;
  encryptedCompletion: string;
  completionExpiresAt: string;
  replacementSession: CreateSessionInput;
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

export interface CreatePasskeyIdentityInput extends CreateWebAuthnCredentialInput {
  userId: string;
  registrationChallenge?: string;
}

export type WebAuthnChallengeKind = 'registration' | 'authentication';

export interface WebAuthnChallengeRecord {
  challenge: string;
  kind: WebAuthnChallengeKind;
  userId: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface CompletePasskeyAuthenticationInput {
  challenge: string;
  credentialId: string;
  userId: string;
  expectedCounter: number;
  newCounter: number;
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
    'customClaims', 'phone', 'phoneVerified', 'disabled', 'lastSignedInAt',
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
      sets.push('role = ?');
      params.push(normalizedRole);
      continue;
    }

    // JSON fields: serialize to string
    if ((key === 'customClaims' || key === 'metadata' || key === 'appMetadata') && value !== null && typeof value === 'object') {
      sets.push(`${key} = ?`);
      params.push(JSON.stringify(value));
    }
    // Boolean fields: convert to integer
    else if ((key === 'verified' || key === 'isAnonymous' || key === 'phoneVerified' || key === 'disabled') && typeof value === 'boolean') {
      sets.push(`${key} = ?`);
      params.push(value ? 1 : 0);
    }
    else {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return null;

  const now = new Date().toISOString();
  sets.push('updatedAt = ?');
  params.push(now);
  sets.push('authRevision = COALESCE(authRevision, 0) + 1');
  sets.push('authMutationId = ?');
  params.push(crypto.randomUUID());
  params.push(userId);

  await db.run(
    `UPDATE _users SET ${sets.join(', ')} WHERE id = ?`,
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
 * Roll back a user that never completed its initial identity/session flow.
 * Every delete is owner-scoped and runs in one transaction, so a stale loser
 * cannot remove a newer winner's email, phone, OAuth, or passkey reservation.
 */
export async function deleteProvisionalUser(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.batchWithLock(`auth-user:${userId}`, [
    { sql: `DELETE FROM _email_tokens WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _sessions WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _oauth_accounts WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _mfa_recovery_codes WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _mfa_factors WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _webauthn_credentials WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _push_devices WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _email_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _oauth_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _anon_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _phone_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _passkey_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _users_public WHERE id = ?`, params: [userId] },
    { sql: `DELETE FROM _users WHERE id = ?`, params: [userId] },
  ]);
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
  maxSessions: number = 0,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();

  await db.createSessionWithLimit({
    id: input.id,
    userId: input.userId,
    refreshToken: input.refreshToken,
    previousRefreshToken: input.previousRefreshToken ?? null,
    rotatedAt: input.rotatedAt ?? null,
    expiresAt: input.expiresAt,
    createdAt: now,
    metadata: input.metadata ?? null,
  }, maxSessions);

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
): Promise<boolean> {
  const now = new Date().toISOString();
  return db.compareAndSwapUserSession({
    sessionId,
    currentRefreshToken: oldRefreshToken,
    nextRefreshToken: newRefreshToken,
    expiresAt: newExpiresAt,
    rotatedAt: now,
  });
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
 * The provider identity is globally unique. An idempotent retry for the same
 * user succeeds; an attempt by another user fails deterministically.
 */
export async function createOAuthAccount(
  db: AuthDb,
  input: CreateOAuthAccountInput,
): Promise<void> {
  const now = new Date().toISOString();

  await db.batchWithLock(`oauth-account:${input.provider}:${input.providerUserId}`, [{
    sql: `INSERT INTO _oauth_accounts (id, userId, provider, providerUserId, createdAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (provider, providerUserId) DO NOTHING`,
    params: [input.id, input.userId, input.provider, input.providerUserId, now],
  }]);

  const existing = await db.first<{ userId: string }>(
    `SELECT userId FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?`,
    [input.provider, input.providerUserId],
  );
  if (existing?.userId === input.userId) return;
  throw new Error('OAUTH_ACCOUNT_CONFLICT');
}

/**
 * Finalize a reserved OAuth identity as one database transaction.
 *
 * Every mutation is guarded by the pending reservation owner. The strict
 * account insert and owner-bound confirmations run in the same D1 batch / PG
 * transaction, so a uniqueness or user mutation failure rolls back the whole
 * identity transition instead of requiring destructive compensation.
 */
export async function finalizeOAuthIdentity(
  db: AuthDb,
  input: FinalizeOAuthIdentityInput,
): Promise<FinalizeOAuthIdentityResult> {
  const { oauthAccount, oauthReservationId, emailReservation } = input;
  const userId = input.user.mode === 'create' ? input.user.input.userId : input.user.userId;
  if (oauthAccount.userId !== userId || (emailReservation && emailReservation.userId !== userId)) {
    throw new Error('OAUTH_RESERVATION_OWNER_MISMATCH');
  }

  const oauthGuard = `EXISTS (
    SELECT 1 FROM _oauth_index
    WHERE provider = ? AND providerUserId = ? AND userId = ?
      AND status = 'pending' AND reservationId = ?
  )`;
  const oauthGuardParams = [
    oauthAccount.provider,
    oauthAccount.providerUserId,
    userId,
    oauthReservationId,
  ];
  const emailGuard = emailReservation
    ? ` AND EXISTS (
        SELECT 1 FROM _email_index
        WHERE email = ? AND userId = ? AND status = 'pending' AND reservationId = ?
      )`
    : '';
  const reservationGuardParams = emailReservation
    ? [...oauthGuardParams, emailReservation.email, userId, emailReservation.reservationId]
    : oauthGuardParams;
  const compatibleAccountGuard = ` AND (
    NOT EXISTS (
      SELECT 1 FROM _oauth_accounts WHERE provider = ? AND providerUserId = ?
    ) OR EXISTS (
      SELECT 1 FROM _oauth_accounts
      WHERE provider = ? AND providerUserId = ? AND userId = ?
    )
  )`;
  const guardParams = [
    ...reservationGuardParams,
    oauthAccount.provider,
    oauthAccount.providerUserId,
    oauthAccount.provider,
    oauthAccount.providerUserId,
    userId,
  ];
  const guardedWhere = `${oauthGuard}${emailGuard}${compatibleAccountGuard}`;
  const now = new Date().toISOString();
  const mutationId = input.user.mode === 'update' ? crypto.randomUUID() : null;
  const statements: { sql: string; params: unknown[] }[] = [];

  if (input.user.mode === 'create') {
    const create = input.user.input;
    statements.push({
      sql: `INSERT INTO _users
        (id, email, passwordHash, displayName, avatarUrl, emailVisibility, role,
         verified, isAnonymous, locale, metadata, appMetadata, createdAt, updatedAt)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?
        WHERE ${guardedWhere}`,
      params: [
        create.userId,
        create.email,
        create.passwordHash,
        create.displayName ?? null,
        create.avatarUrl ?? null,
        create.emailVisibility ?? 'private',
        create.role ?? 'user',
        create.verified ? 1 : 0,
        create.locale ?? 'en',
        create.metadata ? JSON.stringify(create.metadata) : null,
        create.appMetadata ? JSON.stringify(create.appMetadata) : null,
        now,
        now,
        ...guardParams,
      ],
    });
  } else {
    const sets: string[] = [];
    const params: unknown[] = [];
    const allowed = new Set([
      'email', 'passwordHash', 'displayName', 'avatarUrl', 'emailVisibility',
      'role', 'status', 'verified', 'isAnonymous', 'locale', 'metadata', 'appMetadata',
      'customClaims', 'phone', 'phoneVerified', 'disabled', 'lastSignedInAt',
    ]);
    for (const [key, rawValue] of Object.entries(input.user.updates)) {
      if (!allowed.has(key) || typeof rawValue === 'symbol' || typeof rawValue === 'function') continue;
      if (key === 'status' && !['active', 'suspended', 'banned', 'disabled'].includes(String(rawValue))) continue;
      if (key === 'emailVisibility' && !['public', 'private'].includes(String(rawValue))) continue;
      let value: unknown = rawValue;
      if (key === 'role') {
        if (typeof rawValue !== 'string' || rawValue.trim().length === 0) continue;
        value = rawValue.trim();
      } else if (['customClaims', 'metadata', 'appMetadata'].includes(key) && rawValue !== null && typeof rawValue === 'object') {
        value = JSON.stringify(rawValue);
      } else if (['verified', 'isAnonymous', 'phoneVerified', 'disabled'].includes(key) && typeof rawValue === 'boolean') {
        value = rawValue ? 1 : 0;
      }
      sets.push(`${key} = ?`);
      params.push(value);
    }
    sets.push('updatedAt = ?');
    params.push(now);
    sets.push('authRevision = authRevision + 1');
    sets.push('authMutationId = ?');
    params.push(mutationId);
    statements.push({
      sql: `UPDATE _users SET ${sets.join(', ')}
            WHERE id = ? AND authRevision = ? AND ${guardedWhere}`,
      params: [...params, userId, input.user.expectedAuthRevision, ...guardParams],
    });
  }

  const finalAuthRevision = input.user.mode === 'update'
    ? input.user.expectedAuthRevision + 1
    : 0;
  const userMutationSql = input.user.mode === 'update' ? ' AND authMutationId = ?' : '';
  const userStateParams = [
    userId,
    finalAuthRevision,
    ...(input.user.mode === 'update' ? [mutationId] : []),
  ];
  const accountExistsGuard = `EXISTS (
    SELECT 1 FROM _users WHERE id = ? AND authRevision = ?${userMutationSql}
  ) AND ${guardedWhere}`;
  statements.push({
    sql: `INSERT INTO _oauth_accounts (id, userId, provider, providerUserId, createdAt)
          SELECT ?, ?, ?, ?, ? WHERE ${accountExistsGuard}
          ON CONFLICT (provider, providerUserId) DO NOTHING`,
    params: [
      oauthAccount.id,
      userId,
      oauthAccount.provider,
      oauthAccount.providerUserId,
      now,
      ...userStateParams,
      ...guardParams,
    ],
  });

  const exactAccountGuard = `EXISTS (
    SELECT 1 FROM _oauth_accounts
    WHERE userId = ? AND provider = ? AND providerUserId = ?
  )`;
  const exactAccountParams = [userId, oauthAccount.provider, oauthAccount.providerUserId];
  statements.push({
    sql: `UPDATE _oauth_index SET status = 'confirmed', reservationId = NULL
          WHERE provider = ? AND providerUserId = ? AND userId = ?
            AND status = 'pending' AND reservationId = ? AND ${exactAccountGuard}`,
    params: [
      oauthAccount.provider,
      oauthAccount.providerUserId,
      userId,
      oauthReservationId,
      ...exactAccountParams,
    ],
  });

  if (emailReservation) {
    statements.push({
      sql: `UPDATE _email_index SET status = 'confirmed', reservationId = NULL
            WHERE email = ? AND userId = ? AND status = 'pending' AND reservationId = ?
              AND ${exactAccountGuard}`,
      params: [emailReservation.email, userId, emailReservation.reservationId, ...exactAccountParams],
    });
  }

  if (input.deleteAnonymousIndex) {
    statements.push({
      sql: `DELETE FROM _anon_index WHERE userId = ? AND EXISTS (
              SELECT 1 FROM _oauth_index
              WHERE provider = ? AND providerUserId = ? AND userId = ? AND status = 'confirmed'
            )`,
      params: [userId, oauthAccount.provider, oauthAccount.providerUserId, userId],
    });
  }

  if (input.revokeSessionsOnUpgrade) {
    statements.push({
      sql: `DELETE FROM _sessions WHERE userId = ?
            AND EXISTS (
              SELECT 1 FROM _oauth_index
              WHERE provider = ? AND providerUserId = ? AND userId = ? AND status = 'confirmed'
            ) AND EXISTS (
              SELECT 1 FROM _users
              WHERE id = ? AND authRevision = ?${userMutationSql} AND isAnonymous = 0
            )`,
      params: [
        userId,
        oauthAccount.provider,
        oauthAccount.providerUserId,
        userId,
        ...userStateParams,
      ],
    });
  }

  const completionGuard = `
    EXISTS (
      SELECT 1 FROM _oauth_accounts
      WHERE userId = ? AND provider = ? AND providerUserId = ?
    ) AND EXISTS (
      SELECT 1 FROM _oauth_index
      WHERE userId = ? AND provider = ? AND providerUserId = ? AND status = 'confirmed'
    ) AND EXISTS (
      SELECT 1 FROM _users WHERE id = ? AND authRevision = ?${userMutationSql}
    )${emailReservation ? ` AND EXISTS (
      SELECT 1 FROM _email_index WHERE email = ? AND userId = ? AND status = 'confirmed'
    )` : ''}`;
  statements.push({
    // _meta.value is NOT NULL in both D1 and PG. If any postcondition is
    // missing, this deliberate constraint violation aborts the transaction.
    sql: `INSERT INTO _meta (key, value)
          SELECT ?, NULL WHERE NOT (${completionGuard})`,
    params: [
      `oauth-finalization-guard:${crypto.randomUUID()}`,
      userId,
      oauthAccount.provider,
      oauthAccount.providerUserId,
      userId,
      oauthAccount.provider,
      oauthAccount.providerUserId,
      ...userStateParams,
      ...(emailReservation ? [emailReservation.email, userId] : []),
    ],
  });

  try {
    await db.batchWithLock(
      [
        `auth-user:${userId}`,
        `oauth-account:${oauthAccount.provider}:${oauthAccount.providerUserId}`,
      ],
      statements,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error('OAUTH_FINALIZATION_CONFLICT');
    }
    throw error;
  }
  // Return the classification only after the guarded transaction commits.
  // Callers must not infer lifecycle events from a pre-transaction lookup.
  return { created: input.user.mode === 'create' };
}

/** Atomically unlink an OAuth account and its matching owner index row. */
export async function deleteOAuthIdentity(
  db: AuthDb,
  input: DeleteOAuthIdentityInput,
): Promise<void> {
  const statements: { sql: string; params: unknown[] }[] = [];
  if (input.remainingMethodGuard) {
    const passkeyCountSql = input.remainingMethodGuard.includePasskeys
      ? `(SELECT COUNT(*)
          FROM _webauthn_credentials c
          JOIN _passkey_index i ON i.credentialId = c.credentialId
          WHERE c.userId = ? AND i.userId = c.userId)`
      : '0';
    statements.push({
      sql: `INSERT INTO _meta (key, value)
            SELECT ?, NULL WHERE
              NOT EXISTS (
                SELECT 1 FROM _users WHERE id = ? AND authRevision = ?
              ) OR (
                ? + ${passkeyCountSql} +
                (SELECT COUNT(*)
                 FROM _oauth_accounts a
                 JOIN _oauth_index i
                   ON i.provider = a.provider AND i.providerUserId = a.providerUserId
                 WHERE a.userId = ? AND i.userId = a.userId AND i.status = 'confirmed')
              ) <= 1`,
      params: [
        `oauth-delete-guard:${crypto.randomUUID()}`,
        input.userId,
        input.remainingMethodGuard.expectedAuthRevision,
        input.remainingMethodGuard.independentMethodCount,
        ...(input.remainingMethodGuard.includePasskeys ? [input.userId] : []),
        input.userId,
      ],
    });
  }
  statements.push(
      {
        sql: `DELETE FROM _oauth_accounts
              WHERE id = ? AND userId = ? AND provider = ? AND providerUserId = ?`,
        params: [input.accountId, input.userId, input.provider, input.providerUserId],
      },
      {
        sql: `DELETE FROM _oauth_index
              WHERE provider = ? AND providerUserId = ? AND userId = ?`,
        params: [input.provider, input.providerUserId, input.userId],
      },
  );
  try {
    await db.batchWithLock(
      [
        `auth-user:${input.userId}`,
        `oauth-account:${input.provider}:${input.providerUserId}`,
      ],
      statements,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error('LAST_SIGN_IN_METHOD');
    }
    throw error;
  }
}

async function finalizeContactIdentity(
  db: AuthDb,
  kind: 'email' | 'phone',
  input: FinalizeContactIdentityInput,
): Promise<void> {
  const table = kind === 'email' ? '_email_index' : '_phone_index';
  const column = kind;
  const now = new Date().toISOString();
  const mutationId = crypto.randomUUID();
  const sets: string[] = [];
  const updateParams: unknown[] = [];
  const allowed = new Set([
    'email', 'passwordHash', 'displayName', 'avatarUrl', 'emailVisibility',
    'role', 'status', 'verified', 'isAnonymous', 'locale', 'metadata', 'appMetadata',
    'customClaims', 'phone', 'phoneVerified', 'disabled', 'lastSignedInAt',
  ]);
  for (const [key, rawValue] of Object.entries(input.updates)) {
    if (!allowed.has(key) || typeof rawValue === 'symbol' || typeof rawValue === 'function') continue;
    if (key === 'status' && !['active', 'suspended', 'banned', 'disabled'].includes(String(rawValue))) continue;
    if (key === 'emailVisibility' && !['public', 'private'].includes(String(rawValue))) continue;
    let value: unknown = rawValue;
    if (key === 'role') {
      if (typeof rawValue !== 'string' || rawValue.trim().length === 0) continue;
      value = rawValue.trim();
    } else if (['customClaims', 'metadata', 'appMetadata'].includes(key) && rawValue !== null && typeof rawValue === 'object') {
      value = JSON.stringify(rawValue);
    } else if (['verified', 'isAnonymous', 'phoneVerified', 'disabled'].includes(key) && typeof rawValue === 'boolean') {
      value = rawValue ? 1 : 0;
    }
    sets.push(`${key} = ?`);
    updateParams.push(value);
  }
  sets.push('updatedAt = ?');
  updateParams.push(now);
  sets.push('authRevision = authRevision + 1');
  sets.push('authMutationId = ?');
  updateParams.push(mutationId);

  const ownerGuard = `EXISTS (
    SELECT 1 FROM ${table}
    WHERE ${column} = ? AND userId = ? AND status = 'pending' AND reservationId = ?
  )`;
  const ownerParams = [input.value, input.userId, input.reservationId];
  const statements: { sql: string; params: unknown[] }[] = [
    {
      sql: `UPDATE _users SET ${sets.join(', ')}
            WHERE id = ? AND authRevision = ? AND ${ownerGuard}`,
      params: [...updateParams, input.userId, input.expectedAuthRevision, ...ownerParams],
    },
    {
      sql: `UPDATE ${table} SET status = 'confirmed', reservationId = NULL
            WHERE ${column} = ? AND userId = ? AND status = 'pending' AND reservationId = ?
              AND EXISTS (
                SELECT 1 FROM _users
                WHERE id = ? AND authRevision = ? AND authMutationId = ?
              )`,
      params: [
        input.value,
        input.userId,
        input.reservationId,
        input.userId,
        input.expectedAuthRevision + 1,
        mutationId,
      ],
    },
  ];
  if (input.previousValue && input.previousValue !== input.value) {
    statements.push({
      sql: `DELETE FROM ${table}
            WHERE ${column} = ? AND userId = ? AND EXISTS (
              SELECT 1 FROM ${table}
              WHERE ${column} = ? AND userId = ? AND status = 'confirmed'
            )`,
      params: [input.previousValue, input.userId, input.value, input.userId],
    });
  }
  if (input.deleteAnonymousIndex) {
    statements.push({
      sql: `DELETE FROM _anon_index WHERE userId = ? AND EXISTS (
              SELECT 1 FROM ${table}
              WHERE ${column} = ? AND userId = ? AND status = 'confirmed'
            )`,
      params: [input.userId, input.value, input.userId],
    });
  }
  if (input.revokeSessionsOnUpgrade) {
    statements.push({
      sql: `DELETE FROM _sessions WHERE userId = ?
            AND EXISTS (
              SELECT 1 FROM ${table}
              WHERE ${column} = ? AND userId = ? AND status = 'confirmed'
            ) AND EXISTS (
              SELECT 1 FROM _users
              WHERE id = ? AND authRevision = ? AND authMutationId = ? AND isAnonymous = 0
            )`,
      params: [
        input.userId,
        input.value,
        input.userId,
        input.userId,
        input.expectedAuthRevision + 1,
        mutationId,
      ],
    });
  }
  statements.push({
    sql: `INSERT INTO _meta (key, value)
          SELECT ?, NULL WHERE NOT (
            EXISTS (
              SELECT 1 FROM _users
              WHERE id = ? AND authRevision = ? AND authMutationId = ?
            ) AND
            EXISTS (
              SELECT 1 FROM ${table}
              WHERE ${column} = ? AND userId = ? AND status = 'confirmed'
            )
          )`,
    params: [
      `${kind}-finalization-guard:${crypto.randomUUID()}`,
      input.userId,
      input.expectedAuthRevision + 1,
      mutationId,
      input.value,
      input.userId,
    ],
  });

  try {
    await db.batchWithLock(
      [`auth-user:${input.userId}`, `${kind}:${input.value}`],
      statements,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error(`${kind.toUpperCase()}_FINALIZATION_CONFLICT`);
    }
    throw error;
  }
}

export function finalizeEmailIdentity(
  db: AuthDb,
  input: FinalizeContactIdentityInput,
): Promise<void> {
  return finalizeContactIdentity(db, 'email', input);
}

export function finalizePhoneIdentity(
  db: AuthDb,
  input: FinalizeContactIdentityInput,
): Promise<void> {
  return finalizeContactIdentity(db, 'phone', input);
}

/**
 * Complete an anonymous email/password upgrade exactly once. The password is
 * represented in the completion checkpoint only by a server-keyed proof; the
 * exact replacement token pair remains inside the encrypted payload. Identity
 * confirmation, anonymous-index deletion, session replacement, and checkpoint
 * creation are committed in one database transaction.
 */
export async function finalizeAnonymousEmailUpgrade(
  db: AuthDb,
  input: FinalizeAnonymousEmailUpgradeInput,
): Promise<void> {
  if (
    !input.userId || input.userId.length > 512 ||
    !input.initiatingSessionId || input.initiatingSessionId.length > 512 ||
    !Number.isInteger(input.expectedAuthRevision) || input.expectedAuthRevision < 0 ||
    !input.email || input.email.length > 320 || input.email !== input.email.trim().toLowerCase() ||
    (input.previousEmail !== undefined && input.previousEmail !== null && input.previousEmail.length > 320) ||
    !input.passwordHash || input.passwordHash.length > 1_024 ||
    !/^hmac-sha256:[0-9a-f]{64}$/.test(input.passwordProof) ||
    !input.reservationId || input.reservationId.length > 512 ||
    !input.encryptedCompletion || input.encryptedCompletion.length > 16_384
  ) {
    throw new Error('EMAIL_UPGRADE_COMPLETION_INVALID');
  }

  const nowDate = new Date();
  const nowMs = nowDate.getTime();
  const completionExpiryMs = new Date(input.completionExpiresAt).getTime();
  if (
    !Number.isFinite(completionExpiryMs) ||
    completionExpiryMs <= nowMs ||
    completionExpiryMs > nowMs + 10 * 60 * 1_000
  ) {
    throw new Error('EMAIL_UPGRADE_COMPLETION_EXPIRY_INVALID');
  }

  const session = input.replacementSession;
  const sessionExpiryMs = new Date(session.expiresAt).getTime();
  if (
    session.userId !== input.userId ||
    !session.id || session.id.length > 512 ||
    !session.refreshToken || session.refreshToken.length > 8_192 ||
    !Number.isFinite(sessionExpiryMs) || sessionExpiryMs <= nowMs ||
    (session.metadata?.length ?? 0) > 16_384
  ) {
    throw new Error('EMAIL_UPGRADE_SESSION_INVALID');
  }

  const checkpointKey = await authChallengeKey(
    'email-link-completion',
    `${input.userId}\u0000${input.email}`,
  );
  const now = nowDate.toISOString();
  const attemptId = crypto.randomUUID();
  const finalRevision = input.expectedAuthRevision + 1;
  const checkpointGuard = `EXISTS (
    SELECT 1 FROM _auth_challenges
    WHERE key = ? AND kind = 'email-link-completion'
      AND userId = ? AND subject = ? AND secretHash = ?
      AND consumptionId = ? AND payload = ? AND consumedAt IS NOT NULL
      AND expiresAt > ?
  )`;
  const checkpointGuardParams = [
    checkpointKey,
    input.userId,
    input.email,
    input.passwordProof,
    attemptId,
    input.encryptedCompletion,
    now,
  ];
  const userGuard = `EXISTS (
    SELECT 1 FROM _users
    WHERE id = ? AND authRevision = ? AND authMutationId = ?
      AND isAnonymous = 0 AND COALESCE(disabled, 0) = 0
      AND email = ? AND passwordHash = ?
  )`;
  const userGuardParams = [
    input.userId,
    finalRevision,
    attemptId,
    input.email,
    input.passwordHash,
  ];
  const pendingEmailGuard = `EXISTS (
    SELECT 1 FROM _email_index
    WHERE email = ? AND userId = ? AND status = 'pending' AND reservationId = ?
  )`;
  const pendingEmailGuardParams = [input.email, input.userId, input.reservationId];
  const initiatingSessionGuard = `EXISTS (
    SELECT 1 FROM _sessions
    WHERE id = ? AND userId = ? AND expiresAt > ?
  )`;
  const initiatingSessionGuardParams = [input.initiatingSessionId, input.userId, now];

  const statements: { sql: string; params: unknown[] }[] = [
    {
      sql: `DELETE FROM _auth_challenges WHERE expiresAt <= ?`,
      params: [now],
    },
    {
      // This no-op update acquires the PostgreSQL row lock before any identity
      // mutation. A concurrent sign-out either wins first (and this upgrade
      // fails) or waits until the atomic replacement has committed.
      sql: `UPDATE _sessions SET metadata = metadata
            WHERE id = ? AND userId = ? AND expiresAt > ?`,
      params: initiatingSessionGuardParams,
    },
    {
      sql: `INSERT INTO _auth_challenges
              (key, kind, userId, subject, secretHash, payload, attempts,
               maxAttempts, expiresAt, consumedAt, consumptionId, createdAt)
            SELECT ?, 'email-link-completion', ?, ?, ?, ?, 0, 1, ?, ?, ?, ?
            WHERE ${pendingEmailGuard}
              AND EXISTS (
                SELECT 1 FROM _users
                WHERE id = ? AND authRevision = ? AND isAnonymous = 1
                  AND COALESCE(disabled, 0) = 0
              )
              AND ${initiatingSessionGuard}
              AND (SELECT COUNT(*) FROM _auth_challenges) < 20000
            ON CONFLICT (key) DO NOTHING`,
      params: [
        checkpointKey,
        input.userId,
        input.email,
        input.passwordProof,
        input.encryptedCompletion,
        input.completionExpiresAt,
        now,
        attemptId,
        now,
        ...pendingEmailGuardParams,
        input.userId,
        input.expectedAuthRevision,
        ...initiatingSessionGuardParams,
      ],
    },
    {
      sql: `UPDATE _users
            SET email = ?, passwordHash = ?, isAnonymous = 0,
                lastSignedInAt = ?, updatedAt = ?,
                authRevision = authRevision + 1, authMutationId = ?
            WHERE id = ? AND authRevision = ? AND isAnonymous = 1
              AND COALESCE(disabled, 0) = 0
              AND ${checkpointGuard}`,
      params: [
        input.email,
        input.passwordHash,
        now,
        now,
        attemptId,
        input.userId,
        input.expectedAuthRevision,
        ...checkpointGuardParams,
      ],
    },
    {
      sql: `UPDATE _email_index SET status = 'confirmed', reservationId = NULL
            WHERE email = ? AND userId = ? AND status = 'pending' AND reservationId = ?
              AND ${userGuard}`,
      params: [input.email, input.userId, input.reservationId, ...userGuardParams],
    },
  ];

  if (input.previousEmail && input.previousEmail !== input.email) {
    statements.push({
      sql: `DELETE FROM _email_index
            WHERE email = ? AND userId = ? AND ${userGuard}`,
      params: [input.previousEmail, input.userId, ...userGuardParams],
    });
  }

  statements.push(
    {
      sql: `DELETE FROM _anon_index WHERE userId = ? AND ${userGuard}`,
      params: [input.userId, ...userGuardParams],
    },
    {
      sql: `DELETE FROM _sessions WHERE userId = ? AND ${userGuard}`,
      params: [input.userId, ...userGuardParams],
    },
    {
      sql: `INSERT INTO _sessions
              (id, userId, refreshToken, previousRefreshToken, rotatedAt,
               expiresAt, createdAt, metadata)
            SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${userGuard}
            ON CONFLICT (id) DO NOTHING`,
      params: [
        session.id,
        input.userId,
        session.refreshToken,
        session.previousRefreshToken ?? null,
        session.rotatedAt ?? null,
        session.expiresAt,
        now,
        session.metadata ?? null,
        ...userGuardParams,
      ],
    },
    {
      sql: `INSERT INTO _meta (key, value)
            SELECT ?, NULL WHERE NOT (
              ${checkpointGuard} AND ${userGuard} AND
              EXISTS (
                SELECT 1 FROM _email_index
                WHERE email = ? AND userId = ? AND status = 'confirmed'
              ) AND
              EXISTS (
                SELECT 1 FROM _sessions
                WHERE id = ? AND userId = ? AND refreshToken = ? AND expiresAt = ?
              ) AND
              NOT EXISTS (
                SELECT 1 FROM _sessions WHERE userId = ? AND id <> ?
              ) AND
              NOT EXISTS (
                SELECT 1 FROM _anon_index WHERE userId = ?
              )
            )`,
      params: [
        `email-upgrade-completion-guard:${crypto.randomUUID()}`,
        ...checkpointGuardParams,
        ...userGuardParams,
        input.email,
        input.userId,
        session.id,
        input.userId,
        session.refreshToken,
        session.expiresAt,
        input.userId,
        session.id,
        input.userId,
      ],
    },
  );

  try {
    await db.batchWithLock(
      [
        'auth-challenge-capacity',
        `auth-user:${input.userId}`,
        `auth-session:${input.initiatingSessionId}`,
        `email:${input.email}`,
        `auth-challenge:${checkpointKey}`,
      ],
      statements,
    );
  } catch (error) {
    if (isMetaGuardFailure(error)) throw new Error('EMAIL_UPGRADE_COMPLETION_CONFLICT');
    throw error;
  }
}

/**
 * Complete an anonymous phone upgrade exactly once. The OTP authority is
 * converted into a short-lived encrypted completion checkpoint in the same
 * transaction that confirms the identity, revokes every anonymous session,
 * and inserts the sole replacement session.
 */
export async function finalizeAnonymousPhoneUpgrade(
  db: AuthDb,
  input: FinalizeAnonymousPhoneUpgradeInput,
): Promise<void> {
  if (
    !input.challengeSecretHash ||
    !input.encryptedCompletion ||
    input.encryptedCompletion.length > 16_384
  ) {
    throw new Error('PHONE_UPGRADE_COMPLETION_INVALID');
  }
  const nowDate = new Date();
  const nowMs = nowDate.getTime();
  const completionExpiryMs = new Date(input.completionExpiresAt).getTime();
  if (
    !Number.isFinite(completionExpiryMs) ||
    completionExpiryMs <= nowMs ||
    completionExpiryMs > nowMs + 10 * 60 * 1000
  ) {
    throw new Error('PHONE_UPGRADE_COMPLETION_EXPIRY_INVALID');
  }
  const session = input.replacementSession;
  const sessionExpiryMs = new Date(session.expiresAt).getTime();
  if (
    session.userId !== input.userId ||
    !session.id || !session.refreshToken ||
    !Number.isFinite(sessionExpiryMs) || sessionExpiryMs <= nowMs
  ) {
    throw new Error('PHONE_UPGRADE_SESSION_INVALID');
  }
  const now = nowDate.toISOString();
  const attemptId = crypto.randomUUID();
  const finalRevision = input.expectedAuthRevision + 1;
  const userGuard = `EXISTS (
    SELECT 1 FROM _users
    WHERE id = ? AND authRevision = ? AND authMutationId = ? AND isAnonymous = 0
  )`;
  const userGuardParams = [input.userId, finalRevision, attemptId];
  const completionGuard = `EXISTS (
    SELECT 1 FROM _auth_challenges
    WHERE key = ? AND kind = 'phone-link-completion'
      AND userId = ? AND subject = ? AND secretHash = ?
      AND consumptionId = ? AND payload = ? AND expiresAt > ?
  )`;
  const completionGuardParams = [
    input.challengeKey,
    input.userId,
    input.phone,
    input.challengeSecretHash,
    attemptId,
    input.encryptedCompletion,
    now,
  ];
  const statements: { sql: string; params: unknown[] }[] = [
    {
      sql: `UPDATE _auth_challenges
            SET kind = 'phone-link-completion', payload = ?, consumedAt = ?,
                consumptionId = ?, expiresAt = ?
            WHERE key = ? AND kind = 'phone-link-otp'
              AND userId = ? AND subject = ? AND secretHash = ?
              AND consumedAt IS NULL AND attempts < maxAttempts AND expiresAt > ?`,
      params: [
        input.encryptedCompletion,
        now,
        attemptId,
        input.completionExpiresAt,
        input.challengeKey,
        input.userId,
        input.phone,
        input.challengeSecretHash,
        now,
      ],
    },
    {
      sql: `UPDATE _users
            SET phone = ?, phoneVerified = 1, isAnonymous = 0,
                lastSignedInAt = ?, updatedAt = ?,
                authRevision = authRevision + 1, authMutationId = ?
            WHERE id = ? AND authRevision = ? AND isAnonymous = 1
              AND ${completionGuard}`,
      params: [
        input.phone,
        now,
        now,
        attemptId,
        input.userId,
        input.expectedAuthRevision,
        ...completionGuardParams,
      ],
    },
    {
      sql: `UPDATE _phone_index SET status = 'confirmed', reservationId = NULL
            WHERE phone = ? AND userId = ? AND status = 'pending' AND reservationId = ?
              AND ${userGuard}`,
      params: [input.phone, input.userId, input.reservationId, ...userGuardParams],
    },
  ];

  if (input.previousPhone && input.previousPhone !== input.phone) {
    statements.push({
      sql: `DELETE FROM _phone_index
            WHERE phone = ? AND userId = ? AND ${userGuard}`,
      params: [input.previousPhone, input.userId, ...userGuardParams],
    });
  }

  statements.push(
    {
      sql: `DELETE FROM _anon_index WHERE userId = ? AND ${userGuard}`,
      params: [input.userId, ...userGuardParams],
    },
    {
      sql: `DELETE FROM _sessions WHERE userId = ? AND ${userGuard}`,
      params: [input.userId, ...userGuardParams],
    },
    {
      sql: `INSERT INTO _sessions
              (id, userId, refreshToken, previousRefreshToken, rotatedAt,
               expiresAt, createdAt, metadata)
            SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${userGuard}
            ON CONFLICT (id) DO NOTHING`,
      params: [
        session.id,
        input.userId,
        session.refreshToken,
        session.previousRefreshToken ?? null,
        session.rotatedAt ?? null,
        session.expiresAt,
        now,
        session.metadata ?? null,
        ...userGuardParams,
      ],
    },
    {
      sql: `INSERT INTO _meta (key, value)
            SELECT ?, NULL WHERE NOT (
              ${completionGuard} AND ${userGuard} AND
              EXISTS (
                SELECT 1 FROM _phone_index
                WHERE phone = ? AND userId = ? AND status = 'confirmed'
              ) AND
              EXISTS (
                SELECT 1 FROM _sessions
                WHERE id = ? AND userId = ? AND refreshToken = ? AND expiresAt = ?
              ) AND
              NOT EXISTS (
                SELECT 1 FROM _sessions WHERE userId = ? AND id <> ?
              ) AND
              NOT EXISTS (
                SELECT 1 FROM _anon_index WHERE userId = ?
              )
            )`,
      params: [
        `phone-upgrade-completion-guard:${crypto.randomUUID()}`,
        ...completionGuardParams,
        ...userGuardParams,
        input.phone,
        input.userId,
        session.id,
        input.userId,
        session.refreshToken,
        session.expiresAt,
        input.userId,
        session.id,
        input.userId,
      ],
    },
  );

  try {
    await db.batchWithLock(
      [
        `auth-user:${input.userId}`,
        `phone:${input.phone}`,
        `auth-challenge:${input.challengeKey}`,
      ],
      statements,
    );
  } catch (error) {
    if (isMetaGuardFailure(error)) throw new Error('PHONE_UPGRADE_COMPLETION_CONFLICT');
    throw error;
  }
}

/** Atomically create an admin-managed user and confirm its owned email. */
export async function finalizeManagedUserCreation(
  db: AuthDb,
  input: FinalizeManagedUserCreationInput,
): Promise<void> {
  const user = input.user;
  if (!user.email) throw new Error('MANAGED_USER_EMAIL_REQUIRED');
  const now = new Date().toISOString();
  const emailGuard = `EXISTS (
    SELECT 1 FROM _email_index
    WHERE email = ? AND userId = ? AND status = 'pending' AND reservationId = ?
  )`;
  const guardParams = [user.email, user.userId, input.emailReservationId];
  try {
    await db.batchWithLock(
      [`auth-user:${user.userId}`, `email:${user.email}`],
      [
        {
          sql: `INSERT INTO _users
                  (id, email, passwordHash, displayName, avatarUrl, emailVisibility,
                   role, verified, isAnonymous, locale, metadata, appMetadata,
                   createdAt, updatedAt)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?
                WHERE ${emailGuard}`,
          params: [
            user.userId,
            user.email,
            user.passwordHash,
            user.displayName ?? null,
            user.avatarUrl ?? null,
            user.emailVisibility ?? 'private',
            user.role ?? 'user',
            user.verified ? 1 : 0,
            user.locale ?? 'en',
            user.metadata ? JSON.stringify(user.metadata) : null,
            user.appMetadata ? JSON.stringify(user.appMetadata) : null,
            now,
            now,
            ...guardParams,
          ],
        },
        {
          sql: `UPDATE _email_index SET status = 'confirmed', reservationId = NULL
                WHERE email = ? AND userId = ? AND status = 'pending' AND reservationId = ?
                  AND EXISTS (
                    SELECT 1 FROM _users WHERE id = ? AND email = ?
                  )`,
          params: [
            user.email,
            user.userId,
            input.emailReservationId,
            user.userId,
            user.email,
          ],
        },
        {
          sql: `INSERT INTO _meta (key, value)
                SELECT ?, NULL WHERE NOT (
                  EXISTS (
                    SELECT 1 FROM _users WHERE id = ? AND email = ?
                  ) AND EXISTS (
                    SELECT 1 FROM _email_index
                    WHERE email = ? AND userId = ? AND status = 'confirmed'
                  )
                )`,
          params: [
            `managed-user-create-guard:${crypto.randomUUID()}`,
            user.userId,
            user.email,
            user.email,
            user.userId,
          ],
        },
      ],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error('MANAGED_USER_CREATION_CONFLICT');
    }
    throw error;
  }
}

/** Atomically CAS an admin user update and every affected contact index. */
export async function finalizeManagedUserUpdate(
  db: AuthDb,
  input: FinalizeManagedUserUpdateInput,
): Promise<void> {
  const now = new Date().toISOString();
  const mutationId = crypto.randomUUID();
  const sets: string[] = [];
  const updateParams: unknown[] = [];
  const allowed = new Set([
    'email', 'passwordHash', 'displayName', 'avatarUrl', 'emailVisibility',
    'role', 'status', 'verified', 'isAnonymous', 'locale', 'metadata', 'appMetadata',
    'customClaims', 'phone', 'phoneVerified', 'disabled', 'lastSignedInAt',
  ]);
  for (const [key, rawValue] of Object.entries(input.updates)) {
    if (!allowed.has(key) || typeof rawValue === 'symbol' || typeof rawValue === 'function') continue;
    if (key === 'status' && !['active', 'suspended', 'banned', 'disabled'].includes(String(rawValue))) continue;
    if (key === 'emailVisibility' && !['public', 'private'].includes(String(rawValue))) continue;
    let value: unknown = rawValue;
    if (key === 'role') {
      if (typeof rawValue !== 'string' || rawValue.trim().length === 0) continue;
      value = rawValue.trim();
    } else if (['customClaims', 'metadata', 'appMetadata'].includes(key) && rawValue !== null && typeof rawValue === 'object') {
      value = JSON.stringify(rawValue);
    } else if (['verified', 'isAnonymous', 'phoneVerified', 'disabled'].includes(key) && typeof rawValue === 'boolean') {
      value = rawValue ? 1 : 0;
    }
    sets.push(`${key} = ?`);
    updateParams.push(value);
  }
  sets.push('updatedAt = ?');
  updateParams.push(now);
  sets.push('authRevision = authRevision + 1');
  sets.push('authMutationId = ?');
  updateParams.push(mutationId);

  const ownerGuards: string[] = [];
  const ownerParams: unknown[] = [];
  for (const contact of input.contacts) {
    if (contact.nextValue && contact.reservationId) {
      const table = contact.kind === 'email' ? '_email_index' : '_phone_index';
      ownerGuards.push(`EXISTS (
        SELECT 1 FROM ${table}
        WHERE ${contact.kind} = ? AND userId = ? AND status = 'pending' AND reservationId = ?
      )`);
      ownerParams.push(contact.nextValue, input.userId, contact.reservationId);
    }
  }
  const statements: { sql: string; params: unknown[] }[] = [{
    sql: `UPDATE _users SET ${sets.join(', ')}
          WHERE id = ? AND authRevision = ?${ownerGuards.length ? ` AND ${ownerGuards.join(' AND ')}` : ''}`,
    params: [...updateParams, input.userId, input.expectedAuthRevision, ...ownerParams],
  }];
  const finalRevision = input.expectedAuthRevision + 1;

  for (const contact of input.contacts) {
    const table = contact.kind === 'email' ? '_email_index' : '_phone_index';
    if (contact.nextValue && contact.reservationId) {
      statements.push({
        sql: `UPDATE ${table} SET status = 'confirmed', reservationId = NULL
              WHERE ${contact.kind} = ? AND userId = ? AND status = 'pending' AND reservationId = ?
                AND EXISTS (
                  SELECT 1 FROM _users
                  WHERE id = ? AND authRevision = ? AND authMutationId = ?
                )`,
        params: [
          contact.nextValue,
          input.userId,
          contact.reservationId,
          input.userId,
          finalRevision,
          mutationId,
        ],
      });
    }
    if (contact.previousValue && contact.previousValue !== contact.nextValue) {
      statements.push({
        sql: `DELETE FROM ${table}
              WHERE ${contact.kind} = ? AND userId = ?
                AND EXISTS (
                  SELECT 1 FROM _users
                  WHERE id = ? AND authRevision = ? AND authMutationId = ?
                )`,
        params: [contact.previousValue, input.userId, input.userId, finalRevision, mutationId],
      });
    }
  }

  const completionGuards = [
    `EXISTS (
      SELECT 1 FROM _users
      WHERE id = ? AND authRevision = ? AND authMutationId = ?
    )`,
  ];
  const completionParams: unknown[] = [input.userId, finalRevision, mutationId];
  for (const contact of input.contacts) {
    if (!contact.nextValue) continue;
    const table = contact.kind === 'email' ? '_email_index' : '_phone_index';
    completionGuards.push(`EXISTS (
      SELECT 1 FROM ${table}
      WHERE ${contact.kind} = ? AND userId = ? AND status = 'confirmed'
    )`);
    completionParams.push(contact.nextValue, input.userId);
  }
  statements.push({
    sql: `INSERT INTO _meta (key, value)
          SELECT ?, NULL WHERE NOT (${completionGuards.join(' AND ')})`,
    params: [`managed-user-update-guard:${crypto.randomUUID()}`, ...completionParams],
  });

  const lockKeys = [`auth-user:${input.userId}`];
  for (const contact of input.contacts) {
    if (contact.previousValue) lockKeys.push(`${contact.kind}:${contact.previousValue}`);
    if (contact.nextValue) lockKeys.push(`${contact.kind}:${contact.nextValue}`);
  }
  try {
    await db.batchWithLock(lockKeys, statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error('AUTH_STATE_CONFLICT');
    }
    throw error;
  }
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

// ─── D. One-time auth challenges and email tokens ───

async function authChallengeKey(kind: string, lookupKey: string): Promise<string> {
  return hashAuthSecret(`${kind}\u0000${lookupKey}`);
}

/** Atomically replace the active challenge for one logical scope. */
export async function issueAuthChallenge(
  db: AuthDb,
  input: IssueAuthChallengeInput,
): Promise<void> {
  const key = await authChallengeKey(input.kind, input.lookupKey);
  const now = new Date();
  const createdAt = now.toISOString();
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 604_800) {
    throw new Error('AUTH_CHALLENGE_TTL_INVALID');
  }
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const maxAttempts = input.maxAttempts ?? 5;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new Error('AUTH_CHALLENGE_MAX_ATTEMPTS_INVALID');
  }
  await db.batchWithLock(
    ['auth-challenge-capacity', `auth-challenge:${key}`],
    [
      {
        sql: `DELETE FROM _auth_challenges
              WHERE expiresAt <= ?
                 OR (consumedAt IS NOT NULL
                     AND kind NOT IN ('phone-link-completion', 'email-link-completion'))`,
        params: [createdAt],
      },
      ...(input.replaceUserKind && input.userId ? [{
        sql: `DELETE FROM _auth_challenges WHERE userId = ? AND kind = ?`,
        params: [input.userId, input.kind],
      }] : []),
      { sql: `DELETE FROM _auth_challenges WHERE key = ?`, params: [key] },
      {
        sql: `INSERT INTO _auth_challenges
                (key, kind, userId, subject, secretHash, payload, attempts,
                 maxAttempts, expiresAt, consumedAt, consumptionId, createdAt)
              SELECT ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, ?
              WHERE (SELECT COUNT(*) FROM _auth_challenges) < 20000`,
        params: [
          key,
          input.kind,
          input.userId ?? null,
          input.subject ?? null,
          input.secretHash ?? null,
          input.payload ?? null,
          maxAttempts,
          expiresAt,
          createdAt,
        ],
      },
      {
        sql: `INSERT INTO _meta (key, value)
              SELECT ?, NULL WHERE NOT EXISTS (
                SELECT 1 FROM _auth_challenges WHERE key = ? AND kind = ?
              )`,
        params: [`auth-challenge-capacity-guard:${crypto.randomUUID()}`, key, input.kind],
      },
    ],
  );
}

export async function getAuthChallenge(
  db: AuthDb,
  kind: string,
  lookupKey: string,
): Promise<AuthChallengeRecord | null> {
  const key = await authChallengeKey(kind, lookupKey);
  return db.first<AuthChallengeRecord>(
    `SELECT key, kind, userId, subject, secretHash, payload, attempts,
            maxAttempts, expiresAt, createdAt
     FROM _auth_challenges
     WHERE key = ? AND kind = ? AND consumedAt IS NULL
       AND expiresAt > ?`,
    [key, kind, new Date().toISOString()],
  );
}

/** Read a live, bounded anonymous phone-upgrade completion checkpoint. */
export async function getPhoneLinkUpgradeCompletion(
  db: AuthDb,
  phone: string,
): Promise<AuthChallengeRecord | null> {
  const key = await authChallengeKey('phone-link-otp', phone);
  return db.first<AuthChallengeRecord>(
    `SELECT key, kind, userId, subject, secretHash, payload, attempts,
            maxAttempts, expiresAt, createdAt
     FROM _auth_challenges
     WHERE key = ? AND kind = 'phone-link-completion'
       AND consumedAt IS NOT NULL AND expiresAt > ?`,
    [key, new Date().toISOString()],
  );
}

/** Read a live, bounded anonymous email-upgrade completion checkpoint. */
export async function getEmailLinkUpgradeCompletion(
  db: AuthDb,
  userId: string,
  email: string,
): Promise<AuthChallengeRecord | null> {
  const key = await authChallengeKey(
    'email-link-completion',
    `${userId}\u0000${email}`,
  );
  return db.first<AuthChallengeRecord>(
    `SELECT key, kind, userId, subject, secretHash, payload, attempts,
            maxAttempts, expiresAt, createdAt
     FROM _auth_challenges
     WHERE key = ? AND kind = 'email-link-completion'
       AND userId = ? AND subject = ?
       AND consumedAt IS NOT NULL AND expiresAt > ?`,
    [key, userId, email, new Date().toISOString()],
  );
}

/** Count one failed verification without a read-modify-write race. */
export async function recordAuthChallengeFailure(
  db: AuthDb,
  kind: string,
  lookupKey: string,
): Promise<{ attempts: number; maxAttempts: number } | null> {
  const key = await authChallengeKey(kind, lookupKey);
  return db.first<{ attempts: number; maxAttempts: number }>(
    `UPDATE _auth_challenges SET attempts = attempts + 1
     WHERE key = ? AND kind = ? AND consumedAt IS NULL
       AND attempts < maxAttempts AND expiresAt > ?
     RETURNING attempts, maxAttempts`,
    [key, kind, new Date().toISOString()],
  );
}

/** Delete-and-return one live challenge. Exactly one concurrent caller wins. */
export async function consumeAuthChallenge(
  db: AuthDb,
  kind: string,
  lookupKey: string,
): Promise<AuthChallengeRecord | null> {
  const key = await authChallengeKey(kind, lookupKey);
  return db.first<AuthChallengeRecord>(
    `DELETE FROM _auth_challenges
     WHERE key = ? AND kind = ? AND consumedAt IS NULL
       AND attempts < maxAttempts AND expiresAt > ?
     RETURNING key, kind, userId, subject, secretHash, payload, attempts,
               maxAttempts, expiresAt, createdAt`,
    [key, kind, new Date().toISOString()],
  );
}

/**
 * Create an email token (verify, password-reset, magic-link).
 */
export async function createEmailToken(
  db: AuthDb,
  input: CreateEmailTokenInput,
): Promise<void> {
  const now = new Date().toISOString();
  const tokenHash = await hashAuthSecret(input.token);

  await db.run(
    `INSERT INTO _email_tokens (token, userId, type, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [tokenHash, input.userId, input.type, input.expiresAt, now],
  );
}

/** Replace every token of one user/type and insert the new token atomically. */
export async function replaceEmailToken(
  db: AuthDb,
  input: CreateEmailTokenInput,
): Promise<void> {
  const now = new Date().toISOString();
  const tokenHash = await hashAuthSecret(input.token);
  await db.batchWithLock(`email-token:${input.userId}:${input.type}`, [
    {
      sql: `DELETE FROM _email_tokens WHERE userId = ? AND type = ?`,
      params: [input.userId, input.type],
    },
    {
      sql: `INSERT INTO _email_tokens (token, userId, type, expiresAt, createdAt)
            VALUES (?, ?, ?, ?, ?)`,
      params: [tokenHash, input.userId, input.type, input.expiresAt, now],
    },
  ]);
}

/** Atomically consume one unexpired token of the expected type. */
export async function consumeEmailToken(
  db: AuthDb,
  token: string,
  type: string,
): Promise<Record<string, unknown> | null> {
  const lookupKeys = await authSecretLookupKeys(token);
  return db.first(
    `DELETE FROM _email_tokens
     WHERE token IN (${lookupKeys.map(() => '?').join(', ')})
       AND type = ? AND expiresAt > ?
     RETURNING token, userId, type, expiresAt, createdAt`,
    [...lookupKeys, type, new Date().toISOString()],
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
  const lookupKeys = await authSecretLookupKeys(token);
  const row = await db.first(
    `SELECT * FROM _email_tokens WHERE token IN (${lookupKeys.map(() => '?').join(', ')})`,
    lookupKeys,
  );

  if (!row) return null;

  // Check expiration
  if (new Date(row.expiresAt as string) < new Date()) {
    // Clean up expired token
    await db.run(
      `DELETE FROM _email_tokens WHERE token IN (${lookupKeys.map(() => '?').join(', ')})`,
      lookupKeys,
    );
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
  const lookupKeys = await authSecretLookupKeys(token);
  return await db.first(
    `SELECT * FROM _email_tokens WHERE token IN (${lookupKeys.map(() => '?').join(', ')}) AND type = ?`,
    [...lookupKeys, type],
  );
}

/**
 * Delete a specific email token.
 */
export async function deleteEmailToken(
  db: AuthDb,
  token: string,
): Promise<void> {
  const lookupKeys = await authSecretLookupKeys(token);
  await db.run(
    `DELETE FROM _email_tokens WHERE token IN (${lookupKeys.map(() => '?').join(', ')})`,
    lookupKeys,
  );
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

function assertTotpCounter(counter: number): void {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('TOTP_COUNTER_INVALID');
}

function isMetaGuardFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message);
}

/** Atomically reject TOTP replay and verify an owned pending factor. */
export async function verifyMfaFactorWithTotpCounter(
  db: AuthDb,
  input: { factorId: string; userId: string; replayScope: string; counter: number },
): Promise<void> {
  assertTotpCounter(input.counter);
  const replayKey = await authChallengeKey('totp-replay', input.replayScope);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 120_000).toISOString();
  const attemptId = crypto.randomUUID();
  try {
    await db.batchWithLock(
      [`auth-user:${input.userId}`, `totp-replay:${replayKey}`],
      [
        {
          sql: `INSERT INTO _auth_challenges
                  (key, kind, userId, subject, payload, attempts, maxAttempts,
                   expiresAt, consumedAt, consumptionId, createdAt)
                VALUES (?, 'totp-replay', ?, ?, ?, 0, 1, ?, NULL, ?, ?)
                ON CONFLICT (key) DO UPDATE SET
                  userId = excluded.userId,
                  subject = excluded.subject,
                  payload = excluded.payload,
                  expiresAt = excluded.expiresAt,
                  consumptionId = excluded.consumptionId,
                  createdAt = excluded.createdAt
                WHERE _auth_challenges.expiresAt <= ?
                   OR CAST(COALESCE(_auth_challenges.payload, '-1') AS BIGINT) < ?`,
          params: [
            replayKey,
            input.userId,
            input.replayScope,
            String(input.counter),
            expiresAt,
            attemptId,
            nowIso,
            nowIso,
            input.counter,
          ],
        },
        {
          sql: `UPDATE _mfa_factors SET verified = 1
                WHERE id = ? AND userId = ? AND verified = 0
                  AND EXISTS (
                    SELECT 1 FROM _auth_challenges
                    WHERE key = ? AND consumptionId = ?
                  )`,
          params: [input.factorId, input.userId, replayKey, attemptId],
        },
        {
          sql: `INSERT INTO _meta (key, value)
                SELECT ?, NULL WHERE NOT (
                  EXISTS (
                    SELECT 1 FROM _mfa_factors
                    WHERE id = ? AND userId = ? AND verified = 1
                  ) AND EXISTS (
                    SELECT 1 FROM _auth_challenges
                    WHERE key = ? AND consumptionId = ?
                  )
                )`,
          params: [
            `totp-enrollment-guard:${crypto.randomUUID()}`,
            input.factorId,
            input.userId,
            replayKey,
            attemptId,
          ],
        },
      ],
    );
  } catch (error) {
    if (isMetaGuardFailure(error)) throw new Error('TOTP_REPLAY_OR_FACTOR_CONFLICT');
    throw error;
  }
}

/** Consume one MFA ticket and its TOTP time-step in one transaction. */
export async function completeMfaTotpChallenge(
  db: AuthDb,
  input: { ticket: string; userId: string; replayScope: string; counter: number },
): Promise<void> {
  assertTotpCounter(input.counter);
  const ticketKey = await authChallengeKey('mfa-ticket', input.ticket);
  const replayKey = await authChallengeKey('totp-replay', input.replayScope);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 120_000).toISOString();
  const attemptId = crypto.randomUUID();
  try {
    await db.batchWithLock(
      [`auth-user:${input.userId}`, `auth-challenge:${ticketKey}`, `totp-replay:${replayKey}`],
      [
        {
          sql: `UPDATE _auth_challenges SET consumedAt = ?, consumptionId = ?
                WHERE key = ? AND kind = 'mfa-ticket' AND userId = ?
                  AND consumedAt IS NULL AND attempts < maxAttempts AND expiresAt > ?`,
          params: [nowIso, attemptId, ticketKey, input.userId, nowIso],
        },
        {
          sql: `INSERT INTO _auth_challenges
                  (key, kind, userId, subject, payload, attempts, maxAttempts,
                   expiresAt, consumedAt, consumptionId, createdAt)
                VALUES (?, 'totp-replay', ?, ?, ?, 0, 1, ?, NULL, ?, ?)
                ON CONFLICT (key) DO UPDATE SET
                  userId = excluded.userId,
                  subject = excluded.subject,
                  payload = excluded.payload,
                  expiresAt = excluded.expiresAt,
                  consumptionId = excluded.consumptionId,
                  createdAt = excluded.createdAt
                WHERE _auth_challenges.expiresAt <= ?
                   OR CAST(COALESCE(_auth_challenges.payload, '-1') AS BIGINT) < ?`,
          params: [
            replayKey,
            input.userId,
            input.replayScope,
            String(input.counter),
            expiresAt,
            attemptId,
            nowIso,
            nowIso,
            input.counter,
          ],
        },
        {
          sql: `INSERT INTO _meta (key, value)
                SELECT ?, NULL WHERE NOT (
                  EXISTS (
                    SELECT 1 FROM _auth_challenges
                    WHERE key = ? AND kind = 'mfa-ticket'
                      AND userId = ? AND consumptionId = ? AND consumedAt IS NOT NULL
                  ) AND EXISTS (
                    SELECT 1 FROM _auth_challenges
                    WHERE key = ? AND kind = 'totp-replay' AND consumptionId = ?
                  )
                )`,
          params: [
            `mfa-totp-guard:${crypto.randomUUID()}`,
            ticketKey,
            input.userId,
            attemptId,
            replayKey,
            attemptId,
          ],
        },
        {
          sql: `DELETE FROM _auth_challenges
                WHERE key = ? AND consumptionId = ?`,
          params: [ticketKey, attemptId],
        },
      ],
    );
  } catch (error) {
    if (isMetaGuardFailure(error)) throw new Error('MFA_TOTP_CHALLENGE_CONFLICT');
    throw error;
  }
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
 * Replace all recovery codes for a user with a freshly generated batch.
 */
export async function replaceRecoveryCodes(
  db: AuthDb,
  userId: string,
  codes: Array<{ id: string; codeHash: string }>,
): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    { sql: `DELETE FROM _mfa_recovery_codes WHERE userId = ?`, params: [userId] },
    ...codes.map((code) => ({
      sql: `INSERT INTO _mfa_recovery_codes (id, userId, codeHash, used, createdAt)
         VALUES (?, ?, ?, 0, ?)`,
      params: [code.id, userId, code.codeHash, now],
    })),
  ]);
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

/** Consume an MFA ticket and one owned unused recovery code atomically. */
export async function completeMfaRecoveryChallenge(
  db: AuthDb,
  input: { ticket: string; userId: string; recoveryCodeId: string },
): Promise<void> {
  const ticketKey = await authChallengeKey('mfa-ticket', input.ticket);
  const now = new Date().toISOString();
  const attemptId = crypto.randomUUID();
  try {
    await db.batchWithLock(
      [`auth-user:${input.userId}`, `auth-challenge:${ticketKey}`],
      [
        {
          sql: `UPDATE _auth_challenges SET consumedAt = ?, consumptionId = ?
                WHERE key = ? AND kind = 'mfa-ticket' AND userId = ?
                  AND consumedAt IS NULL AND attempts < maxAttempts AND expiresAt > ?`,
          params: [now, attemptId, ticketKey, input.userId, now],
        },
        {
          sql: `UPDATE _mfa_recovery_codes SET used = 1
                WHERE id = ? AND userId = ? AND used = 0
                  AND EXISTS (
                    SELECT 1 FROM _auth_challenges
                    WHERE key = ? AND consumptionId = ?
                  )`,
          params: [input.recoveryCodeId, input.userId, ticketKey, attemptId],
        },
        {
          sql: `INSERT INTO _meta (key, value)
                SELECT ?, NULL WHERE NOT (
                  EXISTS (
                    SELECT 1 FROM _auth_challenges
                    WHERE key = ? AND userId = ? AND consumptionId = ?
                  ) AND EXISTS (
                    SELECT 1 FROM _mfa_recovery_codes
                    WHERE id = ? AND userId = ? AND used = 1
                  )
                )`,
          params: [
            `mfa-recovery-guard:${crypto.randomUUID()}`,
            ticketKey,
            input.userId,
            attemptId,
            input.recoveryCodeId,
            input.userId,
          ],
        },
        {
          sql: `DELETE FROM _auth_challenges WHERE key = ? AND consumptionId = ?`,
          params: [ticketKey, attemptId],
        },
      ],
    );
  } catch (error) {
    if (isMetaGuardFailure(error)) throw new Error('MFA_RECOVERY_CHALLENGE_CONFLICT');
    throw error;
  }
}

// ─── F. WebAuthn ───

function assertWebAuthnCounter(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${field.toUpperCase()}_OUT_OF_RANGE`);
  }
}

/** Persist a server-issued WebAuthn challenge in the authoritative auth DB. */
export async function storeWebAuthnChallenge(
  db: AuthDb,
  input: {
    challenge: string;
    kind: WebAuthnChallengeKind;
    userId?: string | null;
    ttlSeconds?: number;
  },
): Promise<void> {
  const now = new Date();
  const createdAt = now.toISOString();
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 600) {
    throw new Error('WEBAUTHN_CHALLENGE_TTL_INVALID');
  }
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const userId = input.userId ?? null;
  const scopeUserSql = userId ? 'userId = ?' : 'userId IS NULL';
  const statements: { sql: string; params: unknown[] }[] = [
    {
      sql: `DELETE FROM _webauthn_challenges WHERE expiresAt <= ?`,
      params: [createdAt],
    },
  ];
  if (input.kind === 'registration' && userId) {
    statements.push({
      sql: `DELETE FROM _webauthn_challenges
            WHERE kind = 'registration' AND userId = ?`,
      params: [userId],
    });
  }
  statements.push({
    sql: `INSERT INTO _webauthn_challenges
            (challenge, kind, userId, expiresAt, consumptionId, createdAt)
          SELECT ?, ?, ?, ?, NULL, ?
          WHERE (SELECT COUNT(*) FROM _webauthn_challenges) < 10000
            AND (
              SELECT COUNT(*) FROM _webauthn_challenges
              WHERE kind = ? AND ${scopeUserSql}
            ) < ?`,
    params: [
      input.challenge,
      input.kind,
      userId,
      expiresAt,
      createdAt,
      input.kind,
      ...(userId ? [userId] : []),
      userId ? 10 : 10000,
    ],
  });
  statements.push({
    sql: `INSERT INTO _meta (key, value)
          SELECT ?, NULL WHERE NOT EXISTS (
            SELECT 1 FROM _webauthn_challenges
            WHERE challenge = ? AND kind = ? AND consumptionId IS NULL
          )`,
    params: [
      `webauthn-challenge-capacity-guard:${crypto.randomUUID()}`,
      input.challenge,
      input.kind,
    ],
  });

  try {
    await db.batchWithLock(
      userId
        ? ['webauthn-challenge-capacity', `webauthn-challenge:${input.challenge}`, `auth-user:${userId}`]
        : ['webauthn-challenge-capacity', `webauthn-challenge:${input.challenge}`],
      statements,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error('WEBAUTHN_CHALLENGE_CAPACITY');
    }
    throw error;
  }
}

/** Read an unconsumed, unexpired challenge for cryptographic verification. */
export async function getWebAuthnChallenge(
  db: AuthDb,
  challenge: string,
  kind: WebAuthnChallengeKind,
): Promise<WebAuthnChallengeRecord | null> {
  return db.first<WebAuthnChallengeRecord>(
    `SELECT challenge, kind, userId, expiresAt, createdAt
     FROM _webauthn_challenges
     WHERE challenge = ? AND kind = ? AND consumptionId IS NULL AND expiresAt > ?`,
    [challenge, kind, new Date().toISOString()],
  );
}

/**
 * Consume an authentication challenge and advance its credential counter in
 * one transaction. The owner binding, challenge single-use rule, and counter
 * CAS all have to succeed or the transaction rolls back.
 */
export async function completePasskeyAuthentication(
  db: AuthDb,
  input: CompletePasskeyAuthenticationInput,
): Promise<void> {
  assertWebAuthnCounter(input.expectedCounter, 'expected counter');
  assertWebAuthnCounter(input.newCounter, 'new counter');
  const now = new Date().toISOString();
  const consumptionId = crypto.randomUUID();
  try {
    await db.batchWithLock(
      [
        `auth-user:${input.userId}`,
        `passkey:${input.credentialId}`,
        `webauthn-challenge:${input.challenge}`,
      ],
      [
        {
          sql: `UPDATE _webauthn_challenges SET consumptionId = ?
                WHERE challenge = ? AND kind = 'authentication'
                  AND consumptionId IS NULL AND expiresAt > ?
                  AND (userId IS NULL OR userId = ?)`,
          params: [consumptionId, input.challenge, now, input.userId],
        },
        {
          sql: `UPDATE _webauthn_credentials SET counter = ?
                WHERE credentialId = ? AND userId = ? AND counter = ?
                  AND EXISTS (
                    SELECT 1 FROM _webauthn_challenges
                    WHERE challenge = ? AND consumptionId = ?
                  )`,
          params: [
            input.newCounter,
            input.credentialId,
            input.userId,
            input.expectedCounter,
            input.challenge,
            consumptionId,
          ],
        },
        {
          sql: `INSERT INTO _meta (key, value)
                SELECT ?, NULL WHERE NOT (
                  EXISTS (
                    SELECT 1 FROM _webauthn_challenges
                    WHERE challenge = ? AND consumptionId = ?
                  ) AND EXISTS (
                    SELECT 1 FROM _webauthn_credentials
                    WHERE credentialId = ? AND userId = ? AND counter = ?
                  )
                )`,
          params: [
            `passkey-authentication-guard:${crypto.randomUUID()}`,
            input.challenge,
            consumptionId,
            input.credentialId,
            input.userId,
            input.newCounter,
          ],
        },
        {
          sql: `DELETE FROM _webauthn_challenges
                WHERE challenge = ? AND consumptionId = ?`,
          params: [input.challenge, consumptionId],
        },
      ],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error('PASSKEY_AUTH_STATE_CONFLICT');
    }
    throw error;
  }
}

/**
 * Create a WebAuthn credential.
 * INSERT + re-fetch.
 */
export async function createWebAuthnCredential(
  db: AuthDb,
  input: CreateWebAuthnCredentialInput,
): Promise<Record<string, unknown>> {
  assertWebAuthnCounter(input.counter ?? 0, 'counter');
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

/** Create the WebAuthn credential and global passkey index atomically. */
export async function createPasskeyIdentity(
  db: AuthDb,
  input: CreatePasskeyIdentityInput,
): Promise<Record<string, unknown>> {
  assertWebAuthnCounter(input.counter ?? 0, 'counter');
  const now = new Date().toISOString();
  const consumptionId = input.registrationChallenge ? crypto.randomUUID() : null;
  const statements: { sql: string; params: unknown[] }[] = [];
  if (input.registrationChallenge && consumptionId) {
    statements.push({
      sql: `UPDATE _webauthn_challenges SET consumptionId = ?
            WHERE challenge = ? AND kind = 'registration' AND userId = ?
              AND consumptionId IS NULL AND expiresAt > ?`,
      params: [consumptionId, input.registrationChallenge, input.userId, now],
    });
  }
  statements.push(
    {
      sql: `INSERT INTO _webauthn_credentials
            (id, userId, credentialId, credentialPublicKey, counter, transports, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (credentialId) DO NOTHING`,
      params: [
        input.id,
        input.userId,
        input.credentialId,
        input.credentialPublicKey,
        input.counter ?? 0,
        input.transports ?? null,
        now,
      ],
    },
    {
      sql: `INSERT INTO _passkey_index (credentialId, userId, shardId, createdAt)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (credentialId) DO NOTHING`,
      params: [input.credentialId, input.userId, 0, now],
    },
    {
      sql: `INSERT INTO _meta (key, value)
            SELECT ?, NULL WHERE NOT (
              EXISTS (
                SELECT 1 FROM _webauthn_credentials
                WHERE credentialId = ? AND userId = ?
              ) AND EXISTS (
                SELECT 1 FROM _passkey_index WHERE credentialId = ? AND userId = ?
              )${input.registrationChallenge && consumptionId ? ` AND EXISTS (
                SELECT 1 FROM _webauthn_challenges
                WHERE challenge = ? AND consumptionId = ?
              )` : ''}
            )`,
      params: [
        `passkey-finalization-guard:${crypto.randomUUID()}`,
        input.credentialId,
        input.userId,
        input.credentialId,
        input.userId,
        ...(input.registrationChallenge && consumptionId
          ? [input.registrationChallenge, consumptionId]
          : []),
      ],
    },
  );
  if (input.registrationChallenge && consumptionId) {
    statements.push({
      sql: `DELETE FROM _webauthn_challenges
            WHERE challenge = ? AND consumptionId = ?`,
      params: [input.registrationChallenge, consumptionId],
    });
  }

  try {
    await db.batchWithLock(
      [
        `auth-user:${input.userId}`,
        `passkey:${input.credentialId}`,
        ...(input.registrationChallenge
          ? [`webauthn-challenge:${input.registrationChallenge}`]
          : []),
      ],
      statements,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error('PASSKEY_FINALIZATION_CONFLICT');
    }
    throw error;
  }
  return {
    id: input.id,
    userId: input.userId,
    credentialId: input.credentialId,
    credentialPublicKey: input.credentialPublicKey,
    counter: input.counter ?? 0,
    transports: input.transports ?? null,
    createdAt: now,
  };
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

/** Delete the owned WebAuthn credential and passkey index atomically. */
export async function deletePasskeyIdentity(
  db: AuthDb,
  credentialId: string,
  userId: string,
  remainingMethodGuard?: RemainingMethodGuard,
): Promise<void> {
  const statements: { sql: string; params: unknown[] }[] = [];
  if (remainingMethodGuard) {
    const passkeyCountSql = remainingMethodGuard.includePasskeys
      ? `(SELECT COUNT(*)
          FROM _webauthn_credentials c
          JOIN _passkey_index i ON i.credentialId = c.credentialId
          WHERE c.userId = ? AND i.userId = c.userId)`
      : '0';
    statements.push({
      sql: `INSERT INTO _meta (key, value)
            SELECT ?, NULL WHERE
              NOT EXISTS (
                SELECT 1 FROM _users WHERE id = ? AND authRevision = ?
              ) OR (
                ? + ${passkeyCountSql} +
                (SELECT COUNT(*)
                 FROM _oauth_accounts a
                 JOIN _oauth_index i
                   ON i.provider = a.provider AND i.providerUserId = a.providerUserId
                 WHERE a.userId = ? AND i.userId = a.userId AND i.status = 'confirmed')
              ) <= 1`,
      params: [
        `passkey-delete-guard:${crypto.randomUUID()}`,
        userId,
        remainingMethodGuard.expectedAuthRevision,
        remainingMethodGuard.independentMethodCount,
        ...(remainingMethodGuard.includePasskeys ? [userId] : []),
        userId,
      ],
    });
  }
  statements.push(
    {
      sql: `DELETE FROM _webauthn_credentials WHERE credentialId = ? AND userId = ?`,
      params: [credentialId, userId],
    },
    {
      sql: `DELETE FROM _passkey_index WHERE credentialId = ? AND userId = ?`,
      params: [credentialId, userId],
    },
  );
  try {
    await db.batchWithLock(
      [`auth-user:${userId}`, `passkey:${credentialId}`],
      statements,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/_meta.*value|value.*not[- ]null|null value in column ["']?value/i.test(message)) {
      throw new Error('LAST_SIGN_IN_METHOD');
    }
    throw error;
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
    authRevision: _authRevision,
    authMutationId: _authMutationId,
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
