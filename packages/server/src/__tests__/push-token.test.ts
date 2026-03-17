/**
 * 서버 단위 테스트 — lib/push-token.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/push-token.test.ts
 *
 * 테스트 대상:
 *   registerToken — 새 디바이스 등록, 기존 업데이트, MAX_DEVICES 초과 시 oldest 제거
 *   unregisterToken — 특정 디바이스 삭제
 *   getDevicesForUser — 디바이스 목록, 빈 목록, 잘못된 JSON 처리
 *   removeDeviceFromUser — 디바이스 제거, 빈 배열 시 키 삭제, 없는 디바이스 무시
 *   unregisterAllTokens — 전체 삭제
 *   storePushLog — 로그 저장 (TTL)
 *   getPushLogs — 로그 조회, 잘못된 JSON 스킵
 */

import { describe, it, expect } from 'vitest';
import {
  registerToken,
  unregisterToken,
  getDevicesForUser,
  removeDeviceFromUser,
  unregisterAllTokens,
  storePushLog,
  getPushLogs,
} from '../lib/push-token.js';
import type { PushLogEntry } from '../lib/push-token.js';
import type { AuthDb } from '../lib/auth-db-adapter.js';

// ─── Mock KVNamespace ────────────────────────────────────────────────────────

interface MockKVStore {
  data: Record<string, { value: string; options?: { expirationTtl?: number } }>;
}

function createMockKV(): KVNamespace & { _store: MockKVStore } {
  const store: MockKVStore = { data: {} };

  const kv = {
    get: async (key: string) => store.data[key]?.value ?? null,
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store.data[key] = { value, options };
    },
    delete: async (key: string) => {
      delete store.data[key];
    },
    list: async (opts: { prefix: string; limit?: number }) => {
      const matchingKeys = Object.keys(store.data)
        .filter((k) => k.startsWith(opts.prefix))
        .slice(0, opts.limit ?? 100)
        .map((name) => ({ name, expiration: undefined, metadata: undefined }));
      return { keys: matchingKeys, list_complete: true, cacheStatus: null };
    },
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
    _store: store,
  };

  return kv as any;
}

function createMockAuthDb(): AuthDb & { _pushDevices: Map<string, Array<Record<string, unknown>>> } {
  const pushDevices = new Map<string, Array<Record<string, unknown>>>();

  return {
    dialect: 'sqlite',
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('FROM _push_devices')) {
        const userId = String(params?.[0] ?? '');
        const rows = [...(pushDevices.get(userId) ?? [])]
          .sort((left, right) => {
            const leftUpdated = String(left.updatedAt ?? '');
            const rightUpdated = String(right.updatedAt ?? '');
            return leftUpdated.localeCompare(rightUpdated) || String(left.deviceId ?? '').localeCompare(String(right.deviceId ?? ''));
          });
        return rows as T[];
      }
      throw new Error(`Unsupported query in mock auth db: ${sql}`);
    },
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      return null;
    },
    async run(): Promise<void> {},
    async batch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
      for (const statement of statements) {
        if (statement.sql.startsWith('DELETE FROM _push_devices WHERE userId = ?')) {
          const userId = String(statement.params?.[0] ?? '');
          pushDevices.delete(userId);
          continue;
        }
        if (statement.sql.includes('INSERT INTO _push_devices')) {
          const [userId, deviceId, token, platform, updatedAt, deviceInfo, metadata] = statement.params ?? [];
          const rows = pushDevices.get(String(userId)) ?? [];
          rows.push({
            userId,
            deviceId,
            token,
            platform,
            updatedAt,
            deviceInfo,
            metadata,
          });
          pushDevices.set(String(userId), rows);
          continue;
        }
        throw new Error(`Unsupported batch statement in mock auth db: ${statement.sql}`);
      }
    },
    _pushDevices: pushDevices,
  };
}

// ─── registerToken ───────────────────────────────────────────────────────────

