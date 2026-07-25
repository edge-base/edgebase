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
  computeSQLiteFtsSignature,
  generateFTS5RebuildDDLs,
  generateIndexDDL,
  resolveTableIndexes,
  buildEffectiveSchema,
  computeSchemaHashSync,
  generateSQLiteForeignKeyRebuildDDLs,
  getDeclaredSQLiteForeignKeys,
  normalizeSQLiteForeignKeyRows,
  planSQLiteFieldUniqueIndex,
  sqliteForeignKeysMatch,
  sqliteUniqueDuplicateError,
  type SQLiteIndexState,
  type SQLiteSchemaArtifact,
} from './schema.js';
import {
  buildSqliteFtsArtifactQuery,
  inspectSqliteFtsArtifacts,
} from './query-engine.js';

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
      const rebuiltTable = await runD1ExistingTableUpgrade(
        db,
        tableName,
        config,
        pending,
        null,
      );
      if (rebuiltTable) {
        await recordD1FtsSignatureAfterRebuild(db, tableName, config);
      } else {
        await ensureD1FTSAndIndexes(db, tableName, config);
      }
    } else {
      // Older runtimes could save this hash without materializing a UNIQUE
      // change on an existing column, so reconciliation remains state-based.
      const rebuiltTable = await handleD1SchemaUpdate(db, tableName, config);
      if (rebuiltTable) {
        await recordD1FtsSignatureAfterRebuild(db, tableName, config);
      } else {
        await ensureD1FTSAndIndexes(db, tableName, config);
      }
    }
    return;
  }

  if (!storedHash) {
    if (config.fts?.length) {
      const inspection = await inspectD1FTSArtifacts(db, tableName, config.fts);
      assertD1FtsRebuildSafe(tableName, inspection.rebuildSafe);
    }
    // First time — create table + indexes + FTS5
    const ddls = generateTableDDL(tableName, config);
    const stmts = ddls.map(ddl => db.prepare(ddl));
    if (stmts.length > 0) {
      await db.batch(stmts);
    }

    // Reconcile once more with a missing signature so a pre-existing base
    // table is backfilled instead of trusting idempotent CREATE statements.
    await ensureD1FTSAndIndexes(db, tableName, config);

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
      const rebuiltTable = await runD1ExistingTableUpgrade(
        db,
        tableName,
        config,
        pending,
        currentHash,
      );
      if (rebuiltTable) {
        await recordD1FtsSignatureAfterRebuild(db, tableName, config);
      } else {
        await ensureD1FTSAndIndexes(db, tableName, config);
      }
      return;
    }

    const rebuiltTable = await handleD1SchemaUpdate(db, tableName, config);
    if (rebuiltTable) {
      await recordD1FtsSignatureAfterRebuild(db, tableName, config);
    } else {
      await ensureD1FTSAndIndexes(db, tableName, config);
    }
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
): Promise<boolean> {
  const plan = await planD1SchemaUpdate(db, tableName, config, true);
  const migrationDDLs = [...plan.additiveDDLs, ...plan.constraintDDLs];
  if (migrationDDLs.length > 0) {
    // D1 batches are transactional, so column and index reconciliation either
    // commits together or remains wholly retryable.
    await db.batch(migrationDDLs.map((ddl) => db.prepare(ddl)));
  }
  return plan.rebuiltTable;
}

interface D1SchemaUpdatePlan {
  additiveDDLs: string[];
  constraintDDLs: string[];
  createdUniqueFields: string[];
  rebuiltTable: boolean;
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

