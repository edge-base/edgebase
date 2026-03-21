/**
 * Dev Sidecar HTTP Server — Schema editing bridge for admin dashboard.
 *
 * Runs alongside `wrangler dev` on port+1 (default :8788).
 * The dashboard UI calls this directly for schema mutations.
 * After modifying edgebase.config.ts, the existing fs.watch in dev.ts
 * detects the change and auto-restarts wrangler.
 *
 *
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import * as joseLib from 'jose';
import * as configEditor from './config-editor.js';
import { loadConfigSafe } from './load-config.js';
import { getDefaultPostgresEnvKey, removeEnvValue, upsertEnvValue } from './neon.js';
import { execTsxSync } from './node-tools.js';
import type { EdgeBaseConfig, SchemaField, IndexConfig, DbProvider } from '@edge-base/shared';
import { buildSnapshot, saveSnapshot } from './schema-check.js';
import {
  listAvailableNeonProjects,
  runNeonSetup,
  type NeonProjectMode,
  type NeonProjectOption,
} from '../commands/neon.js';

// ─── Types ───

export interface SidecarOptions {
  port: number;
  workerPort: number;
  configPath: string;
  projectDir: string;
  adminSecret: string;
}

type AuthSettingsTarget = 'development' | 'release';

const NEON_PROJECT_CACHE_TTL_MS = 60_000;
let neonProjectsCache: {
  loadedAt: number;
  items: NeonProjectOption[];
} | null = null;
type PostgresPool = {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{
    fields?: Array<{ name: string }>;
    rows?: Record<string, unknown>[];
    rowCount?: number | null;
  }>;
  end(): Promise<void>;
};

type PgModule = {
  Pool: new (options: { connectionString: string; max: number }) => PostgresPool;
};

type PgSchemaInitModule = {
  ensurePgSchema: (
    connectionString: string,
    namespace: string,
    tables: Record<
      string,
      {
        schema?: Record<string, unknown>;
        indexes?: unknown[];
        fts?: unknown[];
        migrations?: unknown[];
      }
    >,
    queryExecutor?: (
      sql: string,
      params?: unknown[],
    ) => Promise<{
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
    }>,
  ) => Promise<void>;
};

let pgModulePromise: Promise<PgModule> | null = null;
let pgSchemaInitModulePromise: Promise<PgSchemaInitModule> | null = null;
const postgresPoolCache = new Map<string, PostgresPool>();
const LOCAL_ENV_HEADER = '# EdgeBase local development secrets';
const RELEASE_ENV_HEADER = '# EdgeBase production secrets';
const MANAGED_AUTH_ENV_KEYS = ['EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS'];
const MANAGED_AUTH_ENV_PREFIXES = ['EDGEBASE_OAUTH_', 'EDGEBASE_OIDC_'];

// ─── JWT Verification (HS256, matching server's jose-based signing) ───

async function verifyAdminJwt(token: string, secret: string): Promise<boolean> {
  try {
    const secretKey = new TextEncoder().encode(secret);
    await joseLib.jwtVerify(token, secretKey, { issuer: 'edgebase:admin' });
    return true;
  } catch {
    return false;
  }
}

async function verifyAuth(req: IncomingMessage, adminSecret: string): Promise<boolean> {
  const internalSecret =
    req.headers['x-edgebase-internal-secret'] ?? req.headers['X-EdgeBase-Internal-Secret'];
  const internalValue = Array.isArray(internalSecret) ? internalSecret[0] : internalSecret;
  if (internalValue && internalValue === adminSecret) {
    return true;
  }

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  return verifyAdminJwt(token, adminSecret);
}

// ─── HTTP Helpers ───

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Parse URL path into segments and extract params.
 * E.g., '/schema/tables/posts/columns/title' → ['schema', 'tables', 'posts', 'columns', 'title']
 */
function parsePath(urlPath: string): string[] {
  return urlPath.split('/').filter(Boolean);
}

function sanitizeForLog(value: string): string {
  const escape = String.fromCharCode(27);
  const ansiPattern = new RegExp(`${escape}\\[[0-9;]*[A-Za-z]`, 'g');
  return value
    .replace(ansiPattern, '')
    .replace(/[\r\n\t]+/g, ' ')
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? '?' : char;
    })
    .join('');
}

