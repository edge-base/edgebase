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
import type { TableConfig, MigrationConfig } from '@edge-base/shared';
import {
  META_TABLE_DDL,
  generateTableDDL,
  generateSQLiteAddColumnDDLs,
  generateFTS5DDL,
  generateFTS5Triggers,
  generateIndexDDL,
  buildEffectiveSchema,
  computeSchemaHashSync,
  planSQLiteFieldUniqueIndex,
  sqliteUniqueDuplicateError,
  type SQLiteIndexState,
} from './schema.js';

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
    const pending = await getPendingD1Migrations(db, tableName, config);
    if (pending.length > 0) {
      await runD1ExistingTableUpgrade(
        db,
        tableName,
        config,
        pending,
        null,
      );
    } else {
      // Older runtimes could save this hash without materializing a UNIQUE
      // change on an existing column, so reconciliation remains state-based.
      await handleD1SchemaUpdate(db, tableName, config);
    }
    await ensureD1FTSAndIndexes(db, tableName, config);
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
    const pending = await getPendingD1Migrations(db, tableName, config);
    if (pending.length > 0) {
      // D1 has no interactive transaction API. Build one bounded batch from a
      // single physical-schema snapshot so additive columns, pending data
      // migrations, final constraints, and both metadata writes commit or
      // roll back together in provider order.
      await runD1ExistingTableUpgrade(
        db,
        tableName,
        config,
        pending,
        currentHash,
      );
      await ensureD1FTSAndIndexes(db, tableName, config);
      return;
    }

    await handleD1SchemaUpdate(db, tableName, config);
    await ensureD1FTSAndIndexes(db, tableName, config);
  }

  // Store new hash
  await setD1Meta(db, `schemaHash:${tableName}`, currentHash);
}

/**
 * Non-destructive schema update: add columns and reconcile field-owned unique
 * indexes. Does NOT drop columns (data safety) — mirrors DatabaseDO.
 */
async function handleD1SchemaUpdate(
  db: D1Database,
  tableName: string,
  config: TableConfig,
): Promise<void> {
  const plan = await planD1SchemaUpdate(db, tableName, config, true);
  const migrationDDLs = [...plan.additiveDDLs, ...plan.constraintDDLs];
  if (migrationDDLs.length > 0) {
    // D1 batches are transactional, so column and index reconciliation either
    // commits together or remains wholly retryable.
    await db.batch(migrationDDLs.map((ddl) => db.prepare(ddl)));
  }
}

interface D1SchemaUpdatePlan {
  additiveDDLs: string[];
  constraintDDLs: string[];
  createdUniqueFields: string[];
}

