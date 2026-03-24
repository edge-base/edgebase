import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import {
  acquirePendingWebSocketSlot,
  getPendingWebSocketCount,
  releasePendingWebSocketSlot,
} from '../lib/websocket-pending.js';
import {
  buildDbLiveChannel,
  DATABASE_LIVE_HUB_DO_NAME,
  isDbLiveChannel,
} from '../lib/database-live-emitter.js';
import {
  formatDbTargetValidationIssue,
  isDynamicDbBlock,
  parseConfig,
  resolveDbTarget,
} from '../lib/do-router.js';
import { validateKey, buildConstraintCtx } from '../lib/service-key.js';
import { getTrustedClientIp } from '../lib/client-ip.js';
import {
  zodDefaultHook,
  broadcastBodySchema,
  jsonResponseSchema,
  errorResponseSchema,
} from '../lib/schemas.js';

export const databaseLiveRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

const MAX_PENDING_PER_IP = 5;
const PENDING_TTL_SECONDS = 60;
const dbLiveQuerySchema = z.object({
  channel: z.string().optional().openapi({ description: 'Legacy DB subscription channel name' }),
  namespace: z.string().optional().openapi({ description: 'Database namespace', example: 'shared' }),
  instanceId: z.string().optional().openapi({ description: 'Database instance ID for dynamic DB blocks', example: 'ws-456' }),
  table: z.string().optional().openapi({ description: 'Table name', example: 'posts' }),
  docId: z.string().optional().openapi({ description: 'Optional document ID for single-document subscriptions', example: 'post-1' }),
}).refine(
  (value) => {
    if (value.channel) return true;
    return !!value.namespace && !!value.table;
  },
  {
    message: 'Provide channel or namespace + table',
    path: ['channel'],
  },
);

const dbConnectDiagnosticSchema = z.object({
  ok: z.boolean(),
  type: z.string(),
  category: z.string(),
  message: z.string(),
  channel: z.string().optional(),
  pendingCount: z.number().optional(),
  maxPending: z.number().optional(),
});

function resolveStructuredDatabaseLiveChannel(
  config: ReturnType<typeof parseConfig>,
  query: {
    namespace?: string;
    instanceId?: string;
    table?: string;
    docId?: string;
  },
): { ok: true; channel: string } | { ok: false; message: string } {
  if (!query.namespace || !query.table) {
    return { ok: false, message: 'Database subscription target required' };
  }

  const target = resolveDbTarget(config, query.namespace, query.instanceId);
  if (!target.ok) {
    return {
      ok: false,
      message: formatDbTargetValidationIssue(target.issue, query.namespace),
    };
  }
  if (!target.value.dbBlock.tables?.[query.table]) {
    return {
      ok: false,
      message: `Table '${query.table}' not found in database '${query.namespace}'`,
    };
  }

  const channel = buildDbLiveChannel(
    query.namespace,
    query.table,
    target.value.instanceId,
    query.docId,
  );
  if (!isDbLiveChannel(channel)) {
    return { ok: false, message: 'Invalid database subscription target' };
  }

  return { ok: true, channel };
}

function resolveDatabaseLiveChannel(
  config: ReturnType<typeof parseConfig>,
  query: {
  channel?: string;
  namespace?: string;
  instanceId?: string;
  table?: string;
  docId?: string;
}): { ok: true; channel: string } | { ok: false; message: string } {
  if (query.channel) {
    if (!isDbLiveChannel(query.channel)) {
      return {
        ok: false,
        message: `Database live only supports DB channels: ${query.channel}`,
      };
    }

    const parts = query.channel.split(':');
    const namespace = parts[1];
    if (!namespace) {
      return { ok: false, message: 'Database subscription target required' };
    }

    const dbBlock = config.databases?.[namespace];
    if (!dbBlock) {
      return {
        ok: false,
        message: formatDbTargetValidationIssue('namespace_not_found', namespace),
      };
    }

    const dynamic = isDynamicDbBlock(dbBlock);
    if (dynamic && parts.length < 4) {
      return {
        ok: false,
        message: formatDbTargetValidationIssue('instance_id_required', namespace),
      };
    }
    if (!dynamic && parts.length > 4) {
      return {
        ok: false,
        message: formatDbTargetValidationIssue('instance_id_not_allowed', namespace),
      };
    }

    const structured = dynamic
      ? {
          namespace,
          instanceId: parts[2],
          table: parts[3],
          docId: parts[4],
        }
      : {
          namespace,
          table: parts[2],
          docId: parts[3],
        };
    return resolveStructuredDatabaseLiveChannel(config, structured);
  }

  return resolveStructuredDatabaseLiveChannel(config, query);
}

function getPendingKey(ip: string): string {
  return `ws:pending:${ip}`;
}

const checkDatabaseConnection = createRoute({
  operationId: 'checkDatabaseSubscriptionConnection',
  method: 'get',
  path: '/connect-check',
  tags: ['client'],
  summary: 'Check database live subscription WebSocket prerequisites',
  request: {
    query: dbLiveQuerySchema,
  },
  responses: {
    200: { description: 'Database live connection looks ready', content: { 'application/json': { schema: dbConnectDiagnosticSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: dbConnectDiagnosticSchema } } },
    429: { description: 'Rate limited', content: { 'application/json': { schema: dbConnectDiagnosticSchema } } },
  },
});

