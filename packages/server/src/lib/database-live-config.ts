import type { EdgeBaseConfig } from '@edgebase/shared';

export const DEFAULT_DB_LIVE_AUTH_TIMEOUT_MS = 5000;
export const DEFAULT_DB_LIVE_BATCH_THRESHOLD = 10;

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

export function resolveDbLiveAuthTimeoutMs(config?: EdgeBaseConfig): number {
  return normalizePositiveInteger(
    config?.databaseLive?.authTimeoutMs,
    DEFAULT_DB_LIVE_AUTH_TIMEOUT_MS,
  );
}

export function resolveDbLiveBatchThreshold(config?: EdgeBaseConfig): number {
  return normalizePositiveInteger(
    config?.databaseLive?.batchThreshold,
    DEFAULT_DB_LIVE_BATCH_THRESHOLD,
  );
}
