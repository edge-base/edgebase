/**
 * Query engine: filter/sort/pagination → SQL.
 *
 * Filter tuple format: [field, operator, value]
 * OR filter: orFilters — conditions joined with OR
 * Sort: { field, direction }
 * Pagination: offset-based or cursor-based (UUID v7)
 *
 * Supports two SQL dialects:
 *   - 'sqlite' (default): ? bind params, INSTR() for contains
 *   - 'postgres': $1,$2 bind params, ILIKE for contains
 */
import type { FilterOperator, SchemaField, SortDirection } from '@edge-base/shared';
import { EdgeBaseError } from '@edge-base/shared';
import type {
  SearchRelatedCursor,
  SearchRelatedOrder,
  SearchRelatedRelation,
  SearchRelatedWhere,
} from './related-search-constraint.js';
import { generateFTS5DDL, generateFTS5Triggers } from './schema.js';

// ─── Types ───

export type SqlDialect = 'sqlite' | 'postgres';

export type FilterTuple = [string, FilterOperator, unknown];

export interface SortOption {
  field: string;
  direction: SortDirection;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  after?: string;  // cursor (UUID v7 id)
  before?: string;
  page?: number;
  perPage?: number;
}

export interface QueryOptions {
  filters?: FilterTuple[];
  orFilters?: FilterTuple[]; // OR group — conditions joined with OR
  sort?: SortOption[];
  pagination?: PaginationOptions;
  fields?: string[];
  search?: string; // FTS5 search term
  /** Request metadata consumed by list/search handlers, not SQL builders. */
  includeTotal?: boolean;
  maxResponseBytes?: number;
  responseAfter?: string;
  responseBefore?: string;
}

export interface QueryResult {
  sql: string;
  params: unknown[];
  countSql?: string;
  countParams?: unknown[];
}

/** PostgreSQL shadow corpus maintained for configured substring search. */
export const POSTGRES_FTS_TEXT_COLUMN = '_fts_text';

const SQLITE_TRIGRAM_MIN_CODE_POINTS = 3;
const POSTGRES_LITERAL_LIKE_ESCAPE = ` ESCAPE E'\\\\'`;

function escapePostgresLikeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function buildPostgresLiteralContains(column: string, placeholder: string): string {
  return `${column} ILIKE '%' || ${placeholder} || '%'${POSTGRES_LITERAL_LIKE_ESCAPE}`;
}

type SQLiteFtsArtifactType = 'table' | 'trigger';

function sqliteFtsArtifactContract(tableName: string): Array<{
  name: string;
  type: SQLiteFtsArtifactType;
  owner: string;
}> {
  return [
    { name: `${tableName}_fts`, type: 'table', owner: `${tableName}_fts` },
    { name: `${tableName}_ai`, type: 'trigger', owner: tableName },
    { name: `${tableName}_ad`, type: 'trigger', owner: tableName },
    { name: `${tableName}_au`, type: 'trigger', owner: tableName },
  ];
}

/**
 * Build an exact-name, eight-row-bounded FTS artifact health query.
 *
 * SQLite permits a trigger name to overlap a table/index/view name. Reading up
 * to two rows per reserved name is therefore required to detect a collision
 * instead of accidentally trusting whichever four rows the catalog returns.
 */
export function buildSqliteFtsArtifactQuery(tableName: string): {
  sql: string;
  params: string[];
} {
  const artifacts = sqliteFtsArtifactContract(tableName);
  return {
    sql: 'SELECT "type", "name", "tbl_name" AS "tableName", "sql" '
      + 'FROM "sqlite_master" WHERE "name" IN (?, ?, ?, ?) LIMIT 8',
    params: artifacts.map(({ name }) => name),
  };
}

