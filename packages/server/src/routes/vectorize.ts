/**
 * Vectorize route — POST /api/vectorize/:index
 *
 * Allows server SDK (with Service Key) to access user-defined Vectorize indexes.
 * NOT available to client SDK (server-only,).
 *
 * Supported actions:
 *   upsert   — Insert or replace vectors (write)
 *   insert   — Insert new vectors without replacing existing IDs (write)
 *   search   — Similarity search by vector values (query)
 *   queryById — Similarity search using an existing vector's ID (query, Vectorize v2 only)
 *   getByIds — Retrieve vectors by ID (query)
 *   delete   — Remove vectors by ID (write)
 *   describe — Get index info: vectorCount, dimensions, metric (query)
 *
 * Security:
 * - Config Allowlist: index must be declared in config.vectorize
 * - Service Key required with scoped validation
 *
 * Note: Cloudflare does not provide a local Vectorize simulation. When the binding
 * is unavailable in EdgeBase local or Docker environments, the route returns a stub response with a warning.
 *
 * Flow: Server SDK → POST /api/vectorize/:index → Worker → Vectorize binding → JSON
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import { parseConfig } from '../lib/do-router.js';
import { validateKey, buildConstraintCtx } from '../lib/service-key.js';
import { zodDefaultHook, vectorizeBodySchema, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';


const VALID_ACTIONS = ['upsert', 'insert', 'search', 'queryById', 'getByIds', 'delete', 'describe'] as const;
type Action = typeof VALID_ACTIONS[number];

const READ_ACTIONS: Action[] = ['search', 'getByIds', 'queryById', 'describe'];

const STUB_WARNING = 'Vectorize not available in this environment';
const VECTOR_BATCH_LIMIT = 20;
const vectorizeStubWarnings = new Set<string>();

export const vectorizeRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

function invalidVectorizeJsonMessage(): string {
  return 'Invalid JSON body for Vectorize. Send application/json with { action, ...payload }.';
}

/**
 * POST /api/vectorize/:index
 * Body: { action, vectors?, vector?, vectorId?, topK?, filter?, ids?, namespace?, returnValues?, returnMetadata? }
 */
