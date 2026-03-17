/**
 * D1 lazy schema initializer.
 *
 * Mirrors postgres-schema-init.ts but for Cloudflare D1 (SQLite):
 * 1. Creates _meta table if not exists
 * 2. For each table: compute schema hash, compare with stored hash
 * 3. If new: CREATE TABLE + indexes + FTS5
 * 4. If changed: ADD COLUMN for new fields (non-destructive)
 * 5. Stores schema hash in _meta
 *
 * Called once per Worker lifetime per namespace (cached in memory set).
 */
import type { TableConfig, MigrationConfig } from '@edgebase/shared';
import {
  META_TABLE_DDL,
  generateTableDDL,
  generateAddColumnDDL,
  generateFTS5DDL,
  generateFTS5Triggers,
  generateIndexDDL,
  buildEffectiveSchema,
  computeSchemaHashSync,
} from './schema.js';
import type { SchemaField } from '@edgebase/shared';

// Track initialized namespaces to avoid redundant checks per Worker process.
const _initialized = new Set<string>();

/**
 * Ensure D1 schema is up-to-date for a given namespace.
 * Called once per Worker lifetime per namespace (cached in memory).
 */
export async function ensureD1Schema(
  db: D1Database,
  namespace: string,
  tables: Record<string, TableConfig>,
): Promise<void> {
  if (_initialized.has(namespace)) {
    return;
  }

  await db.prepare(META_TABLE_DDL).run();
  await db.prepare('PRAGMA foreign_keys = ON;').run();
  for (const [tableName, config] of Object.entries(tables)) {
    await initD1Table(db, tableName, config);
  }
  _initialized.add(namespace);
}

/**
 * Initialize or update a single D1 table.
 */
async function initD1Table(
  db: D1Database,
  tableName: string,
  config: TableConfig,
): Promise<void> {
  const currentHash = computeSchemaHashSync(config);

  // Check stored hash
  const storedHash = await getD1Meta(db, `schemaHash:${tableName}`);

  if (storedHash === currentHash) {
    // No schema change — still check migrations
    await ensureD1FTSAndIndexes(db, tableName, config);
    await runD1Migrations(db, tableName, config);
    return;
  }

  if (!storedHash) {
    // First time — create table + indexes + FTS5
    const ddls = generateTableDDL(tableName, config);
    const stmts = ddls.map(ddl => db.prepare(ddl));
    if (stmts.length > 0) {
      await db.batch(stmts);
    }

    // Set initial migration version if migrations exist (skip running them —
    // fresh table already has the latest schema)
    if (config.migrations?.length) {
      const maxVersion = Math.max(...config.migrations.map((m: MigrationConfig) => m.version));
      await setD1Meta(db, `migration_version:${tableName}`, String(maxVersion));
    }
  } else {
    // Schema changed — detect new columns and add them (non-destructive)
    await handleD1SchemaUpdate(db, tableName, config);
    // Re-apply FTS and indexes to pick up new field additions
    await ensureD1FTSAndIndexes(db, tableName, config);
    // Run pending migrations after schema update
    await runD1Migrations(db, tableName, config);
  }

  // Store new hash
  await setD1Meta(db, `schemaHash:${tableName}`, currentHash);
}

/**
 * Non-destructive schema update: detect new columns and ADD COLUMN.
 * Does NOT drop columns (data safety) — mirrors database-do.ts handleSchemaUpdate().
 */