describe('registerToken', () => {
  it('registers a new device', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'device-a', 'token-a', 'ios');

    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe('device-a');
    expect(devices[0].token).toBe('token-a');
    expect(devices[0].platform).toBe('ios');
  });

  it('updates existing device token', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'device-a', 'old-token', 'ios');
    await registerToken(kv, 'user-1', 'device-a', 'new-token', 'ios');

    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices).toHaveLength(1);
    expect(devices[0].token).toBe('new-token');
  });

  it('adds multiple devices for same user', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'device-a', 'token-a', 'ios');
    await registerToken(kv, 'user-1', 'device-b', 'token-b', 'android');

    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices).toHaveLength(2);
  });

  it('enforces MAX_DEVICES (10) — removes oldest', async () => {
    const kv = createMockKV();
    // Register 11 devices
    for (let i = 0; i < 11; i++) {
      await registerToken(kv, 'user-1', `device-${i}`, `token-${i}`, 'ios');
    }

    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices).toHaveLength(10);
    // device-0 should be removed (oldest)
    expect(devices.find((d) => d.deviceId === 'device-0')).toBeUndefined();
    // device-10 should be present (newest)
    expect(devices.find((d) => d.deviceId === 'device-10')).toBeDefined();
  });

  it('stores deviceInfo and metadata', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'device-a', 'token-a', 'ios', {
      name: 'iPhone 15',
      osVersion: '17.0',
    }, { key: 'value' });

    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices[0].deviceInfo?.name).toBe('iPhone 15');
    expect(devices[0].metadata).toEqual({ key: 'value' });
  });

  it('writes AUTH_DB-backed inventory and mirrors KV', async () => {
    const kv = createMockKV();
    const authDb = createMockAuthDb();

    await registerToken({ kv, authDb }, 'user-1', 'device-a', 'token-a', 'ios', {
      name: 'iPhone 15',
    }, { build: '1' });

    const devices = await getDevicesForUser({ kv, authDb }, 'user-1');
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe('device-a');
    expect(devices[0].deviceInfo?.name).toBe('iPhone 15');
    expect(devices[0].metadata).toEqual({ build: '1' });
    expect(JSON.parse(kv._store.data['push:user:user-1'].value)).toHaveLength(1);
  });
});

// ─── unregisterToken ─────────────────────────────────────────────────────────

describe('unregisterToken', () => {
  it('removes specific device', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'device-a', 'token-a', 'ios');
    await registerToken(kv, 'user-1', 'device-b', 'token-b', 'android');

    await unregisterToken(kv, 'user-1', 'device-a');

    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe('device-b');
  });

  it('removes KV key when last device unregistered', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'device-a', 'token-a', 'ios');
    await unregisterToken(kv, 'user-1', 'device-a');

    expect(kv._store.data['push:user:user-1']).toBeUndefined();
  });
});

// ─── getDevicesForUser ───────────────────────────────────────────────────────

describe('getDevicesForUser', () => {
  it('returns empty array for unknown user', async () => {
    const kv = createMockKV();
    const devices = await getDevicesForUser(kv, 'unknown');
    expect(devices).toEqual([]);
  });

  it('returns empty array for invalid JSON', async () => {
    const kv = createMockKV();
    kv._store.data['push:user:user-1'] = { value: 'not-json' };
    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices).toEqual([]);
  });

  it('backfills AUTH_DB from KV when migrated rows are missing', async () => {
    const kv = createMockKV();
    const authDb = createMockAuthDb();
    kv._store.data['push:user:user-1'] = {
      value: JSON.stringify([
        {
          deviceId: 'device-a',
          token: 'token-a',
          platform: 'ios',
          updatedAt: '2026-03-09T00:00:00.000Z',
          metadata: { role: 'primary' },
        },
      ]),
    };

    const devices = await getDevicesForUser({ kv, authDb }, 'user-1');
    expect(devices).toHaveLength(1);
    expect(authDb._pushDevices.get('user-1')).toHaveLength(1);
  });
});

// ─── removeDeviceFromUser ────────────────────────────────────────────────────

describe('removeDeviceFromUser', () => {
  it('removes specific device and keeps others', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'dev-a', 'tok-a', 'ios');
    await registerToken(kv, 'user-1', 'dev-b', 'tok-b', 'android');

    await removeDeviceFromUser(kv, 'user-1', 'dev-a');

    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices).toHaveLength(1);
    expect(devices[0].deviceId).toBe('dev-b');
  });

  it('deletes KV key when removing last device', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'dev-a', 'tok-a', 'ios');
    await removeDeviceFromUser(kv, 'user-1', 'dev-a');

    expect(kv._store.data['push:user:user-1']).toBeUndefined();
  });

  it('no-op when device not found (no write)', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'dev-a', 'tok-a', 'ios');

    const before = kv._store.data['push:user:user-1']?.value;
    await removeDeviceFromUser(kv, 'user-1', 'dev-nonexistent');
    const after = kv._store.data['push:user:user-1']?.value;

    // Value should be unchanged
    expect(after).toBe(before);
  });
});

