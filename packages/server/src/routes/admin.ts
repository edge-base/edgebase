/**
 * Admin Dashboard routes — M12
 *
 * Two sections:
 *  1. Auth routes (no JWT required): setup status, setup, login, refresh
 *  2. Internal route (Service Key required): reset-password
 *  3. Admin API routes (Admin JWT required): tables, users, storage, schema, logs, monitoring
 *
 * Admin accounts are managed via D1 Control Plane.
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import type { Env } from '../types.js';
import { EdgeBaseError, getDbAccess, getTableAccess } from '@edge-base/shared';
import type { AuthContext } from '@edge-base/shared';
import {
  signAdminAccessToken,
  signAdminRefreshToken,
  TokenExpiredError,
  TokenInvalidError,
  verifyAdminRefreshTokenWithFallback,
  verifyAdminTokenWithFallback,
} from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { generateId } from '../lib/uuid.js';
import { validateKey, buildConstraintCtx, extractBearerToken, resolveServiceKeyCandidate } from '../lib/service-key.js';
import { parseConfig, getDbDoName, getD1BindingName, shouldRouteToD1 } from '../lib/do-router.js';
import { handleD1Request, d1BatchImport } from '../lib/d1-handler.js';
import { fetchDOWithRetry } from '../lib/do-retry.js';
import { dumpNamespaceTables } from '../lib/namespace-dump.js';
import { ensureD1Schema } from '../lib/d1-schema-init.js';
import { QUERY_PARAM_KEYS } from '../lib/query-engine.js';
import { parsePagination } from '../lib/pagination.js';
import { handlePgRequest } from '../lib/postgres-handler.js';
import { ensurePgSchema } from '../lib/postgres-schema-init.js';
import {
  ensureLocalDevPostgresSchema,
  getLocalDevPostgresExecOptions,
  getProviderBindingName,
  withPostgresConnection,
} from '../lib/postgres-executor.js';
import {
  zodDefaultHook,
  jsonResponseSchema,
  errorResponseSchema,
} from '../lib/schemas.js';
import {
  ensureAuthSchema,
  adminExists,
  createAdmin,
  getAdminByEmail,
  getAdminById,
  getAdminSession,
  createAdminSession,
  deleteAdminSession,
  listAdmins,
  deleteAdmin,
  updateAdminPassword,
  listUserMappings,
  searchUserMappingsByEmail,
  countUsers,
  deleteAnon,
} from '../lib/auth-d1.js';
import * as authService from '../lib/auth-d1-service.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import { getPublicProfileWithCache } from './users.js';
import { createSignedToken, parseDuration } from './storage.js';
import { getDevicesForUser, getPushLogs } from '../lib/push-token.js';
import { RATE_LIMIT_DEFAULTS } from '../middleware/rate-limit.js';
import {
  createManagedAdminUser,
  deleteManagedAdminUser,
  normalizeAdminUserUpdates,
  updateManagedAdminUser,
} from '../lib/admin-user-management.js';
import { DATABASE_LIVE_HUB_DO_NAME } from '../lib/database-live-emitter.js';
import { fetchRoomMonitoringStatsFromKv } from '../lib/room-monitoring.js';
import {
  executeAdminDbQuery,
  resolveAdminInstanceOptions,
  serializeAdminInstanceDiscovery,
} from '../lib/admin-db-target.js';

const BUILT_IN_RATE_LIMIT_GROUPS = [
  'global',
  'db',
  'storage',
  'functions',
  'auth',
  'authSignin',
  'authSignup',
  'events',
] as const;

const AUTH_BACKUP_TABLES = [
  '_email_index',
  '_oauth_index',
  '_anon_index',
  '_phone_index',
  '_passkey_index',
  '_admins',
  '_admin_sessions',
  '_users_public',
  '_meta',
  '_users',
  '_sessions',
  '_oauth_accounts',
  '_email_tokens',
  '_mfa_factors',
  '_mfa_recovery_codes',
  '_webauthn_credentials',
] as const;

const AUTH_BACKUP_TABLE_SET = new Set<string>(AUTH_BACKUP_TABLES);

function quoteSqlIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new EdgeBaseError(400, `Invalid SQL identifier: ${identifier}`, undefined, 'validation-failed');
  }
  return `"${identifier}"`;
}

// Browser bootstrap is opt-in and only enabled by the local dev workflow.
function isPublicAdminSetupEnabled(env: Env): boolean {
  return env.EDGEBASE_ALLOW_PUBLIC_ADMIN_SETUP === '1'
    || env.EDGEBASE_ALLOW_PUBLIC_ADMIN_SETUP === 'true';
}

function isPublicAdminSetupAllowed(env: Env): boolean {
  try {
    const config = parseConfig(env);
    return config.release !== true && isPublicAdminSetupEnabled(env);
  } catch {
    return false;
  }
}

interface MonitoringStats {
  subsystem?: string;
  activeConnections: number;
  authenticatedConnections?: number;
  channels: number;
  channelDetails?: Array<{ channel: string; subscribers: number }>;
}

function emptyMonitoringStats(): MonitoringStats {
  return {
    activeConnections: 0,
    authenticatedConnections: 0,
    channels: 0,
    channelDetails: [],
  };
}

async function fetchMonitoringStatsFromNamespace(
  namespace: DurableObjectNamespace | undefined,
  hubName: string,
): Promise<MonitoringStats> {
  if (!namespace) return emptyMonitoringStats();

  try {
    const stub = namespace.get(namespace.idFromName(hubName));
    const resp = await stub.fetch(new Request('http://internal/internal/stats', {
      headers: { 'X-DO-Name': hubName },
    }));
    if (!resp.ok) return emptyMonitoringStats();
    const stats = await resp.json() as MonitoringStats;
    return {
      ...emptyMonitoringStats(),
      ...stats,
      channelDetails: Array.isArray(stats.channelDetails) ? stats.channelDetails : [],
    };
  } catch {
    return emptyMonitoringStats();
  }
}

async function fetchUnifiedMonitoringStats(env: Env): Promise<MonitoringStats & {
  databaseLive: MonitoringStats;
  rooms: MonitoringStats;
}> {
  const [databaseLive, rooms] = await Promise.all([
    fetchMonitoringStatsFromNamespace(env.DATABASE_LIVE, DATABASE_LIVE_HUB_DO_NAME),
    fetchRoomMonitoringStatsFromKv(env.KV),
  ]);

  const channelDetails = [
    ...(databaseLive.channelDetails ?? []),
    ...(rooms.channelDetails ?? []),
  ].sort((a, b) => b.subscribers - a.subscribers);

  return {
    activeConnections: databaseLive.activeConnections + rooms.activeConnections,
    authenticatedConnections:
      (databaseLive.authenticatedConnections ?? 0) + (rooms.authenticatedConnections ?? 0),
    channels: new Set(channelDetails.map((detail) => detail.channel)).size,
    channelDetails,
    databaseLive,
    rooms,
  };
}

async function fetchRecentLogsFromDo(
  env: Env,
  options: {
    limit: number;
    level?: string;
    pathFilter?: string;
    category?: string;
  },
): Promise<Array<Record<string, unknown>> | null> {
  if (!env.LOGS) return null;

  try {
    const logsId = env.LOGS.idFromName('logs:main');
    const logsDO = env.LOGS.get(logsId);
    const params = new URLSearchParams({
      limit: String(Math.max(1, Math.min(options.limit, 200))),
    });

    if (options.level) params.set('level', options.level);
    if (options.pathFilter) params.set('path', options.pathFilter);
    if (options.category) params.set('category', options.category);

    const resp = await logsDO.fetch(
      new Request(`http://internal/internal/logs/recent?${params.toString()}`),
    );
    if (!resp.ok) return [];

    const data = await resp.json<{ logs?: Array<Record<string, unknown>> }>();
    return data.logs ?? [];
  } catch {
    return [];
  }
}

function getLogStatusCode(log: Record<string, unknown>): number {
  const status = log.status;
  if (typeof status === 'number') return status;
  if (typeof status === 'string') {
    const parsed = Number.parseInt(status, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function matchesLogLevel(status: number, level: string): boolean {
  const normalized = level.toLowerCase();
  if (normalized === 'error') return status >= 500;
  if (normalized === 'warn') return (status >= 300 && status < 500 && status !== 304);
  if (normalized === 'info') return (status >= 200 && status < 300) || status === 304;
  return true;
}

const DEFAULT_RATE_LIMIT_BINDING = {
  limit: 10_000_000,
  period: 60 as const,
};

function normalizeOptionalRole(role: unknown): string | undefined {
  if (role === undefined) {
    return undefined;
  }
  if (typeof role !== 'string') {
    throw new EdgeBaseError(400, 'Role must be a non-empty string.', undefined, 'validation-failed');
  }
  const normalized = role.trim();
  if (!normalized) {
    throw new EdgeBaseError(400, 'Role must be a non-empty string.', undefined, 'validation-failed');
  }
  if (normalized.length > 100) {
    throw new EdgeBaseError(400, 'Role must not exceed 100 characters.', undefined, 'validation-failed');
  }
  return normalized;
}

function buildRateLimitSummary(config: ReturnType<typeof parseConfig>) {
  const configured = config.rateLimiting ?? {};
  const entries: Array<{
    group: string;
    requests: number;
    window: string;
    binding: {
      enabled: boolean;
      limit?: number;
      period?: number;
      source: 'default' | 'override' | 'disabled' | 'custom';
    } | null;
  }> = [];
  const seen = new Set<string>();
  const formatWindow = (window: string | number | undefined, fallbackSec: number) => {
    if (typeof window === 'number') return `${window}s`;
    return window ?? `${fallbackSec}s`;
  };

  for (const group of BUILT_IN_RATE_LIMIT_GROUPS) {
    const groupConfig = configured[group];
    const fallback = RATE_LIMIT_DEFAULTS[group] ?? RATE_LIMIT_DEFAULTS.global;
    const bindingConfig = groupConfig?.binding;

    entries.push({
      group,
      requests: groupConfig?.requests ?? fallback.requests,
      window: formatWindow(groupConfig?.window, fallback.windowSec),
      binding: bindingConfig?.enabled === false
        ? { enabled: false, source: 'disabled' }
        : {
            enabled: true,
            limit: bindingConfig?.limit ?? DEFAULT_RATE_LIMIT_BINDING.limit,
            period: bindingConfig?.period ?? DEFAULT_RATE_LIMIT_BINDING.period,
            source: bindingConfig ? 'override' : 'default',
          },
    });
    seen.add(group);
  }

  for (const [group, groupConfig] of Object.entries(configured)) {
    if (seen.has(group) || !groupConfig) continue;
    const bindingConfig = groupConfig.binding;

    entries.push({
      group,
      requests: groupConfig.requests,
      window: formatWindow(groupConfig.window, RATE_LIMIT_DEFAULTS.global.windowSec),
      binding: bindingConfig
        ? (
            bindingConfig.enabled === false
              ? { enabled: false, source: 'disabled' as const }
              : {
                  enabled: true,
                  limit: bindingConfig.limit,
                  period: bindingConfig.period ?? DEFAULT_RATE_LIMIT_BINDING.period,
                  source: 'custom' as const,
                }
          )
        : null,
    });
  }

  return entries;
}


/** Resolve AuthDb from Hono context. Defaults to D1 (AUTH_DB binding). */
function getAuthDb(c: { env: Env }): AuthDb {
  return resolveAuthDb(c.env as unknown as Record<string, unknown>);
}

export const adminRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// Error handler
adminRoute.onError((err, c) => {
  if (err instanceof EdgeBaseError) {
    return c.json(err.toJSON(), err.code as 400);
  }
  console.error('Admin Dashboard unhandled error:', err);
  return c.json({ code: 500, message: 'Internal server error.' }, 500);
});

// ─────────────────────────────────────────────
// 1. Auth Routes — No JWT required
//    Admin accounts stored in D1
// ─────────────────────────────────────────────

