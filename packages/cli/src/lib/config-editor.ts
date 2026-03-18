/**
 * Config Editor — ts-morph AST manipulation of edgebase.config.ts
 *
 * Surgically edits the config file while preserving:
 * - User comments
 * - Formatting / indentation
 * - rules, hooks, and other function expressions
 * - Non-schema config (auth, cors, storage, etc.)
 *
 *
 */
import {
  Project,
  SyntaxKind,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type SourceFile,
  IndentationText,
  NewLineKind,
  ts,
} from 'ts-morph';
import { copyFileSync, readFileSync, writeFileSync, renameSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SchemaField, FieldType, IndexConfig, FkReference, DbProvider } from '@edgebase-fun/shared';

// ─── Types ───

export interface ConfigEditorOptions {
  configPath: string;
  /** Create .bak backup before writing. Default: true */
  backup?: boolean;
}

interface FormattingProfile {
  indentationText: IndentationText;
  indentSize: number;
  tabSize: number;
  convertTabsToSpaces: boolean;
  newLineKind: NewLineKind;
  newLineCharacter: '\n' | '\r\n';
}

// ─── Validation Constants ───

const VALID_FIELD_TYPES: FieldType[] = ['string', 'text', 'number', 'boolean', 'datetime', 'json'];
const AUTO_FIELDS = ['id', 'createdAt', 'updatedAt'];

// ─── Internal Helpers ───

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function detectIndentationText(text: string): Pick<FormattingProfile, 'indentationText' | 'indentSize' | 'tabSize' | 'convertTabsToSpaces'> {
  const spaceIndentLengths: number[] = [];
  let tabIndentedLines = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const match = line.match(/^([ \t]+)/);
    if (!match) continue;

    const indent = match[1];
    if (indent.includes('\t')) {
      tabIndentedLines++;
      continue;
    }

    spaceIndentLengths.push(indent.length);
  }

  if (tabIndentedLines > spaceIndentLengths.length) {
    return {
      indentationText: IndentationText.Tab,
      indentSize: 4,
      tabSize: 4,
      convertTabsToSpaces: false,
    };
  }

  if (spaceIndentLengths.length === 0) {
    return {
      indentationText: IndentationText.TwoSpaces,
      indentSize: 2,
      tabSize: 2,
      convertTabsToSpaces: true,
    };
  }

  const normalizedIndent = spaceIndentLengths.reduce((current, indent) => gcd(current, indent));
  const indentSize = normalizedIndent >= 8 ? 8 : normalizedIndent >= 4 ? 4 : 2;
  const indentationText = indentSize === 8
    ? IndentationText.EightSpaces
    : indentSize === 4
      ? IndentationText.FourSpaces
      : IndentationText.TwoSpaces;

  return {
    indentationText,
    indentSize,
    tabSize: indentSize,
    convertTabsToSpaces: true,
  };
}

function detectFormattingProfile(text: string): FormattingProfile {
  const newLineCharacter = text.includes('\r\n') ? '\r\n' : '\n';
  const newLineKind = newLineCharacter === '\r\n'
    ? NewLineKind.CarriageReturnLineFeed
    : NewLineKind.LineFeed;

  return {
    ...detectIndentationText(text),
    newLineKind,
    newLineCharacter,
  };
}

function createProject(formatting: FormattingProfile): Project {
  return new Project({
    manipulationSettings: {
      indentationText: formatting.indentationText,
      newLineKind: formatting.newLineKind,
      usePrefixAndSuffixTextForRename: false,
      useTrailingCommas: true,
    },
    compilerOptions: { allowJs: true },
    useInMemoryFileSystem: false,
  });
}

/**
 * Get the ObjectLiteralExpression passed to defineConfig().
 * Supports both:
 *   export default defineConfig({ ... })
 *   export default { ... }
 */
function getConfigObject(sourceFile: SourceFile): ObjectLiteralExpression {
  // Strategy 1: find defineConfig(...) call
  const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getText() === 'defineConfig') {
      const args = call.getArguments();
      if (args.length > 0 && args[0].isKind(SyntaxKind.ObjectLiteralExpression)) {
        return args[0] as ObjectLiteralExpression;
      }
    }
  }

  // Strategy 2: export default { ... }
  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (defaultExport) {
    const decl = defaultExport.getDeclarations()[0];
    if (decl) {
      const obj = decl.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)[0];
      if (obj) return obj;
    }
  }

  throw new Error('Cannot find config object in edgebase.config.ts. Expected defineConfig({ ... }) or export default { ... }');
}

/**
 * Get or create the `databases` property, then navigate to `databases.{dbKey}.tables`.
 * Creates missing intermediate structures.
 */
function ensureTablesBlock(
  configObj: ObjectLiteralExpression,
  dbKey: string,
): ObjectLiteralExpression {
  // Get or create `databases`
  let dbsProp = configObj.getProperty('databases') as PropertyAssignment | undefined;
  if (!dbsProp) {
    // Insert databases at beginning for prominence
    configObj.insertPropertyAssignment(0, {
      name: 'databases',
      initializer: '{}',
    });
    dbsProp = configObj.getProperty('databases') as PropertyAssignment;
  }

  const dbsObj = dbsProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

  // Get or create `databases.{dbKey}`
  let blockProp = dbsObj.getProperty(dbKey) as PropertyAssignment | undefined;
  if (!blockProp) {
    dbsObj.addPropertyAssignment({
      name: dbKey,
      initializer: '{\n      tables: {},\n    }',
    });
    blockProp = dbsObj.getProperty(dbKey) as PropertyAssignment;
  }

  const blockObj = blockProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

  // Get or create `databases.{dbKey}.tables`
  let tablesProp = blockObj.getProperty('tables') as PropertyAssignment | undefined;
  if (!tablesProp) {
    blockObj.addPropertyAssignment({
      name: 'tables',
      initializer: '{}',
    });
    tablesProp = blockObj.getProperty('tables') as PropertyAssignment;
  }

  return tablesProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
}

/**
 * Navigate to an existing table's config object.
 * Returns [tablesBlock, tableBlock, dbKey] or throws.
 */
