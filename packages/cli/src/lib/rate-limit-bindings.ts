import type { EdgeBaseConfig, RateLimitingConfig } from '@edgebase-fun/shared';

export type BuiltInRateLimitGroup =
  | 'global'
  | 'db'
  | 'storage'
  | 'functions'
  | 'auth'
  | 'authSignin'
  | 'authSignup'
  | 'events';

export interface RateLimitBindingSpec {
  group: BuiltInRateLimitGroup;
  binding: string;
  namespaceId: string;
  limit: number;
  period: 10 | 60;
}

interface BuiltInBindingDefinition {
  group: BuiltInRateLimitGroup;
  binding: string;
  namespaceId: string;
}

const DEFAULT_LIMIT = 10_000_000;
const DEFAULT_PERIOD: 10 | 60 = 60;

const BUILT_IN_BINDINGS: BuiltInBindingDefinition[] = [
  { group: 'global', binding: 'GLOBAL_RATE_LIMITER', namespaceId: '1001' },
  { group: 'db', binding: 'DB_RATE_LIMITER', namespaceId: '1002' },
  { group: 'storage', binding: 'STORAGE_RATE_LIMITER', namespaceId: '1003' },
  { group: 'functions', binding: 'FUNCTIONS_RATE_LIMITER', namespaceId: '1004' },
  { group: 'auth', binding: 'AUTH_RATE_LIMITER', namespaceId: '1005' },
  { group: 'authSignin', binding: 'AUTH_SIGNIN_RATE_LIMITER', namespaceId: '1006' },
  { group: 'authSignup', binding: 'AUTH_SIGNUP_RATE_LIMITER', namespaceId: '1007' },
  { group: 'events', binding: 'EVENTS_RATE_LIMITER', namespaceId: '1008' },
];

function getRateLimitingConfig(config?: EdgeBaseConfig | Record<string, unknown>): RateLimitingConfig | undefined {
  if (!config || typeof config !== 'object' || !('rateLimiting' in config)) return undefined;
  const rateLimiting = (config as { rateLimiting?: unknown }).rateLimiting;
  if (!rateLimiting || typeof rateLimiting !== 'object') return undefined;
  return rateLimiting as RateLimitingConfig;
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(0, Math.floor(limit));
}

function normalizePeriod(period: unknown): 10 | 60 {
  return period === 10 ? 10 : DEFAULT_PERIOD;
}

function normalizeNamespaceId(namespaceId: unknown, fallback: string): string {
  if (typeof namespaceId !== 'string') return fallback;
  const trimmed = namespaceId.trim();
  return trimmed || fallback;
}

export function resolveRateLimitBindings(
  config?: EdgeBaseConfig | Record<string, unknown>,
): RateLimitBindingSpec[] {
  const rateLimiting = getRateLimitingConfig(config);

  return BUILT_IN_BINDINGS.flatMap((definition) => {
    const groupConfig = rateLimiting?.[definition.group];
    const bindingConfig = groupConfig?.binding;

    if (bindingConfig?.enabled === false) {
      return [];
    }

    return [{
      group: definition.group,
      binding: definition.binding,
      namespaceId: normalizeNamespaceId(bindingConfig?.namespaceId, definition.namespaceId),
      limit: normalizeLimit(bindingConfig?.limit),
      period: normalizePeriod(bindingConfig?.period),
    }];
  });
}
