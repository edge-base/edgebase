import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '../lib/hono.js';
import { setConfig } from '../lib/do-router.js';
import { signAccessToken } from '../lib/jwt.js';
import {
  AuthSessionAuthorityUnavailableError,
  isAuthSessionActive,
} from '../lib/auth-session-authority.js';
import { authMiddleware } from '../middleware/auth.js';
import { counter, rateLimitMiddleware } from '../middleware/rate-limit.js';

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

  it('rate-limits a verified user before a second session-authority read', async () => {
    counter.reset();
    setConfig({
      release: true,
      rateLimiting: {
        functions: { requests: 1, window: '60s' },
        global: { requests: 100, window: '60s' },
      },
    });
    const app = new OpenAPIHono();
    app.use('*', rateLimitMiddleware);
    app.use('/api/*', authMiddleware);
    app.post('/api/functions/session-probe', (c) => c.json({
      userId: c.get('auth')?.id ?? null,
    }));
    const first = vi.fn(async () => ({ id: 'session-1' }));
    const authDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first })),
      })),
    } as unknown as D1Database;
    const gatewaySecret = 'b'.repeat(64);
    const env = {
      JWT_USER_SECRET: JWT_SECRET,
      AUTH_DB: authDb,
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
      EDGEBASE_SELF_HOST_GATEWAY_SECRET: gatewaySecret,
    };
    const token = await signAccessToken({ sub: 'user-1', sid: 'session-1' }, JWT_SECRET);
    const request = () => new Request('http://localhost/api/functions/session-probe', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-edgebase-self-host-gateway': gatewaySecret,
        'x-forwarded-for': '198.51.100.100',
      },
    });

    const admitted = await app.fetch(request(), env, createExecutionContext());
    const limited = await app.fetch(request(), env, createExecutionContext());

    expect(admitted.status).toBe(200);
    expect(await admitted.json()).toEqual({ userId: 'user-1' });
    expect(limited.status).toBe(429);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('shares only an in-flight exact-key check and rereads revocation after settlement', async () => {
    const gate = deferred();
    let active = true;
    const first = vi.fn(async () => {
      await gate.promise;
      return active ? { id: 'session-1' } : null;
    });
    const authDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first })),
      })),
    } as unknown as D1Database;
    const env = { AUTH_DB: authDb } as Record<string, unknown>;

    const concurrent = [
      isAuthSessionActive(env, 'user-1', 'session-1'),
      isAuthSessionActive(env, 'user-1', 'session-1'),
    ];
    await vi.waitFor(() => expect(first).toHaveBeenCalled());
    gate.resolve();
    await expect(Promise.all(concurrent)).resolves.toEqual([true, true]);

    active = false;
    await expect(isAuthSessionActive(env, 'user-1', 'session-1')).resolves.toBe(false);
    expect(first).toHaveBeenCalledTimes(2);
  });

  it('isolates session and authority keys while sharing an in-flight failure only once', async () => {
    const failureGate = deferred();
    const firstA = vi.fn(async (sessionId: string) => {
      if (sessionId === 'session-failure') {
        await failureGate.promise;
        throw new Error('authority unavailable');
      }
      return { id: sessionId };
    });
    const authDbA = {
      prepare: vi.fn(() => ({
        bind: vi.fn((sessionId: string) => ({
          first: () => firstA(sessionId),
        })),
      })),
    } as unknown as D1Database;
    const firstB = vi.fn(async () => null);
    const authDbB = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: firstB })),
      })),
    } as unknown as D1Database;
    const envA = { AUTH_DB: authDbA } as Record<string, unknown>;
    const envB = { AUTH_DB: authDbB } as Record<string, unknown>;

    await expect(Promise.all([
      isAuthSessionActive(envA, 'user-1', 'session-a'),
      isAuthSessionActive(envA, 'user-1', 'session-b'),
      isAuthSessionActive(envB, 'user-1', 'session-a'),
    ])).resolves.toEqual([true, true, false]);
    expect(firstA).toHaveBeenCalledTimes(2);
    expect(firstB).toHaveBeenCalledTimes(1);

    const failed = [
      isAuthSessionActive(envA, 'user-1', 'session-failure').catch((error) => error),
      isAuthSessionActive(envA, 'user-1', 'session-failure').catch((error) => error),
    ];
    await vi.waitFor(() => expect(firstA.mock.calls.length).toBeGreaterThanOrEqual(3));
    failureGate.resolve();
    const failures = await Promise.all(failed);
    expect(failures).toEqual([
      expect.any(AuthSessionAuthorityUnavailableError),
      expect.any(AuthSessionAuthorityUnavailableError),
    ]);
    expect(firstA).toHaveBeenCalledTimes(3);

    await expect(isAuthSessionActive(envA, 'user-1', 'session-a')).resolves.toBe(true);
    expect(firstA).toHaveBeenCalledTimes(4);
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