function normalizeSqliteSchemaSql(sql: string): string {
  return sql
    .replace(/\bIF\s+NOT\s+EXISTS\b/gi, '')
    .replace(/;\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function expectedSqliteFtsArtifacts(
  tableName: string,
  fields: readonly string[],
): Map<string, string> {
  const ddls = [
    generateFTS5DDL(tableName, [...fields]),
    ...generateFTS5Triggers(tableName, [...fields]),
  ];
  return new Map(sqliteFtsArtifactContract(tableName).map((artifact, index) => [
    artifact.name,
    normalizeSqliteSchemaSql(ddls[index]!),
  ]));
}

export interface SQLiteFtsArtifactInspection {
  /** Every configured artifact exists with the desired definition. */
  healthy: boolean;
  /** Every present reserved-name object is provably generated for this table. */
  rebuildSafe: boolean;
}

/**
 * Distinguish a repairable managed definition from a reserved-name collision.
 * Field drift is repairable when the current FTS table and triggers all match
 * the generator for the physically observed field list. A wrong owner, wrong
 * kind, duplicate name, or modified/no-op body fails closed before any DROP.
 */
export function inspectSqliteFtsArtifacts(
  tableName: string,
  desiredFields: readonly string[],
  actualFields: readonly string[] | null,
  rows: Array<Record<string, unknown>>,
): SQLiteFtsArtifactInspection {
  const contract = sqliteFtsArtifactContract(tableName);
  const rowsByName = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const name = String(row.name ?? '');
    const matchingRows = rowsByName.get(name) ?? [];
    matchingRows.push(row);
    rowsByName.set(name, matchingRows);
  }

  const ftsTablePresent = (rowsByName.get(`${tableName}_fts`)?.length ?? 0) > 0;
  if (ftsTablePresent && actualFields === null) {
    return { healthy: false, rebuildSafe: false };
  }

  const ownershipFields = ftsTablePresent ? actualFields! : desiredFields;
  const ownershipSql = expectedSqliteFtsArtifacts(tableName, ownershipFields);
  const desiredSql = expectedSqliteFtsArtifacts(tableName, desiredFields);
  let rebuildSafe = true;
  let healthy = true;

  for (const artifact of contract) {
    const matchingRows = rowsByName.get(artifact.name) ?? [];
    if (matchingRows.length !== 1) {
      healthy = false;
      if (matchingRows.length > 1) rebuildSafe = false;
      continue;
    }

    const row = matchingRows[0]!;
    const owner = String(row.tableName ?? row.tbl_name ?? '');
    const sql = typeof row.sql === 'string' ? normalizeSqliteSchemaSql(row.sql) : '';
    const hasManagedShape = String(row.type ?? '') === artifact.type
      && owner === artifact.owner
      && sql === ownershipSql.get(artifact.name);
    if (!hasManagedShape) rebuildSafe = false;

    const hasDesiredShape = String(row.type ?? '') === artifact.type
      && owner === artifact.owner
      && sql === desiredSql.get(artifact.name);
    if (!hasDesiredShape) healthy = false;
  }

  if (
    actualFields !== null
    && (actualFields.length !== desiredFields.length
      || actualFields.some((field, index) => field !== desiredFields[index]))
  ) {
    healthy = false;
  }

  return { healthy, rebuildSafe };
}

/** Validate exact ownership and generated SQL so a corrupt trigger is never trusted. */
export function sqliteFtsArtifactsAreHealthy(
  tableName: string,
  ftsFields: readonly string[],
  rows: Array<Record<string, unknown>>,
): boolean {
  return inspectSqliteFtsArtifacts(tableName, ftsFields, ftsFields, rows).healthy;
}

/**
 * SQLite stores schema-declared booleans as INTEGER 0/1. Keep the public
 * filter contract boolean-shaped while translating only those authoritative
 * schema fields before any SQLite SQL builder consumes the options.
 *
 * PostgreSQL callers must not use this helper because PostgreSQL columns and
 * bind parameters remain native booleans. Schemaless/unknown fields and
 * already numeric values are deliberately left unchanged.
 */
export function normalizeSQLiteBooleanQueryOptions(
  options: QueryOptions,
  schema?: Record<string, SchemaField | false>,
): QueryOptions {
  if (!schema) return options;

  const normalizeTuple = (tuple: FilterTuple): FilterTuple => {
    const [field, operator, value] = tuple;
    const fieldSchema = schema[field];
    if (fieldSchema === undefined || fieldSchema === false || fieldSchema.type !== 'boolean') {
      return tuple;
    }

    if (typeof value === 'boolean') {
      return [field, operator, value ? 1 : 0];
    }

    if (Array.isArray(value)) {
      let changed = false;
      const normalized = value.map((entry) => {
        if (typeof entry !== 'boolean') return entry;
        changed = true;
        return entry ? 1 : 0;
      });
      return changed ? [field, operator, normalized] : tuple;
    }

    return tuple;
  };

  const filters = options.filters?.map(normalizeTuple);
  const orFilters = options.orFilters?.map(normalizeTuple);
  const changed = filters?.some((tuple, index) => tuple !== options.filters?.[index])
    || orFilters?.some((tuple, index) => tuple !== options.orFilters?.[index]);

  if (!changed) return options;
  return { ...options, filters, orFilters };
}

// ─── Bind Parameter Tracker ───

/**
 * Tracks bind parameter index for PostgreSQL ($1, $2, ...) vs SQLite (?).
 */
class BindTracker {
  private idx = 0;
  constructor(private dialect: SqlDialect) {}

  /** Returns the next placeholder: '?' for sqlite, '$N' for postgres */
  next(): string {
    this.idx++;
    return this.dialect === 'postgres' ? `$${this.idx}` : '?';
  }

  /** Returns N placeholders for IN clauses */
  nextN(count: number): string[] {
    return Array.from({ length: count }, () => this.next());
  }
}

type RelatedWhereCompilation = {
  sql: string;
  params: unknown[];
};

export type SearchRelatedKeyset = {
  order: SearchRelatedOrder;
  after?: SearchRelatedCursor;
};

function qualified(alias: string, field: string): string {
  return `${esc(alias)}.${esc(field)}`;
}

function compileSearchRelatedKeyset(
  tableName: string,
  keyset: SearchRelatedKeyset | undefined,
  bt: BindTracker,
): RelatedWhereCompilation | null {
  if (!keyset?.after) return null;

  const { order } = keyset;
  const values = keyset.after.values;
  if (order.length !== values.length || (order.length !== 1 && order.length !== 2)) {
    throw new EdgeBaseError(400, 'Related-search cursor must align exactly with its order.');
  }

  if (order.length === 1) {
    return {
      sql: `${qualified(tableName, order[0].field)} > ${bt.next()}`,
      params: [values[0]],
    };
  }

  const firstColumn = qualified(tableName, order[0].field);
  const idColumn = qualified(tableName, order[1].field);
  return {
    sql: `(${firstColumn} > ${bt.next()} OR (${firstColumn} = ${bt.next()} AND ${idColumn} > ${bt.next()}))`,
    params: [values[0], values[0], values[1]],
  };
}

function compileRelatedWhereAll(
  alias: string,
  whereAll: readonly SearchRelatedWhere[],
  bt: BindTracker,
  dialect: SqlDialect,
): RelatedWhereCompilation {
  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const where of whereAll) {
    const [field, operator] = where;
    const column = qualified(alias, field);
    if (operator === 'is-not-true') {
      conditions.push(dialect === 'postgres'
        ? `${column} IS NOT TRUE`
        : `${column} IS NOT 1`);
      continue;
    }

    const value = where[2];
    if (operator === '==') {
      conditions.push(`${column} = ${bt.next()}`);
      params.push(value);
      continue;
    }

    const values = value as unknown[];
    conditions.push(`${column} IN (${bt.nextN(values.length).join(', ')})`);
    params.push(...values);
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : '1 = 1',
    params,
  };
}

/**
 * Compile the trusted server-only relation constraint used by indexed search.
 *
 * The correlated EXISTS deliberately sits in the main WHERE clause so target,
 * ancestry, and grant authority are resolved before ORDER BY / LIMIT. The
 * recursive CTE follows only rows in the configured related table; a missing
 * parent terminates normally, while a resolvable foreign parent, cycle, or
 * depth overflow invalidates the entire chain before any grant can authorize
 * the source row.
 */
