/**
 * DO instance routing utilities.
 *
 * Naming convention: `namespace:id`
 *   shared                   — static DB (no id)
 *   workspace:ws-456         — dynamic DB (namespace: workspace, id: ws-456)
 *   user:user-123            — dynamic DB (namespace: user, id: user-123)
 *
 * Constraint: `id` must NOT contain `:` character.
 */
import { materializeConfig, type EdgeBaseConfig } from '@edgebase-fun/shared';

const RUNTIME_CONFIG_GLOBAL_KEY = '__EDGEBASE_RUNTIME_CONFIG__';

// ─── DO Instance ID Generation (§2) ───

/**
 * Get the DO instance name for a database namespace + optional id.
 * Format: `namespace:id` or just `namespace` for static DBs.
 *
 * @throws 400-style error if id contains `:` character.
 */
export function getDbDoName(namespace: string, id?: string): string {
  if (!id) {
    // Static DB (e.g. 'shared') — no id
    return namespace;
  }

  // Guard against `:` in id — would break DO name parsing (§2)
  if (id.includes(':')) {
    throw new Error(
      `Invalid id '${id}': id must not contain ':' character. ` +
      `Use a different separator (e.g. dash '-') in your id.`,
    );
  }

  return `${namespace}:${id}`;
}

/**
 * Parse a DO name back into { namespace, id }.
 * Used by database-do.ts to identify which DB block it belongs to. (§23)
 */
export function parseDbDoName(doName: string): { namespace: string; id?: string } {
  const colonIdx = doName.indexOf(':');
  if (colonIdx === -1) {
    return { namespace: doName };
  }
  return {
    namespace: doName.slice(0, colonIdx),
    id: doName.slice(colonIdx + 1),
  };
}

// ─── DO Stub Call Helper ───

/**
 * Call a Durable Object by its instance name.
 * Worker → DO bridge layer.
 */
export async function callDO(
  namespace: DurableObjectNamespace,
  doName: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const doId = namespace.idFromName(doName);
  const stub = namespace.get(doId);

  const init: RequestInit = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-DO-Name': doName,
      ...options.headers,
    },
  };

  if (options.body !== undefined && options.method !== 'GET') {
    init.body = JSON.stringify(options.body);
  }

  return stub.fetch(`http://do${path}`, init);
}

/**
 * Call a Durable Object by its raw hex ID (from Cloudflare REST API).
 * Used for Edge backup enumeration where CF API returns hex IDs.
 */
export async function callDOByHexId(
  namespace: DurableObjectNamespace,
  hexId: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  const doId = namespace.idFromString(hexId);
  const stub = namespace.get(doId);

  const init: RequestInit = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  if (options.body !== undefined && options.method !== 'GET') {
    init.body = JSON.stringify(options.body);
  }

  return stub.fetch(`http://do${path}`, init);
}

// ─── Config Singleton (§13) ───

/**
 * Runtime config singleton — set once at Worker startup via setConfig().
 */
let _runtimeConfig: EdgeBaseConfig | null = null;

function readGlobalRuntimeConfig(): EdgeBaseConfig | null {
  if (typeof globalThis !== 'object' || globalThis === null) {
    return null;
  }

  const candidate = (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  return candidate as EdgeBaseConfig;
}

/**
 * Inject the static bundled config into the singleton. (§13)
 * Must be called at Worker startup before any request is served.
 */
export function setConfig(config: EdgeBaseConfig): void {
  const normalized = materializeConfig(config);
  _runtimeConfig = normalized;

  if (typeof globalThis === 'object' && globalThis !== null) {
    (globalThis as Record<string, unknown>)[RUNTIME_CONFIG_GLOBAL_KEY] = normalized;
  }
}

/**
 * Get the current EdgeBase config.
 * Priority: request-scoped EDGEBASE_CONFIG → setConfig() singleton → {}.
 */
export function parseConfig(env?: unknown): EdgeBaseConfig {
  const envConfig = parseEnvConfig(env);
  if (envConfig) {
    return envConfig;
  }

  if (_runtimeConfig !== null) {
    return _runtimeConfig;
  }

  const globalConfig = readGlobalRuntimeConfig();
  if (globalConfig !== null) {
    _runtimeConfig = globalConfig;
    return globalConfig;
  }

  return {};
}

function parseEnvConfig(env?: unknown): EdgeBaseConfig | null {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return null;
  }

  const rawConfig = (env as Record<string, unknown>).EDGEBASE_CONFIG;
  if (rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)) {
    return materializeConfig(rawConfig as EdgeBaseConfig);
  }

  if (typeof rawConfig !== 'string' || rawConfig.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawConfig) as EdgeBaseConfig;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return materializeConfig(parsed);
  } catch {
    return null;
  }
}

/**
 * Get all table names that belong to a specific DB namespace.
 * Used after §1 migration — reads from databases block.
 */
export function getTablesInNamespace(
  namespace: string,
  config: EdgeBaseConfig,
): string[] {
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock?.tables) return [];
  return Object.keys(dbBlock.tables);
}

/**
 * Find which DB namespace a table belongs to.
 * Returns undefined if not found in any namespace.
 */
export function findTableNamespace(
  tableName: string,
  config: EdgeBaseConfig,
): string | undefined {
  if (!config.databases) return undefined;
  for (const [ns, dbBlock] of Object.entries(config.databases)) {
    if (dbBlock.tables && Object.hasOwn(dbBlock.tables, tableName)) {
      return ns;
    }
  }
  return undefined;
}

// ─── D1 Routing Helpers ───

/**
 * Determine if a namespace should route to D1.
 * Single-instance namespaces (no instance flag, no canCreate/access rules)
 * default to D1 unless provider is explicitly 'do'.
 */
export function shouldRouteToD1(namespace: string, config: EdgeBaseConfig): boolean {
  const normalized = materializeConfig(config);
  const dbBlock = normalized.databases?.[namespace];
  if (!dbBlock) return false;

  // Explicit D1 provider
  if (dbBlock.provider === 'd1') return true;

  // Explicit non-D1 providers — respect the user's choice
  if (dbBlock.provider === 'neon' || dbBlock.provider === 'postgres' || dbBlock.provider === 'do') return false;

  // Auto-detect: multi-tenant namespaces stay in DO
  if (dbBlock.instance) return false;
  if (dbBlock.access?.canCreate || dbBlock.access?.access) return false;

  // Default: single-instance → D1
  return true;
}

/**
 * Get the D1 binding name for a single-instance namespace.
 * Convention: DB_D1_{NAMESPACE_UPPER}
 */
export function getD1BindingName(namespace: string): string {
  return `DB_D1_${namespace.toUpperCase()}`;
}

// Note: table-level DO routing is handled directly by tablesRoute via
// getDbDoName(namespace, instanceId) — no per-table DO name lookup needed.
// (#133 §1: DB-first routing — DO instances are keyed by namespace:id, not by table name.)
