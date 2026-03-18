/**
 * Analytics API route — /api/analytics
 *
 * Endpoints:
 *   GET  /api/analytics/query  — Query request log metrics (Service Key required)
 *   POST /api/analytics/track  — Track custom events (JWT / Service Key / anonymous)
 *   GET  /api/analytics/events — Query custom events (Service Key required)
 *
 * This route is consumed by @edge-base/admin and @edge-base/web SDKs.
 * The admin dashboard uses /admin/api/data/analytics instead (separate auth).
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import type { Env } from '../types.js';
import { parseConfig } from '../lib/do-router.js';
import { validateKey, buildConstraintCtx, resolveServiceKeyCandidate } from '../lib/service-key.js';
import { EdgeBaseError } from '@edge-base/shared';
import { zodDefaultHook, trackEventsBodySchema, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import { executeAnalyticsQuery, resolveAnalyticsGroupBy } from '../lib/analytics-query.js';


export const analyticsApi = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// ─── Helpers ───

/** Require valid Service Key for admin-level endpoints */
function requireServiceKey(c: { env: Env; req: { header: (name: string) => string | undefined; raw: Request } }): void {
  const config = parseConfig(c.env);
  const provided = resolveServiceKeyCandidate(c.req);
  const constraintCtx = buildConstraintCtx(c.env as never, c.req);
  const { result } = validateKey(provided, 'analytics:*:*:*', config, c.env as never, undefined, constraintCtx);
  if (result === 'missing') {
    throw new EdgeBaseError(403, 'Service Key required for analytics queries.');
  }
  if (result === 'invalid') {
    throw new EdgeBaseError(401, 'Invalid Service Key.');
  }
}

/** Max custom events per single POST request */
const MAX_EVENTS_PER_REQUEST = 100;
/** Max properties per event (keys) */
const MAX_PROPERTIES = 50;
/** Max total properties JSON size in bytes */
const MAX_PROPERTIES_BYTES = 4096;

// ─── GET /query — Request log metrics (Service Key required) ───