function compileRelatedSearchConstraint(
  sourceTable: string,
  relation: SearchRelatedRelation,
  bt: BindTracker,
  dialect: SqlDialect,
): RelatedWhereCompilation {
  const params: unknown[] = [];
  const targetAlias = '__edgebase_related_target';
  const targetWhere = compileRelatedWhereAll(targetAlias, relation.whereAll, bt, dialect);
  params.push(...targetWhere.params);
  const targetJoin = `${qualified(targetAlias, 'id')} = ${qualified(sourceTable, relation.localField)}`;

  if (!relation.ancestry) {
    return {
      sql: `EXISTS (SELECT 1 FROM ${esc(relation.table)} AS ${esc(targetAlias)} WHERE ${targetJoin} AND (${targetWhere.sql}))`,
      params,
    };
  }

  const ancestry = relation.ancestry;
  const ancestryAlias = '__edgebase_anc';
  const parentAlias = '__edgebase_parent';
  const chainAlias = '__edgebase_chain_row';
  const currentAlias = '__edgebase_current';
  const nextAlias = '__edgebase_next';
  const grantAlias = '__edgebase_grant';
  const stopAnchor = bt.next();
  params.push(ancestry.stopParentType);
  const depthAnchor = bt.next();
  params.push(ancestry.maxDepth);
  const ancestryWhere = compileRelatedWhereAll(chainAlias, ancestry.whereAll, bt, dialect);
  params.push(...ancestryWhere.params);
  const stopOverflow = bt.next();
  params.push(ancestry.stopParentType);
  const depthOverflow = bt.next();
  params.push(ancestry.maxDepth);

  const authorityClauses: string[] = [];
  if (ancestry.requiredAncestorIds) {
    const requiredIdsAnchor = bt.next();
    params.push(
      dialect === 'postgres'
        ? ancestry.requiredAncestorIds
        : JSON.stringify(ancestry.requiredAncestorIds),
    );
    authorityClauses.push(
      dialect === 'postgres'
        ? `EXISTS (SELECT 1 FROM ${esc(ancestryAlias)}`
          + ` WHERE CAST(${qualified(ancestryAlias, 'id')} AS TEXT) = ANY(${requiredIdsAnchor}::text[]))`
        : `EXISTS (SELECT 1 FROM ${esc(ancestryAlias)}`
          + ` WHERE CAST(${qualified(ancestryAlias, 'id')} AS TEXT)`
          + ` IN (SELECT CAST(value AS TEXT) FROM json_each(${requiredIdsAnchor})))`,
    );
  }

  if (ancestry.grantSource) {
    const grantWhere = compileRelatedWhereAll(
      grantAlias,
      ancestry.grantSource.whereAll,
      bt,
      dialect,
    );
    params.push(...grantWhere.params);

    const principalBranches: string[] = [];
    for (let branchIndex = 0; branchIndex < ancestry.grantSource.principalAny.length; branchIndex++) {
      const branch = ancestry.grantSource.principalAny[branchIndex]!;
      const branchWhere = compileRelatedWhereAll(grantAlias, branch.whereAll, bt, dialect);
      params.push(...branchWhere.params);
      const branchParts = [`(${branchWhere.sql})`];
      if (branch.groupMembership) {
        const membershipAlias = `__edgebase_membership_${branchIndex}`;
        const membershipWhere = compileRelatedWhereAll(
          membershipAlias,
          branch.groupMembership.whereAll,
          bt,
          dialect,
        );
        params.push(...membershipWhere.params);
        branchParts.push(
          `EXISTS (SELECT 1 FROM ${esc(branch.groupMembership.table)} AS ${esc(membershipAlias)}`
          + ` WHERE ${qualified(membershipAlias, branch.groupMembership.membershipGroupField)}`
          + ` = ${qualified(grantAlias, branch.groupMembership.grantPrincipalField)}`
          + ` AND (${membershipWhere.sql}))`,
        );
      }
      principalBranches.push(`(${branchParts.join(' AND ')})`);
    }
    authorityClauses.push(
      `EXISTS (
    SELECT 1 FROM ${esc(ancestry.grantSource.table)} AS ${esc(grantAlias)}
    JOIN ${esc(ancestryAlias)} ON ${qualified(grantAlias, ancestry.grantSource.ancestorField)} = ${qualified(ancestryAlias, 'id')}
    WHERE (${grantWhere.sql})
      AND (${principalBranches.join(' OR ')})
  )`,
    );
  }
  if (authorityClauses.length === 0) {
    throw new Error('Related search ancestry requires at least one authority constraint.');
  }
  const authoritySql = authorityClauses.map((clause) => `  AND ${clause}`).join('\n');

  const initialPath = dialect === 'postgres'
    ? `ARRAY[CAST(${qualified(targetAlias, 'id')} AS TEXT)]`
    : `json_array(CAST(${qualified(targetAlias, 'id')} AS TEXT))`;
  const extendedPath = dialect === 'postgres'
    ? `${qualified(ancestryAlias, 'path')} || CAST(${qualified(parentAlias, 'id')} AS TEXT)`
    : `json_insert(${qualified(ancestryAlias, 'path')}, '$[#]', CAST(${qualified(parentAlias, 'id')} AS TEXT))`;
  const parentAlreadyVisited = dialect === 'postgres'
    ? `CAST(${qualified(parentAlias, 'id')} AS TEXT) = ANY(${qualified(ancestryAlias, 'path')})`
    : `EXISTS (SELECT 1 FROM json_each(${qualified(ancestryAlias, 'path')})`
      + ` WHERE CAST(value AS TEXT) = CAST(${qualified(parentAlias, 'id')} AS TEXT))`;
  const nextAlreadyVisited = dialect === 'postgres'
    ? `CAST(${qualified(nextAlias, 'id')} AS TEXT) = ANY(${qualified(currentAlias, 'path')})`
    : `EXISTS (SELECT 1 FROM json_each(${qualified(currentAlias, 'path')})`
      + ` WHERE CAST(value AS TEXT) = CAST(${qualified(nextAlias, 'id')} AS TEXT))`;

  const sql = `EXISTS (
WITH RECURSIVE ${esc(ancestryAlias)} (${esc('id')}, ${esc('parent_id')}, ${esc('parent_type')}, ${esc('depth')}, ${esc('path')}) AS (
  SELECT ${qualified(targetAlias, 'id')}, ${qualified(targetAlias, ancestry.parentField)}, ${qualified(targetAlias, ancestry.parentTypeField)}, 0, ${initialPath}
  FROM ${esc(relation.table)} AS ${esc(targetAlias)}
  WHERE ${targetJoin} AND (${targetWhere.sql})
  UNION ALL
  SELECT ${qualified(parentAlias, 'id')}, ${qualified(parentAlias, ancestry.parentField)}, ${qualified(parentAlias, ancestry.parentTypeField)}, ${qualified(ancestryAlias, 'depth')} + 1, ${extendedPath}
  FROM ${esc(relation.table)} AS ${esc(parentAlias)}
  JOIN ${esc(ancestryAlias)} ON ${qualified(parentAlias, 'id')} = ${qualified(ancestryAlias, 'parent_id')}
  WHERE ${qualified(ancestryAlias, 'parent_id')} IS NOT NULL
    AND CAST(${qualified(ancestryAlias, 'parent_id')} AS TEXT) <> ''
    AND ${qualified(ancestryAlias, 'parent_type')} <> ${stopAnchor}
    AND ${qualified(ancestryAlias, 'depth')} < ${depthAnchor}
    AND NOT (${parentAlreadyVisited})
)
SELECT 1
WHERE EXISTS (SELECT 1 FROM ${esc(ancestryAlias)})
  AND NOT EXISTS (
    SELECT 1 FROM ${esc(ancestryAlias)}
    JOIN ${esc(relation.table)} AS ${esc(chainAlias)}
      ON ${qualified(chainAlias, 'id')} = ${qualified(ancestryAlias, 'id')}
    WHERE NOT (${ancestryWhere.sql})
  )
  AND NOT EXISTS (
    SELECT 1 FROM ${esc(ancestryAlias)} AS ${esc(currentAlias)}
    JOIN ${esc(relation.table)} AS ${esc(nextAlias)}
      ON ${qualified(nextAlias, 'id')} = ${qualified(currentAlias, 'parent_id')}
    WHERE ${qualified(currentAlias, 'parent_id')} IS NOT NULL
      AND CAST(${qualified(currentAlias, 'parent_id')} AS TEXT) <> ''
      AND ${qualified(currentAlias, 'parent_type')} <> ${stopOverflow}
      AND (${qualified(currentAlias, 'depth')} >= ${depthOverflow} OR ${nextAlreadyVisited})
  )
${authoritySql}
)`;

  return { sql, params };
}