async function planD1SchemaUpdate(
  db: D1Database,
  tableName: string,
  config: TableConfig,
  preflightUnique: boolean,
): Promise<D1SchemaUpdatePlan> {
  const escapedTableName = tableName.replace(/"/g, '""');

  // Get existing columns from PRAGMA table_info
  const colResult = await db.prepare(`PRAGMA table_info("${escapedTableName}")`).all();
  const existingCols = new Set(
    (colResult.results ?? []).map((r: Record<string, unknown>) => r.name as string),
  );

  const indexResult = await db.prepare(`PRAGMA index_list("${escapedTableName}")`).all();
  const existingIndexes: SQLiteIndexState[] = [];
  for (const row of (indexResult.results ?? []) as Record<string, unknown>[]) {
    const indexName = row.name as string;
    const escapedIndexName = indexName.replace(/"/g, '""');
    const indexInfo = await db.prepare(`PRAGMA index_info("${escapedIndexName}")`).all();
    const columns = ((indexInfo.results ?? []) as Record<string, unknown>[])
      .sort((left, right) => Number(left.seqno) - Number(right.seqno))
      .map((column) => column.name as string);
    existingIndexes.push({
      name: indexName,
      unique: Number(row.unique) === 1,
      origin: String(row.origin ?? ''),
      partial: Number(row.partial) === 1,
      columns,
    });
  }

  // Build effective schema with auto-fields
  const effectiveSchema = buildEffectiveSchema(config.schema);

  const additiveDDLs: string[] = [];
  const constraintDDLs: string[] = [];
  const createdUniqueFields: string[] = [];
  for (const [colName, field] of Object.entries(effectiveSchema)) {
    if (!existingCols.has(colName)) {
      const [addColumnDDL] = generateSQLiteAddColumnDDLs(tableName, colName, field);
      additiveDDLs.push(addColumnDDL);
      if (field.unique) {
        const uniquePlan = planSQLiteFieldUniqueIndex(
          tableName,
          colName,
          true,
          existingIndexes,
        );
        if (uniquePlan.ddl) {
          constraintDDLs.push(uniquePlan.ddl);
          createdUniqueFields.push(colName);
        }
      }
      continue;
    }

    const plan = planSQLiteFieldUniqueIndex(
      tableName,
      colName,
      !!field.unique,
      existingIndexes,
    );
    if (plan.action === 'create' && preflightUnique) {
      const escapedColName = colName.replace(/"/g, '""');
      const duplicate = await db.prepare(
        `SELECT 1 AS "duplicate" FROM "${escapedTableName}" `
        + `WHERE "${escapedColName}" IS NOT NULL `
        + `GROUP BY "${escapedColName}" HAVING COUNT(*) > 1 LIMIT 1`,
      ).first();
      if (duplicate) {
        throw sqliteUniqueDuplicateError(tableName, colName);
      }
    }
    if (plan.ddl) {
      constraintDDLs.push(plan.ddl);
      if (plan.action === 'create') createdUniqueFields.push(colName);
    }
  }

  return { additiveDDLs, constraintDDLs, createdUniqueFields };
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

async function getPendingD1Migrations(
  db: D1Database,
  tableName: string,
  config: TableConfig,
): Promise<MigrationConfig[]> {
  if (!config.migrations?.length) return [];

  const versionKey = `migration_version:${tableName}`;
  const currentVersionStr = await getD1Meta(db, versionKey);
  const currentVersion = parseInt(currentVersionStr || '1', 10);

  return config.migrations
    .filter((m: MigrationConfig) => m.version > currentVersion)
    .sort((a: MigrationConfig, b: MigrationConfig) => a.version - b.version);
}

/**
 * Commit an existing-table D1 upgrade as one ordered provider batch.
 * Migrations intentionally precede all target UNIQUE/config indexes.
 */
async function runD1ExistingTableUpgrade(
  db: D1Database,
  tableName: string,
  config: TableConfig,
  pending: MigrationConfig[],
  nextSchemaHash: string | null,
): Promise<void> {
  const plan = await planD1SchemaUpdate(db, tableName, config, false);
  const statements: D1PreparedStatement[] = [];

  for (const ddl of plan.additiveDDLs) {
    statements.push(db.prepare(ddl));
  }
  for (const migration of pending) {
    statements.push(db.prepare(migration.up));
  }
  for (const ddl of plan.constraintDDLs) {
    statements.push(db.prepare(ddl));
  }
  if (config.indexes?.length) {
    for (const ddl of generateIndexDDL(tableName, config.indexes)) {
      statements.push(db.prepare(ddl));
    }
  }
  for (const migration of pending) {
    statements.push(prepareD1Meta(
      db,
      `migration_version:${tableName}`,
      String(migration.version),
    ));
  }
  if (nextSchemaHash !== null) {
    statements.push(prepareD1Meta(db, `schemaHash:${tableName}`, nextSchemaHash));
  }

  try {
    if (statements.length > 0) {
      await db.batch(statements);
    }
  } catch (err) {
    if (
      plan.createdUniqueFields.length > 0
      && /unique constraint|is not unique/i.test((err as Error).message)
    ) {
      throw sqliteUniqueDuplicateError(tableName, plan.createdUniqueFields[0]!);
    }
    const firstVersion = pending[0]?.version;
    const lastVersion = pending[pending.length - 1]?.version;
    const versionLabel = firstVersion === lastVersion
      ? `v${firstVersion}`
      : `v${firstVersion}-v${lastVersion}`;
    console.error(`D1 Migration ${versionLabel} failed for ${tableName}:`, err);
    throw new Error(`D1 Migration ${versionLabel} failed: ${(err as Error).message}`);
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

function prepareD1Meta(
  db: D1Database,
  key: string,
  value: string,
): D1PreparedStatement {
  return db.prepare(
    'INSERT INTO "_meta" ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET "value" = ?',
  ).bind(key, value, value);
}

/** Reset initialized state (for testing). */
export function _resetD1SchemaCache(): void {
  _initialized.clear();
}