const queryAnalytics = createRoute({
  operationId: 'queryAnalytics',
  method: 'get',
  path: '/query',
  tags: ['admin'],
  summary: 'Query request log metrics',
  request: {
    query: z.object({
      range: z.string().optional().openapi({ description: 'Time range (e.g. 24h, 7d, 30d)', example: '24h' }),
      category: z.string().optional().openapi({ description: 'Filter by category' }),
      metric: z.string().optional().openapi({ description: 'Metric type (overview, detailed)', example: 'overview' }),
      groupBy: z.string().optional().openapi({ description: 'Group by interval (minute, tenMinute, hour, day)', example: 'hour' }),
      start: z.string().optional().openapi({ description: 'Custom ISO start time' }),
      end: z.string().optional().openapi({ description: 'Custom ISO end time' }),
      excludeCategory: z.string().optional().openapi({ description: 'Exclude a category from the result set', example: 'admin' }),
    }),
  },
  responses: {
    200: { description: 'Analytics data', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

analyticsApi.openapi(queryAnalytics, async (c) => {
  requireServiceKey(c);

  const range = c.req.query('range') || '24h';
  const category = c.req.query('category') || '';
  const metric = c.req.query('metric') || 'overview';
  const start = c.req.query('start') || undefined;
  const end = c.req.query('end') || undefined;
  const excludeCategory = c.req.query('excludeCategory') || undefined;
  const groupBy = resolveAnalyticsGroupBy(range, start, end, c.req.query('groupBy') || undefined);

  const result = await executeAnalyticsQuery(c.env, { range, category, metric, groupBy, start, end, excludeCategory });
  return c.json(result);
});

// ─── POST /track — Custom event ingestion (JWT / Service Key / anonymous) ───

const trackEvents = createRoute({
  operationId: 'trackEvents',
  method: 'post',
  path: '/track',
  tags: ['client'],
  summary: 'Track custom events',
  request: {
    body: { content: { 'application/json': { schema: trackEventsBodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Events tracked', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

analyticsApi.openapi(trackEvents, async (c) => {
  // Parse body
  let body: { events: Array<Record<string, unknown>> };
  try {
    body = await c.req.json();
  } catch {
    throw new EdgeBaseError(400, 'Invalid JSON body.');
  }

  const events = body.events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new EdgeBaseError(400, 'Request body must contain a non-empty "events" array.');
  }
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    throw new EdgeBaseError(400, `Maximum ${MAX_EVENTS_PER_REQUEST} events per request.`);
  }

  // Determine userId from auth context
  const auth = c.get('auth' as never) as { id: string } | null | undefined;
  // Check if caller has Service Key (for userId override)
  let isServiceKey = false;
  try {
    const config = parseConfig(c.env);
    const provided = resolveServiceKeyCandidate(c.req);
    if (provided !== undefined) {
      const constraintCtx = buildConstraintCtx(c.env as never, c.req);
      const { result } = validateKey(provided, 'analytics:*:*:*', config, c.env as never, undefined, constraintCtx);
      isServiceKey = result === 'valid';
    }
  } catch { /* not a service key call */ }

  // Extract region from cf object or CF-Ray header
  let region = '';
  try {
    const cf = (c.req.raw as unknown as { cf?: { colo?: string } }).cf;
    if (cf?.colo) region = cf.colo;
  } catch { /* ignore */ }
  if (!region) {
    const cfRay = c.req.header('cf-ray');
    if (cfRay) {
      const parts = cfRay.split('-');
      if (parts.length >= 2) region = parts[parts.length - 1];
    }
  }

  // Validate and normalize events
  const validatedEvents: Array<{
    timestamp: number;
    userId: string | null;
    eventName: string;
    properties: Record<string, unknown> | null;
    region: string;
  }> = [];

  for (const e of events) {
    const name = e.name ?? e.eventName;
    if (typeof name !== 'string' || !name.trim()) {
      throw new EdgeBaseError(400, 'Each event must have a non-empty "name" string.');
    }

    // Properties validation
    let properties: Record<string, unknown> | null = null;
    if (e.properties != null) {
      if (typeof e.properties !== 'object' || Array.isArray(e.properties)) {
        throw new EdgeBaseError(400, 'Event "properties" must be a plain object.');
      }
      const propKeys = Object.keys(e.properties as Record<string, unknown>);
      if (propKeys.length > MAX_PROPERTIES) {
        throw new EdgeBaseError(400, `Event properties limited to ${MAX_PROPERTIES} keys.`);
      }
      const jsonStr = JSON.stringify(e.properties);
      if (new TextEncoder().encode(jsonStr).length > MAX_PROPERTIES_BYTES) {
        throw new EdgeBaseError(400, `Event properties limited to ${MAX_PROPERTIES_BYTES} bytes.`);
      }
      properties = e.properties as Record<string, unknown>;
    }

    // userId: JWT → auth.id, Service Key → body.userId, else null
    let userId: string | null = null;
    if (auth?.id) {
      userId = auth.id;
    } else if (isServiceKey && typeof e.userId === 'string') {
      userId = e.userId;
    }

    validatedEvents.push({
      timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
      userId,
      eventName: name.trim(),
      properties,
      region,
    });
  }

  // Write to LogsDO (always, both Cloud and Docker)
  if (!c.env.LOGS) {
    // No LOGS binding — log and return success (best-effort)
    console.warn('[Analytics] LOGS binding not available, custom events dropped.');
    return c.json({ ok: true, count: 0 });
  }

  const logsDO = c.env.LOGS.get(c.env.LOGS.idFromName('logs:main'));

  // Non-blocking write using waitUntil if available
  const writePromise = logsDO.fetch(
    new Request('http://internal/internal/events/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: validatedEvents }),
    }),
  ).then(resp => {
    if (!resp.ok) {
      console.error('[Analytics] Events write failed:', resp.status);
    }
  }).catch(err => {
    console.error('[Analytics] Events write error:', err);
  });

  try {
    const ctx = c.executionCtx;
    ctx.waitUntil(writePromise);
  } catch {
    // No execution context (unit tests) — wait inline
    await writePromise;
  }

  return c.json({ ok: true, count: validatedEvents.length });
});

// ─── GET /events — Query custom events (Service Key required) ───

const queryCustomEvents = createRoute({
  operationId: 'queryCustomEvents',
  method: 'get',
  path: '/events',
  tags: ['admin'],
  summary: 'Query custom events',
  request: {
    query: z.object({
      range: z.string().optional().openapi({ description: 'Time range (e.g. 24h, 7d, 30d)', example: '24h' }),
      event: z.string().optional().openapi({ description: 'Filter by event name' }),
      userId: z.string().optional().openapi({ description: 'Filter by user ID' }),
      metric: z.string().optional().openapi({ description: 'Metric type (list, count, timeSeries, topEvents)', example: 'list' }),
      groupBy: z.string().optional().openapi({ description: 'Group by interval (minute, tenMinute, hour, day)', example: 'hour' }),
      limit: z.string().optional().openapi({ description: 'Max items to return', example: '50' }),
      cursor: z.string().optional().openapi({ description: 'Pagination cursor' }),
    }),
  },
  responses: {
    200: { description: 'Custom events', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

analyticsApi.openapi(queryCustomEvents, async (c) => {
  requireServiceKey(c);

  const range = c.req.query('range') || '24h';
  const event = c.req.query('event') || '';
  const userId = c.req.query('userId') || '';
  const metric = c.req.query('metric') || 'list';
  const groupBy = c.req.query('groupBy') || 'hour';
  const limit = c.req.query('limit') || '50';
  const cursor = c.req.query('cursor') || '';

  if (!c.env.LOGS) {
    // No LOGS binding — return empty
    if (metric === 'list') return c.json({ events: [], cursor: undefined, hasMore: false });
    if (metric === 'count') return c.json({ totalEvents: 0, uniqueUsers: 0 });
    if (metric === 'timeSeries') return c.json({ timeSeries: [] });
    if (metric === 'topEvents') return c.json({ topEvents: [] });
    return c.json({ events: [] });
  }

  const logsDO = c.env.LOGS.get(c.env.LOGS.idFromName('logs:main'));
  const params = new URLSearchParams({ range, metric, groupBy, limit });
  if (event) params.set('event', event);
  if (userId) params.set('userId', userId);
  if (cursor) params.set('cursor', cursor);

  const resp = await logsDO.fetch(
    new Request(`http://internal/internal/events/query?${params}`),
  );
  const data = await resp.json();
  return c.json(data);
});