// ─── Query Builder ───

/**
 * Build a SELECT query from query options.
 */
export function buildListQuery(
  tableName: string,
  options: QueryOptions,
  dialect: SqlDialect = 'sqlite',
): QueryResult {
  const params: unknown[] = [];
  const bt = new BindTracker(dialect);

  // ── FTS5 search integration (SQLite) ──
  // When options.search is provided, JOIN with the FTS5 table for full-text filtering.
  const hasSearch = !!options.search;
  const ftsTable = `${tableName}_fts`;

  // SELECT clause
  const selectFields = options.fields?.length
    ? options.fields.map(f => `${esc(tableName)}.${esc(f)}`).join(', ')
    : `${esc(tableName)}.*`;

  let sql: string;
  if (hasSearch && dialect === 'sqlite') {
    const escapedTerm = `"${options.search!.replace(/"/g, '""')}"`;
    sql = `SELECT ${selectFields} FROM ${esc(ftsTable)} JOIN ${esc(tableName)} ON ${esc(tableName)}.rowid = ${esc(ftsTable)}.rowid WHERE ${esc(ftsTable)} MATCH ${bt.next()}`;
    params.push(escapedTerm);
  } else if (hasSearch && dialect === 'postgres') {
    // PostgreSQL: ILIKE-based search across all text columns
    sql = `SELECT ${selectFields} FROM ${esc(tableName)}`;
    // We'll add the ILIKE condition as a WHERE clause below
  } else {
    sql = `SELECT ${selectFields} FROM ${esc(tableName)}`;
  }

  // WHERE clause (filters + cursor pagination)
  const sqliteSearchQualifier = hasSearch && dialect === 'sqlite' ? tableName : undefined;
  const { whereClause, whereParams } = buildWhereClause(
    options.filters,
    options.pagination,
    options.orFilters,
    bt,
    dialect,
    sqliteSearchQualifier,
  );
  if (whereClause) {
    sql += hasSearch && dialect === 'sqlite' ? ` AND (${whereClause})` : ` WHERE ${whereClause}`;
    params.push(...whereParams);
  }

  // PostgreSQL search: add ILIKE conditions
  if (hasSearch && dialect === 'postgres') {
    const ilikeCondition = buildPostgresRowSearchCondition(tableName, bt);
    sql += whereClause ? ` AND ${ilikeCondition}` : ` WHERE ${ilikeCondition}`;
    params.push(escapePostgresLikeLiteral(options.search!));
  }

  // ORDER BY clause — FTS5 search defaults to rank ordering when no explicit sort
  const orderBy = buildOrderByClause(options.sort, options.pagination, sqliteSearchQualifier);
  if (orderBy) {
    sql += ` ORDER BY ${orderBy}`;
  } else if (hasSearch && dialect === 'sqlite') {
    sql += ` ORDER BY ${esc(ftsTable)}.rank`;
  }

  // LIMIT / OFFSET
  const { limitClause, limitParams } = buildLimitClause(options.pagination, bt);
  if (limitClause) {
    sql += ` ${limitClause}`;
    params.push(...limitParams);
  }

  // COUNT query (for offset pagination)
  let countSql: string | undefined;
  let countParams: unknown[] | undefined;
  if (!options.pagination?.after && !options.pagination?.before) {
    const countBt = new BindTracker(dialect);
    const { whereClause: cw, whereParams: cp } = buildWhereClause(
      options.filters,
      undefined,
      options.orFilters,
      countBt,
      dialect,
      sqliteSearchQualifier,
    );

    if (hasSearch && dialect === 'sqlite') {
      const escapedTerm = `"${options.search!.replace(/"/g, '""')}"`;
      countSql = `SELECT COUNT(*) as total FROM ${esc(ftsTable)} JOIN ${esc(tableName)} ON ${esc(tableName)}.rowid = ${esc(ftsTable)}.rowid WHERE ${esc(ftsTable)} MATCH ${countBt.next()}`;
      countParams = [escapedTerm];
      if (cw) {
        countSql += ` AND (${cw})`;
        countParams.push(...cp);
      }
    } else {
      countSql = `SELECT COUNT(*) as total FROM ${esc(tableName)}`;
      countParams = [];
      if (cw) {
        countSql += ` WHERE ${cw}`;
        countParams = cp;
      }
      if (hasSearch && dialect === 'postgres') {
        const ilikeCondition = buildPostgresRowSearchCondition(tableName, countBt);
        countSql += cw ? ` AND ${ilikeCondition}` : ` WHERE ${ilikeCondition}`;
        countParams.push(escapePostgresLikeLiteral(options.search!));
      }
    }
  }

  return { sql, params, countSql, countParams };
}

/**
 * Build a COUNT query for a table.
 */
export function buildCountQuery(
  tableName: string,
  filters?: FilterTuple[],
  orFilters?: FilterTuple[],
  dialect: SqlDialect = 'sqlite',
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const bt = new BindTracker(dialect);
  let sql = `SELECT COUNT(*) as total FROM ${esc(tableName)}`;

  const { whereClause, whereParams } = buildWhereClause(filters, undefined, orFilters, bt, dialect);
  if (whereClause) {
    sql += ` WHERE ${whereClause}`;
    params.push(...whereParams);
  }

  return { sql, params };
}

/**
 * Build a single-record GET query.
 */
export function buildGetQuery(
  tableName: string,
  id: string,
  fields?: string[],
  dialect: SqlDialect = 'sqlite',
): { sql: string; params: unknown[] } {
  const selectFields = fields?.length
    ? fields.map(esc).join(', ')
    : '*';

  const placeholder = dialect === 'postgres' ? '$1' : '?';
  return {
    sql: `SELECT ${selectFields} FROM ${esc(tableName)} WHERE "id" = ${placeholder}`,
    params: [id],
  };
}

/**
 * Build a FTS5 search query with highlight support.
 * For PostgreSQL dialect, uses ILIKE across specified fields (no FTS5).
 */
