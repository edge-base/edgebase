/**
 * Rules Middleware — Function-based access rules evaluation
 *
 * Pipeline: Auth → Rules → Handler(DO proxy)
 *
 * Worker level (before DO):
 *   - DB-level access: canCreate(auth, id) / access(auth, id) — §4
 *   - Table-level create: create(auth) — no row needed
 *   - Service Key bypass — §1
 *
 * DO level (inside database-do.ts):
 *   - Table-level read/update/delete: evaluated per-row with actual row data
 *   - All-or-Nothing: any row failing read → full 403 — §7
 *
 * Rules are TypeScript functions — no string DSL, no Pratt parser — §3.
 * Timeout: Worker rules 50ms, DO rules 10ms — fail-closed — §12①.
 */
import type { Context, Next } from 'hono';
import type { Env } from '../types.js';
import {
  validateKey,
  buildKeymap,
  resolveServiceKeyCandidate,
  type ConstraintContext,
} from '../lib/service-key.js';
import {
  callDO,
  findTableNamespace,
  getDbDoName,
  parseConfig,
  shouldRouteToD1,
} from '../lib/do-router.js';
import type { AuthContext, TableRules, DbLevelRules } from '@edge-base/shared';
import { EdgeBaseError, getDbAccess, getTableAccess } from '@edge-base/shared';
import { handleD1Request } from '../lib/d1-handler.js';
import { handlePgRequest } from '../lib/postgres-handler.js';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import { getTrustedClientIp } from '../lib/client-ip.js';

type HonoContext = Context<{ Bindings: Env }>;
const WORKER_RULE_TIMEOUT_MS = 50;
const DB_ACCESS_RULE_TIMEOUT_MS = 2000;

function tableRuleRejected(tableName: string, action: string): EdgeBaseError {
  return new EdgeBaseError(
    403,
    `Access denied. The '${action}' access rule for table '${tableName}' rejected this request.`,
  );
}

/**
 * Normalize a raw rule value (function | boolean | string) into a callable.
 *
 * JSON-deserialized test config cannot encode
 * functions — rules arrive as boolean literals or expression strings like
 * "auth != null" or "auth.id == resource.authorId".
 * Live edgebase.config.js rules are real JS functions.
 */
function normalizeRule<T extends unknown[]>(
  rule: ((...args: T) => boolean | Promise<boolean>) | boolean | string | undefined,
): ((...args: T) => boolean) | null {
  if (rule === undefined || rule === null) return null;
  if (typeof rule === 'boolean') return () => rule;
  if (typeof rule === 'function') return rule as (...args: T) => boolean;
  // String expression — simple interpreter for common patterns
  if (typeof rule === 'string') {
    return (...args: T) => evalStringRule(rule, args[0] as AuthContext | null, args[1] as Record<string, unknown> | undefined);
  }
  return null;
}

/**
 * Evaluate a simple string rule expression against auth and resource.
 * Supports: 'true', 'false', 'auth != null', 'auth !== null',
 *           'auth.id == resource.X', 'auth.id === resource.X'.
 */
function evalStringRule(
  expr: string,
  auth: AuthContext | null,
  resource?: Record<string, unknown>,
): boolean {
  const e = expr.trim().replace(/\s+/g, ' ');
  if (e === 'true') return true;
  if (e === 'false') return false;
  if (e === 'auth != null' || e === 'auth !== null') return auth !== null;
  if (e === 'auth == null' || e === 'auth === null') return auth === null;
  // auth.id == resource.X
  const authIdEqResource = /^auth\.id ===? resource\.(\w+)$/.exec(e);
  if (authIdEqResource) {
    const field = authIdEqResource[1];
    return auth !== null && resource !== undefined && auth.id === resource[field];
  }
  // Default: deny (fail-closed for unknown/unsupported expressions)
  console.warn(`[Rules] Unrecognized string rule expression: "${expr}" — denied (fail-closed).`);
  return false;
}

// ─── Rule Evaluation with Timeout (§12①) ───

/**
 * Evaluate a rule function with a timeout.
 * Accepts function, boolean or string rule values.
 * Fail-closed: timeout or error → false (deny).
 */
