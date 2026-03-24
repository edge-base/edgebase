import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cleanExpiredSessionsMock,
  cleanStaleAnonymousAccountsMock,
  ensureAuthSchemaMock,
  deleteAnonMock,
  resolveAuthDbMock,
  executePluginMigrationsMock,
} = vi.hoisted(() => ({
  cleanExpiredSessionsMock: vi.fn(),
  cleanStaleAnonymousAccountsMock: vi.fn(),
  ensureAuthSchemaMock: vi.fn(),
  deleteAnonMock: vi.fn(),
  resolveAuthDbMock: vi.fn(),
  executePluginMigrationsMock: vi.fn(),
}));

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

vi.mock('../lib/auth-d1-service.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-d1-service.js')>('../lib/auth-d1-service.js');
  return {
    ...actual,
    cleanExpiredSessions: cleanExpiredSessionsMock,
    cleanStaleAnonymousAccounts: cleanStaleAnonymousAccountsMock,
  };
});

vi.mock('../lib/auth-d1.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-d1.js')>('../lib/auth-d1.js');
  return {
    ...actual,
    ensureAuthSchema: ensureAuthSchemaMock,
    deleteAnon: deleteAnonMock,
  };
});

vi.mock('../lib/auth-db-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-db-adapter.js')>('../lib/auth-db-adapter.js');
  return {
    ...actual,
    resolveAuthDb: resolveAuthDbMock,
  };
});

vi.mock('../lib/plugin-migrations.js', () => ({
  executePluginMigrations: executePluginMigrationsMock,
}));

describe('scheduled handler', () => {
  beforeEach(() => {
    vi.resetModules();
    cleanExpiredSessionsMock.mockReset().mockResolvedValue(undefined);
    cleanStaleAnonymousAccountsMock.mockReset().mockResolvedValue([]);
    ensureAuthSchemaMock.mockReset().mockResolvedValue(undefined);
    deleteAnonMock.mockReset().mockResolvedValue(undefined);
    resolveAuthDbMock.mockReset().mockReturnValue({ kind: 'auth-db' });
    executePluginMigrationsMock.mockReset().mockResolvedValue(undefined);
  });

  it('runs system cleanup even when no user schedule functions are registered', async () => {
    const worker = (await import('../index.js')).default;
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        pending.push(Promise.resolve(promise));
      }),
    };

    await worker.scheduled(
      { scheduledTime: Date.parse('2026-03-07T03:00:00Z') } as never,
      {} as never,
      ctx as never,
    );

    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(pending);
    expect(resolveAuthDbMock).toHaveBeenCalledTimes(1);
    expect(ensureAuthSchemaMock).toHaveBeenCalledWith({ kind: 'auth-db' });
    expect(cleanExpiredSessionsMock).toHaveBeenCalledWith({ kind: 'auth-db' });
    expect(cleanStaleAnonymousAccountsMock.mock.calls[0]?.[0]).toEqual({ kind: 'auth-db' });
    expect(deleteAnonMock).not.toHaveBeenCalled();
  }, 15_000);

  it('runs plugin migration reconciliation before scheduled work when plugins are configured', async () => {
    const worker = (await import('../index.js')).default;
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        pending.push(Promise.resolve(promise));
      }),
    };
    const env = {
      EDGEBASE_CONFIG: {
        release: true,
        plugins: [
          {
            name: 'cert-plugin',
            version: '0.1.0',
            config: {},
          },
        ],
      },
    };

    await worker.scheduled(
      { scheduledTime: Date.parse('2026-03-07T03:00:00Z') } as never,
      env as never,
      ctx as never,
    );

    expect(executePluginMigrationsMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          name: 'cert-plugin',
          version: '0.1.0',
        }),
      ],
      env,
      expect.objectContaining({
        plugins: [
          expect.objectContaining({
            name: 'cert-plugin',
            version: '0.1.0',
          }),
        ],
      }),
      'http://internal',
    );
    await Promise.all(pending);
  }, 15_000);
});