export function buildSearchQuery(
  tableName: string,
  searchTerm: string,
  options?: {
    pagination?: PaginationOptions;
    filters?: FilterTuple[];
    orFilters?: FilterTuple[];
    sort?: SortOption[];
    limit?: number;
    offset?: number;
    ftsFields?: string[];  // FTS field names for highlight (SQLite) / search columns (Postgres)
    highlightPre?: string;
    highlightPost?: string;
    relatedSearch?: SearchRelatedRelation;
    queryVariants?: string[];
    searchRelatedKeyset?: SearchRelatedKeyset;
  },
  dialect: SqlDialect = 'sqlite',
): QueryResult {
  const pagination: PaginationOptions | undefined = options?.pagination || options?.limit !== undefined || options?.offset !== undefined
    ? {
      ...options?.pagination,
      limit: options?.pagination?.limit ?? options?.limit,
      offset: options?.pagination?.offset ?? options?.offset,
    }
    : options?.pagination;
  const searchTerms = [...new Set([searchTerm, ...(options?.queryVariants ?? [])])];

  // PostgreSQL: configured FTS fields are materialized into one pg_trgm-backed
  // corpus. An absent field list is the legacy id-only fallback; provider
  // handlers use buildSubstringSearchQuery() for unconfigured table search.
  if (dialect === 'postgres') {
    const bt = new BindTracker('postgres');
    const usesIndexedCorpus = !!options?.ftsFields?.length;
    const params: unknown[] = [];
    const literalSearchTerms = searchTerms.map(escapePostgresLikeLiteral);
    const searchConditions = literalSearchTerms.map((literalSearchTerm) => {
      params.push(literalSearchTerm);
      return usesIndexedCorpus
        ? buildPostgresLiteralContains(esc(POSTGRES_FTS_TEXT_COLUMN), bt.next())
        : buildPostgresLiteralContains(`${esc('id')}::text`, bt.next());
    });
    const { whereClause, whereParams } = buildWhereClause(
      options?.filters,
      pagination,
      options?.orFilters,
      bt,
      dialect,
    );
    const whereParts = [`(${searchConditions.join(' OR ')})`];
    if (whereClause) {
      whereParts.push(`(${whereClause})`);
      params.push(...whereParams);
    }
    const keyset = compileSearchRelatedKeyset(tableName, options?.searchRelatedKeyset, bt);
    if (keyset) {
      whereParts.push(`(${keyset.sql})`);
      params.push(...keyset.params);
    }
    if (options?.relatedSearch) {
      const related = compileRelatedSearchConstraint(tableName, options.relatedSearch, bt, dialect);
      whereParts.push(`(${related.sql})`);
      params.push(...related.params);
    }
    const orderBy = buildOrderByClause(options?.sort, pagination);
    const { limitClause, limitParams } = buildLimitClause(
      pagination,
      bt,
      !!options?.searchRelatedKeyset,
      options?.searchRelatedKeyset ? 1_001 : 1_000,
    );
    params.push(...limitParams);

    const countBt = new BindTracker('postgres');
    const countParams: unknown[] = [];
    const countSearchConditions = literalSearchTerms.map((literalSearchTerm) => {
      countParams.push(literalSearchTerm);
      return usesIndexedCorpus
        ? buildPostgresLiteralContains(esc(POSTGRES_FTS_TEXT_COLUMN), countBt.next())
        : buildPostgresLiteralContains(`${esc('id')}::text`, countBt.next());
    });
    const { whereClause: countWhere, whereParams: countWhereParams } = buildWhereClause(
      options?.filters,
      undefined,
      options?.orFilters,
      countBt,
      dialect,
    );
    const countWhereParts = [`(${countSearchConditions.join(' OR ')})`];
    if (countWhere) {
      countWhereParts.push(`(${countWhere})`);
      countParams.push(...countWhereParams);
    }
    if (options?.relatedSearch) {
      const related = compileRelatedSearchConstraint(tableName, options.relatedSearch, countBt, dialect);
      countWhereParts.push(`(${related.sql})`);
      countParams.push(...related.params);
    }

    return {
      sql: `SELECT * FROM ${esc(tableName)} WHERE ${whereParts.join(' AND ')} ORDER BY ${orderBy} ${limitClause}`,
      params,
      countSql: `SELECT COUNT(*) as total FROM ${esc(tableName)} WHERE ${countWhereParts.join(' AND ')}`,
      countParams,
    };
  }

  // SQLite: FTS5 with highlight support
  const ftsTable = `${tableName}_fts`;
  const bt = new BindTracker('sqlite');
  const params: unknown[] = [];

  // Build highlight SELECT columns
  const highlightPre = options?.highlightPre ?? '<mark>';
  const highlightPost = options?.highlightPost ?? '</mark>';
  const highlightColumns: string[] = [];

  if (options?.ftsFields?.length) {
    for (let i = 0; i < options.ftsFields.length; i++) {
      const fieldName = options.ftsFields[i];
      highlightColumns.push(
        `highlight(${esc(ftsTable)}, ${i}, '${highlightPre.replace(/'/g, "''")}', '${highlightPost.replace(/'/g, "''")}') as "${fieldName}_highlighted"`,
      );
    }
  }

  const selectCols = [
    `${esc(tableName)}.*`,
    `${esc(ftsTable)}.rank`,
    ...highlightColumns,
  ].join(', ');

  const escapedTerms = searchTerms.map(buildSqliteFtsMatch);
  const combinedFtsMatch = escapedTerms.length === 1
    ? escapedTerms[0]!
    : escapedTerms.map((term) => `(${term})`).join(' OR ');
  params.push(combinedFtsMatch);
  const { whereClause, whereParams } = buildWhereClause(
    options?.filters,
    pagination,
    options?.orFilters,
    bt,
    dialect,
    tableName,
  );
  params.push(...whereParams);
  const keyset = compileSearchRelatedKeyset(tableName, options?.searchRelatedKeyset, bt);
  if (keyset) params.push(...keyset.params);
  const relatedWhere = options?.relatedSearch
    ? compileRelatedSearchConstraint(tableName, options.relatedSearch, bt, dialect)
    : null;
  if (relatedWhere) params.push(...relatedWhere.params);
  const orderBy = options?.sort?.length
    ? buildOrderByClause(options.sort, pagination, tableName)
    : `${esc(ftsTable)}.rank, ${qualified(tableName, 'id')} ASC`;
  const { limitClause, limitParams } = buildLimitClause(
    pagination,
    bt,
    !!options?.searchRelatedKeyset,
    options?.searchRelatedKeyset ? 1_001 : 1_000,
  );
  params.push(...limitParams);

  const countBt = new BindTracker('sqlite');
  const countParams: unknown[] = [combinedFtsMatch];
  const { whereClause: countWhere, whereParams: countWhereParams } = buildWhereClause(
    options?.filters,
    undefined,
    options?.orFilters,
    countBt,
    dialect,
    tableName,
  );
  countParams.push(...countWhereParams);
  const countRelatedWhere = options?.relatedSearch
    ? compileRelatedSearchConstraint(tableName, options.relatedSearch, countBt, dialect)
    : null;
  if (countRelatedWhere) countParams.push(...countRelatedWhere.params);

  return {
    sql: `SELECT ${selectCols}
FROM ${esc(ftsTable)}
JOIN ${esc(tableName)} ON ${esc(tableName)}.rowid = ${esc(ftsTable)}.rowid
WHERE ${esc(ftsTable)} MATCH ?
${whereClause ? `AND (${whereClause})` : ''}
${keyset ? `AND (${keyset.sql})` : ''}
${relatedWhere ? `AND (${relatedWhere.sql})` : ''}
ORDER BY ${orderBy}
${limitClause}`,
    params,
    countSql: `SELECT COUNT(*) as total
FROM ${esc(ftsTable)}
JOIN ${esc(tableName)} ON ${esc(tableName)}.rowid = ${esc(ftsTable)}.rowid
WHERE ${esc(ftsTable)} MATCH ?
${countWhere ? `AND (${countWhere})` : ''}
${countRelatedWhere ? `AND (${countRelatedWhere.sql})` : ''}`,
    countParams,
  };
}