  const foreignKeyResult = await db
    .prepare(`PRAGMA foreign_key_list("${escapedTableName}")`)
    .all();
  const actualForeignKeys = normalizeSQLiteForeignKeyRows(
    (foreignKeyResult.results ?? []) as Record<string, unknown>[],
  );
  const desiredForeignKeys = getDeclaredSQLiteForeignKeys(config);
  const rebuiltTable = !sqliteForeignKeysMatch(actualForeignKeys, desiredForeignKeys);

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
          if (!rebuiltTable) constraintDDLs.push(uniquePlan.ddl);
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
    if (plan.ddl && !rebuiltTable) {
      constraintDDLs.push(plan.ddl);
      if (plan.action === 'create') createdUniqueFields.push(colName);
    } else if (plan.action === 'create') {
      createdUniqueFields.push(colName);
    }
  }

  if (rebuiltTable) {
    const inventoryResult = await db
      .prepare(
        'SELECT \'artifact\' AS "kind", "type", "name", "sql", '
        + 'NULL AS "childTable", NULL AS "childColumn" FROM "sqlite_master" '
        + 'WHERE "tbl_name" = ? AND "type" IN (\'index\', \'trigger\') '
        + 'UNION ALL '
        + 'SELECT \'inbound\' AS "kind", NULL AS "type", NULL AS "name", '
        + 'NULL AS "sql", child."name" AS "childTable", '
        + 'fk."from" AS "childColumn" FROM "sqlite_master" AS child '
        + 'JOIN pragma_foreign_key_list(child."name") AS fk '
        + 'WHERE child."type" = \'table\' AND child."name" <> ? AND fk."table" = ? '
        + 'ORDER BY "kind", "name", "childTable", "childColumn"',
      )
      .bind(tableName, tableName, tableName)
      .all();
    const inventoryRows = (inventoryResult.results ?? []) as Record<string, unknown>[];
    const artifacts = inventoryRows
      .filter((row) => row.kind === 'artifact')
      .map((row): SQLiteSchemaArtifact => ({
        type: row.type as SQLiteSchemaArtifact['type'],
        name: String(row.name ?? ''),
        sql: row.sql === null || row.sql === undefined ? null : String(row.sql),
      }));
    constraintDDLs.push(...generateSQLiteForeignKeyRebuildDDLs(
      tableName,
      config,
      {
        columns: [...existingCols],
        indexes: existingIndexes,
        artifacts,
        inboundForeignKeys: inventoryRows
          .filter((row) => row.kind === 'inbound')
          .map((row) => ({
            childTable: String(row.childTable ?? ''),
            childColumn: String(row.childColumn ?? ''),
          })),
      },
    ));
  }

  return { additiveDDLs, constraintDDLs, createdUniqueFields, rebuiltTable };
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

  // Re-apply indexes (CREATE IF NOT EXISTS is idempotent)
  const indexes = resolveTableIndexes(config);
  if (indexes.length > 0) {
    const indexDDLs = generateIndexDDL(tableName, indexes);
    for (const ddl of indexDDLs) {
      stmts.push(db.prepare(ddl));
    }
  }

  // Reconcile the complete FTS definition. CREATE IF NOT EXISTS cannot repair
  // a virtual table or triggers whose configured field list has changed.
  if (config.fts?.length) {
    const inspection = await inspectD1FTSArtifacts(db, tableName, config.fts);
    assertD1FtsRebuildSafe(tableName, inspection.rebuildSafe);
    const desiredSignature = computeSQLiteFtsSignature(config.fts);
    const storedSignature = await getD1Meta(db, `fts_signature:${tableName}`);

    if (!inspection.healthy || storedSignature !== desiredSignature) {
      for (const ddl of generateFTS5RebuildDDLs(tableName, config.fts)) {
        stmts.push(db.prepare(ddl));
      }
      // The signature is deliberately the final statement in the same D1
      // batch, so metadata can never get ahead of a failed rebuild/backfill.
      stmts.push(prepareD1Meta(db, `fts_signature:${tableName}`, desiredSignature));
    }
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }
}

async function inspectD1FTSArtifacts(
  db: D1Database,
  tableName: string,
  desiredFields: readonly string[],
): Promise<ReturnType<typeof inspectSqliteFtsArtifacts>> {
  const artifactQuery = buildSqliteFtsArtifactQuery(tableName);
  const artifactResult = await db.prepare(artifactQuery.sql)
    .bind(...artifactQuery.params)
    .all();
  const artifactRows = (artifactResult.results ?? []) as Array<Record<string, unknown>>;
  const ftsTableRows = artifactRows.filter((row) => (
    row.name === `${tableName}_fts` && row.type === 'table'
  ));
  let actualFields: string[] | null = null;
  if (ftsTableRows.length === 1) {
    const escapedFtsTable = `${tableName}_fts`.replace(/"/g, '""');
    const fieldRows = await db.prepare(`PRAGMA table_info("${escapedFtsTable}")`).all();
    actualFields = ((fieldRows.results ?? []) as Array<Record<string, unknown>>)
      .sort((left, right) => Number(left.cid) - Number(right.cid))
      .map((row) => String(row.name));
  }
  return inspectSqliteFtsArtifacts(tableName, desiredFields, actualFields, artifactRows);
}

function assertD1FtsRebuildSafe(tableName: string, rebuildSafe: boolean): void {
  if (rebuildSafe) return;
  throw new Error(
    `SQLite FTS artifact collision for '${tableName}': reserved-name objects are not `
    + 'owned by the configured table; refusing destructive repair.',
  );
}

async function recordD1FtsSignatureAfterRebuild(
  db: D1Database,
  tableName: string,
  config: TableConfig,
): Promise<void> {
  if (!config.fts?.length) return;
  await setD1Meta(
    db,
    `fts_signature:${tableName}`,
    computeSQLiteFtsSignature(config.fts),
  );
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
): Promise<boolean> {
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
  const indexes = resolveTableIndexes(config);
  if (!plan.rebuiltTable && indexes.length > 0) {
    for (const ddl of generateIndexDDL(tableName, indexes)) {
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
  return plan.rebuiltTable;
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
