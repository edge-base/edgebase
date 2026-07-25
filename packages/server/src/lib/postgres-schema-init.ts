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
  generatePgPreparationColumnDDL,
  generatePgFTSDDL,
  generatePgIndexDDL,
  computePgFtsSignature,
  buildPgFtsTriggerFunctionBody,
  resolveTableIndexes,
  buildEffectiveSchema,
  computeSchemaHashSync,
  planPostgresFieldUniqueIndex,
  postgresUniqueDuplicateError,
  type PostgresIndexState,
} from './schema.js';
import { escapePgIdentifier } from './postgres-table-utils.js';

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
    // Reconcile physical state even if an older runtime stored the current
    // hash before materializing an existing-column UNIQUE change.
    await runPgExistingTableUpgrade(
      connectionString,
      tableName,
      config,
      query,
      false,
      null,
    );
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
    if (config.fts?.length) {
      await setMeta(
        connectionString,
        `fts_signature:${tableName}`,
        computePgFtsSignature(config.fts),
        query,
      );
    }
  } else {
    await runPgExistingTableUpgrade(
      connectionString,
      tableName,
      config,
      query,
      true,
      currentHash,
    );
    return;
  }

  // Store new hash
  await setMeta(connectionString, `schemaHash:${tableName}`, currentHash, query);
}

/**
 * Non-destructive schema update: detect new columns and ADD COLUMN.
 * Does NOT drop columns (data safety) — mirrors database-do.ts handleSchemaUpdate().
 */
async function preparePgSchemaUpdate(
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
      const ddl = generatePgPreparationColumnDDL(tableName, colName, field);
      await query(ddl, []);
    }
  }
}

async function getPgIndexState(
  tableName: string,
  query: PostgresExecutor,
): Promise<PostgresIndexState[]> {
  const result = await query(
    `SELECT
       index_class.relname AS index_name,
       index_state.indisunique AS is_unique,
       index_state.indisprimary AS is_primary,
       constraint_state.conname AS constraint_name,
       constraint_state.contype AS constraint_type,
       (index_state.indpred IS NOT NULL) AS is_partial,
       array_agg(attribute_state.attname ORDER BY key_state.ordinality)
         FILTER (WHERE attribute_state.attname IS NOT NULL) AS columns
     FROM pg_catalog.pg_class AS table_class
     JOIN pg_catalog.pg_namespace AS namespace_state
       ON namespace_state.oid = table_class.relnamespace
     JOIN pg_catalog.pg_index AS index_state
       ON index_state.indrelid = table_class.oid
     JOIN pg_catalog.pg_class AS index_class
       ON index_class.oid = index_state.indexrelid
     LEFT JOIN pg_catalog.pg_constraint AS constraint_state
       ON constraint_state.conindid = index_class.oid
     LEFT JOIN LATERAL unnest(index_state.indkey)
       WITH ORDINALITY AS key_state(attnum, ordinality)
       ON key_state.ordinality <= index_state.indnkeyatts
     LEFT JOIN pg_catalog.pg_attribute AS attribute_state
       ON attribute_state.attrelid = table_class.oid
      AND attribute_state.attnum = key_state.attnum
     WHERE namespace_state.nspname = current_schema()
       AND table_class.relname = $1
     GROUP BY index_class.relname, index_state.indisunique,
       index_state.indisprimary, constraint_state.conname,
       constraint_state.contype, (index_state.indpred IS NOT NULL)`,
    [tableName],
  );

  return result.rows.map((rawRow) => {
    const row = rawRow as Record<string, unknown>;
    return {
      name: String(row.index_name),
      unique: row.is_unique === true || row.is_unique === 't',
      primary: row.is_primary === true || row.is_primary === 't',
      constraintName: row.constraint_name == null ? null : String(row.constraint_name),
      constraintType: row.constraint_type == null ? null : String(row.constraint_type),
      partial: row.is_partial === true || row.is_partial === 't',
      columns: Array.isArray(row.columns)
        ? row.columns.map((column) => String(column))
        : [],
    };
  });
}