function findTable(
  configObj: ObjectLiteralExpression,
  tableName: string,
  expectedDbKey?: string,
): { tablesBlock: ObjectLiteralExpression; tableBlock: ObjectLiteralExpression; dbKey: string } {
  const dbsProp = configObj.getProperty('databases') as PropertyAssignment | undefined;
  if (!dbsProp) throw new Error(`No databases block found in config.`);

  const dbsObj = dbsProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

  for (const prop of dbsObj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
    const dbKey = prop.getName().replace(/['"]/g, '');
    if (expectedDbKey && dbKey !== expectedDbKey) continue;

    const blockObj = prop.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const tablesProp = blockObj.getProperty('tables') as PropertyAssignment | undefined;
    if (!tablesProp) continue;

    const tablesObj = tablesProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    const tableProp = tablesObj.getProperty(tableName) as PropertyAssignment | undefined;
    if (tableProp) {
      return {
        tablesBlock: tablesObj,
        tableBlock: tableProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression),
        dbKey,
      };
    }
  }

  const scope = expectedDbKey ? `databases.${expectedDbKey}` : 'any database block';
  throw new Error(`Table '${tableName}' not found in ${scope}.`);
}

/**
 * Get or create the `schema` property inside a table config object.
 */
function ensureSchemaBlock(tableBlock: ObjectLiteralExpression): ObjectLiteralExpression {
  let schemaProp = tableBlock.getProperty('schema') as PropertyAssignment | undefined;
  if (!schemaProp) {
    tableBlock.insertPropertyAssignment(0, {
      name: 'schema',
      initializer: '{}',
    });
    schemaProp = tableBlock.getProperty('schema') as PropertyAssignment;
  }
  return schemaProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
}

/**
 * Collect all table names across all DB blocks for uniqueness check.
 */
function getAllTableNames(configObj: ObjectLiteralExpression): Map<string, string> {
  const map = new Map<string, string>(); // tableName → dbKey
  const dbsProp = configObj.getProperty('databases') as PropertyAssignment | undefined;
  if (!dbsProp) return map;

  try {
    const dbsObj = dbsProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    for (const prop of dbsObj.getProperties()) {
      if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
      const dbKey = prop.getName().replace(/['"]/g, '');

      try {
        const blockObj = prop.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        const tablesProp = blockObj.getProperty('tables') as PropertyAssignment | undefined;
        if (!tablesProp) continue;

        const tablesObj = tablesProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        for (const tProp of tablesObj.getProperties()) {
          if (!tProp.isKind(SyntaxKind.PropertyAssignment)) continue;
          const tName = tProp.getName().replace(/['"]/g, '');
          map.set(tName, dbKey);
        }
      } catch {
        // Skip non-object blocks
      }
    }
  } catch {
    // No databases block
  }

  return map;
}

// ─── Serialization ───

function serializeSchemaField(field: SchemaField): string {
  const parts: string[] = [];
  parts.push(`type: '${field.type}'`);
  if (field.required !== undefined) parts.push(`required: ${field.required}`);
  if (field.unique !== undefined) parts.push(`unique: ${field.unique}`);
  if (field.default !== undefined) parts.push(`default: ${JSON.stringify(field.default)}`);
  if (field.primaryKey !== undefined) parts.push(`primaryKey: ${field.primaryKey}`);
  if (field.min !== undefined) parts.push(`min: ${field.min}`);
  if (field.max !== undefined) parts.push(`max: ${field.max}`);
  if (field.pattern !== undefined) parts.push(`pattern: '${field.pattern}'`);
  if (field.enum !== undefined && field.enum.length > 0) {
    parts.push(`enum: [${field.enum.map(e => `'${e}'`).join(', ')}]`);
  }
  if (field.onUpdate !== undefined) parts.push(`onUpdate: '${field.onUpdate}'`);
  if (field.references !== undefined) {
    if (typeof field.references === 'string') {
      parts.push(`references: '${field.references}'`);
    } else {
      const ref = field.references as FkReference;
      const refParts = [`table: '${ref.table}'`];
      if (ref.column) refParts.push(`column: '${ref.column}'`);
      if (ref.onDelete) refParts.push(`onDelete: '${ref.onDelete}'`);
      if (ref.onUpdate) refParts.push(`onUpdate: '${ref.onUpdate}'`);
      parts.push(`references: { ${refParts.join(', ')} }`);
    }
  }
  if (field.check !== undefined) parts.push(`check: '${field.check}'`);
  return `{ ${parts.join(', ')} }`;
}

function serializeSchema(schema: Record<string, SchemaField>): string {
  if (Object.keys(schema).length === 0) return '{}';
  const lines: string[] = [];
  for (const [name, field] of Object.entries(schema)) {
    lines.push(`${name}: ${serializeSchemaField(field)},`);
  }
  return `{\n            ${lines.join('\n            ')}\n          }`;
}

function serializeIndexConfig(idx: IndexConfig): string {
  const parts: string[] = [];
  parts.push(`fields: [${idx.fields.map(f => `'${f}'`).join(', ')}]`);
  if (idx.unique) parts.push(`unique: true`);
  return `{ ${parts.join(', ')} }`;
}

// ─── File I/O ───

function backupConfig(configPath: string): void {
  copyFileSync(configPath, `${configPath}.bak`);
}

function atomicSave(sourceFile: SourceFile, configPath: string, formatting: FormattingProfile): void {
  sourceFile.formatText({
    indentSize: formatting.indentSize,
    tabSize: formatting.tabSize,
    convertTabsToSpaces: formatting.convertTabsToSpaces,
    newLineCharacter: formatting.newLineCharacter,
    indentStyle: ts.IndentStyle.Smart,
  });

  const tempDir = mkdtempSync(join(tmpdir(), 'edgebase-config-'));
  const tempPath = join(tempDir, 'edgebase.config.ts');
  writeFileSync(tempPath, sourceFile.getFullText(), 'utf-8');
  renameSync(tempPath, configPath);
}

function loadAndParse(opts: ConfigEditorOptions): { sourceFile: SourceFile; configObj: ObjectLiteralExpression; formatting: FormattingProfile } {
  const formatting = detectFormattingProfile(readFileSync(opts.configPath, 'utf-8'));
  const project = createProject(formatting);
  const sourceFile = project.addSourceFileAtPath(opts.configPath);
  const configObj = getConfigObject(sourceFile);
  return { sourceFile, configObj, formatting };
}

function saveWithBackup(opts: ConfigEditorOptions, sourceFile: SourceFile, formatting: FormattingProfile): void {
  if (opts.backup !== false) {
    backupConfig(opts.configPath);
  }
  atomicSave(sourceFile, opts.configPath, formatting);
}

// ─── Validation ───

function validateFieldType(type: string): asserts type is FieldType {
  if (!VALID_FIELD_TYPES.includes(type as FieldType)) {
    throw new Error(`Invalid field type '${type}'. Must be one of: ${VALID_FIELD_TYPES.join(', ')}`);
  }
}

function validateColumnName(columnName: string): void {
  if (AUTO_FIELDS.includes(columnName)) {
    throw new Error(`Cannot add/modify auto-field '${columnName}'. Auto-fields (id, createdAt, updatedAt) are managed by the system.`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
    throw new Error(`Invalid column name '${columnName}'. Must start with a letter or underscore, followed by alphanumeric or underscore.`);
  }
}

function validateTableName(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name '${name}'. Must start with a letter or underscore, followed by alphanumeric or underscore.`);
  }
}

function validateDbKey(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid database block name '${name}'. Must start with a letter or underscore, followed by alphanumeric or underscore.`);
  }
}

function validateBucketName(name: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    throw new Error(`Invalid bucket name '${name}'. Use letters, numbers, dashes, and underscores, starting with a letter.`);
  }
}

function toObjectPropertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

export interface AddDatabaseBlockOptions {
  topology: 'single' | 'dynamic';
  provider?: DbProvider;
  connectionString?: string;
  targetLabel?: string;
  placeholder?: string;
  helperText?: string;
}

export interface UpdateDatabaseBlockOptions {
  provider?: DbProvider;
  connectionString?: string | null;
}

function serializeDatabaseBlock(options: AddDatabaseBlockOptions): string {
  const lines: string[] = ['{'];

  if (options.topology === 'dynamic') {
    lines.push(`      instance: true,`);
    if (options.targetLabel || options.placeholder || options.helperText) {
      lines.push(`      admin: {`);
      lines.push(`        instances: {`);
      lines.push(`          source: 'manual',`);
      if (options.targetLabel) {
        lines.push(`          targetLabel: '${options.targetLabel.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`);
      }
      if (options.placeholder) {
        lines.push(`          placeholder: '${options.placeholder.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`);
      }
      if (options.helperText) {
        lines.push(`          helperText: '${options.helperText.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`);
      }
      lines.push(`        },`);
      lines.push(`      },`);
    }
  } else if (options.provider && options.provider !== 'd1') {
    lines.push(`      provider: '${options.provider}',`);
  }

  if (options.topology === 'single' && (options.provider === 'neon' || options.provider === 'postgres')) {
    lines.push(`      connectionString: '${(options.connectionString ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`);
  }

  lines.push(`      tables: {},`);
  lines.push(`    }`);
  return lines.join('\n');
}

// ─── Public API ───

/**
 * Add a new database block to the config.
 */
export async function addDatabaseBlock(
  opts: ConfigEditorOptions,
  dbKey: string,
  options: AddDatabaseBlockOptions,
): Promise<void> {
  validateDbKey(dbKey);

  if (options.topology === 'dynamic' && options.provider && options.provider !== 'do') {
    throw new Error(`Dynamic database blocks must use provider 'do'.`);
  }
  if (options.topology === 'single' && (options.provider === 'neon' || options.provider === 'postgres') && !options.connectionString) {
    throw new Error(`connectionString is required when provider is '${options.provider}'.`);
  }

  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const databasesBlock = ensureNestedBlock(configObj, ['databases']);
  const existing = databasesBlock.getProperty(dbKey);
  if (existing) {
    throw new Error(`Database block '${dbKey}' already exists.`);
  }

  databasesBlock.addPropertyAssignment({
    name: dbKey,
    initializer: serializeDatabaseBlock(options),
  });

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Update a database block's provider settings.
 * Used by dashboard upgrade/setup flows that rewrite a namespace from D1/DO to PostgreSQL.
 */
export async function updateDatabaseBlock(
  opts: ConfigEditorOptions,
  dbKey: string,
  options: UpdateDatabaseBlockOptions,
): Promise<void> {
  validateDbKey(dbKey);

  if (options.provider === 'neon' || options.provider === 'postgres') {
    if (!options.connectionString) {
      throw new Error(`connectionString is required when provider is '${options.provider}'.`);
    }
  }

  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const databasesBlock = ensureNestedBlock(configObj, ['databases']);
  const dbProp = databasesBlock.getProperty(dbKey) as PropertyAssignment | undefined;
  if (!dbProp) {
    throw new Error(`Database block '${dbKey}' not found.`);
  }

  const dbBlock = dbProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const currentInstance = dbBlock.getProperty('instance');
  if (currentInstance && options.provider && options.provider !== 'do') {
    throw new Error(`Dynamic database blocks must use provider 'do'.`);
  }

  const providerProp = dbBlock.getProperty('provider') as PropertyAssignment | undefined;
  const connectionStringProp = dbBlock.getProperty('connectionString') as PropertyAssignment | undefined;

  const nextProvider = options.provider;
  if (!nextProvider || nextProvider === 'd1') {
    providerProp?.remove();
  } else if (providerProp) {
    providerProp.setInitializer(`'${nextProvider}'`);
  } else {
    dbBlock.insertPropertyAssignment(0, {
      name: 'provider',
      initializer: `'${nextProvider}'`,
    });
  }

  const nextConnectionString = options.connectionString ?? undefined;
  if (nextProvider === 'neon' || nextProvider === 'postgres') {
    const serialized = `'${nextConnectionString!.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    if (connectionStringProp) {
      connectionStringProp.setInitializer(serialized);
    } else {
      const insertIndex = dbBlock.getProperties().findIndex((prop) => prop.getKind() === SyntaxKind.PropertyAssignment && (prop as PropertyAssignment).getName() === 'tables');
      dbBlock.insertPropertyAssignment(insertIndex >= 0 ? insertIndex : dbBlock.getProperties().length, {
        name: 'connectionString',
        initializer: serialized,
      });
    }
  } else {
    connectionStringProp?.remove();
  }

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Add a new storage bucket to the config.
 */
export async function addStorageBucket(
  opts: ConfigEditorOptions,
  bucketName: string,
): Promise<void> {
  validateBucketName(bucketName);

  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const bucketsBlock = ensureNestedBlock(configObj, ['storage', 'buckets']);
  const existing = bucketsBlock.getProperty(bucketName);
  if (existing) {
    throw new Error(`Storage bucket '${bucketName}' already exists.`);
  }

  bucketsBlock.addPropertyAssignment({
    name: toObjectPropertyName(bucketName),
    initializer: '{}',
  });

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Add a new table to the config.
 */
export async function addTable(
  opts: ConfigEditorOptions,
  dbKey: string,
  tableName: string,
  schema: Record<string, SchemaField>,
): Promise<void> {
  validateTableName(tableName);
  for (const [colName, field] of Object.entries(schema)) {
    validateColumnName(colName);
    validateFieldType(field.type);
  }

  const { sourceFile, configObj, formatting } = loadAndParse(opts);

  // Check uniqueness across all DB blocks
  const existing = getAllTableNames(configObj);
  if (existing.has(tableName)) {
    throw new Error(`Table '${tableName}' already exists in database block '${existing.get(tableName)}'.`);
  }

  const tablesBlock = ensureTablesBlock(configObj, dbKey);

  const schemaStr = serializeSchema(schema);
  tablesBlock.addPropertyAssignment({
    name: tableName,
    initializer: `{\n          schema: ${schemaStr},\n        }`,
  });

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Remove a table from the config.
 */
export async function removeTable(
  opts: ConfigEditorOptions,
  dbKey: string,
  tableName: string,
): Promise<void> {
  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const { tablesBlock } = findTable(configObj, tableName, dbKey);

  const prop = tablesBlock.getProperty(tableName);
  if (prop) prop.remove();

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Rename a table.
 */
export async function renameTable(
  opts: ConfigEditorOptions,
  dbKey: string,
  oldName: string,
  newName: string,
): Promise<void> {
  validateTableName(newName);

  const { sourceFile, configObj, formatting } = loadAndParse(opts);

  // Check new name doesn't exist
  const existing = getAllTableNames(configObj);
  if (existing.has(newName)) {
    throw new Error(`Table '${newName}' already exists in database block '${existing.get(newName)}'.`);
  }

  const { tablesBlock } = findTable(configObj, oldName, dbKey);
  const prop = tablesBlock.getProperty(oldName) as PropertyAssignment;
  if (!prop) throw new Error(`Table '${oldName}' not found.`);

  // Rename the property
  prop.rename(newName);

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Add a column to a table's schema.
 */
export async function addColumn(
  opts: ConfigEditorOptions,
  dbKey: string,
  tableName: string,
  columnName: string,
  fieldDef: SchemaField,
): Promise<void> {
  validateColumnName(columnName);
  validateFieldType(fieldDef.type);

  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const { tableBlock } = findTable(configObj, tableName, dbKey);
  const schemaBlock = ensureSchemaBlock(tableBlock);

  // Check column doesn't already exist
  if (schemaBlock.getProperty(columnName)) {
    throw new Error(`Column '${columnName}' already exists in table '${tableName}'.`);
  }

  schemaBlock.addPropertyAssignment({
    name: columnName,
    initializer: serializeSchemaField(fieldDef),
  });

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Remove a column from a table's schema.
 */
export async function removeColumn(
  opts: ConfigEditorOptions,
  dbKey: string,
  tableName: string,
  columnName: string,
): Promise<void> {
  validateColumnName(columnName);

  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const { tableBlock } = findTable(configObj, tableName, dbKey);
  const schemaBlock = ensureSchemaBlock(tableBlock);

  const prop = schemaBlock.getProperty(columnName);
  if (!prop) {
    throw new Error(`Column '${columnName}' not found in table '${tableName}'.`);
  }
  prop.remove();

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Update a column's field definition.
 * Partial update: only specified keys are changed.
 */
export async function updateColumn(
  opts: ConfigEditorOptions,
  dbKey: string,
  tableName: string,
  columnName: string,
  fieldDef: Partial<SchemaField>,
): Promise<void> {
  if (AUTO_FIELDS.includes(columnName)) {
    throw new Error(`Cannot modify auto-field '${columnName}'.`);
  }
  if (fieldDef.type) validateFieldType(fieldDef.type);

  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const { tableBlock } = findTable(configObj, tableName, dbKey);
  const schemaBlock = ensureSchemaBlock(tableBlock);

  const prop = schemaBlock.getProperty(columnName) as PropertyAssignment | undefined;
  if (!prop) {
    throw new Error(`Column '${columnName}' not found in table '${tableName}'.`);
  }

  // Read current field, merge with update, rewrite
  const currentObj = prop.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const currentField: Record<string, unknown> = {};

  for (const p of currentObj.getProperties()) {
    if (!p.isKind(SyntaxKind.PropertyAssignment)) continue;
    const name = p.getName().replace(/['"]/g, '');
    const initText = p.getInitializer()?.getText() ?? '';
    // Parse basic values
    if (initText === 'true') currentField[name] = true;
    else if (initText === 'false') currentField[name] = false;
    else if (/^\d+(\.\d+)?$/.test(initText)) currentField[name] = parseFloat(initText);
    else if (initText.startsWith("'") || initText.startsWith('"')) currentField[name] = initText.slice(1, -1);
    else currentField[name] = initText; // Keep complex expressions as-is
  }

  // Merge
  const merged = { ...currentField, ...fieldDef };
  // Remove undefined keys
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete (merged as Record<string, unknown>)[k];
  }

  // Replace the entire initializer
  prop.setInitializer(serializeSchemaField(merged as SchemaField));

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Add an index to a table.
 */
export async function addIndex(
  opts: ConfigEditorOptions,
  dbKey: string,
  tableName: string,
  indexDef: IndexConfig,
): Promise<void> {
  if (!indexDef.fields || indexDef.fields.length === 0) {
    throw new Error('Index must have at least one field.');
  }

  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const { tableBlock } = findTable(configObj, tableName, dbKey);

  let indexesProp = tableBlock.getProperty('indexes') as PropertyAssignment | undefined;
  if (!indexesProp) {
    tableBlock.addPropertyAssignment({
      name: 'indexes',
      initializer: '[]',
    });
    indexesProp = tableBlock.getProperty('indexes') as PropertyAssignment;
  }

  const arr = indexesProp.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
  arr.addElement(serializeIndexConfig(indexDef));

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Remove an index from a table by its position (0-based).
 */
export async function removeIndex(
  opts: ConfigEditorOptions,
  dbKey: string,
  tableName: string,
  indexIdx: number,
): Promise<void> {
  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const { tableBlock } = findTable(configObj, tableName, dbKey);

  const indexesProp = tableBlock.getProperty('indexes') as PropertyAssignment | undefined;
  if (!indexesProp) throw new Error(`Table '${tableName}' has no indexes.`);

  const arr = indexesProp.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
  const elements = arr.getElements();
  if (indexIdx < 0 || indexIdx >= elements.length) {
    throw new Error(`Index position ${indexIdx} out of range (0-${elements.length - 1}).`);
  }
  arr.removeElement(indexIdx);

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Set FTS (Full-Text Search) fields for a table.
 * Pass empty array to remove FTS.
 */
export async function setFts(
  opts: ConfigEditorOptions,
  dbKey: string,
  tableName: string,
  fields: string[],
): Promise<void> {
  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const { tableBlock } = findTable(configObj, tableName, dbKey);

  const ftsProp = tableBlock.getProperty('fts') as PropertyAssignment | undefined;

  if (fields.length === 0) {
    // Remove FTS
    if (ftsProp) ftsProp.remove();
  } else {
    const ftsStr = `[${fields.map(f => `'${f}'`).join(', ')}]`;
    if (ftsProp) {
      ftsProp.setInitializer(ftsStr);
    } else {
      tableBlock.addPropertyAssignment({
        name: 'fts',
        initializer: ftsStr,
      });
    }
  }

  saveWithBackup(opts, sourceFile, formatting);
}

// ─── Auth Config Editing ───

export interface EditableOAuthProviderConfig {
  clientId?: string | null;
  clientSecret?: string | null;
  issuer?: string | null;
  scopes?: string[];
}

export interface EditableAuthSettings {
  emailAuth?: boolean;
  anonymousAuth?: boolean;
  allowedOAuthProviders?: string[];
  allowedRedirectUrls?: string[];
  session?: {
    accessTokenTTL?: string | null;
    refreshTokenTTL?: string | null;
    maxActiveSessions?: number | null;
  };
  magicLink?: {
    enabled?: boolean;
    autoCreate?: boolean;
    tokenTTL?: string | null;
  };
  emailOtp?: {
    enabled?: boolean;
    autoCreate?: boolean;
  };
  passkeys?: {
    enabled?: boolean;
    rpName?: string | null;
    rpID?: string | null;
    origin?: string[];
  };
  oauth?: Record<string, EditableOAuthProviderConfig>;
}

function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function quoteStringArray(values: string[]): string {
  return `[${values.map((value) => quoteString(value)).join(', ')}]`;
}

function upsertProperty(
  parent: ObjectLiteralExpression,
  key: string,
  initializer: string,
): void {
  const existing = parent.getProperty(key) as PropertyAssignment | undefined;
  if (existing) {
    existing.setInitializer(initializer);
    return;
  }

  parent.addPropertyAssignment({
    name: toObjectPropertyName(key),
    initializer,
  });
}

function removeProperty(
  parent: ObjectLiteralExpression,
  key: string,
): void {
  const existing = parent.getProperty(key) as PropertyAssignment | undefined;
  existing?.remove();
}

function setBooleanProperty(
  parent: ObjectLiteralExpression,
  key: string,
  value: boolean | undefined,
): void {
  if (value === undefined) return;
  upsertProperty(parent, key, value ? 'true' : 'false');
}

function setStringProperty(
  parent: ObjectLiteralExpression,
  key: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null || value.trim() === '') {
    removeProperty(parent, key);
    return;
  }
  upsertProperty(parent, key, quoteString(value.trim()));
}

function setNumberProperty(
  parent: ObjectLiteralExpression,
  key: string,
  value: number | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null || Number.isNaN(value)) {
    removeProperty(parent, key);
    return;
  }
  upsertProperty(parent, key, String(value));
}

function setStringArrayProperty(
  parent: ObjectLiteralExpression,
  key: string,
  values: string[] | undefined,
  options?: { removeWhenEmpty?: boolean },
): void {
  if (values === undefined) return;

  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length === 0 && options?.removeWhenEmpty) {
    removeProperty(parent, key);
    return;
  }

  upsertProperty(parent, key, quoteStringArray(normalized));
}

function setExpressionProperty(
  parent: ObjectLiteralExpression,
  key: string,
  initializer: string | null | undefined,
): void {
  if (initializer === undefined) return;
  if (initializer === null || initializer.trim() === '') {
    removeProperty(parent, key);
    return;
  }

  upsertProperty(parent, key, initializer);
}

function pruneEmptyNestedBlock(
  configObj: ObjectLiteralExpression,
  path: string[],
): void {
  if (path.length === 0) return;

  const block = getNestedBlock(configObj, path);
  if (!block || block.getProperties().length > 0) return;

  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  removeNestedProperty(configObj, parentPath, key);
}

function normalizeEnvSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function getOAuthEnvKey(
  provider: string,
  field: 'CLIENT_ID' | 'CLIENT_SECRET',
): string {
  if (provider.startsWith('oidc:')) {
    const oidcName = normalizeEnvSegment(provider.slice(5)) || 'CUSTOM';
    return `EDGEBASE_OIDC_${oidcName}_${field}`;
  }

  const providerName = normalizeEnvSegment(provider) || 'CUSTOM';
  return `EDGEBASE_OAUTH_${providerName}_${field}`;
}

function getAllowedOAuthProvidersExpression(): string {
  return `Array.from(new Set((process.env.EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)))`;
}

function hasOAuthValue(config: EditableOAuthProviderConfig): boolean {
  return (
    (typeof config.clientId === 'string' && config.clientId.trim().length > 0)
    || (typeof config.clientSecret === 'string' && config.clientSecret.trim().length > 0)
    || (typeof config.issuer === 'string' && config.issuer.trim().length > 0)
    || (Array.isArray(config.scopes) && config.scopes.some((scope) => scope.trim().length > 0))
  );
}

function hasSpreadBindingForKey(
  parent: ObjectLiteralExpression,
  key: string,
): boolean {
  return parent
    .getProperties()
    .some((prop) => prop.getKind() === SyntaxKind.SpreadAssignment && new RegExp(`\\b${key}\\s*:`).test(prop.getText()));
}

function getManagedOAuthBlock(
  configObj: ObjectLiteralExpression,
  authBlock: ObjectLiteralExpression,
): ObjectLiteralExpression | null {
  const oauthProperty = authBlock.getProperty('oauth');
  if (oauthProperty?.isKind(SyntaxKind.PropertyAssignment)) {
    const initializer = oauthProperty.getInitializer();
    if (initializer?.isKind(SyntaxKind.ObjectLiteralExpression)) {
      return initializer;
    }
    return null;
  }

  if (hasSpreadBindingForKey(authBlock, 'oauth')) {
    return null;
  }

  return ensureNestedBlock(configObj, ['auth', 'oauth']);
}

function setAllowedOAuthProvidersBinding(
  authBlock: ObjectLiteralExpression,
  allowedOAuthProviders: string[] | undefined,
): void {
  if (allowedOAuthProviders === undefined) return;
  if (hasSpreadBindingForKey(authBlock, 'allowedOAuthProviders')) return;

  setExpressionProperty(
    authBlock,
    'allowedOAuthProviders',
    getAllowedOAuthProvidersExpression(),
  );
}

function configureOAuthProviderBlock(
  providerBlock: ObjectLiteralExpression,
  provider: string,
  config: EditableOAuthProviderConfig,
): void {
  if (!provider.startsWith('oidc:')) {
    if (!hasOAuthValue(config)) {
      removeProperty(providerBlock, 'clientId');
      removeProperty(providerBlock, 'clientSecret');
      removeProperty(providerBlock, 'issuer');
      removeProperty(providerBlock, 'scopes');
      return;
    }

    setExpressionProperty(
      providerBlock,
      'clientId',
      `process.env.${getOAuthEnvKey(provider, 'CLIENT_ID')} ?? ''`,
    );
    setExpressionProperty(
      providerBlock,
      'clientSecret',
      `process.env.${getOAuthEnvKey(provider, 'CLIENT_SECRET')} ?? ''`,
    );
    removeProperty(providerBlock, 'issuer');
    removeProperty(providerBlock, 'scopes');
    return;
  }

  setExpressionProperty(
    providerBlock,
    'clientId',
    hasOAuthValue(config) ? `process.env.${getOAuthEnvKey(provider, 'CLIENT_ID')} ?? ''` : null,
  );
  setExpressionProperty(
    providerBlock,
    'clientSecret',
    hasOAuthValue(config) ? `process.env.${getOAuthEnvKey(provider, 'CLIENT_SECRET')} ?? ''` : null,
  );
  setStringProperty(providerBlock, 'issuer', config.issuer);
  setStringArrayProperty(providerBlock, 'scopes', config.scopes, { removeWhenEmpty: true });
}

export async function setAuthSettings(
  opts: ConfigEditorOptions,
  settings: EditableAuthSettings,
): Promise<void> {
  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  const authBlock = ensureNestedBlock(configObj, ['auth']);

  setBooleanProperty(authBlock, 'emailAuth', settings.emailAuth);
  setBooleanProperty(authBlock, 'anonymousAuth', settings.anonymousAuth);
  setAllowedOAuthProvidersBinding(authBlock, settings.allowedOAuthProviders);
  setStringArrayProperty(authBlock, 'allowedRedirectUrls', settings.allowedRedirectUrls, {
    removeWhenEmpty: true,
  });

  if (settings.session) {
    const sessionBlock = ensureNestedBlock(configObj, ['auth', 'session']);
    setStringProperty(sessionBlock, 'accessTokenTTL', settings.session.accessTokenTTL);
    setStringProperty(sessionBlock, 'refreshTokenTTL', settings.session.refreshTokenTTL);
    setNumberProperty(sessionBlock, 'maxActiveSessions', settings.session.maxActiveSessions);
    pruneEmptyNestedBlock(configObj, ['auth', 'session']);
  }

  if (settings.magicLink) {
    const magicLinkBlock = ensureNestedBlock(configObj, ['auth', 'magicLink']);
    setBooleanProperty(magicLinkBlock, 'enabled', settings.magicLink.enabled);
    setBooleanProperty(magicLinkBlock, 'autoCreate', settings.magicLink.autoCreate);
    setStringProperty(magicLinkBlock, 'tokenTTL', settings.magicLink.tokenTTL);
    pruneEmptyNestedBlock(configObj, ['auth', 'magicLink']);
  }

  if (settings.emailOtp) {
    const emailOtpBlock = ensureNestedBlock(configObj, ['auth', 'emailOtp']);
    setBooleanProperty(emailOtpBlock, 'enabled', settings.emailOtp.enabled);
    setBooleanProperty(emailOtpBlock, 'autoCreate', settings.emailOtp.autoCreate);
    pruneEmptyNestedBlock(configObj, ['auth', 'emailOtp']);
  }

  if (settings.passkeys) {
    const passkeysBlock = ensureNestedBlock(configObj, ['auth', 'passkeys']);
    setBooleanProperty(passkeysBlock, 'enabled', settings.passkeys.enabled);
    setStringProperty(passkeysBlock, 'rpName', settings.passkeys.rpName);
    setStringProperty(passkeysBlock, 'rpID', settings.passkeys.rpID);
    setStringArrayProperty(passkeysBlock, 'origin', settings.passkeys.origin, { removeWhenEmpty: true });
    pruneEmptyNestedBlock(configObj, ['auth', 'passkeys']);
  }

  if (settings.oauth) {
    const oauthBlock = getManagedOAuthBlock(configObj, authBlock);

    for (const [provider, providerConfig] of Object.entries(settings.oauth)) {
      if (!oauthBlock && !provider.startsWith('oidc:')) {
        continue;
      }

      if (provider.startsWith('oidc:')) {
        const oidcName = provider.slice(5);
        if (!oauthBlock) {
          continue;
        }

        const oidcBlock = ensureNestedBlock(configObj, ['auth', 'oauth', 'oidc']);
        const providerBlock = ensureNestedBlock(oidcBlock, [oidcName]);
        configureOAuthProviderBlock(providerBlock, provider, providerConfig);
        if (providerBlock.getProperties().length === 0) {
          removeProperty(oidcBlock, oidcName);
        }
        continue;
      }

      if (!oauthBlock) continue;
      const providerBlock = ensureNestedBlock(oauthBlock, [provider]);
      configureOAuthProviderBlock(providerBlock, provider, providerConfig);
      if (providerBlock.getProperties().length === 0) {
        removeProperty(oauthBlock, provider);
      }
    }

    if (oauthBlock) {
      pruneEmptyNestedBlock(configObj, ['auth', 'oauth', 'oidc']);
      pruneEmptyNestedBlock(configObj, ['auth', 'oauth']);
    }
  }

  pruneEmptyNestedBlock(configObj, ['auth']);
  saveWithBackup(opts, sourceFile, formatting);
}

// ─── Email Config Editing ───

const VALID_EMAIL_TYPES = ['verification', 'passwordReset', 'magicLink', 'emailOtp', 'emailChange'] as const;
type EmailType = (typeof VALID_EMAIL_TYPES)[number];

function validateEmailType(type: string): asserts type is EmailType {
  if (!VALID_EMAIL_TYPES.includes(type as EmailType)) {
    throw new Error(`Invalid email type '${type}'. Must be one of: ${VALID_EMAIL_TYPES.join(', ')}`);
  }
}

/**
 * Ensure a nested property path exists on config object.
 * e.g., ensureNestedBlock(configObj, ['email', 'subjects']) → returns the `subjects` ObjectLiteralExpression.
 */
function ensureNestedBlock(
  configObj: ObjectLiteralExpression,
  path: string[],
): ObjectLiteralExpression {
  let current = configObj;
  for (const key of path) {
    let prop = current.getProperty(key) as PropertyAssignment | undefined;
    if (!prop) {
      current.addPropertyAssignment({
        name: key,
        initializer: '{}',
      });
      prop = current.getProperty(key) as PropertyAssignment;
    }
    current = prop.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  }
  return current;
}

/**
 * Remove a property from a nested path, cleaning up empty parent objects.
 * e.g., removeNestedProperty(configObj, ['email', 'subjects'], 'verification')
 */
function removeNestedProperty(
  configObj: ObjectLiteralExpression,
  parentPath: string[],
  key: string,
): void {
  // Navigate to parent
  let current = configObj;
  const ancestors: { obj: ObjectLiteralExpression; key: string }[] = [];

  for (const segment of parentPath) {
    const prop = current.getProperty(segment) as PropertyAssignment | undefined;
    if (!prop) return; // Path doesn't exist, nothing to remove
    ancestors.push({ obj: current, key: segment });
    try {
      current = prop.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    } catch {
      return; // Not an object, nothing to remove
    }
  }

  // Remove the target property
  const targetProp = current.getProperty(key) as PropertyAssignment | undefined;
  if (!targetProp) return;
  targetProp.remove();

  // Clean up empty parent objects (bottom-up)
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const { obj, key: parentKey } = ancestors[i];
    const parentProp = obj.getProperty(parentKey) as PropertyAssignment | undefined;
    if (!parentProp) break;
    try {
      const parentObj = parentProp.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      if (parentObj.getProperties().length === 0) {
        parentProp.remove();
      } else {
        break; // Parent still has properties, stop cleanup
      }
    } catch {
      break;
    }
  }
}

/**
 * Set a custom email subject override in config.
 * Sets `email.subjects[type] = value`.
 * If value is empty string, removes the override instead.
 */
export async function setEmailSubject(
  opts: ConfigEditorOptions,
  type: string,
  value: string,
): Promise<void> {
  validateEmailType(type);

  const { sourceFile, configObj, formatting } = loadAndParse(opts);

  if (!value) {
    // Remove the override
    removeNestedProperty(configObj, ['email', 'subjects'], type);
  } else {
    const subjectsBlock = ensureNestedBlock(configObj, ['email', 'subjects']);
    const existing = subjectsBlock.getProperty(type) as PropertyAssignment | undefined;
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    if (existing) {
      existing.setInitializer(`'${escaped}'`);
    } else {
      subjectsBlock.addPropertyAssignment({
        name: type,
        initializer: `'${escaped}'`,
      });
    }
  }

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Set a custom email HTML template override in config.
 * Sets `email.templates[type] = \`...\``.
 * Uses backtick template literal for multi-line HTML.
 * If value is empty string, removes the override instead.
 */
export async function setEmailTemplate(
  opts: ConfigEditorOptions,
  type: string,
  value: string,
): Promise<void> {
  validateEmailType(type);

  const { sourceFile, configObj, formatting } = loadAndParse(opts);

  if (!value) {
    // Remove the override
    removeNestedProperty(configObj, ['email', 'templates'], type);
  } else {
    const templatesBlock = ensureNestedBlock(configObj, ['email', 'templates']);
    const existing = templatesBlock.getProperty(type) as PropertyAssignment | undefined;
    // Escape backticks and ${} in user content for template literal safety
    const escaped = value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    if (existing) {
      existing.setInitializer(`\`${escaped}\``);
    } else {
      templatesBlock.addPropertyAssignment({
        name: type,
        initializer: `\`${escaped}\``,
      });
    }
  }

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Remove email override(s) for a given type.
 * field: 'subject' | 'template' | 'both'
 */
export async function removeEmailOverride(
  opts: ConfigEditorOptions,
  type: string,
  field: 'subject' | 'template' | 'both',
): Promise<void> {
  validateEmailType(type);

  const { sourceFile, configObj, formatting } = loadAndParse(opts);

  if (field === 'subject' || field === 'both') {
    removeNestedProperty(configObj, ['email', 'subjects'], type);
  }
  if (field === 'template' || field === 'both') {
    removeNestedProperty(configObj, ['email', 'templates'], type);
  }

  saveWithBackup(opts, sourceFile, formatting);
}

// ─── Per-Locale Email Overrides (i18n) ───

/**
 * Set a per-locale email subject override.
 * Converts `email.subjects[type]` from string to `{ en: existingStr, [locale]: value }` if needed.
 */
export async function setEmailSubjectForLocale(
  opts: ConfigEditorOptions,
  type: string,
  locale: string,
  value: string,
): Promise<void> {
  validateEmailType(type);
  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  setLocalizedProperty(configObj, ['email', 'subjects'], type, locale, value, 'string');
  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Set a per-locale email template override.
 * Converts `email.templates[type]` from string to `{ en: existingStr, [locale]: value }` if needed.
 */
export async function setEmailTemplateForLocale(
  opts: ConfigEditorOptions,
  type: string,
  locale: string,
  value: string,
): Promise<void> {
  validateEmailType(type);
  const { sourceFile, configObj, formatting } = loadAndParse(opts);
  setLocalizedProperty(configObj, ['email', 'templates'], type, locale, value, 'template');
  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Remove a per-locale email override.
 * If the property is an object `{ en: '...', ko: '...' }`, removes the locale key.
 * If only one key remains after removal, simplifies to a plain string.
 * If no keys remain, removes the property entirely.
 */
export async function removeEmailOverrideForLocale(
  opts: ConfigEditorOptions,
  type: string,
  field: 'subject' | 'template',
  locale: string,
): Promise<void> {
  validateEmailType(type);
  const { sourceFile, configObj, formatting } = loadAndParse(opts);

  const section = field === 'subject' ? 'subjects' : 'templates';
  const parentBlock = getNestedBlock(configObj, ['email', section]);
  if (!parentBlock) return;

  const prop = parentBlock.getProperty(type) as PropertyAssignment | undefined;
  if (!prop) return;

  const init = prop.getInitializer();
  if (!init) return;

  // If it's an object literal, remove the locale key
  if (init.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = init as ObjectLiteralExpression;
    const localeProp = obj.getProperty(locale) as PropertyAssignment | undefined;
    if (localeProp) {
      localeProp.remove();
    }

    // If object is now empty, remove the entire property
    if (obj.getProperties().length === 0) {
      removeNestedProperty(configObj, ['email', section], type);
    }
    // If only 'en' key remains, simplify to plain string
    else if (obj.getProperties().length === 1) {
      const remaining = obj.getProperties()[0] as PropertyAssignment;
      if (remaining.getName() === 'en') {
        const enValue = remaining.getInitializer()?.getText() ?? "''";
        prop.setInitializer(enValue);
      }
    }
  }
  // If it's a plain string and locale is 'en', remove entirely
  else if (locale === 'en') {
    removeNestedProperty(configObj, ['email', section], type);
  }

  saveWithBackup(opts, sourceFile, formatting);
}

/**
 * Set a locale key inside a potentially LocalizedString property.
 * If property is currently a string → convert to { en: existingStr, [locale]: newValue }.
 * If property is already an object → add/update the locale key.
 * If property doesn't exist → create { [locale]: newValue }.
 */
function setLocalizedProperty(
  configObj: ObjectLiteralExpression,
  parentPath: string[],
  key: string,
  locale: string,
  value: string,
  mode: 'string' | 'template',
): void {
  const parentBlock = ensureNestedBlock(configObj, parentPath);
  const prop = parentBlock.getProperty(key) as PropertyAssignment | undefined;

  const escapeValue = (v: string): string => {
    if (mode === 'template') {
      const escaped = v.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      return `\`${escaped}\``;
    }
    const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `'${escaped}'`;
  };

  if (!prop) {
    // Property doesn't exist — create as { [locale]: value }
    parentBlock.addPropertyAssignment({
      name: key,
      initializer: `{\n    ${locale}: ${escapeValue(value)},\n  }`,
    });
    return;
  }

  const init = prop.getInitializer();
  if (!init) return;

  // Already an object literal → add/update the locale key
  if (init.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = init as ObjectLiteralExpression;
    const localeProp = obj.getProperty(locale) as PropertyAssignment | undefined;
    if (localeProp) {
      localeProp.setInitializer(escapeValue(value));
    } else {
      obj.addPropertyAssignment({
        name: locale,
        initializer: escapeValue(value),
      });
    }
    return;
  }

  // Currently a plain string/template literal → convert to object form
  const existingText = init.getText();
  if (locale === 'en') {
    // Replacing the en value: convert to { en: newValue }
    prop.setInitializer(`{\n    en: ${escapeValue(value)},\n  }`);
  } else {
    // Adding non-en locale: convert to { en: existingStr, [locale]: newValue }
    prop.setInitializer(`{\n    en: ${existingText},\n    ${locale}: ${escapeValue(value)},\n  }`);
  }
}

/**
 * Get a nested object block (without creating it). Returns undefined if any part of the path is missing.
 */
function getNestedBlock(
  configObj: ObjectLiteralExpression,
  path: string[],
): ObjectLiteralExpression | undefined {
  let current: ObjectLiteralExpression = configObj;
  for (const key of path) {
    const prop = current.getProperty(key) as PropertyAssignment | undefined;
    if (!prop) return undefined;
    const init = prop.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
    if (!init) return undefined;
    current = init;
  }
  return current;
}
