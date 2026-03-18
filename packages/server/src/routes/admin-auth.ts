import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import { EdgeBaseError } from '@edgebase-fun/shared';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import { validateKey, buildConstraintCtx, extractBearerToken, resolveServiceKeyCandidate } from '../lib/service-key.js';
import { parsePagination } from '../lib/pagination.js';
import { generateId } from '../lib/uuid.js';
import {
  ensureAuthSchema,
} from '../lib/auth-d1.js';
import { parseConfig } from '../lib/do-router.js';
import { getWorkerUrl } from '../lib/functions.js';
import { executeAuthHook } from './auth.js';
import * as authService from '../lib/auth-d1-service.js';
import { hashPassword } from '../lib/password.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import {
  createManagedAdminUser,
  deleteManagedAdminUser,
  normalizeAdminUserUpdates,
  prepareImportedPasswordHash,
  updateManagedAdminUser,
} from '../lib/admin-user-management.js';

/** Resolve AuthDb from Hono context. Defaults to D1 (AUTH_DB binding). */
function getAuthDb(c: { env: unknown }): AuthDb {
  return resolveAuthDb(c.env as Record<string, unknown>);
}

export const adminAuthRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

function normalizeOptionalRole(role: unknown): string | undefined {
  if (role === undefined) {
    return undefined;
  }
  if (typeof role !== 'string') {
    throw new EdgeBaseError(400, 'Role must be a non-empty string.');
  }
  const normalized = role.trim();
  if (!normalized) {
    throw new EdgeBaseError(400, 'Role must be a non-empty string.');
  }
  if (normalized.length > 100) {
    throw new EdgeBaseError(400, 'Role must not exceed 100 characters.');
  }
  return normalized;
}

// Error handler for admin sub-app — ensures EdgeBaseError returns correct status
adminAuthRoute.onError((err, c) => {
  if (err instanceof EdgeBaseError) {
    return c.json(err.toJSON(), err.code as 400);
  }
  console.error('Admin Auth unhandled error:', err);
  return c.json({ code: 500, message: 'Internal server error.' }, 500);
});

// Service Key middleware — scoped validation
adminAuthRoute.use('*', async (c, next) => {
  const config = parseConfig(c.env);
  const explicitServiceKey =
    c.req.header('X-EdgeBase-Service-Key') ??
    c.req.header('x-edgebase-service-key') ??
    c.req.raw.headers.get('X-EdgeBase-Service-Key') ??
    c.req.raw.headers.get('x-edgebase-service-key');
  const provided = explicitServiceKey ?? resolveServiceKeyCandidate(c.req, extractBearerToken(c.req));
  const { result } = validateKey(provided, 'auth:admin:*:*', config, c.env, undefined, buildConstraintCtx(c.env, c.req));
  if (result === 'missing') {
    throw new EdgeBaseError(403, 'Service Key required for admin auth operations.');
  }
  if (result === 'invalid') {
    throw new EdgeBaseError(401, 'Unauthorized. Service Key required.');
  }
  await ensureAuthSchema(getAuthDb(c));
  await next();
});