async function reconcilePgFieldUniqueIndexes(
  tableName: string,
  config: TableConfig,
  query: PostgresExecutor,
): Promise<void> {
  const indexes = await getPgIndexState(tableName, query);
  const effectiveSchema = buildEffectiveSchema(config.schema);
  const escapedTableName = tableName.replace(/"/g, '""');

  for (const [fieldName, field] of Object.entries(effectiveSchema)) {
    const plan = planPostgresFieldUniqueIndex(
      tableName,
      fieldName,
      !!field.unique,
      indexes,
    );
    if (plan.action === 'create') {
      const escapedFieldName = fieldName.replace(/"/g, '""');
      const duplicate = await query(
        `SELECT 1 AS "duplicate" FROM "${escapedTableName}" `
        + `WHERE "${escapedFieldName}" IS NOT NULL `
        + `GROUP BY "${escapedFieldName}" HAVING COUNT(*) > 1 LIMIT 1`,
        [],
      );
      if (duplicate.rows.length > 0) {
        throw postgresUniqueDuplicateError(tableName, fieldName);
      }
    }
    if (!plan.ddl) continue;

    await query(plan.ddl, []);
    if (plan.action === 'create') {
      indexes.push({
        name: plan.indexName,
        unique: true,
        primary: false,
        constraintName: null,
        constraintType: null,
        partial: false,
        columns: [fieldName],
      });
    } else if (plan.action === 'drop') {
      const indexPosition = indexes.findIndex((index) => index.name === plan.indexName);
      if (indexPosition >= 0) indexes.splice(indexPosition, 1);
    }
  }
}

async function runPgExistingTableUpgrade(
  connectionString: string,
  tableName: string,
  config: TableConfig,
  query: PostgresExecutor,
  prepareColumns: boolean,
  nextSchemaHash: string | null,
): Promise<void> {
  await query('BEGIN', []);
  try {
    if (prepareColumns) {
      await preparePgSchemaUpdate(tableName, config, query);
    }
    await runPgMigrations(connectionString, tableName, config, query);
    await reconcilePgFieldUniqueIndexes(tableName, config, query);
    await ensurePgFTSAndIndexes(connectionString, tableName, config, query);
    if (nextSchemaHash !== null) {
      await setMeta(connectionString, `schemaHash:${tableName}`, nextSchemaHash, query);
    }
    await query('COMMIT', []);
  } catch (error) {
    try {
      await query('ROLLBACK', []);
    } catch (rollbackError) {
      console.error(`PG schema rollback failed for ${tableName}:`, rollbackError);
    }
    throw error;
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
  const indexes = resolveTableIndexes(config);
  if (indexes.length > 0) {
    const indexDDLs = generatePgIndexDDL(tableName, indexes);
    for (const ddl of indexDDLs) {
      await query(ddl, []);
    }
  }

  // Rebuild/backfill the additive substring corpus only when the configured
  // definition changes. The signature is stored last in the surrounding
  // transaction, so a partial DDL/backfill failure remains retryable.
  if (config.fts?.length) {
    const signatureKey = `fts_signature:${tableName}`;
    const desiredSignature = computePgFtsSignature(config.fts);
    const storedSignature = await getMeta(connectionString, signatureKey, query);
    const priorFields = parsePgFtsSignatureFields(storedSignature) ?? config.fts;
    const artifactHealth = await inspectPgFtsArtifacts(
      tableName,
      config.fts,
      priorFields,
      query,
    );
    if (storedSignature === desiredSignature && pgFtsArtifactsAreHealthy(artifactHealth)) {
      return;
    }

    if (!artifactHealth.tableFound) {
      throw new Error(`PostgreSQL FTS target table '${tableName}' was not found in the current schema.`);
    }
    if (artifactHealth.legacyColumnPresent && !artifactHealth.legacyColumn) {
      throw new Error(`PostgreSQL FTS helper column '_fts' on '${tableName}' has an incompatible type.`);
    }
    if (artifactHealth.textColumnPresent && !artifactHealth.textColumn) {
      throw new Error(`PostgreSQL FTS helper column '_fts_text' on '${tableName}' has an incompatible type.`);
    }

    assertPgFtsArtifactRepairSafe(
      tableName,
      `${tableName}_fts_trigger()`,
      'function',
      artifactHealth.maintenanceFunction,
      artifactHealth.maintenanceFunctionNameOccupied,
      artifactHealth.maintenanceFunctionRepairable,
    );
    assertPgFtsArtifactRepairSafe(
      tableName,
      `${tableName}_fts_update`,
      'trigger',
      artifactHealth.maintenanceTrigger,
      artifactHealth.maintenanceTriggerNameOccupied,
      artifactHealth.maintenanceTriggerRepairable,
    );

    assertPgFtsIndexRepairSafe(
      tableName,
      `idx_${tableName}_fts`,
      artifactHealth.legacyIndex,
      artifactHealth.legacyIndexNameOccupied,
      artifactHealth.legacyIndexRepairable,
    );
    assertPgFtsIndexRepairSafe(
      tableName,
      `idx_${tableName}_fts_text_trgm`,
      artifactHealth.trigramIndex,
      artifactHealth.trigramIndexNameOccupied,
      artifactHealth.trigramIndexRepairable,
    );

    // CREATE INDEX IF NOT EXISTS cannot replace a same-name invalid index.
    // Drop only exact-shape, target-owned artifacts proven invalid/unready;
    // foreign or manual collisions fail above without destructive cleanup.
    if (artifactHealth.legacyIndexRepairable) {
      await query(
        `DROP INDEX IF EXISTS ${escapePgIdentifier(artifactHealth.schemaName)}.${escapePgIdentifier(`idx_${tableName}_fts`)}`,
        [],
      );
    }
    if (artifactHealth.trigramIndexRepairable) {
      await query(
        `DROP INDEX IF EXISTS ${escapePgIdentifier(artifactHealth.schemaName)}.${escapePgIdentifier(`idx_${tableName}_fts_text_trgm`)}`,
        [],
      );
    }

    const ftsDDLs = generatePgFTSDDL(tableName, config.fts);
    for (const ddl of ftsDDLs) {
      await query(ddl, []);
    }
    await setMeta(connectionString, signatureKey, desiredSignature, query);
  }
}

interface PgFtsArtifactHealth {
  schemaName: string;
  tableFound: boolean;
  legacyColumnPresent: boolean;
  legacyColumn: boolean;
  textColumnPresent: boolean;
  textColumn: boolean;
  maintenanceFunction: boolean;
  maintenanceFunctionNameOccupied: boolean;
  maintenanceFunctionRepairable: boolean;
  maintenanceTrigger: boolean;
  maintenanceTriggerNameOccupied: boolean;
  maintenanceTriggerRepairable: boolean;
  legacyIndex: boolean;
  legacyIndexNameOccupied: boolean;
  legacyIndexRepairable: boolean;
  trigramIndex: boolean;
  trigramIndexNameOccupied: boolean;
  trigramIndexRepairable: boolean;
}

function pgBoolean(value: unknown): boolean {
  return value === true || value === 't' || value === 1 || value === '1';
}

function pgFtsArtifactsAreHealthy(health: PgFtsArtifactHealth): boolean {
  return health.tableFound
    && health.legacyColumn
    && health.textColumn
    && health.maintenanceFunction
    && health.maintenanceTrigger
    && health.legacyIndex
    && health.trigramIndex;
}

function assertPgFtsIndexRepairSafe(
  tableName: string,
  indexName: string,
  healthy: boolean,
  nameOccupied: boolean,
  repairable: boolean,
): void {
  if (healthy || !nameOccupied || repairable) return;
  throw new Error(
    `PostgreSQL FTS index name collision for '${indexName}': `
    + `the existing object is not a repairable index owned by table '${tableName}'.`,
  );
}

function assertPgFtsArtifactRepairSafe(
  tableName: string,
  artifactName: string,
  artifactKind: 'function' | 'trigger',
  healthy: boolean,
  nameOccupied: boolean,
  repairable: boolean,
): void {
  if (healthy || !nameOccupied || repairable) return;
  throw new Error(
    `PostgreSQL FTS ${artifactKind} name collision for '${artifactName}': `
    + `the existing object is not a repairable artifact owned by table '${tableName}'.`,
  );
}

function parsePgFtsSignatureFields(signature: string | null): string[] | null {
  if (!signature) return null;
  const separator = signature.indexOf(':');
  if (separator < 0) return null;
  try {
    const fields = JSON.parse(signature.slice(separator + 1)) as unknown;
    if (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string')) return null;
    return computePgFtsSignature(fields) === signature ? fields : null;
  } catch {
    return null;
  }
}

export function buildPgFtsArtifactQuery(
  tableName: string,
  desiredFields: readonly string[],
  priorFields: readonly string[] = desiredFields,
): {
  sql: string;
  params: string[];
} {
  const triggerName = `${tableName}_fts_update`;
  const functionName = `${tableName}_fts_trigger`;
  const legacyIndexName = `idx_${tableName}_fts`;
  const trigramIndexName = `idx_${tableName}_fts_text_trgm`;
  const desiredFunctionBody = buildPgFtsTriggerFunctionBody(desiredFields);
  const priorFunctionBody = buildPgFtsTriggerFunctionBody(priorFields);
  return {
    sql: `WITH target AS MATERIALIZED (
  SELECT c.oid AS table_oid, n.oid AS namespace_oid, n.nspname AS schema_name
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE c.relname = $1
    AND n.nspname = pg_catalog.current_schema()
    AND c.relkind IN ('r', 'p')
  LIMIT 1
), legacy_named AS MATERIALIZED (
  SELECT
    obj.oid AS object_oid,
    obj.relkind AS object_kind,
    obj.relam AS access_method_oid,
    i.indrelid AS table_oid,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready,
    i.indislive AS is_live,
    i.indnkeyatts AS key_count,
    i.indnatts AS attribute_count,
    i.indpred AS predicate,
    i.indexprs AS expressions,
    i.indkey AS attribute_numbers,
    i.indclass AS opclass_oids
  FROM pg_catalog.pg_class AS obj
  JOIN pg_catalog.pg_namespace AS n ON n.oid = obj.relnamespace
  LEFT JOIN pg_catalog.pg_index AS i ON i.indexrelid = obj.oid
  WHERE obj.relname = $4
    AND n.nspname = pg_catalog.current_schema()
  LIMIT 1
), trigram_named AS MATERIALIZED (
  SELECT
    obj.oid AS object_oid,
    obj.relkind AS object_kind,
    obj.relam AS access_method_oid,
    i.indrelid AS table_oid,
    i.indisvalid AS is_valid,
    i.indisready AS is_ready,
    i.indislive AS is_live,
    i.indnkeyatts AS key_count,
    i.indnatts AS attribute_count,
    i.indpred AS predicate,
    i.indexprs AS expressions,
    i.indkey AS attribute_numbers,
    i.indclass AS opclass_oids
  FROM pg_catalog.pg_class AS obj
  JOIN pg_catalog.pg_namespace AS n ON n.oid = obj.relnamespace
  LEFT JOIN pg_catalog.pg_index AS i ON i.indexrelid = obj.oid
  WHERE obj.relname = $5
    AND n.nspname = pg_catalog.current_schema()
  LIMIT 1
)
SELECT
  COALESCE((SELECT schema_name FROM target LIMIT 1), '') AS "schemaName",
  EXISTS (SELECT 1 FROM target LIMIT 1) AS "tableFound",
  EXISTS (
    SELECT 1 FROM target AS t
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.table_oid
    WHERE a.attname = '_fts' AND a.attnum > 0 AND NOT a.attisdropped
    LIMIT 1
  ) AS "legacyColumnPresent",
  EXISTS (
    SELECT 1 FROM target AS t
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.table_oid
    WHERE a.attname = '_fts' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = pg_catalog.to_regtype('pg_catalog.tsvector')
    LIMIT 1
  ) AS "legacyColumn",
  EXISTS (
    SELECT 1 FROM target AS t
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.table_oid
    WHERE a.attname = '_fts_text' AND a.attnum > 0 AND NOT a.attisdropped
    LIMIT 1
  ) AS "textColumnPresent",
  EXISTS (
    SELECT 1 FROM target AS t
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.table_oid
    WHERE a.attname = '_fts_text' AND a.attnum > 0 AND NOT a.attisdropped
      AND a.atttypid = pg_catalog.to_regtype('pg_catalog.text')
    LIMIT 1
  ) AS "textColumn",
  EXISTS (
    SELECT 1
    FROM target AS target_table
    JOIN pg_catalog.pg_proc AS p ON p.pronamespace = target_table.namespace_oid
    JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
    WHERE p.proname = $3
      AND p.pronargs = 0
      AND p.prorettype = pg_catalog.to_regtype('pg_catalog.trigger')
      AND p.prokind = 'f'
      AND language.lanname = 'plpgsql'
      AND p.prosrc = $6
    LIMIT 1
  ) AS "maintenanceFunction",
  EXISTS (
    SELECT 1
    FROM target AS target_table
    JOIN pg_catalog.pg_proc AS p ON p.pronamespace = target_table.namespace_oid
    WHERE p.proname = $3 AND p.pronargs = 0
    LIMIT 1
  ) AS "maintenanceFunctionNameOccupied",
  EXISTS (
    SELECT 1
    FROM target AS target_table
    JOIN pg_catalog.pg_proc AS p ON p.pronamespace = target_table.namespace_oid
    JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
    WHERE p.proname = $3
      AND p.pronargs = 0
      AND p.prorettype = pg_catalog.to_regtype('pg_catalog.trigger')
      AND p.prokind = 'f'
      AND language.lanname = 'plpgsql'
      AND p.prosrc IN ($6, $7)
    LIMIT 1
  ) AS "maintenanceFunctionRepairable",
  EXISTS (
    SELECT 1
    FROM target AS target_table
    JOIN pg_catalog.pg_trigger AS t ON t.tgrelid = target_table.table_oid
    JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
    WHERE t.tgname = $2
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O', 'A')
      AND t.tgtype = 23
      AND t.tgqual IS NULL
      AND p.proname = $3
      AND p.pronamespace = target_table.namespace_oid
      AND p.pronargs = 0
      AND p.prorettype = pg_catalog.to_regtype('pg_catalog.trigger')
      AND p.prokind = 'f'
      AND language.lanname = 'plpgsql'
      AND p.prosrc = $6
    LIMIT 1
  ) AS "maintenanceTrigger",
  EXISTS (
    SELECT 1
    FROM target AS target_table
    JOIN pg_catalog.pg_trigger AS t ON t.tgrelid = target_table.table_oid
    WHERE t.tgname = $2
    LIMIT 1
  ) AS "maintenanceTriggerNameOccupied",
  EXISTS (
    SELECT 1
    FROM target AS target_table
    JOIN pg_catalog.pg_trigger AS t ON t.tgrelid = target_table.table_oid
    JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_language AS language ON language.oid = p.prolang
    WHERE t.tgname = $2
      AND NOT t.tgisinternal
      AND p.proname = $3
      AND p.pronamespace = target_table.namespace_oid
      AND p.pronargs = 0
      AND p.prorettype = pg_catalog.to_regtype('pg_catalog.trigger')
      AND p.prokind = 'f'
      AND language.lanname = 'plpgsql'
      AND p.prosrc IN ($6, $7)
    LIMIT 1
  ) AS "maintenanceTriggerRepairable",
  EXISTS (
    SELECT 1
    FROM legacy_named AS named
    JOIN target AS t ON named.table_oid = t.table_oid
    JOIN pg_catalog.pg_am AS am ON am.oid = named.access_method_oid
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = t.table_oid AND a.attnum = ANY(named.attribute_numbers)
    JOIN pg_catalog.pg_opclass AS opc ON opc.oid = ANY(named.opclass_oids)
    WHERE named.object_kind = 'i' AND am.amname = 'gin'
      AND named.key_count = 1 AND named.attribute_count = 1
      AND named.predicate IS NULL AND named.expressions IS NULL
      AND a.attname = '_fts'
      AND a.atttypid = pg_catalog.to_regtype('pg_catalog.tsvector')
      AND opc.opcname = 'tsvector_ops'
      AND named.is_valid AND named.is_ready AND named.is_live
    LIMIT 1
  ) AS "legacyIndex",
  EXISTS (SELECT 1 FROM legacy_named LIMIT 1) AS "legacyIndexNameOccupied",
  EXISTS (
    SELECT 1
    FROM legacy_named AS named
    JOIN target AS t ON named.table_oid = t.table_oid
    JOIN pg_catalog.pg_am AS am ON am.oid = named.access_method_oid
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = t.table_oid AND a.attnum = ANY(named.attribute_numbers)
    JOIN pg_catalog.pg_opclass AS opc ON opc.oid = ANY(named.opclass_oids)
    WHERE named.object_kind = 'i' AND am.amname = 'gin'
      AND named.key_count = 1 AND named.attribute_count = 1
      AND named.predicate IS NULL AND named.expressions IS NULL
      AND a.attname = '_fts'
      AND a.atttypid = pg_catalog.to_regtype('pg_catalog.tsvector')
      AND opc.opcname = 'tsvector_ops'
      AND NOT (named.is_valid AND named.is_ready AND named.is_live)
    LIMIT 1
  ) AS "legacyIndexRepairable",
  EXISTS (
    SELECT 1
    FROM trigram_named AS named
    JOIN target AS t ON named.table_oid = t.table_oid
    JOIN pg_catalog.pg_am AS am ON am.oid = named.access_method_oid
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = t.table_oid AND a.attnum = ANY(named.attribute_numbers)
    JOIN pg_catalog.pg_opclass AS opc ON opc.oid = ANY(named.opclass_oids)
    WHERE named.object_kind = 'i' AND am.amname = 'gin'
      AND named.key_count = 1 AND named.attribute_count = 1
      AND named.predicate IS NULL AND named.expressions IS NULL
      AND a.attname = '_fts_text'
      AND a.atttypid = pg_catalog.to_regtype('pg_catalog.text')
      AND opc.opcname = 'gin_trgm_ops'
      AND named.is_valid AND named.is_ready AND named.is_live
    LIMIT 1
  ) AS "trigramIndex",
  EXISTS (SELECT 1 FROM trigram_named LIMIT 1) AS "trigramIndexNameOccupied",
  EXISTS (
    SELECT 1
    FROM trigram_named AS named
    JOIN target AS t ON named.table_oid = t.table_oid
    JOIN pg_catalog.pg_am AS am ON am.oid = named.access_method_oid
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = t.table_oid AND a.attnum = ANY(named.attribute_numbers)
    JOIN pg_catalog.pg_opclass AS opc ON opc.oid = ANY(named.opclass_oids)
    WHERE named.object_kind = 'i' AND am.amname = 'gin'
      AND named.key_count = 1 AND named.attribute_count = 1
      AND named.predicate IS NULL AND named.expressions IS NULL
      AND a.attname = '_fts_text'
      AND a.atttypid = pg_catalog.to_regtype('pg_catalog.text')
      AND opc.opcname = 'gin_trgm_ops'
      AND NOT (named.is_valid AND named.is_ready AND named.is_live)
    LIMIT 1
  ) AS "trigramIndexRepairable"`,
    params: [
      tableName,
      triggerName,
      functionName,
      legacyIndexName,
      trigramIndexName,
      desiredFunctionBody,
      priorFunctionBody,
    ],
  };
}

/**
 * Read one bounded physical-state row. Each EXISTS probe is constrained by the
 * target relation and an exact artifact name; no user-table rows are touched.
 */
async function inspectPgFtsArtifacts(
  tableName: string,
  desiredFields: readonly string[],
  priorFields: readonly string[],
  query: PostgresExecutor,
): Promise<PgFtsArtifactHealth> {
  const artifactQuery = buildPgFtsArtifactQuery(tableName, desiredFields, priorFields);
  const result = await query(artifactQuery.sql, artifactQuery.params);
  const row = result.rows[0] ?? {};
  return {
    schemaName: typeof row.schemaName === 'string' ? row.schemaName : '',
    tableFound: pgBoolean(row.tableFound),
    legacyColumnPresent: pgBoolean(row.legacyColumnPresent),
    legacyColumn: pgBoolean(row.legacyColumn),
    textColumnPresent: pgBoolean(row.textColumnPresent),
    textColumn: pgBoolean(row.textColumn),
    maintenanceFunction: pgBoolean(row.maintenanceFunction),
    maintenanceFunctionNameOccupied: pgBoolean(row.maintenanceFunctionNameOccupied),
    maintenanceFunctionRepairable: pgBoolean(row.maintenanceFunctionRepairable),
    maintenanceTrigger: pgBoolean(row.maintenanceTrigger),
    maintenanceTriggerNameOccupied: pgBoolean(row.maintenanceTriggerNameOccupied),
    maintenanceTriggerRepairable: pgBoolean(row.maintenanceTriggerRepairable),
    legacyIndex: pgBoolean(row.legacyIndex),
    legacyIndexNameOccupied: pgBoolean(row.legacyIndexNameOccupied),
    legacyIndexRepairable: pgBoolean(row.legacyIndexRepairable),
    trigramIndex: pgBoolean(row.trigramIndex),
    trigramIndexNameOccupied: pgBoolean(row.trigramIndexNameOccupied),
    trigramIndexRepairable: pgBoolean(row.trigramIndexRepairable),
  };
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
