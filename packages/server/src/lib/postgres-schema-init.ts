/**
 * PostgreSQL lazy schema initializer.
 *
 * Mirrors database-do.ts initializeSchema() but for PostgreSQL:
 * 1. Creates _meta table if not exists
 * 2. For each table: compute schema hash, compare with stored hash
 * 3. If new: CREATE TABLE + indexes + FTS
 * 4. If changed: ADD COLUMN for new fields (non-destructive)
 * 5. Stores schema hash in _meta
 *
 * Called once per Worker lifetime per namespace/config signature.
 */
import type { TableConfig, MigrationConfig, SchemaField } from '@edge-base/shared';
import {
  type PostgresExecutor,
  withPostgresConnection,
} from './postgres-executor.js';
import {
  PG_META_TABLE_DDL,
  generatePgTableDDL,
  generatePgAddColumnDDL,
  generatePgFTSDDL,
  generatePgIndexDDL,
  buildEffectiveSchema,
  computeSchemaHashSync,
} from './schema.js';

// Track schema initialization promises so CRUD requests do not re-run the full
// schema/meta scan on every query in the same Worker process.
const _schemaInitCache = new Map<string, Promise<void>>();

function extractReferenceTable(reference: SchemaField['references']): string | null {
  if (!reference) return null;
  if (typeof reference === 'string') {
    const match = reference.trim().match(/^(\w+)(?:\((\w+)\))?$/);
    return match?.[1] ?? null;
  }
  return reference.table;
}

function isLogicalOnlyReference(reference: SchemaField['references']): boolean {
  const table = extractReferenceTable(reference);
  return table !== null && ['users', '_users', '_users_public'].includes(table);
}

export function resolvePgInitOrder(
  tables: Record<string, TableConfig>,
): Array<[string, TableConfig]> {
  const entries = Object.entries(tables);
  const tableNames = new Set(entries.map(([tableName]) => tableName));
  const dependencies = new Map<string, Set<string>>();

  for (const [tableName, config] of entries) {
    const deps = new Set<string>();
    const schema = buildEffectiveSchema(config.schema);

    for (const field of Object.values(schema)) {
      const refTable = extractReferenceTable(field.references);
      if (!refTable || refTable === tableName) continue;
      if (isLogicalOnlyReference(field.references)) continue;
      if (!tableNames.has(refTable)) continue;
      deps.add(refTable);
    }

    dependencies.set(tableName, deps);
  }

  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(tableName: string): void {
    if (visited.has(tableName)) return;
    if (visiting.has(tableName)) {
      // Cycles are preserved in original relative order; PostgreSQL will still
      // reject impossible FK cycles, but we avoid infinite recursion here.
      return;
    }

    visiting.add(tableName);
    for (const dependency of dependencies.get(tableName) ?? []) {
      visit(dependency);
    }
    visiting.delete(tableName);
    visited.add(tableName);
    ordered.push(tableName);
  }

  for (const [tableName] of entries) {
    visit(tableName);
  }

  return ordered.map((tableName) => [tableName, tables[tableName]!]);
}

/**
 * Ensure PostgreSQL schema is up-to-date for a given namespace.
 * Called once per Worker lifetime per namespace (cached in memory).
 */
export async function ensurePgSchema(
  connectionString: string,
  namespace: string,
  tables: Record<string, TableConfig>,
  queryExecutor?: PostgresExecutor,
): Promise<void> {
  const cacheKey = buildPgSchemaCacheKey(connectionString, namespace, tables);
  const cached = _schemaInitCache.get(cacheKey);
  if (cached) {
    await cached;
    return;
  }

  const promise = (async () => {
    if (queryExecutor) {
      await ensurePgSchemaInternal(connectionString, tables, queryExecutor);
      return;
    }

    await withPostgresConnection(connectionString, async (query) => {
      await ensurePgSchemaInternal(connectionString, tables, query);
    });
  })();

  _schemaInitCache.set(cacheKey, promise);
  try {
    await promise;
  } catch (error) {
    _schemaInitCache.delete(cacheKey);
    throw error;
  }
}

async function ensurePgSchemaInternal(
  connectionString: string,
  tables: Record<string, TableConfig>,
  query: PostgresExecutor,
): Promise<void> {
  await query(PG_META_TABLE_DDL, []);

  for (const [tableName, config] of resolvePgInitOrder(tables)) {
    await initPgTable(connectionString, tableName, config, query);
  }
}

function buildPgSchemaCacheKey(
  connectionString: string,
  namespace: string,
  tables: Record<string, TableConfig>,
): string {
  const signature = Object.entries(tables)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tableName, config]) => {
      const migrations = (config.migrations ?? [])
        .map((migration) => `${migration.version}:${migration.upPg ?? migration.up}`)
        .join('|');
      const indexes = JSON.stringify(config.indexes ?? []);
      const fts = JSON.stringify(config.fts ?? []);
      return `${tableName}:${computeSchemaHashSync(config)}:${indexes}:${fts}:${migrations}`;
    })
    .join('||');

  return `${namespace}:${connectionString}:${signature}`;
}

/**
 * Initialize or update a single PostgreSQL table.
 */
