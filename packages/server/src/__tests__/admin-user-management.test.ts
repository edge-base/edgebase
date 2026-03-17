import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthDb } from '../lib/auth-db-adapter.js';

const {
  confirmEmailMock,
  confirmPhoneMock,
  deleteEmailMock,
  deleteEmailPendingMock,
  deletePhoneMock,
  registerEmailPendingMock,
  registerPhonePendingMock,
  createUserMock,
  getUserByIdMock,
  updateUserMock,
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
  deleteEmailPendingMock: vi.fn(),
  deletePhoneMock: vi.fn(),
  registerEmailPendingMock: vi.fn(),
  registerPhonePendingMock: vi.fn(),
  createUserMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  updateUserMock: vi.fn(),
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
    deleteEmailPending: deleteEmailPendingMock,
    deletePhone: deletePhoneMock,
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
    getUserById: getUserByIdMock,
    updateUser: updateUserMock,
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
    async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
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
  deleteEmailPendingMock.mockReset().mockResolvedValue(undefined);
  deletePhoneMock.mockReset().mockResolvedValue(undefined);
  registerEmailPendingMock.mockReset().mockResolvedValue(undefined);
  registerPhonePendingMock.mockReset().mockResolvedValue(undefined);
  createUserMock.mockReset();
  getUserByIdMock.mockReset();
  updateUserMock.mockReset();
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
    createUserMock.mockResolvedValue(createdUser);

    const user = await createManagedAdminUser(db, {
      userId: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hashed:secret123',
    }, {
      kv: createMockKv(),
    });

    expect(user).toEqual(createdUser);
    expect(confirmEmailMock).toHaveBeenCalledWith(db, 'user@example.com', 'user-1');
    expect(syncPublicUserProjectionMock).toHaveBeenCalledWith(
      db,
      'user-1',
      buildPublicUserDataMock.mock.results[0]?.value,
      expect.objectContaining({ awaitCacheWrites: false }),
    );
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
    getUserByIdMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'Before',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    });
    updateUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      displayName: 'After',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:01:00.000Z',
    });

    const updated = await updateManagedAdminUser(db, 'user-1', {
      displayName: 'After',
    }, {
      kv: createMockKv(),
    });

    expect(updated).toMatchObject({ displayName: 'After' });
    expect(syncPublicUserProjectionMock).toHaveBeenCalledWith(
      db,
      'user-1',
      buildPublicUserDataMock.mock.results[0]?.value,
      expect.objectContaining({ awaitCacheWrites: false }),
    );
  });

  it('restores the old email index when cleanup fails after the user row is updated', async () => {
    const db = createMockAuthDb();
    const existingUser = {
      id: 'user-1',
      email: 'old@example.com',
      displayName: 'Before',
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    };
    const updatedUser = {
      ...existingUser,
      email: 'new@example.com',
      updatedAt: '2026-03-10T00:01:00.000Z',
    };

    getUserByIdMock.mockResolvedValue(existingUser);
    updateUserMock
      .mockResolvedValueOnce(updatedUser)
      .mockResolvedValueOnce(existingUser);
    deleteEmailMock.mockImplementation(async (_db: AuthDb, email: string) => {
      if (email === 'old@example.com') {
        throw new Error('delete-old-email-failed');
      }
    });

    await expect(updateManagedAdminUser(db, 'user-1', {
      email: 'new@example.com',
    })).rejects.toMatchObject({ code: 500 });

    expect(registerEmailPendingMock).toHaveBeenCalledWith(db, 'new@example.com', 'user-1');
    expect(confirmEmailMock).toHaveBeenCalledWith(db, 'new@example.com', 'user-1');
    expect(deleteEmailMock).toHaveBeenCalledWith(db, 'old@example.com');
    expect(deleteEmailMock).toHaveBeenCalledWith(db, 'new@example.com');
    expect(registerEmailPendingMock).toHaveBeenCalledWith(db, 'old@example.com', 'user-1');
    expect(confirmEmailMock).toHaveBeenCalledWith(db, 'old@example.com', 'user-1');
    expect(updateUserMock).toHaveBeenCalledTimes(2);
    expect(syncPublicUserProjectionMock).toHaveBeenCalledTimes(2);
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
