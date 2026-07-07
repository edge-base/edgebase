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
  { body, search, query, table = 'api_docs' }:
    { body?: unknown; search?: string; query?: string; table?: string } = {},
) {
  const { handlePgRequest } = await import('../lib/postgres-handler.js');
  const qs = search !== undefined
    ? `?search=${encodeURIComponent(search)}`
    : query !== undefined ? `?${query}` : '';
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

  it('runs an ILIKE search over text fields when a term is provided', async () => {
    const hit = { id: 'doc-1', title: 'hello world', status: 'open' };
    const calls = mockExecutorModule((sql) => {
      if (/ILIKE/i.test(sql) && !/COUNT/i.test(sql)) return { rows: [hit], rowCount: 1 };
      if (/COUNT/i.test(sql)) return { rows: [{ total: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await callPg('GET', '/tables/api_docs/search', { search: 'hello' });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { items: unknown[]; total: number };
    expect(json.items).toHaveLength(1);
    expect(json.total).toBe(1);
    // The search scans the schema's text columns (title, status), not just id.
    const searchSql = calls.find((c) => /ILIKE/i.test(c.sql))?.sql ?? '';
    expect(searchSql).toMatch(/"title"/);
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

  it('lists records with a total count', async () => {
    mockExecutorModule((sql) => {
      if (/COUNT/i.test(sql)) return { rows: [{ total: 2 }], rowCount: 1 };
      if (sql.startsWith('SELECT')) {
        return { rows: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    });
    const response = await callPg('GET', '/tables/api_docs');
    expect(response.status).toBe(200);
    const json = (await response.json()) as { items: unknown[]; total: number };
    expect(json.items).toHaveLength(2);
    expect(json.total).toBe(2);
  });

  it('skips the COUNT query when includeTotal=0 (total is null)', async () => {
    const calls = mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT')) return { rows: [{ id: 'a', title: 'A' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await callPg('GET', '/tables/api_docs', { query: 'includeTotal=0' });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { items: unknown[]; total: number | null };
    expect(json.items).toHaveLength(1);
    expect(json.total).toBeNull();
    expect(calls.some((c) => /COUNT/i.test(c.sql))).toBe(false);
  });

  it('gets a single record by id', async () => {
    mockExecutorModule((sql) => {
      if (sql.startsWith('SELECT')) return { rows: [{ id: 'doc-1', title: 'Hi' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await callPg('GET', '/tables/api_docs/doc-1');
    expect(response.status).toBe(200);
    expect((await response.json() as { id: string }).id).toBe('doc-1');
  });

  it('returns 404 for a missing record', async () => {
    mockExecutorModule(() => ({ rows: [], rowCount: 0 }));
    const response = await callPg('GET', '/tables/api_docs/nope');
    expect(response.status).toBe(404);
  });

  it('counts records', async () => {
    mockExecutorModule((sql) => {
      if (/COUNT/i.test(sql)) return { rows: [{ total: 7 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const response = await callPg('GET', '/tables/api_docs/count');
    expect(response.status).toBe(200);
    expect((await response.json() as { total: number }).total).toBe(7);
  });

  it('inserts a record and returns it', async () => {
    mockExecutorModule((sql) => {
      if (sql.startsWith('INSERT')) {
        return { rows: [{ id: 'new-1', title: 'Fresh', status: 'open' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const response = await callPg('POST', '/tables/api_docs', { body: { title: 'Fresh' } });
    expect([200, 201]).toContain(response.status);
    expect((await response.json() as { title: string }).title).toBe('Fresh');
  });
});
