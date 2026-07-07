/**
 * PostgreSQL handler ↔ D1/DO contract parity (single-record + search):
 * - GET /search without a term → 200 { items: [] } (was 400)
 * - PATCH {id} with an empty body → 200 existing record (was 400)
 * - DELETE {id} → { deleted: true } (was { success: true, deleted: <row> })
 * - validation failures carry only { code, message, data } (no legacy `errors`)
 * - 403 rule-rejection wording matches the D1 handler
 *
 * Uses a mocked executor (same pattern as postgres-batch.test.ts).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
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
        api_docs: {
          schema: {
            title: { type: 'string', required: true },
            status: { type: 'string' },
          },
          access: {
            read: () => true,
            insert: () => true,
            update: () => true,
            delete: () => true,
          },
        },
        // Auto timestamps disabled so an empty update body yields a genuinely
        // empty change set (exercises the no-op early-return path).
        api_notes: {
          schema: {
            title: { type: 'string', required: true },
            createdAt: false,
            updatedAt: false,
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

function makeEnv(): Env {
  return {
    EDGEBASE_CONFIG: CONFIG,
    DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
  } as unknown as Env;
}

function mockExecutorModule(
  handler: (sql: string, params: unknown[]) => { rows: Record<string, unknown>[]; rowCount: number },
) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  vi.doMock('../lib/postgres-executor.js', () => ({
    executePostgresQuery: vi.fn(),
    ensureLocalDevPostgresSchema: vi.fn().mockResolvedValue(undefined),
    withPostgresConnection: vi.fn(async (_cs: string, fn: (q: unknown) => Promise<unknown>) =>
      fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return handler(sql, params);
      })),
    getLocalDevPostgresExecOptions: vi.fn(() => undefined),
    getProviderBindingName: () => 'DB_POSTGRES_SHARED',
  }));
  vi.doMock('../lib/postgres-schema-init.js', () => ({
    ensurePgSchema: vi.fn().mockResolvedValue(undefined),
  }));
  return calls;
}

async function callPg(
  method: string,
  path: string,
  { body, search, table = 'api_docs' }: { body?: unknown; search?: string; table?: string } = {},
) {
  const { handlePgRequest } = await import('../lib/postgres-handler.js');
  const qs = search !== undefined ? `?search=${encodeURIComponent(search)}` : '';
  const url = `http://internal/api/db/shared${path}${qs}`;
  const ctx = buildInternalHandlerContext({
    env: makeEnv(),
    request: new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Is-Service-Key': 'true' },
    }),
    body: body as Record<string, unknown>,
  });
  return handlePgRequest(ctx as never, 'shared', table, path);
}

describe('postgres API consistency (D1/DO parity)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns 200 { items: [] } when the search term is missing (no 400)', async () => {
    const calls = mockExecutorModule(() => ({ rows: [], rowCount: 0 }));
    const response = await callPg('GET', '/tables/api_docs/search');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    // Early return — no search query is issued.
    expect(calls.some((c) => /ILIKE/i.test(c.sql))).toBe(false);
  });

  it('returns the existing record with 200 for an empty update body (no 400)', async () => {
    const existing = { id: 'note-1', title: 'Kept' };
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT')) return { rows: [existing], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await callPg('PATCH', '/tables/api_notes/note-1', { body: {}, table: 'api_notes' });
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.id).toBe('note-1');
    expect(json.title).toBe('Kept');
    // No UPDATE statement is executed for a no-op update.
    expect(calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('returns { deleted: true } from a single-record delete', async () => {
    const existing = { id: 'doc-1', title: 'Bye', status: 'open' };
    mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT')) return { rows: [existing], rowCount: 1 };
      if (sql.startsWith('DELETE')) return { rows: [existing], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await callPg('DELETE', '/tables/api_docs/doc-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
  });

  it('omits the legacy `errors` field from validation failures', async () => {
    mockExecutorModule(() => ({ rows: [], rowCount: 0 }));
    // Missing required `title`.
    const response = await callPg('POST', '/tables/api_docs', { body: { status: 'open' } });
    expect(response.status).toBe(400);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.data).toBeDefined();
    expect(json).not.toHaveProperty('errors');
  });
});
