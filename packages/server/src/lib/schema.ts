/**
 * Schema → DDL conversion engine.
 *
 * Responsibilities:
 * 1. Convert table schema to CREATE TABLE DDL
 * 2. Generate index DDL (single/composite, unique)
 * 3. Generate FTS5 virtual table DDL
 * 4. Inject auto fields (id, createdAt, updatedAt)
 * 6. Hash schemas for Lazy Schema Init change detection
 */
import type {
  TableConfig,
  SchemaField,
  IndexConfig,
  FkReference,
} from '@edge-base/shared';

// ─── Type Mapping ───

const TYPE_MAP: Record<string, string> = {
  string: 'TEXT',
  text: 'TEXT',
  number: 'REAL',
  boolean: 'INTEGER',
  datetime: 'TEXT',
  json: 'TEXT',
};

// Auth users are stored in AUTH_DB, so app tables can only keep logical references.
const AUTH_LOGICAL_REFERENCE_TABLES = new Set(['users', '_users', '_users_public']);

// ─── Auto Fields ───

const AUTO_FIELDS: Record<string, SchemaField> = {
  id: { type: 'string', primaryKey: true },
  createdAt: { type: 'datetime' },
  updatedAt: { type: 'datetime', onUpdate: 'now' },
};

// ─── System Table DDL ───

/** DDL for _meta table — exists on ALL Database DO instances. */
export const META_TABLE_DDL = `CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`;

// ─── Schema → DDL Conversion ───

/**
 * Build the effective schema with auto fields injected.
 * AutoFields can be disabled by setting them to `false` in schema.
 * Type override of auto-fields is not supported — only `false` is allowed.
 * When schema is undefined (schemaless CRUD,), returns auto-fields only.
 */
export function buildEffectiveSchema(
  userSchema?: Record<string, SchemaField | false>,
): Record<string, SchemaField> {
  const effective: Record<string, SchemaField> = {};

  // Schemaless: return auto-fields only
  if (!userSchema) {
    for (const [name, field] of Object.entries(AUTO_FIELDS)) {
      effective[name] = { ...field };
    }
    return effective;
  }

  // Inject auto fields — only `false` disables them, type override is blocked
  for (const [name, field] of Object.entries(AUTO_FIELDS)) {
    if (userSchema[name] === false) {
      continue; // Disabled
    }
    effective[name] = { ...field };
  }

  // Add user fields (excluding auto field names already handled)
  for (const [name, field] of Object.entries(userSchema)) {
    if (name in AUTO_FIELDS) continue; // Already handled above
    if (field === false) continue;
    effective[name] = field;
  }

  return effective;
}

/**
 * Generate CREATE TABLE DDL for a table.
 */
export function generateCreateTableDDL(
  tableName: string,
  config: TableConfig,
): string {
  const schema = buildEffectiveSchema(config.schema);
  const columns: string[] = [];

  for (const [name, field] of Object.entries(schema)) {
    columns.push(buildColumnDef(name, field));
  }

  return `CREATE TABLE IF NOT EXISTS ${esc(tableName)} (\n  ${columns.join(',\n  ')}\n);`;
}

/**
 * Build a single column definition.
 */
function buildColumnDef(name: string, field: SchemaField): string {
  const parts: string[] = [esc(name), TYPE_MAP[field.type] || 'TEXT'];

  if (field.primaryKey) {
    parts.push('PRIMARY KEY');
  }

  if (field.required && !field.primaryKey) {
    parts.push('NOT NULL');
  }

  if (field.unique) {
    parts.push('UNIQUE');
  }

  if (field.default !== undefined) {
    parts.push(`DEFAULT ${formatDefault(field.default)}`);
  }

  const referenceClause = buildReferenceClause(field.references);
  if (referenceClause) {
    parts.push(referenceClause);
  }

  // SQLite inline CHECK constraint (#133 §35)
  if (field.check) {
    parts.push(`CHECK (${field.check})`);
  }

  return parts.join(' ');
}

/**
 * Generate ALTER TABLE ADD COLUMN for new fields.
 */
export function generateAddColumnDDL(
  tableName: string,
  name: string,
  field: SchemaField,
): string {
  return `ALTER TABLE ${esc(tableName)} ADD COLUMN ${buildColumnDef(name, field)};`;
}

/**
 * Normalize a field for SQLite's restricted ALTER TABLE ADD COLUMN grammar.
 *
 * SQLite cannot add PRIMARY KEY or UNIQUE constraints inline. It also rejects
 * NOT NULL additions for populated tables unless the column has a non-NULL
 * default that can be applied to every existing row.
 */
export function normalizeSQLiteAddColumnField(field: SchemaField): SchemaField {
  return {
    ...field,
    primaryKey: false,
    unique: false,
    required: field.required && field.default !== undefined && field.default !== null,
  };
}

/**
 * Generate the ordered DDL needed to add one field to an existing SQLite
 * table. Unique fields use a separate index because SQLite rejects UNIQUE in
 * ALTER TABLE ADD COLUMN.
 */