async function handleD1SchemaUpdate(
  db: D1Database,
  tableName: string,
  config: TableConfig,
): Promise<void> {
  // Get existing columns from PRAGMA table_info
  const colResult = await db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all();
  const existingCols = new Set(
    (colResult.results ?? []).map((r: Record<string, unknown>) => r.name as string),
  );

  // Build effective schema with auto-fields
  const effectiveSchema = buildEffectiveSchema(config.schema);

  // Add missing columns
  const stmts: D1PreparedStatement[] = [];
  const indexDDLs: string[] = [];
  for (const [colName, field] of Object.entries(effectiveSchema)) {
    if (!existingCols.has(colName)) {
      const columnField = normalizeD1AddColumnField(field);
      const ddl = generateAddColumnDDL(tableName, colName, columnField);
      stmts.push(db.prepare(ddl));
      if (field.unique) {
        indexDDLs.push(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${`idx_${tableName}_${colName}`.replace(/"/g, '""')}" ON "${tableName.replace(/"/g, '""')}"("${colName.replace(/"/g, '""')}");`,
        );
      }
    }
  }
  if (stmts.length > 0) {
    await db.batch(stmts);
  }
  if (indexDDLs.length > 0) {
    await db.batch(indexDDLs.map((ddl) => db.prepare(ddl)));
  }
}

function normalizeD1AddColumnField(field: SchemaField): SchemaField {
  return {
    ...field,
    // SQLite/D1 cannot add UNIQUE columns inline via ALTER TABLE.
    unique: false,
    // Existing rows make NOT NULL additions fail unless a default is supplied.
    required: field.required && field.default !== undefined,
    // Primary keys are also unsupported on ALTER TABLE ADD COLUMN.
    primaryKey: false,
  };
}

/**
 * Ensure FTS5 and indexes are up-to-date after schema changes.
 */
async function ensureD1FTSAndIndexes(
  db: D1Database,
  tableName: string,
  config: TableConfig,
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  let needsFtsRebuild = false;

  // Re-apply indexes (CREATE IF NOT EXISTS is idempotent)
  if (config.indexes?.length) {
    const indexDDLs = generateIndexDDL(tableName, config.indexes);
    for (const ddl of indexDDLs) {
      stmts.push(db.prepare(ddl));
    }
  }

  // Re-apply FTS5
  if (config.fts?.length) {
    const ftsArtifacts = [`${tableName}_fts`, `${tableName}_ai`, `${tableName}_ad`, `${tableName}_au`];
    const placeholders = ftsArtifacts.map(() => '?').join(', ');
    const artifactRows = await db
      .prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`)
      .bind(...ftsArtifacts)
      .all();
    const existingArtifacts = new Set(
      (artifactRows.results ?? []).map((row: Record<string, unknown>) => row.name as string),
    );
    needsFtsRebuild = ftsArtifacts.some((name) => !existingArtifacts.has(name));

    stmts.push(db.prepare(generateFTS5DDL(tableName, config.fts)));
    const triggerDDLs = generateFTS5Triggers(tableName, config.fts);
    for (const ddl of triggerDDLs) {
      stmts.push(db.prepare(ddl));
    }
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  if (config.fts?.length && needsFtsRebuild) {
    const ftsTableName = `${tableName}_fts`.replace(/"/g, '""');
    await db.prepare(`INSERT INTO "${ftsTableName}"("${ftsTableName}") VALUES ('rebuild')`).run();
  }
}

// ─── Migration Engine ───

/**
 * Run pending migrations for a D1 table.
 * Mirrors database-do.ts runMigrations() — uses SQLite `up` field.
 */
async function runD1Migrations(
  db: D1Database,
  tableName: string,
  config: TableConfig,
): Promise<void> {
  if (!config.migrations?.length) return;

  const versionKey = `migration_version:${tableName}`;
  const currentVersionStr = await getD1Meta(db, versionKey);
  const currentVersion = parseInt(currentVersionStr || '1', 10);

  const pending = config.migrations
    .filter((m: MigrationConfig) => m.version > currentVersion)
    .sort((a: MigrationConfig, b: MigrationConfig) => a.version - b.version);

  for (const migration of pending) {
    try {
      // D1 uses SQLite — use `up` field (not upPg)
      await db.prepare(migration.up).run();
      await setD1Meta(db, versionKey, String(migration.version));
    } catch (err) {
      console.error(`D1 Migration v${migration.version} failed for ${tableName}:`, err);
      throw new Error(`D1 Migration v${migration.version} failed: ${(err as Error).message}`);
    }
  }
}

// ─── _meta Helpers ───

async function getD1Meta(
  db: D1Database,
  key: string,
): Promise<string | null> {
  const row = await db.prepare('SELECT "value" FROM "_meta" WHERE "key" = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setD1Meta(
  db: D1Database,
  key: string,
  value: string,
): Promise<void> {
  await db.prepare(
    'INSERT INTO "_meta" ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET "value" = ?',
  ).bind(key, value, value).run();
}

/** Reset initialized state (for testing). */
export function _resetD1SchemaCache(): void {
  _initialized.clear();
}
