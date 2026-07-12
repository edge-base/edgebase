import { EdgeBaseError } from '@edge-base/shared';
import type { AuthDb } from './auth-db-adapter.js';
import {
  deleteEmailPending,
  deletePhonePending,
  registerEmailPending,
  registerPhonePending,
} from './auth-d1.js';
import * as authService from './auth-d1-service.js';
import { invalidatePublicUserCache, syncPublicUserProjection } from './public-user-profile.js';
import { unregisterAllTokens } from './push-token.js';
import { hashPassword, isPasswordHash } from './password.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_STATUSES = new Set(['active', 'suspended', 'banned', 'disabled']);
const VALID_EMAIL_VISIBILITY = new Set(['public', 'private']);
const UPDATABLE_USER_FIELDS = new Set([
  'email', 'passwordHash', 'displayName', 'avatarUrl', 'emailVisibility',
  'role', 'status', 'verified', 'isAnonymous', 'customClaims', 'phone',
  'phoneVerified', 'metadata', 'appMetadata', 'disabled', 'locale',
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

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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

export async function createManagedAdminUser(
  db: AuthDb,
  input: CreateManagedUserInput,
  options: ManagedUserOptions = {},
): Promise<Record<string, unknown>> {
  let emailReservationId: string;
  try {
    emailReservationId = await registerEmailPending(db, input.email, input.userId);
  } catch (err) {
    if (['EMAIL_ALREADY_REGISTERED', 'EMAIL_RESERVATION_CONFLICT'].includes((err as Error).message)) {
      throw new EdgeBaseError(409, 'Email already registered.');
    }
    throw new EdgeBaseError(500, 'User creation failed.');
  }

  try {
    await authService.finalizeManagedUserCreation(db, {
      user: {
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
      },
      emailReservationId,
    });
  } catch (err) {
    // If COMMIT outcome was ambiguous, this owner-scoped delete is a no-op
    // for a transaction that actually confirmed the email. It can never
    // remove an existing user's identity.
    await deleteEmailPending(
      db,
      input.email,
      input.userId,
      emailReservationId,
    ).catch(() => {});
    throw toEdgeBaseError(err, 500, 'User creation failed.');
  }

  const user = await authService.getUserById(db, input.userId);
  if (!user) {
    throw new EdgeBaseError(500, 'User creation completed but the user could not be read.');
  }
  await syncPublicUserProjection(db, input.userId, authService.buildPublicUserData(user), {
    executionCtx: options.executionCtx,
    kv: options.kv,
    awaitCacheWrites: false,
  }).catch((err) => {
    console.error(`[EdgeBase] Failed to sync public profile after creating ${input.userId}:`, err);
  });

  return user;
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
  let emailReservationId: string | null = null;
  let phoneReservationId: string | null = null;

  if (emailChanged && newEmail) {
    try {
      emailReservationId = await registerEmailPending(db, newEmail, userId);
    } catch (err) {
      if (['EMAIL_ALREADY_REGISTERED', 'EMAIL_RESERVATION_CONFLICT'].includes((err as Error).message)) {
        throw new EdgeBaseError(409, 'Email already registered.');
      }
      throw new EdgeBaseError(500, 'User update failed.');
    }
  }

  if (phoneChanged && typeof newPhone === 'string') {
    try {
      phoneReservationId = await registerPhonePending(db, newPhone, userId);
    } catch (err) {
      if (emailChanged && newEmail && emailReservationId) {
        await deleteEmailPending(db, newEmail, userId, emailReservationId).catch(() => {});
      }
      if (['PHONE_ALREADY_REGISTERED', 'PHONE_RESERVATION_CONFLICT'].includes((err as Error).message)) {
        throw new EdgeBaseError(409, 'Phone number is already registered.');
      }
      throw new EdgeBaseError(500, 'User update failed.');
    }
  }

  try {
    await authService.finalizeManagedUserUpdate(db, {
      userId,
      expectedAuthRevision: Number(existing.authRevision ?? 0),
      updates,
      contacts: [
        ...(emailChanged ? [{
          kind: 'email' as const,
          previousValue: oldEmail,
          nextValue: newEmail ?? null,
          reservationId: emailReservationId ?? undefined,
        }] : []),
        ...(phoneChanged ? [{
          kind: 'phone' as const,
          previousValue: oldPhone,
          nextValue: newPhone ?? null,
          reservationId: phoneReservationId ?? undefined,
        }] : []),
      ],
    });
  } catch (err) {
    if (newEmail && emailReservationId) {
      await deleteEmailPending(db, newEmail, userId, emailReservationId).catch(() => {});
    }
    if (typeof newPhone === 'string' && phoneReservationId) {
      await deletePhonePending(db, newPhone, userId, phoneReservationId).catch(() => {});
    }
    if (err instanceof Error && err.message === 'AUTH_STATE_CONFLICT') {
      throw new EdgeBaseError(409, 'User changed concurrently. Retry the update.');
    }
    throw toEdgeBaseError(err, 500, 'User update failed.');
  }

  const user = await authService.getUserById(db, userId);
  if (!user) return null;

  // The canonical auth transaction is committed. Projection refresh is
  // best-effort and must never compensate by overwriting newer auth state.
  await syncPublicUserProjection(db, userId, authService.buildPublicUserData(user), {
    executionCtx: options.executionCtx,
    kv: options.kv,
    awaitCacheWrites: false,
  }).catch((err) => {
    console.error(`[EdgeBase] Failed to sync public profile after updating ${userId}:`, err);
  });

  return user;
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
