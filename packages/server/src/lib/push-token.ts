/**
 * Push Token Manager — KV-based device token storage
 *
 * KV key patterns:
 *   push:user:{userId}  → JSON array [{ deviceId, platform, token, updatedAt }, ...]
 *
 * AUTH_DB._push_devices is the primary source of truth when AUTH_DB is available.
 * KV remains a mirrored cache plus the storage backend for push logs.
 * Failed sends (410/404) remove the specific device from the array.
 */

import type { AuthDb } from './auth-db-adapter.js';

// ─── Types ───

export interface DeviceInfo {
  deviceId: string;
  token: string;
  platform: string;
  updatedAt: string;
  /** Device info — name, OS version, app version, locale. */
  deviceInfo?: {
    name?: string;
    osVersion?: string;
    appVersion?: string;
    locale?: string;
  };
  /** Developer custom metadata (≤1KB JSON). */
  metadata?: Record<string, unknown>;
}

// ─── Constants ───

/** Maximum devices per user */
const MAX_DEVICES_PER_USER = 10;

interface PushTokenStore {
  kv: KVNamespace;
  authDb?: AuthDb | null;
}

interface PushDeviceRow {
  deviceId: string;
  token: string;
  platform: string;
  updatedAt: string;
  deviceInfo: string | null;
  metadata: string | null;
}

function resolveStore(store: KVNamespace | PushTokenStore): PushTokenStore {
  if ('kv' in store) return store;
  return { kv: store };
}

function parseJsonObject(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseDeviceInfo(value: string | null): DeviceInfo['deviceInfo'] | undefined {
  const parsed = parseJsonObject(value);
  return parsed as DeviceInfo['deviceInfo'] | undefined;
}

function parseMetadata(value: string | null): Record<string, unknown> | undefined {
  return parseJsonObject(value);
}

async function readDevicesFromKv(kv: KVNamespace, userId: string): Promise<DeviceInfo[]> {
  const raw = await kv.get(`push:user:${userId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DeviceInfo[];
  } catch {
    return [];
  }
}

async function readDevicesFromAuthDb(authDb: AuthDb, userId: string): Promise<DeviceInfo[]> {
  const rows = await authDb.query<PushDeviceRow>(
    `SELECT deviceId, token, platform, updatedAt, deviceInfo, metadata
       FROM _push_devices
      WHERE userId = ?
      ORDER BY updatedAt ASC, deviceId ASC`,
    [userId],
  );
  return rows.map((row) => ({
    deviceId: row.deviceId,
    token: row.token,
    platform: row.platform,
    updatedAt: row.updatedAt,
    deviceInfo: parseDeviceInfo(row.deviceInfo),
    metadata: parseMetadata(row.metadata),
  }));
}

async function persistDevices(store: PushTokenStore, userId: string, devices: DeviceInfo[]): Promise<void> {
  const { kv, authDb } = store;
  if (devices.length === 0) {
    await kv.delete(`push:user:${userId}`);
  } else {
    await kv.put(`push:user:${userId}`, JSON.stringify(devices));
  }

  if (!authDb) return;

  const statements: Array<{ sql: string; params?: unknown[] }> = [
    { sql: 'DELETE FROM _push_devices WHERE userId = ?', params: [userId] },
  ];

  for (const device of devices) {
    statements.push({
      sql: `INSERT INTO _push_devices (userId, deviceId, token, platform, updatedAt, deviceInfo, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        userId,
        device.deviceId,
        device.token,
        device.platform,
        device.updatedAt,
        device.deviceInfo ? JSON.stringify(device.deviceInfo) : null,
        device.metadata ? JSON.stringify(device.metadata) : null,
      ],
    });
  }

  await authDb.batch(statements);
}

async function ensureDevices(store: PushTokenStore, userId: string): Promise<DeviceInfo[]> {
  if (!store.authDb) {
    return readDevicesFromKv(store.kv, userId);
  }

  const authDevices = await readDevicesFromAuthDb(store.authDb, userId);
  if (authDevices.length > 0) {
    return authDevices;
  }

  const kvDevices = await readDevicesFromKv(store.kv, userId);
  if (kvDevices.length > 0) {
    await persistDevices(store, userId, kvDevices);
  }
  return kvDevices;
}

