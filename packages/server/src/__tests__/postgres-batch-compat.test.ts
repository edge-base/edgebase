import { describe, expect, it, vi, afterEach } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import type { Env } from '../types.js';

describe('postgres batch compatibility', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('accepts D1-style batch inserts for upsertMany and returns inserted rows', async () => {
    let insertCount = 0;
    const insertRows = [
      {
        id: 'probe-1',
        probeKey: 'probe-a',
        phase: 'batch',
        sourceProvider: 'neon',
        targetProvider: 'neon',
        checksum: 'checksum-a',
        verified: false,
      },
      {
        id: 'probe-2',
        probeKey: 'probe-b',
        phase: 'batch',
        sourceProvider: 'neon',
        targetProvider: 'neon',
        checksum: 'checksum-b',
        verified: false,
      },
    ];
    const executePostgresQuery = vi.fn(async (_cs: string, sql: string, _params?: unknown[]) => {
      if (sql.startsWith('INSERT INTO')) {
        return { rows: [insertRows[insertCount++]], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
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
              suite_provider_migration_probe: {
                schema: {
                  probeKey: { type: 'string', required: true, unique: true },
                  phase: { type: 'string', required: true },
                  sourceProvider: { type: 'string', required: true },
                  targetProvider: { type: 'string', required: true },
                  checksum: { type: 'string', required: true },
                  verified: { type: 'boolean', default: false },
                },
                access: {
                  insert: () => true,
                },
              },
            },
          },
        },
      }),
      DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
    } as unknown as Env;

    const request = new Request(
      'http://internal/api/db/shared/tables/suite_provider_migration_probe/batch?upsert=true&conflictTarget=probeKey',
      {
        method: 'POST',
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
        inserts: [
          {
            probeKey: 'probe-a',
            phase: 'batch',
            sourceProvider: 'neon',
            targetProvider: 'neon',
            checksum: 'checksum-a',
            verified: false,
          },
          {
            probeKey: 'probe-b',
            phase: 'batch',
            sourceProvider: 'neon',
            targetProvider: 'neon',
            checksum: 'checksum-b',
            verified: false,
          },
        ],
      },
    });

    const response = await handlePgRequest(
      ctx,
      'shared',
      'suite_provider_migration_probe',
      '/tables/suite_provider_migration_probe/batch',
    );
    const json = await response.json() as { inserted: Array<Record<string, unknown>>; items: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(json.inserted).toHaveLength(2);
    expect(json.items).toHaveLength(2);
    // Batch inserts are wrapped in a single BEGIN/COMMIT transaction.
    const sqls = executePostgresQuery.mock.calls.map((call) => call[1] as string);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(sqls.filter((sql) => sql.startsWith('INSERT INTO'))).toHaveLength(2);
    const firstSql = sqls.find((sql) => sql.startsWith('INSERT INTO'))!;
    expect(firstSql).toContain('ON CONFLICT ("probeKey") DO UPDATE');
  });
});