async function evalWithTimeout(
  fn: (() => boolean | Promise<boolean>),
  timeoutMs: number,
): Promise<boolean> {
  try {
    const result = fn();
    if (typeof result === 'boolean') return result;
    // Promise — race with timeout
    return await Promise.race([
      result,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
  } catch {
    // Any error → deny (fail-closed)
    return false;
  }
}

// ─── Main Rules Middleware ───

/**
 * Rules middleware for database table endpoints.
 * Must be mounted on /api/db/* in the main app.
 */
export async function rulesMiddleware(c: HonoContext, next: Next): Promise<Response | void> {
  const path = new URL(c.req.raw.url).pathname;

  // Extract namespace, instanceId, tableName from /api/db/:namespace/tables/:table[/*]
  // or /api/db/:namespace/:instanceId/tables/:table[/*]
  // pathParts: ['api','db','shared','tables','posts'] or ['api','db','workspace','ws-456','tables','docs']
  const pathParts = path.split('/').filter(Boolean);
  const tablesIdx = pathParts.indexOf('tables');
  if (pathParts[1] !== 'db' || tablesIdx === -1) {
    return next();
  }
  const rawTableName = pathParts[tablesIdx + 1];
  const tableName = rawTableName ? decodeURIComponent(rawTableName) : rawTableName;
  const namespace = pathParts[2];
  // instanceId present when path is /api/db/:ns/:id/tables/:name
  const instanceId = tablesIdx === 4 ? pathParts[3] : undefined;
  if (!tableName) return next();

  // ── Step 0: Internal call bypass ──
  const isInternal = c.get('isInternalRequest' as never) === true;
  if (isInternal) {
    return next();
  }

  const config = parseConfig(c.env);
  const auth = c.get('auth') as AuthContext | null;
  const dbId = instanceId ||
    c.req.header('X-EdgeBase-DB-Id') ||
    extractAuthIdForUserNamespace(namespace, auth);

  // ── Step 1: Service Key check ──
  const provided = resolveServiceKeyCandidate(
    c.req,
    c.get('serviceKeyToken') as string | null | undefined,
  );
  const httpMethod = c.req.raw.method.toUpperCase();
  const isReadMethod = httpMethod === 'GET' || httpMethod === 'HEAD';
  const scopeAction = isReadMethod ? 'read' : 'write';
  const requiredScope = `db:table:${tableName}:${scopeAction}`;

  const constraintCtx: ConstraintContext = {
    env: c.env.ENVIRONMENT,
    ip: getTrustedClientIp(c.env, c.req),
  };
  if (dbId) constraintCtx.tenantId = dbId;

  // BUG-007 fix: build keymap once per request (not internally on every validateKey call)
  const keymap = buildKeymap(config, c.env);
  const { result: keyResult } = validateKey(provided, requiredScope, config, c.env, keymap, constraintCtx);

  if (keyResult === 'valid') {
    c.set('isServiceKey' as never, true);
    return next();
  }
  if (keyResult === 'invalid') {
    throw new EdgeBaseError(401, `Invalid X-EdgeBase-Service-Key for scope '${requiredScope}'.`);
  }
  // keyResult === 'missing' → continue to normal rules evaluation

  // ── Step 2: Find DB block by namespace (from URL — §2) ──
  if (!config.databases) {
    // No databases config → release mode check
    if (!config.release) return next();
    throw new EdgeBaseError(
      403,
      'Access denied. No databases config is defined for this server. Add config.databases or set release: false while developing locally.',
    );
  }

  // namespace comes directly from the URL (/api/db/:namespace/...)
  const tableNamespace = namespace;
  const dbBlock = config.databases[tableNamespace];

  if (!dbBlock) {
    // Namespace not found in config → deny
    if (!config.release) return next();
    throw new EdgeBaseError(
      403,
      `Access denied. Namespace '${tableNamespace}' is not configured. Check the API path or add this namespace to config.databases.`,
    );
  }

  if (dbBlock.tables && !dbBlock.tables[tableName]) {
    // Table not defined in this DB block
    if (!config.release) return next();
    throw new EdgeBaseError(
      403,
      `Access denied. Table '${tableName}' is missing access rules. Add access.* rules or disable release mode for local-only development.`,
    );
  }

  // ── Step 3: DB-level access check (§4) ──
  // instanceId from URL (/api/db/:ns/:id/tables/:name) or fallback for 'user' namespace
  const dbRules = getDbAccess(dbBlock) as DbLevelRules | undefined;
  if (dbRules && dbId !== undefined) {
    // access: check if user can access this DO instance
    if (dbRules.access) {
      const dbRuleCtx = buildDbRuleCtx(c, config, namespace, dbId);
      const canAccess = await evalWithTimeout(
        () => dbRules.access!(auth, dbId, dbRuleCtx),
        // Dynamic DB access rules often perform an internal DB/DO lookup.
        // Cold starts on deployed workers regularly exceed 50ms, so a short
        // ceiling turns valid tenant memberships into false 403s.
        DB_ACCESS_RULE_TIMEOUT_MS,
      );
      if (!canAccess) {
        throw new EdgeBaseError(403, `Access denied. You do not have access to ${tableNamespace}:${dbId}.`);
      }
    }
    // NOTE: DbLevelRules.delete exists in the type definition (config.ts) but is not
    // enforced here because no public/admin endpoint for deleting a DB block instance (DO)
    // exists yet. canCreate is evaluated in tables.ts (§36 2-RTT flow), access is evaluated
    // above. When a DB instance deletion endpoint is added, enforce dbRules.delete(auth, dbId)
    // at the corresponding route handler before allowing the operation.
  }

  // ── Step 4: Table-level rules (create at Worker level, others at DO level) ──
  const tableConfig = dbBlock.tables?.[tableName];
  const tableRules = getTableAccess(tableConfig) as TableRules | undefined;

  if (!tableRules) {
    if (!config.release) return next();
    throw new EdgeBaseError(
      403,
      `Access denied. No access rules are defined for table '${tableName}'. Add access.* rules or disable release mode for local-only development.`,
    );
  }

  // Determine action
  const hasUpsert = c.req.query('upsert') === 'true';
  const action = getAction(httpMethod, path, hasUpsert);

  // Handle upsert (§16)
  if (hasUpsert && httpMethod === 'POST') {
    const insertRuleFn = normalizeRule(tableRules.insert);
    const updateRuleFn = normalizeRule(tableRules.update);

    if (!insertRuleFn && !updateRuleFn) {
      if (!config.release) return next();
      throw new EdgeBaseError(403, `Access denied. No insert or update rules for '${tableName}'.`);
    }

    // Worker pre-check: insert(auth) OR update(auth, null) — §16
    // update called with null row since we don't have it yet
    const insertPass = insertRuleFn
      ? await evalWithTimeout(() => insertRuleFn(auth), WORKER_RULE_TIMEOUT_MS)
      : !config.release;
    const updatePass = updateRuleFn
      ? await evalWithTimeout(() => updateRuleFn(auth, {}), WORKER_RULE_TIMEOUT_MS) // null-safe: {} simulates missing row
      : !config.release;

    if (!insertPass && !updatePass) {
      throw tableRuleRejected(tableName, 'upsert');
    }
    return next();
  }

  // Handle batch (§16)
  if (path.includes('/batch')) {
    if (httpMethod === 'POST') {
      const insertRuleFn = normalizeRule(tableRules.insert);
      if (path.includes('/batch-by-filter')) {
        // batch-by-filter: row-level evaluation happens in DO
        return next();
      }
      if (insertRuleFn) {
        const canInsert = await evalWithTimeout(() => insertRuleFn(auth), WORKER_RULE_TIMEOUT_MS);
        if (!canInsert) throw tableRuleRejected(tableName, 'batch insert');
      } else if (config.release) {
        throw tableRuleRejected(tableName, 'batch insert');
      }
    }
    return next();
  }

  if (!action) return next();

  // ── Step 5: insert — evaluated at Worker level (no row needed) ──
  if (action === 'insert') {
    const insertRuleFn = normalizeRule(tableRules.insert);
    if (!insertRuleFn) {
      if (!config.release) return next();
      throw new EdgeBaseError(403, `Access denied. No 'insert' rule defined for '${tableName}'.`);
    }
    const canInsert = await evalWithTimeout(() => insertRuleFn(auth), WORKER_RULE_TIMEOUT_MS);
    if (!canInsert) throw tableRuleRejected(tableName, 'insert');
    return next();
  }

  // ── Step 6: read/update/delete — pass to DO for row-level evaluation ──
  // DO (database-do.ts) handles: read(auth, row), update(auth, row), delete(auth, row).
  // All-or-Nothing policy for reads: any row failing → full 403 — §7.
  // NOTE: Do NOT call c.req.raw.headers.set() here — Request.headers is immutable in
  // Cloudflare Workers runtime (TypeError). tables.ts copies headers via new Headers(...)
  // and sets X-DO-Name. auth is already forwarded via X-Auth-Context header in tables.ts.
  // namespace/dbId are parsed from the URL by the DO directly.

  return next();
}

// ─── Helpers ───

function getAction(method: string, path: string, hasUpsert: boolean): string | null {
  if (path.includes('/search')) return 'search';
  if (path.includes('/count')) return 'list';
  if (path.includes('/batch')) return null;

  switch (method) {
    case 'GET':
      return isIdPath(path) ? 'get' : 'list';
    case 'POST':
      if (hasUpsert) return null;
      return 'insert';
    case 'PATCH':
    case 'PUT':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return null;
  }
}

function isIdPath(path: string): boolean {
  // /api/db/:ns/tables/:name/:id or /api/db/:ns/:iid/tables/:name/:id
  const parts = path.split('/').filter(Boolean);
  const tabIdx = parts.indexOf('tables');
  if (parts[1] !== 'db' || tabIdx === -1) return false;
  // id segment exists after tableName (parts[tabIdx+2])
  return parts.length > tabIdx + 2;
}

/**
 * For 'user' namespace, auto-extract id from auth.id.
 * For other namespaces, returns undefined (id must come from X-EdgeBase-DB-Id header).
 */
function extractAuthIdForUserNamespace(namespace: string, auth: AuthContext | null): string | undefined {
  if (namespace === 'user' && auth?.id) {
    return auth.id;
  }
  return undefined;
}

/**
 * Build a read-only DbRuleCtx for DB-level access() evaluation at Worker level.
 * Resolves table names through the configured provider and performs local internal reads.
 */
function buildDbRuleCtx(
  c: HonoContext,
  config: ReturnType<typeof parseConfig>,
  currentNamespace: string,
  currentDbId: string | undefined,
): import('@edge-base/shared').DbRuleCtx {
  return {
    db: {
      async get(table, id) {
        const namespace = findTableNamespace(table, config) ?? currentNamespace;
        if (!namespace || !id) return null;

        const path = `/tables/${table}/${id}`;
        const response = await executeInternalDbRead(
          c,
          config,
          namespace,
          table,
          path,
          currentNamespace,
          currentDbId,
        );
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`DB rule ctx get failed: ${response.status}`);
        return await response.json() as Record<string, unknown>;
      },
      async exists(table, filter) {
        const namespace = findTableNamespace(table, config) ?? currentNamespace;
        if (!namespace) return false;

        const query = new URLSearchParams();
        query.set('limit', '1');
        query.set(
          'filter',
          JSON.stringify(
            Object.entries(filter).map(([field, value]) => [field, '==', value]),
          ),
        );
        const response = await executeInternalDbRead(
          c,
          config,
          namespace,
          table,
          `/tables/${table}?${query.toString()}`,
          currentNamespace,
          currentDbId,
        );
        if (!response.ok) throw new Error(`DB rule ctx exists failed: ${response.status}`);
        const result = await response.json() as { items?: Array<Record<string, unknown>> };
        return (result.items?.length ?? 0) > 0;
      },
    },
  };
}

async function executeInternalDbRead(
  c: HonoContext,
  config: ReturnType<typeof parseConfig>,
  namespace: string,
  tableName: string,
  path: string,
  currentNamespace: string,
  currentDbId: string | undefined,
): Promise<Response> {
  const dbBlock = config.databases?.[namespace];
  const isDynamic = !!(dbBlock?.instance || dbBlock?.access?.canCreate || dbBlock?.access?.access);

  if (isDynamic && (!currentDbId || namespace !== currentNamespace)) {
    throw new Error(
      `DbRuleCtx cannot resolve dynamic namespace table '${tableName}' outside the current db instance.`,
    );
  }

  const request = new Request(`http://internal/api/db/${namespace}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Internal': 'true',
      'X-Is-Service-Key': 'true',
    },
  });

  if (shouldRouteToD1(namespace, config)) {
    return handleD1Request(
      buildInternalHandlerContext({
        env: c.env,
        request,
        executionCtx: c.executionCtx,
      }),
      namespace,
      tableName,
      path,
    );
  }

  const provider = config.databases?.[namespace]?.provider;
  if (provider === 'neon' || provider === 'postgres') {
    return handlePgRequest(
      buildInternalHandlerContext({
        env: c.env,
        request,
        executionCtx: c.executionCtx,
      }),
      namespace,
      tableName,
      path,
    );
  }

  const doName = getDbDoName(namespace, isDynamic ? currentDbId : undefined);
  return callDO(c.env.DATABASE, doName, path, {
    method: 'GET',
    headers: {
      'X-DO-Name': doName,
      'X-EdgeBase-Internal': 'true',
      'X-Is-Service-Key': 'true',
    },
  });
}
