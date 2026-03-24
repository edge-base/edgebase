import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { setConfig } from '../lib/do-router.js';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

function createCtx() {
  return {
    storage: {
      sql: {
        exec: vi.fn(),
      },
    },
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
}

function createEnv() {
  return {
    DATABASE_LIVE: {} as DurableObjectNamespace,
    DATABASE: {} as DurableObjectNamespace,
    AUTH: {} as DurableObjectNamespace,
  };
}

describe('DatabaseDO route validation', () => {
  afterEach(() => {
    setConfig({});
  });

  it('rejects id-suffixed doNames for single-instance namespaces', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        app: {
          provider: 'do',
          tables: {
            posts: {},
          },
        },
      },
    }));

    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const ctx = createCtx();
    const databaseDo = new DatabaseDO(ctx, createEnv() as never);

    const response = await databaseDo.fetch(new Request('http://do/tables/posts', {
      headers: {
        'X-DO-Name': 'app:shadow',
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 400,
      message: "instanceId is not allowed for single-instance namespace 'app'",
      error: 'INVALID_DB_INSTANCE_ID',
    });
    expect((ctx.storage.sql.exec as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('rejects missing instance ids for dynamic namespaces', async () => {
    setConfig(defineConfig({
      release: true,
      databases: {
        workspace: {
          provider: 'do',
          instance: true,
          tables: {
            users: {},
          },
        },
      },
    }));

    const { DatabaseDO } = await import('../durable-objects/database-do.js');
    const ctx = createCtx();
    const databaseDo = new DatabaseDO(ctx, createEnv() as never);

    const response = await databaseDo.fetch(new Request('http://do/tables/users', {
      headers: {
        'X-DO-Name': 'workspace',
      },
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 400,
      message: "instanceId is required for dynamic namespace 'workspace'",
      error: 'INVALID_DB_INSTANCE_ID',
    });
    expect((ctx.storage.sql.exec as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
