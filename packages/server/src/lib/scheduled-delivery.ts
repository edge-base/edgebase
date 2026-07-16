import {
  SYSTEM_MAINTENANCE_CRON,
  SYSTEM_MAINTENANCE_SCHEDULE_ID,
  appFunctionScheduleIdentity,
  extraCronScheduleIdentity,
  normalizeCronExpression,
  pluginFunctionScheduleIdentity,
  MAX_SELF_HOST_SCHEDULE_ERROR_UTF8_BYTES,
  truncateUtf8,
  type FunctionDefinition,
} from '@edge-base/shared';

export type ManagedScheduleLane =
  | 'app-function'
  | 'plugin-function'
  | 'extra-cron'
  | 'system';

export interface ManagedScheduledTarget {
  id: string;
  cron: string;
  lane: ManagedScheduleLane;
  name?: string;
  definition?: FunctionDefinition;
}

export interface ResolveManagedScheduledTargetsOptions {
  cron: string;
  functions: Array<{ name: string; definition: FunctionDefinition }>;
  pluginFunctions?: ReadonlyMap<string, { pluginName: string; functionName: string }>;
  extraCrons?: readonly string[];
}

/**
 * Resolve only targets owned by the exact provider/launcher cron identity.
 * Timestamp matching is deliberately absent: overlapping expressions are
 * separate managed wakes and must never cross-route.
 */
export function resolveManagedScheduledTargets(
  options: ResolveManagedScheduledTargetsOptions,
): ManagedScheduledTarget[] {
  const eventCron = normalizeCronExpression(options.cron);
  const targets: ManagedScheduledTarget[] = [];

  for (const { name, definition } of options.functions) {
    if (definition.trigger.type !== 'schedule') continue;
    const triggerCron = normalizeCronExpression(definition.trigger.cron);
    if (triggerCron !== eventCron) continue;

    const plugin = options.pluginFunctions?.get(name);
    if (plugin) {
      targets.push({
        id: pluginFunctionScheduleIdentity(plugin.pluginName, plugin.functionName),
        cron: eventCron,
        lane: 'plugin-function',
        name,
        definition,
      });
      continue;
    }

    const separator = name.lastIndexOf('#');
    const route = separator === -1 ? name : name.slice(0, separator);
    const exportName = separator === -1 ? 'default' : name.slice(separator + 1);
    targets.push({
      id: appFunctionScheduleIdentity(route, exportName),
      cron: eventCron,
      lane: 'app-function',
      name,
      definition,
    });
  }

  const extraCrons = new Set(
    (options.extraCrons ?? []).map((cron) => normalizeCronExpression(cron)),
  );
  if (extraCrons.has(eventCron)) {
    targets.push({
      id: extraCronScheduleIdentity(eventCron),
      cron: eventCron,
      lane: 'extra-cron',
    });
  }

  if (eventCron === SYSTEM_MAINTENANCE_CRON) {
    targets.push({
      id: SYSTEM_MAINTENANCE_SCHEDULE_ID,
      cron: eventCron,
      lane: 'system',
    });
  }

  targets.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  for (let index = 1; index < targets.length; index += 1) {
    if (targets[index - 1]?.id === targets[index]?.id) {
      throw new Error(`Duplicate runtime managed schedule identity '${targets[index]?.id}'.`);
    }
  }
  return targets;
}

export type ScheduledDeliveryStateStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'uncertain';

export interface ScheduledDeliveryKey {
  cron: string;
  scheduledTime: number;
  itemId: string;
}

export interface ScheduledDeliveryState extends ScheduledDeliveryKey {
  lane: ManagedScheduleLane;
  status: ScheduledDeliveryStateStatus;
  attempt: number;
  startedAt: number;
  leaseExpiresAt: number | null;
  settledAt: number | null;
  lastError: string | null;
}

export interface ScheduledDeliveryClaimRequest extends ScheduledDeliveryKey {
  lane: ManagedScheduleLane;
  now: number;
  leaseExpiresAt: number;
  /** Protocol marker; ambiguous timeout/uncertain outcomes never authorize a new mutation. */
  retry: boolean;
}

