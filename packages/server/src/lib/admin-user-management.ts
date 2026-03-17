import { EdgeBaseError } from '@edgebase/shared';
import type { AuthDb } from './auth-db-adapter.js';
import {
  confirmEmail,
  confirmPhone,
  deleteEmail,
  deleteEmailPending,
  deletePhone,
  registerEmailPending,
  registerPhonePending,
} from './auth-d1.js';
import * as authService from './auth-d1-service.js';
import { deletePublicUserProjection, invalidatePublicUserCache, syncPublicUserProjection } from './public-user-profile.js';
import { unregisterAllTokens } from './push-token.js';
import { hashPassword, isPasswordHash } from './password.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_STATUSES = new Set(['active', 'suspended', 'banned', 'disabled']);
const VALID_EMAIL_VISIBILITY = new Set(['public', 'private']);
const UPDATABLE_USER_FIELDS = new Set([
  'email',
  'passwordHash',
  'displayName',
  'avatarUrl',
  'emailVisibility',
  'role',
  'status',
  'verified',
  'isAnonymous',
  'customClaims',
  'phone',
  'phoneVerified',
  'metadata',
  'appMetadata',
  'disabled',
  'locale',
]);

interface ManagedUserOptions {
  executionCtx?: ExecutionContext;
  kv?: KVNamespace;
}

export interface CreateManagedUserInput {
  userId: string;
  email: string;
  passwordHash: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role?: string;
  verified?: boolean;
  locale?: string;
  metadata?: Record<string, unknown> | null;
  appMetadata?: Record<string, unknown> | null;
}

function hasOwn<T extends object>(value: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeOptionalRole(role: unknown): string | undefined {
  if (role === undefined) return undefined;
  if (typeof role !== 'string') {
    throw new EdgeBaseError(400, 'Role must be a non-empty string.');
  }
  const normalized = role.trim();
  if (!normalized) {
    throw new EdgeBaseError(400, 'Role must be a non-empty string.');
  }
  if (normalized.length > 100) {
    throw new EdgeBaseError(400, 'Role must not exceed 100 characters.');
  }
  return normalized;
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    throw new EdgeBaseError(400, 'Invalid phone number. Must be in E.164 format (e.g. +15551234567).');
  }
  return cleaned;
}

async function ensureConfirmedEmailIndex(
  db: AuthDb,
  email: string,
  userId: string,
): Promise<void> {
  try {
    await registerEmailPending(db, email, userId);
  } catch (err) {
    if ((err as Error).message !== 'EMAIL_ALREADY_REGISTERED') {
      throw err;
    }
  }
  await confirmEmail(db, email, userId);
}

