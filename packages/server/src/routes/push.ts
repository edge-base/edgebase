/**
 * Push notification route — /api/push
 *
 * Endpoints:
 *   POST /api/push/register          — Client registers device token (JWT auth)
 *   POST /api/push/unregister        — Client unregisters device token (JWT auth)
 *   POST /api/push/send              — Server sends push to userId (Service Key)
 *   POST /api/push/send-many         — Server sends push to multiple userIds (Service Key)
 *   POST /api/push/send-to-token     — Server sends directly using FCM token (Service Key)
 *   POST /api/push/send-to-topic     — Server sends to FCM topic (Service Key)
 *   POST /api/push/broadcast         — Server broadcasts to all devices (Service Key)
 *   POST /api/push/topic/subscribe   — Client subscribes to topic via server (JWT, web용)
 *   POST /api/push/topic/unsubscribe — Client unsubscribes from topic (JWT, web용)
 *   GET  /api/push/tokens            — Server queries device tokens (Service Key)
 *   GET  /api/push/logs              — Server queries push logs (Service Key)
 *   PATCH /api/push/tokens           — Server updates device metadata (Service Key)
 *
 * All push delivery goes through FCM only. iOS/Android/Web all use FCM Registration Tokens.
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import { getPushAccess, getPushHandlers } from '@edgebase/shared';
import type { AuthContext, PushHookCtx, PushSendInput, PushSendOutput } from '@edgebase/shared';
import type { Env } from '../types.js';
import { getD1BindingName, parseConfig, shouldRouteToD1 } from '../lib/do-router.js';
import { validateKey, buildConstraintCtx } from '../lib/service-key.js';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import { ensureAuthSchema } from '../lib/auth-d1.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import {
  registerToken,
  unregisterToken,
  getDevicesForUser,
  removeDeviceFromUser,
  storePushLog,
  getPushLogs,
  type PushLogEntry,
} from '../lib/push-token.js';
import {
  createPushProvider,
  type FcmProvider,
  type PushPayload,
  type PushSendResult,
} from '../lib/push-provider.js';


export const pushRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

/** Chunk size for token-based multicast (500 tokens per batch). */
const TOKEN_CHUNK_SIZE = 500;

/** Max metadata size in bytes. */
const MAX_METADATA_BYTES = 1024;
const utf8Encoder = new TextEncoder();

function getAuthDb(c: { env: Env }): AuthDb {
  return resolveAuthDb(c.env as unknown as Record<string, unknown>);
}

async function getPushTokenStore(c: { env: Env }): Promise<{ kv: KVNamespace; authDb: AuthDb }> {
  const authDb = getAuthDb(c);
  await ensureAuthSchema(authDb);
  return { kv: c.env.KV, authDb };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
    ? value
    : undefined;
}

function asPushPayload(value: unknown): PushPayload | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const notification = raw.notification && typeof raw.notification === 'object'
    ? raw.notification as Record<string, unknown>
    : undefined;

  return {
    ...(raw as PushPayload),
    title: asNonEmptyString(raw.title) ?? asNonEmptyString(notification?.title),
    body: asNonEmptyString(raw.body) ?? asNonEmptyString(notification?.body),
    image: asNonEmptyString(raw.image) ?? asNonEmptyString(notification?.image),
  };
}

function extractPushTraceValue(
  payload: PushPayload,
  key: 'runId' | 'probeId',
): string | undefined {
  const value = payload.data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function waitUntilSafe(
  c: { executionCtx?: ExecutionContext },
  promise: Promise<unknown>,
): void {
  try {
    c.executionCtx?.waitUntil?.(promise);
  } catch {
    void promise.catch((err) => {
      console.error('[Push] background task failed:', err);
    });
  }
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function metadataExceedsByteLimit(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return utf8Encoder.encode(JSON.stringify(metadata)).length > MAX_METADATA_BYTES;
}

function getSharedMirrorDb(env: Env): D1Database | null {
  const config = parseConfig(env);
  if (!shouldRouteToD1('shared', config)) return null;

  const bindingName = getD1BindingName('shared');
  const candidate = (env as unknown as Record<string, unknown>)[bindingName];
  if (!candidate || typeof candidate !== 'object') return null;

  return typeof (candidate as D1Database).prepare === 'function'
    ? candidate as D1Database
    : null;
}

function isMissingSharedMirrorTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table/i.test(message);
}

async function withSharedMirror(
  env: Env,
  operation: string,
  fn: (db: D1Database) => Promise<void>,
): Promise<void> {
  const db = getSharedMirrorDb(env);
  if (!db) return;

  try {
    await fn(db);
  } catch (error) {
    if (isMissingSharedMirrorTable(error)) return;
    console.warn(`[Push] shared mirror ${operation} failed:`, error);
  }
}

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  ...keys: string[]
): string | null {
  if (!metadata) return null;

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }

  return null;
}

