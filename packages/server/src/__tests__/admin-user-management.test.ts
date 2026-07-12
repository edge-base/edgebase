import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthDb } from '../lib/auth-db-adapter.js';

const {
  confirmEmailMock,
  confirmPhoneMock,
  deleteEmailMock,
  deleteEmailForUserMock,
  deleteEmailPendingMock,
  deletePhoneMock,
  deletePhonePendingMock,
  registerEmailPendingMock,
  registerPhonePendingMock,
  createUserMock,
  finalizeManagedUserCreationMock,
  getUserByIdMock,
  updateUserMock,
  finalizeManagedUserUpdateMock,
  buildPublicUserDataMock,
  syncPublicUserProjectionMock,
  deletePublicUserProjectionMock,
  unregisterAllTokensMock,
  hashPasswordMock,
  isPasswordHashMock,
} = vi.hoisted(() => ({
  confirmEmailMock: vi.fn(),
  confirmPhoneMock: vi.fn(),
  deleteEmailMock: vi.fn(),
  deleteEmailForUserMock: vi.fn(),
  deleteEmailPendingMock: vi.fn(),
  deletePhoneMock: vi.fn(),
  deletePhonePendingMock: vi.fn(),
  registerEmailPendingMock: vi.fn(),
  registerPhonePendingMock: vi.fn(),
  createUserMock: vi.fn(),
  finalizeManagedUserCreationMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  updateUserMock: vi.fn(),
  finalizeManagedUserUpdateMock: vi.fn(),
  buildPublicUserDataMock: vi.fn(),
  syncPublicUserProjectionMock: vi.fn(),
  deletePublicUserProjectionMock: vi.fn(),
  unregisterAllTokensMock: vi.fn(),
  hashPasswordMock: vi.fn(),
  isPasswordHashMock: vi.fn(),
}));

vi.mock('../lib/auth-d1.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-d1.js')>('../lib/auth-d1.js');
  return {
    ...actual,
    confirmEmail: confirmEmailMock,
    confirmPhone: confirmPhoneMock,
    deleteEmail: deleteEmailMock,
    deleteEmailForUser: deleteEmailForUserMock,
    deleteEmailPending: deleteEmailPendingMock,
    deletePhone: deletePhoneMock,
    deletePhonePending: deletePhonePendingMock,
    registerEmailPending: registerEmailPendingMock,
    registerPhonePending: registerPhonePendingMock,
  };
});

vi.mock('../lib/auth-d1-service.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-d1-service.js')>('../lib/auth-d1-service.js');
  return {
    ...actual,
    buildPublicUserData: buildPublicUserDataMock,
    createUser: createUserMock,
    finalizeManagedUserCreation: finalizeManagedUserCreationMock,
    getUserById: getUserByIdMock,
    updateUser: updateUserMock,
    finalizeManagedUserUpdate: finalizeManagedUserUpdateMock,
  };
});

vi.mock('../lib/public-user-profile.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/public-user-profile.js')>('../lib/public-user-profile.js');
  return {
    ...actual,
    deletePublicUserProjection: deletePublicUserProjectionMock,
    syncPublicUserProjection: syncPublicUserProjectionMock,
  };
});

vi.mock('../lib/push-token.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/push-token.js')>('../lib/push-token.js');
  return {
    ...actual,
    unregisterAllTokens: unregisterAllTokensMock,
  };
});

vi.mock('../lib/password.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/password.js')>('../lib/password.js');
  return {
    ...actual,
    hashPassword: hashPasswordMock,
    isPasswordHash: isPasswordHashMock,
  };
});

import {
  createManagedAdminUser,
  deleteManagedAdminUser,
  normalizeAdminUserUpdates,
  prepareImportedPasswordHash,
  updateManagedAdminUser,
} from '../lib/admin-user-management.js';

function createMockAuthDb(): AuthDb & {
  _batchStatements: Array<{ sql: string; params?: unknown[] }>;
} {
  const batchStatements: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    dialect: 'sqlite',
    async query<T = Record<string, unknown>>(): Promise<T[]> {
      return [];
    },
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      return null;
    },
    async run(): Promise<void> {},
    async compareAndSwapAdminSession(): Promise<boolean> {
      return false;
    },
    async compareAndSwapUserSession(): Promise<boolean> {
      return false;
    },
    async createSessionWithLimit(): Promise<void> {},
    async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
      batchStatements.push(...statements);
    },
    async batchWithLock(_lockKey: string | string[], statements: { sql: string; params?: unknown[] }[]): Promise<void> {
      batchStatements.push(...statements);
    },
    _batchStatements: batchStatements,
  };
}

