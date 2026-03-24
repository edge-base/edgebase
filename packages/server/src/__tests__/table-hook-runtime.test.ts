import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types.js';

const {
  ensureAuthSchemaMock,
  resolveAuthDbMock,
  sendToDatabaseLiveDOMock,
  createPushProviderMock,
  getDevicesForUserMock,
  providerSendMock,
} = vi.hoisted(() => ({
  ensureAuthSchemaMock: vi.fn(),
  resolveAuthDbMock: vi.fn(),
  sendToDatabaseLiveDOMock: vi.fn(),
  createPushProviderMock: vi.fn(),
  getDevicesForUserMock: vi.fn(),
  providerSendMock: vi.fn(),
}));

vi.mock('../lib/auth-d1.js', () => ({
  ensureAuthSchema: ensureAuthSchemaMock,
}));

vi.mock('../lib/auth-db-adapter.js', () => ({
  resolveAuthDb: resolveAuthDbMock,
}));

vi.mock('../lib/database-live-emitter.js', () => ({
  sendToDatabaseLiveDO: sendToDatabaseLiveDOMock,
}));

vi.mock('../lib/push-provider.js', () => ({
  createPushProvider: createPushProviderMock,
}));

vi.mock('../lib/push-token.js', () => ({
  getDevicesForUser: getDevicesForUserMock,
}));

describe('buildTableHookRuntimeServices', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureAuthSchemaMock.mockReset().mockResolvedValue(undefined);
    resolveAuthDbMock.mockReset().mockReturnValue({ kind: 'auth-db' });
    sendToDatabaseLiveDOMock.mockReset().mockResolvedValue(undefined);
    createPushProviderMock.mockReset().mockReturnValue({ send: providerSendMock });
    getDevicesForUserMock.mockReset().mockResolvedValue([]);
    providerSendMock.mockReset().mockResolvedValue({ success: true });
  });

  it('broadcasts hook events through DatabaseLiveDO', async () => {
    const { buildTableHookRuntimeServices } = await import('../lib/table-hook-runtime.js');
    const env = {
      DATABASE_LIVE: {} as DurableObjectNamespace,
    } as Env;

    const services = buildTableHookRuntimeServices({} as never, env);
    await services.databaseLive.broadcast('posts', 'created', { id: 'post-1' });

    expect(sendToDatabaseLiveDOMock).toHaveBeenCalledWith(
      env,
      {
        channel: 'posts',
        event: 'created',
        payload: { id: 'post-1' },
      },
      '/internal/broadcast',
    );
  });

  it('sends push notifications using auth-backed device lookups when available', async () => {
    const { buildTableHookRuntimeServices } = await import('../lib/table-hook-runtime.js');
    const authDb = { kind: 'auth-db' };
    resolveAuthDbMock.mockReturnValue(authDb);
    getDevicesForUserMock.mockResolvedValue([
      { token: 'token-1', platform: 'ios' },
      { token: 'token-2', platform: 'android' },
    ]);
    const env = {
      KV: {} as KVNamespace,
      AUTH_DB: {} as D1Database,
    } as Env;

    const pushConfig = {
      fcm: {
        projectId: 'demo-project',
        serviceAccount: '{"client_email":"demo@example.com"}',
      },
    };
    const services = buildTableHookRuntimeServices({ push: pushConfig } as never, env);
    await services.push.send('user-123', { title: 'Hello', body: 'World' });

    expect(resolveAuthDbMock).toHaveBeenCalledWith(env);
    expect(ensureAuthSchemaMock).toHaveBeenCalledWith(authDb);
    expect(createPushProviderMock).toHaveBeenCalledWith(pushConfig, env);
    expect(getDevicesForUserMock).toHaveBeenCalledWith({ kv: env.KV, authDb }, 'user-123');
    expect(providerSendMock).toHaveBeenCalledTimes(2);
    expect(providerSendMock).toHaveBeenNthCalledWith(1, {
      token: 'token-1',
      platform: 'ios',
      payload: { title: 'Hello', body: 'World' },
    });
    expect(providerSendMock).toHaveBeenNthCalledWith(2, {
      token: 'token-2',
      platform: 'android',
      payload: { title: 'Hello', body: 'World' },
    });
  });

  it('falls back to KV-only token lookups when auth db resolution fails', async () => {
    const { buildTableHookRuntimeServices } = await import('../lib/table-hook-runtime.js');
    resolveAuthDbMock.mockImplementation(() => {
      throw new Error('missing auth db');
    });
    getDevicesForUserMock.mockResolvedValue([{ token: 'token-1', platform: 'web' }]);
    const env = {
      KV: {} as KVNamespace,
    } as Env;

    const pushConfig = {
      fcm: {
        projectId: 'demo-project',
        serviceAccount: '{"client_email":"demo@example.com"}',
      },
    };
    const services = buildTableHookRuntimeServices({ push: pushConfig } as never, env);
    await services.push.send('user-123', { body: 'Fallback works' });

    expect(ensureAuthSchemaMock).not.toHaveBeenCalled();
    expect(getDevicesForUserMock).toHaveBeenCalledWith(env.KV, 'user-123');
    expect(providerSendMock).toHaveBeenCalledWith({
      token: 'token-1',
      platform: 'web',
      payload: { body: 'Fallback works' },
    });
  });
});
