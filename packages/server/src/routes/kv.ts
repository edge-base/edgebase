/**
 * KV route — POST /api/kv/:namespace
 *
 * Allows server SDK (with Service Key) to access user-defined KV namespaces.
 * NOT available to client SDK (server-only,).
 *
 * Security:
 * - Config Allowlist: namespace must be declared in config.kv
 * - Service Key required with scoped validation
 * - Internal KV binding is never exposed
 *
 * Flow: Server SDK → POST /api/kv/:namespace → Worker → KV binding → JSON
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import { EdgeBaseError } from '@edge-base/shared';
import { parseConfig } from '../lib/do-router.js';
import { validateKey, buildConstraintCtx } from '../lib/service-key.js';
import { zodDefaultHook, kvBodySchema, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';


export const kvRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

function invalidKvJsonMessage(): string {
  return 'Invalid JSON body. Send application/json with a KV operation payload like { action, key, value }.';
}

function missingKvFieldMessage(field: string, action: string): string {
  return `Missing required field '${field}' for KV action '${action}'.`;
}

function normalizeKvBindingError(action: string, error: unknown): EdgeBaseError {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();

  if (
    lowered.includes('expiration_ttl')
    || lowered.includes('ttl')
    || lowered.includes('must be at least')
    || lowered.includes('invalid')
    || lowered.includes('key name')
    || lowered.includes('metadata')
  ) {
    return new EdgeBaseError(400, message);
  }

  return new EdgeBaseError(500, `KV ${action} failed: ${message}`);
}

/**
 * POST /api/kv/:namespace
 * Body: { action: 'get'|'set'|'delete'|'list', key?: string, value?: string, ttl?: number, prefix?: string, limit?: number, cursor?: string }
 */
const kvOperation = createRoute({
  operationId: 'kvOperation',
  method: 'post',
  path: '/{namespace}',
  tags: ['admin'],
  summary: 'Execute KV operation',
  request: {
    params: z.object({ namespace: z.string() }),
    body: { content: { 'application/json': { schema: kvBodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Operation result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

kvRoute.openapi(kvOperation, async (c) => {
  const nameParam = c.req.param('namespace')!;

  let body: {
    action?: string;
    key?: string;
    value?: string;
    ttl?: number;
    prefix?: string;
    limit?: number;
    cursor?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: invalidKvJsonMessage() }, 400);
  }

  const { action } = body;
  if (!action || !['get', 'set', 'delete', 'list'].includes(action)) {
    return c.json({ code: 400, message: "Invalid KV action. Expected one of: 'get', 'set', 'delete', 'list'." }, 400);
  }

  // §2 Allowlist: validate namespace is declared in config
  const config = parseConfig(c.env);
  const kvConfig = config.kv?.[nameParam];
  if (!kvConfig) {
    return c.json({ code: 404, message: `KV namespace '${nameParam}' not found in config.` }, 404);
  }

  // §4 Scope mapping: action → scope
  const scope = (action === 'get' || action === 'list')
    ? `kv:namespace:${nameParam}:read`
    : `kv:namespace:${nameParam}:write`;

  // Service Key validation
  const { result: skResult } = validateKey(
    c.req.header('X-EdgeBase-Service-Key'),
    scope,
    config,
    c.env,
    undefined,
    buildConstraintCtx(c.env, c.req),
  );
  if (skResult === 'missing') {
    return c.json({ code: 403, message: `X-EdgeBase-Service-Key is required to access KV namespace '${nameParam}'.` }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: `Invalid X-EdgeBase-Service-Key for KV namespace '${nameParam}'.` }, 401);
  }

  // §1 Env type — dynamic binding access via type assertion
  const binding = (c.env as unknown as Record<string, unknown>)[kvConfig.binding] as KVNamespace | undefined;
  if (!binding) {
    return c.json({
      code: 500,
      message: `KV binding '${kvConfig.binding}' is unavailable. Check the binding name in edgebase.config.ts and wrangler.toml.`,
    }, 500);
  }

  // Execute KV operation
  switch (action) {
    case 'get': {
      if (!body.key) return c.json({ code: 400, message: missingKvFieldMessage('key', 'get') }, 400);
      const value = await binding.get(body.key);
      return c.json({ value });
    }
    case 'set': {
      if (!body.key) return c.json({ code: 400, message: missingKvFieldMessage('key', 'set') }, 400);
      if (body.value === undefined) return c.json({ code: 400, message: missingKvFieldMessage('value', 'set') }, 400);
      const putOptions: KVNamespacePutOptions = {};
      if (body.ttl) putOptions.expirationTtl = body.ttl;
      try {
        await binding.put(body.key, body.value, putOptions);
      } catch (error) {
        throw normalizeKvBindingError('set', error);
      }
      return c.json({ ok: true });
    }
    case 'delete': {
      if (!body.key) return c.json({ code: 400, message: missingKvFieldMessage('key', 'delete') }, 400);
      try {
        await binding.delete(body.key);
      } catch (error) {
        throw normalizeKvBindingError('delete', error);
      }
      return c.json({ ok: true });
    }
    case 'list': {
      const listOptions: KVNamespaceListOptions = {};
      if (body.prefix) listOptions.prefix = body.prefix;
      if (body.limit) listOptions.limit = body.limit;
      if (body.cursor) listOptions.cursor = body.cursor;
      let result: KVNamespaceListResult<unknown>;
      try {
        result = await binding.list(listOptions);
      } catch (error) {
        throw normalizeKvBindingError('list', error);
      }
      return c.json({
        keys: result.keys.map((k) => k.name),
        cursor: result.list_complete ? undefined : result.cursor,
      });
    }
    default:
      return c.json({ code: 400, message: `Unsupported KV action '${action}'.` }, 400);
  }
});