/**
 * A settled handler failure is known not to be running and is safe to reclaim
 * on ordinary provider/self-host redelivery. Timeout and lease-loss outcomes
 * remain ambiguous and require an explicit reconciliation decision.
 */
export function shouldRetryScheduledDelivery(
  status: ScheduledDeliveryStateStatus,
  _explicitRetry: boolean,
): boolean {
  return status === 'failed';
}

export interface ScheduledDeliveryClaim {
  request: ScheduledDeliveryClaimRequest;
  state: ScheduledDeliveryState;
  claimed: boolean;
  reason:
    | 'new'
    | 'retry'
    | 'succeeded'
    | 'in_flight'
    | 'failed'
    | 'timed_out'
    | 'uncertain';
}

export interface ScheduledDeliverySettlement extends ScheduledDeliveryKey {
  attempt: number;
  status: 'succeeded' | 'failed' | 'timed_out';
  settledAt: number;
  error: string | null;
}

export interface ScheduledDeliveryStore {
  claimMany(requests: ScheduledDeliveryClaimRequest[]): Promise<ScheduledDeliveryClaim[]>;
  settleMany(settlements: ScheduledDeliverySettlement[]): Promise<void>;
  inspectMany?(requests: ScheduledDeliveryInspectionRequest[]): Promise<Array<ScheduledDeliveryState | null>>;
  prune?(now: number): Promise<void>;
}

export interface ScheduledDeliveryInspectionRequest extends ScheduledDeliveryKey {
  now: number;
}

interface ScheduledDeliveryRow {
  cron: string;
  scheduled_time: number;
  item_id: string;
  lane: ManagedScheduleLane;
  status: ScheduledDeliveryStateStatus;
  attempt: number;
  started_at: number;
  lease_expires_at: number | null;
  settled_at: number | null;
  last_error: string | null;
}

const SCHEDULED_DELIVERY_TABLE = '_scheduled_delivery_items';
export const SCHEDULED_DELIVERY_DB_CHUNK_SIZE = 64;
export const SCHEDULED_DELIVERY_HANDLER_CONCURRENCY = 8;
export const MAX_COALESCED_SCHEDULE_IDENTITIES = 64;
export const MAX_TRACKED_SCHEDULE_WAIT_UNTIL = 256;
export const SCHEDULED_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SCHEDULED_DELIVERY_PRUNE_LIMIT = 5_000;

export const SCHEDULED_DELIVERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS ${SCHEDULED_DELIVERY_TABLE} (
  cron TEXT NOT NULL,
  scheduled_time INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('app-function', 'plugin-function', 'extra-cron', 'system')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'timed_out', 'uncertain')),
  attempt INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  lease_expires_at INTEGER,
  settled_at INTEGER,
  last_error TEXT,
  PRIMARY KEY (cron, scheduled_time, item_id)
);
CREATE INDEX IF NOT EXISTS _scheduled_delivery_items_settled_idx
  ON ${SCHEDULED_DELIVERY_TABLE} (settled_at, status);
