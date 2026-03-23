/**
 * Shared database live event emission helpers.
 *
 * Used by d1-handler.ts and postgres-handler.ts for background
 * event delivery to DatabaseLiveDO after successful CUD operations.
 *
 * database-do.ts keeps its own internal version (uses DO env).
 */
import type { Env } from '../types.js';

export const DATABASE_LIVE_HUB_DO_NAME = 'database-live:hub';

export function buildDbLiveChannel(
  namespace: string,
  table: string,
  instanceId?: string,
  docId?: string,
): string {
  const base = instanceId
    ? `dblive:${namespace}:${instanceId}:${table}`
    : `dblive:${namespace}:${table}`;
  return docId ? `${base}:${docId}` : base;
}

export function isDbLiveChannel(channel: string): boolean {
  if (!channel.startsWith('dblive:')) return false;
  if (channel.startsWith('dblive:presence:') || channel.startsWith('dblive:broadcast:')) {
    return false;
  }
  const parts = channel.split(':');
  if (parts.length < 3 || parts.length > 5) return false;
  return parts.every(part => part.length > 0);
}

/**
 * Emit a single CUD event to DatabaseLiveDO.
 * Mirrors database-do.ts emitDbLiveEvent().
 */
export function emitDbLiveEvent(
  env: Env,
  namespace: string,
  table: string,
  type: 'added' | 'modified' | 'removed',
  docId: string,
  data: Record<string, unknown> | null,
  instanceId?: string,
): Promise<void> {
  const tableChannel = buildDbLiveChannel(namespace, table, instanceId);
  const event = { type, table, docId, data, timestamp: new Date().toISOString() };
  const deliveries = [
    sendToDatabaseLiveDO(env, { ...event, channel: tableChannel }),
  ];

  // Document channel: dblive:{namespace}:{table}:{docId}
  if (docId !== '_bulk') {
    const docChannel = buildDbLiveChannel(namespace, table, instanceId, docId);
    deliveries.push(sendToDatabaseLiveDO(env, { ...event, channel: docChannel }));
  }

  return Promise.all(deliveries).then(() => undefined);
}

/**
 * Emit batch CUD events as a single batch_changes message.
 * Mirrors database-do.ts emitDbLiveBatchEvent().
 */
export function emitDbLiveBatchEvent(
  env: Env,
  namespace: string,
  table: string,
  changes: Array<{ type: 'added' | 'modified' | 'removed'; docId: string; data: Record<string, unknown> | null }>,
  instanceId?: string,
): Promise<void> {
  const tableChannel = buildDbLiveChannel(namespace, table, instanceId);
  const event = {
    type: 'batch_changes' as const,
    channel: tableChannel,
    table,
    changes: changes.map(ch => ({
      type: ch.type,
      docId: ch.docId,
      data: ch.data,
      timestamp: new Date().toISOString(),
    })),
    total: changes.length,
  };
  return sendToDatabaseLiveDO(env, event, '/internal/batch-event');
}

async function postToDatabaseLiveDO(
  env: Env,
  event: Record<string, unknown>,
  path = '/internal/event',
): Promise<void> {
  const liveNamespace = env.DATABASE_LIVE;
  if (!liveNamespace) {
    return;
  }

  const doId = liveNamespace.idFromName(DATABASE_LIVE_HUB_DO_NAME);
  const stub = liveNamespace.get(doId);
  const response = await stub.fetch(`http://internal${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const suffix = detail ? `: ${detail.slice(0, 200)}` : '';
    throw new Error(`DatabaseLiveDO ${path} failed with ${response.status}${suffix}`);
  }
}

/**
 * Send an event to DatabaseLiveDO via stub.fetch().
 * Callers should schedule this with waitUntil() when they want
 * fire-and-forget request semantics without hiding delivery failures.
 */
export async function sendToDatabaseLiveDO(
  env: Env,
  event: Record<string, unknown>,
  path = '/internal/event',
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await postToDatabaseLiveDO(env, event, path);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('DatabaseLiveDO delivery failed.');
}