databaseLiveRoute.openapi(checkDatabaseConnection, async (c) => {
  const config = parseConfig(c.env);
  const channelResult = resolveDatabaseLiveChannel(config, {
    channel: c.req.query('channel') ?? undefined,
    namespace: c.req.query('namespace') ?? undefined,
    instanceId: c.req.query('instanceId') ?? undefined,
    table: c.req.query('table') ?? undefined,
    docId: c.req.query('docId') ?? undefined,
  });

  if (!channelResult.ok) {
    return c.json({
      ok: false,
      type: 'db_connect_invalid_request',
      category: 'request',
      message: channelResult.message,
    }, 400);
  }
  const channel = channelResult.channel;

  const ip = getTrustedClientIp(c.env, c.req) ?? 'unknown';
  const kvKey = getPendingKey(ip);
  const pendingCount = await getPendingWebSocketCount(c.env.KV, kvKey).catch(() => 0);
  if (pendingCount >= MAX_PENDING_PER_IP) {
    return c.json({
      ok: false,
      type: 'db_connect_rate_limited',
      category: 'rate_limit',
      message: 'Too many pending WebSocket connections',
      channel,
      pendingCount,
      maxPending: MAX_PENDING_PER_IP,
    }, 429);
  }

  return c.json({
    ok: true,
    type: 'db_connect_ready',
    category: 'ready',
    message: 'Database live subscription preflight passed',
    channel,
    pendingCount,
    maxPending: MAX_PENDING_PER_IP,
  }, 200);
});

const connectDatabaseSubscription = createRoute({
  operationId: 'connectDatabaseSubscription',
  method: 'get',
  path: '/subscribe',
  tags: ['client'],
  summary: 'Connect to database live subscriptions WebSocket',
  description: 'Database-owned WebSocket entrypoint for onSnapshot subscriptions. Requires Upgrade: websocket header.',
  request: {
    query: dbLiveQuerySchema,
  },
  responses: {
    101: { description: 'WebSocket upgrade successful' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Rate limited', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

/**
 * POST /broadcast
 * Server-side broadcast to a database-live channel.
 * Service Key required AND validated.
 * Body: { channel: string, event: string, payload?: Record<string, unknown> }
 */
const databaseLiveBroadcast = createRoute({
  operationId: 'databaseLiveBroadcast',
  method: 'post',
  path: '/broadcast',
  tags: ['admin'],
  summary: 'Broadcast to database live channel',
  request: {
    body: { content: { 'application/json': { schema: broadcastBodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Broadcast sent', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

databaseLiveRoute.openapi(databaseLiveBroadcast, async (c) => {
  let body: { channel?: string; event?: string; payload?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: 'Invalid JSON body' }, 400);
  }

  const { channel, event, payload } = body;
  if (!channel || typeof channel !== 'string') {
    return c.json({ code: 400, message: 'channel is required' }, 400);
  }
  if (!event || typeof event !== 'string') {
    return c.json({ code: 400, message: 'event is required' }, 400);
  }

  // Service Key required AND validated
  const config = parseConfig(c.env);
  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    `db:channel:${channel}:broadcast`,
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: 'Service Key required for server broadcast' }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: 'Unauthorized. Invalid Service Key.' }, 401);
  }

  // Route broadcast through the DatabaseLiveDO hub
  const doId = c.env.DATABASE_LIVE.idFromName(DATABASE_LIVE_HUB_DO_NAME);
  const doStub = c.env.DATABASE_LIVE.get(doId);

  const doResponse = await doStub.fetch(new Request('http://do/internal/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, event, payload: payload ?? {} }),
  }));

  if (!doResponse.ok) {
    return c.json({ code: doResponse.status, message: 'Broadcast failed' }, doResponse.status as 400 | 500);
  }

  return c.json({ ok: true });
});

databaseLiveRoute.openapi(connectDatabaseSubscription, async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.json({ code: 400, message: 'Expected WebSocket upgrade' }, 400);
  }

  const config = parseConfig(c.env);
  const channelResult = resolveDatabaseLiveChannel(config, {
    channel: c.req.query('channel') ?? undefined,
    namespace: c.req.query('namespace') ?? undefined,
    instanceId: c.req.query('instanceId') ?? undefined,
    table: c.req.query('table') ?? undefined,
    docId: c.req.query('docId') ?? undefined,
  });
  if (!channelResult.ok) {
    return c.json({ code: 400, message: channelResult.message }, 400);
  }
  const channel = channelResult.channel;

  const ip = getTrustedClientIp(c.env, c.req) ?? 'unknown';
  const kvKey = getPendingKey(ip);
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
        message: 'Too many pending WebSocket connections',
      }, 429);
    }
  } catch {
    // KV failure shouldn't block legitimate connections
  }

  const doId = c.env.DATABASE_LIVE.idFromName(DATABASE_LIVE_HUB_DO_NAME);
  const doStub = c.env.DATABASE_LIVE.get(doId);

  const url = new URL(c.req.url);
  url.pathname = '/websocket';
  url.search = '';
  url.searchParams.set('channel', channel);
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
