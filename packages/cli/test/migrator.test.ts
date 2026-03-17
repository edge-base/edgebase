/**
 * Tests for migrator.ts — CLI data migration engine.
 *
 * Tests the migration orchestration logic with mocked Admin API calls.
 * 실행: cd packages/cli && npx vitest run test/migrator.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setContext } from '../src/lib/cli-context.js';

// Mock fetchWithTimeout before importing migrator
const mockFetch = vi.fn();
vi.mock('../src/lib/fetch-with-timeout.js', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
}));

// Mock spinner (suppress output)
vi.mock('../src/lib/spinner.js', () => ({
  spin: () => ({
    succeed: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
    text: '',
  }),
}));

import {
  dumpCurrentData,
  restoreToNewProvider,
  executeMigration,
  promptMigration,
  type MigrationOptions,
  type DumpedData,
} from '../src/lib/migrator.js';

// ─── Helpers ───

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

const baseOpts: MigrationOptions = {
  scope: 'all',
  namespaces: ['shared'],
  serverUrl: 'https://my-app.workers.dev',
  serviceKey: 'sk_test123',
  dryRun: false,
};

beforeEach(() => {
  mockFetch.mockReset();
  setContext({ verbose: false, quiet: false, json: false, nonInteractive: false });
});

// ======================================================================
// 1. dumpCurrentData
// ======================================================================

describe('dumpCurrentData', () => {
  it('dumps auth tables when scope is auth', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: {
        _users: [{ id: 'u1', email: 'a@b.com' }],
        _sessions: [{ id: 's1', userId: 'u1' }, { id: 's2', userId: 'u1' }],
      },
    }));

    const result = await dumpCurrentData({ ...baseOpts, scope: 'auth' });

    expect(result.auth).toBeDefined();
    expect(result.auth!.tables._users).toHaveLength(1);
    expect(result.auth!.tables._sessions).toHaveLength(2);
    expect(result.data).toBeUndefined();

    // Verify correct API path
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toBe('https://my-app.workers.dev/admin/api/backup/dump-d1');
  });

  it('dumps data namespaces when scope is data', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: {
        posts: [{ id: 'p1', title: 'Hello' }],
        categories: [{ id: 'c1', name: 'Tech' }],
      },
      tableOrder: ['posts', 'categories'],
    }));

    const result = await dumpCurrentData({ ...baseOpts, scope: 'data', namespaces: ['shared'] });

    expect(result.data).toBeDefined();
    expect(result.data!.shared.tables.posts).toHaveLength(1);
    expect(result.data!.shared.tables.categories).toHaveLength(1);
    expect(result.auth).toBeUndefined();

    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toBe('https://my-app.workers.dev/admin/api/backup/dump-data');
  });

  it('dumps both auth and data when scope is all', async () => {
    // Auth dump
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: { _users: [{ id: 'u1' }] },
    }));
    // Data dump (shared)
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: { posts: [{ id: 'p1' }] },
      tableOrder: ['posts'],
    }));

    const result = await dumpCurrentData({ ...baseOpts, scope: 'all', namespaces: ['shared'] });

    expect(result.auth).toBeDefined();
    expect(result.data).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('skips data namespaces when namespaces array is empty', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: { _users: [{ id: 'u1' }] },
    }));

    const result = await dumpCurrentData({ ...baseOpts, scope: 'all', namespaces: [] });

    expect(result.auth).toBeDefined();
    expect(result.data).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only auth dump
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse('Unauthorized', 401));

    await expect(
      dumpCurrentData({ ...baseOpts, scope: 'auth' }),
    ).rejects.toThrow('Migration API error (401)');
  });

  it('sends correct headers (service key + content-type)', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ tables: {} }));

    await dumpCurrentData({ ...baseOpts, scope: 'auth' });

    const callOpts = mockFetch.mock.calls[0][1] as RequestInit;
    expect(callOpts.headers).toEqual(expect.objectContaining({
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': 'sk_test123',
    }));
  });

  it('dumps multiple data namespaces', async () => {
    // shared dump
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: { posts: [{ id: 'p1' }] },
      tableOrder: ['posts'],
    }));
    // analytics dump
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: { events: [{ id: 'e1' }, { id: 'e2' }] },
      tableOrder: ['events'],
    }));

    const result = await dumpCurrentData({
      ...baseOpts,
      scope: 'data',
      namespaces: ['shared', 'analytics'],
    });

    expect(result.data!.shared.tables.posts).toHaveLength(1);
    expect(result.data!.analytics.tables.events).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ======================================================================
// 2. restoreToNewProvider (per-table with progress bar)
// ======================================================================

describe('restoreToNewProvider', () => {
  it('restores auth tables with wipe + per-table calls', async () => {
    // Wipe call (skipWipe: false, empty tables)
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // Per-table: _users
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const dumped: DumpedData = {
      auth: { tables: { _users: [{ id: 'u1' }], _sessions: [] } },
    };
    await restoreToNewProvider({ ...baseOpts, scope: 'auth' }, dumped);

    // 1 wipe call + 1 per-table call (_sessions is empty, skipped)
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call: wipe (skipWipe: false, empty tables)
    const wipeBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(wipeBody.skipWipe).toBe(false);
    expect(wipeBody.tables).toEqual({});

    // Second call: _users (skipWipe: true)
    const restoreBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(restoreBody.skipWipe).toBe(true);
    expect(restoreBody.tables._users).toHaveLength(1);
  });

  it('restores data namespaces with wipe + per-table calls', async () => {
    // Wipe call
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // Per-table: posts
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const dumped: DumpedData = {
      data: {
        shared: { tables: { posts: [{ id: 'p1' }] } },
      },
    };
    await restoreToNewProvider({ ...baseOpts, scope: 'data' }, dumped);

    // 1 wipe + 1 per-table
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Wipe call has namespace and skipWipe: false
    const wipeBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(wipeBody.namespace).toBe('shared');
    expect(wipeBody.skipWipe).toBe(false);

    // Per-table call has skipWipe: true
    const restoreBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(restoreBody.namespace).toBe('shared');
    expect(restoreBody.skipWipe).toBe(true);
    expect(restoreBody.tables.posts).toHaveLength(1);
  });

  it('restores both auth and data when scope is all', async () => {
    // Auth wipe
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // Auth _users
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // Data wipe
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // Data posts
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const dumped: DumpedData = {
      auth: { tables: { _users: [{ id: 'u1' }] } },
      data: { shared: { tables: { posts: [{ id: 'p1' }] } } },
    };
    await restoreToNewProvider({ ...baseOpts, scope: 'all' }, dumped);

    // Auth: 1 wipe + 1 table, Data: 1 wipe + 1 table
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('skips auth restore when dumped.auth is undefined', async () => {
    // Data wipe
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // Data posts
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const dumped: DumpedData = {
      data: { shared: { tables: { posts: [{ id: 'p1' }] } } },
    };
    await restoreToNewProvider({ ...baseOpts, scope: 'all' }, dumped);

    // Only data: 1 wipe + 1 table
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstCallUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain('/restore-data');
  });

  it('uses 300s timeout for all restore calls', async () => {
    // Wipe call
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // Per-table: _users
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const dumped: DumpedData = {
      auth: { tables: { _users: [{ id: 'u1' }] } },
    };
    await restoreToNewProvider({ ...baseOpts, scope: 'auth' }, dumped);

    // Both calls use 300_000 timeout (3rd argument)
    expect(mockFetch.mock.calls[0][2]).toBe(300_000);
    expect(mockFetch.mock.calls[1][2]).toBe(300_000);
  });

  it('sends multiple per-table calls for multiple non-empty tables', async () => {
    // Wipe
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // _users
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // _sessions
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // _oauth_accounts
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const dumped: DumpedData = {
      auth: {
        tables: {
          _users: [{ id: 'u1' }, { id: 'u2' }],
          _sessions: [{ id: 's1' }],
          _oauth_accounts: [{ id: 'o1' }],
          _email_tokens: [], // empty — should be skipped
        },
      },
    };
    await restoreToNewProvider({ ...baseOpts, scope: 'auth' }, dumped);

    // 1 wipe + 3 per-table (empty _email_tokens skipped)
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // Verify each per-table call sends only one table
    for (let i = 1; i <= 3; i++) {
      const body = JSON.parse(mockFetch.mock.calls[i][1].body as string);
      expect(body.skipWipe).toBe(true);
      expect(Object.keys(body.tables)).toHaveLength(1);
    }
  });

  it('only wipes when all tables are empty', async () => {
    // Wipe call only
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const dumped: DumpedData = {
      auth: { tables: { _users: [], _sessions: [] } },
    };
    await restoreToNewProvider({ ...baseOpts, scope: 'auth' }, dumped);

    // Only 1 wipe call, no per-table calls (all empty)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.skipWipe).toBe(false);
  });
});

describe('promptMigration', () => {
  it('raises a structured decision request in non-interactive mode', async () => {
    setContext({ verbose: false, quiet: false, json: true, nonInteractive: true });

    await expect(promptMigration([
      { namespace: 'shared', oldProvider: 'd1', newProvider: 'postgres' },
    ])).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'needs_input',
        code: 'provider_migration_decision_required',
        field: 'migrationAction',
      }),
    });
  });
});

// ======================================================================
// 3. executeMigration (full orchestrator)
// ======================================================================

describe('executeMigration', () => {
  it('runs dump then restore and returns result counts', async () => {
    // dump-d1 (auth)
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: {
        _users: [{ id: 'u1' }, { id: 'u2' }],
        _sessions: [{ id: 's1' }],
      },
    }));
    // dump-data (shared)
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: { posts: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] },
      tableOrder: ['posts'],
    }));
    // restore-d1 wipe
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // restore-d1 _users
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // restore-d1 _sessions
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // restore-data wipe
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));
    // restore-data posts
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const result = await executeMigration({
      ...baseOpts,
      scope: 'all',
      namespaces: ['shared'],
    });

    expect(result.success).toBe(true);
    expect(result.authTables).toBe(2);
    expect(result.authRows).toBe(3); // 2 users + 1 session
    expect(result.dataTables).toBe(1);
    expect(result.dataRows).toBe(3);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.errors).toHaveLength(0);
  });

  it('delegates to dryRunSummary when dryRun is true', async () => {
    // dry-run still calls dump APIs to count rows
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      tables: { _users: [{ id: 'u1' }] },
    }));

    const result = await executeMigration({
      ...baseOpts,
      scope: 'auth',
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.authTables).toBe(1);
    expect(result.authRows).toBe(1);
    // Only 1 API call (dump for preview), no restore
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

// ======================================================================
// 4. URL construction
// ======================================================================

describe('URL construction', () => {
  it('strips trailing slash from serverUrl', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ tables: {} }));

    await dumpCurrentData({
      ...baseOpts,
      scope: 'auth',
      serverUrl: 'https://my-app.workers.dev/',
    });

    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toBe('https://my-app.workers.dev/admin/api/backup/dump-d1');
    expect(callUrl).not.toContain('//admin');
  });

  it('works with localhost URLs', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ tables: {} }));

    await dumpCurrentData({
      ...baseOpts,
      scope: 'auth',
      serverUrl: 'http://localhost:8787',
    });

    const callUrl = mockFetch.mock.calls[0][0] as string;
    expect(callUrl).toBe('http://localhost:8787/admin/api/backup/dump-d1');
  });
});
