import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import type { Env } from '../types.js';

describe('postgres field operator compatibility', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['PATCH', 'PUT'])('translates %s field operators into PostgreSQL update SQL', async (method) => {
    const executePostgresQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'post-1',
          viewCount: 1,
          avatar: 'old.png',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'post-1',
          viewCount: 2,
          avatar: null,
        }],
        rowCount: 1,
      });

    vi.doMock('../lib/postgres-executor.js', () => ({
      executePostgresQuery,
      ensureLocalDevPostgresSchema: vi.fn().mockResolvedValue(undefined),
      withPostgresConnection: vi.fn(async (_connectionString, fn) =>
        fn((sql: string, params: unknown[] = []) => executePostgresQuery(_connectionString, sql, params))),
      getLocalDevPostgresExecOptions: vi.fn(() => undefined),
      getProviderBindingName: () => 'DB_SHARED',
    }));
    vi.doMock('../lib/postgres-schema-init.js', () => ({
      ensurePgSchema: vi.fn().mockResolvedValue(undefined),
    }));

    const { handlePgRequest } = await import('../lib/postgres-handler.js');

    const env = {
      EDGEBASE_CONFIG: defineConfig({
        release: true,
        databases: {
          shared: {
            provider: 'postgres',
            connectionString: 'DB_POSTGRES_SHARED_URL',
            tables: {
              posts: {
                schema: {
                  title: { type: 'string' },
                  viewCount: { type: 'number' },
                  avatar: { type: 'string' },
                },
                access: {
                  update: () => true,
                },
              },
            },
          },
        },
      }),
      DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
    } as unknown as Env;

    const request = new Request(
      'http://internal/api/db/shared/tables/posts/post-1',
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Is-Service-Key': 'true',
        },
      },
    );

    const ctx = buildInternalHandlerContext({
      env,
      request,
      body: {
        viewCount: { $op: 'increment', value: 1 },
        avatar: { $op: 'deleteField' },
      },
    });

    const response = await handlePgRequest(ctx, 'shared', 'posts', '/tables/posts/post-1');
    expect(response.status).toBe(200);
    expect(executePostgresQuery).toHaveBeenCalledTimes(2);

    const updateSql = executePostgresQuery.mock.calls[1][1] as string;
    const updateParams = executePostgresQuery.mock.calls[1][2] as unknown[];

    expect(updateSql).toContain('"viewCount" = COALESCE("viewCount", 0) + $1');
    expect(updateSql).toContain('"avatar" = NULL');
    expect(updateSql).toContain('"updatedAt" = $2');
    expect(updateSql).toContain('WHERE "id" = $3');
    expect(updateParams[0]).toBe(1);
    expect(typeof updateParams[1]).toBe('string');
    expect(updateParams[2]).toBe('post-1');
  });

  it('translates batch-by-filter update field operators into PostgreSQL update SQL', async () => {
    const executePostgresQuery = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'post-1' }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'post-1',
          viewCount: 3,
          avatar: null,
        }],
        rowCount: 1,
      });

    vi.doMock('../lib/postgres-executor.js', () => ({
      executePostgresQuery,
      ensureLocalDevPostgresSchema: vi.fn().mockResolvedValue(undefined),
      withPostgresConnection: vi.fn(async (_connectionString, fn) =>
        fn((sql: string, params: unknown[] = []) => executePostgresQuery(_connectionString, sql, params))),
      getLocalDevPostgresExecOptions: vi.fn(() => undefined),
      getProviderBindingName: () => 'DB_SHARED',
    }));
    vi.doMock('../lib/postgres-schema-init.js', () => ({
      ensurePgSchema: vi.fn().mockResolvedValue(undefined),
    }));

    const { handlePgRequest } = await import('../lib/postgres-handler.js');

    const env = {
      EDGEBASE_CONFIG: defineConfig({
        release: true,
        databases: {
          shared: {
            provider: 'postgres',
            connectionString: 'DB_POSTGRES_SHARED_URL',
            tables: {
              posts: {
                schema: {
                  viewCount: { type: 'number' },
                  avatar: { type: 'string' },
                },
                access: {
                  update: () => true,
                },
              },
            },
          },
        },
      }),
      DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
    } as unknown as Env;

    const request = new Request(
      'http://internal/api/db/shared/tables/posts/batch-by-filter',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Is-Service-Key': 'true',
        },
      },
    );

    const waitUntil = vi.fn();
    const executionCtx = { waitUntil } as unknown as ExecutionContext;
    const ctx = buildInternalHandlerContext({
      env,
      request,
      executionCtx,
      body: {
        action: 'update',
        filter: [['id', '==', 'post-1']],
        update: {
          viewCount: { $op: 'increment', value: 2 },
          avatar: { $op: 'deleteField' },
        },
      },
    });

    const response = await handlePgRequest(ctx, 'shared', 'posts', '/tables/posts/batch-by-filter');
    const json = await response.json() as {
      processed: number;
      succeeded: number;
      updated: number;
      items: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      processed: 1,
      succeeded: 1,
      updated: 1,
    });
    expect(executePostgresQuery).toHaveBeenCalledTimes(2);

    const selectSql = executePostgresQuery.mock.calls[0][1] as string;
    const selectParams = executePostgresQuery.mock.calls[0][2] as unknown[];
    expect(selectSql).toContain('SELECT "posts"."id" FROM "posts"');
    expect(selectSql).toContain('WHERE "id" = $1');
    expect(selectSql).toContain('LIMIT $2');
    expect(selectSql).toContain('OFFSET $3');
    expect(selectParams).toEqual(['post-1', 500, 0]);

    const updateSql = executePostgresQuery.mock.calls[1][1] as string;
    const updateParams = executePostgresQuery.mock.calls[1][2] as unknown[];

    expect(updateSql).toContain('SET "viewCount" = COALESCE("viewCount", 0) + $2, "avatar" = NULL');
    expect(updateSql).toContain('"updatedAt" = $3');
    expect(updateSql).toContain('WHERE "id" IN ($1)');
    expect(updateParams[0]).toBe('post-1');
    expect(updateParams[1]).toBe(2);
    expect(typeof updateParams[2]).toBe('string');
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
