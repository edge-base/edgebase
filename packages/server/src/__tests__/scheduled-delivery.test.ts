import { describe, expect, it, vi } from 'vitest';
import type { FunctionDefinition } from '@edge-base/shared';
import { DatabaseSync } from 'node:sqlite';
import {
  D1ScheduledDeliveryStore,
  MAX_COALESCED_SCHEDULE_IDENTITIES,
  MAX_TRACKED_SCHEDULE_WAIT_UNTIL,
  SCHEDULED_DELIVERY_DB_CHUNK_SIZE,
  SCHEDULED_DELIVERY_HANDLER_CONCURRENCY,
  SCHEDULED_DELIVERY_PRUNE_LIMIT,
  SCHEDULED_DELIVERY_RETENTION_MS,
  SCHEDULED_DELIVERY_SCHEMA,
  executeScheduledDeliveries,
  executeWithTrackedWaitUntil,
  resolveManagedScheduledTargets,
  shouldRetryScheduledDelivery,
  type ScheduledDeliveryClaim,
  type ScheduledDeliveryClaimRequest,
  type ScheduledDeliveryInspectionRequest,
  type ScheduledDeliverySettlement,
  type ScheduledDeliveryState,
  type ScheduledDeliveryStore,
} from '../lib/scheduled-delivery.js';

function scheduleFunction(cron: string, handler = vi.fn().mockResolvedValue(undefined)): FunctionDefinition {
  return { trigger: { type: 'schedule', cron }, handler };
}

function keyOf(value: { cron: string; scheduledTime: number; itemId: string }): string {
  return JSON.stringify([value.cron, value.scheduledTime, value.itemId]);
}

