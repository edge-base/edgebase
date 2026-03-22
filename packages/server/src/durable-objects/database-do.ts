/**
 * DatabaseDO — Durable Object for table data storage.
 *
 * Single class, multiple instances:
 *   {namespace}              — static DB (e.g. 'shared')
 *   {namespace}:{id}         — dynamic DB (e.g. 'workspace:ws-456')
 *
 * NOTE: db:_system eliminated — _users_public → AUTH_DB D1,
 * _schedules → Cron Triggers, plugin _meta → CONTROL_DB D1.
 *
 * Responsibilities:
 * - Lazy Schema Init: create/update tables on first request
 * - Lazy Migration: run user-defined migrations
 * - CRUD operations via internal Hono sub-app
 * - Backup dump/restore via /internal/backup/*
 */
import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import type {
  EdgeBaseConfig,
  TableConfig,
  TableRules,
  MigrationConfig,
  HookCtx,
  AuthContext,
} from '@edge-base/shared';
import { EdgeBaseError, getTableAccess, getTableHooks } from '@edge-base/shared';
import {
  META_TABLE_DDL,
  generateTableDDL,
  generateAddColumnDDL,
  generateFTS5DDL,
  generateFTS5Triggers,
  generateIndexDDL,
  buildEffectiveSchema,
  computeSchemaHashSync,
} from '../lib/schema.js';

import { generateId } from '../lib/uuid.js';
import { parseUpdateBody } from '../lib/op-parser.js';
import {
  buildListQuery,
  buildGetQuery,
  buildCountQuery,
  buildSearchQuery,
  buildSubstringSearchQuery,
  parseQueryParams,
  type FilterTuple,
} from '../lib/query-engine.js';
import { summarizeValidationErrors, validateInsert, validateUpdate } from '../lib/validation.js';
import { hookRejectedError, validationError, notFoundError, normalizeDatabaseError } from '../lib/errors.js';
import {
  executeDbTriggers,
  getRegisteredFunctions,
  buildFunctionContext,
} from '../lib/functions.js';
import { parseDbDoName, parseConfig as getGlobalConfig } from '../lib/do-router.js';
import { parseDuration } from '../lib/jwt.js';
import { createPushProvider } from '../lib/push-provider.js';
import { getDevicesForUser } from '../lib/push-token.js';
import { ensureAuthSchema } from '../lib/auth-d1.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import { buildDbLiveChannel, DATABASE_LIVE_HUB_DO_NAME } from '../lib/database-live-emitter.js';
import { resolveRootServiceKey } from '../lib/service-key.js';
import { resolveDbLiveBatchThreshold } from '../lib/database-live-config.js';
import type { Env } from '../types.js';

// ─── Types ───

interface DOEnv {
  DATABASE_LIVE: DurableObjectNamespace;
  DATABASE: DurableObjectNamespace;
  AUTH: DurableObjectNamespace;
  AUTH_DB?: D1Database;
  KV?: KVNamespace;
  SERVICE_KEY?: string;
}

// ─── DatabaseDO Class ───

export class DatabaseDO extends DurableObject<DOEnv> {
  private app: Hono;
  private config: EdgeBaseConfig;
  private initialized = false;
  private doName = '';

  constructor(ctx: DurableObjectState, env: DOEnv) {
    super(ctx, env);
    this.config = this.parseConfig(env);
    this.app = this.buildApp();
  }

  private getServiceKey(): string | undefined {
    return resolveRootServiceKey(this.config, this.env as unknown as Env);
  }

  async fetch(request: Request): Promise<Response> {
    // Determine DO name from header or URL
    const doNameHeader = request.headers.get('X-DO-Name');

    if (doNameHeader) this.doName = doNameHeader;

    // Lazy initialization on first request
    if (!this.initialized) {
      // §36: Newly created DO must be authorized before initialization.
      // If X-DO-Create-Authorized header is absent, signal Worker to evaluate canCreate.
      // Shared/static DOs (doName === 'shared' or system) skip this gate.
      const isStaticDO = !this.doName || this.doName === 'shared' || this.doName.startsWith('_');
      if (!isStaticDO && !request.headers.get('X-DO-Create-Authorized')) {
        // Check if _meta table already exists (i.e., DO was previously initialized)
        let alreadyExists = false;
        try {
          this.ctx.storage.sql.exec('SELECT 1 FROM _meta LIMIT 1');
          alreadyExists = true;
        } catch {
          // Table doesn't exist yet — this is a genuinely new DO
        }

        if (!alreadyExists) {
          // Signal Worker: this DO needs canCreate evaluation before init
          const parsed = this.doName ? parseDbDoName(this.doName) : null;
          return Response.json(
            { needsCreate: true, namespace: parsed?.namespace ?? 'shared', id: parsed?.id },
            { status: 201 },
          );
        }
      }

      this.initializeSchema();
      this.initialized = true;
      // Persist doName for backup DO enumeration
      if (this.doName) {
        this.setMeta('doName', this.doName);
      }
    }

    return this.app.fetch(request);
  }

  // ─── Auth Context parsing (for hooks) ───