const getAdminUser = createRoute({
  operationId: 'adminAuthGetUser',
  method: 'get',
  path: '/users/{id}',
  tags: ['admin'],
  summary: 'Get user by ID',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'User details', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminAuthRoute.openapi(getAdminUser, async (c) => {
  const userId = c.req.param('id')!;
  const user = await authService.getUserById(getAuthDb(c), userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.');
  return c.json({ user: authService.sanitizeUser(user, { includeAppMetadata: true }) });
});

const listAdminUsers = createRoute({
  operationId: 'adminAuthListUsers',
  method: 'get',
  path: '/users',
  tags: ['admin'],
  summary: 'List users',
  request: {
    query: z.object({
      limit: z.string().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: { description: 'User list', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminAuthRoute.openapi(listAdminUsers, async (c) => {
  const { limit, offset } = parsePagination(c.req.query('limit'), c.req.query('cursor'));
  const { users, total } = await authService.listUsers(getAuthDb(c), limit, offset);
  const sanitized = users.map((u) => authService.sanitizeUser(u, { includeAppMetadata: true }));
  const hasMore = total > offset + limit;
  return c.json({ users: sanitized, cursor: hasMore ? String(offset + limit) : null });
});

const createAdminUser = createRoute({
  operationId: 'adminAuthCreateUser',
  method: 'post',
  path: '/users',
  tags: ['admin'],
  summary: 'Create a new user',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string(),
      password: z.string(),
      displayName: z.string().optional(),
      role: z.string().optional(),
    }).passthrough() } }, required: true },
  },
  responses: {
    201: { description: 'User created', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Conflict', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminAuthRoute.openapi(createAdminUser, async (c) => {
  const body = await c.req.json<{ email: string; password: string; displayName?: string; role?: string }>();
  if (!body.email || !body.password) throw new EdgeBaseError(400, 'Email and password are required.');
  body.email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw new EdgeBaseError(400, 'Invalid email format. Please provide a valid email address.');
  }
  if (body.password.length < 8) throw new EdgeBaseError(400, 'Password must be at least 8 characters.');
  if (body.password.length > 256) throw new EdgeBaseError(400, 'Password must not exceed 256 characters.');
  body.role = normalizeOptionalRole(body.role);
  if (body.displayName && body.displayName.length > 200) throw new EdgeBaseError(400, 'Display name must not exceed 200 characters.');

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

const updateAdminUser = createRoute({
  operationId: 'adminAuthUpdateUser',
  method: 'patch',
  path: '/users/{id}',
  tags: ['admin'],
  summary: 'Update user by ID',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: z.object({}).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'User updated', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminAuthRoute.openapi(updateAdminUser, async (c) => {
  const userId = c.req.param('id')!;
  const body = await c.req.json<Record<string, unknown>>();
  const normalized = await normalizeAdminUserUpdates(body);
  const user = await updateManagedAdminUser(getAuthDb(c), userId, normalized as Record<string, unknown>, {
    executionCtx: c.executionCtx,
    kv: c.env.KV,
  });
  if (!user) throw new EdgeBaseError(404, 'User not found.');
  return c.json({ user: authService.sanitizeUser(user, { includeAppMetadata: true }) });
});

const deleteAdminUserMfa = createRoute({
  operationId: 'adminAuthDeleteUserMfa',
  method: 'delete',
  path: '/users/{id}/mfa',
  tags: ['admin'],
  summary: 'Delete user MFA',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'MFA disabled', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminAuthRoute.openapi(deleteAdminUserMfa, async (c) => {
  const userId = c.req.param('id')!;
  await authService.disableMfa(getAuthDb(c), userId);
  return c.json({ ok: true, message: 'MFA disabled.' });
});

const deleteAdminUser = createRoute({
  operationId: 'adminAuthDeleteUser',
  method: 'delete',
  path: '/users/{id}',
  tags: ['admin'],
  summary: 'Delete user by ID',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'User deleted', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminAuthRoute.openapi(deleteAdminUser, async (c) => {
  const userId = c.req.param('id')!;
  const deleted = await deleteManagedAdminUser(getAuthDb(c), userId, {
    executionCtx: c.executionCtx,
    kv: c.env.KV,
  });
  if (!deleted) {
    return c.json({ code: 404, message: 'User not found.' }, 404);
  }
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'onDeleteAccount', { userId }, { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );
  return c.json({ ok: true });
});

const setAdminClaims = createRoute({
  operationId: 'adminAuthSetClaims',
  method: 'put',
  path: '/users/{id}/claims',
  tags: ['admin'],
  summary: 'Set custom claims for user',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: z.object({}).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Claims updated', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminAuthRoute.openapi(setAdminClaims, async (c) => {
  const userId = c.req.param('id')!;
  const claims = await c.req.json();

  // Limit custom claims size to prevent JWT bloat
  const claimsJson = JSON.stringify(claims);
  if (claimsJson.length > 4096) {
    throw new EdgeBaseError(400, 'Custom claims must not exceed 4KB when serialized.');
  }

  const user = await authService.updateUser(getAuthDb(c), userId, {
    customClaims: claimsJson,
  });
  if (!user) throw new EdgeBaseError(404, 'User not found.');
  return c.json({ user: authService.sanitizeUser(user, { includeAppMetadata: true }) });
});

const revokeAdminUserSessions = createRoute({
  operationId: 'adminAuthRevokeUserSessions',
  method: 'post',
  path: '/users/{id}/revoke',
  tags: ['admin'],
  summary: 'Revoke all sessions for user',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'Sessions revoked', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

adminAuthRoute.openapi(revokeAdminUserSessions, async (c) => {
  const userId = c.req.param('id')!;
  await authService.deleteAllUserSessions(getAuthDb(c), userId);
  return c.json({ ok: true, message: 'All sessions revoked.' });
});

const importAdminUsers = createRoute({
  operationId: 'adminAuthImportUsers',
  method: 'post',
  path: '/users/import',
  tags: ['admin'],
  summary: 'Batch import users',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      users: z.array(z.object({
        id: z.string().optional(),
        email: z.string(),
        passwordHash: z.string().optional(),
        password: z.string().optional(),
        displayName: z.string().optional(),
        avatarUrl: z.string().optional(),
        role: z.string().optional(),
        verified: z.boolean().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        appMetadata: z.record(z.string(), z.unknown()).optional(),
      }).passthrough()),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Import results', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

// POST /users/import — batch import users with optional password hash preservation
adminAuthRoute.openapi(importAdminUsers, async (c) => {
  interface ImportUser {
    id?: string;
    email: string;
    passwordHash?: string;
    password?: string;
    displayName?: string;
    avatarUrl?: string;
    role?: string;
    verified?: boolean;
    metadata?: Record<string, unknown>;
    appMetadata?: Record<string, unknown>;
  }

  const body = await c.req.json<{ users: ImportUser[] }>();
  if (!body.users || !Array.isArray(body.users) || body.users.length === 0) {
    throw new EdgeBaseError(400, 'users array is required.');
  }
  if (body.users.length > 1000) {
    throw new EdgeBaseError(400, 'Maximum 1000 users per import batch.');
  }

  await ensureAuthSchema(getAuthDb(c));

  const results: Array<{ id: string; email: string; status: 'created' | 'skipped' | 'error'; error?: string }> = [];

  // Validate & normalize
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const usersWithIds = body.users.map((u) => {
    const id = u.id || generateId();
    const email = u.email.trim().toLowerCase();
    return { ...u, id, email };
  });

  // Pre-validate all users
  for (const u of usersWithIds) {
    if (!EMAIL_RE.test(u.email)) {
      results.push({ id: u.id, email: u.email, status: 'error', error: 'Invalid email format.' });
    } else if (u.password && u.password.length < 8) {
      results.push({ id: u.id, email: u.email, status: 'error', error: 'Password must be at least 8 characters.' });
    } else if (u.password && u.password.length > 256) {
      results.push({ id: u.id, email: u.email, status: 'error', error: 'Password must not exceed 256 characters.' });
    } else if (u.role !== undefined) {
      try {
        u.role = normalizeOptionalRole(u.role);
      } catch (err) {
        results.push({ id: u.id, email: u.email, status: 'error', error: (err as Error).message });
      }
    }
  }

  // Check for duplicate emails in the batch itself
  const emailSet = new Set<string>();
  for (const u of usersWithIds) {
    if (emailSet.has(u.email)) {
      results.push({ id: u.id, email: u.email, status: 'error', error: 'Duplicate email in batch.' });
      continue;
    }
    emailSet.add(u.email);
  }

  for (const u of usersWithIds) {
    // Skip already-errored users (e.g. duplicate emails)
    if (results.find((r) => r.id === u.id && r.status === 'error')) continue;

    try {
      await createManagedAdminUser(
        getAuthDb(c),
        {
          userId: u.id,
          email: u.email,
          passwordHash: await prepareImportedPasswordHash(u),
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          role: u.role || 'user',
          verified: u.verified ?? true,
          metadata: u.metadata,
          appMetadata: u.appMetadata,
        },
        {
          executionCtx: c.executionCtx,
          kv: c.env.KV,
        },
      );
      results.push({ id: u.id, email: u.email, status: 'created' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'User import failed.';
      if (err instanceof EdgeBaseError && err.code === 409) {
        results.push({ id: u.id, email: u.email, status: 'skipped', error: message });
      } else {
        results.push({ id: u.id, email: u.email, status: 'error', error: message });
      }
    }
  }

  const created = results.filter((r) => r.status === 'created').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors = results.filter((r) => r.status === 'error').length;

  return c.json({
    imported: created,
    skipped,
    errors,
    results,
  });
});
