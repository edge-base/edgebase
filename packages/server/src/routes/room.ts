/**
 * Room WebSocket route — /api/room
 *
 * Handles WebSocket upgrade requests and routes to Room DO.
 * v2: namespace + roomId identification.
 *
 * URL: /api/room?namespace={ns}&id={roomId}
 * DO name: namespace::roomId
 *
 * DDoS defense (same pattern as Database Live,):
 *   - IP-based pending connection limit (5 max)
 *   - KV counter with expirationTtl: 60s
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import type { RoomNamespaceConfig } from '@edge-base/shared';
import type { Context } from 'hono';
import { parseConfig } from '../lib/do-router.js';
import { resolveRoomRuntime } from '../lib/room-runtime.js';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import {
  acquirePendingWebSocketSlot,
  getPendingWebSocketCount,
  releasePendingWebSocketSlot,
} from '../lib/websocket-pending.js';
import { getTrustedClientIp } from '../lib/client-ip.js';


export const roomRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

const MAX_PENDING_PER_IP = 5;
const PENDING_TTL_SECONDS = 60;
const roomFallbackWarnings = new Set<string>();
const roomQuerySchema = z.object({
  namespace: z.string().openapi({ description: 'Room namespace' }),
  id: z.string().openapi({ description: 'Room ID' }),
});
const roomConnectDiagnosticSchema = z.object({
  ok: z.boolean(),
  type: z.string(),
  category: z.string(),
  message: z.string(),
  namespace: z.string().optional(),
  roomId: z.string().optional(),
  runtime: z.string().optional(),
  pendingCount: z.number().optional(),
  maxPending: z.number().optional(),
});
const roomSummarySchema = z.object({
  namespace: z.string(),
  roomId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  occupancy: z.object({
    activeMembers: z.number(),
    activeConnections: z.number(),
  }),
  updatedAt: z.string(),
});
const roomSummaryBatchBodySchema = z.object({
  namespace: z.string().openapi({ description: 'Room namespace shared by the requested room IDs' }),
  ids: z.array(z.string()).min(1).max(100).openapi({ description: 'Room IDs to summarize' }),
});
const roomSummaryCollectionSchema = z.object({
  namespace: z.string(),
  items: z.array(roomSummarySchema),
  deniedIds: z.array(z.string()),
  updatedAt: z.string(),
});
function isRoomOperationPublic(
  namespaceConfig: RoomNamespaceConfig | null | undefined,
  operation: 'metadata' | 'join' | 'action',
): boolean {
  if (!namespaceConfig?.public) return false;
  if (namespaceConfig.public === true) return true;
  return !!namespaceConfig.public[operation];
}

function warnRoomDevelopmentFallback(
  namespace: string,
  operation: 'metadata' | 'join' | 'action',
): void {
  const warningKey = `${namespace}:${operation}`;
  if (roomFallbackWarnings.has(warningKey)) {
    return;
  }
  roomFallbackWarnings.add(warningKey);
  console.warn(
    `[Room] ${warningKey} is allowed because release=false and no explicit room rule was found. `
    + `This fallback is local-dev only. Add rooms.${namespace}.access.${operation} or set `
    + `rooms.${namespace}.public.${operation}=true to make the behavior explicit.`,
  );
}

function getRoomAuthContext(
  auth: {
    id?: string;
    role?: string;
    email?: string | null;
    custom?: Record<string, unknown> | null;
    isAnonymous?: boolean;
    meta?: Record<string, unknown>;
  } | null | undefined,
) {
  if (!auth?.id) return null;
  return {
    id: auth.id,
    role: auth.role,
    email: auth.email ?? undefined,
    custom: auth.custom ?? undefined,
    isAnonymous: auth.isAnonymous,
    meta: auth.meta,
  };
}

export async function proxyRoomDoRequest(
  c: Context<HonoEnv>,
  path: string,
  method: string,
  options?: { requireAuth?: boolean; validatedJson?: unknown },
): Promise<Response> {
  const namespace = c.req.query('namespace');
  const roomId = c.req.query('id');

  if (!namespace || !roomId) {
    return c.json({ code: 400, message: "Missing required query parameters 'namespace' and 'id' for room requests." }, 400);
  }

  if (options?.requireAuth && !c.get('auth')) {
    return c.json({ code: 401, message: 'Authentication required. Sign in before trying to access this room.' }, 401);
  }

  const config = parseConfig(c.env);
  if (config.release && !config.rooms?.[namespace]) {
    return c.json({ code: 403, message: `Room namespace '${namespace}' not configured` }, 403);
  }

  const runtime = resolveRoomRuntime(c.env);
  if (!runtime.binding) {
    return c.json({ code: 404, message: `Room runtime '${runtime.target}' not configured` }, 404);
  }

  const doName = `${namespace}::${roomId}`;
  const doId = runtime.binding.idFromName(doName);
  const doStub = runtime.binding.get(doId);

  const url = new URL(c.req.url);
  url.pathname = path;
  url.searchParams.set('room', doName);
  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (!c.req.raw.bodyUsed) {
      body = await c.req.raw.clone().arrayBuffer().catch(() => undefined);
    }

    if ((!body || body.byteLength === 0) && options?.validatedJson !== undefined) {
      body = new TextEncoder().encode(JSON.stringify(options.validatedJson)).buffer;
    }
  }

  const doRequest = new Request(url.toString(), {
    method,
    headers: c.req.raw.headers,
    body: body && body.byteLength > 0 ? body : undefined,
  });

  return doStub.fetch(doRequest);
}

const connectRoom = createRoute({
  operationId: 'connectRoom',
  method: 'get',
  path: '/',
  tags: ['client'],
  summary: 'Connect to room WebSocket',
  description: 'WebSocket upgrade endpoint for Room connections. Requires Upgrade: websocket header.',
  request: {
    query: roomQuerySchema,
  },
  responses: {
    101: { description: 'WebSocket upgrade successful' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Rate limited', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const roomConnectCheck = createRoute({
  operationId: 'checkRoomConnection',
  method: 'get',
  path: '/connect-check',
  tags: ['client'],
  summary: 'Check room WebSocket connection prerequisites',
  request: {
    query: roomQuerySchema,
  },
  responses: {
    200: { description: 'Room connection looks ready', content: { 'application/json': { schema: roomConnectDiagnosticSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: roomConnectDiagnosticSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: roomConnectDiagnosticSchema } } },
    404: { description: 'Room feature not configured', content: { 'application/json': { schema: roomConnectDiagnosticSchema } } },
    429: { description: 'Rate limited', content: { 'application/json': { schema: roomConnectDiagnosticSchema } } },
  },
});

roomRoute.openapi(roomConnectCheck, async (c) => {
  const namespace = c.req.query('namespace');
  const roomId = c.req.query('id');
  if (!namespace || !roomId) {
    return c.json({
      ok: false,
      type: 'room_connect_invalid_request',
      category: 'request',
      message: 'namespace and id query parameters required',
    }, 400);
  }

  const config = parseConfig(c.env);
  if (config.release && !config.rooms?.[namespace]) {
    return c.json({
      ok: false,
      type: 'room_namespace_not_configured',
      category: 'config',
      message: `Room namespace '${namespace}' not configured`,
      namespace,
      roomId,
    }, 403);
  }

  const runtime = resolveRoomRuntime(c.env);
  if (!runtime.binding) {
    return c.json({
      ok: false,
      type: 'room_runtime_unconfigured',
      category: 'config',
      message: `Room runtime '${runtime.target}' not configured`,
      namespace,
      roomId,
      runtime: runtime.target,
    }, 404);
  }

  const ip = getTrustedClientIp(c.env, c.req) ?? 'unknown';
  const kvKey = `ws:room:pending:${ip}`;
  const pendingCount = await getPendingWebSocketCount(c.env.KV, kvKey).catch(() => 0);
  if (pendingCount >= MAX_PENDING_PER_IP) {
    return c.json({
      ok: false,
      type: 'room_connect_rate_limited',
      category: 'rate_limit',
      message: 'Too many pending Room connections',
      namespace,
      roomId,
      runtime: runtime.target,
      pendingCount,
      maxPending: MAX_PENDING_PER_IP,
    }, 429);
  }

  return c.json({
    ok: true,
    type: 'room_connect_ready',
    category: 'ready',
    message: 'Room WebSocket preflight passed',
    namespace,
    roomId,
    runtime: runtime.target,
    pendingCount,
    maxPending: MAX_PENDING_PER_IP,
  }, 200);
});

roomRoute.openapi(connectRoom, async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.json({ code: 400, message: 'Expected WebSocket upgrade' }, 400);
  }

  const namespace = c.req.query('namespace');
  const roomId = c.req.query('id');

  if (!namespace || !roomId) {
    return c.json({ code: 400, message: 'namespace and id query parameters required' }, 400);
  }

  // ─── Validate namespace against config ───
  const config = parseConfig(c.env);
  if (config.release) {
    if (!config.rooms?.[namespace]) {
      return c.json({
        code: 403,
        message: `Room namespace '${namespace}' not configured`,
      }, 403);
    }
  }

  const runtime = resolveRoomRuntime(c.env);
  if (!runtime.binding) {
    return c.json({ code: 404, message: `Room runtime '${runtime.target}' not configured` }, 404);
  }

  // ─── DDoS Defense: IP-based pending connection limit ───
  const ip = getTrustedClientIp(c.env, c.req) ?? 'unknown';
  const kvKey = `ws:room:pending:${ip}`;
  let pendingTracked = false;

  try {
    pendingTracked = await acquirePendingWebSocketSlot(
      c.env.KV,
      kvKey,
      MAX_PENDING_PER_IP,
      PENDING_TTL_SECONDS,
    );
    if (!pendingTracked) {
      return c.json({
        code: 429,
        message: 'Too many pending Room connections',
      }, 429);
    }
  } catch {
    // KV failure shouldn't block legitimate connections
  }

  // ─── Route to Room DO ───
  const doName = `${namespace}::${roomId}`;
  const doId = runtime.binding.idFromName(doName);
  const doStub = runtime.binding.get(doId);

  const url = new URL(c.req.url);
  url.pathname = '/websocket';
  url.searchParams.set('room', doName);
  const doRequest = new Request(url.toString(), {
    headers: c.req.raw.headers,
  });

  try {
    return await doStub.fetch(doRequest);
  } finally {
    if (pendingTracked) {
      try {
        await releasePendingWebSocketSlot(c.env.KV, kvKey, PENDING_TTL_SECONDS);
      } catch {
        // KV failure shouldn't break an already accepted connection.
      }
    }
  }
});

/**
 * GET /room/metadata?namespace={ns}&id={roomId}
 * HTTP endpoint to query room metadata without joining.
 * In release mode, metadata requires either an explicit access rule or public.metadata opt-in.
 */