// ─── Public API ───

/**
 * Register a device token for a user.
 * If the device already exists, update the token.
 * If the user has too many devices, remove the oldest.
 */
export async function registerToken(
  storeOrKv: KVNamespace | PushTokenStore,
  userId: string,
  deviceId: string,
  token: string,
  platform: string,
  deviceInfo?: DeviceInfo['deviceInfo'],
  metadata?: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  const store = resolveStore(storeOrKv);

  const devices = await ensureDevices(store, userId);
  const existingIdx = devices.findIndex(d => d.deviceId === deviceId);

  if (existingIdx >= 0) {
    // Update existing device
    devices[existingIdx] = { deviceId, token, platform, updatedAt: now, deviceInfo, metadata };
  } else {
    // Add new device
    devices.push({ deviceId, token, platform, updatedAt: now, deviceInfo, metadata });
  }

  // Enforce max devices — remove oldest if exceeded
  if (devices.length > MAX_DEVICES_PER_USER) {
    devices.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    devices.splice(0, devices.length - MAX_DEVICES_PER_USER);
  }

  await persistDevices(store, userId, devices);
}

/**
 * Unregister a specific device token.
 */
export async function unregisterToken(
  storeOrKv: KVNamespace | PushTokenStore,
  userId: string,
  deviceId: string,
): Promise<void> {
  await removeDeviceFromUser(storeOrKv, userId, deviceId);
}

/**
 * Get all registered devices for a user.
 */
export async function getDevicesForUser(
  storeOrKv: KVNamespace | PushTokenStore,
  userId: string,
): Promise<DeviceInfo[]> {
  return ensureDevices(resolveStore(storeOrKv), userId);
}

/**
 * Remove a specific device from a user's device list.
 * Called when push send receives 410/404 (token invalid).
 */
export async function removeDeviceFromUser(
  storeOrKv: KVNamespace | PushTokenStore,
  userId: string,
  deviceId: string,
): Promise<void> {
  const store = resolveStore(storeOrKv);
  const devices = await ensureDevices(store, userId);
  const filtered = devices.filter(d => d.deviceId !== deviceId);

  if (filtered.length !== devices.length) {
    await persistDevices(store, userId, filtered);
  }
}

/**
 * Unregister all device tokens for a user.
 * Called on revokeAllSessions / user deletion.
 */
export async function unregisterAllTokens(
  storeOrKv: KVNamespace | PushTokenStore,
  userId: string,
): Promise<void> {
  await persistDevices(resolveStore(storeOrKv), userId, []);
}

// ─── Push Log ───

const LOG_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export interface PushLogEntry {
  sentAt: string;
  userId: string;
  platform: string;
  status: 'sent' | 'failed' | 'removed';
  collapseId?: string;
  error?: string;
  runId?: string;
  probeId?: string;
  title?: string;
  body?: string;
  target?: string;
  topic?: string;
}

/**
 * Store a push send log entry (24h TTL).
 */
export async function storePushLog(
  kv: KVNamespace,
  userId: string,
  entry: PushLogEntry,
): Promise<void> {
  const logKey = `push:log:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
  await kv.put(logKey, JSON.stringify(entry), { expirationTtl: LOG_TTL_SECONDS });
}

/**
 * Get push send logs for a user (last 24h).
 */
export async function getPushLogs(
  kv: KVNamespace,
  userId: string,
  limit: number = 50,
): Promise<PushLogEntry[]> {
  const result = await kv.list({ prefix: `push:log:${userId}:`, limit });
  const entries: PushLogEntry[] = [];

  for (const key of result.keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      try {
        entries.push(JSON.parse(raw) as PushLogEntry);
      } catch { /* skip corrupted */ }
    }
  }

  return entries;
}