async function initPgTable(
  connectionString: string,
  tableName: string,
  config: TableConfig,
  query: PostgresExecutor,
): Promise<void> {
  const currentHash = computeSchemaHashSync(config);

  // Check stored hash
  const storedHash = await getMeta(connectionString, `schemaHash:${tableName}`, query);

  if (storedHash === currentHash) {
    // No schema change — still check migrations (user may add new migrations
    // without changing the schema, same as database-do.ts)
    await ensurePgFTSAndIndexes(connectionString, tableName, config, query);
    await runPgMigrations(connectionString, tableName, config, query);
    return;
  }

  if (!storedHash) {
    // First time — create table + indexes + FTS
    const ddls = generatePgTableDDL(tableName, config);
    for (const ddl of ddls) {
      await query(ddl, []);
    }

    // Set initial migration version if migrations exist (skip running them —
    // fresh table already has the latest schema)
    if (config.migrations?.length) {
      const maxVersion = Math.max(...config.migrations.map((m: MigrationConfig) => m.version));
      await setMeta(connectionString, `migration_version:${tableName}`, String(maxVersion), query);
    }
  } else {
    // Schema changed — detect new columns and add them (non-destructive)
    await handlePgSchemaUpdate(connectionString, tableName, config, query);
    // Re-apply FTS and indexes to pick up new field additions
    await ensurePgFTSAndIndexes(connectionString, tableName, config, query);
    // Run pending migrations after schema update
    await runPgMigrations(connectionString, tableName, config, query);
  }

  // Store new hash
  await setMeta(connectionString, `schemaHash:${tableName}`, currentHash, query);
}

/**
 * Non-destructive schema update: detect new columns and ADD COLUMN.
 * Does NOT drop columns (data safety) — mirrors database-do.ts handleSchemaUpdate().
 */
async function handlePgSchemaUpdate(
  connectionString: string,
  tableName: string,
  config: TableConfig,
  query: PostgresExecutor,
): Promise<void> {
  // Get existing columns from information_schema
  const colResult = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tableName],
  );
  const existingCols = new Set(
    colResult.rows.map(r => (r as Record<string, unknown>).column_name as string),
  );

  // Build effective schema with auto-fields
  const effectiveSchema = buildEffectiveSchema(config.schema);

  // Add missing columns
  for (const [colName, field] of Object.entries(effectiveSchema)) {
    if (!existingCols.has(colName)) {
      const ddl = generatePgAddColumnDDL(tableName, colName, field);
      await query(ddl, []);
    }
  }
}

/**
 * Ensure FTS and indexes are up-to-date after schema changes.
 */
async function ensurePgFTSAndIndexes(
  connectionString: string,
  tableName: string,
  config: TableConfig,
  query: PostgresExecutor,
): Promise<void> {
  // Re-apply indexes (CREATE IF NOT EXISTS is idempotent)
  if (config.indexes?.length) {
    const indexDDLs = generatePgIndexDDL(tableName, config.indexes);
    for (const ddl of indexDDLs) {
      await query(ddl, []);
    }
  }

  // Re-apply FTS (uses CREATE OR REPLACE and DROP TRIGGER IF EXISTS)
  if (config.fts?.length) {
    const ftsDDLs = generatePgFTSDDL(tableName, config.fts);
    for (const ddl of ftsDDLs) {
      await query(ddl, []);
    }
  }
}

// ─── Migration Engine ───

/**
 * Run pending migrations for a PostgreSQL table.
 * Mirrors database-do.ts runMigrations() with upPg → up fallback.
 *
 * Migration version tracked in `_meta` as `migration_version:{tableName}`.
 * Migrations are sorted by version (ascending) and executed sequentially.
 * If `upPg` is provided, it is used instead of `up` for PostgreSQL.
 */
async function runPgMigrations(
  connectionString: string,
  tableName: string,
  config: TableConfig,
  query: PostgresExecutor,
): Promise<void> {
  if (!config.migrations?.length) return;

  const versionKey = `migration_version:${tableName}`;
  const currentVersionStr = await getMeta(connectionString, versionKey, query);
  const currentVersion = parseInt(currentVersionStr || '1', 10);

  const pending = config.migrations
    .filter((m: MigrationConfig) => m.version > currentVersion)
    .sort((a: MigrationConfig, b: MigrationConfig) => a.version - b.version);

  for (const migration of pending) {
    try {
      // Use upPg if available, otherwise fall back to up
      const sql = migration.upPg ?? migration.up;
      await query(sql, []);
      await setMeta(connectionString, versionKey, String(migration.version), query);
    } catch (err) {
      // Migration failed — stop here, throw so the request gets a 503
      console.error(`PG Migration v${migration.version} failed for ${tableName}:`, err);
      throw new Error(`PG Migration v${migration.version} failed: ${(err as Error).message}`);
    }
  }
}

// ─── _meta Helpers ───

async function getMeta(
  connectionString: string,
  key: string,
  query: PostgresExecutor,
): Promise<string | null> {
  const result = await query(
    `SELECT "value" FROM "_meta" WHERE "key" = $1`,
    [key],
  );
  return result.rows.length > 0
    ? (result.rows[0] as Record<string, unknown>).value as string
    : null;
}

async function setMeta(
  connectionString: string,
  key: string,
  value: string,
  query: PostgresExecutor,
): Promise<void> {
  await query(
    `INSERT INTO "_meta" ("key", "value") VALUES ($1, $2) ON CONFLICT ("key") DO UPDATE SET "value" = $2`,
    [key, value],
  );
}

/** Reset initialized state (for testing). */
export function _resetPgSchemaCache(): void {
  _schemaInitCache.clear();
}
