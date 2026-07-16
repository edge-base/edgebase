import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import type { Env } from '../types.js';

const CONFIG = defineConfig({
  release: true,
  databases: {
    shared: {
      provider: 'postgres',
      connectionString: 'DB_POSTGRES_SHARED_URL',
      tables: {
        docs: {
          schema: { title: { type: 'string' } },
          access: { read: () => true },
        },
      },
    },
  },
});

interface CursorRow {
  token: string;
  table_name: string;
  record_id: string;
  expires_at: number;
}

function makeEnv(): Env {
  return {
    EDGEBASE_CONFIG: CONFIG,
    DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
  } as unknown as Env;
}

function assertExactBoundedBody(body: string, maxResponseBytes: number) {
  const returnedBytes = new TextEncoder().encode(body).byteLength;
  const parsed = JSON.parse(body) as { returnedBytes: number };
  expect(parsed.returnedBytes).toBe(returnedBytes);
  expect(returnedBytes).toBeLessThanOrEqual(maxResponseBytes);
  return parsed as Record<string, unknown>;
}

describe('PostgreSQL bounded response parity', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('keeps default reads write-free and resumes oversized legacy ids with opaque provider cursors', async () => {
    const oversizedId = `b${'x'.repeat(20_000)}`;
    const records = [
      { id: 'a', title: 'small' },
      { id: oversizedId, title: 'legacy oversized id' },
      { id: 'c', title: 'small' },
    ];
    const cursors = new Map<string, CursorRow>();
    const calls: Array<{ sql: string; params: unknown[] }> = [];

    vi.doMock('../lib/postgres-executor.js', () => ({
      executePostgresQuery: vi.fn(),
      ensureLocalDevPostgresSchema: vi.fn().mockResolvedValue(undefined),
      getLocalDevPostgresExecOptions: vi.fn(() => undefined),
      getProviderBindingName: () => 'DB_POSTGRES_SHARED',
      withPostgresConnection: vi.fn(async (
        _connectionString: string,
        fn: (query: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<unknown>,
      ) => fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (/^(?:CREATE TABLE|CREATE INDEX)/.test(sql)) return { rows: [], rowCount: 0 };
        if (/^DELETE FROM "_edgebase_response_cursors"/.test(sql)) {
          const deleted: CursorRow[] = [];
          for (const [token, row] of cursors) {
            if (row.expires_at <= Number(params[0]) && deleted.length < Number(params[1] ?? 1)) {
              cursors.delete(token);
              deleted.push(row);
            }
          }
          return { rows: deleted.map(({ token }) => ({ token })), rowCount: deleted.length };
        }
        if (/^SELECT .* FROM "_edgebase_response_cursors" WHERE "token"/.test(sql)) {
          const row = cursors.get(String(params[0]));
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (/^SELECT .* FROM "_edgebase_response_cursors" WHERE "table_name"/.test(sql)) {
          const row = [...cursors.values()].find((candidate) =>
            candidate.table_name === params[0] && candidate.record_id === params[1]);
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (/^INSERT INTO "_edgebase_response_cursors"/.test(sql)) {
          const [token, tableName, recordId, expiresAt] = params;
          const conflict = cursors.has(String(token)) || [...cursors.values()].some((candidate) =>
            candidate.table_name === tableName && candidate.record_id === recordId);
          if (conflict) return { rows: [], rowCount: 0 };
          const row = {
            token: String(token),
            table_name: String(tableName),
            record_id: String(recordId),
            expires_at: Number(expiresAt),
          };
          cursors.set(row.token, row);
          return { rows: [{ token: row.token }], rowCount: 1 };
        }
        if (/^UPDATE "_edgebase_response_cursors"/.test(sql)) {
          const row = cursors.get(String(params[1]));
          if (row) row.expires_at = Number(params[0]);
          return { rows: [], rowCount: row ? 1 : 0 };
        }
        if (/^SELECT/.test(sql) && /FROM "docs"/.test(sql)) {
          const after = params.find((value) => value === 'a' || value === oversizedId);
          const start = after === undefined
            ? 0
            : records.findIndex(({ id }) => id === after) + 1;
          const rows = records.slice(start, start + 3);
          return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      })),
    }));
    vi.doMock('../lib/postgres-schema-init.js', () => ({
      ensurePgSchema: vi.fn().mockResolvedValue(undefined),
    }));

    const { handlePgRequest } = await import('../lib/postgres-handler.js');
    const call = (query: string) => handlePgRequest(
      buildInternalHandlerContext({
        env: makeEnv(),
        request: new Request(`http://internal/api/db/shared/tables/docs?${query}`, {
          headers: { 'X-Is-Service-Key': 'true' },
        }),
      }) as never,
      'shared',
      'docs',
      '/tables/docs',
    );

    expect((await call('limit=3&includeTotal=0')).status).toBe(200);
    expect(calls.some(({ sql }) => sql.includes('_edgebase_response_cursors'))).toBe(false);

    const delivered: string[] = [];
    const isolated: string[] = [];
    let cursor: string | undefined;
    for (let pass = 0; pass < 6; pass += 1) {
      const response = await call([
        'limit=3',
        'includeTotal=0',
        'maxResponseBytes=512',
        ...(cursor ? [`responseAfter=${encodeURIComponent(cursor)}`] : []),
      ].join('&'));
      expect(response.status).toBe(200);
      const json = assertExactBoundedBody(await response.text(), 512) as {
        items: Array<{ id: string }>;
        cursor: string | null;
        hasMore: boolean;
        oversizedItem?: boolean;
        cursorExpiresAt?: string;
      };
      delivered.push(...json.items.map(({ id }) => id));
      if (json.oversizedItem) isolated.push(oversizedId);
      if (!json.cursor || !json.hasMore) break;
      expect(json.cursor).toMatch(/^~edgebase-response-cursor-v1\.[A-Za-z0-9_-]{32}$/);
      expect(json.cursorExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      cursor = json.cursor;
    }

    expect(delivered).toEqual(['a', 'c']);
    expect(isolated).toEqual([oversizedId]);
    expect([...cursors.values()].some(({ record_id }) => record_id === oversizedId)).toBe(true);
    expect([...cursors.keys()].every((token) => !token.includes(oversizedId))).toBe(true);
    expect(calls.some(({ sql, params }) => /"id" >/.test(sql) && params.includes('a'))).toBe(true);
    expect(calls.some(({ sql, params }) => /"id" >/.test(sql) && params.includes(oversizedId))).toBe(true);
  });
});