`;

const scheduledSchemaPromises = new WeakMap<object, Promise<void>>();

function preparedStatement(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): D1PreparedStatement {
  const statement = db.prepare(sql);
  return params.length > 0 ? statement.bind(...params) : statement;
}

async function ensureScheduledDeliverySchema(db: D1Database): Promise<void> {
  const existing = scheduledSchemaPromises.get(db as object);
  if (existing) return existing;

  const statements = SCHEDULED_DELIVERY_SCHEMA.split(/;\s*\n/)
    .map((sql) => sql.trim())
    .filter(Boolean)
    .map((sql) => preparedStatement(db, sql));
  const pending = db.batch(statements).then(() => undefined).catch((error) => {
    scheduledSchemaPromises.delete(db as object);
    throw error;
  });
  scheduledSchemaPromises.set(db as object, pending);
  return pending;
}

function rowToState(row: ScheduledDeliveryRow): ScheduledDeliveryState {
  return {
    cron: row.cron,
    scheduledTime: Number(row.scheduled_time),
    itemId: row.item_id,
    lane: row.lane,
    status: row.status,
    attempt: Number(row.attempt),
    startedAt: Number(row.started_at),
    leaseExpiresAt: row.lease_expires_at === null ? null : Number(row.lease_expires_at),
    settledAt: row.settled_at === null ? null : Number(row.settled_at),
    lastError: row.last_error,
  };
}

function rowFromResult(result: unknown): ScheduledDeliveryRow | undefined {
  const rows = (result as { results?: ScheduledDeliveryRow[] }).results ?? [];
  return rows[0];
}

function deliveryKeyString(key: ScheduledDeliveryKey): string {
  return JSON.stringify([key.cron, key.scheduledTime, key.itemId]);
}

function claimFromExisting(
  request: ScheduledDeliveryClaimRequest,
  state: ScheduledDeliveryState,
): ScheduledDeliveryClaim {
  const reason = state.status === 'running'
    ? 'in_flight'
    : state.status;
  return { request, state, claimed: false, reason };
}

interface D1ScheduledDeliveryStoreOptions {
  ensureSchema?: (db: D1Database) => Promise<void>;
}

/** Durable item cursor backed by CONTROL_DB. */
export class D1ScheduledDeliveryStore implements ScheduledDeliveryStore {
  private readonly ensureSchema: (db: D1Database) => Promise<void>;

  constructor(
    private readonly db: D1Database,
    options: D1ScheduledDeliveryStoreOptions = {},
  ) {
    this.ensureSchema = options.ensureSchema ?? ensureScheduledDeliverySchema;
  }

  private async loadMany(
    requests: ScheduledDeliveryClaimRequest[],
  ): Promise<Map<string, ScheduledDeliveryState>> {
    if (requests.length === 0) return new Map();
    const results = await this.db.batch(requests.map((request) => preparedStatement(
      this.db,
      `SELECT cron, scheduled_time, item_id, lane, status, attempt, started_at,
              lease_expires_at, settled_at, last_error
       FROM ${SCHEDULED_DELIVERY_TABLE}
       WHERE cron = ? AND scheduled_time = ? AND item_id = ?`,
      [request.cron, request.scheduledTime, request.itemId],
    )));
    const states = new Map<string, ScheduledDeliveryState>();
    results.forEach((result, index) => {
      const row = rowFromResult(result);
      const request = requests[index];
      if (row && request) states.set(deliveryKeyString(request), rowToState(row));
    });
    return states;
  }

  async claimMany(requests: ScheduledDeliveryClaimRequest[]): Promise<ScheduledDeliveryClaim[]> {
    if (requests.length === 0) return [];
    await this.ensureSchema(this.db);

    const seen = new Set<string>();
    for (const request of requests) {
      const key = deliveryKeyString(request);
      if (seen.has(key)) throw new Error(`Duplicate scheduled delivery claim ${key}.`);
      seen.add(key);
    }

    const allClaims: ScheduledDeliveryClaim[] = [];
    for (let offset = 0; offset < requests.length; offset += SCHEDULED_DELIVERY_DB_CHUNK_SIZE) {
      const chunk = requests.slice(offset, offset + SCHEDULED_DELIVERY_DB_CHUNK_SIZE);
      const inserted = await this.db.batch(chunk.map((request) => preparedStatement(
        this.db,
        `INSERT OR IGNORE INTO ${SCHEDULED_DELIVERY_TABLE}
          (cron, scheduled_time, item_id, lane, status, attempt, started_at,
           lease_expires_at, settled_at, last_error)
         VALUES (?, ?, ?, ?, 'running', 1, ?, ?, NULL, NULL)
         RETURNING cron, scheduled_time, item_id, lane, status, attempt, started_at,
                   lease_expires_at, settled_at, last_error`,
        [
          request.cron,
          request.scheduledTime,
          request.itemId,
          request.lane,
          request.now,
          request.leaseExpiresAt,
        ],
      )));

      const claimsByKey = new Map<string, ScheduledDeliveryClaim>();
      const unresolved: ScheduledDeliveryClaimRequest[] = [];
      inserted.forEach((result, index) => {
        const request = chunk[index];
        const row = rowFromResult(result);
        if (!request) return;
        if (!row) {
          unresolved.push(request);
          return;
        }
        const state = rowToState(row);
        claimsByKey.set(deliveryKeyString(request), {
          request,
          state,
          claimed: true,
          reason: 'new',
        });
      });

      let existing = await this.loadMany(unresolved);
      const expired: Array<{ request: ScheduledDeliveryClaimRequest; state: ScheduledDeliveryState }> = [];
      const retries: Array<{ request: ScheduledDeliveryClaimRequest; state: ScheduledDeliveryState }> = [];

      for (const request of unresolved) {
        const state = existing.get(deliveryKeyString(request));
        if (!state) throw new Error(`Scheduled delivery cursor disappeared for ${deliveryKeyString(request)}.`);
        if (
          state.status === 'running'
          && state.leaseExpiresAt !== null
          && state.leaseExpiresAt <= request.now
        ) {
          expired.push({ request, state });
        } else if (shouldRetryScheduledDelivery(state.status, request.retry)) {
          retries.push({ request, state });
        } else {
          claimsByKey.set(deliveryKeyString(request), claimFromExisting(request, state));
        }
      }

      if (expired.length > 0) {
        const results = await this.db.batch(expired.map(({ request, state }) => preparedStatement(
          this.db,
          `UPDATE ${SCHEDULED_DELIVERY_TABLE}
           SET status = 'uncertain', settled_at = ?, lease_expires_at = NULL,
               last_error = 'lease_expired_without_settlement'
           WHERE cron = ? AND scheduled_time = ? AND item_id = ?
             AND status = 'running' AND attempt = ? AND lease_expires_at <= ?
           RETURNING cron, scheduled_time, item_id, lane, status, attempt, started_at,
                     lease_expires_at, settled_at, last_error`,
          [
            request.now,
            request.cron,
            request.scheduledTime,
            request.itemId,
            state.attempt,
            request.now,
          ],
        )));
        const raced: ScheduledDeliveryClaimRequest[] = [];
        results.forEach((result, index) => {
          const candidate = expired[index];
          if (!candidate) return;
          const row = rowFromResult(result);
          if (!row) {
            raced.push(candidate.request);
            return;
          }
          claimsByKey.set(
            deliveryKeyString(candidate.request),
            claimFromExisting(candidate.request, rowToState(row)),
          );
        });
        if (raced.length > 0) {
          const current = await this.loadMany(raced);
          for (const request of raced) {
            const state = current.get(deliveryKeyString(request));
            if (!state) throw new Error(`Scheduled delivery cursor disappeared for ${deliveryKeyString(request)}.`);
            claimsByKey.set(deliveryKeyString(request), claimFromExisting(request, state));
          }
        }
      }

      if (retries.length > 0) {
        const results = await this.db.batch(retries.map(({ request, state }) => preparedStatement(
          this.db,
          `UPDATE ${SCHEDULED_DELIVERY_TABLE}
           SET status = 'running', attempt = attempt + 1, started_at = ?,
               lease_expires_at = ?, settled_at = NULL, last_error = NULL
           WHERE cron = ? AND scheduled_time = ? AND item_id = ?
             AND attempt = ? AND status IN ('failed', 'timed_out', 'uncertain')
           RETURNING cron, scheduled_time, item_id, lane, status, attempt, started_at,
                     lease_expires_at, settled_at, last_error`,
          [
            request.now,
            request.leaseExpiresAt,
            request.cron,
            request.scheduledTime,
            request.itemId,
            state.attempt,
          ],
        )));
        const raced: ScheduledDeliveryClaimRequest[] = [];
        results.forEach((result, index) => {
          const candidate = retries[index];
          if (!candidate) return;
          const row = rowFromResult(result);
          if (!row) {
            raced.push(candidate.request);
            return;
          }
          claimsByKey.set(deliveryKeyString(candidate.request), {
            request: candidate.request,
            state: rowToState(row),
            claimed: true,
            reason: 'retry',
          });
        });
        if (raced.length > 0) {
          existing = await this.loadMany(raced);
          for (const request of raced) {
            const state = existing.get(deliveryKeyString(request));
            if (!state) throw new Error(`Scheduled delivery cursor disappeared for ${deliveryKeyString(request)}.`);
            claimsByKey.set(deliveryKeyString(request), claimFromExisting(request, state));
          }
        }
      }

      for (const request of chunk) {
        const claim = claimsByKey.get(deliveryKeyString(request));
        if (!claim) throw new Error(`Scheduled delivery claim was not resolved for ${deliveryKeyString(request)}.`);
        allClaims.push(claim);
      }
    }
    return allClaims;
  }

  async inspectMany(
    requests: ScheduledDeliveryInspectionRequest[],
  ): Promise<Array<ScheduledDeliveryState | null>> {
    if (requests.length === 0) return [];
    await this.ensureSchema(this.db);
    await this.prune(Math.max(...requests.map(({ now }) => now)));
    const states = await this.loadMany(requests.map((request) => ({
      ...request,
      lane: 'system',
      leaseExpiresAt: request.now + 1,
      retry: false,
    })));
    return requests.map((request) => states.get(deliveryKeyString(request)) ?? null);
  }

  async settleMany(settlements: ScheduledDeliverySettlement[]): Promise<void> {
    if (settlements.length === 0) return;
    await this.ensureSchema(this.db);

    const stale: string[] = [];
    for (let offset = 0; offset < settlements.length; offset += SCHEDULED_DELIVERY_DB_CHUNK_SIZE) {
      const chunk = settlements.slice(offset, offset + SCHEDULED_DELIVERY_DB_CHUNK_SIZE);
      const results = await this.db.batch(chunk.map((settlement) => preparedStatement(
        this.db,
        `UPDATE ${SCHEDULED_DELIVERY_TABLE}
         SET status = ?, settled_at = ?, lease_expires_at = NULL, last_error = ?
         WHERE cron = ? AND scheduled_time = ? AND item_id = ?
           AND status IN ('running', 'uncertain') AND attempt = ?
         RETURNING cron, scheduled_time, item_id, lane, status, attempt, started_at,
                   lease_expires_at, settled_at, last_error`,
        [
          settlement.status,
          settlement.settledAt,
          settlement.error,
          settlement.cron,
          settlement.scheduledTime,
          settlement.itemId,
          settlement.attempt,
        ],
      )));
      results.forEach((result, index) => {
        if (!rowFromResult(result) && chunk[index]) {
          stale.push(deliveryKeyString(chunk[index] as ScheduledDeliverySettlement));
        }
      });
    }
    if (stale.length > 0) {
      throw new Error(`Scheduled delivery settlement lost its running claim: ${stale.join(', ')}.`);
    }
  }

  async prune(now: number): Promise<void> {
    await this.ensureSchema(this.db);
    const cutoff = now - SCHEDULED_DELIVERY_RETENTION_MS;
    await this.db.batch([
      preparedStatement(
        this.db,
        `UPDATE ${SCHEDULED_DELIVERY_TABLE}
         SET status = 'uncertain', settled_at = ?, lease_expires_at = NULL,
             last_error = 'lease_expired_without_settlement'
         WHERE rowid IN (
           SELECT rowid FROM ${SCHEDULED_DELIVERY_TABLE}
           WHERE status = 'running' AND lease_expires_at <= ?
           ORDER BY lease_expires_at ASC
           LIMIT ?
         )`,
        [now, now, SCHEDULED_DELIVERY_PRUNE_LIMIT],
      ),
      preparedStatement(
        this.db,
        `DELETE FROM ${SCHEDULED_DELIVERY_TABLE}
         WHERE rowid IN (
           SELECT rowid FROM ${SCHEDULED_DELIVERY_TABLE}
           WHERE status <> 'running' AND settled_at < ?
           ORDER BY settled_at ASC
           LIMIT ?
         )`,
        [cutoff, SCHEDULED_DELIVERY_PRUNE_LIMIT],
      ),
    ]);
  }
}

export function createD1ScheduledDeliveryStore(env: { CONTROL_DB?: D1Database }): D1ScheduledDeliveryStore {
  if (!env.CONTROL_DB) {
    throw new Error('CONTROL_DB D1 binding is required for durable scheduled delivery.');
  }
  return new D1ScheduledDeliveryStore(env.CONTROL_DB);
}

export interface ScheduledExecutionMetadata extends ScheduledDeliveryKey {
  attempt: number;
  deliveryId: string;
}

export interface ScheduledDeliveryItem {
  id: string;
  lane: ManagedScheduleLane;
  mode?: 'execute' | 'reconcile';
  run(metadata: ScheduledExecutionMetadata): Promise<unknown>;
}

export interface ScheduledDeliveryEnvelope {
  cron: string;
  scheduledTime: number;
  items: ScheduledDeliveryItem[];
}

export type ScheduledDeliveryOutcomeStatus =
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'duplicate'
  | 'in_flight'
  | 'uncertain';

export interface ScheduledDeliveryOutcome extends ScheduledDeliveryKey {
  lane: ManagedScheduleLane;
  status: ScheduledDeliveryOutcomeStatus;
  attempt: number;
  executed: boolean;
  retryable: boolean;
  error?: string;
}

export interface ScheduledDeliveryReport {
  complete: boolean;
  outcomes: ScheduledDeliveryOutcome[];
}

export interface ExecuteScheduledDeliveriesOptions {
  store: ScheduledDeliveryStore;
  timeoutMs: number;
  leaseMs?: number;
  now?: () => number;
  /** Keep late settlement attached to the current Worker/ScheduledEvent lifetime. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

interface PendingDeliveryItem {
  ordinal: number;
  key: ScheduledDeliveryKey;
  item: ScheduledDeliveryItem;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateUtf8(message, MAX_SELF_HOST_SCHEDULE_ERROR_UTF8_BYTES);
}

function deliveryId(key: ScheduledDeliveryKey): string {
  return `${key.scheduledTime}:${encodeURIComponent(key.cron)}:${key.itemId}`;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value);
    }
  });
  await Promise.all(workers);
  return results;
}

async function runClaimedItem(
  pending: PendingDeliveryItem,
  claim: ScheduledDeliveryClaim,
  timeoutMs: number,
  now: () => number,
): Promise<{
  outcome: ScheduledDeliveryOutcome;
  settlement?: ScheduledDeliverySettlement;
  lateSettlement?: Promise<ScheduledDeliverySettlement>;
}> {
  const metadata: ScheduledExecutionMetadata = {
    ...pending.key,
    attempt: claim.state.attempt,
    deliveryId: deliveryId(pending.key),
  };
  const work = Promise.resolve().then(() => pending.item.run(metadata));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ type: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs);
  });
  const completion = work.then(
    () => ({ type: 'succeeded' as const }),
    (error) => ({ type: 'failed' as const, error }),
  );
  const result = await Promise.race([completion, timeout]);
  if (timer !== undefined) clearTimeout(timer);

  if (result.type === 'timeout') {
    // The platform cannot kill arbitrary user promises. Leave the durable
    // claim running and settle it only when the original promise terminates.
    // Reconciliation can observe running/succeeded/failed/uncertain state but
    // can never admit a second mutation while this attempt may still be live.
    const error = `Scheduled item '${pending.item.id}' timed out after ${timeoutMs}ms.`;
    return {
      outcome: {
        ...pending.key,
        lane: pending.item.lane,
        status: 'timed_out',
        attempt: claim.state.attempt,
        executed: true,
        retryable: true,
        error,
      },
      lateSettlement: work.then(
        () => ({
          ...pending.key,
          attempt: claim.state.attempt,
          status: 'succeeded' as const,
          settledAt: now(),
          error: null,
        }),
        (lateError) => ({
          ...pending.key,
          attempt: claim.state.attempt,
          status: 'failed' as const,
          settledAt: now(),
          error: describeError(lateError),
        }),
      ),
    };
  }

  if (result.type === 'failed') {
    const error = describeError(result.error);
    return {
      outcome: {
        ...pending.key,
        lane: pending.item.lane,
        status: 'failed',
        attempt: claim.state.attempt,
        executed: true,
        retryable: true,
        error,
      },
      settlement: {
        ...pending.key,
        attempt: claim.state.attempt,
        status: 'failed',
        settledAt: now(),
        error,
      },
    };
  }

  return {
    outcome: {
      ...pending.key,
      lane: pending.item.lane,
      status: 'succeeded',
      attempt: claim.state.attempt,
      executed: true,
      retryable: false,
    },
    settlement: {
      ...pending.key,
      attempt: claim.state.attempt,
      status: 'succeeded',
      settledAt: now(),
      error: null,
    },
  };
}

/**
 * Execute a bounded set of exact cron envelopes. Durable claims and settlements
 * are batched in bounded chunks; work beyond one chunk drains immediately.
 */
export async function executeScheduledDeliveries(
  envelopes: ScheduledDeliveryEnvelope[],
  options: ExecuteScheduledDeliveriesOptions,
): Promise<ScheduledDeliveryReport> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('Scheduled delivery timeoutMs must be a positive finite number.');
  }
  if (envelopes.length > MAX_COALESCED_SCHEDULE_IDENTITIES) {
    throw new Error(
      `Scheduled delivery contains ${envelopes.length} cron identities; maximum is ${MAX_COALESCED_SCHEDULE_IDENTITIES}.`,
    );
  }

  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? Math.max(60_000, options.timeoutMs * 2);
  if (!Number.isFinite(leaseMs) || leaseMs <= options.timeoutMs) {
    throw new Error('Scheduled delivery leaseMs must be finite and greater than timeoutMs.');
  }

  const pending: PendingDeliveryItem[] = [];
  const seen = new Set<string>();
  for (const envelope of envelopes) {
    const cron = normalizeCronExpression(envelope.cron);
    if (!Number.isSafeInteger(envelope.scheduledTime) || envelope.scheduledTime < 0) {
      throw new Error('Scheduled delivery scheduledTime must be a non-negative safe integer.');
    }
    for (const item of envelope.items) {
      const key: ScheduledDeliveryKey = {
        cron,
        scheduledTime: envelope.scheduledTime,
        itemId: item.id,
      };
      const serialized = deliveryKeyString(key);
      if (seen.has(serialized)) {
        throw new Error(`Coalesced scheduled delivery repeats identity ${serialized}.`);
      }
      seen.add(serialized);
      pending.push({ ordinal: pending.length, key, item });
    }
  }

  const outcomes: Array<{ ordinal: number; outcome: ScheduledDeliveryOutcome }> = [];
  for (let offset = 0; offset < pending.length; offset += SCHEDULED_DELIVERY_DB_CHUNK_SIZE) {
    const chunk = pending.slice(offset, offset + SCHEDULED_DELIVERY_DB_CHUNK_SIZE);
    const reconciliation = chunk.filter(({ item }) => item.mode === 'reconcile');
    if (reconciliation.length > 0) {
      if (!options.store.inspectMany) {
        throw new Error('Scheduled delivery store does not support non-mutating reconciliation.');
      }
      const inspected = await options.store.inspectMany(reconciliation.map(({ key }) => ({
        ...key,
        now: now(),
      })));
      if (inspected.length !== reconciliation.length) {
        throw new Error('Scheduled delivery store returned a partial reconciliation result.');
      }
      inspected.forEach((state, index) => {
        const item = reconciliation[index];
        if (!item) return;
        if (!state) {
          throw new Error(`Scheduled delivery reconciliation has no durable claim for ${deliveryKeyString(item.key)}.`);
        }
        const status: ScheduledDeliveryOutcomeStatus = state.status === 'succeeded'
          ? 'duplicate'
          : state.status === 'running'
            ? 'in_flight'
            : state.status;
        outcomes.push({
          ordinal: item.ordinal,
          outcome: {
            ...item.key,
            lane: item.item.lane,
            status,
            attempt: state.attempt,
            executed: false,
            retryable: status === 'failed' || status === 'timed_out' || status === 'uncertain',
            ...(state.lastError ? { error: state.lastError } : {}),
          },
        });
      });
    }

    const executable = chunk.filter(({ item }) => item.mode !== 'reconcile');
    if (executable.length === 0) continue;
    const claimNow = now();
    const claims = await options.store.claimMany(executable.map(({ key, item }) => ({
      ...key,
      lane: item.lane,
      now: claimNow,
      leaseExpiresAt: claimNow + leaseMs,
      retry: false,
    })));
    if (claims.length !== executable.length) {
      throw new Error('Scheduled delivery store returned a partial claim result.');
    }

    const claimed: Array<{ pending: PendingDeliveryItem; claim: ScheduledDeliveryClaim }> = [];
    claims.forEach((claim, index) => {
      const item = executable[index];
      if (!item) return;
      if (claim.claimed) {
        claimed.push({ pending: item, claim });
        return;
      }
      const status: ScheduledDeliveryOutcomeStatus = claim.state.status === 'succeeded'
        ? 'duplicate'
        : claim.state.status === 'running'
          ? 'in_flight'
          : claim.state.status;
      outcomes.push({
        ordinal: item.ordinal,
        outcome: {
          ...item.key,
          lane: item.item.lane,
          status,
          attempt: claim.state.attempt,
          executed: false,
          retryable: status === 'failed' || status === 'timed_out' || status === 'uncertain',
          ...(claim.state.lastError ? { error: claim.state.lastError } : {}),
        },
      });
    });

    const executed = await mapWithConcurrency(
      claimed,
      SCHEDULED_DELIVERY_HANDLER_CONCURRENCY,
      ({ pending: item, claim }) => runClaimedItem(item, claim, options.timeoutMs, now),
    );
    await options.store.settleMany(executed.flatMap(({ settlement }) => (
      settlement ? [settlement] : []
    )));
    for (const result of executed) {
      if (!result.lateSettlement) continue;
      const lateSettlement = result.lateSettlement
        .then((settlement) => options.store.settleMany([settlement]))
        .catch((error) => {
          console.error('[EdgeBase] Late scheduled delivery settlement failed', describeError(error));
        });
      if (options.waitUntil) options.waitUntil(lateSettlement);
      else void lateSettlement;
    }
    executed.forEach(({ outcome }, index) => {
      const item = claimed[index]?.pending;
      if (item) outcomes.push({ ordinal: item.ordinal, outcome });
    });
  }

  outcomes.sort((left, right) => left.ordinal - right.ordinal);
  const ordered = outcomes.map(({ outcome }) => outcome);
  return {
    complete: ordered.every(({ status }) => status === 'succeeded' || status === 'duplicate'),
    outcomes: ordered,
  };
}

type TrackedWaitUntilResult =
  | { ok: true }
  | { ok: false; error: unknown };

/** Await a function handler and every waitUntil promise it registered. */
export async function executeWithTrackedWaitUntil(
  handler: (executionContext: Pick<ExecutionContext, 'waitUntil'>) => Promise<unknown>,
): Promise<void> {
  const tracked: Array<Promise<TrackedWaitUntilResult>> = [];
  const executionContext: Pick<ExecutionContext, 'waitUntil'> = {
    waitUntil(promise: Promise<unknown>) {
      if (tracked.length >= MAX_TRACKED_SCHEDULE_WAIT_UNTIL) {
        throw new Error(
          `A scheduled function registered more than ${MAX_TRACKED_SCHEDULE_WAIT_UNTIL} waitUntil promises.`,
        );
      }
      tracked.push(Promise.resolve(promise).then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      ));
    },
  };

  const failures: unknown[] = [];
  try {
    await handler(executionContext);
  } catch (error) {
    failures.push(error);
  }

  let offset = 0;
  while (offset < tracked.length) {
    const current = tracked.slice(offset);
    offset = tracked.length;
    const settled = await Promise.all(current);
    for (const result of settled) {
      if (!result.ok) failures.push(result.error);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Scheduled function or waitUntil work failed.');
  }
}