  /**
   * Parse auth context from X-Auth-Context header forwarded by Worker (#133 §6).
   */
  private parseAuthContext(request: Request): AuthContext | null {
    const raw = request.headers.get('X-Auth-Context');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthContext;
    } catch {
      return null;
    }
  }

  /**
   * Check if this request was made with a valid Service Key.
   * The 'X-Is-Service-Key: true' header is injected by tables.ts ONLY after
   * the Worker validates the SK — it is not forwarded from external requests.
   * SK requests bypass all row-level rules.
   */
  private isServiceKeyRequest(request: Request): boolean {
    return (
      request.headers.get('X-Is-Service-Key') === 'true'
      || (
        request.headers.get('X-EdgeBase-Internal') === 'true'
        && new URL(request.url).host === 'do'
      )
    );
  }

  /**
   * Build HookCtx passed to table hooks (#133 §6).
   * db.get/list/exists use local SQL; databaseLive.broadcast uses emitDbLiveEvent.
   */
  private buildHookCtx(_table: string): HookCtx {
    return {
      db: {
        get: (tbl: string, id: string) => {
          const rows = [...this.sql(`SELECT * FROM "${tbl}" WHERE "id" = ? LIMIT 1`, id)];
          return Promise.resolve((rows[0] as Record<string, unknown>) ?? null);
        },
        list: (tbl: string, filter?: Record<string, unknown>) => {
          const escId = (n: string) => `"${n.replace(/"/g, '""')}"`;
          if (filter && Object.keys(filter).length > 0) {
            const keys = Object.keys(filter);
            const cond = keys.map((k) => `${escId(k)} = ?`).join(' AND ');
            const vals = keys.map((k) => filter[k]);
            const rows = [...this.sql(`SELECT * FROM ${escId(tbl)} WHERE ${cond}`, ...vals)];
            return Promise.resolve(rows as Record<string, unknown>[]);
          }
          const rows = [...this.sql(`SELECT * FROM ${escId(tbl)}`)];
          return Promise.resolve(rows as Record<string, unknown>[]);
        },
        exists: (tbl: string, filter: Record<string, unknown>) => {
          const escId = (n: string) => `"${n.replace(/"/g, '""')}"`;
          const keys = Object.keys(filter);
          if (keys.length === 0) return Promise.resolve(false);
          const cond = keys.map((k) => `${escId(k)} = ?`).join(' AND ');
          const vals = keys.map((k) => filter[k]);
          const rows = [...this.sql(`SELECT 1 FROM ${escId(tbl)} WHERE ${cond} LIMIT 1`, ...vals)];
          return Promise.resolve(rows.length > 0);
        },
      },
      databaseLive: {
        broadcast: (channel: string, event: string, data: unknown) => {
          return this.sendBroadcastToDatabaseLiveDO(
            channel,
            { channel, event, payload: data ?? {} },
          );
        },
      },
      push: {
        // Push from hooks — direct FCM via push-provider + KV device tokens
        send: async (userId: string, payload: { title?: string; body: string }) => {
          // Fire-and-forget — hooks are non-critical side effects
          try {
            if (!this.env.KV) return;
            const provider = createPushProvider(this.config.push, this.env as unknown as Env);
            if (!provider) return;
            let tokenStore: KVNamespace | { kv: KVNamespace; authDb?: AuthDb | null } = this.env.KV;
            try {
              const authDb = resolveAuthDb(this.env as unknown as Record<string, unknown>);
              await ensureAuthSchema(authDb);
              tokenStore = { kv: this.env.KV, authDb };
            } catch {
              tokenStore = this.env.KV;
            }
            const devices = await getDevicesForUser(tokenStore, userId);
            if (devices.length === 0) return;
            await Promise.allSettled(
              devices.map((device) =>
                provider.send({ token: device.token, platform: device.platform, payload }),
              ),
            );
          } catch {
            /* best-effort */
          }
        },
      },
      waitUntil: (p: Promise<unknown>) => this.ctx.waitUntil(p),
    };
  }

  // ─── Record Enrich ───

  /**
   * Run onEnrich hook for a single record.
   * Returns the original record plus enriched fields (original if no hook or hook returns void).
   */
  private async enrichRecord(
    tableName: string,
    record: Record<string, unknown>,
    auth: AuthContext | null,
  ): Promise<Record<string, unknown>> {
    const tableConfig = this.getTableConfig(tableName);
    const onEnrich = getTableHooks(tableConfig ?? undefined)?.onEnrich;
    if (!onEnrich) return record;
    try {
      const hookCtx = this.buildHookCtx(tableName);
      const result = await onEnrich(auth, record, hookCtx);
      if (result && typeof result === 'object') return { ...record, ...result };
      return record;
    } catch (err) {
      console.error(`[EdgeBase] onEnrich hook error for table "${tableName}":`, err);
      return record; // return original record on hook failure
    }
  }

  /**
   * Run onEnrich hook for multiple records in parallel.
   */
  private async enrichRecords(
    tableName: string,
    records: Record<string, unknown>[],
    auth: AuthContext | null,
  ): Promise<Record<string, unknown>[]> {
    const tableConfig = this.getTableConfig(tableName);
    const onEnrich = getTableHooks(tableConfig ?? undefined)?.onEnrich;
    if (!onEnrich || records.length === 0) return records;
    return Promise.all(records.map((r) => this.enrichRecord(tableName, r, auth)));
  }

  // ─── Schema Initialization ───

  private initializeSchema(): void {
    // Enable FK enforcement (#133 §35) — SQLite FKs are off by default
    this.ctx.storage.sql.exec('PRAGMA foreign_keys = ON');

    // 1. Always create _meta table
    this.execMulti(META_TABLE_DDL);

    // NOTE: System DO (db:_system) tables removed — _users_public → AUTH_DB D1,
    // _schedules → Cron Triggers.

    // 3. User tables — Lazy Schema Init
    const tables = this.getMyTables();

    for (const [name, tableConfig] of Object.entries(tables)) {
      this.initTable(name, tableConfig as TableConfig);
    }
  }

  private initTable(name: string, config: TableConfig): void {
    const hashKey = `schemaHash:${name}`;
    const currentHash = this.getMeta(hashKey);
    const newHash = computeSchemaHashSync(config);

    if (!currentHash) {
      // First time — create table with all DDL
      const ddlStatements = generateTableDDL(name, config);
      for (const ddl of ddlStatements) {
        this.execMulti(ddl);
      }

      // Set initial migration version if migrations exist
      const maxVersion = config.migrations?.length
        ? Math.max(...config.migrations.map((m: MigrationConfig) => m.version))
        : 1;
      this.setMeta(`migration_version:${name}`, String(maxVersion));
      this.setMeta(hashKey, newHash);
    } else if (currentHash !== newHash) {
      // Schema changed — detect new columns (non-destructive only)
      this.handleSchemaUpdate(name, config);
      this.setMeta(hashKey, newHash);

      // Run pending migrations
      this.runMigrations(name, config);
    } else {
      // No schema change — still check migrations
      this.runMigrations(name, config);
    }

    // Always ensure FTS5 + indexes exist (idempotent IF NOT EXISTS DDL).
    // Covers case where initial creation failed silently but hash was saved.
    this.ensureFTS5AndIndexes(name, config);
  }

  private handleSchemaUpdate(name: string, config: TableConfig): void {
    // Add new columns (non-destructive)
    const existingCols = new Set<string>();
    for (const row of this.sql(`PRAGMA table_info("${name}")`)) {
      existingCols.add(row.name as string);
    }

    const effectiveSchema = buildEffectiveSchema(config.schema);
    for (const [colName, field] of Object.entries(effectiveSchema)) {
      if (!existingCols.has(colName)) {
        const ddl = generateAddColumnDDL(name, colName, field);
        this.execMulti(ddl);
      }
    }
  }

  /**
   * Ensure FTS5 virtual tables, triggers, and indexes exist.
   * All DDL uses IF NOT EXISTS / IF NOT EXISTS — safe to run idempotently.
   * This is called on EVERY initTable path, so even if initial creation
   * silently failed (e.g., trigram tokenizer unavailable), subsequent DO
   * wake-ups will retry and self-heal.
   */
  private ensureFTS5AndIndexes(name: string, config: TableConfig): void {
    if (config.fts?.length) {
      try {
        this.execMulti(generateFTS5DDL(name, config.fts));
        for (const triggerDDL of generateFTS5Triggers(name, config.fts)) {
          this.execMulti(triggerDDL);
        }
      } catch {
        // FTS5 may not be supported in this SQLite build — log and continue
      }
    }

    if (config.indexes?.length) {
      for (const indexDDL of generateIndexDDL(name, config.indexes)) {
        this.execMulti(indexDDL);
      }
    }
  }

  /**
   * Schemaless CRUD support: dynamically add TEXT columns
   * for user-provided fields that don't yet exist in the table.
   * Only called when colConfig.schema is undefined.
   */
  private ensureSchemalessColumns(tableName: string, fields: string[]): void {
    const existingCols = new Set<string>();
    for (const row of this.sql(`PRAGMA table_info("${tableName}")`)) {
      existingCols.add(row.name as string);
    }
    for (const field of fields) {
      if (!existingCols.has(field)) {
        this.sql(`ALTER TABLE "${tableName}" ADD COLUMN "${field}" TEXT`);
      }
    }
  }

  // ─── Lazy Migration Engine ───

  private runMigrations(name: string, config: TableConfig): void {
    if (!config.migrations?.length) return;

    const versionKey = `migration_version:${name}`;
    const currentVersion = parseInt(this.getMeta(versionKey) || '1', 10);

    const pending = config.migrations
      .filter((m: MigrationConfig) => m.version > currentVersion)
      .sort((a: MigrationConfig, b: MigrationConfig) => a.version - b.version);

    for (const migration of pending) {
      try {
        this.execMulti(migration.up);
        this.setMeta(versionKey, String(migration.version));
      } catch (err) {
        // Migration failed — stop here, return 503 on subsequent requests
        console.error(`Migration v${migration.version} failed for ${name}:`, err);
        throw new Error(`Migration v${migration.version} failed: ${(err as Error).message}`);
      }
    }
  }

  // ─── Hono Sub-App (Internal Routes) ───

  private buildApp(): Hono {
    const app = new Hono();

    // Error handler — registered at end of buildApp() (see bottom of this method).
    // NOTE: only ONE onError per Hono app (duplicates are silently ignored).

    // Health check
    app.get('/health', (c) => c.json({ status: 'ok', do: this.doName }));

    // ─── Table CRUD ───

    // LIST: GET /tables/:name
    app.get('/tables/:name', async (c) => {
      const name = c.req.param('name');
      this.ensureTableExists(name);

      const queryParams = Object.fromEntries(new URL(c.req.url).searchParams);
      const options = parseQueryParams(queryParams);
      const { sql, params, countSql, countParams } = buildListQuery(name, options);

      const tableConfig = this.getTableConfig(name);
      const rows = [...this.sql(sql, ...params)] as Record<string, unknown>[];
      const normalizedRows = this.normalizeRows(rows, tableConfig);

      // §7 All-or-Nothing row-level read rule (BUG-005) — SK bypasses
      const listRules = getTableAccess(tableConfig ?? undefined) as TableRules | undefined;
      if (listRules?.read && !this.isServiceKeyRequest(c.req.raw)) {
        const listAuth = this.parseAuthContext(c.req.raw);
        for (const row of normalizedRows) {
          const canRead = await this.evalRowRule(listRules.read, listAuth, row);
          if (!canRead) {
            throw new EdgeBaseError(
              403,
              `Access denied: 'read' rule blocked row "${row.id}" in table "${name}".`,
            );
          }
        }
      }

      // onEnrich hook — transform/augment records before response
      const authContext = this.parseAuthContext(c.req.raw);
      const enrichedRows = await this.enrichRecords(name, normalizedRows, authContext);

      // Build response
      const response: Record<string, unknown> = { items: enrichedRows };

      // Offset pagination: include total, page, perPage
      if (countSql && countParams) {
        const countResult = [...this.sql(countSql, ...countParams)];
        const total = (countResult[0]?.total as number) ?? 0;
        const perPage = options.pagination?.perPage ?? options.pagination?.limit ?? 100;
        response.total = total;
        response.page = options.pagination?.page ?? 1;
        response.perPage = perPage;
      }

      // Cursor pagination: always include cursor and hasMore when items exist
      // so clients can start cursor-based pagination from any page (including the first)
      const limit = options.pagination?.limit ?? options.pagination?.perPage ?? 100;
      const hasMore = normalizedRows.length === limit;
      response.hasMore = hasMore;
      if (normalizedRows.length > 0) {
        response.cursor = normalizedRows[normalizedRows.length - 1].id;
      }

      return c.json(response);
    });

    // COUNT: GET /tables/:name/count
    // NOTE: must be registered BEFORE /:name/:id to avoid "count" matching as :id
    app.get('/tables/:name/count', async (c) => {
      const name = c.req.param('name');
      this.ensureTableExists(name);

      const queryParams = Object.fromEntries(new URL(c.req.url).searchParams);
      const options = parseQueryParams(queryParams);

      const { sql, params } = buildCountQuery(name, options.filters, options.orFilters);
      const rows = [...this.sql(sql, ...params)];
      const total = (rows[0]?.total as number) ?? 0;
      return c.json({ total });
    });

    // SEARCH: GET /tables/:name/search
    // NOTE: must be registered BEFORE /:name/:id to avoid "search" matching as :id
    app.get('/tables/:name/search', async (c) => {
      const name = c.req.param('name');
      this.ensureTableExists(name);

      const queryParams = Object.fromEntries(new URL(c.req.url).searchParams);
      const options = parseQueryParams(queryParams);
      const q = options.search || '';
      if (!q) {
        return c.json({ items: [] });
      }

      const limit = options.pagination?.limit ?? options.pagination?.perPage ?? 100;
      const offset = options.pagination?.offset ?? ((options.pagination?.page ?? 1) - 1) * limit;

      const tableConfig = this.getTableConfig(name);
      const ftsFields = tableConfig?.fts;

      const highlightPre = c.req.query('highlightPre') || '<mark>';
      const highlightPost = c.req.query('highlightPost') || '</mark>';

      const searchQuery = buildSearchQuery(name, q, {
        pagination: options.pagination,
        filters: options.filters,
        orFilters: options.orFilters,
        sort: options.sort,
        ftsFields,
        highlightPre,
        highlightPost,
      });

      try {
        let rows = [...this.sql(searchQuery.sql, ...searchQuery.params)] as Record<string, unknown>[];
        let total = Number(
          searchQuery.countSql
            ? [...this.sql(searchQuery.countSql, ...(searchQuery.countParams ?? []))][0]?.total ?? rows.length
            : rows.length,
        );
        if (rows.length === 0) {
          const fallback = buildSubstringSearchQuery(name, q, {
            pagination: options.pagination,
            filters: options.filters,
            orFilters: options.orFilters,
            sort: options.sort,
            fields: ftsFields,
          });
          rows = [...this.sql(fallback.sql, ...fallback.params)] as Record<string, unknown>[];
          total = Number(
            fallback.countSql
              ? [...this.sql(fallback.countSql, ...(fallback.countParams ?? []))][0]?.total ?? rows.length
              : rows.length,
          );
        }
        const tableConfig = this.getTableConfig(name);
        const normalizedSearch = this.normalizeRows(rows, tableConfig);

        // §7 All-or-Nothing read rule for search results (BUG-005) — SK bypasses
        const searchRules = getTableAccess(tableConfig ?? undefined) as TableRules | undefined;
        if (searchRules?.read && !this.isServiceKeyRequest(c.req.raw)) {
          const searchAuth = this.parseAuthContext(c.req.raw);
          for (const row of normalizedSearch) {
            const canRead = await this.evalRowRule(searchRules.read, searchAuth, row);
            if (!canRead) {
              throw new EdgeBaseError(
                403,
                `Access denied: 'read' rule blocked row "${row.id}" in table "${name}".`,
              );
            }
          }
        }

        // onEnrich hook — transform/augment records before response
        const searchEnrichAuth = this.parseAuthContext(c.req.raw);
        const enrichedSearch = await this.enrichRecords(name, normalizedSearch, searchEnrichAuth);

        return c.json({ items: enrichedSearch, total, hasMore: total > offset + enrichedSearch.length, cursor: null, page: null, perPage: limit });
      } catch (err) {
        if (err instanceof EdgeBaseError) throw err;
        return c.json({ items: [], error: 'FTS5 not configured for this table.' }, 400);
      }
    });

    // GET: GET /tables/:name/:id
    app.get('/tables/:name/:id', async (c) => {
      const name = c.req.param('name');
      const id = c.req.param('id');
      this.ensureTableExists(name);

      const fieldsParam = c.req.query('fields');
      const fields = fieldsParam ? fieldsParam.split(',').map((f) => f.trim()) : undefined;
      const { sql, params } = buildGetQuery(name, id, fields);
      const rows = [...this.sql(sql, ...params)];

      if (rows.length === 0) {
        throw notFoundError(`Record ${id} not found.`);
      }

      const tableConfig = this.getTableConfig(name);
      const normalizedGet = this.normalizeRow(rows[0] as Record<string, unknown>, tableConfig);

      // §7 row-level read rule (BUG-005) — SK bypasses
      const getRules = getTableAccess(tableConfig ?? undefined) as TableRules | undefined;
      if (getRules?.read && !this.isServiceKeyRequest(c.req.raw)) {
        const getAuth = this.parseAuthContext(c.req.raw);
        const canRead = await this.evalRowRule(getRules.read, getAuth, normalizedGet);
        if (!canRead)
          throw new EdgeBaseError(
            403,
            `Access denied: 'read' rule blocked record "${id}" in table "${name}".`,
          );
      }

      // onEnrich hook — transform/augment record before response
      const getAuth = this.parseAuthContext(c.req.raw);
      const enrichedGet = await this.enrichRecord(name, normalizedGet, getAuth);

      return c.json(enrichedGet);
    });

    // CREATE: POST /tables/:name
    app.post('/tables/:name', async (c) => {
      const name = c.req.param('name');
      this.ensureTableExists(name);
      const tableConfig = this.getTableConfig(name);
      if (!tableConfig) {
        throw validationError(`Table '${name}' is not defined in the schema configuration.`);
      }

      const body = await c.req.json<Record<string, unknown>>();

      // Check for upsert mode
      const upsertMode = c.req.query('upsert') === 'true';
      const conflictTarget = c.req.query('conflictTarget') || 'id';

      // Validate conflictTarget if upsert mode
      if (upsertMode && conflictTarget !== 'id') {
        const effectiveForConflict = buildEffectiveSchema(tableConfig.schema);
        const targetField = effectiveForConflict[conflictTarget];
        if (!targetField) {
          throw validationError(`Field '${conflictTarget}' does not exist in schema.`);
        }
        if (!targetField.unique) {
          throw validationError(
            `Field '${conflictTarget}' is not unique. conflictTarget must be a unique field.`,
          );
        }
      }

      // Validate
      const result = validateInsert(body, tableConfig.schema);
      if (!result.valid) {
        throw validationError(
          summarizeValidationErrors(result.errors),
          Object.fromEntries(
            Object.entries(result.errors).map(([k, v]) => [k, { code: 'invalid', message: v }]),
          ),
        );
      }

      const now = new Date().toISOString();
      const id = (body.id as string) || generateId();
      const effective = buildEffectiveSchema(tableConfig.schema);

      // Build INSERT data with auto fields
      const record: Record<string, unknown> = { ...body, id };
      if ('createdAt' in effective) record.createdAt = now;
      if ('updatedAt' in effective) record.updatedAt = now;

      // Apply default values
      for (const [fname, field] of Object.entries(effective)) {
        if (record[fname] === undefined && field.default !== undefined) {
          record[fname] = field.default;
        }
      }

      // Run beforeInsert hook if defined (#133 §6)
      const auth = this.parseAuthContext(c.req.raw);
      const tableHooks = getTableHooks(tableConfig ?? undefined);
      if (tableHooks?.beforeInsert) {
        const hookCtx = this.buildHookCtx(name);
        try {
          const transformed = await tableHooks.beforeInsert(auth, record, hookCtx);
          if (transformed && typeof transformed === 'object') {
            Object.assign(record, transformed);
          }
        } catch (err) {
          throw hookRejectedError(err, 'Insert rejected by beforeInsert hook.');
        }
      }

      // Schemaless: include all record keys; schema-defined: filter through effective
      let columns: string[];
      if (!tableConfig.schema) {
        columns = Object.keys(record);
        this.ensureSchemalessColumns(
          name,
          columns.filter((k) => !(k in effective)),
        );
      } else {
        columns = Object.keys(record).filter((k) => k in effective);
      }
      const values = columns.map((k) => {
        const v = record[k];
        // Serialize json-type fields to string for SQLite TEXT storage (BUG-006)
        if (
          effective[k]?.type === 'json' &&
          v !== null &&
          v !== undefined &&
          typeof v === 'object'
        ) {
          return JSON.stringify(v);
        }
        if (effective[k]?.type === 'boolean' && v !== null && v !== undefined) {
          return v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0;
        }
        return v;
      });
      const placeholders = columns.map(() => '?').join(', ');
      const colStr = columns.map((c) => `"${c}"`).join(', ');

      // Track whether this is an update (for database-live/response,)
      let isUpdate = false;
      // Store before row for upsert path — used by afterUpdate hook and triggers (BUG-013)
      let upsertBeforeRow: Record<string, unknown> | null = null;

      if (upsertMode) {
        // Check if record exists and capture before row (BUG-013: SELECT * instead of SELECT 1)
        if (conflictTarget === 'id') {
          const existing = [...this.sql(`SELECT * FROM "${name}" WHERE "id" = ? LIMIT 1`, id)];
          isUpdate = existing.length > 0;
          if (isUpdate) upsertBeforeRow = existing[0] as Record<string, unknown>;
        } else {
          const targetValue = record[conflictTarget];
          if (targetValue !== undefined) {
            const existing = [
              ...this.sql(
                `SELECT * FROM "${name}" WHERE "${conflictTarget}" = ? LIMIT 1`,
                targetValue,
              ),
            ];
            isUpdate = existing.length > 0;
            if (isUpdate) upsertBeforeRow = existing[0] as Record<string, unknown>;
          }
        }

        // UPSERT: ON CONFLICT DO UPDATE
        const updateCols = columns.filter(
          (k) => k !== 'id' && k !== 'createdAt' && k !== conflictTarget,
        );
        const updateSet = updateCols.map((k) => `"${k}" = excluded."${k}"`).join(', ');
        const sql = updateSet
          ? `INSERT INTO "${name}" (${colStr}) VALUES (${placeholders}) ON CONFLICT("${conflictTarget}") DO UPDATE SET ${updateSet}`
          : `INSERT INTO "${name}" (${colStr}) VALUES (${placeholders}) ON CONFLICT("${conflictTarget}") DO NOTHING`;
        this.sql(sql, ...values);
      } else {
        const sql = `INSERT INTO "${name}" (${colStr}) VALUES (${placeholders})`;
        this.sql(sql, ...values);
      }

      // Return the created/updated record
      const fetchField = upsertMode && conflictTarget !== 'id' ? conflictTarget : 'id';
      const fetchValue = upsertMode && conflictTarget !== 'id' ? record[conflictTarget] : id;
      const resultRow = [
        ...this.sql(`SELECT * FROM "${name}" WHERE "${fetchField}" = ?`, fetchValue),
      ];

      // Emit database-live event
      const eventType = isUpdate ? 'modified' : 'added';
      const resultId = ((resultRow[0] as Record<string, unknown>)?.id as string) ?? id;
      this.ctx.waitUntil(
        this.emitDbLiveEvent(name, eventType, resultId, resultRow[0] as Record<string, unknown>),
      );

      // Fire DB triggers asynchronously
      const triggerEvent = isUpdate ? 'update' : 'insert';
      const doOrigin = this.doName ? parseDbDoName(this.doName) : { namespace: 'shared' };
      const triggerData = isUpdate
        ? {
            before: upsertBeforeRow ?? (resultRow[0] as Record<string, unknown>),
            after: resultRow[0] as Record<string, unknown>,
          }
        : { after: resultRow[0] as Record<string, unknown> };
      this.ctx.waitUntil(
        executeDbTriggers(
          name,
          triggerEvent,
          triggerData,
          {
            databaseNamespace: this.env.DATABASE,
            authNamespace: this.env.AUTH,
            kvNamespace: this.env.KV,
            config: this.config,
            serviceKey: this.getServiceKey(),
          },
          doOrigin,
        ),
      );

      // Run afterInsert/afterUpdate hook if defined (#133 §6)
      if (!isUpdate && tableHooks?.afterInsert) {
        const hookCtx = this.buildHookCtx(name);
        this.ctx.waitUntil(
          Promise.resolve(
            tableHooks.afterInsert(resultRow[0] as Record<string, unknown>, hookCtx),
          ).catch(() => {
            /* best-effort */
          }),
        );
      } else if (isUpdate && tableHooks?.afterUpdate) {
        const hookCtx = this.buildHookCtx(name);
        this.ctx.waitUntil(
          Promise.resolve(
            tableHooks.afterUpdate(
              // BUG-013 fix: pass actual before row captured before upsert
              upsertBeforeRow ?? (resultRow[0] as Record<string, unknown>),
              resultRow[0] as Record<string, unknown>,
              hookCtx,
            ),
          ).catch(() => {
            /* best-effort */
          }),
        );
      }

      // Response: 201 + action:inserted or 200 + action:updated
      const statusCode = isUpdate ? 200 : 201;
      const action = isUpdate ? 'updated' : 'inserted';
      const normalizedResult = this.normalizeRow(
        resultRow[0] as Record<string, unknown>,
        tableConfig,
      );
      if (upsertMode) {
        return c.json({ ...normalizedResult, action }, statusCode as 200);
      }
      return c.json(normalizedResult, 201);
    });

    // UPDATE: PATCH /tables/:name/:id
    app.patch('/tables/:name/:id', async (c) => {
      const name = c.req.param('name');
      const id = c.req.param('id');
      this.ensureTableExists(name);
      const tableConfig = this.getTableConfig(name);
      if (!tableConfig) {
        throw validationError(`Table '${name}' is not defined in the schema configuration.`);
      }

      const body = await c.req.json<Record<string, unknown>>();

      // Validate
      const result = validateUpdate(body, tableConfig.schema);
      if (!result.valid) {
        throw validationError(
          'Validation failed.',
          Object.fromEntries(
            Object.entries(result.errors).map(([k, v]) => [k, { code: 'invalid', message: v }]),
          ),
        );
      }

      // Check record exists
      const existing = [...this.sql(`SELECT * FROM "${name}" WHERE "id" = ?`, id)];
      if (existing.length === 0) {
        throw notFoundError(`Record ${id} not found.`);
      }

      // §7 row-level update rule (BUG-005) — SK bypasses
      const updateRules = getTableAccess(tableConfig ?? undefined) as TableRules | undefined;
      const authForUpdate = this.parseAuthContext(c.req.raw);
      if (updateRules?.update && !this.isServiceKeyRequest(c.req.raw)) {
        const canUpdate = await this.evalRowRule(
          updateRules.update,
          authForUpdate,
          existing[0] as Record<string, unknown>,
        );
        if (!canUpdate)
          throw new EdgeBaseError(
            403,
            `Access denied: 'update' rule blocked record "${id}" in table "${name}".`,
          );
      }

      // Build UPDATE with $op support
      const effective = buildEffectiveSchema(tableConfig.schema);
      const updateData = { ...body };
      delete updateData.id;
      delete updateData.createdAt;

      // Apply onUpdate: 'now'
      if ('updatedAt' in effective && effective.updatedAt?.onUpdate === 'now') {
        updateData.updatedAt = new Date().toISOString();
      }

      // Schema-defined: remove fields not in effective schema to prevent SQLite
      // "no such column" errors when deleteField() is applied to non-schema fields
      if (tableConfig.schema) {
        for (const key of Object.keys(updateData)) {
          if (!(key in effective)) delete updateData[key];
        }
      } else {
        // Schemaless: ensure columns exist for all update fields
        this.ensureSchemalessColumns(
          name,
          Object.keys(updateData).filter((k) => !(k in effective)),
        );
      }

      // Serialize json-type fields to string for SQLite TEXT storage (BUG-006)
      for (const [key, value] of Object.entries(updateData)) {
        if (
          effective[key]?.type === 'json' &&
          value !== null &&
          value !== undefined &&
          typeof value === 'object' &&
          !('$op' in value)
        ) {
          updateData[key] = JSON.stringify(value);
        } else if (
          effective[key]?.type === 'boolean' &&
          value !== null &&
          value !== undefined &&
          (typeof value !== 'object' || !('$op' in value))
        ) {
          updateData[key] = value === true || value === 'true' || value === 1 || value === '1'
            ? 1
            : 0;
        }
      }

      const { setClauses, params } = parseUpdateBody(updateData);
      if (setClauses.length === 0) {
        return c.json(existing[0]);
      }

      params.push(id);

      // Run beforeUpdate hook if defined (#133 §6) — reuses authForUpdate from above
      const tableHooks = getTableHooks(tableConfig ?? undefined);
      if (tableHooks?.beforeUpdate) {
        const hookCtx = this.buildHookCtx(name);
        try {
          const transformed = await tableHooks.beforeUpdate(
            authForUpdate,
            existing[0] as Record<string, unknown>,
            updateData,
            hookCtx,
          );
          if (transformed && typeof transformed === 'object') {
            // Re-build SET clause from transformed data
            const newUpdateData = { ...updateData, ...transformed } as Record<string, unknown>;
            delete newUpdateData.id;
            delete newUpdateData.createdAt;
            const rebuilt = parseUpdateBody(newUpdateData);
            setClauses.length = 0;
            setClauses.push(...rebuilt.setClauses);
            params.length = 0;
            params.push(...rebuilt.params, id);
          }
        } catch (err) {
          throw hookRejectedError(err, 'Update rejected by beforeUpdate hook.');
        }
      }

      // Build SQL after hook processing so setClauses/params reflect any transformations
      const sql = `UPDATE "${name}" SET ${setClauses.join(', ')} WHERE "id" = ?`;
      this.sql(sql, ...params);

      // Return updated record
      const updated = [...this.sql(`SELECT * FROM "${name}" WHERE "id" = ?`, id)];

      // Emit database-live event
      this.ctx.waitUntil(
        this.emitDbLiveEvent(name, 'modified', id, updated[0] as Record<string, unknown>),
      );

      // Fire DB triggers asynchronously
      const doOriginUpdate = this.doName ? parseDbDoName(this.doName) : { namespace: 'shared' };
      this.ctx.waitUntil(
        executeDbTriggers(
          name,
          'update',
          {
            before: existing[0] as Record<string, unknown>,
            after: updated[0] as Record<string, unknown>,
          },
          {
            databaseNamespace: this.env.DATABASE,
            authNamespace: this.env.AUTH,
            kvNamespace: this.env.KV,
            config: this.config,
            serviceKey: this.getServiceKey(),
          },
          doOriginUpdate,
        ),
      );

      // Run afterUpdate hook if defined (#133 §6)
      if (tableHooks?.afterUpdate) {
        const hookCtx = this.buildHookCtx(name);
        this.ctx.waitUntil(
          Promise.resolve(
            tableHooks.afterUpdate(
              existing[0] as Record<string, unknown>,
              updated[0] as Record<string, unknown>,
              hookCtx,
            ),
          ).catch(() => {
            /* best-effort */
          }),
        );
      }

      return c.json(this.normalizeRow(updated[0] as Record<string, unknown>, tableConfig));
    });

    // DELETE: DELETE /tables/:name/:id
    app.delete('/tables/:name/:id', async (c) => {
      const name = c.req.param('name');
      const id = c.req.param('id');
      this.ensureTableExists(name);
      const tableConfig = this.getTableConfig(name);

      const existing = [...this.sql(`SELECT * FROM "${name}" WHERE "id" = ?`, id)];
      if (existing.length === 0) {
        throw notFoundError(`Record ${id} not found.`);
      }

      // §7 row-level delete rule (BUG-005) — SK bypasses
      const deleteRules = getTableAccess(tableConfig ?? undefined) as TableRules | undefined;
      const authForDelete = this.parseAuthContext(c.req.raw);
      if (deleteRules?.delete && !this.isServiceKeyRequest(c.req.raw)) {
        const canDelete = await this.evalRowRule(
          deleteRules.delete,
          authForDelete,
          existing[0] as Record<string, unknown>,
        );
        if (!canDelete)
          throw new EdgeBaseError(
            403,
            `Access denied: 'delete' rule blocked record "${id}" in table "${name}".`,
          );
      }

      // Run beforeDelete hook if defined (#133 §6)
      const tableHooks = getTableHooks(tableConfig ?? undefined);
      if (tableHooks?.beforeDelete) {
        const hookCtx = this.buildHookCtx(name);
        try {
          await tableHooks.beforeDelete(
            authForDelete,
            existing[0] as Record<string, unknown>,
            hookCtx,
          );
        } catch (err) {
          throw hookRejectedError(err, 'Delete rejected by beforeDelete hook.');
        }
      }

      this.sql(`DELETE FROM "${name}" WHERE "id" = ?`, id);

      // Emit database-live event
      this.ctx.waitUntil(
        this.emitDbLiveEvent(name, 'removed', id, existing[0] as Record<string, unknown>),
      );

      // Fire DB triggers asynchronously
      const doOriginDelete = this.doName ? parseDbDoName(this.doName) : { namespace: 'shared' };
      this.ctx.waitUntil(
        executeDbTriggers(
          name,
          'delete',
          { before: existing[0] as Record<string, unknown> },
          {
            databaseNamespace: this.env.DATABASE,
            authNamespace: this.env.AUTH,
            kvNamespace: this.env.KV,
            config: this.config,
            serviceKey: this.getServiceKey(),
          },
          doOriginDelete,
        ),
      );

      // Run afterDelete hook if defined (#133 §6)
      if (tableHooks?.afterDelete) {
        const hookCtx = this.buildHookCtx(name);
        this.ctx.waitUntil(
          Promise.resolve(
            tableHooks.afterDelete(existing[0] as Record<string, unknown>, hookCtx),
          ).catch(() => {
            /* best-effort */
          }),
        );
      }

      return c.json({ deleted: true });
    });

    // BATCH: POST /tables/:name/batch
    app.post('/tables/:name/batch', async (c) => {
      const name = c.req.param('name');
      this.ensureTableExists(name);
      const tableConfig = this.getTableConfig(name);
      if (!tableConfig) {
        throw validationError(`Table '${name}' is not defined in the schema configuration.`);
      }

      // upsertMany: ?upsert=true
      const upsertMode = c.req.query('upsert') === 'true';
      const conflictTarget = c.req.query('conflictTarget') || 'id';

      // Validate conflictTarget if upsert mode
      if (upsertMode && conflictTarget !== 'id') {
        const eff = buildEffectiveSchema(tableConfig.schema);
        const targetField = eff[conflictTarget];
        if (!targetField) {
          throw validationError(`Field '${conflictTarget}' does not exist in schema.`);
        }
        if (!targetField.unique) {
          throw validationError(
            `Field '${conflictTarget}' is not unique. conflictTarget must be a unique field.`,
          );
        }
      }

      const body = await c.req.json<{
        inserts?: Record<string, unknown>[];
        updates?: { id: string; data: Record<string, unknown> }[];
        deletes?: string[];
      }>();

      // Batch size limit
      const MAX_BATCH_SIZE = 500;
      const totalOps =
        (body.inserts?.length ?? 0) + (body.updates?.length ?? 0) + (body.deletes?.length ?? 0);
      if (totalOps > MAX_BATCH_SIZE) {
        throw validationError(
          `Batch limit exceeded: ${totalOps} operations (max ${MAX_BATCH_SIZE}).`,
        );
      }

      // Check rules for each operation type — SK bypasses
      // Insert: table-level (no row needed). Update/Delete: per-row inside transaction.
      const batchRules = getTableAccess(tableConfig ?? undefined) as TableRules | undefined;
      const batchAuth = this.parseAuthContext(c.req.raw);
      const isSKBatch = this.isServiceKeyRequest(c.req.raw);
      if (!isSKBatch) {
        if (body.inserts?.length && batchRules?.insert) {
          const canInsert = await this.evalRowRule(batchRules.insert, batchAuth, {});
          if (!canInsert)
            throw new EdgeBaseError(
              403,
              `Access denied: 'insert' rule blocked batch insert on table "${name}".`,
            );
        }
        // update/delete rules are evaluated per-row inside the transaction below
      }

      const results: Record<string, unknown> = {};
      // Store full rows before deletion for triggers (BUG-012) — declared outside transaction
      const deletedRows: Record<string, unknown>[] = [];
      // Store before-rows for batch updates so triggers receive { before, after } (like single-row updates)
      const updateBeforeRows: Map<string, Record<string, unknown>> = new Map();

      // All-or-nothing: use transactionSync
      this.ctx.storage.transactionSync(() => {
        const now = new Date().toISOString();
        const effective = buildEffectiveSchema(tableConfig.schema);

        // Inserts (or Upserts when ?upsert=true)
        if (body.inserts) results.inserted = [];
        if (body.inserts?.length) {
          const inserted = results.inserted as Record<string, unknown>[];
          for (const item of body.inserts) {
            const validation = validateInsert(item, tableConfig.schema);
            if (!validation.valid) {
              throw validationError(
                'Batch insert request failed validation. See data for field-level errors.',
                Object.fromEntries(
                  Object.entries(validation.errors).map(([k, v]) => [
                    k,
                    { code: 'invalid', message: v },
                  ]),
                ),
              );
            }

            const id = (item.id as string) || generateId();
            const record: Record<string, unknown> = { ...item, id };
            if ('createdAt' in effective) record.createdAt = now;
            if ('updatedAt' in effective) record.updatedAt = now;

            for (const [fname, field] of Object.entries(effective)) {
              if (record[fname] === undefined && field.default !== undefined) {
                record[fname] = field.default;
              }
            }

            // Schemaless: include all record keys
            let columns: string[];
            if (!tableConfig.schema) {
              columns = Object.keys(record);
              this.ensureSchemalessColumns(
                name,
                columns.filter((k) => !(k in effective)),
              );
            } else {
              columns = Object.keys(record).filter((k) => k in effective);
            }
            const values = columns.map((k) => {
              const v = record[k];
              // Serialize json-type fields to string for SQLite TEXT storage (BUG-006)
              if (
                effective[k]?.type === 'json' &&
                v !== null &&
                v !== undefined &&
                typeof v === 'object'
              ) {
                return JSON.stringify(v);
              }
              if (effective[k]?.type === 'boolean' && v !== null && v !== undefined) {
                return v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0;
              }
              return v;
            });
            const placeholders = columns.map(() => '?').join(', ');
            const colStr = columns.map((c) => `"${c}"`).join(', ');

            if (upsertMode) {
              // ON CONFLICT DO UPDATE
              const updateCols = columns.filter(
                (k) => k !== 'id' && k !== 'createdAt' && k !== conflictTarget,
              );
              const updateSet = updateCols.map((k) => `"${k}" = excluded."${k}"`).join(', ');
              const sql = updateSet
                ? `INSERT INTO "${name}" (${colStr}) VALUES (${placeholders}) ON CONFLICT("${conflictTarget}") DO UPDATE SET ${updateSet}`
                : `INSERT INTO "${name}" (${colStr}) VALUES (${placeholders}) ON CONFLICT("${conflictTarget}") DO NOTHING`;
              this.sql(sql, ...values);
            } else {
              this.sql(`INSERT INTO "${name}" (${colStr}) VALUES (${placeholders})`, ...values);
            }
            inserted.push(record);
          }
        }

        // Updates (BUG-010: per-row rule evaluation, BUG-011: SELECT * after write for database-live/triggers)
        if (body.updates) results.updated = [];
        if (body.updates?.length) {
          const updated = results.updated as Record<string, unknown>[];
          for (const entry of body.updates) {
            if (!entry.id) {
              throw validationError('Each batch update entry must include an id.');
            }
            if (!entry.data || typeof entry.data !== 'object') {
              throw validationError('Each batch update entry must include a data object.');
            }
            const { id, data } = entry;
            const validation = validateUpdate(data, tableConfig.schema);
            if (!validation.valid) {
              throw validationError(
                'Batch update request failed validation. See data for field-level errors.',
                Object.fromEntries(
                  Object.entries(validation.errors).map(([k, v]) => [
                    k,
                    { code: 'invalid', message: v },
                  ]),
                ),
              );
            }

            // Per-row update rule evaluation (BUG-010)
            if (!isSKBatch && batchRules?.update && typeof batchRules.update === 'function') {
              const existing = [...this.sql(`SELECT * FROM "${name}" WHERE "id" = ?`, id)];
              if (existing.length > 0) {
                try {
                  const canUpdate = (
                    batchRules.update as (
                      auth: AuthContext | null,
                      row: Record<string, unknown>,
                    ) => boolean
                  )(batchAuth, existing[0] as Record<string, unknown>);
                  if (!canUpdate)
                    throw new EdgeBaseError(
                      403,
                      `Access denied: 'update' rule blocked record "${id}" in table "${name}".`,
                    );
                } catch (e) {
                  if (e instanceof EdgeBaseError) throw e;
                  throw new EdgeBaseError(
                    403,
                    `Access denied: 'update' rule blocked record "${id}" in table "${name}".`,
                  );
                }
              }
            }

            // Capture before-row for triggers (matches single-row update behaviour)
            const beforeRow = [...this.sql(`SELECT * FROM "${name}" WHERE "id" = ?`, id)];
            if (beforeRow.length > 0) {
              updateBeforeRows.set(id as string, beforeRow[0] as Record<string, unknown>);
            }

            const updateData = { ...data };
            delete updateData.id;
            delete updateData.createdAt;
            if ('updatedAt' in effective && effective.updatedAt?.onUpdate === 'now') {
              updateData.updatedAt = now;
            }

            // Schemaless: ensure columns exist
            if (!tableConfig.schema) {
              this.ensureSchemalessColumns(
                name,
                Object.keys(updateData).filter((k) => !(k in effective)),
              );
            }

            // Serialize json-type fields to string for SQLite TEXT storage (BUG-006)
            for (const [key, value] of Object.entries(updateData)) {
              if (
                effective[key]?.type === 'json' &&
                value !== null &&
                value !== undefined &&
                typeof value === 'object' &&
                !('$op' in value)
              ) {
                updateData[key] = JSON.stringify(value);
              } else if (
                effective[key]?.type === 'boolean' &&
                value !== null &&
                value !== undefined &&
                (typeof value !== 'object' || !('$op' in value))
              ) {
                updateData[key] = value === true || value === 'true' || value === 1 || value === '1'
                  ? 1
                  : 0;
              }
            }

            const { setClauses, params } = parseUpdateBody(updateData);
            if (setClauses.length > 0) {
              params.push(id);
              this.sql(`UPDATE "${name}" SET ${setClauses.join(', ')} WHERE "id" = ?`, ...params);
            }
            // Read actual DB state after write for database-live/triggers (BUG-011)
            const afterRow = [...this.sql(`SELECT * FROM "${name}" WHERE "id" = ?`, id)];
            updated.push(
              afterRow.length > 0 ? (afterRow[0] as Record<string, unknown>) : { id, ...data },
            );
          }
        }

        // Deletes (BUG-010: per-row rule evaluation, BUG-012: full row for triggers)
        if (body.deletes) results.deleted = 0;
        if (body.deletes?.length) {
          for (const id of body.deletes) {
            const existing = [...this.sql(`SELECT * FROM "${name}" WHERE "id" = ?`, id)];
            if (existing.length > 0) {
              // Per-row delete rule evaluation (BUG-010)
              if (!isSKBatch && batchRules?.delete && typeof batchRules.delete === 'function') {
                try {
                  const canDelete = (
                    batchRules.delete as (
                      auth: AuthContext | null,
                      row: Record<string, unknown>,
                    ) => boolean
                  )(batchAuth, existing[0] as Record<string, unknown>);
                  if (!canDelete)
                    throw new EdgeBaseError(
                      403,
                      `Access denied: 'delete' rule blocked record "${id}" in table "${name}".`,
                    );
                } catch (e) {
                  if (e instanceof EdgeBaseError) throw e;
                  throw new EdgeBaseError(
                    403,
                    `Access denied: 'delete' rule blocked record "${id}" in table "${name}".`,
                  );
                }
              }
              deletedRows.push(existing[0] as Record<string, unknown>);
            }
            this.sql(`DELETE FROM "${name}" WHERE "id" = ?`, id);
          }
          results.deleted = body.deletes.length;
        }
      });

      // Emit database-live events for batch operations
      const batchResults = results as Record<string, unknown>;
      const allChanges: Array<{
        type: 'added' | 'modified' | 'removed';
        docId: string;
        data: Record<string, unknown> | null;
      }> = [];
      if (Array.isArray(batchResults.inserted)) {
        for (const item of batchResults.inserted as Record<string, unknown>[]) {
          allChanges.push({ type: 'added', docId: item.id as string, data: item });
        }
      }
      if (Array.isArray(batchResults.updated)) {
        for (const item of batchResults.updated as Record<string, unknown>[]) {
          allChanges.push({ type: 'modified', docId: item.id as string, data: item });
        }
      }
      if (body.deletes?.length) {
        for (const id of body.deletes) {
          allChanges.push({ type: 'removed', docId: id, data: null });
        }
      }

      const batchThreshold = resolveDbLiveBatchThreshold(this.config);
      if (allChanges.length >= batchThreshold) {
        //: batch_changes message
        this.ctx.waitUntil(this.emitDbLiveBatchEvent(name, allChanges));
      } else {
        // Below threshold: individual events (no overhead)
        for (const change of allChanges) {
          this.ctx.waitUntil(this.emitDbLiveEvent(name, change.type, change.docId, change.data));
        }
      }

      // Fire DB triggers asynchronously for batch items
      const doOriginBatch = this.doName ? parseDbDoName(this.doName) : { namespace: 'shared' };
      const triggerContext = {
        databaseNamespace: this.env.DATABASE,
        authNamespace: this.env.AUTH,
        kvNamespace: this.env.KV,
        config: this.config,
        serviceKey: this.getServiceKey(),
      };
      if (Array.isArray(batchResults.inserted)) {
        for (const item of batchResults.inserted as Record<string, unknown>[]) {
          this.ctx.waitUntil(
            executeDbTriggers(name, 'insert', { after: item }, triggerContext, doOriginBatch),
          );
        }
      }
      if (Array.isArray(batchResults.updated)) {
        for (const item of batchResults.updated as Record<string, unknown>[]) {
          const beforeRow = updateBeforeRows.get(item.id as string);
          this.ctx.waitUntil(
            executeDbTriggers(
              name,
              'update',
              { before: beforeRow, after: item },
              triggerContext,
              doOriginBatch,
            ),
          );
        }
      }
      // Use full row data for delete triggers (BUG-012)
      if (deletedRows.length > 0) {
        for (const row of deletedRows) {
          this.ctx.waitUntil(
            executeDbTriggers(name, 'delete', { before: row }, triggerContext, doOriginBatch),
          );
        }
      }

      return c.json(results);
    });

    // BATCH-BY-FILTER: POST /tables/:name/batch-by-filter
    app.post('/tables/:name/batch-by-filter', async (c) => {
      const name = c.req.param('name');
      this.ensureTableExists(name);
      const tableConfig = this.getTableConfig(name);
      if (!tableConfig) {
        throw validationError(`Table '${name}' is not defined in the schema configuration.`);
      }

      const body = await c.req.json<{
        action: 'delete' | 'update';
        filter: FilterTuple[];
        orFilter?: FilterTuple[];
        update?: Record<string, unknown>;
        limit?: number;
      }>();

      // Validate required fields
      if (!body.action || !['delete', 'update'].includes(body.action)) {
        throw new EdgeBaseError(
          400,
          "batch-by-filter requires 'action' to be 'delete' or 'update'.",
        );
      }
      if (!body.filter || !Array.isArray(body.filter) || body.filter.length === 0) {
        throw new EdgeBaseError(400, "batch-by-filter requires 'filter' to be a non-empty array.");
      }
      if (body.action === 'update' && !body.update) {
        throw new EdgeBaseError(
          400,
          "batch-by-filter with action 'update' requires 'update' data.",
        );
      }

      // Row-level access rule check — SK bypasses
      const bfRules = getTableAccess(tableConfig ?? undefined) as TableRules | undefined;
      const bfAuth = this.parseAuthContext(c.req.raw);
      if (!this.isServiceKeyRequest(c.req.raw)) {
        const ruleFn = body.action === 'delete' ? bfRules?.delete : bfRules?.update;
        if (ruleFn) {
          // Pre-check with empty row: for table-level boolean/auth-only rules this is sufficient.
          // Per-row evaluation happens below inside the transaction after SELECT.
          const preCheck = await this.evalRowRule(ruleFn, bfAuth, {});
          if (!preCheck)
            throw new EdgeBaseError(
              403,
              `Access denied: '${body.action}' rule blocked batch-by-filter on table "${name}".`,
            );
        } else if (this.config.release) {
          // Release mode: no rule defined → deny
          throw new EdgeBaseError(
            403,
            `Access denied. No '${body.action}' rule defined for '${name}'.`,
          );
        }
      }

      const limit = Math.min(body.limit ?? 500, 500);
      let processed = 0;
      let succeeded = 0;

      // Store the rule function and auth for per-row evaluation inside the transaction
      const bfRuleFn =
        !this.isServiceKeyRequest(c.req.raw) && bfRules
          ? body.action === 'delete'
            ? bfRules.delete
            : bfRules.update
          : undefined;

      this.ctx.storage.transactionSync(() => {
        // Find matching records
        const { sql: selectSql, params: selectParams } = buildListQuery(name, {
          filters: body.filter,
          orFilters: body.orFilter,
          pagination: { limit },
        });

        const allRows = [...this.sql(selectSql, ...selectParams)];
        processed = allRows.length;

        if (allRows.length === 0) return;

        // Per-row rule evaluation (BUG-009): filter rows that pass the rule
        let rows = allRows;
        if (bfRuleFn && typeof bfRuleFn === 'function') {
          rows = allRows.filter((r) => {
            try {
              const result = (
                bfRuleFn as (auth: AuthContext | null, row: Record<string, unknown>) => boolean
              )(bfAuth, r as Record<string, unknown>);
              return Boolean(result);
            } catch {
              return false; // fail-closed
            }
          });
          if (rows.length === 0) {
            throw new EdgeBaseError(
              403,
              `Access denied: '${body.action}' rule blocked all matched rows in table "${name}".`,
            );
          }
        }

        const ids = rows.map((r) => (r as Record<string, unknown>).id as string);
        const placeholders = ids.map(() => '?').join(', ');

        if (body.action === 'delete') {
          this.sql(`DELETE FROM "${name}" WHERE "id" IN (${placeholders})`, ...ids);
          succeeded = ids.length;
        } else if (body.action === 'update' && body.update) {
          const effective = buildEffectiveSchema(tableConfig.schema);
          const updateData = { ...body.update };
          if ('updatedAt' in effective && effective.updatedAt?.onUpdate === 'now') {
            updateData.updatedAt = new Date().toISOString();
          }

          // Schemaless: ensure columns exist
          if (!tableConfig.schema) {
            this.ensureSchemalessColumns(
              name,
              Object.keys(updateData).filter((k) => !(k in effective)),
            );
          }

          // Serialize json-type fields to string for SQLite TEXT storage (BUG-006)
          for (const [key, value] of Object.entries(updateData)) {
            if (
              effective[key]?.type === 'json' &&
              value !== null &&
              value !== undefined &&
              typeof value === 'object' &&
              !('$op' in value)
            ) {
              updateData[key] = JSON.stringify(value);
            } else if (
              effective[key]?.type === 'boolean' &&
              value !== null &&
              value !== undefined &&
              (typeof value !== 'object' || !('$op' in value))
            ) {
              updateData[key] = value === true || value === 'true' || value === 1 || value === '1'
                ? 1
                : 0;
            }
          }

          const { setClauses, params } = parseUpdateBody(updateData);
          if (setClauses.length > 0) {
            this.sql(
              `UPDATE "${name}" SET ${setClauses.join(', ')} WHERE "id" IN (${placeholders})`,
              ...params,
              ...ids,
            );
          }
          succeeded = ids.length;
        }
      });

      // Emit database-live events for batch-by-filter
      // Note: we don't have individual record data here, emit summary event
      if (succeeded > 0) {
        const eventType = body.action === 'delete' ? 'removed' : 'modified';
        const batchThreshold = resolveDbLiveBatchThreshold(this.config);
        if (succeeded >= batchThreshold) {
          //: batch_changes for large batch-by-filter operations
          this.ctx.waitUntil(
            this.emitDbLiveBatchEvent(name, [
              {
                type: eventType as 'modified' | 'removed',
                docId: '_bulk',
                data: { action: body.action, count: succeeded },
              },
            ]),
          );
        } else {
          this.ctx.waitUntil(
            this.emitDbLiveEvent(name, eventType as 'modified' | 'removed', '_bulk', {
              action: body.action,
              count: succeeded,
            }),
          );
        }
      }

      return c.json({ processed, succeeded });
    });

    // INTERNAL: POST /internal/sql — raw SQL execution for server SDK
    // Only accessible via Worker-level /api/sql route which validates Service Key.
    // Parameterized queries enforced: query + params are separate.
    app.post('/internal/sql', async (c) => {
      const { query, params } = await c.req.json<{ query: string; params?: unknown[] }>();
      if (!query || typeof query !== 'string') {
        return c.json({ code: 400, message: 'query is required' }, 400);
      }
      try {
        const rows = [...this.sql(query, ...(params ?? []))];
        return c.json({ rows });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SQL execution failed';
        return c.json({ code: 500, message }, 500);
      }
    });

    // NOTE: /internal/upsert-user-public, /internal/batch-delete-user-public,
    // /internal/meta-get, /internal/meta-set removed — all handled by AUTH_DB D1 directly.
    // getMeta()/setMeta() still exist for per-DO schema hash tracking.

    // INTERNAL: POST /internal/execute-function — execute a registered function on this DO
    app.post('/internal/execute-function', async (c) => {
      const { functionName, scheduledTime, cron } = await c.req.json<{
        functionName: string;
        scheduledTime?: string;
        cron?: string;
      }>();

      const registry = getRegisteredFunctions();
      const definition = registry.get(functionName);
      if (!definition) {
        throw new EdgeBaseError(404, `Function '${functionName}' not found.`);
      }

      // Build context using buildFunctionContext (§5: buildDbContext removed)
      const doOriginFn = this.doName ? parseDbDoName(this.doName) : { namespace: 'shared' };
      const ctx = buildFunctionContext({
        request: new Request('http://internal/execute-function/' + functionName),
        auth: null,
        databaseNamespace: this.env.DATABASE,
        authNamespace: this.env.AUTH,
        kvNamespace: this.env.KV,
        env: this.env as never,
        executionCtx: this.ctx as never,
        config: this.config,
        serviceKey: this.getServiceKey(),
        triggerInfo: { namespace: doOriginFn.namespace, id: doOriginFn.id },
      });
      (ctx as unknown as Record<string, unknown>).data = { scheduledTime, cron };

      // Apply schedule function timeout (default: 10s)
      const timeoutStr = this.config.functions?.scheduleFunctionTimeout ?? '10s';
      const timeoutMs = parseDuration(timeoutStr) * 1000;
      await Promise.race([
        definition.handler(ctx),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error(`Schedule function '${functionName}' timed out (${timeoutStr})`)),
            timeoutMs,
          ),
        ),
      ]);
      return c.json({ ok: true, function: functionName });
    });

    // NOTE: /internal/init-schedule removed — scheduling now uses Cloudflare Cron Triggers
    // (see index.ts `scheduled` event handler). No alarm-based scheduling on db:_system.

    // ─── Backup/Restore ───

    // GET /internal/backup/dump — export all tables as JSON
    app.get('/internal/backup/dump', (c) => {
      const tables: Record<string, unknown[]> = {};
      const schema: Record<string, string> = {};

      // Get all user tables (exclude internal SQLite tables and FTS5 shadow tables)
      const tableRows = [
        ...this.sql(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
        ),
      ];

      // Detect FTS5 virtual tables to exclude their shadow tables
      const ftsVirtualTables = [
        ...this.sql(`SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE '%fts5%'`),
      ].map((r) => r.name as string);

      // FTS5 shadow table suffixes
      const ftsSuffixes = ['_config', '_content', '_data', '_docsize', '_idx'];
      const isFtsShadow = (name: string) =>
        ftsVirtualTables.some((fts) => ftsSuffixes.some((s) => name === `${fts}${s}`));

      for (const row of tableRows) {
        const tableName = row.name as string;

        // Skip FTS5 shadow tables (managed internally by FTS5 virtual table)
        if (isFtsShadow(tableName)) continue;

        // Collect DDL schema (informational — not used in restore)
        const ddlRows = [
          ...this.sql(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, tableName),
        ];
        if (ddlRows.length > 0 && ddlRows[0].sql) {
          schema[tableName] = ddlRows[0].sql as string;
        }

        const rows = [...this.sql(`SELECT * FROM "${tableName}"`)];

        // Base64-encode any Uint8Array/ArrayBuffer values (BLOB safety)
        const encoded = rows.map((r) => {
          const record: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r)) {
            if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
              const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : v;
              record[k] = { __blob__: true, data: btoa(String.fromCharCode(...bytes)) };
            } else {
              record[k] = v;
            }
          }
          return record;
        });
        tables[tableName] = encoded;
      }

      return c.json({
        doName: this.doName,
        doType: 'database',
        schema,
        tables,
        timestamp: new Date().toISOString(),
      });
    });

    // GET /internal/backup/list-ids — list all record IDs (or distinct column values) in a table
    // Optional ?column=fieldName to get DISTINCT values of a specific column instead of id
    app.get('/internal/backup/list-ids', (c) => {
      const table = c.req.query('table');
      if (!table) return c.json({ ids: [] });

      // Validate table name to prevent SQL injection (alphanumeric + underscore only)
      if (!/^[a-zA-Z_]\w*$/.test(table)) return c.json({ ids: [] });

      const column = c.req.query('column') || 'id';
      // Validate column name to prevent SQL injection (alphanumeric + underscore only)
      if (!/^[a-zA-Z_]\w*$/.test(column)) return c.json({ ids: [] });

      try {
        const rows = [...this.sql(`SELECT DISTINCT "${column}" AS val FROM "${table}"`)];
        return c.json({ ids: rows.map((r) => r.val as string) });
      } catch {
        return c.json({ ids: [] });
      }
    });

    // POST /internal/backup/wipe — drop all user tables (for orphan DO cleanup)
    app.post('/internal/backup/wipe', (c) => {
      this.ctx.storage.transactionSync(() => {
        const tables = [
          ...this.sql(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
          ),
        ];
        const views = [
          ...this.sql(`SELECT name FROM sqlite_master WHERE type='view' ORDER BY name`),
        ];
        const triggers = [
          ...this.sql(`SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`),
        ];
        for (const row of triggers) this.sql(`DROP TRIGGER IF EXISTS "${row.name}"`);
        for (const row of views) this.sql(`DROP VIEW IF EXISTS "${row.name}"`);
        for (const row of tables) this.sql(`DROP TABLE IF EXISTS "${row.name}"`);
      });
      return c.json({ ok: true });
    });

    // POST /internal/drop-all — delete all DO SQLite storage
    // Used to clean up orphaned Isolated DOs when a user account is deleted.
    // Note: ctx.storage.deleteAll() clears all DO storage but the DO instance
    // itself remains on Cloudflare infrastructure (idle DOs are free).
    app.post('/internal/drop-all', async (c) => {
      await this.ctx.storage.deleteAll();
      return c.json({ ok: true });
    });

    // POST /internal/backup/restore — Wipe & Restore all tables from backup
    app.post('/internal/backup/restore', async (c) => {
      const body = await c.req.json<{
        tables: Record<string, Array<Record<string, unknown>>>;
      }>();

      this.ctx.storage.transactionSync(() => {
        // 1. Drop all existing user tables (reverse order for FK safety)
        const existingTables = [
          ...this.sql(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`,
          ),
        ];
        // Drop legacy views (backward compat cleanup)
        const existingViews = [
          ...this.sql(`SELECT name FROM sqlite_master WHERE type='view' ORDER BY name`),
        ];
        for (const row of existingViews) {
          this.sql(`DROP VIEW IF EXISTS "${row.name}"`);
        }
        // Drop triggers
        const existingTriggers = [
          ...this.sql(`SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`),
        ];
        for (const row of existingTriggers) {
          this.sql(`DROP TRIGGER IF EXISTS "${row.name}"`);
        }
        for (const row of existingTables) {
          this.sql(`DROP TABLE IF EXISTS "${row.name}"`);
        }

        // 2. Re-run schema init to create tables with current config schema
        this.initialized = false;
        this.initializeSchema();
        this.initialized = true;

        // 3. Insert backup data into tables
        for (const [tableName, rows] of Object.entries(body.tables)) {
          if (rows.length === 0) continue;

          // Check if table exists after schema init
          const tableExists = [
            ...this.sql(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tableName),
          ];
          if (tableExists.length === 0) {
            // Table from backup doesn't exist in current schema — skip
            // Also covers FTS5 shadow tables that shouldn't be restored manually
            continue;
          }

          for (const row of rows) {
            // Decode base64 BLOB values
            const decoded: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(row)) {
              if (v && typeof v === 'object' && '__blob__' in (v as Record<string, unknown>)) {
                const b64 = (v as { data: string }).data;
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                decoded[k] = bytes;
              } else {
                decoded[k] = v;
              }
            }

            const columns = Object.keys(decoded);
            const values = columns.map((col) => decoded[col]);
            const placeholders = columns.map(() => '?').join(', ');
            const colStr = columns.map((col) => `"${col}"`).join(', ');
            this.sql(
              `INSERT OR REPLACE INTO "${tableName}" (${colStr}) VALUES (${placeholders})`,
              ...values,
            );
          }
        }

        // 4. Persist doName after restore
        if (this.doName) {
          this.setMeta('doName', this.doName);
        }
      });

      return c.json({ ok: true, restored: Object.keys(body.tables).length });
    });

    // Error handler
    app.onError((err, c) => {
      if (err instanceof EdgeBaseError) {
        return c.json(err.toJSON(), err.code as 400);
      }
      // Fallback: check for code property (duck-typing)
      if ('code' in err && typeof (err as Record<string, unknown>).code === 'number') {
        const e = err as { code: number; message: string; data?: unknown };
        return c.json({ code: e.code, message: e.message, data: e.data }, e.code as 200);
      }
      // Normalize well-known database errors (e.g. UNIQUE constraint violations → 409)
      const normalizedDbError = normalizeDatabaseError(err);
      if (normalizedDbError) {
        return c.json(normalizedDbError.toJSON(), normalizedDbError.code as 400);
      }
      console.error('DatabaseDO Error:', err);
      return c.json({ code: 500, message: 'Internal server error.' }, 500);
    });

    return app;
  }

  // ─── Alarm Handler ───
  // NOTE: Schedule alarm processing removed — now handled by Cloudflare Cron Triggers
  // (see index.ts `scheduled` event handler). The alarm() method is kept as a no-op
  // for any existing alarms that may fire during migration.

  async alarm(): Promise<void> {
    // No-op — alarm-based scheduling removed in favor of Cron Triggers.
  }

  // ─── Helper Methods ───

  /** Execute SQL query on DO's SQLite storage. */
  private sql(query: string, ...params: unknown[]): Iterable<Record<string, unknown>> {
    return this.ctx.storage.sql.exec(query, ...params);
  }

  /** Execute multi-statement SQL (separated by semicolons, trigger-aware). */
  private execMulti(ddl: string): void {
    // If this DDL contains a BEGIN...END block (trigger), execute as single statement
    const upper = ddl.toUpperCase();
    if (upper.includes('BEGIN') && upper.includes('END')) {
      const clean = ddl.replace(/;\s*$/, '').trim();
      if (clean.length > 0) this.sql(clean);
      return;
    }

    // Otherwise, split on semicolons
    const statements = ddl
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      this.sql(stmt);
    }
  }

  /** Get a meta value from _meta table. */
  private getMeta(key: string): string | null {
    const rows = [...this.sql('SELECT "value" FROM "_meta" WHERE "key" = ?', key)];
    return rows.length > 0 ? (rows[0].value as string) : null;
  }

  /** Set a meta value in _meta table. */
  private setMeta(key: string, value: string): void {
    this.sql('INSERT OR REPLACE INTO "_meta" ("key", "value") VALUES (?, ?)', key, value);
  }

  /** Parse config from env — delegates to global singleton (§13). */
  private parseConfig(env: DOEnv): EdgeBaseConfig {
    return getGlobalConfig(env);
  }

  // ─── Database Live Event Emission ───

  /**
   * Emit a CUD event to DatabaseLiveDO for real-time subscriptions.
   * Fire-and-forget: errors are silently ignored to avoid blocking CUD ops.
   * Sends to both table channel and document channel (dual propagation).
   */
  private emitDbLiveEvent(
    table: string,
    type: 'added' | 'modified' | 'removed',
    docId: string,
    data: Record<string, unknown> | null,
  ): Promise<void> {
    const eventBase = {
      type,
      table,
      docId,
      data,
      timestamp: new Date().toISOString(),
    };

    const { namespace, id } = this.doName
      ? parseDbDoName(this.doName)
      : { namespace: 'shared' as string, id: undefined as string | undefined };

    const tableChannel = buildDbLiveChannel(namespace, table, id);
    const deliveries = [this.sendToDatabaseLiveDO({ ...eventBase, channel: tableChannel })];

    // Document channel: dblive:{namespace}:{table}:{docId} (skip for bulk events)
    if (docId !== '_bulk') {
      const docChannel = buildDbLiveChannel(namespace, table, id, docId);
      deliveries.push(this.sendToDatabaseLiveDO({ ...eventBase, channel: docChannel }));
    }

    return Promise.all(deliveries).then(() => undefined);
  }

  /**
   * Emit a batch of CUD events as a single batch_changes message.
   * Sends to DatabaseLiveDO which forwards to subscribers based on SDK version negotiation.
   */
  private emitDbLiveBatchEvent(
    table: string,
    changes: Array<{
      type: 'added' | 'modified' | 'removed';
      docId: string;
      data: Record<string, unknown> | null;
    }>,
  ): Promise<void> {
    const { namespace, id } = this.doName
      ? parseDbDoName(this.doName)
      : { namespace: 'shared' as string, id: undefined as string | undefined };
    const tableChannel = buildDbLiveChannel(namespace, table, id);
    const event = {
      type: 'batch_changes' as const,
      channel: tableChannel,
      table,
      changes: changes.map((c) => ({
        type: c.type,
        docId: c.docId,
        data: c.data,
        timestamp: new Date().toISOString(),
      })),
      total: changes.length,
    };
    return this.sendToDatabaseLiveDO(event, '/internal/batch-event');
  }

  private sendToDatabaseLiveDO(
    event: Record<string, unknown>,
    path = '/internal/event',
  ): Promise<void> {
    try {
      const doId = this.env.DATABASE_LIVE.idFromName(DATABASE_LIVE_HUB_DO_NAME);
      const stub = this.env.DATABASE_LIVE.get(doId);
      return stub
        .fetch(`http://internal${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
        .then(() => undefined)
        .catch(() => undefined);
    } catch {
      // Ignore — database live should not block database operations
      return Promise.resolve();
    }
  }

  /**
   * Send broadcast event to DatabaseLiveDO.
   * Sends broadcast events to DatabaseLiveDO hub for channel broadcasting.
   */
  private sendBroadcastToDatabaseLiveDO(
    _channel: string,
    event: Record<string, unknown>,
    path = '/internal/broadcast',
  ): Promise<void> {
    try {
      const doId = this.env.DATABASE_LIVE.idFromName('database-live:hub');
      const stub = this.env.DATABASE_LIVE.get(doId);
      return stub
        .fetch(`http://internal${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
        .then(() => undefined)
        .catch(() => undefined);
    } catch {
      // Ignore — broadcast should not block database operations
      return Promise.resolve();
    }
  }

  /**
   * Get tables managed by this DO instance (§1,).
   * Returns all tables from the DB namespace that matches this DO's name.
   * DO name format: 'shared' (static) or 'namespace:id' (dynamic).
   */
  private getMyTables(): Record<string, TableConfig> {
    if (!this.config.databases) return {};

    const { namespace } = parseDbDoName(this.doName);

    const dbBlock = this.config.databases[namespace];
    if (!dbBlock?.tables) return {};

    return dbBlock.tables as Record<string, TableConfig>;
  }

  /** Get a specific table config (§1,). */
  private getTableConfig(name: string): TableConfig | null {
    if (!this.config.databases) return null;
    for (const dbBlock of Object.values(this.config.databases)) {
      const tableConfig = dbBlock.tables?.[name];
      if (tableConfig) return tableConfig as TableConfig;
    }
    return null;
  }

  /** Ensure a table exists in this DO, lazily creating it from config if needed. */
  private ensureTableExists(name: string): void {
    const tables = [
      ...this.sql(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, name),
    ];
    if (tables.length === 0) {
      // Table doesn't exist yet — try to create it lazily from config
      const config = this.getTableConfig(name);
      if (config) {
        this.initTable(name, config);
      } else {
        throw notFoundError(`Table "${name}" not found in this DO.`);
      }
    }
  }

  /**
   * Normalize a SQLite row to correct JS types. (BUG-004)
   * SQLite stores booleans as 0/1 integers or string ("false"/"true") depending on
   * how the value was originally inserted. Schema-driven: only converts known boolean/number fields.
   * Falls back to raw value for unknown fields (schemaless tables).
   */
  private normalizeRow(
    row: Record<string, unknown>,
    tableConfig: TableConfig | null,
  ): Record<string, unknown> {
    if (!tableConfig?.schema) return row;
    const effective = buildEffectiveSchema(tableConfig.schema);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const fieldDef = effective[key];
      if (!fieldDef) {
        result[key] = value;
        continue;
      }
      if (fieldDef.type === 'boolean') {
        // SQLite stores 0/1 or string. Normalize to JS boolean.
        if (value === 1 || value === '1' || value === 'true' || value === true) {
          result[key] = true;
        } else if (value === 0 || value === '0' || value === 'false' || value === false) {
          result[key] = false;
        } else {
          result[key] = value === null ? null : Boolean(value);
        }
      } else if (fieldDef.type === 'number') {
        // SQLite may return numbers as strings in some edge cases
        result[key] = value === null ? null : Number(value);
      } else if (fieldDef.type === 'json') {
        // Parse JSON strings back to objects (BUG-006)
        if (value === null || value === undefined) {
          result[key] = value;
        } else if (typeof value === 'string') {
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value; // Not valid JSON — return raw string
          }
        } else {
          result[key] = value;
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Evaluate a single table-level rule against an auth context and row. (BUG-005)
   *
   * rule is typed as the union of all TableRules fn signatures:
   *   (auth, row) => boolean  (for read/update/delete)
   * or boolean (shorthand allow/deny).
   * Uses a 50ms hard timeout — fail-closed on timeout or error (§12①).
   */
  private async evalRowRule(
    rule:
      | ((auth: AuthContext | null, row: Record<string, unknown>) => boolean | Promise<boolean>)
      | boolean
      | undefined,
    auth: AuthContext | null,
    row: Record<string, unknown>,
  ): Promise<boolean> {
    if (rule === undefined || rule === null) return true; // no rule = allow
    if (typeof rule === 'boolean') return rule;
    try {
      const result = await Promise.race([
        Promise.resolve(rule(auth, row)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Rule evaluation timeout')), 50),
        ),
      ]);
      return Boolean(result);
    } catch {
      return false; // timeout or error → deny (fail-closed)
    }
  }

  /** Normalize an array of rows. */
  private normalizeRows(
    rows: Record<string, unknown>[],
    tableConfig: TableConfig | null,
  ): Record<string, unknown>[] {
    if (!tableConfig?.schema) return rows;
    return rows.map((row) => this.normalizeRow(row, tableConfig));
  }
}