function sqliteD1(database: DatabaseSync): D1Database {
  type SqliteD1Statement = D1PreparedStatement & { sql: string; params: unknown[] };
  const makeStatement = (sql: string, params: unknown[] = []): SqliteD1Statement => ({
    sql,
    params,
    bind(...next: unknown[]) {
      return makeStatement(sql, next);
    },
  }) as unknown as SqliteD1Statement;

  return {
    prepare(sql: string) {
      return makeStatement(sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((rawStatement) => {
          const statement = rawStatement as SqliteD1Statement;
          const prepared = database.prepare(statement.sql);
          if (/^\s*SELECT\b/i.test(statement.sql) || /\bRETURNING\b/i.test(statement.sql)) {
            const runAll = prepared.all.bind(prepared) as (...params: unknown[]) => Record<string, unknown>[];
            return { success: true, results: runAll(...statement.params), meta: { changes: 0 } };
          }
          const run = prepared.run.bind(prepared) as (...params: unknown[]) => { changes: number | bigint };
          const result = run(...statement.params);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}

class MemoryScheduledDeliveryStore implements ScheduledDeliveryStore {
  readonly states = new Map<string, ScheduledDeliveryState>();
  readonly claimSizes: number[] = [];
  readonly settlementSizes: number[] = [];

  async claimMany(requests: ScheduledDeliveryClaimRequest[]): Promise<ScheduledDeliveryClaim[]> {
    this.claimSizes.push(requests.length);
    return requests.map((request) => {
      const key = keyOf(request);
      let state = this.states.get(key);
      if (!state) {
        state = {
          cron: request.cron,
          scheduledTime: request.scheduledTime,
          itemId: request.itemId,
          lane: request.lane,
          status: 'running',
          attempt: 1,
          startedAt: request.now,
          leaseExpiresAt: request.leaseExpiresAt,
          settledAt: null,
          lastError: null,
        };
        this.states.set(key, state);
        return { request, state: { ...state }, claimed: true, reason: 'new' };
      }

      if (state.status === 'running' && (state.leaseExpiresAt ?? Infinity) <= request.now) {
        state = {
          ...state,
          status: 'uncertain',
          leaseExpiresAt: null,
          settledAt: request.now,
          lastError: 'lease_expired_without_settlement',
        };
        this.states.set(key, state);
        return { request, state: { ...state }, claimed: false, reason: 'uncertain' };
      }

      if (shouldRetryScheduledDelivery(state.status, request.retry)) {
        state = {
          ...state,
          status: 'running',
          attempt: state.attempt + 1,
          startedAt: request.now,
          leaseExpiresAt: request.leaseExpiresAt,
          settledAt: null,
          lastError: null,
        };
        this.states.set(key, state);
        return { request, state: { ...state }, claimed: true, reason: 'retry' };
      }

      return {
        request,
        state: { ...state },
        claimed: false,
        reason: state.status === 'running' ? 'in_flight' : state.status,
      };
    });
  }

  async settleMany(settlements: ScheduledDeliverySettlement[]): Promise<void> {
    this.settlementSizes.push(settlements.length);
    for (const settlement of settlements) {
      const key = keyOf(settlement);
      const state = this.states.get(key);
      if (
        !state
        || (state.status !== 'running' && state.status !== 'uncertain')
        || state.attempt !== settlement.attempt
      ) {
        throw new Error(`stale settlement ${key}`);
      }
      this.states.set(key, {
        ...state,
        status: settlement.status,
        leaseExpiresAt: null,
        settledAt: settlement.settledAt,
        lastError: settlement.error,
      });
    }
  }

  async inspectMany(
    requests: ScheduledDeliveryInspectionRequest[],
  ): Promise<Array<ScheduledDeliveryState | null>> {
    return requests.map((request) => {
      const state = this.states.get(keyOf(request));
      return state ? { ...state } : null;
    });
  }
}

describe('managed scheduled target resolution', () => {
  it('uses the manifest identities and never timestamp-rematches overlapping expressions', () => {
    const hourly = scheduleFunction('0 * * * *');
    const nightly = scheduleFunction('0 3 * * *');
    const plugin = scheduleFunction('0 3 * * *');
    const functions = [
      { name: 'hourly', definition: hourly },
      { name: 'nightly#compact', definition: nightly },
      { name: 'audit-plugin/rotate', definition: plugin },
    ];
    const pluginFunctions = new Map([
      ['audit-plugin/rotate', { pluginName: 'audit-plugin', functionName: 'rotate' }],
    ]);

    expect(resolveManagedScheduledTargets({
      cron: '0 * * * *',
      functions,
      pluginFunctions,
      extraCrons: ['0 3 * * *'],
    }).map(({ id }) => id)).toEqual(['app-function:hourly#default']);

    expect(resolveManagedScheduledTargets({
      cron: ' 0  3 * * * ',
      functions,
      pluginFunctions,
      extraCrons: ['0 3 * * *'],
    }).map(({ id, lane }) => ({ id, lane }))).toEqual([
      { id: 'app-function:nightly#compact', lane: 'app-function' },
      { id: 'extra-cron:0 3 * * *', lane: 'extra-cron' },
      { id: 'plugin-function:audit-plugin/rotate', lane: 'plugin-function' },
      { id: 'system:maintenance', lane: 'system' },
    ]);
  });
});

describe('scheduled delivery execution', () => {
  it('declares bounded collection, concurrency, transaction, and retention limits', async () => {
    expect({
      identityLimit: MAX_COALESCED_SCHEDULE_IDENTITIES,
      trackedWaitUntilLimit: MAX_TRACKED_SCHEDULE_WAIT_UNTIL,
      dbChunkSize: SCHEDULED_DELIVERY_DB_CHUNK_SIZE,
      handlerConcurrency: SCHEDULED_DELIVERY_HANDLER_CONCURRENCY,
      pruneLimit: SCHEDULED_DELIVERY_PRUNE_LIMIT,
      retentionMs: SCHEDULED_DELIVERY_RETENTION_MS,
    }).toEqual({
      identityLimit: 64,
      trackedWaitUntilLimit: 256,
      dbChunkSize: 64,
      handlerConcurrency: 8,
      pruneLimit: 5_000,
      retentionMs: 30 * 24 * 60 * 60 * 1000,
    });
    expect(SCHEDULED_DELIVERY_SCHEMA).toContain('PRIMARY KEY (cron, scheduled_time, item_id)');

    const store = new MemoryScheduledDeliveryStore();
    await expect(executeScheduledDeliveries(
      Array.from({ length: MAX_COALESCED_SCHEDULE_IDENTITIES + 1 }, (_, index) => ({
        cron: `${index % 60} * * * *`,
        scheduledTime: 1_800_000_000_000,
        items: [],
      })),
      { store, timeoutMs: 1_000 },
    )).rejects.toThrow('maximum is 64');
    expect(store.claimSizes).toEqual([]);
  });

  it('retains every coalesced cron identity and isolates mixed item outcomes', async () => {
    const store = new MemoryScheduledDeliveryStore();
    const first = vi.fn().mockResolvedValue(undefined);
    const failed = vi.fn().mockRejectedValue(new Error('synthetic failure'));
    const second = vi.fn().mockResolvedValue(undefined);

    const report = await executeScheduledDeliveries([
      {
        cron: '0 * * * *',
        scheduledTime: 1_800_000_000_000,
        items: [
          { id: 'app-function:first#default', lane: 'app-function', run: first },
          { id: 'app-function:failed#default', lane: 'app-function', run: failed },
        ],
      },
      {
        cron: '0 3 * * *',
        scheduledTime: 1_800_000_000_000,
        items: [{ id: 'system:maintenance', lane: 'system', run: second }],
      },
    ], { store, timeoutMs: 1_000, leaseMs: 2_000, now: () => 10_000 });

    expect(first).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(report.complete).toBe(false);
    expect(report.outcomes.map(({ cron, itemId, status }) => ({ cron, itemId, status }))).toEqual([
      { cron: '0 * * * *', itemId: 'app-function:first#default', status: 'succeeded' },
      { cron: '0 * * * *', itemId: 'app-function:failed#default', status: 'failed' },
      { cron: '0 3 * * *', itemId: 'system:maintenance', status: 'succeeded' },
    ]);
    expect(store.claimSizes).toEqual([3]);
    expect(store.settlementSizes).toEqual([3]);
  });

  it('drains every item through bounded claim and settlement chunks', async () => {
    const store = new MemoryScheduledDeliveryStore();
    const handlers = Array.from({ length: SCHEDULED_DELIVERY_DB_CHUNK_SIZE * 2 + 2 }, (_, index) => ({
      id: `app-function:job-${index}#default`,
      lane: 'app-function' as const,
      run: vi.fn().mockResolvedValue(undefined),
    }));

    const report = await executeScheduledDeliveries([{
      cron: '* * * * *',
      scheduledTime: 1_800_000_060_000,
      items: handlers,
    }], { store, timeoutMs: 1_000, leaseMs: 2_000, now: () => 20_000 });

    expect(report.complete).toBe(true);
    expect(report.outcomes).toHaveLength(handlers.length);
    expect(handlers.every(({ run }) => run.mock.calls.length === 1)).toBe(true);
    expect(store.claimSizes).toEqual([64, 64, 2]);
    expect(store.settlementSizes).toEqual([64, 64, 2]);
  });

  it('deduplicates a completed delivery after a lost response', async () => {
    const store = new MemoryScheduledDeliveryStore();
    const handler = vi.fn().mockResolvedValue(undefined);
    const envelope = {
      cron: '15 * * * *',
      scheduledTime: 1_800_000_900_000,
      items: [{ id: 'app-function:once#default', lane: 'app-function' as const, run: handler }],
    };
    const options = { store, timeoutMs: 1_000, leaseMs: 2_000, now: () => 30_000 };

    const first = await executeScheduledDeliveries([envelope], options);
    const replay = await executeScheduledDeliveries([envelope], options);

    expect(first.outcomes[0]?.status).toBe('succeeded');
    expect(replay).toMatchObject({
      complete: true,
      outcomes: [{ status: 'duplicate', executed: false, attempt: 1 }],
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('automatically retries a settled failure while leaving ambiguous outcomes explicit', async () => {
    const store = new MemoryScheduledDeliveryStore();
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('known synthetic failure'))
      .mockResolvedValueOnce(undefined);
    const envelope = {
      cron: '20 * * * *',
      scheduledTime: 1_800_001_200_000,
      items: [{ id: 'app-function:retry-known#default', lane: 'app-function' as const, run: handler }],
    };

    const failed = await executeScheduledDeliveries([envelope], {
      store,
      timeoutMs: 1_000,
      leaseMs: 2_000,
      now: () => 40_000,
    });
    const retried = await executeScheduledDeliveries([envelope], {
      store,
      timeoutMs: 1_000,
      leaseMs: 2_000,
      now: () => 41_000,
    });

    expect(failed).toMatchObject({ complete: false, outcomes: [{ status: 'failed', attempt: 1 }] });
    expect(retried).toMatchObject({
      complete: true,
      outcomes: [{ status: 'succeeded', attempt: 2, executed: true }],
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(shouldRetryScheduledDelivery('timed_out', false)).toBe(false);
    expect(shouldRetryScheduledDelivery('timed_out', true)).toBe(false);
    expect(shouldRetryScheduledDelivery('uncertain', false)).toBe(false);
    expect(shouldRetryScheduledDelivery('uncertain', true)).toBe(false);
  });

  it('turns a crashed running lease uncertain without admitting overlapping work', async () => {
    const store = new MemoryScheduledDeliveryStore();
    const handler = vi.fn().mockResolvedValue(undefined);
    const item = { id: 'app-function:recover#default', lane: 'app-function' as const, run: handler };
    const key = { cron: '30 * * * *', scheduledTime: 1_800_001_800_000, itemId: item.id };
    await store.claimMany([{
      ...key,
      lane: item.lane,
      now: 1_000,
      leaseExpiresAt: 1_100,
      retry: false,
    }]);

    const inFlight = await executeScheduledDeliveries([{
      cron: key.cron,
      scheduledTime: key.scheduledTime,
      items: [item],
    }], { store, timeoutMs: 10, leaseMs: 100, now: () => 1_050 });
    expect(inFlight).toMatchObject({ complete: false, outcomes: [{ status: 'in_flight' }] });

    const uncertain = await executeScheduledDeliveries([{
      cron: key.cron,
      scheduledTime: key.scheduledTime,
      items: [item],
    }], { store, timeoutMs: 10, leaseMs: 100, now: () => 1_200 });
    expect(uncertain).toMatchObject({ complete: false, outcomes: [{ status: 'uncertain' }] });
    expect(handler).not.toHaveBeenCalled();

    const reconciled = await executeScheduledDeliveries([{
      cron: key.cron,
      scheduledTime: key.scheduledTime,
      items: [{ ...item, mode: 'reconcile' as const }],
    }], { store, timeoutMs: 10, leaseMs: 100, now: () => 1_300 });
    expect(reconciled).toMatchObject({
      complete: false,
      outcomes: [{ status: 'uncertain', attempt: 1, executed: false }],
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('records timeout without automatically starting ambiguous work again', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryScheduledDeliveryStore();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const handler = vi.fn(() => held);
      const envelope = {
        cron: '45 * * * *',
        scheduledTime: 1_800_002_700_000,
        items: [{ id: 'app-function:held#default', lane: 'app-function' as const, run: handler }],
      };
      const execution = executeScheduledDeliveries([envelope], {
        store,
        timeoutMs: 50,
        leaseMs: 100,
        now: () => 2_000,
      });
      await vi.advanceTimersByTimeAsync(50);
      const timedOut = await execution;
      expect(timedOut).toMatchObject({
        complete: false,
        outcomes: [{ status: 'timed_out', retryable: true }],
      });

      const replay = await executeScheduledDeliveries([envelope], {
        store,
        timeoutMs: 50,
        leaseMs: 100,
        now: () => 2_050,
      });
      expect(replay).toMatchObject({ complete: false, outcomes: [{ status: 'in_flight', executed: false }] });
      expect(handler).toHaveBeenCalledTimes(1);
      release();
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps timed-out work attached to waitUntil and reconciles without overlap', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryScheduledDeliveryStore();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const handler = vi.fn(() => held);
      const item = {
        id: 'app-function:late-success#default',
        lane: 'app-function' as const,
        run: handler,
      };
      const envelope = {
        cron: '46 * * * *',
        scheduledTime: 1_800_002_760_000,
        items: [item],
      };
      const attached: Promise<unknown>[] = [];
      const execution = executeScheduledDeliveries([envelope], {
        store,
        timeoutMs: 50,
        leaseMs: 100,
        now: () => 2_000,
        waitUntil: (promise) => attached.push(promise),
      });
      await vi.advanceTimersByTimeAsync(50);
      await expect(execution).resolves.toMatchObject({
        complete: false,
        outcomes: [{ status: 'timed_out', executed: true }],
      });
      expect(attached).toHaveLength(1);
      expect(store.states.get(keyOf({
        cron: envelope.cron,
        scheduledTime: envelope.scheduledTime,
        itemId: item.id,
      }))?.status).toBe('running');

      const reconciliation = await executeScheduledDeliveries([{
        ...envelope,
        items: [{ ...item, mode: 'reconcile' as const }],
      }], {
        store,
        timeoutMs: 50,
        leaseMs: 100,
        now: () => 2_050,
      });
      expect(reconciliation).toMatchObject({
        complete: false,
        outcomes: [{ status: 'in_flight', executed: false, attempt: 1 }],
      });
      expect(handler).toHaveBeenCalledTimes(1);

      release();
      await Promise.all(attached);
      const settled = await executeScheduledDeliveries([{
        ...envelope,
        items: [{ ...item, mode: 'reconcile' as const }],
      }], {
        store,
        timeoutMs: 50,
        leaseMs: 100,
        now: () => 2_060,
      });
      expect(settled).toMatchObject({
        complete: true,
        outcomes: [{ status: 'duplicate', executed: false, attempt: 1 }],
      });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows the original attempt to settle after its lease becomes uncertain', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryScheduledDeliveryStore();
      let rejectLate!: (error: Error) => void;
      const held = new Promise<void>((_resolve, reject) => {
        rejectLate = reject;
      });
      const item = {
        id: 'app-function:late-failure#default',
        lane: 'app-function' as const,
        run: vi.fn(() => held),
      };
      const envelope = {
        cron: '47 * * * *',
        scheduledTime: 1_800_002_820_000,
        items: [item],
      };
      const attached: Promise<unknown>[] = [];
      const execution = executeScheduledDeliveries([envelope], {
        store,
        timeoutMs: 50,
        leaseMs: 100,
        now: () => 3_000,
        waitUntil: (promise) => attached.push(promise),
      });
      await vi.advanceTimersByTimeAsync(50);
      await execution;

      await executeScheduledDeliveries([envelope], {
        store,
        timeoutMs: 50,
        leaseMs: 100,
        now: () => 3_101,
      });
      expect(store.states.get(keyOf({
        cron: envelope.cron,
        scheduledTime: envelope.scheduledTime,
        itemId: item.id,
      }))?.status).toBe('uncertain');

      rejectLate(new Error('late synthetic failure'));
      await Promise.all(attached);
      const reconciled = await executeScheduledDeliveries([{
        ...envelope,
        items: [{ ...item, mode: 'reconcile' as const }],
      }], {
        store,
        timeoutMs: 50,
        leaseMs: 100,
        now: () => 3_102,
      });
      expect(reconciled).toMatchObject({
        complete: false,
        outcomes: [{ status: 'failed', executed: false, error: 'late synthetic failure' }],
      });
      expect(item.run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('scheduled waitUntil completion', () => {
  it('does not acknowledge completion until held waitUntil work settles', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    const execution = executeWithTrackedWaitUntil(async (ctx) => {
      ctx.waitUntil(held);
    }).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await execution;
    expect(settled).toBe(true);
  });

  it('turns a rejected waitUntil promise into a delivery failure', async () => {
    await expect(executeWithTrackedWaitUntil(async (ctx) => {
      ctx.waitUntil(Promise.reject(new Error('late failure')));
    })).rejects.toThrow('Scheduled function or waitUntil work failed');
  });
});

describe('D1 scheduled delivery cursor adapter', () => {
  it('claims and settles a new item with one bounded D1 batch per phase', async () => {
    type FakeStatement = { sql: string; params: unknown[] };
    const batch = vi.fn(async (statements: FakeStatement[]) => statements.map((statement) => {
      const params = statement.params;
      if (statement.sql.includes('INSERT OR IGNORE')) {
        return {
          results: [{
            cron: params[0],
            scheduled_time: params[1],
            item_id: params[2],
            lane: params[3],
            status: 'running',
            attempt: 1,
            started_at: params[4],
            lease_expires_at: params[5],
            settled_at: null,
            last_error: null,
          }],
        };
      }
      if (statement.sql.includes('SET status = ?')) {
        return {
          results: [{
            cron: params[3],
            scheduled_time: params[4],
            item_id: params[5],
            lane: 'app-function',
            status: params[0],
            attempt: params[6],
            started_at: 100,
            lease_expires_at: null,
            settled_at: params[1],
            last_error: params[2],
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${statement.sql}`);
    }));
    const db = {
      prepare: vi.fn((sql: string) => ({
        sql,
        params: [] as unknown[],
        bind(...params: unknown[]) {
          return { sql, params };
        },
      })),
      batch,
    };
    const store = new D1ScheduledDeliveryStore(db as never, {
      ensureSchema: async () => undefined,
    });
    const request: ScheduledDeliveryClaimRequest = {
      cron: '0 * * * *',
      scheduledTime: 1_800_000_000_000,
      itemId: 'app-function:hourly#default',
      lane: 'app-function',
      now: 100,
      leaseExpiresAt: 200,
      retry: false,
    };

    const claims = await store.claimMany([request]);
    expect(claims).toMatchObject([{ claimed: true, reason: 'new', state: { attempt: 1 } }]);
    await store.settleMany([{
      cron: request.cron,
      scheduledTime: request.scheduledTime,
      itemId: request.itemId,
      attempt: 1,
      status: 'succeeded',
      settledAt: 150,
      error: null,
    }]);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(1);
    expect(batch.mock.calls[1]?.[0]).toHaveLength(1);
  });

  it('persists completed, crashed, uncertain, and known-failure retry states across store restarts', async () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      const d1 = sqliteD1(sqlite);
      const firstStore = new D1ScheduledDeliveryStore(d1);
      const completedRequest: ScheduledDeliveryClaimRequest = {
        cron: '0 * * * *',
        scheduledTime: 1_800_000_000_000,
        itemId: 'app-function:hourly#default',
        lane: 'app-function',
        now: 100,
        leaseExpiresAt: 200,
        retry: false,
      };
      const [claimed] = await firstStore.claimMany([completedRequest]);
      expect(claimed).toMatchObject({ claimed: true, reason: 'new', state: { attempt: 1 } });
      await firstStore.settleMany([{
        cron: completedRequest.cron,
        scheduledTime: completedRequest.scheduledTime,
        itemId: completedRequest.itemId,
        attempt: 1,
        status: 'succeeded',
        settledAt: 150,
        error: null,
      }]);

      const restartedStore = new D1ScheduledDeliveryStore(d1);
      const [deduplicated] = await restartedStore.claimMany([{
        ...completedRequest,
        now: 160,
        leaseExpiresAt: 260,
      }]);
      expect(deduplicated).toMatchObject({
        claimed: false,
        reason: 'succeeded',
        state: { status: 'succeeded', attempt: 1 },
      });

      const crashedRequest: ScheduledDeliveryClaimRequest = {
        ...completedRequest,
        scheduledTime: completedRequest.scheduledTime + 60_000,
        now: 200,
        leaseExpiresAt: 250,
      };
      await restartedStore.claimMany([crashedRequest]);
      const afterCrash = new D1ScheduledDeliveryStore(d1);
      const [uncertain] = await afterCrash.claimMany([{
        ...crashedRequest,
        now: 300,
        leaseExpiresAt: 400,
        retry: false,
      }]);
      expect(uncertain).toMatchObject({
        claimed: false,
        reason: 'uncertain',
        state: { status: 'uncertain', attempt: 1 },
      });

      const [notRetried] = await afterCrash.claimMany([{
        ...crashedRequest,
        now: 310,
        leaseExpiresAt: 410,
        retry: true,
      }]);
      expect(notRetried).toMatchObject({
        claimed: false,
        reason: 'uncertain',
        state: { status: 'uncertain', attempt: 1 },
      });
      await afterCrash.settleMany([{
        cron: crashedRequest.cron,
        scheduledTime: crashedRequest.scheduledTime,
        itemId: crashedRequest.itemId,
        attempt: 1,
        status: 'failed',
        settledAt: 350,
        error: 'synthetic late failure',
      }]);

      const row = sqlite.prepare(
        'SELECT status, attempt, last_error FROM _scheduled_delivery_items WHERE scheduled_time = ?',
      ).get(crashedRequest.scheduledTime) as Record<string, unknown>;
      expect(row).toEqual({
        status: 'failed',
        attempt: 1,
        last_error: 'synthetic late failure',
      });

      const [knownFailureRetry] = await afterCrash.claimMany([{
        ...crashedRequest,
        now: 360,
        leaseExpiresAt: 460,
        retry: false,
      }]);
      expect(knownFailureRetry).toMatchObject({
        claimed: true,
        reason: 'retry',
        state: { status: 'running', attempt: 2 },
      });
    } finally {
      sqlite.close();
    }
  });
});
