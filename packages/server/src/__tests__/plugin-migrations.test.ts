import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  controlDb,
  ensureControlSchemaMock,
  resolveControlDbMock,
  parseConfigMock,
  buildAdminDbProxyMock,
  buildFunctionKvProxyMock,
  buildFunctionD1ProxyMock,
  buildFunctionVectorizeProxyMock,
  buildFunctionPushProxyMock,
  buildAdminAuthContextMock,
  resolveRootServiceKeyMock,
} = vi.hoisted(() => ({
  controlDb: {
    query: vi.fn(),
    first: vi.fn(),
    run: vi.fn(),
  },
  ensureControlSchemaMock: vi.fn(),
  resolveControlDbMock: vi.fn(),
  parseConfigMock: vi.fn(),
  buildAdminDbProxyMock: vi.fn(),
  buildFunctionKvProxyMock: vi.fn(),
  buildFunctionD1ProxyMock: vi.fn(),
  buildFunctionVectorizeProxyMock: vi.fn(),
  buildFunctionPushProxyMock: vi.fn(),
  buildAdminAuthContextMock: vi.fn(),
  resolveRootServiceKeyMock: vi.fn(),
}));

vi.mock('../lib/control-db.js', () => ({
  ensureControlSchema: ensureControlSchemaMock,
  resolveControlDb: resolveControlDbMock,
}));

vi.mock('../lib/do-router.js', () => ({
  callDO: vi.fn(),
  getDbDoName: vi.fn(),
  parseConfig: parseConfigMock,
}));

vi.mock('../lib/functions.js', () => ({
  buildAdminDbProxy: buildAdminDbProxyMock,
  buildFunctionKvProxy: buildFunctionKvProxyMock,
  buildFunctionD1Proxy: buildFunctionD1ProxyMock,
  buildFunctionVectorizeProxy: buildFunctionVectorizeProxyMock,
  buildFunctionPushProxy: buildFunctionPushProxyMock,
  buildAdminAuthContext: buildAdminAuthContextMock,
}));

vi.mock('../lib/service-key.js', () => ({
  resolveRootServiceKey: resolveRootServiceKeyMock,
}));

