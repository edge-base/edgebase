import { describe, expect, it } from 'vitest';
import { resolveAdminJwtAuthority } from '../lib/admin-auth-authority.js';
import { signAdminAccessToken } from '../lib/jwt.js';
import type { AuthDb } from '../lib/auth-db-adapter.js';

function authDb(
  firstResult: (sql: string, params?: unknown[]) => Promise<unknown>,
): AuthDb {
  return {
    dialect: 'sqlite',
    query: async () => [],
    first: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => (
      await firstResult(sql, params) as T | null
    ),
    run: async () => {},
    batch: async () => {},
    batchWithLock: async () => {},
    compareAndSwapAdminSession: async () => false,
    compareAndSwapUserSession: async () => false,
    createSessionWithLimit: async () => {},
  };
}

describe('admin JWT authority', () => {
  it('requires the active backing session for a session-bound token', async () => {
    const token = await signAdminAccessToken(
      { sub: 'admin-1', sid: 'session-1' },
      'admin-secret-at-least-32-characters',
    );
    const db = authDb(async () => ({
      id: 'session-1',
      adminId: 'admin-1',
      refreshToken: 'sha256:value',
      expiresAt: '2099-01-01',
      createdAt: '2026-01-01',
    }));

    await expect(resolveAdminJwtAuthority(db, {
      token,
      secret: 'admin-secret-at-least-32-characters',
    })).resolves.toBe('admin-1');
  });

  it('returns null for invalid credentials but propagates a session database outage', async () => {
    const secret = 'admin-secret-at-least-32-characters';
    await expect(resolveAdminJwtAuthority(authDb(async () => null), {
      token: 'not-a-jwt',
      secret,
    })).resolves.toBeNull();

    const token = await signAdminAccessToken({ sub: 'admin-1', sid: 'session-1' }, secret);
    const outage = new Error('auth database unavailable');
    await expect(resolveAdminJwtAuthority(authDb(async () => { throw outage; }), {
      token,
      secret,
    })).rejects.toBe(outage);
  });
});