async function ensureConfirmedPhoneIndex(
  db: AuthDb,
  phone: string,
  userId: string,
): Promise<void> {
  try {
    await registerPhonePending(db, phone, userId);
  } catch (err) {
    if ((err as Error).message !== 'PHONE_ALREADY_REGISTERED') {
      throw err;
    }
  }
  await confirmPhone(db, phone, userId);
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toRollbackValue(existing: Record<string, unknown>, key: string): unknown {
  if (hasOwn(existing, key)) return existing[key];
  return null;
}

function toEdgeBaseError(
  error: unknown,
  fallbackCode: number,
  fallbackMessage: string,
): EdgeBaseError {
  if (error instanceof EdgeBaseError) return error;
  const message = error instanceof Error && error.message ? error.message : fallbackMessage;
  return new EdgeBaseError(fallbackCode, message);
}

function invalidateManagedUserCaches(
  userId: string,
  options: ManagedUserOptions,
): void {
  const profileTask = invalidatePublicUserCache(userId, {
    kv: options.kv,
    executionCtx: options.executionCtx,
    awaitCacheWrites: false,
  }).catch((err) => {
    console.error(`[EdgeBase] Failed to invalidate public profile cache for ${userId}:`, err);
  });

  if (!options.kv) {
    void profileTask;
    return;
  }

  const pushTask = unregisterAllTokens(options.kv, userId).catch((err) => {
    console.error(`[EdgeBase] Failed to invalidate push token cache for ${userId}:`, err);
  });
  const task = Promise.all([profileTask, pushTask]).then(() => undefined);

  if (options.executionCtx) {
    options.executionCtx.waitUntil(task);
    return;
  }

  void task;
}

export async function normalizeAdminUserUpdates(
  raw: Record<string, unknown>,
): Promise<authService.UpdateUserInput> {
  const updates = { ...raw } as Record<string, unknown>;

  if (hasOwn(updates, 'email')) {
    if (typeof updates.email !== 'string' || !EMAIL_RE.test(updates.email.trim())) {
      throw new EdgeBaseError(400, 'Invalid email format.');
    }
    updates.email = updates.email.trim().toLowerCase();
  }

  if (hasOwn(updates, 'password')) {
    if (typeof updates.password !== 'string') {
      throw new EdgeBaseError(400, 'Password must be a string.');
    }
    if (updates.password.length < 8) {
      throw new EdgeBaseError(400, 'Password must be at least 8 characters.');
    }
    if (updates.password.length > 256) {
      throw new EdgeBaseError(400, 'Password must not exceed 256 characters.');
    }
    updates.passwordHash = await hashPassword(updates.password);
    delete updates.password;
  }

  if (hasOwn(updates, 'passwordHash')) {
    if (typeof updates.passwordHash !== 'string' || updates.passwordHash.length === 0) {
      throw new EdgeBaseError(400, 'Password hash must be a non-empty string.');
    }
  }

  if (hasOwn(updates, 'role')) {
    updates.role = normalizeOptionalRole(updates.role);
  }

  if (hasOwn(updates, 'status')) {
    if (typeof updates.status !== 'string' || !VALID_STATUSES.has(updates.status)) {
      throw new EdgeBaseError(400, 'Invalid status. Must be "active", "suspended", "banned", or "disabled".');
    }
  }

  if (hasOwn(updates, 'displayName')) {
    if (updates.displayName !== null && (typeof updates.displayName !== 'string' || updates.displayName.length > 200)) {
      throw new EdgeBaseError(400, 'Display name must not exceed 200 characters.');
    }
  }

  if (hasOwn(updates, 'avatarUrl')) {
    if (updates.avatarUrl !== null && (typeof updates.avatarUrl !== 'string' || updates.avatarUrl.length > 2048)) {
      throw new EdgeBaseError(400, 'Avatar URL must not exceed 2048 characters.');
    }
  }

  if (hasOwn(updates, 'emailVisibility')) {
    if (typeof updates.emailVisibility !== 'string' || !VALID_EMAIL_VISIBILITY.has(updates.emailVisibility)) {
      throw new EdgeBaseError(400, 'emailVisibility must be "public" or "private".');
    }
  }

  if (hasOwn(updates, 'phone')) {
    if (updates.phone === null) {
      updates.phoneVerified = false;
    } else if (typeof updates.phone === 'string') {
      updates.phone = normalizePhone(updates.phone);
      if (!hasOwn(updates, 'phoneVerified')) {
        updates.phoneVerified = false;
      }
    } else {
      throw new EdgeBaseError(400, 'Phone must be a string in E.164 format or null.');
    }
  }

  if (hasOwn(updates, 'locale')) {
    if (updates.locale !== null && (typeof updates.locale !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(updates.locale))) {
      throw new EdgeBaseError(400, 'Invalid locale format. Expected format: "en" or "en-US".');
    }
  }

  const hasSupportedField = Object.keys(updates).some((key) => UPDATABLE_USER_FIELDS.has(key));
  if (!hasSupportedField) {
    throw new EdgeBaseError(
      400,
      'No valid fields to update. Allowed fields include email, phone, password, displayName, avatarUrl, role, status, metadata, and appMetadata.',
    );
  }

  return updates as authService.UpdateUserInput;
}

async function cleanupCreatedUser(
  db: AuthDb,
  userId: string,
  email: string,
  options: ManagedUserOptions,
): Promise<void> {
  await authService.deleteUserCascade(db, userId).catch(() => {});
  await deletePublicUserProjection(db, userId, {
    executionCtx: options.executionCtx,
    kv: options.kv,
    awaitCacheWrites: true,
  }).catch(() => {});
  await deleteEmailPending(db, email).catch(() => {});
  await deleteEmail(db, email).catch(() => {});
}

export async function createManagedAdminUser(
  db: AuthDb,
  input: CreateManagedUserInput,
  options: ManagedUserOptions = {},
): Promise<Record<string, unknown>> {
  try {
    await registerEmailPending(db, input.email, input.userId);
  } catch (err) {
    if ((err as Error).message === 'EMAIL_ALREADY_REGISTERED') {
      throw new EdgeBaseError(409, 'Email already registered.');
    }
    throw new EdgeBaseError(500, 'User creation failed.');
  }

  let user: Record<string, unknown> | null = null;
  try {
    user = await authService.createUser(db, {
      userId: input.userId,
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      role: input.role || 'user',
      verified: input.verified ?? true,
      locale: input.locale,
      metadata: input.metadata,
      appMetadata: input.appMetadata,
    });

    await confirmEmail(db, input.email, input.userId);
    await syncPublicUserProjection(db, input.userId, authService.buildPublicUserData(user), {
      executionCtx: options.executionCtx,
      kv: options.kv,
      awaitCacheWrites: false,
    });

    return user;
  } catch (err) {
    await cleanupCreatedUser(db, input.userId, input.email, options);
    throw toEdgeBaseError(err, 500, 'User creation failed.');
  }
}

export async function deleteManagedAdminUser(
  db: AuthDb,
  userId: string,
  options: ManagedUserOptions = {},
): Promise<boolean> {
  const user = await authService.getUserById(db, userId);
  if (!user) return false;

  await db.batch([
    { sql: `DELETE FROM _email_tokens WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _sessions WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _oauth_accounts WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _mfa_recovery_codes WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _mfa_factors WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _webauthn_credentials WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _passkey_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _email_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _phone_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _oauth_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _anon_index WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _push_devices WHERE userId = ?`, params: [userId] },
    { sql: `DELETE FROM _users_public WHERE id = ?`, params: [userId] },
    { sql: `DELETE FROM _users WHERE id = ?`, params: [userId] },
  ]);

  invalidateManagedUserCaches(userId, options);

  return true;
}

export async function updateManagedAdminUser(
  db: AuthDb,
  userId: string,
  rawUpdates: Record<string, unknown>,
  options: ManagedUserOptions = {},
): Promise<Record<string, unknown> | null> {
  const updates = await normalizeAdminUserUpdates(rawUpdates);
  const existing = await authService.getUserById(db, userId);
  if (!existing) return null;

  const oldEmail = toNullableString(existing.email);
  const oldPhone = toNullableString(existing.phone);
  const newEmail = hasOwn(updates as Record<string, unknown>, 'email')
    ? toNullableString((updates as Record<string, unknown>).email)
    : undefined;
  const newPhone = hasOwn(updates as Record<string, unknown>, 'phone')
    ? ((updates as Record<string, unknown>).phone as string | null)
    : undefined;
  const emailChanged = newEmail !== undefined && newEmail !== oldEmail;
  const phoneChanged = newPhone !== undefined && newPhone !== oldPhone;

  if (emailChanged && newEmail) {
    try {
      await registerEmailPending(db, newEmail, userId);
    } catch (err) {
      if ((err as Error).message === 'EMAIL_ALREADY_REGISTERED') {
        throw new EdgeBaseError(409, 'Email already registered.');
      }
      throw new EdgeBaseError(500, 'User update failed.');
    }
  }

  if (phoneChanged && typeof newPhone === 'string') {
    try {
      await registerPhonePending(db, newPhone, userId);
    } catch (err) {
      if (newEmail) {
        await deleteEmailPending(db, newEmail).catch(() => {});
      }
      if ((err as Error).message === 'PHONE_ALREADY_REGISTERED') {
        throw new EdgeBaseError(409, 'Phone number is already registered.');
      }
      throw new EdgeBaseError(500, 'User update failed.');
    }
  }

  const user = await authService.updateUser(db, userId, updates);
  if (!user) {
    if (newEmail) await deleteEmailPending(db, newEmail).catch(() => {});
    if (typeof newPhone === 'string') await deletePhone(db, newPhone).catch(() => {});
    return null;
  }

  const rollbackUpdates: authService.UpdateUserInput = {};
  for (const key of Object.keys(updates as Record<string, unknown>)) {
    if (UPDATABLE_USER_FIELDS.has(key)) {
      (rollbackUpdates as Record<string, unknown>)[key] = toRollbackValue(existing, key);
    }
  }

  try {
    if (emailChanged && newEmail) {
      await confirmEmail(db, newEmail, userId);
    }
    if (phoneChanged && typeof newPhone === 'string') {
      await confirmPhone(db, newPhone, userId);
    }

    await syncPublicUserProjection(db, userId, authService.buildPublicUserData(user), {
      executionCtx: options.executionCtx,
      kv: options.kv,
      awaitCacheWrites: false,
    });

    if (emailChanged && oldEmail) {
      await deleteEmail(db, oldEmail);
    }
    if (phoneChanged && oldPhone) {
      await deletePhone(db, oldPhone);
    }

    return user;
  } catch (err) {
    await authService.updateUser(db, userId, rollbackUpdates).catch(() => {});
    await syncPublicUserProjection(db, userId, authService.buildPublicUserData(existing), {
      executionCtx: options.executionCtx,
      kv: options.kv,
      awaitCacheWrites: false,
    }).catch(() => {});
    if (newEmail) await deleteEmail(db, newEmail).catch(() => {});
    if (emailChanged && oldEmail) {
      await ensureConfirmedEmailIndex(db, oldEmail, userId).catch((restoreErr) => {
        console.error(`[EdgeBase] Failed to restore old email index for ${userId}:`, restoreErr);
      });
    }
    if (typeof newPhone === 'string') await deletePhone(db, newPhone).catch(() => {});
    if (phoneChanged && oldPhone) {
      await ensureConfirmedPhoneIndex(db, oldPhone, userId).catch((restoreErr) => {
        console.error(`[EdgeBase] Failed to restore old phone index for ${userId}:`, restoreErr);
      });
    }
    throw toEdgeBaseError(err, 500, 'User update failed.');
  }
}

export async function prepareImportedPasswordHash(user: {
  passwordHash?: string;
  password?: string;
}): Promise<string> {
  if (user.passwordHash && isPasswordHash(user.passwordHash)) {
    return user.passwordHash;
  }
  if (user.password) {
    if (user.password.length < 8) {
      throw new EdgeBaseError(400, 'Password must be at least 8 characters.');
    }
    if (user.password.length > 256) {
      throw new EdgeBaseError(400, 'Password must not exceed 256 characters.');
    }
    return hashPassword(user.password);
  }
  return '';
}