export function buildSubstringSearchQuery(
  tableName: string,
  searchTerm: string,
  options?: {
    pagination?: PaginationOptions;
    filters?: FilterTuple[];
    orFilters?: FilterTuple[];
    sort?: SortOption[];
    limit?: number;
    offset?: number;
    fields?: string[];
    relatedSearch?: SearchRelatedRelation;
    queryVariants?: string[];
    searchRelatedKeyset?: SearchRelatedKeyset;
  },
  dialect: SqlDialect = 'sqlite',
): QueryResult {
  const pagination: PaginationOptions | undefined = options?.pagination || options?.limit !== undefined || options?.offset !== undefined
    ? {
      ...options?.pagination,
      limit: options?.pagination?.limit ?? options?.limit,
      offset: options?.pagination?.offset ?? options?.offset,
    }
    : options?.pagination;
  const fields = options?.fields?.length ? options.fields : ['id'];
  const searchTerms = [...new Set([searchTerm, ...(options?.queryVariants ?? [])])];

  if (dialect === 'postgres') {
    const bt = new BindTracker('postgres');
    const params: unknown[] = [];
    const literalSearchTerms = searchTerms.map(escapePostgresLikeLiteral);
    const searchConditions = fields.flatMap((field) => literalSearchTerms.map((term) => {
      params.push(term);
      return buildPostgresLiteralContains(`${esc(field)}::text`, bt.next());
    }));
    const { whereClause, whereParams } = buildWhereClause(
      options?.filters,
      pagination,
      options?.orFilters,
      bt,
      dialect,
    );
    const whereParts = [`(${searchConditions.join(' OR ')})`];
    if (whereClause) {
      whereParts.push(`(${whereClause})`);
      params.push(...whereParams);
    }
    const keyset = compileSearchRelatedKeyset(tableName, options?.searchRelatedKeyset, bt);
    if (keyset) {
      whereParts.push(`(${keyset.sql})`);
      params.push(...keyset.params);
    }
    if (options?.relatedSearch) {
      const related = compileRelatedSearchConstraint(tableName, options.relatedSearch, bt, dialect);
      whereParts.push(`(${related.sql})`);
      params.push(...related.params);
    }
    const orderBy = buildOrderByClause(options?.sort, pagination);
    const { limitClause, limitParams } = buildLimitClause(
      pagination,
      bt,
      !!options?.searchRelatedKeyset,
      options?.searchRelatedKeyset ? 1_001 : 1_000,
    );
    params.push(...limitParams);

    const countBt = new BindTracker('postgres');
    const countParams: unknown[] = [];
    const countSearchConditions = fields.flatMap((field) => literalSearchTerms.map((term) => {
      countParams.push(term);
      return buildPostgresLiteralContains(`${esc(field)}::text`, countBt.next());
    }));
    const { whereClause: countWhere, whereParams: countWhereParams } = buildWhereClause(
      options?.filters,
      undefined,
      options?.orFilters,
      countBt,
      dialect,
    );
    const countWhereParts = [`(${countSearchConditions.join(' OR ')})`];
    if (countWhere) {
      countWhereParts.push(`(${countWhere})`);
      countParams.push(...countWhereParams);
    }
    if (options?.relatedSearch) {
      const related = compileRelatedSearchConstraint(tableName, options.relatedSearch, countBt, dialect);
      countWhereParts.push(`(${related.sql})`);
      countParams.push(...related.params);
    }

    return {
      sql: `SELECT * FROM ${esc(tableName)} WHERE ${whereParts.join(' AND ')} ORDER BY ${orderBy} ${limitClause}`,
      params,
      countSql: `SELECT COUNT(*) as total FROM ${esc(tableName)} WHERE ${countWhereParts.join(' AND ')}`,
      countParams,
    };
  }

  const bt = new BindTracker('sqlite');
  const params: unknown[] = [];
  const conditions = fields.flatMap((field) => searchTerms.map((term) => {
    params.push(term);
    return `instr(lower(CAST(${esc(field)} AS TEXT)), lower(${bt.next()})) > 0`;
  }));
  const { whereClause, whereParams } = buildWhereClause(
    options?.filters,
    pagination,
    options?.orFilters,
    bt,
    dialect,
  );
  if (whereClause) {
    params.push(...whereParams);
  }
  const keyset = compileSearchRelatedKeyset(tableName, options?.searchRelatedKeyset, bt);
  if (keyset) params.push(...keyset.params);
  const relatedWhere = options?.relatedSearch
    ? compileRelatedSearchConstraint(tableName, options.relatedSearch, bt, dialect)
    : null;
  if (relatedWhere) params.push(...relatedWhere.params);
  const orderBy = buildOrderByClause(options?.sort, pagination);
  const { limitClause, limitParams } = buildLimitClause(
    pagination,
    bt,
    !!options?.searchRelatedKeyset,
    options?.searchRelatedKeyset ? 1_001 : 1_000,
  );
  params.push(...limitParams);

  const countBt = new BindTracker('sqlite');
  const countParams: unknown[] = [];
  const countConditions = fields.flatMap((field) => searchTerms.map((term) => {
    countParams.push(term);
    return `instr(lower(CAST(${esc(field)} AS TEXT)), lower(${countBt.next()})) > 0`;
  }));
  const { whereClause: countWhere, whereParams: countWhereParams } = buildWhereClause(
    options?.filters,
    undefined,
    options?.orFilters,
    countBt,
    dialect,
  );
  if (countWhere) {
    countParams.push(...countWhereParams);
  }
  const countRelatedWhere = options?.relatedSearch
    ? compileRelatedSearchConstraint(tableName, options.relatedSearch, countBt, dialect)
    : null;
  if (countRelatedWhere) countParams.push(...countRelatedWhere.params);

  return {
    sql: `SELECT * FROM ${esc(tableName)} WHERE (${conditions.join(' OR ')})${whereClause ? ` AND (${whereClause})` : ''}${keyset ? ` AND (${keyset.sql})` : ''}${relatedWhere ? ` AND (${relatedWhere.sql})` : ''} ORDER BY ${orderBy} ${limitClause}`,
    params,
    countSql: `SELECT COUNT(*) as total FROM ${esc(tableName)} WHERE (${countConditions.join(' OR ')})${countWhere ? ` AND (${countWhere})` : ''}${countRelatedWhere ? ` AND (${countRelatedWhere.sql})` : ''}`,
    countParams,
  };
}