// ─── unregisterAllTokens ─────────────────────────────────────────────────────

describe('unregisterAllTokens', () => {
  it('removes all devices for a user', async () => {
    const kv = createMockKV();
    await registerToken(kv, 'user-1', 'dev-a', 'tok-a', 'ios');
    await registerToken(kv, 'user-1', 'dev-b', 'tok-b', 'android');

    await unregisterAllTokens(kv, 'user-1');

    expect(kv._store.data['push:user:user-1']).toBeUndefined();
    const devices = await getDevicesForUser(kv, 'user-1');
    expect(devices).toEqual([]);
  });

  it('removes AUTH_DB-backed devices as well', async () => {
    const kv = createMockKV();
    const authDb = createMockAuthDb();
    await registerToken({ kv, authDb }, 'user-1', 'dev-a', 'tok-a', 'ios');
    await registerToken({ kv, authDb }, 'user-1', 'dev-b', 'tok-b', 'android');

    await unregisterAllTokens({ kv, authDb }, 'user-1');

    expect(kv._store.data['push:user:user-1']).toBeUndefined();
    expect(authDb._pushDevices.get('user-1')).toBeUndefined();
  });
});

// ─── storePushLog ────────────────────────────────────────────────────────────

describe('storePushLog', () => {
  it('stores log entry with TTL', async () => {
    const kv = createMockKV();
    const entry: PushLogEntry = {
      sentAt: '2024-01-01T00:00:00Z',
      userId: 'user-1',
      platform: 'ios',
      status: 'sent',
    };

    await storePushLog(kv, 'user-1', entry);

    const keys = Object.keys(kv._store.data).filter((k) => k.startsWith('push:log:user-1:'));
    expect(keys).toHaveLength(1);

    // Verify TTL was set (24 hours = 86400 seconds)
    const stored = kv._store.data[keys[0]];
    expect(stored.options?.expirationTtl).toBe(86400);

    // Verify content
    const parsed = JSON.parse(stored.value);
    expect(parsed.status).toBe('sent');
    expect(parsed.platform).toBe('ios');
  });

  it('stores log with error info', async () => {
    const kv = createMockKV();
    const entry: PushLogEntry = {
      sentAt: '2024-01-01T00:00:00Z',
      userId: 'user-1',
      platform: 'android',
      status: 'failed',
      error: 'FCM_INVALID_TOKEN',
    };

    await storePushLog(kv, 'user-1', entry);

    const keys = Object.keys(kv._store.data).filter((k) => k.startsWith('push:log:user-1:'));
    const parsed = JSON.parse(kv._store.data[keys[0]].value);
    expect(parsed.status).toBe('failed');
    expect(parsed.error).toBe('FCM_INVALID_TOKEN');
  });
});

// ─── getPushLogs ─────────────────────────────────────────────────────────────

describe('getPushLogs', () => {
  it('returns empty array when no logs', async () => {
    const kv = createMockKV();
    const logs = await getPushLogs(kv, 'user-1');
    expect(logs).toEqual([]);
  });

  it('returns stored log entries', async () => {
    const kv = createMockKV();
    const entry: PushLogEntry = {
      sentAt: '2024-01-01T00:00:00Z',
      userId: 'user-1',
      platform: 'ios',
      status: 'sent',
    };
    await storePushLog(kv, 'user-1', entry);

    const logs = await getPushLogs(kv, 'user-1');
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('sent');
  });

  it('skips corrupted log entries', async () => {
    const kv = createMockKV();

    // Store a valid entry
    const entry: PushLogEntry = {
      sentAt: '2024-01-01T00:00:00Z',
      userId: 'user-1',
      platform: 'ios',
      status: 'sent',
    };
    await storePushLog(kv, 'user-1', entry);

    // Manually corrupt another entry
    kv._store.data['push:log:user-1:999:xxxx'] = { value: 'not-json' };

    const logs = await getPushLogs(kv, 'user-1');
    // Should have 1 valid + 1 skipped = 1 returned
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('sent');
  });

  it('respects limit parameter', async () => {
    const kv = createMockKV();
    for (let i = 0; i < 5; i++) {
      await storePushLog(kv, 'user-1', {
        sentAt: `2024-01-0${i + 1}T00:00:00Z`,
        userId: 'user-1',
        platform: 'ios',
        status: 'sent',
      });
    }

    const logs = await getPushLogs(kv, 'user-1', 3);
    expect(logs.length).toBeLessThanOrEqual(3);
  });
});
