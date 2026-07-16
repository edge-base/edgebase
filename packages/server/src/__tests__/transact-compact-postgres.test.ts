import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import type { Env } from '../types.js';

const HUGE_PAYLOAD = '한'.repeat(750_000);

const CONFIG = defineConfig({
  release: true,
  databases: {
    compact_pg: {
      provider: 'postgres',
      connectionString: 'DB_POSTGRES_COMPACT_PG_URL',
      tables: {
        docs: {
          schema: {
            title: { type: 'string' },
            payload: { type: 'string' },
          },
          access: {
            read: () => true,
            insert: () => true,
            update: () => true,
            delete: () => true,
          },
        },
      },
    },
  },
});

interface MockQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

function quotedColumns(fragment: string): string[] {
  return [...fragment.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

describe('compact transact PostgreSQL provider', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('commits huge mixed operations without RETURNING/full rows and preserves default full mode', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const rows = new Map<string, Record<string, unknown>>([
      ['source', { id: 'source', title: 'before', payload: HUGE_PAYLOAD }],
      ['delete-me', { id: 'delete-me', title: 'delete', payload: HUGE_PAYLOAD }],
    ]);
    let suppressNextReturningRow = false;

    const execute = (sql: string, params: unknown[] = []): MockQueryResult => {
      calls.push({ sql, params });
      if (/^(?:BEGIN|COMMIT|ROLLBACK)\b/.test(sql)) return { rows: [], rowCount: 0 };
      if (sql.startsWith('SELECT 1 AS "matched" FROM "docs"')) {
        return rows.has(String(params[0]))
          ? { rows: [{ matched: 1 }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SELECT * FROM "docs"')) {
        const row = rows.get(String(params[0]));
        return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('INSERT INTO "docs"')) {
        const columnFragment = sql.match(/\(([^)]+)\) VALUES/)?.[1] ?? '';
        const record = Object.fromEntries(
          quotedColumns(columnFragment).map((column, index) => [column, params[index]]),
        );
        rows.set(String(record.id), record);
        if (/\bRETURNING\b/.test(sql) && suppressNextReturningRow) {
          suppressNextReturningRow = false;
          return { rows: [], rowCount: 0 };
        }
        return /\bRETURNING\b/.test(sql)
          ? { rows: [{ ...record }], rowCount: 1 }
          : { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE "docs"')) {
        const id = String(params[params.length - 1]);
        const current = rows.get(id);
        if (!current) return { rows: [], rowCount: 0 };
        const setFragment = sql.match(/ SET (.+) WHERE /)?.[1] ?? '';
        const columns = quotedColumns(setFragment);
        columns.forEach((column, index) => {
          current[column] = params[index];
        });
        return /\bRETURNING\b/.test(sql)
          ? { rows: [{ ...current }], rowCount: 1 }
          : { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM "docs"')) {
        const existed = rows.delete(String(params[0]));
        return /\bRETURNING\b/.test(sql)
          ? { rows: existed ? [{ id: params[0] }] : [], rowCount: existed ? 1 : 0 }
          : { rows: [], rowCount: existed ? 1 : 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    };

    vi.doMock('../lib/postgres-executor.js', () => ({
      executePostgresQuery: vi.fn(),
      ensureLocalDevPostgresSchema: vi.fn().mockResolvedValue(undefined),
      withPostgresConnection: vi.fn(async (_cs: string, fn: (q: unknown) => Promise<unknown>) =>
        fn(execute)),
      getLocalDevPostgresExecOptions: vi.fn(() => undefined),
      getProviderBindingName: () => 'DB_POSTGRES_COMPACT_PG',
    }));
    vi.doMock('../lib/postgres-schema-init.js', () => ({
      ensurePgSchema: vi.fn().mockResolvedValue(undefined),
    }));

    const env = {
      EDGEBASE_CONFIG: CONFIG,
      DB_POSTGRES_COMPACT_PG_URL: 'postgres://edgebase:test@localhost/compact',
    } as unknown as Env;
    const { handlePgRequest } = await import('../lib/postgres-handler.js');
    const call = (body: Record<string, unknown>, withServiceKey = true) => {
      const context = buildInternalHandlerContext({
        env,
        request: new Request('http://internal/api/db/compact_pg/transact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(withServiceKey ? { 'X-Is-Service-Key': 'true' } : {}),
          },
        }),
        body,
      });
      if (!withServiceKey) {
        (context as unknown as { get(key: string): unknown }).get = (key: string) => {
          if (key === 'auth') return null;
          if (key === 'isServiceKey' || key === 'isInternalRequest') return false;
          return undefined;
        };
      }
      return handlePgRequest(context, 'compact_pg', '', '/transact');
    };

    const compact = await call({
      resultMode: 'compact',
      operations: [
        { table: 'docs', op: 'expect', id: 'source', exists: true },
        { table: 'docs', op: 'insert', data: { id: 'inserted', title: 'new', payload: HUGE_PAYLOAD } },
        { table: 'docs', op: 'update', id: 'source', data: { title: 'after' } },
        { table: 'docs', op: 'delete', id: 'delete-me' },
      ],
    });
    expect(compact.status).toBe(200);
    const compactText = await compact.text();
    expect(compactText).toBe('{"committed":true,"operationCount":4}');
    expect(new TextEncoder().encode(compactText).byteLength).toBeLessThanOrEqual(39);
    const compactSql = calls.map(({ sql }) => sql);
    expect(compactSql.some((sql) => /\bSELECT\s+\*/i.test(sql))).toBe(false);
    expect(compactSql.some((sql) => /\bRETURNING\b/i.test(sql))).toBe(false);
    expect(compactSql[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(compactSql.at(-1)).toBe('COMMIT');
    expect(rows.get('source')).toMatchObject({ title: 'after', payload: HUGE_PAYLOAD });
    expect(rows.get('inserted')).toMatchObject({ title: 'new', payload: HUGE_PAYLOAD });
    expect(rows.has('delete-me')).toBe(false);

    calls.length = 0;
    const full = await call({
      operations: [{ table: 'docs', op: 'update', id: 'source', data: { title: 'full' } }],
    });
    const fullText = await full.text();
    expect(full.status).toBe(200);
    expect(new TextEncoder().encode(fullText).byteLength).toBeGreaterThan(2_000_000);
    expect(calls.some(({ sql }) => /\bRETURNING\s+\*/i.test(sql))).toBe(true);

    calls.length = 0;
    suppressNextReturningRow = true;
    const fullFallback = await call({
      operations: [
        { table: 'docs', op: 'insert', data: { id: 'fallback', title: 'legacy fallback' } },
      ],
    });
    expect(fullFallback.status).toBe(200);
    expect(await fullFallback.json()).toMatchObject({
      results: [{ inserted: { id: 'fallback', title: 'legacy fallback' } }],
    });

    calls.length = 0;
    const invalid = await call({
      resultMode: 'verbose',
      operations: [{ table: 'docs', op: 'update', id: 'source', data: { title: 'invalid' } }],
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ slug: 'invalid-transact-result-mode' });
    expect(calls).toEqual([]);
    expect(rows.get('source')).toMatchObject({ title: 'full' });

    calls.length = 0;
    const authorized = await call({
      resultMode: 'compact',
      operations: [
        { table: 'docs', op: 'expect', id: 'source', exists: true },
        { table: 'docs', op: 'update', id: 'source', data: { title: 'authorized' } },
        { table: 'docs', op: 'delete', id: 'inserted' },
      ],
    }, false);
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toBe('{"committed":true,"operationCount":3}');
    expect(calls.filter(({ sql }) => /\bSELECT\s+\*/i.test(sql))).toHaveLength(3);
    expect(calls.some(({ sql }) => /\bRETURNING\b/i.test(sql))).toBe(false);
    expect(rows.get('source')).toMatchObject({ title: 'authorized' });
    expect(rows.has('inserted')).toBe(false);
  });
});
