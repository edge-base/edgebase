import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';

const {
  lookupEmailMock,
  ensureAuthSchemaMock,
  getUserByIdMock,
  verifyPasswordMock,
} = vi.hoisted(() => ({
  lookupEmailMock: vi.fn(),
  ensureAuthSchemaMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
}));

vi.mock('../lib/auth-d1.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-d1.js')>('../lib/auth-d1.js');
  return {
    ...actual,
    lookupEmail: lookupEmailMock,
    ensureAuthSchema: ensureAuthSchemaMock,
  };
});

vi.mock('../lib/auth-d1-service.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-d1-service.js')>('../lib/auth-d1-service.js');
  return { ...actual, getUserById: getUserByIdMock };
});

vi.mock('../lib/auth-db-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-db-adapter.js')>('../lib/auth-db-adapter.js');
  return { ...actual, resolveAuthDb: () => ({ kind: 'synthetic-auth-db' }) };
});

vi.mock('../lib/password.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/password.js')>('../lib/password.js');
  return { ...actual, verifyPassword: verifyPasswordMock };
});

import { authRoute } from '../routes/auth.js';
import { setConfig } from '../lib/do-router.js';
import { counter } from '../middleware/rate-limit.js';

const GENERIC_INVALID_CREDENTIALS = {
  code: 401,
  message: 'Invalid credentials.',
  slug: 'invalid-credentials',
};

async function signin(email: string): Promise<{ status: number; body: unknown }> {
  const response = await authRoute.fetch(
    new Request('https://api.example.test/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'WrongPassword123!' }),
    }),
    { AUTH_DB: {} } as never,
  );
  return { status: response.status, body: await response.json() };
}

describe('password signin account-enumeration privacy', () => {
  beforeEach(() => {
    setConfig(defineConfig({ release: true }));
    counter.reset();
    lookupEmailMock.mockReset();
    ensureAuthSchemaMock.mockReset().mockResolvedValue(undefined);
    getUserByIdMock.mockReset();
    verifyPasswordMock.mockReset().mockResolvedValue(false);
  });

  it('uses one expensive verification and one exact generic 401 for absent, passwordless, and wrong-password users', async () => {
    lookupEmailMock.mockResolvedValueOnce(null);
    const absent = await signin('absent@example.com');

    lookupEmailMock.mockResolvedValueOnce({ userId: 'oauth-user' });
    getUserByIdMock.mockResolvedValueOnce({
      id: 'oauth-user',
      email: 'oauth@example.com',
      passwordHash: null,
    });
    const passwordless = await signin('oauth@example.com');

    const realHash = 'pbkdf2:sha256:100000:BwcHBwcHBwcHBwcHBwcHBw==:CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws=';
    lookupEmailMock.mockResolvedValueOnce({ userId: 'password-user' });
    getUserByIdMock.mockResolvedValueOnce({
      id: 'password-user',
      email: 'password@example.com',
      passwordHash: realHash,
    });
    const wrongPassword = await signin('password@example.com');

    for (const outcome of [absent, passwordless, wrongPassword]) {
      expect(outcome.status).toBe(401);
      expect(outcome.body).toEqual(GENERIC_INVALID_CREDENTIALS);
    }
    expect(verifyPasswordMock).toHaveBeenCalledTimes(3);
    const hashes = verifyPasswordMock.mock.calls.map(([, hash]) => hash as string);
    expect(hashes[0]).toMatch(/^pbkdf2:sha256:100000:/);
    expect(hashes[1]).toBe(hashes[0]);
    expect(hashes[2]).toBe(realHash);
    expect(getUserByIdMock).toHaveBeenCalledTimes(3);
    expect(getUserByIdMock.mock.calls[0]?.[1])
      .toBe('00000000-0000-0000-0000-000000000000');
  });
});
