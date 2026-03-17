/**
 * 서버 단위 테스트 — lib/auth-d1.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/auth-d1.test.ts
 *
 * 테스트 대상:
 *   ensureAuthSchema / resetSchemaInit — 스키마 초기화 idempotency
 *   Email index — lookup, register pending, confirm, delete
 *   OAuth index — lookup, register pending (duplicate), confirm, delete
 *   Phone index — lookup, register pending (duplicate), confirm, delete
 *   Anon index — register, confirm, delete, batchDelete
 *   Admin CRUD — create, getByEmail, getById, adminExists
 *   Admin sessions — create, get, delete
 *   User listing — listUserMappings, searchUserMappingsByEmail, countUsers
 *   KV token helpers — lookupTokenShard, deleteTokenMapping
 *   Passkey index — lookup, register, delete, deleteByUser
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ensureAuthSchema,
  resetSchemaInit,
  lookupEmail,
  registerEmailPending,
  confirmEmail,
  deleteEmailPending,
  deleteEmail,
  lookupOAuth,
  registerOAuthPending,
  confirmOAuth,
  deleteOAuth,
  registerAnonPending,
  confirmAnon,
  deleteAnon,
  batchDeleteAnon,
  getAdminByEmail,
  getAdminById,
  adminExists,
  createAdmin,
  getAdminSession,
  createAdminSession,
  deleteAdminSession,
  updateAdminPassword,
  listUserMappings,
  searchUserMappingsByEmail,
  countUsers,
  lookupPhone,
  registerPhonePending,
  confirmPhone,
  deletePhone,
  lookupTokenShard,
  deleteTokenMapping,
  lookupPasskey,
  registerPasskey,
  deletePasskey,
  deletePasskeysByUser,
} from '../lib/auth-d1.js';
import type { AuthDb } from '../lib/auth-db-adapter.js';

// ─── Mock AuthDb ─────────────────────────────────────────────────────────────

interface MockCall {
  sql: string;
  bindings: unknown[];
  method: 'first' | 'query' | 'run';
}

function createMockAuthDb(options: {
  firstResult?: unknown;
  queryResult?: unknown[];
  /** Per-call results: return different values for sequential first() calls */
  firstResults?: unknown[];
} = {}): AuthDb & { _calls: MockCall[]; _batchCalls: number } {
  const calls: MockCall[] = [];
  let firstCallIdx = 0;
  let batchCalls = 0;

  const db: any = {
    dialect: 'sqlite' as const,

    async first(sql: string, params?: unknown[]) {
      const call: MockCall = { sql, bindings: params ?? [], method: 'first' };
      calls.push(call);
      if (options.firstResults && firstCallIdx < options.firstResults.length) {
        return options.firstResults[firstCallIdx++];
      }
      return options.firstResult ?? null;
    },

    async query(sql: string, params?: unknown[]) {
      const call: MockCall = { sql, bindings: params ?? [], method: 'query' };
      calls.push(call);
      return options.queryResult ?? [];
    },

    async run(sql: string, params?: unknown[]) {
      const call: MockCall = { sql, bindings: params ?? [], method: 'run' };
      calls.push(call);
    },

    async batch(statements: { sql: string; params?: unknown[] }[]) {
      batchCalls++;
      for (const s of statements) {
        calls.push({ sql: s.sql, bindings: s.params ?? [], method: 'run' });
      }
    },

    _calls: calls,
    _batchCalls: 0,
  };

  // Use getter so batchCalls tracks correctly
  Object.defineProperty(db, '_batchCalls', {
    get: () => batchCalls,
  });

  return db;
}

// ─── Mock KV ─────────────────────────────────────────────────────────────────