async function mirrorPushDeviceUpsert(
  env: Env,
  entry: {
    userId: string;
    deviceId: string;
    token: string;
    platform: string;
    updatedAt: string;
    deviceInfo?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await withSharedMirror(env, 'device-upsert', async (db) => {
    const rowKey = `${entry.userId}:${entry.deviceId}`;
    const runId = readMetadataString(entry.metadata, 'runId', 'run_id');
    const slotId = readMetadataString(entry.metadata, 'slotId', 'slot_id');
    const sdk = readMetadataString(entry.metadata, 'sdk');

    await db.prepare(
      `INSERT INTO devices (
         rowKey, runId, userId, deviceId, token, platform, slotId, sdk, updatedAt, deviceInfo, metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rowKey) DO UPDATE SET
         runId = excluded.runId,
         userId = excluded.userId,
         deviceId = excluded.deviceId,
         token = excluded.token,
         platform = excluded.platform,
         slotId = excluded.slotId,
         sdk = excluded.sdk,
         updatedAt = excluded.updatedAt,
         deviceInfo = excluded.deviceInfo,
         metadata = excluded.metadata`,
    ).bind(
      rowKey,
      runId,
      entry.userId,
      entry.deviceId,
      entry.token,
      entry.platform,
      slotId,
      sdk,
      entry.updatedAt,
      entry.deviceInfo ? JSON.stringify(entry.deviceInfo) : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ).run();
  });
}

async function mirrorPushDeviceDelete(env: Env, userId: string, deviceId: string): Promise<void> {
  await withSharedMirror(env, 'device-delete', async (db) => {
    await db.prepare('DELETE FROM devices WHERE userId = ? AND deviceId = ?')
      .bind(userId, deviceId)
      .run();
  });
}

async function mirrorPushLog(env: Env, entry: PushLogEntry): Promise<void> {
  await withSharedMirror(env, 'log-insert', async (db) => {
    const logKey = `push:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await db.prepare(
      `INSERT INTO push_log (
         logKey, runId, probeId, userId, platform, status, sentAt, collapseId,
         error, title, body, target, topic
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      logKey,
      asNullableString(entry.runId),
      asNullableString(entry.probeId),
      entry.userId,
      entry.platform,
      entry.status,
      entry.sentAt,
      asNullableString(entry.collapseId),
      asNullableString(entry.error),
      asNullableString(entry.title),
      asNullableString(entry.body),
      asNullableString(entry.target),
      asNullableString(entry.topic),
    ).run();
  });
}

async function runBeforeSendHook(
  c: { env: Env; executionCtx: ExecutionContext; req: { raw: Request } },
  auth: AuthContext | null,
  input: PushSendInput,
): Promise<PushSendInput> {
  const hook = getPushHandlers(parseConfig(c.env)?.push)?.hooks?.beforeSend;
  if (!hook) return input;

  const hookCtx: PushHookCtx = {
    request: c.req.raw,
    waitUntil: (promise: Promise<unknown>) => waitUntilSafe(c, promise),
  };

  const result = await Promise.resolve(hook(auth, input, hookCtx));
  return result ?? input;
}

function runAfterSendHook(
  c: { env: Env; executionCtx: ExecutionContext; req: { raw: Request } },
  auth: AuthContext | null,
  input: PushSendInput,
  output: PushSendOutput,
): void {
  const hook = getPushHandlers(parseConfig(c.env)?.push)?.hooks?.afterSend;
  if (!hook) return;

  const hookCtx: PushHookCtx = {
    request: c.req.raw,
    waitUntil: (promise: Promise<unknown>) => waitUntilSafe(c, promise),
  };

  waitUntilSafe(c, Promise.resolve(hook(auth, input, output, hookCtx)).catch((err) => {
    console.error('[Push] afterSend hook failed:', err);
  }));
}

// ─── POST /register — Client device token registration ───

const pushRegister = createRoute({
  operationId: 'pushRegister',
  method: 'post',
  path: '/register',
  tags: ['client'],
  summary: 'Register push token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      deviceId: z.string(),
      token: z.string(),
      platform: z.string(),
      deviceInfo: z.object({
        name: z.string().optional(),
        osVersion: z.string().optional(),
        appVersion: z.string().optional(),
        locale: z.string().optional(),
      }).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Token registered', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushRegister, async (c) => {
  const auth = c.get('auth' as never) as { id: string } | null | undefined;
  if (!auth?.id) {
    return c.json({ code: 401, message: 'Authentication required to register push token' }, 401);
  }

  let body: {
    deviceId?: string;
    token?: string;
    platform?: string;
    deviceInfo?: { name?: string; osVersion?: string; appVersion?: string; locale?: string };
    metadata?: Record<string, unknown>;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  const { deviceId, token, platform } = body;
  if (!deviceId || typeof deviceId !== 'string') {
    return c.json({ code: 400, message: 'deviceId is required' }, 400);
  }
  if (!token || typeof token !== 'string') {
    return c.json({ code: 400, message: 'token is required' }, 400);
  }
  if (!platform || typeof platform !== 'string') {
    return c.json({ code: 400, message: 'platform is required' }, 400);
  }

  // Validate metadata size (≤1KB)
  if (metadataExceedsByteLimit(body.metadata)) {
    return c.json({ code: 400, message: `metadata exceeds ${MAX_METADATA_BYTES} byte limit` }, 400);
  }

  // All tokens are FCM Registration Tokens — store directly
  await registerToken(await getPushTokenStore(c), auth.id, deviceId, token, platform, body.deviceInfo, body.metadata);
  await mirrorPushDeviceUpsert(c.env, {
    userId: auth.id,
    deviceId,
    token,
    platform,
    updatedAt: new Date().toISOString(),
    deviceInfo: body.deviceInfo,
    metadata: body.metadata,
  });

  // Auto-subscribe token to 'all' topic for broadcast() support (FCM 일원화)
  const config = parseConfig(c.env);
  const provider = createPushProvider(config.push, c.env);
  if (provider) {
    // Best-effort — don't fail registration if topic subscription fails
    await provider.subscribeTokenToTopic(token, 'all').catch(() => {});
  }

  return c.json({ ok: true }, 200);
});

// ─── POST /unregister — Client device token removal ───

const pushUnregister = createRoute({
  operationId: 'pushUnregister',
  method: 'post',
  path: '/unregister',
  tags: ['client'],
  summary: 'Unregister push token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      deviceId: z.string(),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Token unregistered', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushUnregister, async (c) => {
  const auth = c.get('auth' as never) as { id: string } | null | undefined;
  if (!auth?.id) {
    return c.json({ code: 401, message: 'Authentication required' }, 401);
  }

  let body: { deviceId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  if (!body.deviceId || typeof body.deviceId !== 'string') {
    return c.json({ code: 400, message: 'deviceId is required' }, 400);
  }

  // Get the FCM token from user's device array BEFORE removing
  const devices = await getDevicesForUser(await getPushTokenStore(c), auth.id);
  const device = devices.find(d => d.deviceId === body.deviceId);
  if (device?.token) {
    const config = parseConfig(c.env);
    const provider = createPushProvider(config.push, c.env);
    if (provider) {
      // Best-effort — don't fail unregister if topic unsubscription fails
      await provider.unsubscribeTokenFromTopic(device.token, 'all').catch(() => {});
    }
  }

  await unregisterToken(await getPushTokenStore(c), auth.id, body.deviceId);
  await mirrorPushDeviceDelete(c.env, auth.id, body.deviceId);
  return c.json({ ok: true });
});

// ─── POST /send — Send push to a single user ───

const pushSend = createRoute({
  operationId: 'pushSend',
  method: 'post',
  path: '/send',
  tags: ['admin'],
  summary: 'Send push notification to user',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      userId: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Push result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    503: { description: 'Push not configured', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushSend, async (c) => {
  const config = parseConfig(c.env);
  const auth = (c.get('auth' as never) as AuthContext | null | undefined) ?? null;

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:notification:*:send',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required for push send' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const provider = createPushProvider(config.push, c.env);
  if (!provider) {
    return c.json({ code: 503, message: 'Push notifications are not configured. Add push.fcm config with FCM credentials.' }, 503);
  }

  let body: { userId?: string; payload?: PushPayload };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  let { userId, payload } = body;
  if (!userId || typeof userId !== 'string') {
    return c.json({ code: 400, message: 'userId is required' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return c.json({ code: 400, message: 'payload is required' }, 400);
  }

  ({ userId, payload } = await runBeforeSendHook(c, auth, {
    kind: 'user',
    userId,
    payload: payload as Record<string, unknown>,
  }));
  userId = asNonEmptyString(userId);
  payload = asPushPayload(payload);
  if (!userId || !payload) {
    return c.json({ code: 400, message: 'beforeSend must return a valid userId and payload' }, 400);
  }

  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 4096) {
    return c.json({ code: 400, message: 'Payload exceeds 4KB limit' }, 400);
  }

  // Evaluate push send rule (if defined)
  const sendRule = getPushAccess(config.push)?.send;
  if (sendRule) {
    try {
      if (!sendRule(auth, { userId })) {
        return c.json({ code: 403, message: 'Denied by push send rule' }, 403);
      }
    } catch {
      return c.json({ code: 403, message: 'Denied by push send rule' }, 403);
    }
  }

  const result = await sendToUser(await getPushTokenStore(c), provider, userId, payload, c.env);
  runAfterSendHook(c, auth, { kind: 'user', userId, payload: payload as Record<string, unknown> }, { ...result, raw: result });
  return c.json(result);
});

// ─── POST /send-many — Send push to multiple users (token-based chunking) ───

const pushSendMany = createRoute({
  operationId: 'pushSendMany',
  method: 'post',
  path: '/send-many',
  tags: ['admin'],
  summary: 'Send push to multiple users',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      userIds: z.array(z.string()),
      payload: z.record(z.string(), z.unknown()),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Push results', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    503: { description: 'Push not configured', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushSendMany, async (c) => {
  const config = parseConfig(c.env);
  const auth = (c.get('auth' as never) as AuthContext | null | undefined) ?? null;

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:notification:*:send',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required for push send' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const provider = createPushProvider(config.push, c.env);
  if (!provider) {
    return c.json({ code: 503, message: 'Push notifications are not configured. Add push.fcm config with FCM credentials.' }, 503);
  }

  let body: { userIds?: string[]; payload?: PushPayload };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  let { userIds, payload } = body;
  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return c.json({ code: 400, message: 'userIds array is required and must not be empty' }, 400);
  }
  if (userIds.length > 10000) {
    return c.json({ code: 400, message: 'userIds array must not exceed 10,000 items' }, 400);
  }
  if (!payload || typeof payload !== 'object') {
    return c.json({ code: 400, message: 'payload is required' }, 400);
  }

  ({ userIds, payload } = await runBeforeSendHook(c, auth, {
    kind: 'users',
    userIds,
    payload: payload as Record<string, unknown>,
  }));
  userIds = asStringArray(userIds);
  payload = asPushPayload(payload);
  if (!userIds || userIds.length === 0 || !payload) {
    return c.json({ code: 400, message: 'beforeSend must return userIds[] and payload' }, 400);
  }

  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 4096) {
    return c.json({ code: 400, message: 'Payload exceeds 4KB limit' }, 400);
  }

  // Evaluate push send rule per userId (if defined)
  const sendRule = getPushAccess(config.push)?.send;
  let allowedUserIds = userIds;
  if (sendRule) {
    allowedUserIds = userIds.filter((uid) => {
      try {
        return sendRule(auth, { userId: uid });
      } catch {
        return false; // fail-closed
      }
    });
    if (allowedUserIds.length === 0) {
      return c.json({ code: 403, message: 'Denied by push send rule' }, 403);
    }
  }

  // Step 1: Collect all tokens from all userIds
  const pushStore = await getPushTokenStore(c);
  const allTokens: Array<{ userId: string; deviceId: string; token: string; platform: string }> = [];
  for (const uid of allowedUserIds) {
    const devices = await getDevicesForUser(pushStore, uid);
    for (const d of devices) {
      allTokens.push({ userId: uid, deviceId: d.deviceId, token: d.token, platform: d.platform });
    }
  }

  if (allTokens.length === 0) {
    return c.json({ sent: 0, failed: 0, removed: 0 });
  }

  // Step 2: Chunk by TOKEN_CHUNK_SIZE (500) tokens and send sequentially
  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (let i = 0; i < allTokens.length; i += TOKEN_CHUNK_SIZE) {
    const chunk = allTokens.slice(i, i + TOKEN_CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async (entry) => {
        const result = await provider.send({ token: entry.token, platform: entry.platform, payload });
        return { ...entry, result };
      }),
    );

    for (const settled of results) {
      if (settled.status === 'rejected') {
        failed++;
        continue;
      }

      const { userId, deviceId, platform, result } = settled.value;

      if (result.success) {
        sent++;
      } else if (result.remove) {
        removed++;
        await removeDeviceFromUser(pushStore, userId, deviceId);
        await mirrorPushDeviceDelete(c.env, userId, deviceId);
      } else {
        failed++;
      }

      const logEntry: PushLogEntry = {
        sentAt: new Date().toISOString(),
        userId,
        platform,
        status: result.success ? 'sent' : (result.remove ? 'removed' : 'failed'),
        collapseId: payload.collapseId,
        error: result.error,
        runId: extractPushTraceValue(payload, 'runId'),
        probeId: extractPushTraceValue(payload, 'probeId'),
        title: payload.title,
        body: payload.body,
        target: deviceId,
      };
      await storePushLog(c.env.KV, userId, logEntry);
      await mirrorPushLog(c.env, logEntry);
    }
  }

  runAfterSendHook(
    c,
    auth,
    { kind: 'users', userIds: allowedUserIds, payload: payload as Record<string, unknown> },
    { sent, failed, removed, raw: { sent, failed, removed } },
  );
  return c.json({ sent, failed, removed });
});

// ─── POST /send-to-token — Send push directly using FCM token (Service Key) ───

const pushSendToToken = createRoute({
  operationId: 'pushSendToToken',
  method: 'post',
  path: '/send-to-token',
  tags: ['admin'],
  summary: 'Send push to specific token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      token: z.string(),
      platform: z.string().optional(),
      payload: z.record(z.string(), z.unknown()),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Push result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    503: { description: 'Push not configured', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushSendToToken, async (c) => {
  const config = parseConfig(c.env);
  const auth = (c.get('auth' as never) as AuthContext | null | undefined) ?? null;

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:notification:*:send',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required for push send' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const provider = createPushProvider(config.push, c.env);
  if (!provider) {
    return c.json({ code: 503, message: 'Push notifications are not configured. Add push.fcm config with FCM credentials.' }, 503);
  }

  let body: { token?: string; platform?: string; payload?: PushPayload };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  if (!body.token || typeof body.token !== 'string') {
    return c.json({ code: 400, message: 'token is required' }, 400);
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return c.json({ code: 400, message: 'payload is required' }, 400);
  }

  const hookInput = await runBeforeSendHook(c, auth, {
    kind: 'token',
    token: body.token,
    platform: body.platform || 'web',
    payload: body.payload as Record<string, unknown>,
  });
  const token = asNonEmptyString(hookInput.token);
  const platform = asNonEmptyString(hookInput.platform) ?? 'web';
  const payload = asPushPayload(hookInput.payload);
  if (!token || !payload) {
    return c.json({ code: 400, message: 'beforeSend must return token and payload' }, 400);
  }

  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > 4096) {
    return c.json({ code: 400, message: 'Payload exceeds 4KB limit' }, 400);
  }

  const result = await provider.send({
    token,
    platform,
    payload,
  });

  const directLogEntry: PushLogEntry = {
    sentAt: new Date().toISOString(),
    userId: '__direct-token__',
    platform,
    status: result.success ? 'sent' : (result.remove ? 'removed' : 'failed'),
    collapseId: payload.collapseId,
    error: result.error,
    runId: extractPushTraceValue(payload, 'runId'),
    probeId: extractPushTraceValue(payload, 'probeId'),
    title: payload.title,
    body: payload.body,
    target: token,
  };
  await storePushLog(c.env.KV, '__direct-token__', directLogEntry);
  await mirrorPushLog(c.env, directLogEntry);

  runAfterSendHook(
    c,
    auth,
    {
      kind: 'token',
      token,
      platform,
      payload: payload as Record<string, unknown>,
    },
    {
      sent: result.success ? 1 : 0,
      failed: result.success ? 0 : 1,
      ...(result.error ? { error: result.error } : {}),
      raw: result,
    },
  );

  return c.json({
    sent: result.success ? 1 : 0,
    failed: result.success ? 0 : 1,
    ...(result.error ? { error: result.error } : {}),
  });
});

// ─── POST /send-to-topic — Send push to FCM topic (Service Key) ───

const pushSendToTopic = createRoute({
  operationId: 'pushSendToTopic',
  method: 'post',
  path: '/send-to-topic',
  tags: ['admin'],
  summary: 'Send push to topic',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      topic: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Push result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    503: { description: 'Push not configured', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushSendToTopic, async (c) => {
  const config = parseConfig(c.env);
  const auth = (c.get('auth' as never) as AuthContext | null | undefined) ?? null;

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:notification:*:send',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required for push send' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const provider = createPushProvider(config.push, c.env);
  if (!provider) {
    return c.json({ code: 503, message: 'Push notifications are not configured. Add push.fcm config with FCM credentials.' }, 503);
  }

  let body: { topic?: string; payload?: PushPayload };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  if (!body.topic || typeof body.topic !== 'string') {
    return c.json({ code: 400, message: 'topic is required' }, 400);
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return c.json({ code: 400, message: 'payload is required' }, 400);
  }

  const hookInput = await runBeforeSendHook(c, auth, {
    kind: 'topic',
    topic: body.topic,
    payload: body.payload as Record<string, unknown>,
  });
  const topic = asNonEmptyString(hookInput.topic);
  const payload = asPushPayload(hookInput.payload);
  if (!topic || !payload) {
    return c.json({ code: 400, message: 'beforeSend must return topic and payload' }, 400);
  }
  const topicInput: PushSendInput = { kind: 'topic', topic, payload: payload as Record<string, unknown> };
  const result = await provider.sendToTopic(topic, payload);
  const topicLogEntry: PushLogEntry = {
    sentAt: new Date().toISOString(),
    userId: `topic:${topic}`,
    platform: 'topic',
    status: result.success ? 'sent' : 'failed',
    collapseId: payload.collapseId,
    error: result.error,
    runId: extractPushTraceValue(payload, 'runId'),
    probeId: extractPushTraceValue(payload, 'probeId'),
    title: payload.title,
    body: payload.body,
    topic,
  };
  await storePushLog(c.env.KV, `topic:${topic}`, topicLogEntry);
  await mirrorPushLog(c.env, topicLogEntry);
  runAfterSendHook(c, auth, topicInput, { raw: result });
  return c.json(result);
});

// ─── POST /broadcast — Broadcast to all devices via /topics/all (Service Key) ───

const pushBroadcast = createRoute({
  operationId: 'pushBroadcast',
  method: 'post',
  path: '/broadcast',
  tags: ['admin'],
  summary: 'Broadcast push to all devices',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      payload: z.record(z.string(), z.unknown()),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Broadcast result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    503: { description: 'Push not configured', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushBroadcast, async (c) => {
  const config = parseConfig(c.env);
  const auth = (c.get('auth' as never) as AuthContext | null | undefined) ?? null;

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:notification:*:send',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required for push send' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const provider = createPushProvider(config.push, c.env);
  if (!provider) {
    return c.json({ code: 503, message: 'Push notifications are not configured. Add push.fcm config with FCM credentials.' }, 503);
  }

  let body: { payload?: PushPayload };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  if (!body.payload || typeof body.payload !== 'object') {
    return c.json({ code: 400, message: 'payload is required' }, 400);
  }

  const hookInput = await runBeforeSendHook(c, auth, {
    kind: 'broadcast',
    payload: body.payload as Record<string, unknown>,
  });
  const payload = asPushPayload(hookInput.payload);
  if (!payload) {
    return c.json({ code: 400, message: 'beforeSend must return payload' }, 400);
  }
  const broadcastInput: PushSendInput = { kind: 'broadcast', payload: payload as Record<string, unknown> };
  const result = await provider.broadcast(payload);
  const broadcastLogEntry: PushLogEntry = {
    sentAt: new Date().toISOString(),
    userId: 'broadcast:all',
    platform: 'broadcast',
    status: result.success ? 'sent' : 'failed',
    collapseId: payload.collapseId,
    error: result.error,
    runId: extractPushTraceValue(payload, 'runId'),
    probeId: extractPushTraceValue(payload, 'probeId'),
    title: payload.title,
    body: payload.body,
    topic: 'all',
  };
  await storePushLog(c.env.KV, 'broadcast:all', broadcastLogEntry);
  await mirrorPushLog(c.env, broadcastLogEntry);
  runAfterSendHook(c, auth, broadcastInput, { raw: result });
  return c.json(result);
});

// ─── POST /topic/subscribe — Subscribe user's tokens to FCM topic (JWT, web용) ───

const pushTopicSubscribe = createRoute({
  operationId: 'pushTopicSubscribe',
  method: 'post',
  path: '/topic/subscribe',
  tags: ['client'],
  summary: 'Subscribe token to topic',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      topic: z.string(),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Subscribed', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    503: { description: 'Push not configured', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushTopicSubscribe, async (c) => {
  const auth = c.get('auth' as never) as { id: string } | null | undefined;
  if (!auth?.id) {
    return c.json({ code: 401, message: 'Authentication required' }, 401);
  }

  const config = parseConfig(c.env);
  const provider = createPushProvider(config.push, c.env);
  if (!provider) {
    return c.json({ code: 503, message: 'Push notifications are not configured.' }, 503);
  }

  let body: { topic?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  if (!body.topic || typeof body.topic !== 'string') {
    return c.json({ code: 400, message: 'topic is required' }, 400);
  }

  // Get user's devices and subscribe all tokens to the topic
  const devices = await getDevicesForUser(await getPushTokenStore(c), auth.id);
  if (devices.length === 0) {
    // Topic subscription is a user-level operation — succeeds even with no devices registered.
    // Devices will be subscribed to the topic when they register later.
    return c.json({ ok: true, subscribedDevices: 0 }, 200);
  }

  const results = await Promise.allSettled(
    devices.map(d => provider.subscribeTokenToTopic(d.token, body.topic!)),
  );

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failedCount = results.length - succeeded;

  return c.json({ ok: true, subscribed: succeeded, failed: failedCount });
});

// ─── POST /topic/unsubscribe — Unsubscribe user's tokens from FCM topic (JWT, web용) ───

const pushTopicUnsubscribe = createRoute({
  operationId: 'pushTopicUnsubscribe',
  method: 'post',
  path: '/topic/unsubscribe',
  tags: ['client'],
  summary: 'Unsubscribe token from topic',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      topic: z.string(),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Unsubscribed', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    503: { description: 'Push not configured', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushTopicUnsubscribe, async (c) => {
  const auth = c.get('auth' as never) as { id: string } | null | undefined;
  if (!auth?.id) {
    return c.json({ code: 401, message: 'Authentication required' }, 401);
  }

  const config = parseConfig(c.env);
  const provider = createPushProvider(config.push, c.env);
  if (!provider) {
    return c.json({ code: 503, message: 'Push notifications are not configured.' }, 503);
  }

  let body: { topic?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  if (!body.topic || typeof body.topic !== 'string') {
    return c.json({ code: 400, message: 'topic is required' }, 400);
  }

  const devices = await getDevicesForUser(await getPushTokenStore(c), auth.id);
  if (devices.length === 0) {
    // Topic unsubscription is a user-level operation — succeeds even with no devices registered.
    return c.json({ ok: true, subscribedDevices: 0 }, 200);
  }

  const results = await Promise.allSettled(
    devices.map(d => provider.unsubscribeTokenFromTopic(d.token, body.topic!)),
  );

  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failedCount = results.length - succeeded;

  return c.json({ ok: true, unsubscribed: succeeded, failed: failedCount });
});

// ─── GET /logs — Query push send logs ───

const pushLogsRoute = createRoute({
  operationId: 'getPushLogs',
  method: 'get',
  path: '/logs',
  tags: ['admin'],
  summary: 'Get push notification logs',
  request: {
    query: z.object({
      userId: z.string().openapi({ description: 'User ID to query logs for' }),
      limit: z.string().optional().openapi({ description: 'Max items to return (default 50, max 100)' }),
    }),
  },
  responses: {
    200: { description: 'Push logs', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushLogsRoute, async (c) => {
  const config = parseConfig(c.env);

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:log:*:read',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required for push logs' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const userId = c.req.query('userId');
  if (!userId) {
    return c.json({ code: 400, message: 'userId query parameter is required' }, 400);
  }

  const limitStr = c.req.query('limit');
  const limit = limitStr ? Math.min(parseInt(limitStr, 10) || 50, 100) : 50;

  const logs = await getPushLogs(c.env.KV, userId, limit);
  return c.json({ items: logs });
});

// ─── GET /tokens — Query device tokens for a user ───

const pushTokensRoute = createRoute({
  operationId: 'getPushTokens',
  method: 'get',
  path: '/tokens',
  tags: ['admin'],
  summary: 'Get registered push tokens',
  request: {
    query: z.object({
      userId: z.string().openapi({ description: 'User ID to query tokens for' }),
    }),
  },
  responses: {
    200: { description: 'Push tokens', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(pushTokensRoute, async (c) => {
  const config = parseConfig(c.env);

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:token:*:read',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required for push tokens' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const userId = c.req.query('userId');
  if (!userId) {
    return c.json({ code: 400, message: 'userId query parameter is required' }, 400);
  }

  const devices = await getDevicesForUser(await getPushTokenStore(c), userId);
  return c.json({ items: devices });
});

// ─── PUT /tokens — Upsert a device token (Admin) ───

const putPushTokens = createRoute({
  operationId: 'putPushTokens',
  method: 'put',
  path: '/tokens',
  tags: ['admin'],
  summary: 'Upsert a device token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      userId: z.string(),
      deviceId: z.string(),
      token: z.string(),
      platform: z.string(),
      deviceInfo: z.object({
        name: z.string().optional(),
        osVersion: z.string().optional(),
        appVersion: z.string().optional(),
        locale: z.string().optional(),
      }).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Token upserted', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(putPushTokens, async (c) => {
  const config = parseConfig(c.env);

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:token:*:write',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const body = await c.req.json<{
    userId?: string;
    deviceId?: string;
    token?: string;
    platform?: string;
    deviceInfo?: { name?: string; osVersion?: string; appVersion?: string; locale?: string };
    metadata?: Record<string, unknown>;
  }>();
  if (!body.userId || !body.deviceId || !body.token || !body.platform) {
    return c.json({ code: 400, message: 'userId, deviceId, token, and platform are required' }, 400);
  }

  if (metadataExceedsByteLimit(body.metadata)) {
    return c.json({ code: 400, message: `metadata exceeds ${MAX_METADATA_BYTES} byte limit` }, 400);
  }

  await registerToken(
    await getPushTokenStore(c),
    body.userId,
    body.deviceId,
    body.token,
    body.platform,
    body.deviceInfo,
    body.metadata,
  );
  await mirrorPushDeviceUpsert(c.env, {
    userId: body.userId,
    deviceId: body.deviceId,
    token: body.token,
    platform: body.platform,
    updatedAt: new Date().toISOString(),
    deviceInfo: body.deviceInfo,
    metadata: body.metadata,
  });

  const provider = createPushProvider(config.push, c.env);
  if (provider) {
    await provider.subscribeTokenToTopic(body.token, 'all').catch(() => {});
  }

  return c.json({ ok: true });
});

// ─── PATCH /tokens — Update metadata for a device token (Admin) ───

const patchPushTokens = createRoute({
  operationId: 'patchPushTokens',
  method: 'patch',
  path: '/tokens',
  tags: ['admin'],
  summary: 'Update device metadata',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      userId: z.string(),
      deviceId: z.string(),
      metadata: z.record(z.string(), z.unknown()),
    }) } }, required: true },
  },
  responses: {
    200: { description: 'Metadata updated', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Device not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

pushRoute.openapi(patchPushTokens, async (c) => {
  const config = parseConfig(c.env);

  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    'push:token:*:write',
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  const body = await c.req.json<{ userId?: string; deviceId?: string; metadata?: Record<string, unknown> }>();
  if (!body.userId || !body.deviceId) {
    return c.json({ code: 400, message: 'userId and deviceId are required' }, 400);
  }
  if (!body.metadata) {
    return c.json({ code: 400, message: 'metadata is required' }, 400);
  }

  if (metadataExceedsByteLimit(body.metadata)) {
    return c.json({ code: 400, message: `metadata exceeds ${MAX_METADATA_BYTES} byte limit` }, 400);
  }

  const pushStore = await getPushTokenStore(c);
  const devices = await getDevicesForUser(pushStore, body.userId);
  const device = devices.find(d => d.deviceId === body.deviceId);
  if (!device) {
    return c.json({ code: 404, message: 'Device not found' }, 404);
  }

  device.metadata = body.metadata;
  device.updatedAt = new Date().toISOString();
  await registerToken(
    pushStore,
    body.userId,
    device.deviceId,
    device.token,
    device.platform,
    device.deviceInfo,
    body.metadata,
  );
  await mirrorPushDeviceUpsert(c.env, {
    userId: body.userId,
    deviceId: device.deviceId,
    token: device.token,
    platform: device.platform,
    updatedAt: device.updatedAt,
    deviceInfo: device.deviceInfo,
    metadata: body.metadata,
  });

  return c.json({ ok: true });
});

// ─── Internal: Send to a single user's devices ───

async function sendToUser(
  store: KVNamespace | { kv: KVNamespace; authDb?: AuthDb | null },
  provider: FcmProvider,
  userId: string,
  payload: PushPayload,
  env: Env,
): Promise<{ sent: number; failed: number; removed: number }> {
  const kv = 'kv' in store ? store.kv : store;
  const devices = await getDevicesForUser(store, userId);

  if (devices.length === 0) {
    return { sent: 0, failed: 0, removed: 0 };
  }

  let sent = 0;
  let failed = 0;
  let removed = 0;

  // Send to all devices in parallel via FCM
  const sendResults = await Promise.allSettled(
    devices.map(async (device): Promise<{ deviceId: string; platform: string; result: PushSendResult }> => {
      const result = await provider.send({
        token: device.token,
        platform: device.platform,
        payload,
      });
      return { deviceId: device.deviceId, platform: device.platform, result };
    }),
  );

  // Process results
  for (const settled of sendResults) {
    if (settled.status === 'rejected') {
      failed++;
      continue;
    }

    const { deviceId, platform, result } = settled.value;

    if (result.success) {
      sent++;
    } else if (result.remove) {
      removed++;
      await removeDeviceFromUser(store, userId, deviceId);
      await mirrorPushDeviceDelete(env, userId, deviceId);
    } else {
      failed++;
    }

    const logEntry: PushLogEntry = {
      sentAt: new Date().toISOString(),
      userId,
      platform,
      status: result.success ? 'sent' : (result.remove ? 'removed' : 'failed'),
      collapseId: payload.collapseId,
      error: result.error,
      runId: extractPushTraceValue(payload, 'runId'),
      probeId: extractPushTraceValue(payload, 'probeId'),
      title: payload.title,
      body: payload.body,
      target: deviceId,
    };
    await storePushLog(kv, userId, logEntry);
    await mirrorPushLog(env, logEntry);
  }

  return { sent, failed, removed };
}
