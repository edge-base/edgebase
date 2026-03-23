/**
 * Auth D1 Control Plane — query helpers
 *
 * Replaces the former Registry DO with D1-based indexing for:
 *   - Email uniqueness check + userId mapping
 *   - OAuth provider uniqueness + userId mapping
 *   - Anonymous userId mapping
 *   - Admin accounts + sessions (with Lazy expiry cleanup)
 *
 * All functions use the AuthDb adapter interface so they work with
 * both D1 (SQLite) and PostgreSQL backends transparently.
 */

import type { AuthDb } from './auth-db-adapter.js';

// ─── Constants ───

export const AUTH_SHARD_COUNT = 16;
const PENDING_EXPIRY_MINUTES = 5;

// ─── Schema ───

export const AUTH_D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS _email_index (
  email TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  shardId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _oauth_index (
  provider TEXT NOT NULL,
  providerUserId TEXT NOT NULL,
  userId TEXT NOT NULL,
  shardId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, providerUserId)
);

CREATE TABLE IF NOT EXISTS _anon_index (
  userId TEXT PRIMARY KEY,
  shardId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _admins (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _admin_sessions (
  id TEXT PRIMARY KEY,
  adminId TEXT NOT NULL,
  refreshToken TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (adminId) REFERENCES _admins(id)
);

CREATE TABLE IF NOT EXISTS _push_devices (
  userId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deviceInfo TEXT,
  metadata TEXT,
  PRIMARY KEY (userId, deviceId)
);
CREATE INDEX IF NOT EXISTS idx_push_devices_userId ON _push_devices(userId);

CREATE TABLE IF NOT EXISTS _phone_index (
  phone TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  shardId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _passkey_index (
  credentialId TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  shardId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _users_public (
  id TEXT PRIMARY KEY,
  email TEXT,
  displayName TEXT,
  avatarUrl TEXT,
  role TEXT DEFAULT 'user',
  isAnonymous INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_public_email ON _users_public(email);

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _users (
  id TEXT PRIMARY KEY,
  email TEXT,
  passwordHash TEXT,
  displayName TEXT,
  avatarUrl TEXT,
  emailVisibility TEXT DEFAULT 'private',
  role TEXT DEFAULT 'user',
  verified INTEGER DEFAULT 0,
  isAnonymous INTEGER DEFAULT 0,
  customClaims TEXT,
  phone TEXT,
  phoneVerified INTEGER DEFAULT 0,
  metadata TEXT,
  appMetadata TEXT,
  disabled INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  locale TEXT DEFAULT 'en',
  lastSignedInAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON _users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone ON _users(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS _sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  refreshToken TEXT NOT NULL,
  previousRefreshToken TEXT,
  rotatedAt TEXT,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refreshToken ON _sessions(refreshToken);
CREATE INDEX IF NOT EXISTS idx_sessions_userId ON _sessions(userId);
CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON _sessions(expiresAt);

CREATE TABLE IF NOT EXISTS _oauth_accounts (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  provider TEXT NOT NULL,
  providerUserId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_user ON _oauth_accounts(provider, providerUserId);
CREATE INDEX IF NOT EXISTS idx_oauth_userId ON _oauth_accounts(userId);

CREATE TABLE IF NOT EXISTS _email_tokens (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  type TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_userId ON _email_tokens(userId);
CREATE INDEX IF NOT EXISTS idx_email_tokens_expiresAt ON _email_tokens(expiresAt);

CREATE TABLE IF NOT EXISTS _mfa_factors (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'totp',
  secret TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE INDEX IF NOT EXISTS idx_mfa_factors_userId ON _mfa_factors(userId);

CREATE TABLE IF NOT EXISTS _mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  codeHash TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_userId ON _mfa_recovery_codes(userId);

CREATE TABLE IF NOT EXISTS _webauthn_credentials (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  credentialId TEXT NOT NULL,
  credentialPublicKey TEXT NOT NULL,
  counter INTEGER DEFAULT 0,
  transports TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE INDEX IF NOT EXISTS idx_webauthn_userId ON _webauthn_credentials(userId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentialId ON _webauthn_credentials(credentialId);

`;

export const AUTH_PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS _email_index (
  email TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  shardId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _oauth_index (
  provider TEXT NOT NULL,
  providerUserId TEXT NOT NULL,
  userId TEXT NOT NULL,
  shardId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, providerUserId)
);

CREATE TABLE IF NOT EXISTS _anon_index (
  userId TEXT PRIMARY KEY,
  shardId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _admins (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _admin_sessions (
  id TEXT PRIMARY KEY,
  adminId TEXT NOT NULL,
  refreshToken TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (adminId) REFERENCES _admins(id)
);

CREATE TABLE IF NOT EXISTS _push_devices (
  userId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deviceInfo TEXT,
  metadata TEXT,
  PRIMARY KEY (userId, deviceId)
);
CREATE INDEX IF NOT EXISTS idx_push_devices_userId ON _push_devices(userId);

CREATE TABLE IF NOT EXISTS _phone_index (
  phone TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  shardId INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _passkey_index (
  credentialId TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  shardId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _users_public (
  id TEXT PRIMARY KEY,
  email TEXT,
  displayName TEXT,
  avatarUrl TEXT,
  role TEXT DEFAULT 'user',
  isAnonymous INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_public_email ON _users_public(email);

CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _users (
  id TEXT PRIMARY KEY,
  email TEXT,
  passwordHash TEXT,
  displayName TEXT,
  avatarUrl TEXT,
  emailVisibility TEXT DEFAULT 'private',
  role TEXT DEFAULT 'user',
  verified INTEGER DEFAULT 0,
  isAnonymous INTEGER DEFAULT 0,
  customClaims TEXT,
  phone TEXT,
  phoneVerified INTEGER DEFAULT 0,
  metadata TEXT,
  appMetadata TEXT,
  disabled INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  locale TEXT DEFAULT 'en',
  lastSignedInAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON _users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone ON _users(phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS _sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  refreshToken TEXT NOT NULL,
  previousRefreshToken TEXT,
  rotatedAt TEXT,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_refreshToken ON _sessions(refreshToken);
CREATE INDEX IF NOT EXISTS idx_sessions_userId ON _sessions(userId);
CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON _sessions(expiresAt);

CREATE TABLE IF NOT EXISTS _oauth_accounts (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  provider TEXT NOT NULL,
  providerUserId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_user ON _oauth_accounts(provider, providerUserId);
CREATE INDEX IF NOT EXISTS idx_oauth_userId ON _oauth_accounts(userId);

CREATE TABLE IF NOT EXISTS _email_tokens (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  type TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_userId ON _email_tokens(userId);
CREATE INDEX IF NOT EXISTS idx_email_tokens_expiresAt ON _email_tokens(expiresAt);

CREATE TABLE IF NOT EXISTS _mfa_factors (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'totp',
  secret TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE INDEX IF NOT EXISTS idx_mfa_factors_userId ON _mfa_factors(userId);

CREATE TABLE IF NOT EXISTS _mfa_recovery_codes (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  codeHash TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_userId ON _mfa_recovery_codes(userId);

CREATE TABLE IF NOT EXISTS _webauthn_credentials (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  credentialId TEXT NOT NULL,
  credentialPublicKey TEXT NOT NULL,
  counter INTEGER DEFAULT 0,
  transports TEXT,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES _users(id)
);
CREATE INDEX IF NOT EXISTS idx_webauthn_userId ON _webauthn_credentials(userId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentialId ON _webauthn_credentials(credentialId);

`;

// ─── Schema Initialization ───

let schemaInitialized = false;

export async function ensureAuthSchema(db: AuthDb): Promise<void> {
  if (schemaInitialized) return;

  const schemaText = db.dialect === 'postgres' ? AUTH_PG_SCHEMA : AUTH_D1_SCHEMA;

  const statements = schemaText
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  await db.batch(statements.map((sql) => ({ sql })));

  // Migrate existing _users tables: add lastSignedInAt if missing
  try {
    await db.run('ALTER TABLE _users ADD COLUMN lastSignedInAt TEXT', []);
  } catch {
    // Column already exists — safe to ignore
  }

  schemaInitialized = true;
}

// Reset for testing
export function resetSchemaInit(): void {
  schemaInitialized = false;
}

// ─── Email Index ───

export async function lookupEmail(
  db: AuthDb,
  email: string,
): Promise<{ userId: string; shardId: number } | null> {
  // Clean stale pending first
  const pendingCutoff = new Date(Date.now() - PENDING_EXPIRY_MINUTES * 60000).toISOString();
  await db.run(
    `DELETE FROM _email_index WHERE email = ? AND status = 'pending' AND createdAt < ?`,
    [email, pendingCutoff],
  );
  // Also clean up to 10 stale records for other emails
  await db.run(
    `DELETE FROM _email_index WHERE status = 'pending' AND createdAt < ? LIMIT 10`,
    [pendingCutoff],
  );

  const result = await db.first<{ userId: string; shardId: number }>(
    `SELECT userId, shardId FROM _email_index WHERE email = ? AND status = 'confirmed'`,
    [email],
  );

  return result || null;
}

export async function registerEmailPending(
  db: AuthDb,
  email: string,
  userId: string,
): Promise<void> {
  // Check for existing confirmed
  const existing = await db.first<{ email: string; status: string }>(
    `SELECT email, status FROM _email_index WHERE email = ?`,
    [email],
  );

  if (existing) {
    if (existing.status === 'confirmed') {
      throw new Error('EMAIL_ALREADY_REGISTERED');
    }
    // Still pending — clean it and proceed
    await db.run(
      `DELETE FROM _email_index WHERE email = ? AND status = 'pending'`,
      [email],
    );
  }

  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO _email_index (email, userId, shardId, status, createdAt) VALUES (?, ?, ?, 'pending', ?)`,
    [email, userId, 0, now],
  );
}

export async function confirmEmail(
  db: AuthDb,
  email: string,
  userId: string,
): Promise<void> {
  await db.run(
    `UPDATE _email_index SET status = 'confirmed' WHERE email = ? AND userId = ?`,
    [email, userId],
  );
}

export async function deleteEmailPending(
  db: AuthDb,
  email: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _email_index WHERE email = ? AND status = 'pending'`,
    [email],
  );
}

export async function deleteEmail(
  db: AuthDb,
  email: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _email_index WHERE email = ?`,
    [email],
  );
}

// ─── OAuth Index ───

export async function lookupOAuth(
  db: AuthDb,
  provider: string,
  providerUserId: string,
): Promise<{ userId: string; shardId: number } | null> {
  // Clean stale pending
  const pendingCutoff = new Date(Date.now() - PENDING_EXPIRY_MINUTES * 60000).toISOString();
  await db.run(
    `DELETE FROM _oauth_index WHERE provider = ? AND providerUserId = ? AND status = 'pending' AND createdAt < ?`,
    [provider, providerUserId, pendingCutoff],
  );

  const result = await db.first<{ userId: string; shardId: number }>(
    `SELECT userId, shardId FROM _oauth_index WHERE provider = ? AND providerUserId = ? AND status = 'confirmed'`,
    [provider, providerUserId],
  );

  return result || null;
}

export async function registerOAuthPending(
  db: AuthDb,
  provider: string,
  providerUserId: string,
  userId: string,
): Promise<void> {
  // Clean stale pending (5 min)
  const pendingCutoff = new Date(Date.now() - PENDING_EXPIRY_MINUTES * 60000).toISOString();
  await db.run(
    `DELETE FROM _oauth_index WHERE provider = ? AND providerUserId = ? AND status = 'pending' AND createdAt < ?`,
    [provider, providerUserId, pendingCutoff],
  );
  // Also clean other stale pending (max 10)
  await db.run(
    `DELETE FROM _oauth_index WHERE status = 'pending' AND createdAt < ? LIMIT 10`,
    [pendingCutoff],
  );
  const existing = await db.first<{ userId: string; status: string }>(
    `SELECT userId, status FROM _oauth_index WHERE provider = ? AND providerUserId = ?`,
    [provider, providerUserId],
  );
  if (existing) {
    if (existing.status === 'confirmed') {
      throw new Error('OAUTH_ALREADY_LINKED');
    }
    // Allow immediate retry after a partially failed OAuth signup/link flow.
    await db.run(
      `DELETE FROM _oauth_index WHERE provider = ? AND providerUserId = ? AND status = 'pending'`,
      [provider, providerUserId],
    );
  }
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO _oauth_index (provider, providerUserId, userId, shardId, status, createdAt) VALUES (?, ?, ?, ?, 'pending', ?)`,
    [provider, providerUserId, userId, 0, now],
  );
}

export async function confirmOAuth(
  db: AuthDb,
  provider: string,
  providerUserId: string,
): Promise<void> {
  await db.run(
    `UPDATE _oauth_index SET status = 'confirmed' WHERE provider = ? AND providerUserId = ?`,
    [provider, providerUserId],
  );
}

export async function deleteOAuth(
  db: AuthDb,
  provider: string,
  providerUserId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _oauth_index WHERE provider = ? AND providerUserId = ?`,
    [provider, providerUserId],
  );
}

// ─── Anonymous Index ───

export async function registerAnonPending(
  db: AuthDb,
  userId: string,
): Promise<void> {
  // Clean stale anon pending records
  const pendingCutoff = new Date(Date.now() - PENDING_EXPIRY_MINUTES * 60000).toISOString();
  await db.run(
    `DELETE FROM _anon_index WHERE status = 'pending' AND createdAt < ? LIMIT 10`,
    [pendingCutoff],
  );

  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO _anon_index (userId, shardId, status, createdAt) VALUES (?, ?, 'pending', ?)`,
    [userId, 0, now],
  );
}

export async function confirmAnon(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.run(
    `UPDATE _anon_index SET status = 'confirmed' WHERE userId = ?`,
    [userId],
  );
}

export async function deleteAnon(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _anon_index WHERE userId = ?`,
    [userId],
  );
}

export async function batchDeleteAnon(
  db: AuthDb,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await db.batch(
    userIds.map((uid) => ({
      sql: `DELETE FROM _anon_index WHERE userId = ?`,
      params: [uid],
    })),
  );
}

// ─── Admin ───

export async function getAdminByEmail(
  db: AuthDb,
  email: string,
): Promise<{ id: string; email: string; passwordHash: string; createdAt: string; updatedAt: string } | null> {
  // Lazy delete expired sessions
  const now = new Date().toISOString();
  await db.run(
    `DELETE FROM _admin_sessions WHERE expiresAt < ?`,
    [now],
  );

  const result = await db.first<{ id: string; email: string; passwordHash: string; createdAt: string; updatedAt: string }>(
    `SELECT * FROM _admins WHERE email = ?`,
    [email],
  );
  return result || null;
}

export async function getAdminById(
  db: AuthDb,
  id: string,
): Promise<{ id: string; email: string; passwordHash: string; createdAt: string; updatedAt: string } | null> {
  const result = await db.first<{ id: string; email: string; passwordHash: string; createdAt: string; updatedAt: string }>(
    `SELECT * FROM _admins WHERE id = ?`,
    [id],
  );
  return result || null;
}

export async function adminExists(db: AuthDb): Promise<boolean> {
  const result = await db.first<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM _admins`);
  return (result?.cnt ?? 0) > 0;
}

export async function createAdmin(
  db: AuthDb,
  id: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO _admins (id, email, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
    [id, email, passwordHash, now, now],
  );
}

export async function getAdminSession(
  db: AuthDb,
  refreshToken: string,
): Promise<{ id: string; adminId: string; refreshToken: string; expiresAt: string; createdAt: string } | null> {
  const now = new Date().toISOString();
  const result = await db.first<{ id: string; adminId: string; refreshToken: string; expiresAt: string; createdAt: string }>(
    `SELECT * FROM _admin_sessions WHERE refreshToken = ? AND expiresAt > ?`,
    [refreshToken, now],
  );
  return result || null;
}

export async function createAdminSession(
  db: AuthDb,
  id: string,
  adminId: string,
  refreshToken: string,
  expiresAt: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO _admin_sessions (id, adminId, refreshToken, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)`,
    [id, adminId, refreshToken, expiresAt, now],
  );
}

export async function deleteAdminSession(
  db: AuthDb,
  sessionId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _admin_sessions WHERE id = ?`,
    [sessionId],
  );
}

// ─── Admin Management ───

export async function listAdmins(
  db: AuthDb,
): Promise<Array<{ id: string; email: string; createdAt: string; updatedAt: string }>> {
  return db.query<{ id: string; email: string; createdAt: string; updatedAt: string }>(
    `SELECT id, email, createdAt, updatedAt FROM _admins ORDER BY createdAt ASC`,
  );
}

export async function deleteAdmin(
  db: AuthDb,
  id: string,
): Promise<void> {
  await db.run(`DELETE FROM _admin_sessions WHERE adminId = ?`, [id]);
  await db.run(`DELETE FROM _admins WHERE id = ?`, [id]);
}

export async function updateAdminPassword(
  db: AuthDb,
  id: string,
  passwordHash: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.batch([
    {
      sql: `UPDATE _admins SET passwordHash = ?, updatedAt = ? WHERE id = ?`,
      params: [passwordHash, now, id],
    },
    {
      sql: `DELETE FROM _admin_sessions WHERE adminId = ?`,
      params: [id],
    },
  ]);
}

// ─── User Listing (for Admin API) ───

export async function listUserMappings(
  db: AuthDb,
  limit: number,
  offset: number,
): Promise<{ mappings: { userId: string; shardId: number }[]; total: number }> {
  const total = await countUsers(db);

  // UNION ALL across all index tables, deduplicate by userId
  const results = await db.query<{ userId: string; shardId: number }>(`
    SELECT DISTINCT userId, shardId FROM (
      SELECT userId, shardId FROM _email_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId, shardId FROM _oauth_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId, shardId FROM _anon_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId, shardId FROM _phone_index WHERE status = 'confirmed'
    ) ORDER BY userId DESC LIMIT ? OFFSET ?
  `, [limit + 1, offset]);

  const mappings = results.slice(0, limit);
  return { mappings, total };
}

export async function searchUserMappingsByEmail(
  db: AuthDb,
  emailQuery: string,
  limit: number,
  offset: number,
): Promise<{ mappings: { userId: string; shardId: number }[]; total: number }> {
  const likePattern = `%${emailQuery.toLowerCase()}%`;
  const countResult = await db.first<{ count: number }>(`
    SELECT COUNT(DISTINCT userId) as count FROM _email_index
    WHERE email LIKE ? AND status = 'confirmed'
  `, [likePattern]);
  const results = await db.query<{ userId: string; shardId: number }>(`
    SELECT DISTINCT userId, shardId FROM _email_index
    WHERE email LIKE ? AND status = 'confirmed'
    ORDER BY userId DESC LIMIT ? OFFSET ?
  `, [likePattern, limit + 1, offset]);

  const mappings = results.slice(0, limit);
  return { mappings, total: countResult?.count ?? 0 };
}

export async function countUsers(db: AuthDb): Promise<number> {
  const result = await db.first<{ count: number }>(`
    SELECT COUNT(DISTINCT userId) as count FROM (
      SELECT userId FROM _email_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId FROM _oauth_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId FROM _anon_index WHERE status = 'confirmed'
      UNION ALL
      SELECT userId FROM _phone_index WHERE status = 'confirmed'
    )
  `);
  return result?.count ?? 0;
}

// ─── Phone Index ───

export async function lookupPhone(
  db: AuthDb,
  phone: string,
): Promise<{ userId: string; shardId: number } | null> {
  // Clean stale pending first
  const pendingCutoff = new Date(Date.now() - PENDING_EXPIRY_MINUTES * 60000).toISOString();
  await db.run(
    `DELETE FROM _phone_index WHERE phone = ? AND status = 'pending' AND createdAt < ?`,
    [phone, pendingCutoff],
  );

  const result = await db.first<{ userId: string; shardId: number }>(
    `SELECT userId, shardId FROM _phone_index WHERE phone = ? AND status = 'confirmed'`,
    [phone],
  );

  return result || null;
}

export async function registerPhonePending(
  db: AuthDb,
  phone: string,
  userId: string,
): Promise<void> {
  const existing = await db.first<{ phone: string; status: string }>(
    `SELECT phone, status FROM _phone_index WHERE phone = ?`,
    [phone],
  );

  if (existing) {
    if (existing.status === 'confirmed') {
      throw new Error('PHONE_ALREADY_REGISTERED');
    }
    await db.run(
      `DELETE FROM _phone_index WHERE phone = ? AND status = 'pending'`,
      [phone],
    );
  }

  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO _phone_index (phone, userId, shardId, status, createdAt) VALUES (?, ?, ?, 'pending', ?)`,
    [phone, userId, 0, now],
  );
}

export async function confirmPhone(
  db: AuthDb,
  phone: string,
  userId: string,
): Promise<void> {
  await db.run(
    `UPDATE _phone_index SET status = 'confirmed' WHERE phone = ? AND userId = ?`,
    [phone, userId],
  );
}

export async function deletePhone(
  db: AuthDb,
  phone: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _phone_index WHERE phone = ?`,
    [phone],
  );
}

// ─── KV Token Mapping Helpers ───

export async function lookupTokenShard(
  kv: KVNamespace,
  token: string,
): Promise<number | null> {
  const value = await kv.get(`email-token:${token}`);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { shardId: number };
    return parsed.shardId;
  } catch {
    return null;
  }
}

export async function deleteTokenMapping(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  await kv.delete(`email-token:${token}`);
}

// ─── Passkey Index ───

export async function lookupPasskey(
  db: AuthDb,
  credentialId: string,
): Promise<{ userId: string; shardId: number } | null> {
  const result = await db.first<{ userId: string; shardId: number }>(
    `SELECT userId, shardId FROM _passkey_index WHERE credentialId = ?`,
    [credentialId],
  );
  return result || null;
}

export async function registerPasskey(
  db: AuthDb,
  credentialId: string,
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO _passkey_index (credentialId, userId, shardId, createdAt) VALUES (?, ?, ?, ?)`,
    [credentialId, userId, 0, now],
  );
}

export async function deletePasskey(
  db: AuthDb,
  credentialId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _passkey_index WHERE credentialId = ?`,
    [credentialId],
  );
}

export async function deletePasskeysByUser(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM _passkey_index WHERE userId = ?`,
    [userId],
  );
}

// ─── Users Public (denormalized public profiles) ───

export interface UserPublicData {
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  role?: string;
  isAnonymous?: boolean | number;
  createdAt: string;
  updatedAt: string;
}

export async function upsertUserPublic(
  db: AuthDb,
  userId: string,
  data: UserPublicData,
): Promise<void> {
  const params = [
    userId,
    data.email ?? null,
    data.displayName ?? null,
    data.avatarUrl ?? null,
    data.role ?? 'user',
    data.isAnonymous ? 1 : 0,
    data.createdAt,
    data.updatedAt,
  ];

  if (db.dialect === 'postgres') {
    await db.run(`
      INSERT INTO _users_public (id, email, displayName, avatarUrl, role, isAnonymous, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        displayName = EXCLUDED.displayName,
        avatarUrl = EXCLUDED.avatarUrl,
        role = EXCLUDED.role,
        isAnonymous = EXCLUDED.isAnonymous,
        createdAt = EXCLUDED.createdAt,
        updatedAt = EXCLUDED.updatedAt
    `, params);
  } else {
    await db.run(`
      INSERT OR REPLACE INTO _users_public (id, email, displayName, avatarUrl, role, isAnonymous, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, params);
  }
}

export async function deleteUserPublic(
  db: AuthDb,
  userId: string,
): Promise<void> {
  await db.run(`DELETE FROM _users_public WHERE id = ?`, [userId]);
}

export async function batchDeleteUserPublic(
  db: AuthDb,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await db.batch(
    userIds.map((uid) => ({
      sql: `DELETE FROM _users_public WHERE id = ?`,
      params: [uid],
    })),
  );
}

export async function getUserPublic(
  db: AuthDb,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const result = await db.first(
    `SELECT * FROM _users_public WHERE id = ?`,
    [userId],
  );
  return result || null;
}

export async function listUsersPublic(
  db: AuthDb,
  limit: number,
  offset: number,
): Promise<{ users: Record<string, unknown>[]; total: number }> {
  const countResult = await db.first<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM _users_public`);
  const total = countResult?.cnt ?? 0;

  const users = await db.query<Record<string, unknown>>(
    `SELECT * FROM _users_public ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  return { users, total };
}

// Signup rate limiting removed — now handled by AUTH_SIGNUP_RATE_LIMITER Binding

// Note: _isolated_do_registry table and helper functions removed.
// Orphan Isolated DO cleanup is now handled by Auth Shard Config-Scan + DATABASE binding.
// Auth Shard enumerates user-namespaced DB blocks (e.g. user:{id}) from the bundled config
// and drops their DOs directly at user deletion time (#133 §2). No D1 registry or KV signaling needed.