function createMockKv(options: { deleteError?: Error } = {}): KVNamespace {
  return {
    get: async () => null,
    put: async () => undefined,
    delete: async () => {
      if (options.deleteError) throw options.deleteError;
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
}

beforeEach(() => {
  confirmEmailMock.mockReset().mockResolvedValue(undefined);
  confirmPhoneMock.mockReset().mockResolvedValue(undefined);
  deleteEmailMock.mockReset().mockResolvedValue(undefined);
  deleteEmailForUserMock.mockReset().mockResolvedValue(undefined);
  deleteEmailPendingMock.mockReset().mockResolvedValue(undefined);
  deletePhoneMock.mockReset().mockResolvedValue(undefined);
  deletePhonePendingMock.mockReset().mockResolvedValue(undefined);
  registerEmailPendingMock.mockReset().mockResolvedValue('email-reservation-test');
  registerPhonePendingMock.mockReset().mockResolvedValue('phone-reservation-test');
  createUserMock.mockReset();
  finalizeManagedUserCreationMock.mockReset().mockResolvedValue(undefined);
  getUserByIdMock.mockReset();
  updateUserMock.mockReset();
  finalizeManagedUserUpdateMock.mockReset().mockResolvedValue(undefined);
  buildPublicUserDataMock.mockReset().mockReturnValue({
    displayName: 'Public User',
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
  });
  syncPublicUserProjectionMock.mockReset().mockResolvedValue(undefined);
  deletePublicUserProjectionMock.mockReset().mockResolvedValue(undefined);
  unregisterAllTokensMock.mockReset().mockResolvedValue(undefined);
  hashPasswordMock.mockReset().mockImplementation(async (value: string) => `hashed:${value}`);
  isPasswordHashMock.mockReset().mockImplementation((value: string) => value.startsWith('$2'));
});

describe('normalizeAdminUserUpdates', () => {
  it('normalizes email and hashes password updates', async () => {
    const result = await normalizeAdminUserUpdates({
      email: '  USER@Example.com ',
      password: 'secret123',
      displayName: 'Test User',
    });

    expect(hashPasswordMock).toHaveBeenCalledWith('secret123');
    expect(result).toMatchObject({
      email: 'user@example.com',
      passwordHash: 'hashed:secret123',
      displayName: 'Test User',
    });
    expect('password' in result).toBe(false);
  });
});

describe('createManagedAdminUser', () => {
  it('writes the public projection without blocking on KV cache mirroring', async () => {
    const db = createMockAuthDb();
    const createdUser = {
      id: 'user-1',
      email: 'user@example.com',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    };
    getUserByIdMock.mockResolvedValue(createdUser);

    const user = await createManagedAdminUser(db, {
      userId: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hashed:secret123',
    }, {
      kv: createMockKv(),
    });

    expect(user).toEqual(createdUser);
    expect(finalizeManagedUserCreationMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        user: expect.objectContaining({ userId: 'user-1', email: 'user@example.com' }),
        emailReservationId: 'email-reservation-test',
      }),
    );
    expect(syncPublicUserProjectionMock).toHaveBeenCalledWith(
      db,
      'user-1',
      buildPublicUserDataMock.mock.results[0]?.value,
      expect.objectContaining({ awaitCacheWrites: false }),
    );
  });

  it('does not delete an existing user when caller-supplied id collides', async () => {
    const db = createMockAuthDb();
    finalizeManagedUserCreationMock.mockRejectedValue(new Error('UNIQUE constraint failed: _users.id'));

    await expect(createManagedAdminUser(db, {
      userId: 'existing-user-id',
      email: 'contended@example.com',
      passwordHash: 'hashed:secret123',
    })).rejects.toMatchObject({ code: 500 });

    expect(deleteEmailPendingMock).toHaveBeenCalledWith(
      db,
      'contended@example.com',
      'existing-user-id',
      'email-reservation-test',
    );
    expect(db._batchStatements.some((statement) => (
      statement.sql.includes('DELETE FROM _users WHERE id = ?')
    ))).toBe(false);
    expect(deleteEmailMock).not.toHaveBeenCalledWith(db, 'contended@example.com');
  });
});

