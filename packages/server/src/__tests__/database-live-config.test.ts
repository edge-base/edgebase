import { describe, expect, it } from 'vitest';
import type { EdgeBaseConfig } from '@edge-base/shared';
import {
  DEFAULT_DB_LIVE_AUTH_TIMEOUT_MS,
  DEFAULT_DB_LIVE_BATCH_THRESHOLD,
  resolveDbLiveAuthTimeoutMs,
  resolveDbLiveBatchThreshold,
} from '../lib/database-live-config.js';

describe('database-live-config helpers', () => {
  it('uses configured positive database-live auth timeout', () => {
    const config = {
      databaseLive: { authTimeoutMs: 12000 },
    } as EdgeBaseConfig;

    expect(resolveDbLiveAuthTimeoutMs(config)).toBe(12000);
  });

  it('falls back for invalid database-live auth timeout values', () => {
    const config = {
      databaseLive: { authTimeoutMs: 0 },
    } as EdgeBaseConfig;

    expect(resolveDbLiveAuthTimeoutMs(config)).toBe(DEFAULT_DB_LIVE_AUTH_TIMEOUT_MS);
  });

  it('uses configured positive batch threshold', () => {
    const config = {
      databaseLive: { batchThreshold: 3 },
    } as EdgeBaseConfig;

    expect(resolveDbLiveBatchThreshold(config)).toBe(3);
  });

  it('falls back for invalid batch threshold values', () => {
    const config = {
      databaseLive: { batchThreshold: -1 },
    } as EdgeBaseConfig;

    expect(resolveDbLiveBatchThreshold(config)).toBe(DEFAULT_DB_LIVE_BATCH_THRESHOLD);
  });
});
