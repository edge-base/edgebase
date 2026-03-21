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
const roomRealtimeSessionDescriptionSchema = z.object({
  sdp: z.string().openapi({ description: 'WebRTC session description payload' }),
  type: z.enum(['offer', 'answer']).openapi({ description: 'Session description type' }),
});
const roomRealtimeTrackSchema = z.object({
  location: z.enum(['local', 'remote']).openapi({ description: 'Track direction relative to the caller' }),
  mid: z.string().optional().openapi({ description: 'WebRTC media ID' }),
  sessionId: z.string().optional().openapi({ description: 'Provider session ID associated with this track' }),
  trackName: z.string().optional().openapi({ description: 'Track name used by the provider' }),
  bidirectionalMediaStream: z.boolean().optional().openapi({ description: 'Whether the track should be bidirectional' }),
  kind: z.string().optional().openapi({ description: 'Track kind reported by the provider' }),
  simulcast: z.object({
    preferredRid: z.string().optional(),
    priorityOrdering: z.enum(['none', 'asciibetical']).optional(),
    ridNotAvailable: z.enum(['none', 'asciibetical']).optional(),
  }).optional().openapi({ description: 'Optional simulcast preferences' }),
  errorCode: z.string().optional().openapi({ description: 'Provider-level error code for this track' }),
  errorDescription: z.string().optional().openapi({ description: 'Provider-level error description for this track' }),
});
const roomRealtimeCreateSessionBodySchema = z.object({
  connectionId: z.string().optional().openapi({ description: 'Specific room connection ID to bind the realtime session to' }),
  correlationId: z.string().optional().openapi({ description: 'Optional provider correlation ID' }),
  thirdparty: z.boolean().optional().openapi({ description: 'Forward Cloudflare Realtime thirdparty mode' }),
  sessionDescription: roomRealtimeSessionDescriptionSchema.optional(),
});
const roomCloudflareRealtimeKitCreateSessionBodySchema = z.object({
  connectionId: z.string().optional().openapi({ description: 'Specific room connection ID to bind the Cloudflare RealtimeKit participant to' }),
  customParticipantId: z.string().optional().openapi({ description: 'Optional custom participant identifier for the provisioned RealtimeKit participant' }),
  name: z.string().optional().openapi({ description: 'Optional display name for the provisioned RealtimeKit participant' }),
  picture: z.string().optional().openapi({ description: 'Optional avatar URL for the provisioned RealtimeKit participant' }),
});
const roomRealtimeCreateSessionResponseSchema = z.object({
  sessionId: z.string().openapi({ description: 'Realtime provider session ID' }),
  sessionDescription: roomRealtimeSessionDescriptionSchema.optional(),
  errorCode: z.string().optional(),
  errorDescription: z.string().optional(),
  connectionId: z.string().optional().openapi({ description: 'Room connection ID associated with the session' }),
  reused: z.boolean().optional().openapi({ description: 'Whether an existing provider session was reused' }),
});
const roomCloudflareRealtimeKitCreateSessionResponseSchema = z.object({
  sessionId: z.string().openapi({ description: 'Cloudflare RealtimeKit participant ID' }),
  meetingId: z.string().openapi({ description: 'Cloudflare RealtimeKit meeting ID backing the room session' }),
  participantId: z.string().openapi({ description: 'Cloudflare RealtimeKit participant ID' }),
  authToken: z.string().openapi({ description: 'RealtimeKit auth token for the provisioned participant' }),
  presetName: z.string().optional().openapi({ description: 'RealtimeKit preset used for the provisioned participant' }),
  connectionId: z.string().optional().openapi({ description: 'Room connection ID associated with the session' }),
  reused: z.boolean().optional().openapi({ description: 'Whether an existing provider participant was reused' }),
});
const roomRealtimeSessionStateSchema = z.object({
  sessionId: z.string().openapi({ description: 'Realtime provider session ID' }),
  connectionId: z.string().optional().openapi({ description: 'Room connection ID associated with the session' }),
  createdAt: z.number().openapi({ description: 'Unix epoch milliseconds when the session was created' }),
  updatedAt: z.number().openapi({ description: 'Unix epoch milliseconds when the session was last updated' }),
});
const roomRealtimeIceServerSchema = z.object({
  urls: z.union([z.array(z.string()), z.string()]).openapi({ description: 'ICE server URL or URL list' }),
  username: z.string().optional(),
  credential: z.string().optional(),
});
const roomRealtimeIceServersBodySchema = z.object({
  ttl: z.number().optional().openapi({ description: 'Requested TURN credential TTL in seconds' }),
});
const roomRealtimeIceServersResponseSchema = z.object({
  iceServers: z.array(roomRealtimeIceServerSchema).openapi({ description: 'ICE servers returned by Cloudflare TURN' }),
});
const roomRealtimeTracksResponseSchema = z.object({
  errorCode: z.string().optional(),
  errorDescription: z.string().optional(),
  requiresImmediateRenegotiation: z.boolean().optional(),
  sessionDescription: roomRealtimeSessionDescriptionSchema.optional(),
  tracks: z.array(roomRealtimeTrackSchema).optional(),
});
const roomRealtimeTracksBodySchema = z.object({
  sessionId: z.string().openapi({ description: 'Realtime provider session ID' }),
  connectionId: z.string().optional().openapi({ description: 'Specific room connection ID to bind the track operation to' }),
  sessionDescription: roomRealtimeSessionDescriptionSchema.optional(),
  tracks: z.array(roomRealtimeTrackSchema).min(1).openapi({ description: 'Tracks to create or subscribe to' }),
  autoDiscover: z.boolean().optional().openapi({ description: 'Ask the provider to auto-discover remote tracks' }),
  publish: z.object({
    kind: z.enum(['audio', 'video', 'screen']).optional(),
    trackId: z.string().optional(),
    deviceId: z.string().optional(),
    muted: z.boolean().optional(),
  }).optional().openapi({ description: 'Optional room media state updates to apply after track creation' }),
});
const roomRealtimeRenegotiateBodySchema = z.object({
  sessionId: z.string().openapi({ description: 'Realtime provider session ID' }),
  connectionId: z.string().optional().openapi({ description: 'Specific room connection ID to bind the renegotiation to' }),
  sessionDescription: roomRealtimeSessionDescriptionSchema,
});
const roomRealtimeCloseTracksBodySchema = z.object({
  sessionId: z.string().openapi({ description: 'Realtime provider session ID' }),
  connectionId: z.string().optional().openapi({ description: 'Specific room connection ID to bind the close operation to' }),
  sessionDescription: roomRealtimeSessionDescriptionSchema.optional(),
  tracks: z.array(z.object({
    mid: z.string().openapi({ description: 'Track MID to close' }),
  })).min(1).openapi({ description: 'Tracks to close' }),
  force: z.boolean().optional().openapi({ description: 'Force close even if the provider reports the track as active' }),
  unpublish: z.object({
    kind: z.enum(['audio', 'video', 'screen']).optional(),
  }).optional().openapi({ description: 'Optional room media state cleanup after closing tracks' }),
});

