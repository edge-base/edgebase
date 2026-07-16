import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cleanExpiredSessionsMock,
  cleanStaleAnonymousAccountsMock,
  ensureAuthSchemaMock,
  deleteAnonMock,
  resolveAuthDbMock,
  executePluginMigrationsMock,
  scheduledClaimManyMock,
  scheduledSettleManyMock,
  scheduledPruneMock,
} = vi.hoisted(() => ({
  cleanExpiredSessionsMock: vi.fn(),
  cleanStaleAnonymousAccountsMock: vi.fn(),
  ensureAuthSchemaMock: vi.fn(),
  deleteAnonMock: vi.fn(),
  resolveAuthDbMock: vi.fn(),
  executePluginMigrationsMock: vi.fn(),
  scheduledClaimManyMock: vi.fn(),
  scheduledSettleManyMock: vi.fn(),
  scheduledPruneMock: vi.fn(),
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

vi.mock('../lib/scheduled-delivery.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/scheduled-delivery.js')>(
    '../lib/scheduled-delivery.js',
  );
  return {
    ...actual,
    createD1ScheduledDeliveryStore: () => ({
      claimMany: scheduledClaimManyMock,
      settleMany: scheduledSettleManyMock,
      prune: scheduledPruneMock,
    }),
  };
});

describe('scheduled handler', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).__EDGEBASE_RUNTIME_CONFIG__;
    cleanExpiredSessionsMock.mockReset().mockResolvedValue(undefined);
    cleanStaleAnonymousAccountsMock.mockReset().mockResolvedValue([]);
    ensureAuthSchemaMock.mockReset().mockResolvedValue(undefined);
    deleteAnonMock.mockReset().mockResolvedValue(undefined);
    resolveAuthDbMock.mockReset().mockReturnValue({ kind: 'auth-db' });
    executePluginMigrationsMock.mockReset().mockResolvedValue(undefined);
    scheduledClaimManyMock.mockReset().mockImplementation(async (requests) => requests.map((request: {
      cron: string;
      scheduledTime: number;
      itemId: string;
      lane: 'app-function' | 'plugin-function' | 'extra-cron' | 'system';
      now: number;
      leaseExpiresAt: number;
    }) => ({
      request,
      claimed: true,
      reason: 'new',
      state: {
        cron: request.cron,
        scheduledTime: request.scheduledTime,
        itemId: request.itemId,
        lane: request.lane,
        status: 'running',
        attempt: 1,
        startedAt: request.now,
        leaseExpiresAt: request.leaseExpiresAt,
        settledAt: null,
        lastError: null,
      },
    })));
    scheduledSettleManyMock.mockReset().mockResolvedValue(undefined);
    scheduledPruneMock.mockReset().mockResolvedValue(undefined);
  });

  it('runs system cleanup even when no user schedule functions are registered', async () => {
    const worker = (await import('../index.js')).default;
    const storage = {
      list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
      delete: vi.fn(),
    };
    const ctx = {
      waitUntil: vi.fn(),
    };

    await worker.scheduled(
      {
        cron: '0 3 * * *',
        scheduledTime: Date.parse('2026-03-07T03:00:00Z'),
      } as never,
      { STORAGE: storage } as never,
      ctx as never,
    );

    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(scheduledPruneMock).toHaveBeenCalledTimes(1);
    expect(resolveAuthDbMock).toHaveBeenCalledTimes(1);
    expect(ensureAuthSchemaMock).toHaveBeenCalledWith({ kind: 'auth-db' });
    expect(cleanExpiredSessionsMock).toHaveBeenCalledWith({ kind: 'auth-db' });
    expect(cleanStaleAnonymousAccountsMock.mock.calls[0]?.[0]).toEqual({ kind: 'auth-db' });
    expect(deleteAnonMock).not.toHaveBeenCalled();
    expect(storage.list).toHaveBeenCalledWith({
      prefix: '__edgebase_internal__/signed-upload-grants/',
      limit: 1000,
    });
    expect(storage.delete).not.toHaveBeenCalled();
  }, 15_000);

  it('runs plugin migration reconciliation before scheduled work when plugins are configured', async () => {
    const worker = (await import('../index.js')).default;
    const { setConfig } = await import('../lib/do-router.js');
    const ctx = {
      waitUntil: vi.fn(),
    };
    const config = {
      release: true,
      plugins: [
        {
          name: 'cert-plugin',
          version: '0.1.0',
          pluginApiVersion: 1,
          config: {},
        },
      ],
    };
    setConfig(config);
    const env = {};

    await worker.scheduled(
      {
        cron: '0 3 * * *',
        scheduledTime: Date.parse('2026-03-07T03:00:00Z'),
      } as never,
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
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  }, 15_000);

  it('routes an overlapping minute only to the function owned by event.cron', async () => {
    const worker = (await import('../index.js')).default;
    const { registerFunction } = await import('../lib/functions.js');
    const hourlyHandler = vi.fn().mockResolvedValue(undefined);
    const dailyHandler = vi.fn().mockResolvedValue(undefined);
    registerFunction('hourly', {
      trigger: { type: 'schedule', cron: '0 * * * *' },
      handler: hourlyHandler,
    });
    registerFunction('daily', {
      trigger: { type: 'schedule', cron: '0 3 * * *' },
      handler: dailyHandler,
    });

    const ctx = {
      waitUntil: vi.fn(),
    };

    await worker.scheduled(
      {
        cron: '0 * * * *',
        scheduledTime: Date.parse('2026-03-07T03:00:00Z'),
      } as never,
      {} as never,
      ctx as never,
    );

    expect(hourlyHandler).toHaveBeenCalledTimes(1);
    expect(dailyHandler).not.toHaveBeenCalled();
    expect(hourlyHandler.mock.calls[0]?.[0]).toMatchObject({
      data: {
        after: {
          cron: '0 * * * *',
          scheduledTime: '2026-03-07T03:00:00.000Z',
          scheduleIdentity: 'app-function:hourly#default',
          attempt: 1,
        },
      },
    });
    expect(
      (hourlyHandler.mock.calls[0]?.[0] as { data: { after: { deliveryId: string } } })
        .data.after.deliveryId,
    ).toContain('app-function:hourly#default');
    expect(resolveAuthDbMock).not.toHaveBeenCalled();
    expect(scheduledClaimManyMock.mock.calls[0]?.[0]).toMatchObject([
      { itemId: 'app-function:hourly#default', cron: '0 * * * *' },
    ]);
  }, 15_000);

  it('routes plugin, extra-cron, and system identities without cross-lane amplification', async () => {
    const worker = (await import('../index.js')).default;
    const { registerFunction } = await import('../lib/functions.js');
    const { setConfig } = await import('../lib/do-router.js');
    const pluginHandler = vi.fn().mockResolvedValue(undefined);
    const appHandler = vi.fn().mockResolvedValue(undefined);
    const plugin = {
      name: 'audit-plugin',
      version: '0.1.0',
      pluginApiVersion: 1,
      config: {},
      functions: {
        rotate: {
          trigger: { type: 'schedule' as const, cron: '15 * * * *' },
          handler: pluginHandler,
        },
      },
    };
    setConfig({
      release: true,
      plugins: [plugin],
      cloudflare: { extraCrons: ['30 * * * *'] },
    });
    registerFunction('audit-plugin/rotate', plugin.functions.rotate);
    registerFunction('ordinary', {
      trigger: { type: 'schedule', cron: '45 * * * *' },
      handler: appHandler,
    });
    const ctx = { waitUntil: vi.fn() };
    const env = {};

    await worker.scheduled(
      { cron: '15 * * * *', scheduledTime: Date.parse('2026-03-07T03:15:00Z') } as never,
      env as never,
      ctx as never,
    );
    expect(pluginHandler).toHaveBeenCalledTimes(1);
    expect(appHandler).not.toHaveBeenCalled();
    expect(executePluginMigrationsMock).toHaveBeenCalledTimes(1);
    expect(executePluginMigrationsMock.mock.calls[0]?.[0]).toEqual([plugin]);
    expect(resolveAuthDbMock).not.toHaveBeenCalled();
    expect(scheduledClaimManyMock.mock.calls[0]?.[0]).toMatchObject([
      { itemId: 'plugin-function:audit-plugin/rotate', lane: 'plugin-function' },
    ]);

    scheduledClaimManyMock.mockClear();
    executePluginMigrationsMock.mockClear();
    await worker.scheduled(
      { cron: '30 * * * *', scheduledTime: Date.parse('2026-03-07T03:30:00Z') } as never,
      env as never,
      ctx as never,
    );
    expect(pluginHandler).toHaveBeenCalledTimes(1);
    expect(appHandler).not.toHaveBeenCalled();
    expect(executePluginMigrationsMock).not.toHaveBeenCalled();
    expect(resolveAuthDbMock).not.toHaveBeenCalled();
    expect(scheduledClaimManyMock.mock.calls[0]?.[0]).toMatchObject([
      { itemId: 'extra-cron:30 * * * *', lane: 'extra-cron' },
    ]);
  }, 15_000);

  it('rejects provider completion when App Function waitUntil work fails', async () => {
    const worker = (await import('../index.js')).default;
    const { registerFunction } = await import('../lib/functions.js');
    registerFunction('late-failure', {
      trigger: { type: 'schedule', cron: '* * * * *' },
      handler: vi.fn(async (functionContext: unknown) => {
        const context = functionContext as { waitUntil(promise: Promise<unknown>): void };
        context.waitUntil(Promise.reject(new Error('late synthetic failure')));
      }),
    });

    await expect(worker.scheduled(
      { cron: '* * * * *', scheduledTime: Date.parse('2026-03-07T03:31:00Z') } as never,
      {} as never,
      { waitUntil: vi.fn() } as never,
    )).rejects.toThrow("app-function:late-failure#default=failed");

    expect(scheduledSettleManyMock.mock.calls[0]?.[0]).toMatchObject([
      {
        itemId: 'app-function:late-failure#default',
        status: 'failed',
        attempt: 1,
      },
    ]);
  }, 15_000);

  it('fails closed when a stale provider cron has no managed owner', async () => {
    const worker = (await import('../index.js')).default;
    await expect(worker.scheduled(
      { cron: '5 * * * *', scheduledTime: Date.parse('2026-03-07T03:05:00Z') } as never,
      {} as never,
      { waitUntil: vi.fn() } as never,
    )).rejects.toThrow("No managed schedule owns triggering cron '5 * * * *'");
    expect(scheduledClaimManyMock).not.toHaveBeenCalled();
    expect(scheduledSettleManyMock).not.toHaveBeenCalled();
  }, 15_000);
});
