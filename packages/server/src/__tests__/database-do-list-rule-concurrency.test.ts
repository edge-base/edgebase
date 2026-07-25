import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  defineConfig,
  type EdgeBaseConfig,
  type TableRules,
} from '@edge-base/shared';
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

const TABLE = 'guarded_rows';
const DECLARED_RULE_CONCURRENCY = 8;

interface PendingRule {
  resolve(value: boolean): void;
  reject(error: Error): void;
}

function rowId(index: number): string {
  return `row-${String(index).padStart(2, '0')}`;
}

function createSQLiteCtx(database: DatabaseSync) {
  return {
    storage: {
      sql: {
        exec(query: string, ...params: unknown[]) {
          return database.prepare(query).all(...(params as never[]));
        },
      },
      transactionSync(callback: () => void) {
        database.exec('BEGIN');
        try {
          callback();
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    },
    waitUntil: vi.fn(),
  } as unknown as DurableObjectState;
}

function createConfig(read: NonNullable<TableRules['read']>): EdgeBaseConfig {
  return defineConfig({
    release: true,
    databases: {
      app: {
        provider: 'do',
        tables: {
          [TABLE]: {
            schema: { title: { type: 'string', required: true } },
            access: {
              read,
              insert: true,
              update: true,
              delete: true,
            },
          },
        },
      },
    },
  });
}

async function createDatabaseDo(
  read: NonNullable<TableRules['read']>,
  rowCount: number,
): Promise<{
  database: DatabaseSync;
  databaseDo: { fetch(request: Request): Promise<Response> };
}> {
  const database = new DatabaseSync(':memory:');
  const config = createConfig(read);
  setConfig(config);
  const { DatabaseDO } = await import('../durable-objects/database-do.js');
  const databaseDo = new DatabaseDO(
    createSQLiteCtx(database),
    {
      DATABASE_LIVE: {} as DurableObjectNamespace,
      DATABASE: {} as DurableObjectNamespace,
      AUTH: {} as DurableObjectNamespace,
    } as never,
  );
  const warmup = await databaseDo.fetch(new Request(
    `http://do/tables/${TABLE}?limit=0&includeTotal=0`,
    { headers: { 'X-DO-Name': 'app', 'X-EdgeBase-Internal': 'true' } },
  ));
  expect(warmup.status).toBe(200);

  const insert = database.prepare(
    `INSERT INTO "${TABLE}" ("id", "title") VALUES (?, ?)`,
  );
  for (let index = 0; index < rowCount; index += 1) {
    insert.run(rowId(index), `Synthetic row ${index}`);
  }

  return { database, databaseDo };
}

function requestList(
  databaseDo: { fetch(request: Request): Promise<Response> },
  rowCount: number,
): Promise<Response> {
  return databaseDo.fetch(new Request(
    `http://do/tables/${TABLE}?limit=${rowCount}&sort=id:asc&includeTotal=0`,
    { headers: { 'X-DO-Name': 'app' } },
  ));
}

function createHeldRuleProbe() {
  const started: string[] = [];
  const settled: string[] = [];
  const pending = new Map<string, PendingRule>();
  let active = 0;
  let peak = 0;

  const read: NonNullable<TableRules['read']> = (_auth, row) => {
    const id = String(row.id);
    started.push(id);
    active += 1;
    peak = Math.max(peak, active);
    return new Promise<boolean>((resolve, reject) => {
      let isSettled = false;
      const finish = (settle: () => void) => {
        if (isSettled) return;
        isSettled = true;
        active -= 1;
        settled.push(id);
        settle();
      };
      pending.set(id, {
        resolve(value) {
          finish(() => resolve(value));
        },
        reject(error) {
          finish(() => reject(error));
        },
      });
    });
  };

  return {
    read,
    started,
    settled,
    pending,
    active: () => active,
    peak: () => peak,
  };
}

async function waitForStarted(started: string[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && started.length < count; attempt += 1) {
    await Promise.resolve();
  }
  expect(started).toHaveLength(count);
}

describe('DatabaseDO list read-rule concurrency', () => {
  afterEach(() => {
    vi.useRealTimers();
    setConfig({});
  });

  it('drains held rows through exactly eight workers and preserves response order', async () => {
    const probe = createHeldRuleProbe();
    const rowCount = 17;
    const { database, databaseDo } = await createDatabaseDo(probe.read, rowCount);
    try {
      let responseSettled = false;
      const responsePromise = requestList(databaseDo, rowCount);
      void responsePromise.then(() => { responseSettled = true; });

      await waitForStarted(probe.started, DECLARED_RULE_CONCURRENCY);
      expect(probe.peak()).toBe(DECLARED_RULE_CONCURRENCY);

      for (let index = 0; index < rowCount - DECLARED_RULE_CONCURRENCY; index += 1) {
        probe.pending.get(rowId(index))?.resolve(true);
        await waitForStarted(probe.started, DECLARED_RULE_CONCURRENCY + index + 1);
      }

      expect(probe.started).toEqual(Array.from({ length: rowCount }, (_, index) => rowId(index)));
      expect(responseSettled).toBe(false);

      for (let index = rowCount - DECLARED_RULE_CONCURRENCY; index < rowCount; index += 1) {
        probe.pending.get(rowId(index))?.resolve(true);
      }
      const response = await responsePromise;
      expect(response.status).toBe(200);
      const body = await response.json() as {
        items: Array<{ id: string }>;
        total: number | null;
      };
      expect(body.items.map(({ id }) => id)).toEqual(
        Array.from({ length: rowCount }, (_, index) => rowId(index)),
      );
      expect(body.total).toBeNull();
      expect(probe.settled).toHaveLength(rowCount);
      expect(new Set(probe.settled).size).toBe(rowCount);
      expect(probe.active()).toBe(0);
      expect(probe.peak()).toBe(DECLARED_RULE_CONCURRENCY);
    } finally {
      database.close();
    }
  });

  it('fully settles false and rejected rows before the first source-order denial owns the 403', async () => {
    const probe = createHeldRuleProbe();
    const rowCount = 12;
    const { database, databaseDo } = await createDatabaseDo(probe.read, rowCount);
    try {
      let responseSettled = false;
      const responsePromise = requestList(databaseDo, rowCount);
      void responsePromise.then(() => { responseSettled = true; });
      await waitForStarted(probe.started, DECLARED_RULE_CONCURRENCY);

      probe.pending.get(rowId(0))?.resolve(true);
      await waitForStarted(probe.started, 9);
      probe.pending.get(rowId(1))?.resolve(false);
      await waitForStarted(probe.started, 10);
      probe.pending.get(rowId(2))?.resolve(true);
      await waitForStarted(probe.started, 11);
      probe.pending.get(rowId(3))?.reject(new Error('synthetic rule failure'));
      await waitForStarted(probe.started, 12);

      expect(responseSettled).toBe(false);
      for (let index = 4; index < rowCount; index += 1) {
        probe.pending.get(rowId(index))?.resolve(true);
      }

      const response = await responsePromise;
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        message: `Access denied. The 'read' access rule for table '${TABLE}' rejected record '${rowId(1)}'.`,
      });
      expect(probe.started).toHaveLength(rowCount);
      expect(probe.settled).toHaveLength(rowCount);
      expect(probe.active()).toBe(0);
      expect(probe.peak()).toBe(DECLARED_RULE_CONCURRENCY);
    } finally {
      database.close();
    }
  });

  it('drains independent rows while one rule times out at the existing 50 ms fail-closed boundary', async () => {
    const started: string[] = [];
    const read: NonNullable<TableRules['read']> = (_auth, row) => {
      const id = String(row.id);
      started.push(id);
      if (id === rowId(0)) return new Promise<boolean>(() => {});
      return true;
    };
    const rowCount = 9;
    const { database, databaseDo } = await createDatabaseDo(read, rowCount);
    try {
      vi.useFakeTimers();
      let responseSettled = false;
      const responsePromise = requestList(databaseDo, rowCount);
      void responsePromise.then(() => { responseSettled = true; });

      await vi.advanceTimersByTimeAsync(49);
      expect(responseSettled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const response = await responsePromise;
      expect(response.status).toBe(403);
      expect(started).toEqual(Array.from({ length: rowCount }, (_, index) => rowId(index)));
      await expect(response.json()).resolves.toMatchObject({
        message: `Access denied. The 'read' access rule for table '${TABLE}' rejected record '${rowId(0)}'.`,
      });
    } finally {
      vi.useRealTimers();
      database.close();
    }
  });
});