function isRoomOperationPublic(
  namespaceConfig: RoomNamespaceConfig | null | undefined,
  operation: 'metadata' | 'join' | 'action',
): boolean {
  if (!namespaceConfig?.public) return false;
  if (namespaceConfig.public === true) return true;
  return !!namespaceConfig.public[operation];
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
    return c.json({ code: 400, message: 'namespace and id query parameters required' }, 400);
  }

  if (options?.requireAuth && !c.get('auth')) {
    return c.json({ code: 401, message: 'Authentication required' }, 401);
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
      const warningKey = `${namespace}:metadata`;
      if (!roomFallbackWarnings.has(warningKey)) {
        roomFallbackWarnings.add(warningKey);
        console.warn(`[Room] ${warningKey} is using development-mode allow-by-default. Add rooms.${namespace}.access.metadata or public.metadata to make this explicit.`);
      }
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

const getRoomRealtimeSession = createRoute({
  operationId: 'getRoomRealtimeSession',
  method: 'get',
  path: '/media/realtime/session',
  tags: ['client'],
  summary: 'Get the active room realtime media session',
  description: 'Returns the provider session currently bound to the authenticated room member.',
  request: {
    query: roomQuerySchema.extend({
      connectionId: z.string().optional().openapi({ description: 'Optional room connection ID override' }),
    }),
  },
  responses: {
    200: { description: 'Active room realtime session', content: { 'application/json': { schema: roomRealtimeSessionStateSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'No active session or runtime not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const createRoomRealtimeSession = createRoute({
  operationId: 'createRoomRealtimeSession',
  method: 'post',
  path: '/media/realtime/session',
  tags: ['client'],
  summary: 'Create a room realtime media session',
  description: 'Creates a Cloudflare Realtime session for the authenticated room member.',
  request: {
    query: roomQuerySchema,
    body: { content: { 'application/json': { schema: roomRealtimeCreateSessionBodySchema } }, required: false },
  },
  responses: {
    200: { description: 'Realtime session created', content: { 'application/json': { schema: roomRealtimeCreateSessionResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Room runtime not found', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Conflicting existing published media', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const createRoomCloudflareRealtimeKitSession = createRoute({
  operationId: 'createRoomCloudflareRealtimeKitSession',
  method: 'post',
  path: '/media/cloudflare_realtimekit/session',
  tags: ['client'],
  summary: 'Create a room Cloudflare RealtimeKit session',
  description: 'Creates a Cloudflare RealtimeKit session for the authenticated room member.',
  request: {
    query: roomQuerySchema,
    body: { content: { 'application/json': { schema: roomCloudflareRealtimeKitCreateSessionBodySchema } }, required: false },
  },
  responses: {
    200: { description: 'Cloudflare RealtimeKit session created', content: { 'application/json': { schema: roomCloudflareRealtimeKitCreateSessionResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Room runtime not found', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Conflicting existing published media', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const createRoomRealtimeIceServers = createRoute({
  operationId: 'createRoomRealtimeIceServers',
  method: 'post',
  path: '/media/realtime/turn',
  tags: ['client'],
  summary: 'Generate TURN / ICE credentials for room realtime media',
  description: 'Generates ICE server credentials for the authenticated room member.',
  request: {
    query: roomQuerySchema,
    body: { content: { 'application/json': { schema: roomRealtimeIceServersBodySchema } }, required: false },
  },
  responses: {
    200: { description: 'ICE servers generated', content: { 'application/json': { schema: roomRealtimeIceServersResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Room runtime not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const addRoomRealtimeTracks = createRoute({
  operationId: 'addRoomRealtimeTracks',
  method: 'post',
  path: '/media/realtime/tracks/new',
  tags: ['client'],
  summary: 'Add realtime media tracks to a room session',
  description: 'Creates or subscribes realtime tracks for the authenticated room member.',
  request: {
    query: roomQuerySchema,
    body: { content: { 'application/json': { schema: roomRealtimeTracksBodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Realtime tracks updated', content: { 'application/json': { schema: roomRealtimeTracksResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Room runtime not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const renegotiateRoomRealtimeSession = createRoute({
  operationId: 'renegotiateRoomRealtimeSession',
  method: 'put',
  path: '/media/realtime/renegotiate',
  tags: ['client'],
  summary: 'Renegotiate a room realtime media session',
  description: 'Submits a new session description for an existing room realtime media session.',
  request: {
    query: roomQuerySchema,
    body: { content: { 'application/json': { schema: roomRealtimeRenegotiateBodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Realtime session renegotiated', content: { 'application/json': { schema: roomRealtimeTracksResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Room runtime not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const closeRoomRealtimeTracks = createRoute({
  operationId: 'closeRoomRealtimeTracks',
  method: 'put',
  path: '/media/realtime/tracks/close',
  tags: ['client'],
  summary: 'Close room realtime media tracks',
  description: 'Closes provider tracks for the authenticated room member and optionally unpublishes room media state.',
  request: {
    query: roomQuerySchema,
    body: { content: { 'application/json': { schema: roomRealtimeCloseTracksBodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Realtime tracks closed', content: { 'application/json': { schema: roomRealtimeTracksResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Room runtime not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

roomRoute.openapi(getRoomRealtimeSession, async (c) =>
  proxyRoomDoRequest(c, '/media/realtime/session', 'GET', { requireAuth: true }));

roomRoute.openapi(createRoomRealtimeSession, async (c) =>
  proxyRoomDoRequest(c, '/media/realtime/session', 'POST', {
    requireAuth: true,
    validatedJson: c.req.valid('json'),
  }));

roomRoute.openapi(createRoomRealtimeIceServers, async (c) =>
  proxyRoomDoRequest(c, '/media/realtime/turn', 'POST', {
    requireAuth: true,
    validatedJson: c.req.valid('json'),
  }));

roomRoute.openapi(addRoomRealtimeTracks, async (c) =>
  proxyRoomDoRequest(c, '/media/realtime/tracks/new', 'POST', {
    requireAuth: true,
    validatedJson: c.req.valid('json'),
  }));

roomRoute.openapi(renegotiateRoomRealtimeSession, async (c) =>
  proxyRoomDoRequest(c, '/media/realtime/renegotiate', 'PUT', {
    requireAuth: true,
    validatedJson: c.req.valid('json'),
  }));

roomRoute.openapi(closeRoomRealtimeTracks, async (c) =>
  proxyRoomDoRequest(c, '/media/realtime/tracks/close', 'PUT', {
    requireAuth: true,
    validatedJson: c.req.valid('json'),
  }));

roomRoute.openapi(createRoomCloudflareRealtimeKitSession, async (c) =>
  proxyRoomDoRequest(c, '/media/cloudflare_realtimekit/session', 'POST', {
    requireAuth: true,
    validatedJson: c.req.valid('json'),
  }));