export function generateSQLiteAddColumnDDLs(
  tableName: string,
  name: string,
  field: SchemaField,
): string[] {
  const ddls = [
    generateAddColumnDDL(tableName, name, normalizeSQLiteAddColumnField(field)),
  ];

  if (field.unique) {
    const indexName = `uidx_${tableName}_${name}`;
    ddls.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${esc(indexName)} ON ${esc(tableName)}(${esc(name)});`,
    );
  }

  return ddls;
}

export interface SQLiteIndexState {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
}

export interface SQLiteForeignKeyState {
  from: string;
  table: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

export interface SQLiteSchemaArtifact {
  type: 'index' | 'trigger';
  name: string;
  sql: string | null;
}

export interface SQLiteInboundForeignKeyState {
  childTable: string;
  childColumn: string;
}

export interface SQLiteForeignKeyRebuildState {
  columns: readonly string[];
  indexes: readonly SQLiteIndexState[];
  artifacts: readonly SQLiteSchemaArtifact[];
  inboundForeignKeys: readonly SQLiteInboundForeignKeyState[];
}

function normalizeSQLiteForeignKeyAction(value: unknown): string {
  return String(value ?? 'NO ACTION').trim().replace(/\s+/g, ' ').toUpperCase();
}

function sortSQLiteForeignKeys(foreignKeys: SQLiteForeignKeyState[]): SQLiteForeignKeyState[] {
  return foreignKeys.sort((left, right) => {
    const leftKey = [
      left.from,
      left.table,
      left.to,
      left.onUpdate,
      left.onDelete,
      left.match,
    ].join('\u0000');
    const rightKey = [
      right.from,
      right.table,
      right.to,
      right.onUpdate,
      right.onDelete,
      right.match,
    ].join('\u0000');
    return leftKey.localeCompare(rightKey);
  });
}

/** Normalize SQLite PRAGMA foreign_key_list rows for stable state comparison. */
export function normalizeSQLiteForeignKeyRows(
  rows: readonly Record<string, unknown>[],
): SQLiteForeignKeyState[] {
  return sortSQLiteForeignKeys(rows.map((row) => ({
    from: String(row.from ?? ''),
    table: String(row.table ?? ''),
    to: String(row.to ?? ''),
    onUpdate: normalizeSQLiteForeignKeyAction(row.on_update ?? row.onUpdate),
    onDelete: normalizeSQLiteForeignKeyAction(row.on_delete ?? row.onDelete),
    match: normalizeSQLiteForeignKeyAction(row.match ?? 'NONE'),
  })));
}

/** Resolve the physical SQLite foreign keys declared by the current config. */
export function getDeclaredSQLiteForeignKeys(config: TableConfig): SQLiteForeignKeyState[] {
  const foreignKeys: SQLiteForeignKeyState[] = [];

  for (const [fieldName, field] of Object.entries(buildEffectiveSchema(config.schema))) {
    const reference = field.references;
    if (!reference || isLogicalOnlyReference(reference)) continue;

    if (typeof reference === 'string') {
      const ref = reference.trim();
      if (ref.includes('(')) {
        const match = ref.match(/^(\w+)\((\w+)\)$/);
        if (!match) continue;
        foreignKeys.push({
          from: fieldName,
          table: match[1]!,
          to: match[2]!,
          onUpdate: 'NO ACTION',
          onDelete: 'CASCADE',
          match: 'NONE',
        });
      } else {
        foreignKeys.push({
          from: fieldName,
          table: ref,
          to: 'id',
          onUpdate: 'NO ACTION',
          onDelete: 'SET NULL',
          match: 'NONE',
        });
      }
      continue;
    }

    foreignKeys.push({
      from: fieldName,
      table: reference.table,
      to: reference.column ?? 'id',
      onUpdate: normalizeSQLiteForeignKeyAction(reference.onUpdate),
      onDelete: normalizeSQLiteForeignKeyAction(reference.onDelete),
      match: 'NONE',
    });
  }

  return sortSQLiteForeignKeys(foreignKeys);
}

export function sqliteForeignKeysMatch(
  actual: readonly SQLiteForeignKeyState[],
  desired: readonly SQLiteForeignKeyState[],
): boolean {
  if (actual.length !== desired.length) return false;
  return actual.every((foreignKey, index) => {
    const target = desired[index];
    return target !== undefined
      && foreignKey.from === target.from
      && foreignKey.table === target.table
      && foreignKey.to === target.to
      && foreignKey.onUpdate === target.onUpdate
      && foreignKey.onDelete === target.onDelete
      && foreignKey.match === target.match;
  });
}

function remapSQLiteSelfReferences(
  tableName: string,
  temporaryTableName: string,
  config: TableConfig,
): TableConfig {
  if (!config.schema) return config;

  const schema: Record<string, SchemaField | false> = {};
  for (const [fieldName, field] of Object.entries(config.schema)) {
    if (field === false || !field.references) {
      schema[fieldName] = field;
      continue;
    }

    if (typeof field.references === 'string') {
      const reference = field.references.trim();
      const qualified = reference.match(/^(\w+)\((\w+)\)$/);
      if (reference === tableName) {
        schema[fieldName] = { ...field, references: temporaryTableName };
      } else if (qualified?.[1] === tableName) {
        schema[fieldName] = {
          ...field,
          references: `${temporaryTableName}(${qualified[2]})`,
        };
      } else {
        schema[fieldName] = field;
      }
      continue;
    }

    schema[fieldName] = field.references.table === tableName
      ? {
        ...field,
        references: { ...field.references, table: temporaryTableName },
      }
      : field;
  }

  return { ...config, schema };
}

/**
 * Rebuild a SQLite table when its physical foreign keys no longer match config.
 *
 * Removed config fields intentionally remain a non-destructive manual-migration
 * boundary: rebuilding from config must never silently discard an older column.
 * User-created indexes and triggers are replayed from sqlite_master, while
 * EdgeBase-owned indexes/FTS triggers are regenerated from current config.
 */
export function generateSQLiteForeignKeyRebuildDDLs(
  tableName: string,
  config: TableConfig,
  state: SQLiteForeignKeyRebuildState,
): string[] {
  const effectiveSchema = buildEffectiveSchema(config.schema);
  const desiredColumns = Object.keys(effectiveSchema);
  const desiredColumnSet = new Set(desiredColumns);
  const extraColumns = state.columns.filter((column) => !desiredColumnSet.has(column));
  if (extraColumns.length > 0) {
    throw new Error(
      `Cannot reconcile foreign keys for table '${tableName}': physical columns `
      + `${extraColumns.map((column) => `'${column}'`).join(', ')} are absent from config. `
      + 'Apply an explicit data-preserving table migration before retrying.',
    );
  }

  if (state.inboundForeignKeys.length > 0) {
    const dependents = state.inboundForeignKeys
      .map((foreignKey) => `'${foreignKey.childTable}.${foreignKey.childColumn}'`)
      .join(', ');
    throw new Error(
      `Cannot reconcile foreign keys for table '${tableName}': it is referenced by `
      + `${dependents}. Apply an explicit multi-table migration before retrying so `
      + 'referencing rows cannot be deleted by the table rebuild.',
    );
  }

  const desiredUniqueIndexes = [
    ...Object.entries(effectiveSchema)
      .filter(([, field]) => field.unique)
      .map(([fieldName]) => [fieldName]),
    ...(config.indexes ?? [])
      .filter((index) => index.unique)
      .map((index) => index.fields),
  ];
  const unrepresentedInlineUnique = state.indexes.find((index) =>
    index.origin === 'u'
    && !desiredUniqueIndexes.some((desired) =>
      desired.length === index.columns.length
      && desired.every((column, position) => column === index.columns[position]),
    ),
  );
  if (unrepresentedInlineUnique) {
    throw new Error(
      `Cannot reconcile foreign keys for table '${tableName}': inline UNIQUE index `
      + `'${unrepresentedInlineUnique.name}' is not represented by current config. `
      + 'Apply an explicit data-preserving table migration before retrying.',
    );
  }

  const temporaryTableName = `__edgebase_rebuild_${tableName}`;
  const rebuildConfig = remapSQLiteSelfReferences(tableName, temporaryTableName, config);
  const createTableDDL = generateCreateTableDDL(temporaryTableName, rebuildConfig)
    .replace(/^CREATE TABLE IF NOT EXISTS /, 'CREATE TABLE ');
  const escapedColumns = desiredColumns.map(esc).join(', ');
  const managedIndexPrefixes = [`idx_${tableName}_`, `uidx_${tableName}_`];
  const managedFTSTriggers = new Set([
    `${tableName}_ai`,
    `${tableName}_ad`,
    `${tableName}_au`,
  ]);

  const preservedIndexes = state.artifacts
    .filter((artifact) => artifact.type === 'index' && artifact.sql)
    .filter((artifact) => !managedIndexPrefixes.some((prefix) => artifact.name.startsWith(prefix)))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((artifact) => artifact.sql!);
  const preservedTriggers = state.artifacts
    .filter((artifact) => artifact.type === 'trigger' && artifact.sql)
    .filter((artifact) => !managedFTSTriggers.has(artifact.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((artifact) => artifact.sql!);

  const ddls: string[] = [];
  if (getDeclaredSQLiteForeignKeys(config).some((foreignKey) => foreignKey.table === tableName)) {
    ddls.push('PRAGMA defer_foreign_keys = ON;');
  }
  ddls.push(
    createTableDDL,
    `INSERT INTO ${esc(temporaryTableName)} (${escapedColumns}) `
      + `SELECT ${escapedColumns} FROM ${esc(tableName)};`,
    `DROP TABLE ${esc(tableName)};`,
    `ALTER TABLE ${esc(temporaryTableName)} RENAME TO ${esc(tableName)};`,
    ...preservedIndexes,
    ...generateIndexDDL(tableName, resolveTableIndexes(config)),
    ...preservedTriggers,
  );

  if (config.fts?.length) {
    ddls.push(
      generateFTS5DDL(tableName, config.fts),
      ...generateFTS5Triggers(tableName, config.fts),
    );
    const ftsTableName = `${tableName}_fts`;
    ddls.push(
      `INSERT INTO ${esc(ftsTableName)}(${esc(ftsTableName)}) VALUES ('rebuild');`,
    );
  }

  return ddls;
}

export interface SQLiteFieldUniqueIndexPlan {
  action: 'none' | 'create' | 'drop';
  indexName: string;
  ddl?: string;
}

/**
 * Reconcile the single-column index owned by SchemaField.unique.
 *
 * Explicit config.indexes entries, user migration indexes, primary keys, and
 * partial/composite indexes have separate ownership and are never removed.
 */
export function planSQLiteFieldUniqueIndex(
  tableName: string,
  fieldName: string,
  desiredUnique: boolean,
  indexes: SQLiteIndexState[],
): SQLiteFieldUniqueIndexPlan {
  const indexName = `uidx_${tableName}_${fieldName}`;
  const managedIndex = indexes.find((index) => index.name === indexName);
  const isExpectedManagedIndex = !!managedIndex
    && managedIndex.origin === 'c'
    && managedIndex.unique
    && !managedIndex.partial
    && managedIndex.columns.length === 1
    && managedIndex.columns[0] === fieldName;

  if (managedIndex && !isExpectedManagedIndex) {
    throw new Error(
      `Cannot reconcile unique for field '${tableName}.${fieldName}': reserved index `
      + `'${indexName}' does not match the expected single-column UNIQUE index. `
      + 'Rename or remove the conflicting index before retrying the schema update.',
    );
  }

  const exactUniqueIndexes = indexes.filter((index) =>
    index.unique
    && !index.partial
    && index.columns.length === 1
    && index.columns[0] === fieldName,
  );

  if (desiredUnique) {
    if (exactUniqueIndexes.length > 0) {
      return { action: 'none', indexName };
    }
    return {
      action: 'create',
      indexName,
      ddl: `CREATE UNIQUE INDEX ${esc(indexName)} ON ${esc(tableName)}(${esc(fieldName)});`,
    };
  }

  const inlineUniqueIndex = exactUniqueIndexes.find((index) => index.origin === 'u');
  if (inlineUniqueIndex) {
    throw new Error(
      `Cannot disable unique for field '${tableName}.${fieldName}': `
      + 'SQLite stored it as an inline UNIQUE constraint. '
      + 'Apply an explicit table-rebuild migration before setting unique to false.',
    );
  }

  if (isExpectedManagedIndex) {
    return {
      action: 'drop',
      indexName,
      ddl: `DROP INDEX IF EXISTS ${esc(indexName)};`,
    };
  }
  return { action: 'none', indexName };
}

export function sqliteUniqueDuplicateError(tableName: string, fieldName: string): Error {
  return new Error(
    `Cannot enable unique for field '${tableName}.${fieldName}': `
    + 'existing non-NULL values contain duplicates. '
    + 'Resolve the duplicates before retrying the schema update.',
  );
}

// ─── Index DDL ───

/**
 * Resolve explicit indexes plus the single-column indexes required by physical
 * foreign-key fields.
 *
 * A primary key, a field-level UNIQUE constraint, or an explicit index whose
 * leftmost field is the reference already supports equality lookups and parent
 * constraint checks. Logical auth references emit no physical FK and therefore
 * do not acquire an implicit index here.
 */
export function resolveTableIndexes(config: TableConfig): IndexConfig[] {
  const explicitIndexes = config.indexes ?? [];
  const coveredFields = new Set<string>();

  for (const index of explicitIndexes) {
    const [leftmostField] = index.fields;
    if (leftmostField) coveredFields.add(leftmostField);
  }

  const automaticIndexes: IndexConfig[] = [];
  for (const [fieldName, field] of Object.entries(buildEffectiveSchema(config.schema))) {
    if (
      field.primaryKey
      || field.unique
      || coveredFields.has(fieldName)
      || buildReferenceClause(field.references) === null
    ) {
      continue;
    }

    automaticIndexes.push({ fields: [fieldName] });
    coveredFields.add(fieldName);
  }

  return automaticIndexes.length > 0
    ? [...explicitIndexes, ...automaticIndexes]
    : explicitIndexes;
}

/**
 * Generate CREATE INDEX DDL for indexes.
 */
export function generateIndexDDL(
  tableName: string,
  indexes: IndexConfig[],
): string[] {
  return indexes.map((idx, _i) => {
    const indexName = `idx_${tableName}_${idx.fields.join('_')}`;
    const unique = idx.unique ? 'UNIQUE ' : '';
    const fields = idx.fields.map(esc).join(', ');
    return `CREATE ${unique}INDEX IF NOT EXISTS ${esc(indexName)} ON ${esc(tableName)}(${fields});`;
  });
}

// ─── FTS5 DDL ───

/**
 * Generate FTS5 virtual table DDL with trigram tokenizer.
 * @param tableName Base table name
 * @param ftsFields Fields to index for full-text search
 */
export function generateFTS5DDL(
  tableName: string,
  ftsFields: string[],
): string {
  const ftsTableName = `${tableName}_fts`;
  const fields = ftsFields.join(', ');
  // content-sync with base table
  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${esc(ftsTableName)} USING fts5(${fields}, content='${tableName}', content_rowid='rowid', tokenize='trigram');`;
}

/**
 * Generate FTS5 triggers for auto-sync with base table.
 */
export function generateFTS5Triggers(
  tableName: string,
  ftsFields: string[],
): string[] {
  const ftsTableName = `${tableName}_fts`;
  const newFields = ftsFields.map(f => `new.${esc(f)}`).join(', ');
  const oldFields = ftsFields.map(f => `old.${esc(f)}`).join(', ');

  return [
    // INSERT trigger
    `CREATE TRIGGER IF NOT EXISTS ${esc(`${tableName}_ai`)} AFTER INSERT ON ${esc(tableName)} BEGIN
  INSERT INTO ${esc(ftsTableName)}(rowid, ${ftsFields.map(esc).join(', ')}) VALUES (new.rowid, ${newFields});
END;`,
    // DELETE trigger
    `CREATE TRIGGER IF NOT EXISTS ${esc(`${tableName}_ad`)} AFTER DELETE ON ${esc(tableName)} BEGIN
  INSERT INTO ${esc(ftsTableName)}(${esc(ftsTableName)}, rowid, ${ftsFields.map(esc).join(', ')}) VALUES ('delete', old.rowid, ${oldFields});
END;`,
    // UPDATE trigger
    `CREATE TRIGGER IF NOT EXISTS ${esc(`${tableName}_au`)} AFTER UPDATE ON ${esc(tableName)} BEGIN
  INSERT INTO ${esc(ftsTableName)}(${esc(ftsTableName)}, rowid, ${ftsFields.map(esc).join(', ')}) VALUES ('delete', old.rowid, ${oldFields});
  INSERT INTO ${esc(ftsTableName)}(rowid, ${ftsFields.map(esc).join(', ')}) VALUES (new.rowid, ${newFields});
END;`,
  ];
}

const SQLITE_FTS_DEFINITION_VERSION = 'fts5-trigram-v1';

/** Persistent signature includes field order because highlight indexes use it. */
export function computeSQLiteFtsSignature(ftsFields: string[]): string {
  return `${SQLITE_FTS_DEFINITION_VERSION}:${JSON.stringify(ftsFields)}`;
}

/**
 * Replace an incomplete or field-drifted external-content FTS definition and
 * rebuild it from the authoritative base table.
 */
export function generateFTS5RebuildDDLs(
  tableName: string,
  ftsFields: string[],
): string[] {
  const ftsTableName = `${tableName}_fts`;
  return [
    `DROP TRIGGER IF EXISTS ${esc(`${tableName}_ai`)};`,
    `DROP TRIGGER IF EXISTS ${esc(`${tableName}_ad`)};`,
    `DROP TRIGGER IF EXISTS ${esc(`${tableName}_au`)};`,
    `DROP TABLE IF EXISTS ${esc(ftsTableName)};`,
    generateFTS5DDL(tableName, ftsFields),
    ...generateFTS5Triggers(tableName, ftsFields),
    `INSERT INTO ${esc(ftsTableName)}(${esc(ftsTableName)}) VALUES ('rebuild');`,
  ];
}

// ─── Schema Hashing ───

function deepSort(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepSort);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = deepSort((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Compute a deterministic hash of a table schema for change detection.
 * Uses JSON serialization with deep sorted keys + SHA-256.
 */
export async function computeSchemaHash(
  config: TableConfig,
): Promise<string> {
  const schemaOnly = { schema: config.schema ?? {} };
  const str = JSON.stringify(deepSort(schemaOnly));
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Synchronous schema hash using simple djb2 — for use in DO constructor.
 * Only hashes the `schema` field (table column definitions), NOT rules/hooks
 * (functions serialize to undefined in JSON.stringify).
 * Schema changes trigger DDL migration; rules/hooks changes are picked up
 * by Worker redeployment without DDL changes. (#133 §27)
 */
export function computeSchemaHashSync(
  config: TableConfig,
): string {
  // Only schema field — rules/hooks are functions and would serialize to undefined
  const schemaOnly = { schema: config.schema ?? {} };
  const str = JSON.stringify(deepSort(schemaOnly));
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ─── Utility ───

/** Escape identifiers (table/column names). */
function esc(name: string): string {
  // Double-quote escaping for SQLite identifiers
  return `"${name.replace(/"/g, '""')}"`;
}

function extractReferenceTable(reference: string | FkReference | undefined): string | null {
  if (!reference) return null;
  if (typeof reference === 'string') {
    const match = reference.trim().match(/^(\w+)(?:\((\w+)\))?$/);
    return match?.[1] ?? null;
  }
  return reference.table;
}

function isLogicalOnlyReference(reference: string | FkReference | undefined): boolean {
  const table = extractReferenceTable(reference);
  return table !== null && AUTH_LOGICAL_REFERENCE_TABLES.has(table);
}

function buildReferenceClause(reference: string | FkReference | undefined): string | null {
  if (!reference || isLogicalOnlyReference(reference)) {
    return null;
  }

  if (typeof reference === 'string') {
    const ref = reference.trim();
    if (ref.includes('(')) {
      const match = ref.match(/^(\w+)\((\w+)\)$/);
      if (match) {
        return `REFERENCES ${esc(match[1])}(${esc(match[2])}) ON DELETE CASCADE`;
      }
      return null;
    }
    return `REFERENCES ${esc(ref)}("id") ON DELETE SET NULL`;
  }

  const col = reference.column ?? 'id';
  const delAction = reference.onDelete ? ` ON DELETE ${reference.onDelete}` : '';
  const updAction = reference.onUpdate ? ` ON UPDATE ${reference.onUpdate}` : '';
  return `REFERENCES ${esc(reference.table)}(${esc(col)})${delAction}${updAction}`;
}

function formatDefault(val: unknown): string {
  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (val === null) return 'NULL';
  return String(val);
}

/**
 * Get all DDL statements needed for a single table (#133 §26).
 * Returns array of DDL strings to execute in order.
 */
export function generateTableDDL(
  tableName: string,
  config: TableConfig,
): string[] {
  const ddl: string[] = [];

  // 1. CREATE TABLE
  ddl.push(generateCreateTableDDL(tableName, config));

  // 2. Indexes
  const indexes = resolveTableIndexes(config);
  if (indexes.length > 0) {
    ddl.push(...generateIndexDDL(tableName, indexes));
  }

  // 3. FTS5
  if (config.fts?.length) {
    ddl.push(generateFTS5DDL(tableName, config.fts));
    ddl.push(...generateFTS5Triggers(tableName, config.fts));
  }

  return ddl;
}

// ═══════════════════════════════════════════════════════════════════════════
// PostgreSQL DDL Generation
// ═══════════════════════════════════════════════════════════════════════════

// ─── PostgreSQL Type Mapping ───

const PG_TYPE_MAP: Record<string, string> = {
  string: 'TEXT',
  text: 'TEXT',
  number: 'DOUBLE PRECISION',
  boolean: 'BOOLEAN',
  datetime: 'TIMESTAMPTZ',
  json: 'JSONB',
};

// ─── PostgreSQL System Table DDL ───

/** DDL for _meta table on PostgreSQL databases. */
export const PG_META_TABLE_DDL = `CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`;

// ─── PostgreSQL Schema → DDL Conversion ───

/**
 * Generate PostgreSQL CREATE TABLE DDL for a table.
 */
export function generatePgCreateTableDDL(
  tableName: string,
  config: TableConfig,
): string {
  const schema = buildEffectiveSchema(config.schema);
  const columns: string[] = [];

  for (const [name, field] of Object.entries(schema)) {
    columns.push(buildPgColumnDef(name, field));
  }

  return `CREATE TABLE IF NOT EXISTS ${esc(tableName)} (\n  ${columns.join(',\n  ')}\n);`;
}

/**
 * Build a single PostgreSQL column definition.
 */
function buildPgColumnDef(name: string, field: SchemaField): string {
  const parts: string[] = [esc(name), PG_TYPE_MAP[field.type] || 'TEXT'];

  if (field.primaryKey) {
    parts.push('PRIMARY KEY');
  }

  if (field.required && !field.primaryKey) {
    parts.push('NOT NULL');
  }

  if (field.unique) {
    parts.push('UNIQUE');
  }

  if (field.default !== undefined) {
    parts.push(`DEFAULT ${formatPgDefault(field.default)}`);
  }

  const referenceClause = buildReferenceClause(field.references);
  if (referenceClause) {
    parts.push(referenceClause);
  }

  // CHECK constraint (same syntax as SQLite)
  if (field.check) {
    parts.push(`CHECK (${field.check})`);
  }

  return parts.join(' ');
}

/**
 * Generate PostgreSQL ALTER TABLE ADD COLUMN for new fields.
 */
export function generatePgAddColumnDDL(
  tableName: string,
  name: string,
  field: SchemaField,
): string {
  return `ALTER TABLE ${esc(tableName)} ADD COLUMN ${buildPgColumnDef(name, field)};`;
}

/**
 * Generate the additive PostgreSQL phase for an existing table. A new field's
 * UNIQUE flag is finalized only after pending data migrations have run, so a
 * backfill/deduplication migration cannot be blocked by the target constraint.
 */
export function generatePgPreparationColumnDDL(
  tableName: string,
  name: string,
  field: SchemaField,
): string {
  return generatePgAddColumnDDL(tableName, name, {
    ...field,
    unique: false,
  });
}

export interface PostgresIndexState {
  name: string;
  unique: boolean;
  primary: boolean;
  constraintName: string | null;
  constraintType: string | null;
  partial: boolean;
  columns: string[];
}

export interface PostgresFieldUniqueIndexPlan {
  action: 'none' | 'create' | 'drop';
  indexName: string;
  ddl?: string;
}

/**
 * Reconcile the PostgreSQL single-column index owned by SchemaField.unique.
 * Constraint-owned and custom indexes are authority boundaries: they can
 * satisfy unique=true, but only an explicit migration may remove them.
 */
export function planPostgresFieldUniqueIndex(
  tableName: string,
  fieldName: string,
  desiredUnique: boolean,
  indexes: PostgresIndexState[],
): PostgresFieldUniqueIndexPlan {
  const indexName = `uidx_${tableName}_${fieldName}`;
  const managedIndex = indexes.find((index) => index.name === indexName);
  const isExpectedManagedIndex = !!managedIndex
    && managedIndex.unique
    && !managedIndex.primary
    && managedIndex.constraintName === null
    && !managedIndex.partial
    && managedIndex.columns.length === 1
    && managedIndex.columns[0] === fieldName;

  if (managedIndex && !isExpectedManagedIndex) {
    throw new Error(
      `Cannot reconcile unique for field '${tableName}.${fieldName}': reserved index `
      + `'${indexName}' does not match the expected single-column UNIQUE index. `
      + 'Rename or remove the conflicting index before retrying the schema update.',
    );
  }

  const exactUniqueIndexes = indexes.filter((index) =>
    index.unique
    && !index.partial
    && index.columns.length === 1
    && index.columns[0] === fieldName,
  );

  if (desiredUnique) {
    if (exactUniqueIndexes.length > 0) {
      return { action: 'none', indexName };
    }
    return {
      action: 'create',
      indexName,
      ddl: `CREATE UNIQUE INDEX ${esc(indexName)} ON ${esc(tableName)}(${esc(fieldName)});`,
    };
  }

  const constraintOwnedUnique = exactUniqueIndexes.find((index) =>
    !index.primary && index.constraintName !== null,
  );
  if (constraintOwnedUnique) {
    throw new Error(
      `Cannot disable unique for field '${tableName}.${fieldName}': PostgreSQL stored it as `
      + `constraint '${constraintOwnedUnique.constraintName}'. `
      + 'Apply an explicit constraint-removal migration before setting unique to false.',
    );
  }

  if (isExpectedManagedIndex) {
    return {
      action: 'drop',
      indexName,
      ddl: `DROP INDEX IF EXISTS ${esc(indexName)};`,
    };
  }
  return { action: 'none', indexName };
}

export function postgresUniqueDuplicateError(tableName: string, fieldName: string): Error {
  return new Error(
    `Cannot enable unique for field '${tableName}.${fieldName}': `
    + 'existing non-NULL values contain duplicates. '
    + 'Resolve the duplicates before retrying the schema update.',
  );
}

// ─── PostgreSQL Index DDL ───

/**
 * Generate PostgreSQL CREATE INDEX DDL.
 * Syntax is identical to SQLite — kept separate for future B-tree hints.
 */
export function generatePgIndexDDL(
  tableName: string,
  indexes: IndexConfig[],
): string[] {
  return indexes.map((idx) => {
    const indexName = `idx_${tableName}_${idx.fields.join('_')}`;
    const unique = idx.unique ? 'UNIQUE ' : '';
    const fields = idx.fields.map(esc).join(', ');
    return `CREATE ${unique}INDEX IF NOT EXISTS ${esc(indexName)} ON ${esc(tableName)}(${fields});`;
  });
}

// ─── PostgreSQL FTS (legacy tsvector + indexed substring corpus) ───

const POSTGRES_FTS_TEXT_COLUMN = '_fts_text';
const POSTGRES_FTS_DDL_VERSION = 'pg-trgm-substring-v1';

/** Persistent signature used to run corpus backfills once per definition. */
export function computePgFtsSignature(ftsFields: string[]): string {
  return `${POSTGRES_FTS_DDL_VERSION}:${JSON.stringify(ftsFields)}`;
}

/** Exact pg_proc.prosrc body used to prove ownership before replacement. */
export function buildPgFtsTriggerFunctionBody(ftsFields: readonly string[]): string {
  const newCoalesce = ftsFields
    .map(f => `coalesce(NEW.${esc(f)}::text, '')`)
    .join(` || ' ' || `);
  return `\nBEGIN\n  NEW.${esc(POSTGRES_FTS_TEXT_COLUMN)} := ${newCoalesce};\n`
    + `  NEW.${esc('_fts')} := to_tsvector('simple', NEW.${esc(POSTGRES_FTS_TEXT_COLUMN)});\n`
    + '  RETURN NEW;\nEND;\n';
}

/**
 * Generate PostgreSQL full-text/search DDL:
 * 1. Ensure pg_trgm is available
 * 2. Retain the legacy `_fts` tsvector column and GIN index
 * 3. Add one `_fts_text` corpus with a trigram GIN index
 * 4. Maintain both helper columns from one trigger
 * 5. Backfill existing rows once per persisted FTS definition signature
 *
 * `_fts` remains additive for existing installations while `.search()` uses
 * `_fts_text` so PostgreSQL substring semantics actually hit the generated
 * pg_trgm index.
 */
export function generatePgFTSDDL(
  tableName: string,
  ftsFields: string[],
): string[] {
  const ddl: string[] = [];
  const ftsCol = '_fts';
  const ftsTextCol = POSTGRES_FTS_TEXT_COLUMN;
  const triggerName = `${tableName}_fts_update`;
  const funcName = `${tableName}_fts_trigger`;
  const indexName = `idx_${tableName}_fts`;
  const trigramIndexName = `idx_${tableName}_fts_text_trgm`;

  // Cast every configured field because JSON/JSONB and numeric columns cannot
  // be passed directly to coalesce(text) or concatenated with text in PG.
  const bareCoalesce = ftsFields
    .map(f => `coalesce(${esc(f)}::text, '')`)
    .join(` || ' ' || `);

  // 1. pg_trgm is a trusted extension on supported PostgreSQL/Neon targets.
  ddl.push('CREATE EXTENSION IF NOT EXISTS pg_trgm;');

  // 2. Retain the legacy tsvector helper (IF NOT EXISTS — PG 9.6+).
  ddl.push(
    `ALTER TABLE ${esc(tableName)} ADD COLUMN IF NOT EXISTS ${esc(ftsCol)} tsvector;`,
  );

  // 3. Add the substring corpus without changing the legacy helper's type.
  ddl.push(
    `ALTER TABLE ${esc(tableName)} ADD COLUMN IF NOT EXISTS ${esc(ftsTextCol)} TEXT;`,
  );

  // 4. Retain the legacy GIN index.
  ddl.push(
    `CREATE INDEX IF NOT EXISTS ${esc(indexName)} ON ${esc(tableName)} USING gin(${esc(ftsCol)});`,
  );

  // 5. pg_trgm accelerates the same ILIKE substring predicate used at read time.
  ddl.push(
    `CREATE INDEX IF NOT EXISTS ${esc(trigramIndexName)} ON ${esc(tableName)} USING gin(${esc(ftsTextCol)} gin_trgm_ops);`,
  );

  // 6. One trigger function keeps both internal projections coherent.
  const triggerFunctionBody = buildPgFtsTriggerFunctionBody(ftsFields);
  ddl.push(
    `CREATE OR REPLACE FUNCTION ${esc(funcName)}() RETURNS trigger AS $$${triggerFunctionBody}$$ LANGUAGE plpgsql;`,
  );

  // 7. Recreate the trigger when the configured field list changes.
  ddl.push(
    `DROP TRIGGER IF EXISTS ${esc(triggerName)} ON ${esc(tableName)};\nCREATE TRIGGER ${esc(triggerName)} BEFORE INSERT OR UPDATE ON ${esc(tableName)}\n  FOR EACH ROW EXECUTE FUNCTION ${esc(funcName)}();`,
  );

  // 8. Existing-table migration backfill; schema init signatures prevent this
  // UPDATE from running on every Worker cold start.
  ddl.push(
    `UPDATE ${esc(tableName)} SET ${esc(ftsTextCol)} = ${bareCoalesce}, ${esc(ftsCol)} = to_tsvector('simple', ${bareCoalesce});`,
  );

  return ddl;
}

// ─── PostgreSQL Full Table DDL ───

/**
 * Get all DDL statements needed for a single PostgreSQL table.
 * Returns array of DDL strings to execute in order.
 */
export function generatePgTableDDL(
  tableName: string,
  config: TableConfig,
): string[] {
  const ddl: string[] = [];

  // 1. CREATE TABLE
  ddl.push(generatePgCreateTableDDL(tableName, config));

  // 2. Indexes
  const indexes = resolveTableIndexes(config);
  if (indexes.length > 0) {
    ddl.push(...generatePgIndexDDL(tableName, indexes));
  }

  // 3. FTS (tsvector + GIN + trigger)
  if (config.fts?.length) {
    ddl.push(...generatePgFTSDDL(tableName, config.fts));
  }

  return ddl;
}

// ─── PostgreSQL Default Value Formatting ───

function formatPgDefault(val: unknown): string {
  if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (val === null) return 'NULL';
  return String(val);
}
