import { describe, expect, it } from 'vitest';
import type { AuthDb } from '../lib/auth-db-adapter.js';
import {
  createEmailToken,
  deleteEmailToken,
  getEmailToken,
  getEmailTokenByType,
} from '../lib/auth-d1-service.js';
import {
  authSecretLookupKeys,
  hashAuthSecret,
  hashOtpSecret,
  verifyAuthSecret,
  verifyOtpSecret,
} from '../lib/auth-token.js';

class MemoryAuthDb implements AuthDb {
  readonly dialect = 'sqlite' as const;
  rows: Array<Record<string, unknown>> = [];

  async query<T = Record<string, unknown>>(): Promise<T[]> {
    return this.rows as T[];
  }

  async first<T = Record<string, unknown>>(_sql: string, params: unknown[] = []): Promise<T | null> {
    const type = _sql.includes('AND type = ?') ? params[params.length - 1] : undefined;
    const tokenKeys = type ? params.slice(0, -1) : params;
    const row = this.rows.find((candidate) => {
      return tokenKeys.includes(candidate.token) && (!type || candidate.type === type);
    });
    return (row ?? null) as T | null;
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    if (sql.includes('INSERT INTO _email_tokens')) {
      const [token, userId, type, expiresAt, createdAt] = params;
      this.rows.push({ token, userId, type, expiresAt, createdAt });
      return;
    }
    if (sql.includes('DELETE FROM _email_tokens WHERE token IN')) {
      const keys = new Set(params);
      this.rows = this.rows.filter((row) => !keys.has(row.token));
      return;
    }
    throw new Error(`Unexpected SQL in MemoryAuthDb: ${sql}`);
  }

  async batch(): Promise<void> {}

  async compareAndSwapAdminSession(): Promise<boolean> {
    return false;
  }

  async compareAndSwapUserSession(): Promise<boolean> {
    return false;
  }
}

describe('auth-token helpers', () => {
  it('hashes auth secrets and verifies them without storing the raw value', async () => {
    const hash = await hashAuthSecret('123456');

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hash).not.toBe('123456');
    await expect(verifyAuthSecret('123456', hash)).resolves.toBe(true);
    await expect(verifyAuthSecret('000000', hash)).resolves.toBe(false);
  });

  it('hashes short OTP secrets with a server-keyed HMAC', async () => {
    const hash = await hashOtpSecret('123456', 'server-secret-a');

    expect(hash).toMatch(/^hmac-sha256:[a-f0-9]{64}$/);
    expect(hash).not.toBe('123456');
    expect(hash).not.toBe(await hashAuthSecret('123456'));
    await expect(verifyOtpSecret('123456', hash, 'server-secret-a')).resolves.toBe(true);
    await expect(verifyOtpSecret('000000', hash, 'server-secret-a')).resolves.toBe(false);
    await expect(verifyOtpSecret('123456', hash, 'server-secret-b')).resolves.toBe(false);
  });

  it('keeps short-lived legacy SHA-256 OTP hashes verifiable', async () => {
    const legacyHash = await hashAuthSecret('123456');

    await expect(verifyOtpSecret('123456', legacyHash, 'server-secret-a')).resolves.toBe(true);
    await expect(verifyOtpSecret('000000', legacyHash, 'server-secret-a')).resolves.toBe(false);
  });

  it('builds hashed and legacy lookup keys for auth secrets', async () => {
    const keys = await authSecretLookupKeys('raw-magic-link-token');

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(keys[1]).toBe('raw-magic-link-token');
    await expect(authSecretLookupKeys(keys[0])).resolves.toEqual([keys[0]]);
  });
});

describe('email token storage', () => {
  it('stores hashed email tokens while allowing raw-token lookup and deletion', async () => {
    const db = new MemoryAuthDb();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    await createEmailToken(db, {
      token: 'raw-magic-link-token',
      userId: 'user-1',
      type: 'magic-link',
      expiresAt,
    });

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].token).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(db.rows[0].token).not.toBe('raw-magic-link-token');

    const row = await getEmailToken(db, 'raw-magic-link-token');
    expect(row?.userId).toBe('user-1');

    await deleteEmailToken(db, 'raw-magic-link-token');
    expect(db.rows).toHaveLength(0);
  });

  it('still accepts and deletes legacy raw email tokens', async () => {
    const db = new MemoryAuthDb();
    db.rows.push({
      token: 'legacy-verify-token',
      userId: 'user-2',
      type: 'verify',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const row = await getEmailTokenByType(db, 'legacy-verify-token', 'verify');
    expect(row?.userId).toBe('user-2');

    await deleteEmailToken(db, 'legacy-verify-token');
    expect(db.rows).toHaveLength(0);
  });

  it('cleans up expired hashed tokens on lookup', async () => {
    const db = new MemoryAuthDb();
    await createEmailToken(db, {
      token: 'expired-token',
      userId: 'user-3',
      type: 'password-reset',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const row = await getEmailToken(db, 'expired-token');
    expect(row).toBeNull();
    expect(db.rows).toHaveLength(0);
  });
});