describe('deleteManagedAdminUser', () => {
  it('deletes auth rows atomically and downgrades cache invalidation failures to background warnings', async () => {
    const db = createMockAuthDb();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUserByIdMock.mockResolvedValue({ id: 'user-1' });
    unregisterAllTokensMock.mockRejectedValue(new Error('push-cache-down'));

    const deleted = await deleteManagedAdminUser(db, 'user-1', {
      kv: createMockKv({ deleteError: new Error('profile-cache-down') }),
    });

    expect(deleted).toBe(true);
    expect(db._batchStatements.map((statement) => statement.sql)).toEqual(expect.arrayContaining([
      'DELETE FROM _email_index WHERE userId = ?',
      'DELETE FROM _phone_index WHERE userId = ?',
      'DELETE FROM _oauth_index WHERE userId = ?',
      'DELETE FROM _anon_index WHERE userId = ?',
      'DELETE FROM _push_devices WHERE userId = ?',
      'DELETE FROM _users_public WHERE id = ?',
      'DELETE FROM _users WHERE id = ?',
    ]));

    await Promise.resolve();
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('updateManagedAdminUser', () => {
  it('updates the public projection without awaiting KV cache writes', async () => {
    const db = createMockAuthDb();
    const existingUser = {
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'Before',
      authRevision: 4,
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    };
    const updatedUser = {
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'After',
      authRevision: 5,
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:01:00.000Z',
    };
    getUserByIdMock
      .mockResolvedValueOnce(existingUser)
      .mockResolvedValueOnce(updatedUser);

    const updated = await updateManagedAdminUser(db, 'user-1', {
      displayName: 'After',
    }, {
      kv: createMockKv(),
    });

    expect(updated).toMatchObject({ displayName: 'After' });
    expect(finalizeManagedUserUpdateMock).toHaveBeenCalledWith(db, {
      userId: 'user-1',
      expectedAuthRevision: 4,
      updates: { displayName: 'After' },
      contacts: [],
    });
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(syncPublicUserProjectionMock).toHaveBeenCalledWith(
      db,
      'user-1',
      buildPublicUserDataMock.mock.results[0]?.value,
      expect.objectContaining({ awaitCacheWrites: false }),
    );
  });

  it('rejects a stale contact update without rolling back or deleting another winner', async () => {
    const db = createMockAuthDb();
    const existingUser = {
      id: 'user-1',
      email: 'old@example.com',
      displayName: 'Before',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    };
    getUserByIdMock.mockResolvedValue(existingUser);
    finalizeManagedUserUpdateMock.mockRejectedValue(new Error('AUTH_STATE_CONFLICT'));

    await expect(updateManagedAdminUser(db, 'user-1', {
      email: 'new@example.com',
    })).rejects.toMatchObject({ code: 409 });

    expect(registerEmailPendingMock).toHaveBeenCalledWith(db, 'new@example.com', 'user-1');
    expect(finalizeManagedUserUpdateMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: 'user-1',
        expectedAuthRevision: 0,
        contacts: [expect.objectContaining({
          kind: 'email',
          previousValue: 'old@example.com',
          nextValue: 'new@example.com',
          reservationId: 'email-reservation-test',
        })],
      }),
    );
    expect(deleteEmailPendingMock).toHaveBeenCalledWith(
      db,
      'new@example.com',
      'user-1',
      'email-reservation-test',
    );
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(confirmEmailMock).not.toHaveBeenCalled();
    expect(deleteEmailForUserMock).not.toHaveBeenCalled();
    expect(syncPublicUserProjectionMock).not.toHaveBeenCalled();
  });
});

describe('prepareImportedPasswordHash', () => {
  it('reuses valid hashes and hashes plain passwords', async () => {
    const existingHash = '$2b$12$abcdefghijklmnopqrstuv';

    await expect(prepareImportedPasswordHash({ passwordHash: existingHash })).resolves.toBe(existingHash);
    await expect(prepareImportedPasswordHash({ password: 'secret123' })).resolves.toBe('hashed:secret123');
    expect(hashPasswordMock).toHaveBeenCalledWith('secret123');
  });
});