function sqliteFtsTerms(searchTerm: string): string[] {
  return searchTerm
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/^"+|"+$/g, '').trim())
    .filter((term) => term.length > 0);
}

/**
 * FTS5's trigram tokenizer cannot produce a match for a token shorter than
 * three Unicode code points. Callers preserve legacy substring semantics for
 * that compatibility lane instead of treating the indexed zero as terminal.
 */
export function sqliteFtsNeedsSubstringFallback(searchTerm: string): boolean {
  return sqliteFtsTerms(searchTerm).some(
    (term) => [...term].length < SQLITE_TRIGRAM_MIN_CODE_POINTS,
  );
}

function buildSqliteFtsMatch(searchTerm: string): string {
  const terms = sqliteFtsTerms(searchTerm)
    .map((term) => `"${term.replace(/"/g, '""')}"*`);

  if (terms.length === 0) {
    return '""';
  }

  return terms.join(' ');
}

function buildPostgresRowSearchCondition(
  tableName: string,
  bt: BindTracker,
): string {
  return `(${buildPostgresLiteralContains(`to_jsonb(${esc(tableName)})::text`, bt.next())})`;
}


// ─── WHERE Clause Builder ───

function buildWhereClause(
  filters?: FilterTuple[],
  pagination?: PaginationOptions,
  orFilters?: FilterTuple[],
  bt?: BindTracker,
  dialect: SqlDialect = 'sqlite',
  tableQualifier?: string,
): { whereClause: string; whereParams: unknown[] } {
  const _bt = bt ?? new BindTracker(dialect);
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Filter tuples → WHERE conditions (AND)
  if (filters?.length) {
    for (const [field, op, value] of filters) {
      const { condition, condParams } = buildFilterCondition(
        field,
        op,
        value,
        _bt,
        dialect,
        tableQualifier,
      );
      conditions.push(condition);
      params.push(...condParams);
    }
  }

  // OR filter group — conditions joined with OR
  if (orFilters?.length) {
    if (orFilters.length > 5) {
      throw new EdgeBaseError(400, 'OR_FILTER_LIMIT_EXCEEDED: maximum 5 conditions in OR group');
    }
    const orClauses: string[] = [];
    for (const [field, op, value] of orFilters) {
      const { condition, condParams } = buildFilterCondition(
        field,
        op,
        value,
        _bt,
        dialect,
        tableQualifier,
      );
      orClauses.push(condition);
      params.push(...condParams);
    }
    conditions.push(`(${orClauses.join(' OR ')})`);
  }

  // Cursor pagination → WHERE id > ? or id < ?
  const idColumn = tableQualifier ? qualified(tableQualifier, 'id') : esc('id');
  if (pagination?.after) {
    conditions.push(`${idColumn} > ${_bt.next()}`);
    params.push(pagination.after);
  }
  if (pagination?.before) {
    conditions.push(`${idColumn} < ${_bt.next()}`);
    params.push(pagination.before);
  }

  return {
    whereClause: conditions.length ? conditions.join(' AND ') : '',
    whereParams: params,
  };
}

function buildFilterCondition(
  field: string,
  op: FilterOperator,
  value: unknown,
  bt: BindTracker,
  dialect: SqlDialect = 'sqlite',
  tableQualifier?: string,
): { condition: string; condParams: unknown[] } {
  const col = tableQualifier ? qualified(tableQualifier, field) : esc(field);

  switch (op) {
    case '==':
      if (value === null) {
        return { condition: `${col} IS NULL`, condParams: [] };
      }
      return { condition: `${col} = ${bt.next()}`, condParams: [value] };
    case '!=':
      if (value === null) {
        return { condition: `${col} IS NOT NULL`, condParams: [] };
      }
      return { condition: `${col} != ${bt.next()}`, condParams: [value] };
    case '>':
      return { condition: `${col} > ${bt.next()}`, condParams: [value] };
    case '<':
      return { condition: `${col} < ${bt.next()}`, condParams: [value] };
    case '>=':
      return { condition: `${col} >= ${bt.next()}`, condParams: [value] };
    case '<=':
      return { condition: `${col} <= ${bt.next()}`, condParams: [value] };
    case 'contains':
      if (dialect === 'postgres') {
        // PostgreSQL: use ILIKE for case-insensitive substring matching
        return { condition: `${col} ILIKE '%' || ${bt.next()} || '%'`, condParams: [value] };
      }
      // SQLite: Use INSTR instead of LIKE to avoid pattern complexity limit
      return { condition: `INSTR(${col}, ${bt.next()}) > 0`, condParams: [value] };
    case 'in': {
      const arr = value as unknown[];
      if (dialect === 'sqlite') {
        return {
          condition: `${col} IN (SELECT value FROM json_each(${bt.next()}))`,
          condParams: [JSON.stringify(arr)],
        };
      }
      const placeholders = bt.nextN(arr.length).join(', ');
      return { condition: `${col} IN (${placeholders})`, condParams: arr };
    }
    case 'not in':
    case 'not-in': {
      const arr = value as unknown[];
      if (dialect === 'sqlite') {
        return {
          condition: `${col} NOT IN (SELECT value FROM json_each(${bt.next()}))`,
          condParams: [JSON.stringify(arr)],
        };
      }
      const placeholders = bt.nextN(arr.length).join(', ');
      return { condition: `${col} NOT IN (${placeholders})`, condParams: arr };
    }
    case 'contains-any': {
      const arr = value as unknown[];
      if (dialect === 'postgres') {
        // PostgreSQL: jsonb array overlap — tags ?| array['a','b']
        const placeholders = bt.nextN(arr.length).join(', ');
        return { condition: `${col}::jsonb ?| ARRAY[${placeholders}]`, condParams: arr };
      }
      // SQLite: one JSON bind keeps the complete list statement inside the
      // provider variable budget regardless of the bounded set cardinality.
      return {
        condition: `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value IN (SELECT value FROM json_each(${bt.next()})))`,
        condParams: [JSON.stringify(arr)],
      };
    }
    default:
      throw new EdgeBaseError(400, `Unsupported filter operator: ${op}`);
  }
}

