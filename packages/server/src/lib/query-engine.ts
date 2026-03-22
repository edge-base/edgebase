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
import type { FilterOperator, SortDirection } from '@edge-base/shared';
import { EdgeBaseError } from '@edge-base/shared';

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
}

export interface QueryResult {
  sql: string;
  params: unknown[];
  countSql?: string;
  countParams?: unknown[];
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
  const { whereClause, whereParams } = buildWhereClause(options.filters, options.pagination, options.orFilters, bt, dialect);
  if (whereClause) {
    sql += hasSearch && dialect === 'sqlite' ? ` AND (${whereClause})` : ` WHERE ${whereClause}`;
    params.push(...whereParams);
  }

  // PostgreSQL search: add ILIKE conditions
  if (hasSearch && dialect === 'postgres') {
    const ilikeCondition = buildPostgresRowSearchCondition(tableName, bt);
    sql += whereClause ? ` AND ${ilikeCondition}` : ` WHERE ${ilikeCondition}`;
    params.push(options.search!);
  }

  // ORDER BY clause — FTS5 search defaults to rank ordering when no explicit sort
  const orderBy = buildOrderByClause(options.sort, options.pagination);
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
    const { whereClause: cw, whereParams: cp } = buildWhereClause(options.filters, undefined, options.orFilters, countBt, dialect);

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
        countParams.push(options.search!);
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