function isDynamicDbBlock(
  dbBlock:
    | {
        instance?: boolean;
        access?: {
          canCreate?: unknown;
          access?: unknown;
        };
      }
    | undefined,
): boolean {
  if (!dbBlock) return false;
  return !!(dbBlock.instance || dbBlock.access?.canCreate || dbBlock.access?.access);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function isMissingTableError(message: string): boolean {
  return /no such table|does not exist|unknown table/i.test(message);
}

function parseAuthSettingsTarget(value: string | null): AuthSettingsTarget {
  return value === 'release' ? 'release' : 'development';
}

function isManagedAuthEnvKey(key: string): boolean {
  return (
    MANAGED_AUTH_ENV_KEYS.includes(key) ||
    MANAGED_AUTH_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function readAuthEnvValues(projectDir: string, target: AuthSettingsTarget): Record<string, string> {
  if (target === 'release') {
    return parseEnvFile(join(projectDir, '.env.release'));
  }

  return parseDevVars(projectDir);
}

function syncSidecarProcessEnv(
  projectDir: string,
  target: AuthSettingsTarget = 'development',
): Record<string, string> {
  const envValues = readAuthEnvValues(projectDir, target);

  for (const key of Object.keys(process.env)) {
    if (!isManagedAuthEnvKey(key)) continue;
    if (!(key in envValues)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(envValues)) {
    process.env[key] = value;
  }

  return envValues;
}

function loadSidecarConfig(
  opts: SidecarOptions,
  target: AuthSettingsTarget = 'development',
): EdgeBaseConfig {
  syncSidecarProcessEnv(opts.projectDir, target);
  return loadConfigSafe(opts.configPath, opts.projectDir, {
    allowRegexFallback: false,
  }) as EdgeBaseConfig;
}

function normalizeEnvSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function getOAuthEnvKeys(provider: string): {
  clientId: string;
  clientSecret: string;
  issuer?: string;
  scopes?: string;
} {
  if (provider.startsWith('oidc:')) {
    const oidcName = normalizeEnvSegment(provider.slice(5)) || 'CUSTOM';
    return {
      clientId: `EDGEBASE_OIDC_${oidcName}_CLIENT_ID`,
      clientSecret: `EDGEBASE_OIDC_${oidcName}_CLIENT_SECRET`,
      issuer: `EDGEBASE_OIDC_${oidcName}_ISSUER`,
      scopes: `EDGEBASE_OIDC_${oidcName}_SCOPES`,
    };
  }

  const providerName = normalizeEnvSegment(provider) || 'CUSTOM';
  return {
    clientId: `EDGEBASE_OAUTH_${providerName}_CLIENT_ID`,
    clientSecret: `EDGEBASE_OAUTH_${providerName}_CLIENT_SECRET`,
  };
}

function getEnvTargets(
  projectDir: string,
  target: AuthSettingsTarget,
): Array<{ filePath: string; header: string }> {
  if (target === 'release') {
    return [
      {
        filePath: join(projectDir, '.env.release'),
        header: RELEASE_ENV_HEADER,
      },
    ];
  }

  const envDevelopmentPath = join(projectDir, '.env.development');
  const devVarsPath = join(projectDir, '.dev.vars');

  if (existsSync(envDevelopmentPath) || !existsSync(devVarsPath)) {
    return [
      { filePath: envDevelopmentPath, header: LOCAL_ENV_HEADER },
      { filePath: devVarsPath, header: LOCAL_ENV_HEADER },
    ];
  }

  return [{ filePath: devVarsPath, header: LOCAL_ENV_HEADER }];
}

function updateEnvValue(
  projectDir: string,
  target: AuthSettingsTarget,
  key: string,
  value: string | null,
): void {
  for (const { filePath, header } of getEnvTargets(projectDir, target)) {
    if (value === null || value.trim() === '') {
      removeEnvValue(filePath, key);
      continue;
    }

    upsertEnvValue(filePath, key, value, header);
  }

  if (value === null || value.trim() === '') {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function syncOAuthSecretsToLocalEnv(
  projectDir: string,
  target: AuthSettingsTarget,
  allowedOAuthProviders: string[] | undefined,
  oauth:
    | Record<
        string,
        {
          clientId?: string | null;
          clientSecret?: string | null;
          issuer?: string | null;
          scopes?: string[];
        }
      >
    | undefined,
): void {
  updateEnvValue(
    projectDir,
    target,
    'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS',
    Array.isArray(allowedOAuthProviders) && allowedOAuthProviders.length > 0
      ? allowedOAuthProviders.join(',')
      : null,
  );

  if (!oauth) return;

  for (const [provider, config] of Object.entries(oauth)) {
    const envKeys = getOAuthEnvKeys(provider);
    updateEnvValue(
      projectDir,
      target,
      envKeys.clientId,
      typeof config.clientId === 'string' ? config.clientId : null,
    );
    updateEnvValue(
      projectDir,
      target,
      envKeys.clientSecret,
      typeof config.clientSecret === 'string' ? config.clientSecret : null,
    );

    if (envKeys.issuer) {
      updateEnvValue(
        projectDir,
        target,
        envKeys.issuer,
        typeof config.issuer === 'string' ? config.issuer : null,
      );
    }
    if (envKeys.scopes) {
      const scopesValue = Array.isArray(config.scopes)
        ? config.scopes
            .map((scope) => scope.trim())
            .filter(Boolean)
            .join(',')
        : null;
      updateEnvValue(
        projectDir,
        target,
        envKeys.scopes,
        scopesValue && scopesValue.length > 0 ? scopesValue : null,
      );
    }
  }
}

function readAuthSettings(config: EdgeBaseConfig): Record<string, unknown> {
  const authConfig = config.auth ?? {};
  const oauthEntries: Record<
    string,
    {
      clientId: string | null;
      clientSecret: string | null;
      issuer?: string | null;
      scopes?: string[];
    }
  > = {};

  const oauthConfig = authConfig.oauth ?? {};
  for (const [provider, value] of Object.entries(oauthConfig)) {
    if (!value || typeof value !== 'object') continue;
    const providerValue = value as Record<string, unknown>;

    if (provider === 'oidc') {
      for (const [oidcName, oidcValue] of Object.entries(providerValue)) {
        if (!oidcValue || typeof oidcValue !== 'object') continue;
        const oidcRecord = oidcValue as Record<string, unknown>;
        oauthEntries[`oidc:${oidcName}`] = {
          clientId: typeof oidcRecord.clientId === 'string' ? oidcRecord.clientId : null,
          clientSecret:
            typeof oidcRecord.clientSecret === 'string' ? oidcRecord.clientSecret : null,
          issuer: typeof oidcRecord.issuer === 'string' ? oidcRecord.issuer : null,
          scopes: Array.isArray(oidcRecord.scopes)
            ? oidcRecord.scopes.filter((scope): scope is string => typeof scope === 'string')
            : [],
        };
      }
      continue;
    }

    oauthEntries[provider] = {
      clientId: typeof providerValue.clientId === 'string' ? providerValue.clientId : null,
      clientSecret:
        typeof providerValue.clientSecret === 'string' ? providerValue.clientSecret : null,
    };
  }

  return {
    providers: Array.isArray(authConfig.allowedOAuthProviders)
      ? authConfig.allowedOAuthProviders
      : [],
    emailAuth: authConfig.emailAuth !== false,
    anonymousAuth: !!authConfig.anonymousAuth,
    allowedRedirectUrls: Array.isArray(authConfig.allowedRedirectUrls)
      ? authConfig.allowedRedirectUrls
      : [],
    session: {
      accessTokenTTL: authConfig.session?.accessTokenTTL ?? null,
      refreshTokenTTL: authConfig.session?.refreshTokenTTL ?? null,
      maxActiveSessions:
        typeof authConfig.session?.maxActiveSessions === 'number'
          ? authConfig.session.maxActiveSessions
          : null,
    },
    magicLink: {
      enabled: !!authConfig.magicLink?.enabled,
      autoCreate: authConfig.magicLink?.autoCreate !== false,
      tokenTTL: authConfig.magicLink?.tokenTTL ?? null,
    },
    emailOtp: {
      enabled: !!authConfig.emailOtp?.enabled,
      autoCreate: authConfig.emailOtp?.autoCreate !== false,
    },
    passkeys: {
      enabled: !!authConfig.passkeys?.enabled,
      rpName: authConfig.passkeys?.rpName ?? null,
      rpID: authConfig.passkeys?.rpID ?? null,
      origin: Array.isArray(authConfig.passkeys?.origin)
        ? authConfig.passkeys.origin
        : authConfig.passkeys?.origin
          ? [authConfig.passkeys.origin]
          : [],
    },
    oauth: oauthEntries,
  };
}

async function loadPgModule(): Promise<PgModule> {
  if (!pgModulePromise) {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<unknown>;
    pgModulePromise = dynamicImport('pg').then((mod) => mod as PgModule);
  }
  return pgModulePromise;
}

async function loadPgSchemaInitModule(opts: SidecarOptions): Promise<PgSchemaInitModule> {
  if (!pgSchemaInitModulePromise) {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<unknown>;
    const moduleUrl = pathToFileURL(
      resolve(opts.projectDir, 'packages/server/src/lib/postgres-schema-init.ts'),
    ).href;
    pgSchemaInitModulePromise = dynamicImport(moduleUrl).then((mod) => mod as PgSchemaInitModule);
  }
  return pgSchemaInitModulePromise;
}

async function getSidecarPostgresPool(connectionString: string): Promise<PostgresPool> {
  let pool = postgresPoolCache.get(connectionString);
  if (!pool) {
    const { Pool } = await loadPgModule();
    pool = new Pool({
      connectionString,
      max: 8,
    });
    postgresPoolCache.set(connectionString, pool);
  }
  return pool;
}

async function ensureSidecarPostgresSchema(opts: SidecarOptions, namespace: string): Promise<void> {
  const config = loadSidecarConfig(opts);
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) {
    throw new Error(`Namespace '${namespace}' not found.`);
  }

  if (isDynamicDbBlock(dbBlock)) {
    throw new Error(`Namespace '${namespace}' is dynamic and cannot use PostgreSQL schema ensure.`);
  }

  const connectionString = resolveSidecarPostgresConnectionString(opts, namespace);
  const pool = await getSidecarPostgresPool(connectionString);
  const { ensurePgSchema } = await loadPgSchemaInitModule(opts);

  await ensurePgSchema(
    connectionString,
    namespace,
    dbBlock.tables ?? {},
    async (sql, params = []) => {
      const result = await pool.query(sql, params);
      const rows = (result.rows ?? []) as Record<string, unknown>[];
      return {
        columns: (result.fields ?? []).map((field: { name: string }) => field.name),
        rows,
        rowCount: result.rowCount ?? rows.length,
      };
    },
  );
}

function resolveSidecarPostgresConnectionString(opts: SidecarOptions, namespace: string): string {
  const config = loadSidecarConfig(opts);
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) {
    throw new Error(`Namespace '${namespace}' not found.`);
  }

  if (isDynamicDbBlock(dbBlock)) {
    throw new Error(`Namespace '${namespace}' is dynamic and cannot use the PostgreSQL sidecar.`);
  }

  if (dbBlock.provider !== 'postgres' && dbBlock.provider !== 'neon') {
    throw new Error(`Namespace '${namespace}' is not PostgreSQL-backed.`);
  }

  const envValues = parseDevVars(opts.projectDir);
  const bindingName = `DB_POSTGRES_${namespace.toUpperCase().replace(/-/g, '_')}`;
  const envKey = dbBlock.connectionString ?? `${bindingName}_URL`;
  const connectionString = envValues[envKey];
  if (!connectionString) {
    throw new Error(`PostgreSQL connection '${envKey}' not found for '${namespace}'.`);
  }

  return connectionString;
}

async function executeWorkerSql(
  opts: SidecarOptions,
  authorization: string,
  namespace: string,
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${opts.workerPort}/admin/api/data/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({ namespace, sql, params }),
  });

  if (response.ok) {
    return;
  }

  let message = `SQL execution failed with ${response.status}`;
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload.message) {
      message = payload.message;
    }
  } catch {
    // Ignore non-JSON responses and fall back to the status-derived message.
  }

  throw new Error(message);
}