const vectorizeOperation = createRoute({
  operationId: 'vectorizeOperation',
  method: 'post',
  path: '/{index}',
  tags: ['admin'],
  summary: 'Execute Vectorize operation',
  request: {
    params: z.object({ index: z.string() }),
    body: { content: { 'application/json': { schema: vectorizeBodySchema } }, required: true },
  },
  responses: {
    200: { description: 'Operation result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

vectorizeRoute.openapi(vectorizeOperation, async (c) => {
  const nameParam = c.req.param('index')!;

  let body: {
    action?: string;
    vectors?: Array<{ id: string; values: number[]; metadata?: Record<string, unknown>; namespace?: string }>;
    vector?: number[];
    vectorId?: string;
    topK?: number;
    filter?: Record<string, unknown>;
    ids?: string[];
    namespace?: string;
    returnValues?: boolean;
    returnMetadata?: boolean | 'all' | 'indexed' | 'none';
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: invalidVectorizeJsonMessage() }, 400);
  }

  const { action } = body;
  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return c.json({ code: 400, message: `action must be one of: ${VALID_ACTIONS.join(', ')}` }, 400);
  }

  // §2 Allowlist: validate index is declared in config
  const config = parseConfig(c.env);
  const vectorConfig = config.vectorize?.[nameParam];
  if (!vectorConfig) {
    return c.json({ code: 404, message: `Vectorize index '${nameParam}' not found in config.` }, 404);
  }

  // §4 Scope mapping: read vs write
  const scope = READ_ACTIONS.includes(action as Action)
    ? `vectorize:index:${nameParam}:query`
    : `vectorize:index:${nameParam}:write`;

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
    return c.json({ code: 403, message: `X-EdgeBase-Service-Key is required to access Vectorize index '${nameParam}'.` }, 403);
  }
  if (skResult === 'invalid') {
    return c.json({ code: 401, message: `Invalid X-EdgeBase-Service-Key for Vectorize index '${nameParam}'.` }, 401);
  }

  // ─── Input validation ─────────────────────────────────────────────────

  if (action === 'upsert' || action === 'insert') {
    if (!body.vectors || !Array.isArray(body.vectors) || body.vectors.length === 0) {
      return c.json({ code: 400, message: 'vectors array is required and must not be empty for ' + action }, 400);
    }
    const invalidVector = body.vectors.find((vector) => !Array.isArray(vector.values) || vector.values.length !== vectorConfig.dimensions);
    if (invalidVector) {
      const actual = Array.isArray(invalidVector.values) ? invalidVector.values.length : 0;
      return c.json({
        code: 400,
        message: `vector dimension mismatch: expected ${vectorConfig.dimensions}, got ${actual}`,
      }, 400);
    }
  }

  if (action === 'delete' || action === 'getByIds') {
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ code: 400, message: 'ids array is required and must not be empty for ' + action }, 400);
    }
  }

  if (action === 'search' || action === 'queryById') {
    const topK = body.topK ?? 10;
    if (topK < 1 || topK > 100) {
      return c.json({ code: 400, message: 'topK must be between 1 and 100' }, 400);
    }
  }

  if (action === 'search') {
    if (!body.vector || !Array.isArray(body.vector)) {
      return c.json({ code: 400, message: 'vector array is required for search' }, 400);
    }
    if (body.vector.length !== vectorConfig.dimensions) {
      return c.json({ code: 400, message: `vector dimension mismatch: expected ${vectorConfig.dimensions}, got ${body.vector.length}` }, 400);
    }
  }

  if (action === 'queryById') {
    if (!body.vectorId || typeof body.vectorId !== 'string') {
      return c.json({ code: 400, message: 'vectorId string is required for queryById' }, 400);
    }
  }

  // ─── Binding access ───────────────────────────────────────────────────

  // §1 Env type — dynamic binding access via type assertion
  // §7: Vectorize has no local simulation in Cloudflare. EdgeBase falls back to stubs.
  const bindingName = vectorConfig.binding ?? `VECTORIZE_${nameParam.toUpperCase()}`;
  const binding = (c.env as unknown as Record<string, unknown>)[bindingName] as VectorizeIndex | undefined;
  if (!binding) {
    const warningKey = `${nameParam}:${bindingName}`;
    if (!vectorizeStubWarnings.has(warningKey)) {
      vectorizeStubWarnings.add(warningKey);
      console.warn(
        `[Vectorize] '${nameParam}' is running with a local stub because binding '${bindingName}' is unavailable. `
        + 'Search and mutation calls will return no-op stub data until the binding is configured in Cloudflare.',
      );
    }
    // Return stub responses for local development
    // Include both v1 (count) and v2 (mutationId) fields so code for either version works.
    switch (action) {
      case 'search':
        return c.json({ matches: [], count: 0, _stub: true, _warning: STUB_WARNING });
      case 'upsert':
        return c.json({ ok: true, count: 0, mutationId: null, _stub: true, _warning: STUB_WARNING });
      case 'insert':
        return c.json({ ok: true, count: 0, mutationId: null, _stub: true, _warning: STUB_WARNING });
      case 'delete':
        return c.json({ ok: true, count: 0, mutationId: null, _stub: true, _warning: STUB_WARNING });
      case 'getByIds':
        return c.json({ vectors: [], _stub: true, _warning: STUB_WARNING });
      case 'queryById':
        return c.json({ matches: [], count: 0, _stub: true, _warning: STUB_WARNING });
      case 'describe':
        return c.json({
          vectorCount: 0,
          dimensions: vectorConfig.dimensions,
          metric: vectorConfig.metric,
          processedUpToDatetime: null,
          processedUpToMutation: null,
          _stub: true,
          _warning: STUB_WARNING,
        });
    }
  }

  // ─── Execute Vectorize operation ──────────────────────────────────────

  switch (action) {
    case 'upsert': {
      const vectors = applyNamespace(body.vectors!, body.namespace) as VectorizeVector[];
      let count = 0;
      let mutationId: string | undefined;
      for (const chunk of chunkArray(vectors, VECTOR_BATCH_LIMIT)) {
        const result = await binding!.upsert(chunk);
        count += 'count' in result ? result.count : chunk.length;
        if ('mutationId' in result) {
          mutationId = (result as { mutationId: string }).mutationId;
        }
      }
      return c.json({
        ok: true,
        count,
        ...(mutationId ? { mutationId } : {}),
      });
    }

    case 'insert': {
      const vectors = applyNamespace(body.vectors!, body.namespace) as VectorizeVector[];
      try {
        let count = 0;
        let mutationId: string | undefined;
        for (const chunk of chunkArray(vectors, VECTOR_BATCH_LIMIT)) {
          const result = await binding!.insert(chunk);
          count += 'count' in result ? result.count : chunk.length;
          if ('mutationId' in result) {
            mutationId = (result as { mutationId: string }).mutationId;
          }
        }
        return c.json({
          ok: true,
          count,
          ...(mutationId ? { mutationId } : {}),
        });
      } catch (err: unknown) {
        // insert() throws on duplicate ID — surface as 409 Conflict
        const message = err instanceof Error ? err.message : 'Insert failed — duplicate ID';
        return c.json({ code: 409, message }, 409);
      }
    }

    case 'search': {
      const queryOpts: VectorizeQueryOptions = {
        topK: body.topK ?? 10,
        filter: body.filter as VectorizeVectorMetadataFilter | undefined,
      };
      if (body.returnValues !== undefined) queryOpts.returnValues = body.returnValues;
      if (body.returnMetadata !== undefined) queryOpts.returnMetadata = body.returnMetadata;
      if (body.namespace) queryOpts.namespace = body.namespace;

      const results = await binding!.query(body.vector!, queryOpts);
      return c.json({
        matches: mapMatches(results.matches),
        count: results.count,
      });
    }

    case 'queryById': {
      // queryById only exists on the new Vectorize class, not legacy VectorizeIndex
      const asVectorize = binding as unknown as {
        queryById?: (id: string, opts?: VectorizeQueryOptions) => Promise<VectorizeMatches>;
      };
      if (typeof asVectorize.queryById !== 'function') {
        return c.json({
          code: 501,
          message: 'queryById is not available on this Vectorize binding (requires Vectorize v2)',
        }, 501);
      }

      const queryOpts: VectorizeQueryOptions = {
        topK: body.topK ?? 10,
        filter: body.filter as VectorizeVectorMetadataFilter | undefined,
      };
      if (body.returnValues !== undefined) queryOpts.returnValues = body.returnValues;
      if (body.returnMetadata !== undefined) queryOpts.returnMetadata = body.returnMetadata;
      if (body.namespace) queryOpts.namespace = body.namespace;

      const results = await asVectorize.queryById(body.vectorId!, queryOpts);
      return c.json({
        matches: mapMatches(results.matches),
        count: results.count,
      });
    }

    case 'getByIds': {
      const vectors = (
        await Promise.all(chunkArray(body.ids!, VECTOR_BATCH_LIMIT).map((chunk) => binding!.getByIds(chunk)))
      ).flat();
      return c.json({
        vectors: vectors.map((v) => ({
          id: v.id,
          values: v.values instanceof Float32Array || v.values instanceof Float64Array
            ? Array.from(v.values)
            : v.values,
          ...(v.metadata !== undefined && { metadata: v.metadata }),
          ...(v.namespace && { namespace: v.namespace }),
        })),
      });
    }

    case 'delete': {
      let count = 0;
      let mutationId: string | undefined;
      for (const chunk of chunkArray(body.ids!, VECTOR_BATCH_LIMIT)) {
        const result = await binding!.deleteByIds(chunk);
        count += 'count' in result ? result.count : chunk.length;
        if ('mutationId' in result) {
          mutationId = (result as { mutationId: string }).mutationId;
        }
      }
      return c.json({
        ok: true,
        count,
        ...(mutationId ? { mutationId } : {}),
      });
    }

    case 'describe': {
      const info = await binding!.describe();
      // Handle both VectorizeIndexDetails (beta) and VectorizeIndexInfo (new)
      const details = info as unknown as Record<string, unknown>;
      return c.json({
        vectorCount: details.vectorCount ?? details.vectorsCount ?? 0,
        dimensions: details.dimensions ?? (details.config as Record<string, unknown>)?.dimensions ?? vectorConfig.dimensions,
        metric: details.metric ?? (details.config as Record<string, unknown>)?.metric ?? vectorConfig.metric,
        ...('id' in details && { id: details.id }),
        ...('name' in details && { name: details.name }),
        // v2 Vectorize: processedUpTo fields for mutation tracking
        ...('processedUpToDatetime' in details && { processedUpToDatetime: details.processedUpToDatetime }),
        ...('processedUpToMutation' in details && { processedUpToMutation: details.processedUpToMutation }),
      });
    }

    default:
      return c.json({ code: 400, message: 'Unknown action' }, 400);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Apply a default namespace to vectors that don't have one set. */
function applyNamespace(
  vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown>; namespace?: string }>,
  defaultNs?: string,
): Array<{ id: string; values: number[]; metadata?: Record<string, unknown>; namespace?: string }> {
  if (!defaultNs) return vectors;
  return vectors.map((v) => (v.namespace ? v : { ...v, namespace: defaultNs }));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Map VectorizeMatch to a clean JSON-safe response object. */
function mapMatches(matches: VectorizeMatch[]): Array<Record<string, unknown>> {
  return matches.map((m) => ({
    id: m.id,
    score: m.score,
    ...(m.values !== undefined && {
      values: m.values instanceof Float32Array || m.values instanceof Float64Array
        ? Array.from(m.values)
        : m.values,
    }),
    ...(m.metadata !== undefined && { metadata: m.metadata }),
    ...(m.namespace && { namespace: m.namespace }),
  }));
}