  // PostgreSQL: ILIKE-based search across text columns (no FTS5)
  if (dialect === 'postgres') {
    const bt = new BindTracker('postgres');
    const searchFields = options?.ftsFields?.length ? options.ftsFields : ['id'];
    const params: unknown[] = [];
    const searchConditions = searchFields.map((field) => {
      params.push(searchTerm);
      return `${esc(field)}::text ILIKE '%' || ${bt.next()} || '%'`;
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
    const orderBy = buildOrderByClause(options?.sort, pagination);
    const { limitClause, limitParams } = buildLimitClause(pagination, bt);
    params.push(...limitParams);

    const countBt = new BindTracker('postgres');
    const countParams: unknown[] = [];
    const countSearchConditions = searchFields.map((field) => {
      countParams.push(searchTerm);
      return `${esc(field)}::text ILIKE '%' || ${countBt.next()} || '%'`;
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

  const escapedTerm = buildSqliteFtsMatch(searchTerm);
  params.push(escapedTerm);
  const { whereClause, whereParams } = buildWhereClause(
    options?.filters,
    pagination,
    options?.orFilters,
    bt,
    dialect,
  );
  params.push(...whereParams);
  const orderBy = options?.sort?.length
    ? buildOrderByClause(options.sort, pagination)
    : `${esc(ftsTable)}.rank, "id" ASC`;
  const { limitClause, limitParams } = buildLimitClause(pagination, bt);
  params.push(...limitParams);

  const countBt = new BindTracker('sqlite');
  const countParams: unknown[] = [escapedTerm];
  const { whereClause: countWhere, whereParams: countWhereParams } = buildWhereClause(
    options?.filters,
    undefined,
    options?.orFilters,
    countBt,
    dialect,
  );
  countParams.push(...countWhereParams);

  return {
    sql: `SELECT ${selectCols}
FROM ${esc(ftsTable)}
JOIN ${esc(tableName)} ON ${esc(tableName)}.rowid = ${esc(ftsTable)}.rowid
WHERE ${esc(ftsTable)} MATCH ?
${whereClause ? `AND (${whereClause})` : ''}
ORDER BY ${orderBy}
${limitClause}`,
    params,
    countSql: `SELECT COUNT(*) as total
FROM ${esc(ftsTable)}
JOIN ${esc(tableName)} ON ${esc(tableName)}.rowid = ${esc(ftsTable)}.rowid
WHERE ${esc(ftsTable)} MATCH ?
${countWhere ? `AND (${countWhere})` : ''}`,
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

  if (dialect === 'postgres') {
    const bt = new BindTracker('postgres');
    const params: unknown[] = [];
    const searchConditions = fields.map((field) => {
      params.push(searchTerm);
      return `${esc(field)}::text ILIKE '%' || ${bt.next()} || '%'`;
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
    const orderBy = buildOrderByClause(options?.sort, pagination);
    const { limitClause, limitParams } = buildLimitClause(pagination, bt);
    params.push(...limitParams);

    const countBt = new BindTracker('postgres');
    const countParams: unknown[] = [];
    const countSearchConditions = fields.map((field) => {
      countParams.push(searchTerm);
      return `${esc(field)}::text ILIKE '%' || ${countBt.next()} || '%'`;
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

    return {
      sql: `SELECT * FROM ${esc(tableName)} WHERE ${whereParts.join(' AND ')} ORDER BY ${orderBy} ${limitClause}`,
      params,
      countSql: `SELECT COUNT(*) as total FROM ${esc(tableName)} WHERE ${countWhereParts.join(' AND ')}`,
      countParams,
    };
  }

  const bt = new BindTracker('sqlite');
  const params: unknown[] = [];
  const conditions = fields.map((field) => {
    params.push(searchTerm);
    return `instr(lower(CAST(${esc(field)} AS TEXT)), lower(${bt.next()})) > 0`;
  });
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
  const orderBy = buildOrderByClause(options?.sort, pagination);
  const { limitClause, limitParams } = buildLimitClause(pagination, bt);
  params.push(...limitParams);

  const countBt = new BindTracker('sqlite');
  const countParams: unknown[] = [];
  const countConditions = fields.map((field) => {
    countParams.push(searchTerm);
    return `instr(lower(CAST(${esc(field)} AS TEXT)), lower(${countBt.next()})) > 0`;
  });
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

  return {
    sql: `SELECT * FROM ${esc(tableName)} WHERE (${conditions.join(' OR ')})${whereClause ? ` AND (${whereClause})` : ''} ORDER BY ${orderBy} ${limitClause}`,
    params,
    countSql: `SELECT COUNT(*) as total FROM ${esc(tableName)} WHERE (${countConditions.join(' OR ')})${countWhere ? ` AND (${countWhere})` : ''}`,
    countParams,
  };
}

function buildSqliteFtsMatch(searchTerm: string): string {
  const terms = searchTerm
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/^"+|"+$/g, '').trim())
    .filter((term) => term.length > 0)
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
  return `(to_jsonb(${esc(tableName)})::text ILIKE '%' || ${bt.next()} || '%')`;
}


// ─── WHERE Clause Builder ───

function buildWhereClause(
  filters?: FilterTuple[],
  pagination?: PaginationOptions,
  orFilters?: FilterTuple[],
  bt?: BindTracker,
  dialect: SqlDialect = 'sqlite',
): { whereClause: string; whereParams: unknown[] } {
  const _bt = bt ?? new BindTracker(dialect);
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Filter tuples → WHERE conditions (AND)
  if (filters?.length) {
    for (const [field, op, value] of filters) {
      const { condition, condParams } = buildFilterCondition(field, op, value, _bt, dialect);
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
      const { condition, condParams } = buildFilterCondition(field, op, value, _bt, dialect);
      orClauses.push(condition);
      params.push(...condParams);
    }
    conditions.push(`(${orClauses.join(' OR ')})`);
  }

  // Cursor pagination → WHERE id > ? or id < ?
  if (pagination?.after) {
    conditions.push(`"id" > ${_bt.next()}`);
    params.push(pagination.after);
  }
  if (pagination?.before) {
    conditions.push(`"id" < ${_bt.next()}`);
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
): { condition: string; condParams: unknown[] } {
  const col = esc(field);

  switch (op) {
    case '==':
      return { condition: `${col} = ${bt.next()}`, condParams: [value] };
    case '!=':
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
      const placeholders = bt.nextN(arr.length).join(', ');
      return { condition: `${col} IN (${placeholders})`, condParams: arr };
    }
    case 'not in':
    case 'not-in': {
      const arr = value as unknown[];
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
      // SQLite: EXISTS (SELECT 1 FROM json_each(col) WHERE value IN (?, ?))
      const placeholders = bt.nextN(arr.length).join(', ');
      return { condition: `EXISTS (SELECT 1 FROM json_each(${col}) WHERE value IN (${placeholders}))`, condParams: arr };
    }
    default:
      throw new EdgeBaseError(400, `Unsupported filter operator: ${op}`);
  }
}

// ─── ORDER BY Clause Builder ───

function buildOrderByClause(
  sort?: SortOption[],
  pagination?: PaginationOptions,
): string {
  const parts: string[] = [];

  if (sort?.length) {
    for (const s of sort) {
      const dir = s.direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      parts.push(`${esc(s.field)} ${dir}`);
    }
  }

  // Default sort by id for cursor pagination or if no explicit sort
  if (!parts.length) {
    if (pagination?.before) {
      parts.push('"id" DESC');
    } else {
      parts.push('"id" ASC');
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
      parts.push(pagination?.before ? '"id" DESC' : '"id" ASC');
    }
  }

  return parts.join(', ');
}

// ─── LIMIT Clause Builder ───

function buildLimitClause(
  pagination?: PaginationOptions,
  bt?: BindTracker,
): { limitClause: string; limitParams: unknown[] } {
  const _bt = bt ?? new BindTracker('sqlite');

  if (!pagination) {
    return { limitClause: `LIMIT ${_bt.next()}`, limitParams: [100] }; // Default limit
  }

  const limit = Math.min(pagination.limit ?? pagination.perPage ?? 100, 1000);

  // Cursor-based: no offset
  if (pagination.after || pagination.before) {
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

  return options;
}

// ─── Utility ───

function esc(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