async function callWorkerAdmin<T>(
  opts: SidecarOptions,
  authorization: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${opts.workerPort}/admin/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let message = `${path} failed with ${response.status}`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload.message) {
        message = payload.message;
      }
    } catch {
      // Keep the status-derived fallback.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function getEffectiveSidecarProvider(
  config: EdgeBaseConfig,
  dbKey: string,
): 'do' | 'd1' | 'postgres' {
  const dbBlock = config.databases?.[dbKey];
  if (!dbBlock) {
    throw new Error(`Database block '${dbKey}' not found.`);
  }
  if (isDynamicDbBlock(dbBlock)) return 'do';
  if (dbBlock.provider === 'postgres' || dbBlock.provider === 'neon') return 'postgres';
  if (dbBlock.provider === 'do') return 'do';
  return 'd1';
}

function saveCurrentSnapshot(opts: SidecarOptions): void {
  const config = loadSidecarConfig(opts);
  const snapshot = buildSnapshot(config.databases ?? {}, config.auth?.provider);
  saveSnapshot(opts.projectDir, snapshot);
}

function resolveRequestedPostgresEnvKey(namespace: string, envKey?: string): string {
  const trimmed = envKey?.trim();
  return trimmed || getDefaultPostgresEnvKey(namespace);
}

async function waitForNamespaceProvider(
  opts: SidecarOptions,
  authorization: string,
  dbKey: string,
  expectedProvider: 'd1' | 'do' | 'postgres',
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const payload = await callWorkerAdmin<{
        namespaces?: Record<string, { provider?: string }>;
      }>(opts, authorization, 'data/schema');
      const provider = payload.namespaces?.[dbKey]?.provider;
      if (provider === expectedProvider) {
        return;
      }
      lastError = new Error(
        provider
          ? `Namespace '${dbKey}' is still running on '${provider}'.`
          : `Namespace '${dbKey}' is not available yet.`,
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Worker is not ready yet.');
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  throw lastError ?? new Error(`Timed out waiting for namespace '${dbKey}' to restart.`);
}

export async function renameBackingTable(
  opts: SidecarOptions,
  authorization: string,
  dbKey: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const config = loadSidecarConfig(opts);
  const dbBlock = config.databases?.[dbKey];
  if (!dbBlock) {
    throw new Error(`Database block '${dbKey}' not found.`);
  }

  if (isDynamicDbBlock(dbBlock)) {
    throw new Error(
      `Table rename is not supported for dynamic namespace '${dbKey}' because EdgeBase cannot rename every tenant instance automatically yet.`,
    );
  }

  try {
    await executeWorkerSql(
      opts,
      authorization,
      dbKey,
      `ALTER TABLE ${quoteIdentifier(oldName)} RENAME TO ${quoteIdentifier(newName)}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to rename backing table.';
    if (!isMissingTableError(message)) {
      throw err;
    }
  }
}

// ─── Schema Reader ───

function readCurrentSchema(
  configPath: string,
): Record<string, { namespace: string; fields: Record<string, unknown>; fts: string[] }> {
  try {
    // Use a quick approach: read config via tsx eval
    const projectDir = resolve(configPath, '..');
    const moduleUrl = pathToFileURL(resolve(configPath)).href;
    const result = execTsxSync(
      [
        '-e',
        `const mod = await import(${JSON.stringify(moduleUrl)}); const d=mod.default??mod; const s={}; for (const [ns,b] of Object.entries(d.databases??{})) { for (const [t,tc] of Object.entries((b as any).tables??{})) { s[t]={namespace:ns,fields:(tc as any).schema??{},fts:(tc as any).fts??[]}; } } console.log(JSON.stringify(s));`,
      ],
      { cwd: projectDir, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim();
    return JSON.parse(result);
  } catch {
    return {};
  }
}

// ─── Route Handler ───

async function handleRoute(
  req: IncomingMessage,
  res: ServerResponse,
  opts: SidecarOptions,
): Promise<void> {
  const url = new URL(req.url!, `http://localhost:${opts.port}`);
  const segments = parsePath(url.pathname);
  const method = req.method!;
  const editorOpts = { configPath: opts.configPath };

  // GET /dev/status
  if (method === 'GET' && segments[0] === 'dev' && segments[1] === 'status') {
    json(res, 200, { mode: 'dev', configPath: opts.configPath, port: opts.port });
    return;
  }

  // POST /postgres/query — pooled local PostgreSQL query bridge for Worker dev mode
  if (
    method === 'POST' &&
    segments[0] === 'postgres' &&
    segments[1] === 'query' &&
    segments.length === 2
  ) {
    const body = await readBody(req);
    const namespace = body.namespace as string;
    const sql = body.sql as string;
    const params = Array.isArray(body.params) ? body.params : [];

    if (!namespace) throw new Error('namespace is required.');
    if (!sql) throw new Error('sql is required.');

    const connectionString = resolveSidecarPostgresConnectionString(opts, namespace);
    const pool = await getSidecarPostgresPool(connectionString);
    const result = await pool.query(sql, params);
    const rows = (result.rows ?? []) as Record<string, unknown>[];
    json(res, 200, {
      columns: (result.fields ?? []).map((field: { name: string }) => field.name),
      rows,
      rowCount: result.rowCount ?? rows.length,
    });
    return;
  }

  // POST /postgres/ensure-schema — persistent local PostgreSQL schema warmup/cache
  if (
    method === 'POST' &&
    segments[0] === 'postgres' &&
    segments[1] === 'ensure-schema' &&
    segments.length === 2
  ) {
    const body = await readBody(req);
    const namespace = body.namespace as string;
    if (!namespace) throw new Error('namespace is required.');

    await ensureSidecarPostgresSchema(opts, namespace);
    json(res, 200, { ok: true });
    return;
  }

  // GET /schema — read current schema
  if (method === 'GET' && segments[0] === 'schema' && segments.length === 1) {
    const schema = readCurrentSchema(opts.configPath);
    json(res, 200, { ok: true, schema });
    return;
  }

  // POST /schema/tables — create table
  if (
    method === 'POST' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments.length === 2
  ) {
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';
    const name = body.name as string;
    const schema = (body.schema as Record<string, SchemaField>) || {};

    if (!name) throw new Error('Table name is required.');

    await configEditor.addTable(editorOpts, dbKey, name, schema);
    json(res, 201, { ok: true, message: `Table '${name}' created in '${dbKey}'.` });
    return;
  }

  // POST /schema/databases — create database block
  if (
    method === 'POST' &&
    segments[0] === 'schema' &&
    segments[1] === 'databases' &&
    segments.length === 2
  ) {
    const body = await readBody(req);
    const name = body.name as string;
    const topology = (body.topology as 'single' | 'dynamic' | undefined) ?? 'single';
    const provider = body.provider as DbProvider | undefined;
    const connectionString = body.connectionString as string | undefined;
    const targetLabel = body.targetLabel as string | undefined;
    const placeholder = body.placeholder as string | undefined;
    const helperText = body.helperText as string | undefined;

    if (!name) throw new Error('Database block name is required.');

    await configEditor.addDatabaseBlock(editorOpts, name, {
      topology,
      provider,
      connectionString,
      targetLabel,
      placeholder,
      helperText,
    });
    json(res, 201, { ok: true, message: `Database block '${name}' created.` });
    return;
  }

  // POST /integrations/neon/databases — create postgres DB block + configure Neon envs
  if (
    method === 'POST' &&
    segments[0] === 'integrations' &&
    segments[1] === 'neon' &&
    segments[2] === 'databases' &&
    segments.length === 3
  ) {
    const body = await readBody(req);
    const name = body.name as string;
    const topology = (body.topology as 'single' | 'dynamic' | undefined) ?? 'single';
    const envKey = body.envKey as string | undefined;
    const projectName = body.projectName as string | undefined;
    const projectId = body.projectId as string | undefined;
    const mode = (body.mode as NeonProjectMode | undefined) ?? 'reuse';
    const targetLabel = body.targetLabel as string | undefined;
    const placeholder = body.placeholder as string | undefined;
    const helperText = body.helperText as string | undefined;

    if (!name) throw new Error('Database block name is required.');
    if (topology !== 'single')
      throw new Error('Neon helper only supports single-instance database blocks.');

    const effectiveEnvKey = resolveRequestedPostgresEnvKey(name, envKey);

    const neonResult = await runNeonSetup({
      projectDir: opts.projectDir,
      namespace: name,
      envKeyOverride: effectiveEnvKey,
      targetLabelOverride: name,
      projectName,
      projectId,
      projectMode: mode,
    });

    await configEditor.addDatabaseBlock(editorOpts, name, {
      topology: 'single',
      provider: 'postgres',
      connectionString: neonResult.target.envKey,
      targetLabel,
      placeholder,
      helperText,
    });
    neonProjectsCache = null;
    saveCurrentSnapshot(opts);

    json(res, 201, {
      ok: true,
      mode,
      envKey: neonResult.target.envKey,
      projectName: neonResult.projectName,
      message: `Database block '${name}' created and connected to Neon.`,
    });
    return;
  }

  // POST /integrations/neon/connect — configure Neon envs for an existing postgres DB block
  if (
    method === 'POST' &&
    segments[0] === 'integrations' &&
    segments[1] === 'neon' &&
    segments[2] === 'connect' &&
    segments.length === 3
  ) {
    const body = await readBody(req);
    const namespace = body.namespace as string;
    const envKey = body.envKey as string | undefined;
    const projectId = body.projectId as string | undefined;
    const mode = (body.mode as NeonProjectMode | undefined) ?? 'reuse';

    if (!namespace) throw new Error('namespace is required.');

    const config = loadSidecarConfig(opts);
    const provider = getEffectiveSidecarProvider(config, namespace);
    if (provider === 'do') {
      throw new Error(
        `Namespace '${namespace}' is not eligible for Neon because it uses Durable Objects.`,
      );
    }
    if (provider === 'd1') {
      throw new Error(
        `Namespace '${namespace}' still uses D1. Use the D1 upgrade flow instead of reconnect.`,
      );
    }

    const neonResult = await runNeonSetup({
      projectDir: opts.projectDir,
      namespace,
      envKeyOverride: envKey,
      targetLabelOverride: namespace,
      projectId,
      projectMode: mode,
    });

    await configEditor.updateDatabaseBlock(editorOpts, namespace, {
      provider: 'postgres',
      connectionString: neonResult.target.envKey,
    });
    neonProjectsCache = null;
    saveCurrentSnapshot(opts);

    json(res, 200, {
      ok: true,
      mode,
      envKey: neonResult.target.envKey,
      projectName: neonResult.projectName,
      message: `Neon connection updated for '${namespace}'.`,
    });
    return;
  }

  // POST /integrations/neon/upgrade — migrate a D1 single DB block to Neon-backed postgres
  if (
    method === 'POST' &&
    segments[0] === 'integrations' &&
    segments[1] === 'neon' &&
    segments[2] === 'upgrade' &&
    segments.length === 3
  ) {
    const body = await readBody(req);
    const namespace = body.namespace as string;
    const envKey = body.envKey as string | undefined;
    const projectName = body.projectName as string | undefined;
    const projectId = body.projectId as string | undefined;
    const mode = (body.mode as NeonProjectMode | undefined) ?? 'reuse';
    const authorization = req.headers.authorization;

    if (!namespace) throw new Error('namespace is required.');
    if (!authorization) throw new Error('Admin authentication required.');

    const config = loadSidecarConfig(opts);
    const provider = getEffectiveSidecarProvider(config, namespace);
    if (provider !== 'd1') {
      throw new Error(
        `Only D1-backed single database blocks can be upgraded automatically. '${namespace}' is on '${provider}'.`,
      );
    }

    const effectiveEnvKey = resolveRequestedPostgresEnvKey(namespace, envKey);
    const namespaceLabel = sanitizeForLog(namespace);

    console.log();
    console.log(
      chalk.blue(`📦 Starting D1 -> Postgres migration for database block '${namespaceLabel}'...`),
    );
    console.log(chalk.dim('  This migrates every table in the block, not just the current table.'));
    console.log(chalk.dim('  1/4 Exporting all tables from D1...'));

    const dump = await callWorkerAdmin<{
      tables: Record<string, Array<Record<string, unknown>>>;
    }>(opts, authorization, 'data/backup/dump-data', { namespace });
    const dumpedTableCount = Object.keys(dump.tables ?? {}).length;

    console.log(
      chalk.dim(
        `  2/4 Connecting Postgres${mode === 'create' ? ' by creating a Neon project' : ' to the selected Neon project'}...`,
      ),
    );

    const neonResult = await runNeonSetup({
      projectDir: opts.projectDir,
      namespace,
      envKeyOverride: effectiveEnvKey,
      targetLabelOverride: namespace,
      projectName,
      projectId,
      projectMode: mode,
    });

    await configEditor.updateDatabaseBlock(editorOpts, namespace, {
      provider: 'postgres',
      connectionString: neonResult.target.envKey,
    });
    saveCurrentSnapshot(opts);

    console.log(chalk.dim('  3/4 Waiting for the dev worker to restart on Postgres...'));
    await waitForNamespaceProvider(opts, authorization, namespace, 'postgres');

    console.log(
      chalk.dim(
        `  4/4 Restoring ${dumpedTableCount} table${dumpedTableCount === 1 ? '' : 's'} into Postgres...`,
      ),
    );
    await callWorkerAdmin(opts, authorization, 'data/backup/restore-data', {
      namespace,
      tables: dump.tables,
      skipWipe: false,
    });

    console.log(
      chalk.green(
        `✓ Database block '${namespaceLabel}' is now running on Postgres (${dumpedTableCount} table${dumpedTableCount === 1 ? '' : 's'} restored).`,
      ),
    );

    json(res, 200, {
      ok: true,
      mode,
      envKey: neonResult.target.envKey,
      projectName: neonResult.projectName,
      restoredTables: dumpedTableCount,
      message: `Database block '${namespace}' migrated from D1 to Postgres.`,
    });
    return;
  }

  // GET /integrations/neon/projects — list existing Neon projects for dashboard selection
  if (
    method === 'GET' &&
    segments[0] === 'integrations' &&
    segments[1] === 'neon' &&
    segments[2] === 'projects' &&
    segments.length === 3
  ) {
    const forceRefresh = url.searchParams.get('refresh') === '1';
    const isCacheFresh =
      !forceRefresh &&
      neonProjectsCache &&
      Date.now() - neonProjectsCache.loadedAt < NEON_PROJECT_CACHE_TTL_MS;
    const items =
      isCacheFresh && neonProjectsCache
        ? neonProjectsCache.items
        : await listAvailableNeonProjects({
            projectDir: opts.projectDir,
          });

    if (!isCacheFresh) {
      neonProjectsCache = {
        loadedAt: Date.now(),
        items,
      };
    }

    json(res, 200, { ok: true, items });
    return;
  }

  // POST /schema/storage/buckets — create storage bucket
  if (
    method === 'POST' &&
    segments[0] === 'schema' &&
    segments[1] === 'storage' &&
    segments[2] === 'buckets' &&
    segments.length === 3
  ) {
    const body = await readBody(req);
    const name = body.name as string;

    if (!name) throw new Error('Bucket name is required.');

    await configEditor.addStorageBucket(editorOpts, name);
    json(res, 201, { ok: true, message: `Storage bucket '${name}' created.` });
    return;
  }

  // DELETE /schema/tables/:name — delete table
  if (
    method === 'DELETE' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments.length === 3
  ) {
    const tableName = segments[2];
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';

    await configEditor.removeTable(editorOpts, dbKey, tableName);
    json(res, 200, { ok: true, message: `Table '${tableName}' deleted.` });
    return;
  }

  // PUT /schema/tables/:name/rename — rename table
  if (
    method === 'PUT' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments[3] === 'rename' &&
    segments.length === 4
  ) {
    const tableName = segments[2];
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';
    const newName = body.newName as string;
    const authorization = req.headers.authorization;

    if (!newName) throw new Error('newName is required.');
    if (!authorization) throw new Error('Admin authentication required.');

    await renameBackingTable(opts, authorization, dbKey, tableName, newName);
    try {
      await configEditor.renameTable(editorOpts, dbKey, tableName, newName);
    } catch (err) {
      try {
        await executeWorkerSql(
          opts,
          authorization,
          dbKey,
          `ALTER TABLE ${quoteIdentifier(newName)} RENAME TO ${quoteIdentifier(tableName)}`,
        );
      } catch {
        // Best-effort rollback only; surface the original config write error.
      }
      throw err;
    }
    json(res, 200, { ok: true, message: `Table '${tableName}' renamed to '${newName}'.` });
    return;
  }

  // POST /schema/tables/:name/columns — add column
  if (
    method === 'POST' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments[3] === 'columns' &&
    segments.length === 4
  ) {
    const tableName = segments[2];
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';
    const columnName = body.columnName as string;
    const fieldDef = body.fieldDef as SchemaField;

    if (!columnName) throw new Error('columnName is required.');
    if (!fieldDef?.type) throw new Error('fieldDef with type is required.');

    await configEditor.addColumn(editorOpts, dbKey, tableName, columnName, fieldDef);
    json(res, 201, { ok: true, message: `Column '${columnName}' added to '${tableName}'.` });
    return;
  }

  // PUT /schema/tables/:name/columns/:col — update column
  if (
    method === 'PUT' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments[3] === 'columns' &&
    segments.length === 5
  ) {
    const tableName = segments[2];
    const columnName = segments[4];
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';
    const fieldDef = body.fieldDef as Partial<SchemaField>;

    if (!fieldDef) throw new Error('fieldDef is required.');

    await configEditor.updateColumn(editorOpts, dbKey, tableName, columnName, fieldDef);
    json(res, 200, { ok: true, message: `Column '${columnName}' updated in '${tableName}'.` });
    return;
  }

  // DELETE /schema/tables/:name/columns/:col — remove column
  if (
    method === 'DELETE' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments[3] === 'columns' &&
    segments.length === 5
  ) {
    const tableName = segments[2];
    const columnName = segments[4];
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';

    await configEditor.removeColumn(editorOpts, dbKey, tableName, columnName);
    json(res, 200, { ok: true, message: `Column '${columnName}' removed from '${tableName}'.` });
    return;
  }

  // POST /schema/tables/:name/indexes — add index
  if (
    method === 'POST' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments[3] === 'indexes' &&
    segments.length === 4
  ) {
    const tableName = segments[2];
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';
    const indexDef = body.indexDef as IndexConfig;

    if (!indexDef?.fields) throw new Error('indexDef with fields is required.');

    await configEditor.addIndex(editorOpts, dbKey, tableName, indexDef);
    json(res, 201, { ok: true, message: `Index added to '${tableName}'.` });
    return;
  }

  // DELETE /schema/tables/:name/indexes/:idx — remove index
  if (
    method === 'DELETE' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments[3] === 'indexes' &&
    segments.length === 5
  ) {
    const tableName = segments[2];
    const indexIdx = parseInt(segments[4], 10);
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';

    await configEditor.removeIndex(editorOpts, dbKey, tableName, indexIdx);
    json(res, 200, { ok: true, message: `Index ${indexIdx} removed from '${tableName}'.` });
    return;
  }

  // PUT /schema/tables/:name/fts — set FTS fields
  if (
    method === 'PUT' &&
    segments[0] === 'schema' &&
    segments[1] === 'tables' &&
    segments[3] === 'fts' &&
    segments.length === 4
  ) {
    const tableName = segments[2];
    const body = await readBody(req);
    const dbKey = (body.dbKey as string) || 'shared';
    const fields = (body.fields as string[]) || [];

    await configEditor.setFts(editorOpts, dbKey, tableName, fields);
    json(res, 200, { ok: true, message: `FTS fields updated for '${tableName}'.` });
    return;
  }

  // ─── Auth Settings Editing ───

  // GET /auth/settings — read current auth config
  if (
    method === 'GET' &&
    segments[0] === 'auth' &&
    segments[1] === 'settings' &&
    segments.length === 2
  ) {
    const target = parseAuthSettingsTarget(url.searchParams.get('target'));
    const config = loadSidecarConfig(opts, target);
    json(res, 200, { ok: true, target, ...readAuthSettings(config) });
    return;
  }

  // PUT /auth/settings — save auth config
  if (
    method === 'PUT' &&
    segments[0] === 'auth' &&
    segments[1] === 'settings' &&
    segments.length === 2
  ) {
    const target = parseAuthSettingsTarget(url.searchParams.get('target'));
    const body = await readBody(req);
    const session = body.session as Record<string, unknown> | undefined;
    const magicLink = body.magicLink as Record<string, unknown> | undefined;
    const emailOtp = body.emailOtp as Record<string, unknown> | undefined;
    const passkeys = body.passkeys as Record<string, unknown> | undefined;
    const oauth = body.oauth as Record<string, Record<string, unknown>> | undefined;
    const normalizedOAuth =
      oauth && typeof oauth === 'object'
        ? Object.fromEntries(
            Object.entries(oauth)
              .filter(([, value]) => value && typeof value === 'object')
              .map(([provider, value]) => [
                provider,
                {
                  clientId: typeof value.clientId === 'string' ? value.clientId : null,
                  clientSecret: typeof value.clientSecret === 'string' ? value.clientSecret : null,
                  issuer: typeof value.issuer === 'string' ? value.issuer : null,
                  scopes: Array.isArray(value.scopes)
                    ? value.scopes.filter((scope): scope is string => typeof scope === 'string')
                    : [],
                },
              ]),
          )
        : undefined;

    syncOAuthSecretsToLocalEnv(
      opts.projectDir,
      target,
      Array.isArray(body.allowedOAuthProviders)
        ? body.allowedOAuthProviders.filter(
            (provider): provider is string => typeof provider === 'string',
          )
        : undefined,
      normalizedOAuth,
    );

    await configEditor.setAuthSettings(editorOpts, {
      emailAuth: typeof body.emailAuth === 'boolean' ? body.emailAuth : undefined,
      anonymousAuth: typeof body.anonymousAuth === 'boolean' ? body.anonymousAuth : undefined,
      allowedOAuthProviders: Array.isArray(body.allowedOAuthProviders)
        ? body.allowedOAuthProviders.filter(
            (provider): provider is string => typeof provider === 'string',
          )
        : undefined,
      allowedRedirectUrls: Array.isArray(body.allowedRedirectUrls)
        ? body.allowedRedirectUrls.filter((url): url is string => typeof url === 'string')
        : undefined,
      session:
        session && typeof session === 'object'
          ? {
              accessTokenTTL:
                typeof session.accessTokenTTL === 'string' ? session.accessTokenTTL : null,
              refreshTokenTTL:
                typeof session.refreshTokenTTL === 'string' ? session.refreshTokenTTL : null,
              maxActiveSessions:
                typeof session.maxActiveSessions === 'number' ? session.maxActiveSessions : null,
            }
          : undefined,
      magicLink:
        magicLink && typeof magicLink === 'object'
          ? {
              enabled: typeof magicLink.enabled === 'boolean' ? magicLink.enabled : undefined,
              autoCreate:
                typeof magicLink.autoCreate === 'boolean' ? magicLink.autoCreate : undefined,
              tokenTTL: typeof magicLink.tokenTTL === 'string' ? magicLink.tokenTTL : null,
            }
          : undefined,
      emailOtp:
        emailOtp && typeof emailOtp === 'object'
          ? {
              enabled: typeof emailOtp.enabled === 'boolean' ? emailOtp.enabled : undefined,
              autoCreate:
                typeof emailOtp.autoCreate === 'boolean' ? emailOtp.autoCreate : undefined,
            }
          : undefined,
      passkeys:
        passkeys && typeof passkeys === 'object'
          ? {
              enabled: typeof passkeys.enabled === 'boolean' ? passkeys.enabled : undefined,
              rpName: typeof passkeys.rpName === 'string' ? passkeys.rpName : null,
              rpID: typeof passkeys.rpID === 'string' ? passkeys.rpID : null,
              origin: Array.isArray(passkeys.origin)
                ? passkeys.origin.filter((origin): origin is string => typeof origin === 'string')
                : undefined,
            }
          : undefined,
      oauth: normalizedOAuth,
    });

    json(res, 200, { ok: true, target, message: 'Auth settings updated.' });
    return;
  }

  // ─── Email Template Editing ───

  // PUT /email/templates — save email subject/template override (with optional locale)
  if (
    method === 'PUT' &&
    segments[0] === 'email' &&
    segments[1] === 'templates' &&
    segments.length === 2
  ) {
    const body = await readBody(req);
    const type = body.type as string;
    const locale = (body.locale as string | undefined) ?? 'en';
    const subject = body.subject as string | null | undefined;
    const template = body.template as string | null | undefined;

    if (!type) throw new Error('Email type is required.');

    // Handle subject
    if (subject !== undefined) {
      if (subject === null || subject === '') {
        if (locale === 'en') {
          await configEditor.removeEmailOverride(editorOpts, type, 'subject');
        } else {
          await configEditor.removeEmailOverrideForLocale(editorOpts, type, 'subject', locale);
        }
      } else {
        if (locale === 'en') {
          await configEditor.setEmailSubject(editorOpts, type, subject);
        } else {
          await configEditor.setEmailSubjectForLocale(editorOpts, type, locale, subject);
        }
      }
    }

    // Handle template
    if (template !== undefined) {
      if (template === null || template === '') {
        if (locale === 'en') {
          await configEditor.removeEmailOverride(editorOpts, type, 'template');
        } else {
          await configEditor.removeEmailOverrideForLocale(editorOpts, type, 'template', locale);
        }
      } else {
        if (locale === 'en') {
          await configEditor.setEmailTemplate(editorOpts, type, template);
        } else {
          await configEditor.setEmailTemplateForLocale(editorOpts, type, locale, template);
        }
      }
    }

    json(res, 200, { ok: true, message: `Email '${type}' (${locale}) config updated.` });
    return;
  }

  // GET /email/templates — read current email config
  if (
    method === 'GET' &&
    segments[0] === 'email' &&
    segments[1] === 'templates' &&
    segments.length === 2
  ) {
    // Re-read the full config to get email section
    try {
      const projectDir = resolve(opts.configPath, '..');
      const moduleUrl = pathToFileURL(resolve(opts.configPath)).href;
      const result = execTsxSync(
        [
          '-e',
          `const mod = await import(${JSON.stringify(moduleUrl)}); const d=mod.default??mod; const e=d.email??{}; console.log(JSON.stringify({appName:e.appName||'EdgeBase',subjects:e.subjects||{},templates:e.templates||{}}));`,
        ],
        { cwd: projectDir, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] },
      ).trim();
      const emailConfig = JSON.parse(result);
      json(res, 200, { ok: true, ...emailConfig });
    } catch {
      json(res, 200, { ok: true, appName: 'EdgeBase', subjects: {}, templates: {} });
    }
    return;
  }

  json(res, 404, { code: 404, message: 'Not found.' });
}

// ─── Server ───

export function startSidecar(opts: SidecarOptions): Server {
  const server = createServer(async (req, res) => {
    // CORS headers (dashboard on :8787, sidecar on :8788)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-EdgeBase-Internal-Secret',
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Auth: verify Admin JWT
      const authValid = await verifyAuth(req, opts.adminSecret);
      if (!authValid) {
        json(res, 401, { code: 401, message: 'Admin authentication required.' });
        return;
      }

      await handleRoute(req, res, opts);
    } catch (err) {
      const message = (err as Error).message || 'Internal error';
      json(res, 400, { code: 400, message });
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(chalk.dim(`  📐 Schema Editor sidecar skipped (:${opts.port} already in use)`));
      return;
    }
    console.log(chalk.dim('  📐 Schema Editor sidecar skipped:'), sanitizeForLog(err.message));
  });

  server.listen(opts.port, () => {
    console.log(chalk.dim(`  📐 Schema Editor sidecar on :${opts.port}`));
  });

  server.on('close', () => {
    for (const pool of postgresPoolCache.values()) {
      void pool.end().catch(() => undefined);
    }
    postgresPoolCache.clear();
  });

  return server;
}

// ─── Env File Parser ───

/**
 * Parse a KEY=VALUE env file (supports comments, quoted values).
 * Shared by dev (`.env.development`) and deploy (`.env.release`).
 */
export function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  } catch {
    // File not found or unreadable
  }
  return vars;
}

/**
 * Parse development environment variables.
 * Priority: `.env.development` → `.dev.vars` (backward compat).
 */
export function parseDevVars(projectDir: string): Record<string, string> {
  const envDevPath = join(projectDir, '.env.development');
  if (existsSync(envDevPath)) return parseEnvFile(envDevPath);
  return parseEnvFile(join(projectDir, '.dev.vars'));
}