function createMockKV(store: Record<string, string> = {}): KVNamespace {
  return {
    get: async (key: string) => store[key] ?? null,
    put: async (key: string, value: string) => { store[key] = value; },
    delete: async (key: string) => { delete store[key]; },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// ─── ensureAuthSchema / resetSchemaInit ─────────────────────────────────────

describe('ensureAuthSchema', () => {
  beforeEach(() => {
    resetSchemaInit();
  });

  it('calls db.batch with CREATE TABLE statements', async () => {
    const db = createMockAuthDb();
    await ensureAuthSchema(db);
    expect(db._batchCalls).toBe(1);
    // Should have prepared multiple CREATE TABLE statements
    expect(db._calls.length).toBeGreaterThanOrEqual(5);
    expect(db._calls.some((c) => c.sql.includes('_email_index'))).toBe(true);
    expect(db._calls.some((c) => c.sql.includes('_oauth_index'))).toBe(true);
    expect(db._calls.some((c) => c.sql.includes('_anon_index'))).toBe(true);
    expect(db._calls.some((c) => c.sql.includes('_admins'))).toBe(true);
    expect(db._calls.some((c) => c.sql.includes('_admin_sessions'))).toBe(true);
  });

  it('idempotent — second call skips', async () => {
    const db = createMockAuthDb();
    await ensureAuthSchema(db);
    const batchCount1 = db._batchCalls;
    await ensureAuthSchema(db);
    expect(db._batchCalls).toBe(batchCount1); // No additional batch call
  });

  it('resetSchemaInit allows re-initialization', async () => {
    const db = createMockAuthDb();
    await ensureAuthSchema(db);
    const batchCount1 = db._batchCalls;
    resetSchemaInit();
    await ensureAuthSchema(db);
    expect(db._batchCalls).toBe(batchCount1 + 1);
  });
});

// ─── Email Index ─────────────────────────────────────────────────────────────

describe('lookupEmail', () => {
  it('returns null when email not found', async () => {
    const db = createMockAuthDb({ firstResult: null });
    const result = await lookupEmail(db, 'missing@test.com');
    expect(result).toBeNull();
  });

  it('returns userId + shardId when confirmed', async () => {
    const db = createMockAuthDb({
      firstResult: { userId: 'u1', shardId: 3 },
    });
    const result = await lookupEmail(db, 'found@test.com');
    expect(result).toEqual({ userId: 'u1', shardId: 3 });
  });

  it('cleans stale pending before lookup', async () => {
    const db = createMockAuthDb({ firstResult: null });
    await lookupEmail(db, 'any@test.com');
    // First two calls are DELETE for stale pending, third is SELECT
    expect(db._calls.length).toBe(3);
    expect(db._calls[0].sql).toContain('DELETE FROM _email_index');
    expect(db._calls[0].sql).toContain('pending');
    expect(db._calls[2].sql).toContain('SELECT userId, shardId');
    expect(db._calls[2].bindings[0]).toBe('any@test.com');
  });
});

describe('registerEmailPending', () => {
  it('inserts pending email when no existing', async () => {
    const db = createMockAuthDb({ firstResult: null });
    await registerEmailPending(db, 'new@test.com', 'u1');
    const insertCall = db._calls.find((c) => c.sql.includes('INSERT INTO _email_index'));
    expect(insertCall).toBeDefined();
    // bindings: [email, userId, 0 (hardcoded shardId), now]
    expect(insertCall!.bindings[0]).toBe('new@test.com');
    expect(insertCall!.bindings[1]).toBe('u1');
    expect(insertCall!.bindings[2]).toBe(0);
    expect(insertCall!.bindings).toHaveLength(4); // includes ISO timestamp
  });

  it('throws when email already confirmed', async () => {
    const db = createMockAuthDb({
      firstResult: { email: 'taken@test.com', status: 'confirmed' },
    });
    await expect(
      registerEmailPending(db, 'taken@test.com', 'u2'),
    ).rejects.toThrow('EMAIL_ALREADY_REGISTERED');
  });

  it('replaces pending email', async () => {
    const db = createMockAuthDb({
      firstResult: { email: 'pending@test.com', status: 'pending' },
    });
    await registerEmailPending(db, 'pending@test.com', 'u3');
    // Should DELETE existing pending, then INSERT new
    const deleteCall = db._calls.find(
      (c) => c.sql.includes('DELETE FROM _email_index') && c.sql.includes('pending'),
    );
    expect(deleteCall).toBeDefined();
    const insertCall = db._calls.find((c) => c.sql.includes('INSERT INTO _email_index'));
    expect(insertCall).toBeDefined();
  });
});

describe('confirmEmail', () => {
  it('updates status to confirmed', async () => {
    const db = createMockAuthDb();
    await confirmEmail(db, 'user@test.com', 'u1');
    expect(db._calls[0].sql).toContain('UPDATE _email_index SET status');
    expect(db._calls[0].bindings).toEqual(['user@test.com', 'u1']);
  });
});

describe('deleteEmailPending', () => {
  it('deletes pending email', async () => {
    const db = createMockAuthDb();
    await deleteEmailPending(db, 'user@test.com');
    expect(db._calls[0].sql).toContain('DELETE FROM _email_index');
    expect(db._calls[0].sql).toContain('pending');
    expect(db._calls[0].bindings[0]).toBe('user@test.com');
  });
});

describe('deleteEmail', () => {
  it('deletes email regardless of status', async () => {
    const db = createMockAuthDb();
    await deleteEmail(db, 'user@test.com');
    expect(db._calls[0].sql).toContain('DELETE FROM _email_index WHERE email = ?');
    expect(db._calls[0].bindings[0]).toBe('user@test.com');
  });
});

// ─── OAuth Index ─────────────────────────────────────────────────────────────

describe('lookupOAuth', () => {
  it('returns null when not found', async () => {
    const db = createMockAuthDb({ firstResult: null });
    const result = await lookupOAuth(db, 'google', 'g-user-1');
    expect(result).toBeNull();
  });

  it('returns userId + shardId when confirmed', async () => {
    const db = createMockAuthDb({
      firstResult: { userId: 'u1', shardId: 2 },
    });
    const result = await lookupOAuth(db, 'github', 'gh-123');
    expect(result).toEqual({ userId: 'u1', shardId: 2 });
  });
});

describe('registerOAuthPending', () => {
  it('inserts pending when no conflict', async () => {
    const db = createMockAuthDb({ firstResult: null });
    await registerOAuthPending(db, 'google', 'g-1', 'u1');
    const insertCall = db._calls.find((c) => c.sql.includes('INSERT INTO _oauth_index'));
    expect(insertCall).toBeDefined();
  });

  it('throws when already confirmed', async () => {
    // registerOAuthPending does 2 db.run() DELETEs then 1 db.first() SELECT
    // The first db.first() call should return an existing confirmed record
    const mockDb = createMockAuthDb({
      firstResults: [{ userId: 'existing', status: 'confirmed' }],
    });
    await expect(
      registerOAuthPending(mockDb, 'google', 'g-1', 'u2'),
    ).rejects.toThrow('OAUTH_ALREADY_LINKED');
  });
});

describe('confirmOAuth', () => {
  it('updates status to confirmed', async () => {
    const db = createMockAuthDb();
    await confirmOAuth(db, 'google', 'g-1');
    expect(db._calls[0].sql).toContain('UPDATE _oauth_index');
    expect(db._calls[0].bindings).toEqual(['google', 'g-1']);
  });
});

describe('deleteOAuth', () => {
  it('deletes OAuth record', async () => {
    const db = createMockAuthDb();
    await deleteOAuth(db, 'github', 'gh-1');
    expect(db._calls[0].sql).toContain('DELETE FROM _oauth_index');
    expect(db._calls[0].bindings).toEqual(['github', 'gh-1']);
  });
});

// ─── Phone Index ─────────────────────────────────────────────────────────────

describe('lookupPhone', () => {
  it('returns null when not found', async () => {
    const db = createMockAuthDb({ firstResult: null });
    const result = await lookupPhone(db, '+821012345678');
    expect(result).toBeNull();
  });

  it('returns userId + shardId when confirmed', async () => {
    const db = createMockAuthDb({
      firstResult: { userId: 'u1', shardId: 6 },
    });
    const result = await lookupPhone(db, '+821012345678');
    expect(result).toEqual({ userId: 'u1', shardId: 6 });
  });
});

describe('registerPhonePending', () => {
  it('inserts pending when no existing', async () => {
    const db = createMockAuthDb({ firstResult: null });
    await registerPhonePending(db, '+821000000000', 'u1');
    const insertCall = db._calls.find((c) => c.sql.includes('INSERT INTO _phone_index'));
    expect(insertCall).toBeDefined();
  });

  it('throws when phone already confirmed', async () => {
    const db = createMockAuthDb({
      firstResult: { phone: '+821000000000', status: 'confirmed' },
    });
    await expect(
      registerPhonePending(db, '+821000000000', 'u2'),
    ).rejects.toThrow('PHONE_ALREADY_REGISTERED');
  });
});

describe('confirmPhone', () => {
  it('updates status to confirmed', async () => {
    const db = createMockAuthDb();
    await confirmPhone(db, '+821000000000', 'u1');
    expect(db._calls[0].sql).toContain('UPDATE _phone_index');
    expect(db._calls[0].bindings).toEqual(['+821000000000', 'u1']);
  });
});

describe('deletePhone', () => {
  it('deletes phone record', async () => {
    const db = createMockAuthDb();
    await deletePhone(db, '+821000000000');
    expect(db._calls[0].sql).toContain('DELETE FROM _phone_index');
    expect(db._calls[0].bindings[0]).toBe('+821000000000');
  });
});

// ─── Anonymous Index ─────────────────────────────────────────────────────────

describe('registerAnonPending', () => {
  it('inserts anon pending', async () => {
    const db = createMockAuthDb();
    await registerAnonPending(db, 'anon-1');
    const insertCall = db._calls.find((c) => c.sql.includes('INSERT INTO _anon_index'));
    expect(insertCall).toBeDefined();
    // bindings: [userId, 0 (hardcoded shardId), now]
    expect(insertCall!.bindings[0]).toBe('anon-1');
    expect(insertCall!.bindings[1]).toBe(0);
    expect(insertCall!.bindings).toHaveLength(3); // includes ISO timestamp
  });
});

describe('confirmAnon', () => {
  it('updates status to confirmed', async () => {
    const db = createMockAuthDb();
    await confirmAnon(db, 'anon-1');
    expect(db._calls[0].sql).toContain('UPDATE _anon_index');
    expect(db._calls[0].bindings[0]).toBe('anon-1');
  });
});

describe('deleteAnon', () => {
  it('deletes anon record', async () => {
    const db = createMockAuthDb();
    await deleteAnon(db, 'anon-1');
    expect(db._calls[0].sql).toContain('DELETE FROM _anon_index');
    expect(db._calls[0].bindings[0]).toBe('anon-1');
  });
});

describe('batchDeleteAnon', () => {
  it('does nothing for empty array', async () => {
    const db = createMockAuthDb();
    await batchDeleteAnon(db, []);
    expect(db._batchCalls).toBe(0);
  });

  it('batch deletes multiple userIds', async () => {
    const db = createMockAuthDb();
    await batchDeleteAnon(db, ['a1', 'a2', 'a3']);
    expect(db._batchCalls).toBe(1);
    expect(db._calls).toHaveLength(3);
    expect(db._calls[0].bindings[0]).toBe('a1');
    expect(db._calls[1].bindings[0]).toBe('a2');
    expect(db._calls[2].bindings[0]).toBe('a3');
  });
});

// ─── Admin CRUD ──────────────────────────────────────────────────────────────

describe('getAdminByEmail', () => {
  it('returns null when not found', async () => {
    const db = createMockAuthDb({ firstResult: null });
    const result = await getAdminByEmail(db, 'admin@test.com');
    expect(result).toBeNull();
  });

  it('returns admin record when found', async () => {
    const admin = { id: 'a1', email: 'admin@test.com', passwordHash: 'hash', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
    const db = createMockAuthDb({ firstResult: admin });
    const result = await getAdminByEmail(db, 'admin@test.com');
    expect(result).toEqual(admin);
  });

  it('lazy deletes expired sessions', async () => {
    const db = createMockAuthDb({ firstResult: null });
    await getAdminByEmail(db, 'admin@test.com');
    // First call should be DELETE expired sessions
    expect(db._calls[0].sql).toContain('DELETE FROM _admin_sessions');
    expect(db._calls[0].sql).toContain('expiresAt');
  });
});

describe('getAdminById', () => {
  it('returns null when not found', async () => {
    const db = createMockAuthDb({ firstResult: null });
    const result = await getAdminById(db, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns admin record when found', async () => {
    const admin = { id: 'a1', email: 'admin@test.com', passwordHash: 'hash', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
    const db = createMockAuthDb({ firstResult: admin });
    const result = await getAdminById(db, 'a1');
    expect(result).toEqual(admin);
  });
});

describe('adminExists', () => {
  it('returns false when no admins', async () => {
    const db = createMockAuthDb({ firstResult: { cnt: 0 } });
    expect(await adminExists(db)).toBe(false);
  });

  it('returns true when admins exist', async () => {
    const db = createMockAuthDb({ firstResult: { cnt: 2 } });
    expect(await adminExists(db)).toBe(true);
  });

  it('returns false when result is null', async () => {
    const db = createMockAuthDb({ firstResult: null });
    expect(await adminExists(db)).toBe(false);
  });
});

describe('createAdmin', () => {
  it('inserts admin record', async () => {
    const db = createMockAuthDb();
    await createAdmin(db, 'a1', 'admin@test.com', 'hashed-pw');
    expect(db._calls[0].sql).toContain('INSERT INTO _admins');
    expect(db._calls[0].bindings[0]).toBe('a1');
    expect(db._calls[0].bindings[1]).toBe('admin@test.com');
    expect(db._calls[0].bindings[2]).toBe('hashed-pw');
  });
});

// ─── Admin Sessions ──────────────────────────────────────────────────────────

describe('getAdminSession', () => {
  it('returns null when session not found', async () => {
    const db = createMockAuthDb({ firstResult: null });
    const result = await getAdminSession(db, 'bad-refresh-token');
    expect(result).toBeNull();
  });

  it('returns session when valid', async () => {
    const session = { id: 's1', adminId: 'a1', refreshToken: 'rt-1', expiresAt: '2099-01-01', createdAt: '2024-01-01' };
    const db = createMockAuthDb({ firstResult: session });
    const result = await getAdminSession(db, 'rt-1');
    expect(result).toEqual(session);
  });
});

describe('createAdminSession', () => {
  it('inserts session record', async () => {
    const db = createMockAuthDb();
    await createAdminSession(db, 's1', 'a1', 'rt-1', '2099-01-01');
    expect(db._calls[0].sql).toContain('INSERT INTO _admin_sessions');
    expect(db._calls[0].bindings[0]).toBe('s1');
    expect(db._calls[0].bindings[1]).toBe('a1');
    expect(db._calls[0].bindings[2]).toBe('rt-1');
    expect(db._calls[0].bindings[3]).toBe('2099-01-01');
  });
});

describe('deleteAdminSession', () => {
  it('deletes session', async () => {
    const db = createMockAuthDb();
    await deleteAdminSession(db, 's1');
    expect(db._calls[0].sql).toContain('DELETE FROM _admin_sessions');
    expect(db._calls[0].bindings[0]).toBe('s1');
  });
});

describe('updateAdminPassword', () => {
  it('updates password hash and revokes all admin sessions atomically', async () => {
    const db = createMockAuthDb();
    await updateAdminPassword(db, 'admin-1', 'new-hash');

    expect(db._batchCalls).toBe(1);
    expect(db._calls).toHaveLength(2);
    expect(db._calls[0].sql).toContain('UPDATE _admins SET passwordHash = ?');
    expect(db._calls[0].bindings[0]).toBe('new-hash');
    expect(db._calls[0].bindings[2]).toBe('admin-1');
    expect(db._calls[1].sql).toContain('DELETE FROM _admin_sessions WHERE adminId = ?');
    expect(db._calls[1].bindings[0]).toBe('admin-1');
  });
});

// ─── User Listing ────────────────────────────────────────────────────────────

describe('listUserMappings', () => {
  it('returns empty when no users', async () => {
    const db = createMockAuthDb({ firstResult: { count: 0 }, queryResult: [] });
    const result = await listUserMappings(db, 10, 0);
    expect(result.mappings).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns mappings and total', async () => {
    const db = createMockAuthDb({
      firstResult: { count: 2 },
      queryResult: [
        { userId: 'u1', shardId: 1 },
        { userId: 'u2', shardId: 3 },
      ],
    });
    const result = await listUserMappings(db, 10, 0);
    expect(result.mappings).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('detects hasMore when results exceed limit', async () => {
    const db = createMockAuthDb({
      firstResult: { count: 10 },
      queryResult: [
        { userId: 'u1', shardId: 1 },
        { userId: 'u2', shardId: 2 },
        { userId: 'u3', shardId: 3 }, // extra: limit+1
      ],
    });
    const result = await listUserMappings(db, 2, 0);
    expect(result.mappings).toHaveLength(2); // sliced to limit
    expect(result.total).toBe(10);
  });

  it('passes limit+1 and offset to SQL', async () => {
    const db = createMockAuthDb({ firstResult: { count: 0 }, queryResult: [] });
    await listUserMappings(db, 20, 40);
    const selectCall = db._calls.find((c) => c.sql.includes('LIMIT ? OFFSET ?'));
    expect(selectCall).toBeDefined();
    expect(selectCall!.bindings).toEqual([21, 40]); // limit+1, offset
    expect(selectCall!.sql).toContain('ORDER BY userId DESC');
    expect(db._calls[0].sql).toContain('COUNT(DISTINCT userId)');
  });
});

describe('searchUserMappingsByEmail', () => {
  it('returns empty when no matching users', async () => {
    const db = createMockAuthDb({ firstResult: { count: 0 }, queryResult: [] });
    const result = await searchUserMappingsByEmail(db, 'foo@bar.com', 10, 0);
    expect(result.mappings).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns mappings and total', async () => {
    const db = createMockAuthDb({
      firstResult: { count: 2 },
      queryResult: [
        { userId: 'u1', shardId: 1 },
        { userId: 'u2', shardId: 3 },
      ],
    });
    const result = await searchUserMappingsByEmail(db, 'test', 10, 0);
    expect(result.mappings).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('detects hasMore when results exceed limit', async () => {
    const db = createMockAuthDb({
      firstResult: { count: 9 },
      queryResult: [
        { userId: 'u1', shardId: 1 },
        { userId: 'u2', shardId: 2 },
        { userId: 'u3', shardId: 3 }, // extra: limit+1
      ],
    });
    const result = await searchUserMappingsByEmail(db, 'test', 2, 0);
    expect(result.mappings).toHaveLength(2); // sliced to limit
    expect(result.total).toBe(9);
  });

  it('passes lowercased LIKE pattern, limit+1, and offset to SQL', async () => {
    const db = createMockAuthDb({ firstResult: { count: 0 }, queryResult: [] });
    await searchUserMappingsByEmail(db, 'Alice@Example.COM', 20, 40);
    const countCall = db._calls.find((c) => c.method === 'first' && c.sql.includes('LIKE'));
    expect(countCall).toBeDefined();
    expect(countCall!.bindings).toEqual(['%alice@example.com%']);
    const pagedCall = db._calls.find((c) => c.method === 'query' && c.sql.includes('LIMIT ? OFFSET ?'));
    expect(pagedCall!.bindings).toEqual(['%alice@example.com%', 21, 40]);
    expect(pagedCall!.sql).toContain('ORDER BY userId DESC');
  });

  it('wraps email query with % wildcards for LIKE', async () => {
    const db = createMockAuthDb({ firstResult: { count: 0 }, queryResult: [] });
    await searchUserMappingsByEmail(db, 'test', 10, 0);
    const countCall = db._calls.find((c) => c.method === 'first' && c.sql.includes('LIKE'));
    expect(countCall!.bindings[0]).toBe('%test%');
  });
});

describe('countUsers', () => {
  it('returns 0 when no users', async () => {
    const db = createMockAuthDb({ firstResult: { count: 0 } });
    expect(await countUsers(db)).toBe(0);
  });

  it('returns count', async () => {
    const db = createMockAuthDb({ firstResult: { count: 42 } });
    expect(await countUsers(db)).toBe(42);
  });

  it('returns 0 when result is null', async () => {
    const db = createMockAuthDb({ firstResult: null });
    expect(await countUsers(db)).toBe(0);
  });
});

// ─── KV Token Helpers ────────────────────────────────────────────────────────

describe('lookupTokenShard', () => {
  it('returns null when token not found', async () => {
    const kv = createMockKV();
    const result = await lookupTokenShard(kv, 'missing-token');
    expect(result).toBeNull();
  });

  it('returns shardId when found', async () => {
    const kv = createMockKV({
      'email-token:valid-token': JSON.stringify({ shardId: 7 }),
    });
    const result = await lookupTokenShard(kv, 'valid-token');
    expect(result).toBe(7);
  });

  it('returns null for invalid JSON', async () => {
    const kv = createMockKV({
      'email-token:bad-token': 'not-json',
    });
    const result = await lookupTokenShard(kv, 'bad-token');
    expect(result).toBeNull();
  });
});

describe('deleteTokenMapping', () => {
  it('deletes token from KV', async () => {
    const store: Record<string, string> = {
      'email-token:tok-1': JSON.stringify({ shardId: 1 }),
    };
    const kv = createMockKV(store);
    await deleteTokenMapping(kv, 'tok-1');
    expect(store['email-token:tok-1']).toBeUndefined();
  });
});

// ─── Passkey Index ───────────────────────────────────────────────────────────

describe('lookupPasskey', () => {
  it('returns null when not found', async () => {
    const db = createMockAuthDb({ firstResult: null });
    const result = await lookupPasskey(db, 'cred-missing');
    expect(result).toBeNull();
  });

  it('returns userId + shardId when found', async () => {
    const db = createMockAuthDb({
      firstResult: { userId: 'u1', shardId: 8 },
    });
    const result = await lookupPasskey(db, 'cred-1');
    expect(result).toEqual({ userId: 'u1', shardId: 8 });
  });
});

describe('registerPasskey', () => {
  it('inserts passkey record', async () => {
    const db = createMockAuthDb();
    await registerPasskey(db, 'cred-1', 'u1');
    expect(db._calls[0].sql).toContain('INSERT INTO _passkey_index');
    expect(db._calls[0].bindings[0]).toBe('cred-1');
    expect(db._calls[0].bindings[1]).toBe('u1');
    expect(db._calls[0].bindings[2]).toBe(0);
  });
});

describe('deletePasskey', () => {
  it('deletes passkey by credentialId', async () => {
    const db = createMockAuthDb();
    await deletePasskey(db, 'cred-1');
    expect(db._calls[0].sql).toContain('DELETE FROM _passkey_index WHERE credentialId');
    expect(db._calls[0].bindings[0]).toBe('cred-1');
  });
});

describe('deletePasskeysByUser', () => {
  it('deletes all passkeys for a user', async () => {
    const db = createMockAuthDb();
    await deletePasskeysByUser(db, 'u1');
    expect(db._calls[0].sql).toContain('DELETE FROM _passkey_index WHERE userId');
    expect(db._calls[0].bindings[0]).toBe('u1');
  });
});