// GET /admin/api/setup/status — check if admin setup is needed
const adminSetupStatus = createRoute({
  operationId: 'adminSetupStatus',
  method: 'get',
  path: '/setup/status',
  tags: ['admin'],
  summary: 'Check if admin setup is needed',
  responses: {
    200: { description: 'Setup status', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

adminRoute.openapi(adminSetupStatus, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const exists = await adminExists(getAuthDb(c));
  const needsSetup = !exists;
  const publicSetupAllowed = needsSetup ? isPublicAdminSetupAllowed(c.env) : false;
  return c.json({
    needsSetup,
    publicSetupAllowed,
    setupMethod: needsSetup ? (publicSetupAllowed ? 'browser' : 'cli') : 'login',
    message: needsSetup && !publicSetupAllowed
      ? 'Public admin setup is disabled for this deployment. Run `npx edgebase admin bootstrap` with a Service Key, or use the deploy/docker bootstrap flow instead.'
      : undefined,
  });
});

// POST /admin/api/setup — create the first admin account
const adminSetup = createRoute({
  operationId: 'adminSetup',
  method: 'post',
  path: '/setup',
  tags: ['admin'],
  summary: 'Create the first admin account',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string(),
            password: z.string(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    201: { description: 'Admin created', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminRoute.openapi(adminSetup, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const exists = await adminExists(getAuthDb(c));
  if (exists) throw new EdgeBaseError(400, 'Admin account already exists. Use login instead.', undefined, 'already-exists');
  if (!isPublicAdminSetupAllowed(c.env)) {
    throw new EdgeBaseError(
      403,
      'Public admin setup is disabled for this deployment. Run `npx edgebase admin bootstrap` with a Service Key, or use the deploy/docker bootstrap flow instead.',
      undefined,
      'forbidden',
    );
  }

  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) throw new EdgeBaseError(400, 'Email and password are required.', undefined, 'validation-failed');
  body.email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
  if (body.password.length < 8) throw new EdgeBaseError(400, 'Password must be at least 8 characters.', undefined, 'password-too-short');
  if (body.password.length > 256) throw new EdgeBaseError(400, 'Password must not exceed 256 characters.', undefined, 'password-too-long');

  const adminSecret = c.env.JWT_ADMIN_SECRET;
  if (!adminSecret) throw new EdgeBaseError(500, 'JWT_ADMIN_SECRET not configured.', undefined, 'internal-error');

  const adminId = generateId();
  const passwordHash = await hashPassword(body.password);
  await createAdmin(getAuthDb(c), adminId, body.email, passwordHash);

  const accessToken = await signAdminAccessToken({ sub: adminId }, adminSecret, '1h');
  const refreshToken = await signAdminRefreshToken({ sub: adminId }, adminSecret, '28d');

  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString();
  await createAdminSession(getAuthDb(c), sessionId, adminId, refreshToken, expiresAt);

  return c.json({
    accessToken,
    refreshToken,
    admin: { id: adminId, email: body.email },
  }, 201);
});

// POST /admin/api/auth/login — admin login
const adminLogin = createRoute({
  operationId: 'adminLogin',
  method: 'post',
  path: '/auth/login',
  tags: ['admin'],
  summary: 'Admin login',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string(),
            password: z.string(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Login successful', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Invalid credentials', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminRoute.openapi(adminLogin, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) throw new EdgeBaseError(400, 'Email and password are required.', undefined, 'validation-failed');
  body.email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');

  const admin = await getAdminByEmail(getAuthDb(c), body.email);
  if (!admin) throw new EdgeBaseError(401, 'Invalid credentials.', undefined, 'invalid-credentials');

  const valid = await verifyPassword(body.password, admin.passwordHash);
  if (!valid) throw new EdgeBaseError(401, 'Invalid credentials.', undefined, 'invalid-credentials');

  const adminSecret = c.env.JWT_ADMIN_SECRET;
  if (!adminSecret) throw new EdgeBaseError(500, 'JWT_ADMIN_SECRET not configured.', undefined, 'internal-error');

  const accessToken = await signAdminAccessToken({ sub: admin.id }, adminSecret, '1h');
  const refreshToken = await signAdminRefreshToken({ sub: admin.id }, adminSecret, '28d');

  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString();
  await createAdminSession(getAuthDb(c), sessionId, admin.id, refreshToken, expiresAt);

  return c.json({
    accessToken,
    refreshToken,
    admin: { id: admin.id, email: admin.email },
  });
});

// POST /admin/api/auth/refresh — rotate admin token
const adminRefresh = createRoute({
  operationId: 'adminRefresh',
  method: 'post',
  path: '/auth/refresh',
  tags: ['admin'],
  summary: 'Rotate admin token',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            refreshToken: z.string(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Token rotated', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Invalid token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminRoute.openapi(adminRefresh, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const body = await c.req.json<{ refreshToken: string }>();
  if (!body.refreshToken) throw new EdgeBaseError(400, 'Refresh token is required.', undefined, 'validation-failed');

  const adminSecret = c.env.JWT_ADMIN_SECRET;
  if (!adminSecret) throw new EdgeBaseError(500, 'JWT_ADMIN_SECRET not configured.', undefined, 'internal-error');

  let tokenPayload: { sub: string };
  try {
    tokenPayload = await verifyAdminRefreshTokenWithFallback(
      body.refreshToken,
      adminSecret,
      c.env.JWT_ADMIN_SECRET_OLD,
      c.env.JWT_ADMIN_SECRET_OLD_AT,
    ) as { sub: string };
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof TokenInvalidError) {
      throw new EdgeBaseError(401, 'Invalid or expired refresh token.', undefined, 'invalid-refresh-token');
    }
    throw err;
  }

  const session = await getAdminSession(getAuthDb(c), body.refreshToken);
  if (!session) throw new EdgeBaseError(401, 'Invalid or expired refresh token.', undefined, 'invalid-refresh-token');
  if (session.adminId !== tokenPayload.sub) {
    throw new EdgeBaseError(401, 'Invalid or expired refresh token.', undefined, 'invalid-refresh-token');
  }

  const admin = await getAdminById(getAuthDb(c), session.adminId);
  if (!admin) throw new EdgeBaseError(401, 'Admin not found.', undefined, 'user-not-found');

  // Rotate: delete old session, create new
  await deleteAdminSession(getAuthDb(c), session.id);

  const newAccessToken = await signAdminAccessToken({ sub: admin.id }, adminSecret, '1h');
  const newRefreshToken = await signAdminRefreshToken({ sub: admin.id }, adminSecret, '28d');

  const newSessionId = generateId();
  const expiresAt = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString();
  await createAdminSession(getAuthDb(c), newSessionId, admin.id, newRefreshToken, expiresAt);

  return c.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
});

// ─────────────────────────────────────────────
// 2. Internal Route — Service Key required
// ─────────────────────────────────────────────

// POST /admin/api/internal/reset-password — CLI reset-password endpoint
const adminResetPassword = createRoute({
  operationId: 'adminResetPassword',
  method: 'post',
  path: '/internal/reset-password',
  tags: ['admin'],
  summary: 'Reset admin password (Service Key required)',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string(),
            newPassword: z.string(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Password reset', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminRoute.openapi(adminResetPassword, async (c) => {
  const config = parseConfig(c.env);
  const provided = resolveServiceKeyCandidate(c.req);
  const { result } = validateKey(provided, 'auth:admin:*:*', config, c.env, undefined, buildConstraintCtx(c.env, c.req));
  if (result === 'missing') {
    throw new EdgeBaseError(403, 'Service Key required for admin operations.', undefined, 'forbidden');
  }
  if (result === 'invalid') {
    throw new EdgeBaseError(401, 'Invalid or missing Service Key.', undefined, 'unauthenticated');
  }

  await ensureAuthSchema(getAuthDb(c));
  const body = await c.req.json<{ email: string; newPassword: string }>();
  if (!body.email || !body.newPassword) throw new EdgeBaseError(400, 'Email and newPassword are required.', undefined, 'validation-failed');
  body.email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
  if (body.newPassword.length < 8) throw new EdgeBaseError(400, 'Password must be at least 8 characters.', undefined, 'password-too-short');
  if (body.newPassword.length > 256) throw new EdgeBaseError(400, 'Password must not exceed 256 characters.', undefined, 'password-too-long');

  const admin = await getAdminByEmail(getAuthDb(c), body.email);
  if (!admin) throw new EdgeBaseError(404, 'Admin not found.', undefined, 'user-not-found');

  const newHash = await hashPassword(body.newPassword);
  await updateAdminPassword(getAuthDb(c), admin.id, newHash);

  return c.json({ ok: true, message: 'Admin password reset successfully.' });
});

// ─────────────────────────────────────────────
// 3. Admin API Routes — Admin JWT required
// ─────────────────────────────────────────────

// Sub-app for JWT-protected routes
const api = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// Admin JWT or Service Key middleware — verifies Admin JWT with separate signing key,
// OR accepts service key for programmatic/server admin access
api.use('*', async (c, next) => {
  const config = parseConfig(c.env);

  // 1. Try service key first (allows admin SDK to access /admin/api/data/*)
  const explicitServiceKey =
    c.req.header('X-EdgeBase-Service-Key') ??
    c.req.header('x-edgebase-service-key') ??
    c.req.raw.headers.get('X-EdgeBase-Service-Key') ??
    c.req.raw.headers.get('x-edgebase-service-key');
  const provided = explicitServiceKey ?? resolveServiceKeyCandidate(c.req, extractBearerToken(c.req));

  if (provided !== undefined) {
    const { result } = validateKey(provided, 'auth:admin:*:*', config, c.env, undefined, buildConstraintCtx(c.env, c.req));
    if (result === 'valid') {
      // Valid service key — allow access
      await next();
      return;
    }

    // 2. Try Admin JWT
    const authHeader = c.req.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const secret = c.env.JWT_ADMIN_SECRET;
      if (secret) {
        try {
          const payload = await verifyAdminTokenWithFallback(
            token,
            secret,
            c.env.JWT_ADMIN_SECRET_OLD,
            c.env.JWT_ADMIN_SECRET_OLD_AT,
          );
          c.set('adminId' as never, payload.sub);
          await next();
          return;
        } catch {
          // fall through to 401
        }
      }
    }
  }

  throw new EdgeBaseError(401, 'Admin authentication required. Provide Admin JWT or Service Key.', undefined, 'unauthenticated');
});

// ─── Tables API ───

/** Parse config to get tables from databases block (§1). */
function getTables(env: Env): Array<{ name: string; namespace: string; fields: Record<string, unknown> }> {
  try {
    const config = parseConfig(env);
    const result: Array<{ name: string; namespace: string; fields: Record<string, unknown> }> = [];
    for (const [namespace, dbBlock] of Object.entries(config.databases ?? {})) {
      for (const [tableName, tableConfig] of Object.entries(dbBlock.tables ?? {})) {
        result.push({
          name: tableName,
          namespace,
          fields: tableConfig.schema ?? {},
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

/** Get the Database DO stub for a table (§1/§2). */
function findNamespaceForTable(tableName: string, config: ReturnType<typeof parseConfig>): string {
  for (const [ns, dbBlock] of Object.entries(config.databases ?? {})) {
    if (dbBlock.tables?.[tableName]) {
      return ns;
    }
  }
  return 'shared';
}

function getTableDO(env: Env, tableName: string, config: ReturnType<typeof parseConfig>, instanceId?: string) {
  const namespace = findNamespaceForTable(tableName, config);
  const doName = getDbDoName(namespace, instanceId);
  return { stub: env.DATABASE.get(env.DATABASE.idFromName(doName)), doName };
}

function isDynamicDbBlock(
  dbBlock: {
    instance?: boolean;
    access?: {
      canCreate?: unknown;
      access?: unknown;
    };
  } | undefined,
): boolean {
  if (!dbBlock) return false;
  return !!(dbBlock.instance || dbBlock.access?.canCreate || dbBlock.access?.access);
}

function getEffectiveDbProvider(namespace: string, config: ReturnType<typeof parseConfig>): 'do' | 'd1' | 'postgres' | 'neon' {
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) return 'do';
  if (dbBlock.provider === 'neon') {
    return 'neon';
  }
  if (dbBlock.provider === 'postgres') {
    return 'postgres';
  }
  if (dbBlock.provider === 'do' || dbBlock.provider === 'd1') {
    return dbBlock.provider;
  }
  return shouldRouteToD1(namespace, config) ? 'd1' : 'do';
}

function getRequestedInstanceId(c: { req: { query: (name: string) => string | undefined } }): string | undefined {
  const raw = c.req.query('instanceId');
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateAdminTableInstanceId(
  namespace: string,
  config: ReturnType<typeof parseConfig>,
  instanceId: string | undefined,
): Response | null {
  const dynamic = isDynamicDbBlock(config.databases?.[namespace]);
  if (!instanceId) {
    if (dynamic) {
      return new Response(
        JSON.stringify({
          code: 400,
          message: `instanceId is required for dynamic namespace '${namespace}'`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return null;
  }

  if (instanceId.includes(':')) {
    return new Response(
      JSON.stringify({
        code: 400,
        message: 'instanceId must not contain \':\'',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  return null;
}

async function restoreAdminNamespaceTables(
  env: Env,
  config: ReturnType<typeof parseConfig>,
  body: {
    namespace: string;
    tables: Record<string, Array<Record<string, unknown>>>;
    skipWipe?: boolean;
  },
): Promise<void> {
  const dbBlock = config.databases?.[body.namespace];
  if (!dbBlock) throw new EdgeBaseError(404, `Namespace '${body.namespace}' not found in config.`, undefined, 'not-found');

  const userTableNames = Object.keys(dbBlock.tables ?? {});
  const provider = dbBlock.provider;
  const batchSize = 100;

  if (provider === 'neon' || provider === 'postgres') {
    const bindingName = getProviderBindingName(body.namespace);
    const envRecord = env as unknown as Record<string, unknown>;
    const hyperdrive = envRecord[bindingName] as { connectionString: string } | undefined;
    const envKey = dbBlock.connectionString ?? `${bindingName}_URL`;
    const connStr = hyperdrive?.connectionString ?? (envRecord[envKey] as string | undefined);
    if (!connStr) {
      throw new EdgeBaseError(500, `PostgreSQL connection not available for '${body.namespace}'.`, undefined, 'internal-error');
    }

    const localDevOptions = getLocalDevPostgresExecOptions(env as unknown as Record<string, unknown>, body.namespace);
    if (localDevOptions) {
      await ensureLocalDevPostgresSchema(localDevOptions);
    }
    await withPostgresConnection(connStr, async (query) => {
      if (!localDevOptions) {
        await ensurePgSchema(connStr, body.namespace, dbBlock.tables ?? {}, query);
      }

      if (!body.skipWipe) {
        for (const tableName of [...userTableNames, '_meta']) {
          try {
            await query(`DELETE FROM "${tableName}"`, []);
          } catch {
            // Table may not exist yet.
          }
        }
      }

      for (const tableName of [...userTableNames, '_meta']) {
        const rows = body.tables[tableName];
        if (!rows || rows.length === 0) continue;

        const escId = (name: string) => `"${name.replace(/"/g, '""')}"`;
        for (const row of rows) {
          const columns = Object.keys(row);
          const columnList = columns.map((col) => escId(col)).join(', ');
          const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
          const values = columns.map((col) => row[col]);
          await query(
            `INSERT INTO ${escId(tableName)} (${columnList}) VALUES (${placeholders})`,
            values,
          );
        }
      }

      for (const tableName of userTableNames) {
        try {
          await query(
            `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(CAST(id AS BIGINT)) FROM "${tableName}"), 0) + 1, false)`,
            [],
          );
        } catch {
          // Sequence may not exist for this table.
        }
      }
    }, localDevOptions);
    return;
  }

  if (!shouldRouteToD1(body.namespace, config)) {
    throw new EdgeBaseError(400, `Namespace '${body.namespace}' is not restorable via the admin data backup API.`, undefined, 'validation-failed');
  }

  const bindingName = getD1BindingName(body.namespace);
  const db = (env as unknown as Record<string, unknown>)[bindingName] as D1Database | undefined;
  if (!db) {
    throw new EdgeBaseError(500, `D1 binding '${bindingName}' not available for '${body.namespace}'.`, undefined, 'internal-error');
  }

  await ensureD1Schema(db, body.namespace, dbBlock.tables ?? {});

  if (!body.skipWipe) {
    const wipeStmts = [...userTableNames, '_meta'].map((tableName) => db.prepare(`DELETE FROM "${tableName}"`));
    if (wipeStmts.length > 0) {
      await db.batch(wipeStmts);
    }
  }

  for (const tableName of [...userTableNames, '_meta']) {
    const rows = body.tables[tableName];
    if (!rows || rows.length === 0) continue;

    const escId = (name: string) => `"${name.replace(/"/g, '""')}"`;
    const insertStmts: D1PreparedStatement[] = [];
    for (const row of rows) {
      const columns = Object.keys(row);
      const columnList = columns.map((col) => escId(col)).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const values = columns.map((col) => row[col]);
      insertStmts.push(
        db.prepare(
          `INSERT OR REPLACE INTO ${escId(tableName)} (${columnList}) VALUES (${placeholders})`,
        ).bind(...values),
      );
    }

    for (let index = 0; index < insertStmts.length; index += batchSize) {
      await db.batch(insertStmts.slice(index, index + batchSize));
    }
  }
}

// GET /admin/api/data/tables — list all tables from config
const adminListTables = createRoute({
  operationId: 'adminListTables',
  method: 'get',
  path: '/tables',
  tags: ['admin'],
  summary: 'List all tables from config',
  responses: {
    200: { description: 'Tables list', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminListTables, (c) => {
  const tables = getTables(c.env);
  return c.json({ tables: tables.map((col) => ({ name: col.name, namespace: col.namespace, fieldCount: Object.keys(col.fields).length })) });
});

/** Build DO URL with whitelisted query params passthrough.
 *  Uses QUERY_PARAM_KEYS — adding a key there auto-forwards it here. */
function buildDoUrl(basePath: string, incomingUrl: string): URL {
  const incoming = new URL(incomingUrl).searchParams;
  const url = new URL(`http://internal${basePath}`);
  for (const key of QUERY_PARAM_KEYS) {
    const val = incoming.get(key);
    if (val) url.searchParams.set(key, val);
  }
  return url;
}

// GET /admin/api/data/tables/:name/records — list records with pagination (#133 §32)
const adminGetTableRecords = createRoute({
  operationId: 'adminGetTableRecords',
  method: 'get',
  path: '/tables/{name}/records',
  tags: ['admin'],
  summary: 'List table records with pagination',
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: { description: 'Records list', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetTableRecords, async (c) => {
  const name = c.req.param('name')!;
  const config = parseConfig(c.env);
  const namespace = findNamespaceForTable(name, config);
  const instanceId = isDynamicDbBlock(config.databases?.[namespace]) ? getRequestedInstanceId(c) : undefined;
  const instanceError = validateAdminTableInstanceId(namespace, config, instanceId);
  if (instanceError) return instanceError;

  // D1 route: handle directly in Worker context
  if (!instanceId && shouldRouteToD1(namespace, config)) {
    // Inject service-key header for admin bypass
    c.set('isServiceKey' as never, true);
    return handleD1Request(c, namespace, name, `/tables/${name}`);
  }

  const provider = config.databases?.[namespace]?.provider;
  if (provider === 'neon' || provider === 'postgres') {
    c.set('isServiceKey' as never, true);
    return handlePgRequest(c, namespace, name, `/tables/${name}`);
  }

  const { stub, doName } = getTableDO(c.env, name, config, instanceId);
  const url = buildDoUrl(`/tables/${name}`, c.req.url);

  const resp = await fetchDOWithRetry(stub, url.toString(), {
    method: 'GET',
    headers: { 'X-DO-Name': doName, 'x-internal': 'true' },
  }, { safeToRetry: true });
  const data = await resp.json();
  return c.json(data, resp.status as 200);
});


// POST /admin/api/data/tables/:name/records — create record (#133 §32)
// Admin requests are already authenticated — bypass row-level rules via X-Is-Service-Key.
const adminCreateTableRecord = createRoute({
  operationId: 'adminCreateTableRecord',
  method: 'post',
  path: '/tables/{name}/records',
  tags: ['admin'],
  summary: 'Create a table record',
  request: {
    params: z.object({ name: z.string() }),
    body: {
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
      required: true,
    },
  },
  responses: {
    200: { description: 'Record created', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminCreateTableRecord, async (c) => {
  const name = c.req.param('name')!;
  const config = parseConfig(c.env);
  const namespace = findNamespaceForTable(name, config);
  const instanceId = isDynamicDbBlock(config.databases?.[namespace]) ? getRequestedInstanceId(c) : undefined;
  const instanceError = validateAdminTableInstanceId(namespace, config, instanceId);
  if (instanceError) return instanceError;

  if (!instanceId && shouldRouteToD1(namespace, config)) {
    c.set('isServiceKey' as never, true);
    return handleD1Request(c, namespace, name, `/tables/${name}`);
  }

  const provider = config.databases?.[namespace]?.provider;
  if (provider === 'neon' || provider === 'postgres') {
    c.set('isServiceKey' as never, true);
    return handlePgRequest(c, namespace, name, `/tables/${name}`);
  }

  const body = await c.req.json();
  const { stub, doName } = getTableDO(c.env, name, config, instanceId);

  const resp = await fetchDOWithRetry(stub, `http://internal/tables/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DO-Name': doName, 'x-internal': 'true', 'X-Is-Service-Key': 'true' },
    body: JSON.stringify(body),
  }, { safeToRetry: false });
  const data = await resp.json();
  return c.json(data, resp.status as 200);
});


// PUT /admin/api/data/tables/:name/records/:id — update record (#133 §32)
// Admin dashboard sends PUT, but DO only has PATCH handler (database-do.ts:683).
// We accept PUT from the client and forward as PATCH to the DO.
const adminUpdateTableRecord = createRoute({
  operationId: 'adminUpdateTableRecord',
  method: 'put',
  path: '/tables/{name}/records/{id}',
  tags: ['admin'],
  summary: 'Update a table record',
  request: {
    params: z.object({ name: z.string(), id: z.string() }),
    body: {
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
      required: true,
    },
  },
  responses: {
    200: { description: 'Record updated', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminUpdateTableRecord, async (c) => {
  const name = c.req.param('name')!;
  const id = c.req.param('id')!;
  const config = parseConfig(c.env);
  const namespace = findNamespaceForTable(name, config);
  const instanceId = isDynamicDbBlock(config.databases?.[namespace]) ? getRequestedInstanceId(c) : undefined;
  const instanceError = validateAdminTableInstanceId(namespace, config, instanceId);
  if (instanceError) return instanceError;

  if (!instanceId && shouldRouteToD1(namespace, config)) {
    c.set('isServiceKey' as never, true);
    return handleD1Request(c, namespace, name, `/tables/${name}/${id}`);
  }

  const provider = config.databases?.[namespace]?.provider;
  if (provider === 'neon' || provider === 'postgres') {
    c.set('isServiceKey' as never, true);
    return handlePgRequest(c, namespace, name, `/tables/${name}/${id}`);
  }

  const body = await c.req.json();
  const { stub, doName } = getTableDO(c.env, name, config, instanceId);

  const resp = await fetchDOWithRetry(stub, `http://internal/tables/${name}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-DO-Name': doName, 'x-internal': 'true', 'X-Is-Service-Key': 'true' },
    body: JSON.stringify(body),
  }, { safeToRetry: false });
  const data = await resp.json();
  return c.json(data, resp.status as 200);
});


// DELETE /admin/api/data/tables/:name/records/:id — delete record (#133 §32)
const adminDeleteTableRecord = createRoute({
  operationId: 'adminDeleteTableRecord',
  method: 'delete',
  path: '/tables/{name}/records/{id}',
  tags: ['admin'],
  summary: 'Delete a table record',
  request: {
    params: z.object({ name: z.string(), id: z.string() }),
  },
  responses: {
    200: { description: 'Record deleted', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminDeleteTableRecord, async (c) => {
  const name = c.req.param('name')!;
  const id = c.req.param('id')!;
  const config = parseConfig(c.env);
  const namespace = findNamespaceForTable(name, config);
  const instanceId = isDynamicDbBlock(config.databases?.[namespace]) ? getRequestedInstanceId(c) : undefined;
  const instanceError = validateAdminTableInstanceId(namespace, config, instanceId);
  if (instanceError) return instanceError;

  if (!instanceId && shouldRouteToD1(namespace, config)) {
    c.set('isServiceKey' as never, true);
    return handleD1Request(c, namespace, name, `/tables/${name}/${id}`);
  }

  const provider = config.databases?.[namespace]?.provider;
  if (provider === 'neon' || provider === 'postgres') {
    c.set('isServiceKey' as never, true);
    return handlePgRequest(c, namespace, name, `/tables/${name}/${id}`);
  }

  const { stub, doName } = getTableDO(c.env, name, config, instanceId);

  const resp = await fetchDOWithRetry(stub, `http://internal/tables/${name}/${id}`, {
    method: 'DELETE',
    headers: { 'X-DO-Name': doName, 'x-internal': 'true', 'X-Is-Service-Key': 'true' },
  }, { safeToRetry: false });
  const data = await resp.json();
  return c.json(data, resp.status as 200);
});


// ─── Users API ───

// GET /admin/api/data/users — list users via D1 index
const adminListUsers = createRoute({
  operationId: 'adminListUsers',
  method: 'get',
  path: '/users',
  tags: ['admin'],
  summary: 'List users via D1 index',
  responses: {
    200: { description: 'Users list', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminListUsers, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const { limit, offset } = parsePagination(c.req.query('limit'), c.req.query('cursor'));
  const emailQuery = c.req.query('email') || '';

  let result;
  if (emailQuery) {
    result = await searchUserMappingsByEmail(getAuthDb(c), emailQuery, limit, offset);
  } else {
    result = await listUserMappings(getAuthDb(c), limit, offset);
  }
  const { mappings, total } = result;

  if (mappings.length === 0) return c.json({ users: [], cursor: null, total: 0 });

  // Fetch full user details from D1 directly
  const userIds = mappings.map(m => m.userId);
  const users = await authService.batchGetUsers(getAuthDb(c), userIds);
  const usersById = new Map(users.map((user) => [String(user.id ?? ''), user]));
  const sanitized = userIds
    .map((userId) => usersById.get(userId))
    .filter((user): user is Record<string, unknown> => !!user)
    .map((user) => authService.sanitizeUser(user, { includeAppMetadata: true }));

  const hasMore = total > offset + limit;
  return c.json({ users: sanitized, cursor: hasMore ? String(offset + limit) : null, total });
});

// GET /admin/api/data/users/:id — fetch a single user's auth info
const adminGetUser = createRoute({
  operationId: 'adminGetUser',
  method: 'get',
  path: '/users/{id}',
  tags: ['admin'],
  summary: 'Fetch a single user by ID',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'User data', content: { 'application/json': { schema: jsonResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminGetUser, async (c) => {
  const userId = c.req.param('id')!;
  const user = await authService.getUserById(getAuthDb(c), userId);
  if (!user) return c.json({ code: 404, message: 'User not found.' }, 404);
  return c.json({ user: authService.sanitizeUser(user, { includeAppMetadata: true }) });
});

// PUT /admin/api/data/users/:id — update user status/role
const adminUpdateUser = createRoute({
  operationId: 'adminUpdateUser',
  method: 'put',
  path: '/users/{id}',
  tags: ['admin'],
  summary: 'Update user status or role',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
      required: true,
    },
  },
  responses: {
    200: { description: 'User updated', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminUpdateUser, async (c) => {
  const userId = c.req.param('id')!;
  const body = await c.req.json() as Record<string, unknown>;
  const normalized = await normalizeAdminUserUpdates(body);
  const user = await updateManagedAdminUser(getAuthDb(c), userId, normalized as Record<string, unknown>, {
    executionCtx: c.executionCtx,
    kv: c.env.KV,
  });
  if (!user) return c.json({ code: 404, message: 'User not found.' }, 404);
  return c.json({ user: authService.sanitizeUser(user, { includeAppMetadata: true }) });
});

// GET /admin/api/data/users/:id/profile — fetch any user profile with 3-tier cache
const adminGetUserProfile = createRoute({
  operationId: 'adminGetUserProfile',
  method: 'get',
  path: '/users/{id}/profile',
  tags: ['admin'],
  summary: 'Fetch user profile with cache',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'User profile', content: { 'application/json': { schema: jsonResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminGetUserProfile, async (c) => {
  const userId = c.req.param('id');
  if (!userId) {
    throw new EdgeBaseError(400, 'User ID is required.', undefined, 'validation-failed');
  }

  const profile = await getPublicProfileWithCache(userId, c.env, c.executionCtx);

  if (!profile) {
    throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  }

  return c.json(profile);
});

// DELETE /admin/api/data/users/:id/sessions — revoke all user sessions
const adminDeleteUserSessions = createRoute({
  operationId: 'adminDeleteUserSessions',
  method: 'delete',
  path: '/users/{id}/sessions',
  tags: ['admin'],
  summary: 'Revoke all user sessions',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'Sessions revoked', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminDeleteUserSessions, async (c) => {
  const userId = c.req.param('id')!;
  await authService.deleteAllUserSessions(getAuthDb(c), userId);
  return c.json({ ok: true, message: 'All sessions revoked.' });
});

// ─── Anon Index D1 Cleanup ───

// POST /admin/api/data/cleanup-anon — process KV-signaled _anon_index D1 cleanup
const adminCleanupAnon = createRoute({
  operationId: 'adminCleanupAnon',
  method: 'post',
  path: '/cleanup-anon',
  tags: ['admin'],
  summary: 'Cleanup anonymous user index',
  responses: {
    200: { description: 'Cleanup result', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminCleanupAnon, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const config = parseConfig(c.env);
  const retentionDays = config?.auth?.anonymousRetentionDays ?? 30;

  const deletedIds = await authService.cleanStaleAnonymousAccounts(getAuthDb(c), retentionDays);

  // Clean D1 indexes
  for (const id of deletedIds) {
    await deleteAnon(getAuthDb(c), id).catch(() => {});
  }

  return c.json({ ok: true, cleaned: deletedIds.length });
});

// ─── Storage API ───

// GET /admin/api/data/storage/buckets — list configured buckets
const adminListBuckets = createRoute({
  operationId: 'adminListBuckets',
  method: 'get',
  path: '/storage/buckets',
  tags: ['admin'],
  summary: 'List configured storage buckets',
  responses: {
    200: { description: 'Buckets list', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminListBuckets, (c) => {
  try {
    const config = parseConfig(c.env);
    const buckets = Object.keys(config?.storage?.buckets || {});
    return c.json({ buckets });
  } catch {
    return c.json({ buckets: [] });
  }
});

// GET /admin/api/data/storage/buckets/:name/objects — list objects in a bucket
const adminListBucketObjects = createRoute({
  operationId: 'adminListBucketObjects',
  method: 'get',
  path: '/storage/buckets/{name}/objects',
  tags: ['admin'],
  summary: 'List objects in a storage bucket',
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: { description: 'Objects list', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminListBucketObjects, async (c) => {
  const bucketName = c.req.param('name');
  const userPrefix = c.req.query('prefix') || '';
  const delimiter = c.req.query('delimiter') || '';
  const prefix = `${bucketName}/${userPrefix}`;
  const cursor = c.req.query('cursor');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const listOptions: R2ListOptions = { prefix, limit, include: ['httpMetadata'] };
  if (cursor) listOptions.cursor = cursor;
  if (delimiter) listOptions.delimiter = delimiter;

  const result = await c.env.STORAGE.list(listOptions);
  const objects = result.objects.map((obj) => ({
    key: obj.key.replace(`${bucketName}/`, ''),
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
    httpMetadata: obj.httpMetadata,
  }));

  // Extract folder names from delimited prefixes
  const folders = (result.delimitedPrefixes || []).map((p: string) => p.replace(`${bucketName}/`, ''));

  return c.json({
    objects,
    folders,
    cursor: result.truncated ? result.cursor : null,
  });
});

// GET /admin/api/data/storage/buckets/:name/objects/:key — get object content (for preview)
const adminGetBucketObject = createRoute({
  operationId: 'adminGetBucketObject',
  method: 'get',
  path: '/storage/buckets/{name}/objects/{key}',
  tags: ['admin'],
  summary: 'Get a storage object content',
  request: {
    params: z.object({ name: z.string(), key: z.string() }),
  },
  responses: {
    200: { description: 'Object content' },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminGetBucketObject, async (c) => {
  const bucketName = c.req.param('name')!;
  const key = decodeURIComponent(c.req.param('key')!);
  const fullKey = `${bucketName}/${key}`;
  const obj = await c.env.STORAGE.get(fullKey);
  if (!obj) throw new EdgeBaseError(404, 'Object not found.', undefined, 'not-found');
  const headers = new Headers();
  if (obj.httpMetadata?.contentType) headers.set('Content-Type', obj.httpMetadata.contentType);
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
});

// DELETE /admin/api/data/storage/buckets/:name/objects/:key+ — delete an object
const adminDeleteBucketObject = createRoute({
  operationId: 'adminDeleteBucketObject',
  method: 'delete',
  path: '/storage/buckets/{name}/objects/{key}',
  tags: ['admin'],
  summary: 'Delete a storage object',
  request: {
    params: z.object({ name: z.string(), key: z.string() }),
  },
  responses: {
    200: { description: 'Object deleted', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminDeleteBucketObject, async (c) => {
  const bucketName = c.req.param('name');
  const key = c.req.param('key');
  const fullKey = `${bucketName}/${key}`;

  await c.env.STORAGE.delete(fullKey);
  return c.json({ ok: true, deleted: fullKey });
});

// GET /admin/api/data/storage/buckets/:name/stats — bucket statistics
const adminGetBucketStats = createRoute({
  operationId: 'adminGetBucketStats',
  method: 'get',
  path: '/storage/buckets/{name}/stats',
  tags: ['admin'],
  summary: 'Get bucket statistics (total objects and size)',
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: { description: 'Bucket stats', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetBucketStats, async (c) => {
  const bucketName = c.req.param('name');
  let totalObjects = 0;
  let totalSize = 0;
  let listCursor: string | undefined;

  do {
    const listOptions: R2ListOptions = { prefix: `${bucketName}/`, limit: 1000 };
    if (listCursor) listOptions.cursor = listCursor;
    const result = await c.env.STORAGE.list(listOptions);
    for (const obj of result.objects) {
      totalObjects++;
      totalSize += obj.size;
    }
    listCursor = result.truncated ? result.cursor : undefined;
  } while (listCursor);

  return c.json({ totalObjects, totalSize });
});

// POST /admin/api/data/storage/buckets/:name/signed-url — create signed download URL
const adminCreateSignedUrl = createRoute({
  operationId: 'adminCreateSignedUrl',
  method: 'post',
  path: '/storage/buckets/{name}/signed-url',
  tags: ['admin'],
  summary: 'Create a signed download URL for a storage object',
  request: {
    params: z.object({ name: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string(),
            expiresIn: z.string().optional(),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Signed URL created', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    500: { description: 'Server error', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminCreateSignedUrl, async (c) => {
  const bucketName = c.req.param('name')!;
  const body = await c.req.json<{ key: string; expiresIn?: string }>();

  if (!body.key) {
    throw new EdgeBaseError(400, 'Missing required field: key.', undefined, 'validation-failed');
  }

  // Check file exists
  const fullKey = `${bucketName}/${body.key}`;
  const obj = await c.env.STORAGE.head(fullKey);
  if (!obj) {
    throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
  }

  const secret = c.env.JWT_USER_SECRET;
  if (!secret) {
    throw new EdgeBaseError(500, 'Signed URLs require JWT_USER_SECRET to be configured.', undefined, 'internal-error');
  }

  const expiresInMs = parseDuration(body.expiresIn || '1h');
  const expiresAt = Date.now() + expiresInMs;
  const token = await createSignedToken(body.key, bucketName, expiresAt, secret);

  // Build signed URL using the public storage endpoint
  const url = new URL(c.req.url);
  const signedUrl = `${url.protocol}//${url.host}/api/storage/${bucketName}/${body.key}?token=${token}`;

  return c.json({
    url: signedUrl,
    expiresAt: new Date(expiresAt).toISOString(),
  });
});

// ─── Schema API ───

// GET /admin/api/data/schema — full schema structure from config
const adminGetSchema = createRoute({
  operationId: 'adminGetSchema',
  method: 'get',
  path: '/schema',
  tags: ['admin'],
  summary: 'Get full schema structure from config',
  responses: {
    200: { description: 'Schema', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetSchema, (c) => {
  try {
    const config = parseConfig(c.env);
    const schema: Record<string, unknown> = {};
    const namespaces: Record<string, unknown> = {};

    for (const [namespace, dbBlock] of Object.entries(config.databases ?? {})) {
      const provider = getEffectiveDbProvider(namespace, config);
      const dynamic = isDynamicDbBlock(dbBlock);
      const instanceDiscovery = serializeAdminInstanceDiscovery(dbBlock.admin?.instances, {
        fallbackManual: dynamic,
      });
      namespaces[namespace] = {
        provider,
        dynamic,
        instanceDiscovery,
      };
      for (const [tableName, tableConfig] of Object.entries(dbBlock.tables ?? {})) {
        schema[tableName] = {
          namespace,
          provider,
          dynamic,
          instanceDiscovery,
          fields: tableConfig.schema || {},
          indexes: tableConfig.indexes || [],
          fts: tableConfig.fts || [],
        };
      }
    }

    return c.json({ schema, namespaces });
  } catch {
    return c.json({ schema: {}, namespaces: {} });
  }
});

const adminListNamespaceInstances = createRoute({
  operationId: 'adminListNamespaceInstances',
  method: 'get',
  path: '/namespaces/{namespace}/instances',
  tags: ['admin'],
  summary: 'List instance suggestions for a dynamic namespace',
  request: {
    params: z.object({ namespace: z.string() }),
    query: z.object({
      q: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: { description: 'Instance suggestions', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminListNamespaceInstances, async (c) => {
  const namespace = c.req.param('namespace')!;
  const config = parseConfig(c.env);
  if (!config.databases?.[namespace]) {
    throw new EdgeBaseError(404, `Namespace not found: ${namespace}`, undefined, 'not-found');
  }

  try {
    const resolved = await resolveAdminInstanceOptions({
      env: c.env,
      config,
      namespace,
      query: c.req.query('q') ?? '',
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    });
    return c.json(resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resolve instance suggestions';
    if (message.includes('not dynamic')) {
      throw new EdgeBaseError(400, message, undefined, 'validation-failed');
    }
    throw new EdgeBaseError(400, message, undefined, 'validation-failed');
  }
});

// GET /admin/api/data/tables/:name/export?format=json (#133 §32)
// Exports table data as JSON array.
// In DB-block architecture (#133 §1), all tables share namespace-level DO isolation.
const adminExportTable = createRoute({
  operationId: 'adminExportTable',
  method: 'get',
  path: '/tables/{name}/export',
  tags: ['admin'],
  summary: 'Export table data as JSON',
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: { description: 'Exported data', content: { 'application/json': { schema: jsonResponseSchema } } },
    404: { description: 'Table not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminExportTable, async (c) => {
  const name = c.req.param('name')!;
  const format = c.req.query('format') || 'json';

  if (format !== 'json') {
    throw new EdgeBaseError(400, `Unsupported export format: ${format}. Only "json" is supported.`, undefined, 'validation-failed');
  }

  // Validate table exists in config
  const allTables = getTables(c.env);
  const tableInfo = allTables.find((col) => col.name === name);
  if (!tableInfo) {
    throw new EdgeBaseError(404, `Table not found: ${name}`, undefined, 'not-found');
  }

  const config = parseConfig(c.env);

  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="${name}-export.json"`,
  };

  const records = (await dumpNamespaceTables(c.env, config, tableInfo.namespace, {
    includeMeta: false,
    tableNames: [name],
  }))[name] || [];

  return new Response(JSON.stringify(records, null, 2), { headers: responseHeaders });
});


// ─── Logs API ───

// GET /admin/api/data/logs — request logs (from KV, M10 logger)
const adminGetLogs = createRoute({
  operationId: 'adminGetLogs',
  method: 'get',
  path: '/logs',
  tags: ['admin'],
  summary: 'Get request logs',
  responses: {
    200: { description: 'Logs', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetLogs, async (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const prefix = c.req.query('prefix') || 'log:';
  const level = c.req.query('level') || '';
  const pathFilter = c.req.query('path') || '';
  const category = c.req.query('category') || '';

  try {
    const doLogs = await fetchRecentLogsFromDo(c.env, { limit, level, pathFilter, category });
    if (doLogs !== null) {
      return c.json({ logs: doLogs, cursor: null });
    }

    const list = await c.env.KV.list({ prefix, limit });
    let logs: Array<Record<string, unknown>> = [];

    for (const key of list.keys) {
      const value = await c.env.KV.get(key.name, 'json');
      if (value) logs.push(value as Record<string, unknown>);
    }

    if (level) {
      logs = logs.filter((log) => matchesLogLevel(getLogStatusCode(log), level));
    }

    if (pathFilter) {
      logs = logs.filter((log) => String(log.path ?? '').includes(pathFilter));
    }

    if (category) {
      logs = logs.filter((log) => String(log.category ?? '').toLowerCase() === category.toLowerCase());
    }

    return c.json({ logs, cursor: list.list_complete ? null : list.cursor });
  } catch {
    return c.json({ logs: [], cursor: null });
  }
});

// ─── Monitoring API ───

// GET /admin/api/data/monitoring — live monitoring stats
const adminGetMonitoring = createRoute({
  operationId: 'adminGetMonitoring',
  method: 'get',
  path: '/monitoring',
  tags: ['admin'],
  summary: 'Get live monitoring stats',
  responses: {
    200: { description: 'Monitoring stats', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetMonitoring, async (c) => {
  return c.json(await fetchUnifiedMonitoringStats(c.env));
});

// ─── Analytics API ───

// GET /admin/api/data/analytics — analytics dashboard data
const adminGetAnalytics = createRoute({
  operationId: 'adminGetAnalytics',
  method: 'get',
  path: '/analytics',
  tags: ['admin'],
  summary: 'Get analytics dashboard data',
  request: {
    query: z.object({
      range: z.string().optional().openapi({ description: 'Time range (e.g. 1h, 6h, 24h, 7d, 30d)', example: '24h' }),
      category: z.string().optional().openapi({ description: 'Filter by category', example: 'db' }),
      metric: z.string().optional().openapi({ description: 'Metric type (overview, timeSeries, breakdown, topEndpoints)', example: 'overview' }),
      groupBy: z.string().optional().openapi({ description: 'Optional group-by override (minute, tenMinute, hour, day)', example: 'hour' }),
      start: z.string().optional().openapi({ description: 'Custom ISO start time' }),
      end: z.string().optional().openapi({ description: 'Custom ISO end time' }),
      excludeCategory: z.string().optional().openapi({ description: 'Exclude a category from the result set', example: 'admin' }),
    }),
  },
  responses: {
    200: { description: 'Analytics data', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetAnalytics, async (c) => {
  const range = c.req.query('range') || '24h';
  const category = c.req.query('category') || '';
  const metric = c.req.query('metric') || 'overview';
  const start = c.req.query('start') || undefined;
  const end = c.req.query('end') || undefined;
  const excludeCategory = c.req.query('excludeCategory') || undefined;

  const { executeAnalyticsQuery, resolveAnalyticsGroupBy } = await import('../lib/analytics-query.js');
  const groupBy = resolveAnalyticsGroupBy(range, start, end, c.req.query('groupBy') || undefined);

  const result = await executeAnalyticsQuery(c.env, { range, category, metric, groupBy, start, end, excludeCategory });
  return c.json(result);
});

// GET /admin/api/data/analytics/events — proxy custom events query for admin dashboard
const adminGetAnalyticsEvents = createRoute({
  operationId: 'adminGetAnalyticsEvents',
  method: 'get',
  path: '/analytics/events',
  tags: ['admin'],
  summary: 'Query analytics events for admin dashboard',
  responses: {
    200: { description: 'Events data', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetAnalyticsEvents, async (c) => {
  const range = c.req.query('range') || '24h';
  const type = c.req.query('type') || '';
  const userId = c.req.query('userId') || '';
  const metric = c.req.query('metric') || 'list';
  const groupBy = c.req.query('groupBy') || 'hour';
  const limit = c.req.query('limit') || '100';
  const cursor = c.req.query('cursor') || '';

  if (!c.env.LOGS) {
    if (metric === 'list') return c.json({ events: [], cursor: undefined, hasMore: false });
    if (metric === 'count') return c.json({ totalEvents: 0, uniqueUsers: 0 });
    if (metric === 'timeSeries') return c.json({ timeSeries: [] });
    if (metric === 'topEvents') return c.json({ topEvents: [] });
    return c.json({ events: [] });
  }

  const logsDO = c.env.LOGS.get(c.env.LOGS.idFromName('logs:main'));
  const params = new URLSearchParams({ range, metric, groupBy, limit });
  if (type && type !== 'all') params.set('event', type);
  if (userId) params.set('userId', userId);
  if (cursor) params.set('cursor', cursor);

  const resp = await logsDO.fetch(
    new Request(`http://internal/internal/events/query?${params}`),
  );
  const data = await resp.json();
  return c.json(data);
});

// ─── Overview API ───

// GET /admin/api/data/overview — project overview for dashboard home
const adminGetOverview = createRoute({
  operationId: 'adminGetOverview',
  method: 'get',
  path: '/overview',
  tags: ['admin'],
  summary: 'Get project overview for dashboard home',
  request: {
    query: z.object({
      range: z.string().optional().openapi({ description: 'Time range (e.g. 1h, 6h, 24h, 7d, 30d)', example: '24h' }),
      groupBy: z.string().optional().openapi({ description: 'Optional group-by override (minute, tenMinute, hour, day)', example: 'hour' }),
    }),
  },
  responses: {
    200: { description: 'Overview data', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetOverview, async (c) => {
  const { executeAnalyticsQuery, resolveAnalyticsGroupBy, resolveOverviewAutoRange } = await import('../lib/analytics-query.js');
  const requestedRange = c.req.query('range');
  const effectiveRange =
    requestedRange === '1h' || requestedRange === '6h' || requestedRange === '24h'
      ? requestedRange
      : await resolveOverviewAutoRange(c.env);
  const groupBy = resolveAnalyticsGroupBy(effectiveRange, undefined, undefined, c.req.query('groupBy') || undefined);

  const [userCountResult, configResult, analyticsResult, liveStatsResult] = await Promise.allSettled([
    // User count from D1
    (async () => {
      await ensureAuthSchema(getAuthDb(c));
      return countUsers(getAuthDb(c));
    })(),
    // Config info (tables, buckets, auth providers)
    (async () => {
      const config = parseConfig(c.env);
      const databases = Object.entries(config.databases ?? {}).map(([name, db]) => ({
        name,
        tableCount: Object.keys(db.tables ?? {}).length,
      }));
      const totalTables = databases.reduce((sum, db) => sum + db.tableCount, 0);
      const storageConfig = config.storage ?? {} as Record<string, unknown>;
      const buckets = Object.keys((storageConfig as Record<string, unknown>).buckets ?? {});
      const serviceKeys = config.serviceKeys ?? [];
      const serviceKeyCount = Array.isArray(serviceKeys) ? serviceKeys.length : 0;
      const authProviders = config.auth?.allowedOAuthProviders ?? [];
      const sidecarPort = c.env.EDGEBASE_DEV_SIDECAR_PORT;
      return {
        databases,
        totalTables,
        storageBuckets: buckets,
        serviceKeyCount,
        authProviders,
        devMode: !!sidecarPort,
      };
    })(),
    // Analytics summary
    executeAnalyticsQuery(c.env, { range: effectiveRange, category: '', metric: 'overview', groupBy }),
    fetchUnifiedMonitoringStats(c.env),
  ]);

  const totalUsers = userCountResult.status === 'fulfilled' ? userCountResult.value : 0;
  const config = configResult.status === 'fulfilled' ? configResult.value : {
    databases: [], totalTables: 0, storageBuckets: [], serviceKeyCount: 0, authProviders: [], devMode: false,
  };
  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : {
    summary: { totalRequests: 0, totalErrors: 0, avgLatency: 0, uniqueUsers: 0 },
    timeSeries: [],
    breakdown: [],
    topItems: [],
  };
  const live = liveStatsResult.status === 'fulfilled'
    ? liveStatsResult.value as { activeConnections: number; channels: number }
    : { activeConnections: 0, channels: 0 };

  return c.json({
    project: {
      totalUsers,
      totalTables: config.totalTables,
      databases: config.databases,
      storageBuckets: config.storageBuckets,
      serviceKeyCount: config.serviceKeyCount,
      authProviders: config.authProviders,
      liveConnections: live.activeConnections,
      liveChannels: live.channels,
      devMode: config.devMode,
    },
    traffic: {
      appliedRange: effectiveRange,
      summary: analytics.summary,
      timeSeries: analytics.timeSeries,
      breakdown: analytics.breakdown,
      topItems: analytics.topItems,
    },
  });
});

// ─── Dev Info API ───

// GET /admin/api/data/dev-info — returns dev mode status and sidecar port
const adminGetDevInfo = createRoute({
  operationId: 'adminGetDevInfo',
  method: 'get',
  path: '/dev-info',
  tags: ['admin'],
  summary: 'Get dev mode status and sidecar port',
  responses: {
    200: { description: 'Dev info', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetDevInfo, (c) => {
  const sidecarPort = c.env.EDGEBASE_DEV_SIDECAR_PORT;
  return c.json({
    devMode: !!sidecarPort,
    sidecarPort: sidecarPort ? parseInt(sidecarPort, 10) : null,
  });
});

// ─── SQL Console API ───

// POST /admin/api/data/sql — execute raw SQL via admin JWT (proxies to DatabaseDO)
const adminExecuteSql = createRoute({
  operationId: 'adminExecuteSql',
  method: 'post',
  path: '/sql',
  tags: ['admin'],
  summary: 'Execute raw SQL query',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            namespace: z.string(),
            id: z.string().optional(),
            sql: z.string(),
            params: z.array(z.unknown()).optional(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'SQL result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Namespace not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminExecuteSql, async (c) => {
  const body = await c.req.json<{ namespace: string; id?: string; sql: string; params?: unknown[] }>();
  if (!body.namespace || !body.sql) {
    throw new EdgeBaseError(400, 'namespace and sql are required.', undefined, 'validation-failed');
  }

  // ── Block destructive DDL statements in admin SQL Console ──
  const sqlUpper = body.sql.trim().replace(/\s+/g, ' ').toUpperCase();
  const destructivePatterns = [
    /^DROP\s+TABLE/,
    /^DROP\s+INDEX/,
    /^DROP\s+TRIGGER/,
    /^DROP\s+VIEW/,
    /^ALTER\s+TABLE\s+\S+\s+DROP/,
    /^TRUNCATE/,
    /^DELETE\s+FROM\s+\S+\s*$/,       // DELETE without WHERE clause
    /^DELETE\s+FROM\s+\S+\s*;?\s*$/,  // DELETE without WHERE (with optional semicolon)
  ];
  for (const pat of destructivePatterns) {
    if (pat.test(sqlUpper)) {
      throw new EdgeBaseError(400, `Destructive SQL blocked: "${body.sql.trim().split(/\s+/).slice(0, 3).join(' ')}..." is not allowed in the admin SQL Console. Use the Schema editor or CLI for DDL operations.`, undefined, 'forbidden');
    }
  }

  const config = parseConfig(c.env);
  const databases = config.databases ?? {};
  if (!databases[body.namespace]) {
    throw new EdgeBaseError(404, `Namespace not found: ${body.namespace}`, undefined, 'not-found');
  }

  // Validate id (no ':' allowed per)
  if (body.id && body.id.includes(':')) {
    throw new EdgeBaseError(400, 'Instance ID must not contain ":".', undefined, 'validation-failed');
  }

  const start = Date.now();
  try {
    const result = await executeAdminDbQuery({
      env: c.env,
      config,
      namespace: body.namespace,
      id: body.id,
      sql: body.sql,
      params: body.params ?? [],
    });
    const elapsed = Date.now() - start;
    return c.json({ ...result, time: elapsed });
  } catch (err) {
    const elapsed = Date.now() - start;
    return c.json({ code: 400, message: err instanceof Error ? err.message : 'SQL execution failed', time: elapsed }, 400);
  }
});

// ─── Batch Import API ───

// POST /admin/api/data/tables/:name/import — batch import records
const adminImportTable = createRoute({
  operationId: 'adminImportTable',
  method: 'post',
  path: '/tables/{name}/import',
  tags: ['admin'],
  summary: 'Batch import records into a table',
  request: {
    params: z.object({ name: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            records: z.array(z.record(z.string(), z.unknown())),
            mode: z.enum(['create', 'upsert']).optional(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Import result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminImportTable, async (c) => {
  const name = c.req.param('name')!;
  const body = await c.req.json<{ records: Record<string, unknown>[]; mode?: 'create' | 'upsert' }>();

  if (!Array.isArray(body.records) || body.records.length === 0) {
    throw new EdgeBaseError(400, 'records array is required and must not be empty.', undefined, 'validation-failed');
  }
  if (body.records.length > 1000) {
    throw new EdgeBaseError(400, 'Maximum 1000 records per import.', undefined, 'validation-failed');
  }

  const config = parseConfig(c.env);
  const namespace = findNamespaceForTable(name, config);
  const mode = body.mode ?? 'create';
  const upsert = mode === 'upsert' ? '?upsert=true' : '';

  // D1 route: insert directly via D1 batch API
  if (shouldRouteToD1(namespace, config)) {
    const result = await d1BatchImport(c.env, namespace, name, body.records, {
      upsert: mode === 'upsert',
    });
    return c.json({ imported: result.imported, errors: result.errors, total: body.records.length });
  }

  const { stub, doName } = getTableDO(c.env, name, config);

  let imported = 0;
  const errors: Array<{ row: number; message: string }> = [];

  // Batch create via DO (process in chunks of 50)
  const chunkSize = 50;
  for (let i = 0; i < body.records.length; i += chunkSize) {
    const chunk = body.records.slice(i, i + chunkSize);

    try {
      const resp = await stub.fetch(new Request(`http://internal/tables/${name}/batch${upsert}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DO-Name': doName, 'x-internal': 'true' },
        body: JSON.stringify({ inserts: chunk }),
      }));

      if (resp.ok) {
        imported += chunk.length;
      } else {
        const errData = await resp.json() as { message?: string };
        for (let j = 0; j < chunk.length; j++) {
          errors.push({ row: i + j, message: errData.message ?? 'Batch insert failed' });
        }
      }
    } catch (err) {
      for (let j = 0; j < chunk.length; j++) {
        errors.push({ row: i + j, message: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
  }

  return c.json({ imported, errors, total: body.records.length });
});

// ─── Rules Test API ───

// POST /admin/api/data/rules-test — evaluate access rules with simulated auth context
const adminRulesTest = createRoute({
  operationId: 'adminRulesTest',
  method: 'post',
  path: '/rules-test',
  tags: ['admin'],
  summary: 'Evaluate access rules with simulated auth context',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            namespace: z.string(),
            table: z.string(),
            auth: z.record(z.string(), z.unknown()).nullable(),
            record: z.record(z.string(), z.unknown()).optional(),
            operations: z.array(z.string()),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Rules test results', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminRulesTest, async (c) => {
  const body = await c.req.json<{
    namespace: string;
    table: string;
    auth: Record<string, unknown> | null;
    record?: Record<string, unknown>;
    operations: string[];
  }>();

  if (!body.namespace || !body.table || !body.operations?.length) {
    throw new EdgeBaseError(400, 'namespace, table, and operations are required.', undefined, 'validation-failed');
  }

  const config = parseConfig(c.env);
  const dbBlock = (config.databases ?? {})[body.namespace];
  if (!dbBlock) {
    throw new EdgeBaseError(404, `Namespace not found: ${body.namespace}`, undefined, 'not-found');
  }

  const tableConfig = dbBlock.tables?.[body.table];
  if (!tableConfig) {
    throw new EdgeBaseError(404, `Table not found: ${body.table}`, undefined, 'not-found');
  }

  const rules = getTableAccess(tableConfig) ?? {};
  const dbAccess = getDbAccess(dbBlock)?.access;
  const results: Array<{ operation: string; allowed: boolean; rule: string; error?: string }> = [];

  for (const op of body.operations) {
    try {
      if (op === 'access' && typeof dbAccess === 'function') {
        const stubCtx = { db: { get: async () => null, exists: async () => false } };
        const allowed = await dbAccess(body.auth as AuthContext | null, 'test', stubCtx);
        results.push({ operation: op, allowed: !!allowed, rule: 'databases.' + body.namespace + '.access.access()' });
      } else if (op === 'access') {
        results.push({ operation: op, allowed: true, rule: '(no access rule defined — allowed by default)' });
      } else {
        const ruleFn = (rules as Record<string, unknown>)[op];
        if (typeof ruleFn === 'function') {
          const allowed = await ruleFn(body.auth, body.record ?? {});
          results.push({ operation: op, allowed: !!allowed, rule: `rules.${op}()` });
        } else if (ruleFn === undefined) {
          // No rule defined — check release mode
          const release = config.release ?? false;
          results.push({
            operation: op,
            allowed: !release,
            rule: release ? '(no access rule defined — denied in release mode)' : '(no access rule defined — allowed in dev mode)',
          });
        } else {
          results.push({ operation: op, allowed: !!ruleFn, rule: `rules.${op} = ${String(ruleFn)}` });
        }
      }
    } catch (err) {
      results.push({
        operation: op,
        allowed: false,
        rule: `access.${op}()`,
        error: err instanceof Error ? err.message : 'Evaluation error',
      });
    }
  }

  return c.json({ results });
});

// ─── Functions List API ───

// GET /admin/api/data/functions — list registered functions from config
const adminListFunctions = createRoute({
  operationId: 'adminListFunctions',
  method: 'get',
  path: '/functions',
  tags: ['admin'],
  summary: 'List registered functions from config',
  responses: {
    200: { description: 'Functions list', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminListFunctions, (c) => {
  try {
    const config = parseConfig(c.env) as Record<string, unknown>;
    const functionsConfig = config.functions as Record<string, unknown> | undefined;
    const functions: Array<{ path: string; methods: string[]; type: string }> = [];

    if (functionsConfig && typeof functionsConfig === 'object') {
      // Extract function routes from config
      for (const [path, fn] of Object.entries(functionsConfig)) {
        if (typeof fn === 'object' && fn !== null) {
          const fnObj = fn as Record<string, unknown>;
          const methods = Array.isArray(fnObj.methods) ? fnObj.methods as string[] : ['POST'];
          const type = (fnObj.type as string) ?? 'endpoint';
          functions.push({ path, methods, type });
        }
      }
    }

    return c.json({ functions });
  } catch {
    return c.json({ functions: [] });
  }
});

// ─── Config Info API ───

// GET /admin/api/data/config-info — environment and config overview
const adminGetConfigInfo = createRoute({
  operationId: 'adminGetConfigInfo',
  method: 'get',
  path: '/config-info',
  tags: ['admin'],
  summary: 'Get environment and config overview',
  responses: {
    200: { description: 'Config info', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetConfigInfo, (c) => {
  try {
    const config = parseConfig(c.env);
    const sidecarPort = c.env.EDGEBASE_DEV_SIDECAR_PORT;
    const devMode = !!sidecarPort;

    const databases = Object.entries(config.databases ?? {}).map(([name, db]) => ({
      name,
      tableCount: Object.keys(db.tables ?? {}).length,
      hasAccess: !!db.access?.access,
    }));

    const storageConfig = config.storage ?? {} as Record<string, unknown>;
    const buckets = Object.keys((storageConfig as Record<string, unknown>).buckets ?? {});

    // Service keys — show masked preview for admin display
    const rawServiceKeys = config.serviceKeys ?? [];
    const serviceKeyList: string[] = Array.isArray(rawServiceKeys)
      ? rawServiceKeys.map((k: string) => {
          if (typeof k !== 'string' || k.length < 8) return '****';
          return k.slice(0, 8) + '•'.repeat(Math.min(k.length - 8, 24));
        })
      : [];
    const serviceKeyCount = serviceKeyList.length;

    // Native resources
    const kvNamespaces = Object.keys(config.kv ?? {});
    const d1Databases = Object.keys(config.d1 ?? {});
    const vectorizeIndexes = Object.keys(config.vectorize ?? {});
    const rateLimiting = buildRateLimitSummary(config);

    return c.json({
      devMode,
      release: config.release ?? false,
      databases,
      storageBuckets: buckets,
      serviceKeyCount,
      serviceKeys: serviceKeyList,
      bindings: {
        kv: kvNamespaces,
        d1: d1Databases,
        vectorize: vectorizeIndexes,
      },
      auth: {
        providers: config.auth?.allowedOAuthProviders ?? [],
        anonymousAuth: config.auth?.anonymousAuth ?? false,
      },
      rateLimiting,
    });
  } catch {
    return c.json({
      devMode: false,
      release: false,
      databases: [],
      storageBuckets: [],
      serviceKeyCount: 0,
      bindings: { kv: [], d1: [], vectorize: [] },
      auth: { providers: [], anonymousAuth: false },
      rateLimiting: [],
    });
  }
});

// ─── Recent Logs API (enhanced polling for real-time) ───

// GET /admin/api/data/logs/recent — recent request logs with filtering
const adminGetRecentLogs = createRoute({
  operationId: 'adminGetRecentLogs',
  method: 'get',
  path: '/logs/recent',
  tags: ['admin'],
  summary: 'Get recent request logs with filtering',
  responses: {
    200: { description: 'Recent logs', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetRecentLogs, async (c) => {
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const level = c.req.query('level') || '';
  const pathFilter = c.req.query('path') || '';
  const category = c.req.query('category') || '';

  try {
    const doLogs = await fetchRecentLogsFromDo(c.env, { limit, level, pathFilter, category });
    if (doLogs !== null) {
      return c.json({ logs: doLogs, total: doLogs.length });
    }

    const list = await c.env.KV.list({ prefix: 'log:', limit: Math.min(limit, 200) });
    let logs: Array<Record<string, unknown>> = [];

    for (const key of list.keys) {
      const value = await c.env.KV.get(key.name, 'json');
      if (value) logs.push(value as Record<string, unknown>);
    }

    // Apply filters
    if (level) {
      logs = logs.filter((log) => {
        return matchesLogLevel(getLogStatusCode(log), level);
      });
    }

    if (pathFilter) {
      logs = logs.filter((log) => String(log.path ?? '').includes(pathFilter));
    }

    if (category) {
      logs = logs.filter((log) => String(log.category ?? '').toLowerCase() === category.toLowerCase());
    }

    return c.json({ logs, total: logs.length });
  } catch {
    return c.json({ logs: [], total: 0 });
  }
});

// ─── Auth Settings API ───

// GET /admin/api/data/auth/settings — OAuth provider config
const adminGetAuthSettings = createRoute({
  operationId: 'adminGetAuthSettings',
  method: 'get',
  path: '/auth/settings',
  tags: ['admin'],
  summary: 'Get OAuth provider config',
  responses: {
    200: { description: 'Auth settings', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetAuthSettings, (c) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = parseConfig(c.env) as any;
    const authConfig = config?.auth || {};
    return c.json({
      providers: Array.isArray(authConfig.allowedOAuthProviders) ? authConfig.allowedOAuthProviders : [],
      emailAuth: authConfig.emailAuth !== false,
      anonymousAuth: !!authConfig.anonymousAuth,
      allowedRedirectUrls: Array.isArray(authConfig.allowedRedirectUrls) ? authConfig.allowedRedirectUrls : [],
      session: {
        accessTokenTTL: authConfig.session?.accessTokenTTL ?? null,
        refreshTokenTTL: authConfig.session?.refreshTokenTTL ?? null,
        maxActiveSessions: typeof authConfig.session?.maxActiveSessions === 'number'
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
    });
  } catch {
    return c.json({
      providers: [],
      emailAuth: true,
      anonymousAuth: false,
      allowedRedirectUrls: [],
      session: {
        accessTokenTTL: null,
        refreshTokenTTL: null,
        maxActiveSessions: null,
      },
      magicLink: {
        enabled: false,
        autoCreate: true,
        tokenTTL: null,
      },
      emailOtp: {
        enabled: false,
        autoCreate: true,
      },
      passkeys: {
        enabled: false,
        rpName: null,
        rpID: null,
        origin: [],
      },
    });
  }
});

// GET /admin/api/data/email/templates — read email template/subject config
const adminGetEmailTemplates = createRoute({
  operationId: 'adminGetEmailTemplates',
  method: 'get',
  path: '/email/templates',
  tags: ['admin'],
  summary: 'Get email template and subject config',
  responses: {
    200: { description: 'Email template config', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetEmailTemplates, (c) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = parseConfig(c.env) as any;
    const emailConfig = config?.email || {};
    return c.json({
      appName: emailConfig.appName || 'EdgeBase',
      configured: !!emailConfig.provider,
      subjects: {
        verification: emailConfig.subjects?.verification || null,
        passwordReset: emailConfig.subjects?.passwordReset || null,
        magicLink: emailConfig.subjects?.magicLink || null,
        emailOtp: emailConfig.subjects?.emailOtp || null,
        emailChange: emailConfig.subjects?.emailChange || null,
      },
      templates: {
        verification: emailConfig.templates?.verification || null,
        passwordReset: emailConfig.templates?.passwordReset || null,
        magicLink: emailConfig.templates?.magicLink || null,
        emailOtp: emailConfig.templates?.emailOtp || null,
        emailChange: emailConfig.templates?.emailChange || null,
      },
    });
  } catch {
    return c.json({
      appName: 'EdgeBase',
      configured: false,
      subjects: { verification: null, passwordReset: null, magicLink: null, emailOtp: null, emailChange: null },
      templates: { verification: null, passwordReset: null, magicLink: null, emailOtp: null, emailChange: null },
    });
  }
});

// ─── User Create / Delete / MFA (Admin JWT proxied from admin-auth) ───

// POST /admin/api/data/users — create a new user
const adminCreateUser = createRoute({
  operationId: 'adminCreateUser',
  method: 'post',
  path: '/users',
  tags: ['admin'],
  summary: 'Create a new user',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string(),
            password: z.string(),
            displayName: z.string().optional(),
            role: z.string().optional(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    201: { description: 'User created', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminCreateUser, async (c) => {
  const body = await c.req.json<{ email: string; password: string; displayName?: string; role?: string }>();
  if (!body.email || !body.password) throw new EdgeBaseError(400, 'Email and password are required.', undefined, 'validation-failed');
  body.email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
  if (body.password.length < 8) throw new EdgeBaseError(400, 'Password must be at least 8 characters.', undefined, 'password-too-short');
  if (body.password.length > 256) throw new EdgeBaseError(400, 'Password must not exceed 256 characters.', undefined, 'password-too-long');
  body.role = normalizeOptionalRole(body.role);
  if (body.displayName && body.displayName.length > 200) throw new EdgeBaseError(400, 'Display name must not exceed 200 characters.', undefined, 'display-name-too-long');

  await ensureAuthSchema(getAuthDb(c));
  const user = await createManagedAdminUser(
    getAuthDb(c),
    {
      userId: generateId(),
      email: body.email,
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName,
      role: body.role || 'user',
      verified: true,
    },
    {
      executionCtx: c.executionCtx,
      kv: c.env.KV,
    },
  );

  return c.json({ user: authService.sanitizeUser(user, { includeAppMetadata: true }) }, 201);
});

// DELETE /admin/api/data/users/:id — delete a user completely
const adminDeleteUser = createRoute({
  operationId: 'adminDeleteUser',
  method: 'delete',
  path: '/users/{id}',
  tags: ['admin'],
  summary: 'Delete a user completely',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'User deleted', content: { 'application/json': { schema: jsonResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminDeleteUser, async (c) => {
  const userId = c.req.param('id')!;
  await ensureAuthSchema(getAuthDb(c));
  const deleted = await deleteManagedAdminUser(getAuthDb(c), userId, {
    executionCtx: c.executionCtx,
    kv: c.env.KV,
  });
  if (!deleted) {
    return c.json({ code: 404, message: 'User not found.' }, 404);
  }

  return c.json({ ok: true });
});

// DELETE /admin/api/data/users/:id/mfa — disable MFA for a user
const adminDeleteUserMfa = createRoute({
  operationId: 'adminDeleteUserMfa',
  method: 'delete',
  path: '/users/{id}/mfa',
  tags: ['admin'],
  summary: 'Disable MFA for a user',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'MFA disabled', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminDeleteUserMfa, async (c) => {
  const userId = c.req.param('id')!;
  await authService.disableMfa(getAuthDb(c), userId);
  return c.json({ ok: true, message: 'MFA disabled.' });
});

// POST /admin/api/data/users/:id/send-password-reset — send password reset email for a user
const adminSendPasswordReset = createRoute({
  operationId: 'adminSendPasswordReset',
  method: 'post',
  path: '/users/{id}/send-password-reset',
  tags: ['admin'],
  summary: 'Send password reset email for a user',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'Reset email sent', content: { 'application/json': { schema: jsonResponseSchema } } },
    404: { description: 'User not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminSendPasswordReset, async (c) => {
  const userId = c.req.param('id')!;
  const user = await authService.getUserById(getAuthDb(c), userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (!user.email) throw new EdgeBaseError(400, 'User has no email address.', undefined, 'validation-failed');

  // Create email token in D1
  const token = generateId();
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // 1 hour
  await authService.createEmailToken(getAuthDb(c), {
    token,
    userId,
    type: 'password_reset',
    expiresAt,
  });

  return c.json({ ok: true, token, message: 'Password reset token created.' });
});

// ─── Storage Upload (Admin JWT) ───

// POST /admin/api/data/storage/buckets/:name/upload — upload file to R2
const adminUploadFile = createRoute({
  operationId: 'adminUploadFile',
  method: 'post',
  path: '/storage/buckets/{name}/upload',
  tags: ['admin'],
  summary: 'Upload file to R2 storage',
  request: {
    params: z.object({ name: z.string() }),
    body: {
      content: { 'multipart/form-data': { schema: z.object({}).passthrough() } },
      required: true,
    },
  },
  responses: {
    201: { description: 'File uploaded', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Bucket not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminUploadFile, async (c) => {
  const bucketName = c.req.param('name')!;

  // Validate bucket exists
  const config = parseConfig(c.env);
  const buckets = Object.keys(config?.storage?.buckets || {});
  if (!buckets.includes(bucketName)) {
    throw new EdgeBaseError(404, `Bucket "${bucketName}" not found.`, undefined, 'not-found');
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new EdgeBaseError(400, 'Expected multipart/form-data request body.', undefined, 'validation-failed');
  }
  const file = formData.get('file') as File | null;
  if (!file) throw new EdgeBaseError(400, 'No file provided. Use "file" form field.', undefined, 'validation-failed');

  const key = (formData.get('key') as string) || file.name;
  if (!key) throw new EdgeBaseError(400, 'File key is required.', undefined, 'validation-failed');

  const fullKey = `${bucketName}/${key}`;
  const result = await c.env.STORAGE.put(fullKey, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    customMetadata: { uploadedBy: 'admin', originalName: file.name },
  });

  if (!result) throw new EdgeBaseError(500, 'Failed to upload file to R2.', undefined, 'internal-error');

  return c.json({
    ok: true,
    key,
    size: file.size,
    contentType: file.type || 'application/octet-stream',
  }, 201);
});

// ─── Push Management (Admin JWT) ───

// GET /admin/api/data/push/tokens — list push tokens for a user
const adminGetPushTokens = createRoute({
  operationId: 'adminGetPushTokens',
  method: 'get',
  path: '/push/tokens',
  tags: ['admin'],
  summary: 'List push tokens for a user',
  responses: {
    200: { description: 'Push tokens', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminGetPushTokens, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const userId = c.req.query('userId');
  if (!userId) throw new EdgeBaseError(400, 'userId query parameter is required.', undefined, 'validation-failed');
  const devices = await getDevicesForUser({ kv: c.env.KV, authDb: getAuthDb(c) }, userId);
  return c.json({ items: devices });
});

// GET /admin/api/data/push/logs — get push notification logs
const adminGetPushLogs = createRoute({
  operationId: 'adminGetPushLogs',
  method: 'get',
  path: '/push/logs',
  tags: ['admin'],
  summary: 'Get push notification logs',
  responses: {
    200: { description: 'Push logs', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminGetPushLogs, async (c) => {
  const userId = c.req.query('userId');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  if (userId) {
    const logs = await getPushLogs(c.env.KV, userId, limit);
    return c.json({ items: logs });
  }

  // List all recent push logs across all users
  const result = await c.env.KV.list({ prefix: 'push:log:', limit: Math.min(limit, 200) });
  const items: Array<Record<string, unknown>> = [];
  for (const key of result.keys) {
    const raw = await c.env.KV.get(key.name, 'json');
    if (raw) items.push(raw as Record<string, unknown>);
  }
  return c.json({ items });
});

// POST /admin/api/data/push/test-send — test send push notification
const adminTestPushSend = createRoute({
  operationId: 'adminTestPushSend',
  method: 'post',
  path: '/push/test-send',
  tags: ['admin'],
  summary: 'Test send push notification',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            userId: z.string(),
            title: z.string(),
            body: z.string(),
            data: z.record(z.string(), z.string()).optional(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Push sent', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'No tokens', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminTestPushSend, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const body = await c.req.json<{ userId: string; title: string; body: string; data?: Record<string, string> }>();
  if (!body.userId || !body.title) throw new EdgeBaseError(400, 'userId and title are required.', undefined, 'validation-failed');

  const devices = await getDevicesForUser({ kv: c.env.KV, authDb: getAuthDb(c) }, body.userId);
  if (devices.length === 0) throw new EdgeBaseError(404, 'No push tokens registered for this user.', undefined, 'not-found');

  // Forward to internal push send logic via the push route
  const config = parseConfig(c.env);
  if (!config.push?.fcm) throw new EdgeBaseError(400, 'Push notifications not configured. Set push.fcm in config.', undefined, 'feature-not-enabled');

  // Use dynamic import to avoid circular dependency
  const { createPushProvider } = await import('../lib/push-provider.js');
  const { storePushLog } = await import('../lib/push-token.js');
  const provider = createPushProvider(config.push, c.env);
  if (!provider) throw new EdgeBaseError(400, 'Push provider could not be initialized. Check push.fcm config and PUSH_FCM_SERVICE_ACCOUNT env.', undefined, 'internal-error');

  let sent = 0;
  let failed = 0;

  for (const device of devices) {
    try {
      await provider.send({
        token: device.token,
        platform: device.platform,
        payload: {
          title: body.title,
          body: body.body,
          data: body.data,
        },
      });
      sent++;
    } catch {
      failed++;
    }
  }

  await storePushLog(c.env.KV, body.userId, {
    sentAt: new Date().toISOString(),
    userId: body.userId,
    platform: 'admin-test',
    status: failed === 0 ? 'sent' : 'failed',
  });

  return c.json({ ok: true, sent, failed, total: devices.length });
});

// ─── Backup Proxy (Admin JWT) ───

// POST /admin/api/data/backup/list-dos
const adminBackupListDOs = createRoute({
  operationId: 'adminBackupListDOs',
  method: 'post',
  path: '/backup/list-dos',
  tags: ['admin'],
  summary: 'List Durable Objects for backup',
  responses: {
    200: { description: 'DO list', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminBackupListDOs, async (c) => {
  const config = parseConfig(c.env);
  const dos: Array<{ doName: string; type: string; namespace: string }> = [];

  // Database DOs
  for (const [namespace, _dbBlock] of Object.entries(config.databases ?? {})) {
    const doName = getDbDoName(namespace);
    dos.push({ doName, type: 'database', namespace });
  }

  return c.json({ dos, total: dos.length });
});

// POST /admin/api/data/backup/dump-do
const adminBackupDumpDO = createRoute({
  operationId: 'adminBackupDumpDO',
  method: 'post',
  path: '/backup/dump-do',
  tags: ['admin'],
  summary: 'Dump a Durable Object for backup',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            doName: z.string(),
            type: z.string(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'DO dump', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminBackupDumpDO, async (c) => {
  const body = await c.req.json<{ doName: string; type: string }>();
  if (!body.doName || !body.type) throw new EdgeBaseError(400, 'doName and type are required.', undefined, 'validation-failed');

  const binding = body.type === 'auth' ? c.env.AUTH : c.env.DATABASE;
  const stub = binding.get(binding.idFromName(body.doName));

  const resp = await stub.fetch(new Request('http://internal/internal/backup/dump', {
    method: 'GET',
    headers: { 'X-DO-Name': body.doName },
  }));
  if (!resp.ok) throw new EdgeBaseError(resp.status, `Failed to dump DO: ${body.doName}`, undefined, 'internal-error');

  const data = await resp.json();
  return c.json({ ...data as Record<string, unknown>, doName: body.doName, type: body.type });
});

// POST /admin/api/data/backup/restore-do
const adminBackupRestoreDO = createRoute({
  operationId: 'adminBackupRestoreDO',
  method: 'post',
  path: '/backup/restore-do',
  tags: ['admin'],
  summary: 'Restore a Durable Object from backup',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            doName: z.string(),
            type: z.string(),
            tables: z.record(z.string(), z.unknown()),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'DO restored', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminBackupRestoreDO, async (c) => {
  const body = await c.req.json<{ doName: string; type: string; tables: Record<string, unknown> }>();
  if (!body.doName || !body.type || !body.tables) throw new EdgeBaseError(400, 'doName, type and tables are required.', undefined, 'validation-failed');

  const binding = body.type === 'auth' ? c.env.AUTH : c.env.DATABASE;
  const stub = binding.get(binding.idFromName(body.doName));

  const resp = await stub.fetch(new Request('http://internal/internal/backup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DO-Name': body.doName },
    body: JSON.stringify({ tables: body.tables }),
  }));
  if (!resp.ok) throw new EdgeBaseError(resp.status, `Failed to restore DO: ${body.doName}`, undefined, 'internal-error');

  const data = await resp.json();
  return c.json(data);
});

// POST /admin/api/data/backup/dump-d1
const adminBackupDumpD1 = createRoute({
  operationId: 'adminBackupDumpD1',
  method: 'post',
  path: '/backup/dump-d1',
  tags: ['admin'],
  summary: 'Dump D1 database for backup',
  responses: {
    200: { description: 'D1 dump', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminBackupDumpD1, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const tables: Record<string, unknown[]> = {};

  for (const tbl of AUTH_BACKUP_TABLES) {
    try {
      tables[tbl] = await getAuthDb(c).query(`SELECT * FROM ${quoteSqlIdentifier(tbl)}`);
    } catch {
      tables[tbl] = [];
    }
  }

  return c.json({ type: 'd1', tables, timestamp: new Date().toISOString() });
});

// POST /admin/api/data/backup/restore-d1
const adminBackupRestoreD1 = createRoute({
  operationId: 'adminBackupRestoreD1',
  method: 'post',
  path: '/backup/restore-d1',
  tags: ['admin'],
  summary: 'Restore D1 database from backup',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'D1 restored', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminBackupRestoreD1, async (c) => {
  const body = await c.req.json<{ tables: Record<string, unknown[]> }>();
  if (!body.tables) throw new EdgeBaseError(400, 'tables object is required.', undefined, 'validation-failed');

  await ensureAuthSchema(getAuthDb(c));

  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  let restored = 0;
  for (const [tableName, rows] of Object.entries(body.tables)) {
    if (!AUTH_BACKUP_TABLE_SET.has(tableName)) {
      throw new EdgeBaseError(400, `Unsupported backup table: ${tableName}`, undefined, 'validation-failed');
    }
    if (!Array.isArray(rows)) {
      throw new EdgeBaseError(400, `Backup rows for ${tableName} must be an array.`, undefined, 'validation-failed');
    }

    statements.push({ sql: `DELETE FROM ${quoteSqlIdentifier(tableName)}` });

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new EdgeBaseError(400, `Backup rows for ${tableName} must be objects.`, undefined, 'validation-failed');
      }
      const cols = Object.keys(row as Record<string, unknown>);
      if (cols.length === 0) continue;
      const vals = Object.values(row as Record<string, unknown>);
      const placeholders = cols.map(() => '?').join(',');
      const quotedCols = cols.map(quoteSqlIdentifier).join(', ');
      statements.push({
        sql: `INSERT INTO ${quoteSqlIdentifier(tableName)} (${quotedCols}) VALUES (${placeholders})`,
        params: vals,
      });
      restored++;
    }
  }

  await getAuthDb(c).batch(statements);

  return c.json({ ok: true, restored });
});

// POST /admin/api/data/backup/dump-data
const adminBackupDumpData = createRoute({
  operationId: 'adminBackupDumpData',
  method: 'post',
  path: '/backup/dump-data',
  tags: ['admin'],
  summary: 'Dump data namespace tables for admin-side migrations',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            namespace: z.string(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Namespace dump', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminBackupDumpData, async (c) => {
  const { namespace } = await c.req.json<{ namespace: string }>();
  if (!namespace) throw new EdgeBaseError(400, 'namespace is required.', undefined, 'validation-failed');

  const config = parseConfig(c.env);
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) throw new EdgeBaseError(404, `Namespace '${namespace}' not found in config.`, undefined, 'not-found');

  const tableNames = Object.keys(dbBlock.tables ?? {});
  const tables = await dumpNamespaceTables(c.env, config, namespace, {
    includeMeta: true,
    tableNames,
  });

  return c.json({
    type: 'data',
    namespace,
    tables,
    tableOrder: tableNames,
    timestamp: new Date().toISOString(),
  });
});

// POST /admin/api/data/backup/restore-data
const adminBackupRestoreData = createRoute({
  operationId: 'adminBackupRestoreData',
  method: 'post',
  path: '/backup/restore-data',
  tags: ['admin'],
  summary: 'Restore data namespace tables for admin-side migrations',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            namespace: z.string(),
            tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
            skipWipe: z.boolean().optional(),
          }).passthrough(),
        },
      },
      required: true,
    },
  },
  responses: {
    200: { description: 'Namespace restored', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminBackupRestoreData, async (c) => {
  const body = await c.req.json<{
    namespace: string;
    tables: Record<string, Array<Record<string, unknown>>>;
    skipWipe?: boolean;
  }>();
  if (!body.namespace) throw new EdgeBaseError(400, 'namespace is required.', undefined, 'validation-failed');
  if (!body.tables) throw new EdgeBaseError(400, 'tables data is required.', undefined, 'validation-failed');

  const config = parseConfig(c.env);
  await restoreAdminNamespaceTables(c.env, config, body);

  return c.json({
    ok: true,
    namespace: body.namespace,
    restored: Object.keys(body.tables).length,
  });
});

// GET /admin/api/data/backup/config
const adminBackupGetConfig = createRoute({
  operationId: 'adminBackupGetConfig',
  method: 'get',
  path: '/backup/config',
  tags: ['admin'],
  summary: 'Get backup config',
  responses: {
    200: { description: 'Backup config', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminBackupGetConfig, (c) => {
  try {
    const config = parseConfig(c.env);
    return c.json(config);
  } catch {
    return c.json({});
  }
});

// ─── Admin Account Management ───

// GET /admin/api/data/admins — list all admin accounts
const adminListAdmins = createRoute({
  operationId: 'adminListAdmins',
  method: 'get',
  path: '/admins',
  tags: ['admin'],
  summary: 'List admin accounts',
  responses: {
    200: { description: 'Admin list', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminListAdmins, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const admins = await listAdmins(getAuthDb(c));
  return c.json({ admins });
});

// POST /admin/api/data/admins — create a new admin account
const adminCreateAdmin = createRoute({
  operationId: 'adminCreateAdmin',
  method: 'post',
  path: '/admins',
  tags: ['admin'],
  summary: 'Create an admin account',
  request: {
    body: {
      content: { 'application/json': { schema: z.object({ email: z.string().email(), password: z.string().min(8) }) } },
      required: true,
    },
  },
  responses: {
    200: { description: 'Admin created', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminCreateAdmin, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const body = await c.req.json<{ email: string; password: string }>();

  const existing = await getAdminByEmail(getAuthDb(c), body.email);
  if (existing) {
    return c.json({ code: 409, message: 'An admin with this email already exists' }, 409);
  }

  const id = generateId();
  const hash = await hashPassword(body.password);
  await createAdmin(getAuthDb(c), id, body.email, hash);
  return c.json({ id, email: body.email });
});

// DELETE /admin/api/data/admins/:id — delete an admin account
const adminDeleteAdmin = createRoute({
  operationId: 'adminDeleteAdmin',
  method: 'delete',
  path: '/admins/{id}',
  tags: ['admin'],
  summary: 'Delete an admin account',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Admin deleted', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminDeleteAdmin, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const id = c.req.param('id')!;
  const currentAdminId = (c as unknown as { get(key: string): string }).get('adminId');

  if (id === currentAdminId) {
    return c.json({ code: 403, message: 'Cannot delete your own admin account' }, 403);
  }

  const admins = await listAdmins(getAuthDb(c));
  if (admins.length <= 1) {
    return c.json({ code: 403, message: 'Cannot delete the last admin account' }, 403);
  }

  await deleteAdmin(getAuthDb(c), id);
  return c.json({ success: true });
});

// PUT /admin/api/data/admins/:id/password — change admin password
const adminChangePassword = createRoute({
  operationId: 'adminChangePassword',
  method: 'put',
  path: '/admins/{id}/password',
  tags: ['admin'],
  summary: 'Change admin password',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: { 'application/json': { schema: z.object({ password: z.string().min(8) }) } },
      required: true,
    },
  },
  responses: {
    200: { description: 'Password updated', content: { 'application/json': { schema: jsonResponseSchema } } },
  },
});

api.openapi(adminChangePassword, async (c) => {
  await ensureAuthSchema(getAuthDb(c));
  const id = c.req.param('id')!;
  const body = await c.req.json<{ password: string }>();
  const hash = await hashPassword(body.password);
  await updateAdminPassword(getAuthDb(c), id, hash);
  return c.json({ success: true });
});

// ─── Destroy App (Self-Destruct) ───

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

interface DeployManifest {
  version: number;
  accountId: string;
  worker: { name: string; url: string };
  resources: Array<{
    type: string;
    name: string;
    binding?: string;
    id?: string;
    managed?: boolean;
  }>;
}

async function cfApi(
  accountId: string,
  apiToken: string,
  method: string,
  path: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(`${CF_API_BASE}/accounts/${accountId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    });
    // 2xx = success, 404 = not found (already gone), 410 = gone (Vectorize soft-delete)
    if (res.ok || res.status === 404 || res.status === 410) return { ok: true, status: res.status };
    const body = await res.json().catch(() => ({})) as { errors?: Array<{ message?: string }> };
    const msg = (body.errors ?? []).map((e: { message?: string }) => e.message).filter(Boolean).join(', ');
    return { ok: false, status: res.status, error: msg || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}

const adminDestroyApp = createRoute({
  operationId: 'adminDestroyApp',
  method: 'post',
  path: '/destroy-app',
  tags: ['admin'],
  summary: 'Delete all Cloudflare resources and the Worker itself (self-destruct)',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            confirm: z.literal('DELETE_ALL_RESOURCES'),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Destruction result',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            deleted: z.array(z.string()),
            failed: z.array(z.object({ resource: z.string(), error: z.string() })),
            message: z.string(),
          }),
        },
      },
    },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    503: { description: 'Not available', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

api.openapi(adminDestroyApp, async (c) => {
  const env = c.env as Env;
  const body = await c.req.json<{ confirm: string }>();

  if (body.confirm !== 'DELETE_ALL_RESOURCES') {
    throw new EdgeBaseError(400, 'Confirmation string must be "DELETE_ALL_RESOURCES"', undefined, 'bad_request');
  }

  const apiToken = env.CF_API_TOKEN;
  const accountId = env.CF_ACCOUNT_ID;

  if (!apiToken || !accountId) {
    throw new EdgeBaseError(
      503,
      'Self-destruct is not available. CF_API_TOKEN and CF_ACCOUNT_ID must be set as Worker secrets during deploy.',
      undefined,
      'unavailable',
    );
  }

  // Read manifest from KV
  const manifestRaw = await env.KV.get('__edgebase_deploy_manifest', 'text');
  if (!manifestRaw) {
    throw new EdgeBaseError(
      503,
      'Deploy manifest not found in KV. Redeploy or use CLI `edgebase destroy` instead.',
      undefined,
      'unavailable',
    );
  }

  let manifest: DeployManifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new EdgeBaseError(503, 'Deploy manifest is corrupted.', undefined, 'unavailable');
  }

  const deleted: string[] = [];
  const failed: Array<{ resource: string; error: string }> = [];
  const resources = manifest.resources.filter((r) => r.managed !== false);

  // Delete order: D1 → Vectorize → Hyperdrive → R2 (empty first) → Turnstile → Worker → KV (last)
  // KV is deleted last so the manifest remains available for retry on partial failure.
  // Worker is deleted second-to-last (it takes down DOs, secrets, crons automatically).

  for (const r of resources) {
    if (r.type === 'd1_database' && r.id) {
      const label = `D1 ${r.name}`;
      const result = await cfApi(accountId, apiToken, 'DELETE', `/d1/database/${r.id}`);
      if (result.ok) deleted.push(label);
      else failed.push({ resource: label, error: result.error ?? 'Unknown error' });
    }
  }

  for (const r of resources) {
    if (r.type === 'vectorize' && (r.id || r.name)) {
      const indexName = r.id ?? r.name;
      const label = `Vectorize ${indexName}`;
      const result = await cfApi(accountId, apiToken, 'DELETE', `/vectorize/v2/indexes/${indexName}`);
      if (result.ok) deleted.push(label);
      else failed.push({ resource: label, error: result.error ?? 'Unknown error' });
    }
  }

  for (const r of resources) {
    if (r.type === 'hyperdrive' && r.id) {
      const label = `Hyperdrive ${r.name}`;
      const result = await cfApi(accountId, apiToken, 'DELETE', `/hyperdrive/configs/${r.id}`);
      if (result.ok) deleted.push(label);
      else failed.push({ resource: label, error: result.error ?? 'Unknown error' });
    }
  }

  // R2: empty bucket contents via the Worker's R2 binding, then delete via CF API
  for (const r of resources) {
    if (r.type === 'r2_bucket' && r.name) {
      const label = `R2 ${r.name}`;

      // Use the STORAGE binding to empty the bucket (works regardless of bucket name)
      try {
        let truncated = true;
        let cursor: string | undefined;
        while (truncated) {
          const list = await env.STORAGE.list({ limit: 1000, cursor });
          if (list.objects.length > 0) {
            await Promise.all(list.objects.map((obj) => env.STORAGE.delete(obj.key)));
          }
          truncated = list.truncated;
          cursor = truncated ? (list as unknown as { cursor: string }).cursor : undefined;
        }
      } catch {
        // Non-fatal: attempt deletion anyway — CF API will reject if not empty
      }

      const result = await cfApi(accountId, apiToken, 'DELETE', `/r2/buckets/${r.name}`);
      if (result.ok) deleted.push(label);
      else failed.push({ resource: label, error: result.error ?? 'Bucket may not be empty' });
    }
  }

  for (const r of resources) {
    if (r.type === 'turnstile_widget' && r.id) {
      const label = `Turnstile ${r.name}`;
      // Turnstile uses zone-level API, not account
      const result = await cfApi(accountId, apiToken, 'DELETE', `/challenges/widgets/${r.id}`);
      if (result.ok) deleted.push(label);
      else failed.push({ resource: label, error: result.error ?? 'Unknown error' });
    }
  }

  // Worker is deleted before KV (takes down DOs, secrets, crons automatically)
  if (manifest.worker.name) {
    const label = `Worker ${manifest.worker.name}`;
    const result = await cfApi(accountId, apiToken, 'DELETE', `/workers/scripts/${manifest.worker.name}`);
    if (result.ok) {
      deleted.push(label);
    } else {
      failed.push({ resource: label, error: result.error ?? 'Unknown error' });
    }
  }

  // KV deleted last — manifest stays available for retry on partial failure
  for (const r of resources) {
    if (r.type === 'kv_namespace' && r.id) {
      const label = `KV ${r.name}`;
      const result = await cfApi(accountId, apiToken, 'DELETE', `/storage/kv/namespaces/${r.id}`);
      if (result.ok) deleted.push(label);
      else failed.push({ resource: label, error: result.error ?? 'Unknown error' });
    }
  }

  const allOk = failed.length === 0;
  const message = allOk
    ? `All resources destroyed. ${deleted.length} resources deleted.`
    : `Partial destruction: ${deleted.length} deleted, ${failed.length} failed.`;

  return c.json({
    success: allOk,
    deleted,
    failed,
    message,
  });
});

// Mount JWT-protected sub-app under /data/
adminRoute.route('/data', api);