const getRoomMetadata = createRoute({
  operationId: 'getRoomMetadata',
  method: 'get',
  path: '/metadata',
  tags: ['client'],
  summary: 'Get room metadata',
  request: {
    query: roomQuerySchema,
  },
  responses: {
    200: { description: 'Room metadata', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const getRoomSummary = createRoute({
  operationId: 'getRoomSummary',
  method: 'get',
  path: '/summary',
  tags: ['client'],
  summary: 'Get room summary',
  description: 'Returns lobby-safe room metadata plus current occupancy without joining the room.',
  request: {
    query: roomQuerySchema,
  },
  responses: {
    200: { description: 'Room summary', content: { 'application/json': { schema: roomSummarySchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const getRoomSummaries = createRoute({
  operationId: 'getRoomSummaries',
  method: 'post',
  path: '/summaries',
  tags: ['client'],
  summary: 'Get summaries for multiple rooms',
  description: 'Returns lobby-safe room metadata plus current occupancy for multiple room IDs in the same namespace.',
  request: {
    body: { content: { 'application/json': { schema: roomSummaryBatchBodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Room summaries', content: { 'application/json': { schema: roomSummaryCollectionSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Room feature not configured', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

roomRoute.openapi(getRoomMetadata, async (c) => {
  const namespace = c.req.query('namespace');
  const roomId = c.req.query('id');

  if (!namespace || !roomId) {
    return c.json({ code: 400, message: 'namespace and id query parameters required' }, 400);
  }

  // Validate namespace against config
  const config = parseConfig(c.env);
  const namespaceConfig = config.rooms?.[namespace];
  if (config.release) {
    if (!config.rooms?.[namespace]) {
      return c.json({
        code: 403,
        message: `Room namespace '${namespace}' not configured`,
      }, 403);
    }
  }

  const metadataAccess = namespaceConfig?.access?.metadata;
  if (!metadataAccess) {
    if (config.release && !isRoomOperationPublic(namespaceConfig, 'metadata')) {
      return c.json({ code: 403, message: 'Room metadata requires access.metadata or public.metadata in release mode' }, 403);
    }
    if (!config.release) {
      warnRoomDevelopmentFallback(namespace, 'metadata');
    }
  }
  if (metadataAccess) {
    const auth = (c.get('auth') as { id?: string; role?: string; email?: string | null; custom?: Record<string, unknown> | null; isAnonymous?: boolean; meta?: Record<string, unknown> } | null | undefined) ?? null;
    const allowed = await Promise.resolve(metadataAccess(
      getRoomAuthContext(auth),
      roomId,
    )).catch(() => false);
    if (!allowed) {
      return c.json({ code: 403, message: 'Denied by room metadata access rule' }, 403);
    }
  }

  const runtime = resolveRoomRuntime(c.env);
  if (!runtime.binding) {
    return c.json({ code: 404, message: `Room runtime '${runtime.target}' not configured` }, 404);
  }

  // Route to Room DO
  const doName = `${namespace}::${roomId}`;
  const doId = runtime.binding.idFromName(doName);
  const doStub = runtime.binding.get(doId);

  const url = new URL(c.req.url);
  url.pathname = '/metadata';
  url.searchParams.set('room', doName);
  const doRequest = new Request(url.toString(), {
    method: 'GET',
    headers: c.req.raw.headers,
  });

  return doStub.fetch(doRequest);
});

roomRoute.openapi(getRoomSummary, async (c) => {
  const namespace = c.req.query('namespace');
  const roomId = c.req.query('id');

  if (!namespace || !roomId) {
    return c.json({ code: 400, message: 'namespace and id query parameters required' }, 400);
  }

  const config = parseConfig(c.env);
  const namespaceConfig = config.rooms?.[namespace];
  if (config.release) {
    if (!config.rooms?.[namespace]) {
      return c.json({
        code: 403,
        message: `Room namespace '${namespace}' not configured`,
      }, 403);
    }
  }

  const metadataAccess = namespaceConfig?.access?.metadata;
  if (!metadataAccess) {
    if (config.release && !isRoomOperationPublic(namespaceConfig, 'metadata')) {
      return c.json({ code: 403, message: 'Room summary requires access.metadata or public.metadata in release mode' }, 403);
    }
    if (!config.release) {
      warnRoomDevelopmentFallback(namespace, 'metadata');
    }
  }
  if (metadataAccess) {
    const auth = (c.get('auth') as { id?: string; role?: string; email?: string | null; custom?: Record<string, unknown> | null; isAnonymous?: boolean; meta?: Record<string, unknown> } | null | undefined) ?? null;
    const allowed = await Promise.resolve(metadataAccess(
      getRoomAuthContext(auth),
      roomId,
    )).catch(() => false);
    if (!allowed) {
      return c.json({ code: 403, message: 'Denied by room metadata access rule' }, 403);
    }
  }

  const runtime = resolveRoomRuntime(c.env);
  if (!runtime.binding) {
    return c.json({ code: 404, message: `Room runtime '${runtime.target}' not configured` }, 404);
  }

  const doName = `${namespace}::${roomId}`;
  const doId = runtime.binding.idFromName(doName);
  const doStub = runtime.binding.get(doId);

  const url = new URL(c.req.url);
  url.pathname = '/summary';
  url.searchParams.set('room', doName);
  const doRequest = new Request(url.toString(), {
    method: 'GET',
    headers: c.req.raw.headers,
  });

  return doStub.fetch(doRequest);
});

roomRoute.openapi(getRoomSummaries, async (c) => {
  const body = c.req.valid('json') as z.infer<typeof roomSummaryBatchBodySchema>;
  const namespace = body.namespace;
  const roomIds = [...new Set(body.ids)];

  const config = parseConfig(c.env);
  const namespaceConfig = config.rooms?.[namespace];
  if (config.release && !namespaceConfig) {
    return c.json({
      code: 403,
      message: `Room namespace '${namespace}' not configured`,
    }, 403);
  }

  const metadataAccess = namespaceConfig?.access?.metadata;
  if (!metadataAccess) {
    if (config.release && !isRoomOperationPublic(namespaceConfig, 'metadata')) {
      return c.json({ code: 403, message: 'Room summaries require access.metadata or public.metadata in release mode' }, 403);
    }
    if (!config.release) {
      warnRoomDevelopmentFallback(namespace, 'metadata');
    }
  }

  const runtime = resolveRoomRuntime(c.env);
  if (!runtime.binding) {
    return c.json({ code: 404, message: `Room runtime '${runtime.target}' not configured` }, 404);
  }

  const auth = (c.get('auth') as { id?: string; role?: string; email?: string | null; custom?: Record<string, unknown> | null; isAnonymous?: boolean; meta?: Record<string, unknown> } | null | undefined) ?? null;
  const authContext = getRoomAuthContext(auth);
  const allowedRoomIds: string[] = [];
  const deniedIds: string[] = [];

  if (metadataAccess) {
    for (const roomId of roomIds) {
      const allowed = await Promise.resolve(metadataAccess(authContext, roomId)).catch(() => false);
      if (allowed) {
        allowedRoomIds.push(roomId);
      } else {
        deniedIds.push(roomId);
      }
    }
  } else {
    allowedRoomIds.push(...roomIds);
  }

  const items = await Promise.all(
    allowedRoomIds.map(async (roomId) => {
      const doName = `${namespace}::${roomId}`;
      const doId = runtime.binding!.idFromName(doName);
      const doStub = runtime.binding!.get(doId);

      const url = new URL(c.req.url);
      url.pathname = '/summary';
      url.searchParams.set('room', doName);
      const doResponse = await doStub.fetch(new Request(url.toString(), {
        method: 'GET',
        headers: c.req.raw.headers,
      }));

      if (!doResponse.ok) {
        const errorPayload = await doResponse.json().catch(() => null) as { message?: string } | null;
        throw new Error(
          errorPayload?.message
            ?? `Failed to load room summary for '${roomId}' in namespace '${namespace}'.`,
        );
      }

      return doResponse.json() as Promise<z.infer<typeof roomSummarySchema>>;
    }),
  );

  return c.json({
    namespace,
    items,
    deniedIds,
    updatedAt: new Date().toISOString(),
  });
});