describe('executePluginMigrations', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();

    controlDb.first.mockReset().mockResolvedValue(null);
    controlDb.query.mockReset().mockResolvedValue([]);
    controlDb.run.mockReset().mockResolvedValue(undefined);

    ensureControlSchemaMock.mockReset().mockResolvedValue(undefined);
    resolveControlDbMock.mockReset().mockReturnValue(controlDb);
    parseConfigMock.mockReset().mockReturnValue({ databases: {} });
    buildAdminDbProxyMock.mockReset().mockReturnValue(
      vi.fn(() => ({
        table: vi.fn(),
      })),
    );
    buildFunctionKvProxyMock.mockReset().mockReturnValue({});
    buildFunctionD1ProxyMock.mockReset().mockReturnValue({});
    buildFunctionVectorizeProxyMock.mockReset().mockReturnValue({});
    buildFunctionPushProxyMock.mockReset().mockReturnValue({});
    buildAdminAuthContextMock.mockReset().mockReturnValue({});
    resolveRootServiceKeyMock.mockReset().mockReturnValue('sk-root');
  });

  it('runs onInstall and all migrations up to the current version on first install', async () => {
    const { executePluginMigrations } = await import('../lib/plugin-migrations.js');
    const calls: string[] = [];

    await executePluginMigrations(
      [
        {
          name: 'cert-plugin',
          version: '0.3.0',
          config: { marker: 'plugin-platform-suite' },
          onInstall: vi.fn(async (ctx: { previousVersion: string | null }) => {
            calls.push(`install:${ctx.previousVersion}`);
          }),
          migrations: {
            '0.2.0': vi.fn(async (ctx: { previousVersion: string | null }) => {
              calls.push(`0.2.0:${ctx.previousVersion}`);
            }),
            '0.3.0': vi.fn(async (ctx: { previousVersion: string | null }) => {
              calls.push(`0.3.0:${ctx.previousVersion}`);
            }),
          },
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    expect(calls).toEqual(['install:null', '0.2.0:null', '0.3.0:null']);
    expect(controlDb.run).toHaveBeenCalledWith('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)', [
      'plugin_version:cert-plugin',
      '0.3.0',
    ]);
  });

  it('runs only pending migrations between the stored and current version', async () => {
    controlDb.first.mockResolvedValue({ value: '0.1.0' });
    const { executePluginMigrations } = await import('../lib/plugin-migrations.js');
    const calls: string[] = [];

    await executePluginMigrations(
      [
        {
          name: 'cert-plugin',
          version: '0.3.0',
          config: { marker: 'plugin-platform-suite' },
          onInstall: vi.fn(),
          migrations: {
            '0.1.0': vi.fn(async (ctx: { previousVersion: string | null }) => {
              calls.push(`0.1.0:${ctx.previousVersion}`);
            }),
            '0.2.0': vi.fn(async (ctx: { previousVersion: string | null }) => {
              calls.push(`0.2.0:${ctx.previousVersion}`);
            }),
            '0.3.0': vi.fn(async (ctx: { previousVersion: string | null }) => {
              calls.push(`0.3.0:${ctx.previousVersion}`);
            }),
            '0.4.0': vi.fn(async (ctx: { previousVersion: string | null }) => {
              calls.push(`0.4.0:${ctx.previousVersion}`);
            }),
          },
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    expect(calls).toEqual(['0.2.0:0.1.0', '0.3.0:0.1.0']);
    expect(controlDb.run).toHaveBeenCalledWith('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)', [
      'plugin_version:cert-plugin',
      '0.3.0',
    ]);
  });

  it('runs versionless migrations once per isolate', async () => {
    const { executePluginMigrations } = await import('../lib/plugin-migrations.js');
    const calls: string[] = [];

    await executePluginMigrations(
      [
        {
          name: 'versionless-plugin',
          config: {},
          migrations: {
            '0.1.0': vi.fn(async () => {
              calls.push('0.1.0');
            }),
            '0.2.0': vi.fn(async () => {
              calls.push('0.2.0');
            }),
          },
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    await executePluginMigrations(
      [
        {
          name: 'versionless-plugin',
          config: {},
          migrations: {
            '0.1.0': vi.fn(async () => {
              calls.push('0.1.0:rerun');
            }),
            '0.2.0': vi.fn(async () => {
              calls.push('0.2.0:rerun');
            }),
          },
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    expect(calls).toEqual(['0.1.0', '0.2.0']);
    expect(controlDb.run).not.toHaveBeenCalled();
  });

  it('updates stored plugin version even when no versioned migrations are defined', async () => {
    controlDb.first.mockResolvedValue({ value: '0.1.0' });
    const { executePluginMigrations } = await import('../lib/plugin-migrations.js');

    await executePluginMigrations(
      [
        {
          name: 'cert-plugin',
          version: '0.2.0',
          config: { marker: 'plugin-platform-suite' },
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    expect(controlDb.run).toHaveBeenCalledWith('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)', [
      'plugin_version:cert-plugin',
      '0.2.0',
    ]);
  });

  it('re-runs migrations after control state is cleared in the same isolate', async () => {
    const { executePluginMigrations, resetPluginMigrationState } = await import('../lib/plugin-migrations.js');
    const onInstall = vi.fn(async () => {});

    await executePluginMigrations(
      [
        {
          name: 'cert-plugin',
          version: '0.3.0',
          config: { marker: 'plugin-platform-suite' },
          onInstall,
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    resetPluginMigrationState();

    await executePluginMigrations(
      [
        {
          name: 'cert-plugin',
          version: '0.3.0',
          config: { marker: 'plugin-platform-suite' },
          onInstall,
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    expect(onInstall).toHaveBeenCalledTimes(2);
    expect(controlDb.run).toHaveBeenCalledTimes(2);
  });

  it('skips repeated control DB checks while the current-state cache is warm', async () => {
    controlDb.query.mockResolvedValue([{ key: 'plugin_version:cert-plugin', value: '0.3.0' }]);
    controlDb.first.mockResolvedValue({ value: '0.3.0' });
    const { executePluginMigrations } = await import('../lib/plugin-migrations.js');

    await executePluginMigrations(
      [
        {
          name: 'cert-plugin',
          version: '0.3.0',
          config: { marker: 'plugin-platform-suite' },
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    expect(ensureControlSchemaMock).toHaveBeenCalledTimes(1);
    expect(controlDb.query).toHaveBeenCalledTimes(1);

    await executePluginMigrations(
      [
        {
          name: 'cert-plugin',
          version: '0.3.0',
          config: { marker: 'plugin-platform-suite' },
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );

    expect(ensureControlSchemaMock).toHaveBeenCalledTimes(1);
    expect(controlDb.query).toHaveBeenCalledTimes(1);
  });

  it('resets the latch after a timed-out migration so the next request can retry', async () => {
    vi.useFakeTimers();
    const { executePluginMigrations } = await import('../lib/plugin-migrations.js');

    const stuck = executePluginMigrations(
      [
        {
          name: 'cert-plugin',
          version: '0.3.0',
          config: { marker: 'plugin-platform-suite' },
          onInstall: vi.fn(() => new Promise(() => {})),
        } as any,
      ],
      {
        DATABASE: {},
        AUTH_DB: {},
        KV: {},
      } as any,
      { databases: {} } as any,
    );
    const stuckResult = stuck.catch((error) => error);

    await vi.advanceTimersByTimeAsync(30_000);
    await expect(stuckResult).resolves.toMatchObject({
      message: 'Plugin migrations timed out (30000ms)',
    });

    controlDb.query.mockResolvedValue([{ key: 'plugin_version:cert-plugin', value: '0.3.0' }]);
    controlDb.first.mockResolvedValue({ value: '0.3.0' });

    await expect(
      executePluginMigrations(
        [
          {
            name: 'cert-plugin',
            version: '0.3.0',
            config: { marker: 'plugin-platform-suite' },
          } as any,
        ],
        {
          DATABASE: {},
          AUTH_DB: {},
          KV: {},
        } as any,
        { databases: {} } as any,
      ),
    ).resolves.toBeUndefined();
  });
});
