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

// ─── Index DDL ───

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
  if (config.indexes?.length) {
    ddl.push(...generateIndexDDL(tableName, config.indexes));
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

// ─── PostgreSQL FTS (tsvector + GIN) ───

/**
 * Generate PostgreSQL full-text search DDL:
 * 1. Add `_fts` tsvector column to the table
 * 2. Create GIN index on the tsvector column
 * 3. Create trigger function to auto-update tsvector on write
 * 4. Create BEFORE INSERT OR UPDATE trigger
 * 5. Backfill existing rows (harmless on empty tables)
 *
 * Uses 'simple' text search config for language-agnostic matching
 * (closest equivalent to SQLite FTS5 trigram tokenizer).
 */
export function generatePgFTSDDL(
  tableName: string,
  ftsFields: string[],
): string[] {
  const ddl: string[] = [];
  const ftsCol = '_fts';
  const triggerName = `${tableName}_fts_update`;
  const funcName = `${tableName}_fts_trigger`;
  const indexName = `idx_${tableName}_fts`;

  // Coalesce expression: coalesce(NEW."field", '') || ' ' || ...
  const newCoalesce = ftsFields
    .map(f => `coalesce(NEW.${esc(f)}, '')`)
    .join(` || ' ' || `);
  const bareCoalesce = ftsFields
    .map(f => `coalesce(${esc(f)}, '')`)
    .join(` || ' ' || `);

  // 1. Add tsvector column (IF NOT EXISTS — PG 9.6+)
  ddl.push(
    `ALTER TABLE ${esc(tableName)} ADD COLUMN IF NOT EXISTS ${esc(ftsCol)} tsvector;`,
  );

  // 2. GIN index for fast @@ queries
  ddl.push(
    `CREATE INDEX IF NOT EXISTS ${esc(indexName)} ON ${esc(tableName)} USING gin(${esc(ftsCol)});`,
  );

  // 3. Trigger function — builds tsvector from indexed fields
  ddl.push(
    `CREATE OR REPLACE FUNCTION ${esc(funcName)}() RETURNS trigger AS $$\nBEGIN\n  NEW.${esc(ftsCol)} := to_tsvector('simple', ${newCoalesce});\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;`,
  );

  // 4. Trigger (drop + create to handle field list changes)
  ddl.push(
    `DROP TRIGGER IF EXISTS ${esc(triggerName)} ON ${esc(tableName)};\nCREATE TRIGGER ${esc(triggerName)} BEFORE INSERT OR UPDATE ON ${esc(tableName)}\n  FOR EACH ROW EXECUTE FUNCTION ${esc(funcName)}();`,
  );

  // 5. Backfill existing rows
  ddl.push(
    `UPDATE ${esc(tableName)} SET ${esc(ftsCol)} = to_tsvector('simple', ${bareCoalesce});`,
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
  if (config.indexes?.length) {
    ddl.push(...generatePgIndexDDL(tableName, config.indexes));
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