// ─── ORDER BY Clause Builder ───

function buildOrderByClause(
  sort?: SortOption[],
  pagination?: PaginationOptions,
  tableQualifier?: string,
): string {
  const parts: string[] = [];
  const column = (field: string) => tableQualifier ? qualified(tableQualifier, field) : esc(field);

  if (sort?.length) {
    for (const s of sort) {
      const dir = s.direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      parts.push(`${column(s.field)} ${dir}`);
    }
  }

  // Default sort by id for cursor pagination or if no explicit sort
  if (!parts.length) {
    if (pagination?.before) {
      parts.push(`${column('id')} DESC`);
    } else {
      parts.push(`${column('id')} ASC`);
    }
  }

  // When using custom sort, add "id" as tiebreaker to ensure deterministic
  // ordering. Without this, non-unique sort keys (e.g. createdAt) produce
  // non-deterministic row order, causing offset pagination to return
  // overlapping results across pages. For cursor pagination, "id" is also
  // required because WHERE "id" > ? depends on ORDER BY ending with "id".
  if (sort?.length) {
    const hasIdSort = sort.some(s => s.field === 'id');
    if (!hasIdSort) {
      parts.push(`${column('id')} ${pagination?.before ? 'DESC' : 'ASC'}`);
    }
  }

  return parts.join(', ');
}

// ─── LIMIT Clause Builder ───

function buildLimitClause(
  pagination?: PaginationOptions,
  bt?: BindTracker,
  forceCursorMode = false,
  maximum = 1_000,
): { limitClause: string; limitParams: unknown[] } {
  const _bt = bt ?? new BindTracker('sqlite');

  if (!pagination) {
    return { limitClause: `LIMIT ${_bt.next()}`, limitParams: [100] }; // Default limit
  }

  const limit = Math.min(pagination.limit ?? pagination.perPage ?? 100, maximum);

  // Cursor-based: no offset
  if (forceCursorMode || pagination.after || pagination.before) {
    return { limitClause: `LIMIT ${_bt.next()}`, limitParams: [limit] };
  }

  // Offset-based
  const offset = pagination.offset ?? ((pagination.page ?? 1) - 1) * limit;
  return { limitClause: `LIMIT ${_bt.next()} OFFSET ${_bt.next()}`, limitParams: [limit, offset] };
}

// ─── Query Parameter Keys ───

/** All query parameter keys that parseQueryParams() handles.
 *  Used by admin proxy as whitelist — adding a key here auto-forwards it. */
export const QUERY_PARAM_KEYS = [
  'limit', 'offset', 'page', 'perPage',
  'after', 'before',
  'sort', 'filter', 'orFilter',
  'fields', 'search',
  'includeTotal',
  'maxResponseBytes', 'responseAfter', 'responseBefore',
] as const;

// ─── Parse Query Parameters ───

/**
 * Parse REST API query parameters into QueryOptions.
 */
export function parseQueryParams(params: Record<string, string>): QueryOptions {
  const options: QueryOptions = {};

  // Parse filter: JSON-encoded filter tuples
  if (params.filter) {
    try {
      options.filters = JSON.parse(params.filter) as FilterTuple[];
    } catch {
      // Invalid filter — ignore
    }
  }

  // Parse OR filter
  if (params.orFilter) {
    try {
      const orFilters = JSON.parse(params.orFilter) as FilterTuple[];
      if (orFilters.length <= 5) {
        options.orFilters = orFilters;
      }
    } catch {
      // Invalid orFilter — ignore
    }
  }

  // Parse sort: "field:asc,field2:desc"
  if (params.sort) {
    options.sort = params.sort.split(',').map(s => {
      const [field, dir] = s.split(':');
      return { field, direction: (dir as SortDirection) || 'asc' };
    });
  }

  // Parse pagination — validate numeric types to prevent SQLITE_MISMATCH
  options.pagination = {};
  if (params.limit) {
    const n = parseInt(params.limit, 10);
    if (isNaN(n)) throw new EdgeBaseError(400, 'Invalid limit parameter: must be a number');
    if (n < 0) throw new EdgeBaseError(400, 'Invalid limit parameter: must be non-negative');
    options.pagination.limit = Math.min(n, 1000);
  }
  if (params.offset) {
    const n = parseInt(params.offset, 10);
    if (isNaN(n)) throw new EdgeBaseError(400, 'Invalid offset parameter: must be a number');
    if (n < 0) throw new EdgeBaseError(400, 'Invalid offset parameter: must be non-negative');
    options.pagination.offset = n;
  }
  if (params.page) {
    const n = parseInt(params.page, 10);
    if (isNaN(n) || n < 1) throw new EdgeBaseError(400, 'Invalid page parameter: must be a positive number');
    options.pagination.page = n;
  }
  if (params.perPage) {
    const n = parseInt(params.perPage, 10);
    if (isNaN(n)) throw new EdgeBaseError(400, 'Invalid perPage parameter: must be a number');
    if (n < 0) throw new EdgeBaseError(400, 'Invalid perPage parameter: must be non-negative');
    options.pagination.perPage = n;
  }
  if (params.after) options.pagination.after = params.after;
  if (params.before) options.pagination.before = params.before;

  // Parse fields: "field1,field2"
  if (params.fields) {
    options.fields = params.fields.split(',').map(f => f.trim());
  }

  // Parse search
  if (params.search) {
    options.search = params.search;
  }

  // List/search response metadata. Providers consume these around the SQL
  // query, but keeping them parsed preserves the public query-key invariant.
  if (params.includeTotal !== undefined) {
    options.includeTotal = !['0', 'false'].includes(params.includeTotal.toLowerCase());
  }
  if (params.maxResponseBytes !== undefined) {
    const maxResponseBytes = Number(params.maxResponseBytes);
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 512) {
      throw new EdgeBaseError(400, 'Invalid maxResponseBytes parameter: must be a safe integer of at least 512');
    }
    options.maxResponseBytes = maxResponseBytes;
  }
  if (params.responseAfter) options.responseAfter = params.responseAfter;
  if (params.responseBefore) options.responseBefore = params.responseBefore;

  return options;
}

// ─── Utility ───

function esc(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
