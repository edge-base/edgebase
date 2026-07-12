import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '../lib/hono.js';
import { setConfig } from '../lib/do-router.js';
import { signAccessToken } from '../lib/jwt.js';
import {
  AuthSessionAuthorityUnavailableError,
  isAuthSessionActive,
} from '../lib/auth-session-authority.js';
import { authMiddleware } from '../middleware/auth.js';

const JWT_SECRET = 'session-authority-test-secret-with-at-least-32-characters';

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

function createAuthDb(mode: 'active' | 'missing' | 'unavailable'): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (mode === 'unavailable') throw new Error('database connection refused');
          return mode === 'active' ? { id: 'session-1' } : null;
        }),
      })),
    })),
  } as unknown as D1Database;
}

async function requestWithSession(mode: 'active' | 'missing' | 'unavailable') {
  const app = new OpenAPIHono();
  app.use('/api/*', authMiddleware);
  app.get('/api/session-probe', (c) => c.json({ userId: c.get('auth')?.id ?? null }));

  const token = await signAccessToken({ sub: 'user-1', sid: 'session-1' }, JWT_SECRET);
  return app.fetch(
    new Request('http://localhost/api/session-probe', {
      headers: { Authorization: `Bearer ${token}` },
    }),
    {
      JWT_USER_SECRET: JWT_SECRET,
      AUTH_DB: createAuthDb(mode),
    },
    createExecutionContext(),
  );
}

describe('authoritative access-token session validation', () => {
  afterEach(() => {
    setConfig({});
  });

  it('accepts an access token only while its sid row remains active', async () => {
    setConfig({ release: true });

    const response = await requestWithSession('active');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ userId: 'user-1' });
  });

  it('keeps revoked results distinct from authority provider failures', async () => {
    await expect(isAuthSessionActive(
      { AUTH_DB: createAuthDb('missing') } as Record<string, unknown>,
      'user-1',
      'session-1',
    )).resolves.toBe(false);

    await expect(isAuthSessionActive(
      { AUTH_DB: createAuthDb('unavailable') } as Record<string, unknown>,
      'user-1',
      'session-1',
    )).rejects.toBeInstanceOf(AuthSessionAuthorityUnavailableError);
  });

  it('turns a hung session provider into a bounded authority-unavailable failure', async () => {
    vi.useFakeTimers();
    try {
      const pending = isAuthSessionActive({
        AUTH_DB: {
          prepare: () => ({
            bind: () => ({ first: () => new Promise(() => {}) }),
          }),
        },
      } as Record<string, unknown>, 'user-1', 'session-1');
      const handled = pending.catch((error) => error);

      await vi.advanceTimersByTimeAsync(2_000);

      expect(await handled).toBeInstanceOf(AuthSessionAuthorityUnavailableError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns 401 for a missing or expired sid row', async () => {
    setConfig({ release: true });

    const response = await requestWithSession('missing');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: 'TOKEN_INVALID' });
  });

  it('returns retryable 503 when session authority is unavailable instead of erasing credentials with 401', async () => {
    setConfig({ release: true });

    const response = await requestWithSession('unavailable');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 503,
      message: 'Authentication session validation is temporarily unavailable.',
      error: 'AUTH_AUTHORITY_UNAVAILABLE',
    });
  });
});
