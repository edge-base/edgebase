/**
 * db.sql tagged template literal → positional `?` prepared statement.
 * M1.3 벤치마크 결과: positional `?` 채택 (strings.join('?') 패턴).
 */

/**
 * A raw SQL fragment that bypasses parameterization.
 * Use with extreme caution — only for whitelisted table/column names.
 */
export class RawSql {
  constructor(public readonly value: string) {}
}

/**
 * Mark a value as raw SQL (no parameterization).
 * Warning: potential SQL injection if used with unvalidated input.
 */
export function raw(value: string): RawSql {
  return new RawSql(value);
}

/**
 * Build a parameterized query from a tagged template literal.
 * Returns { query, params } for use with `this.ctx.storage.sql.exec()`.
 */
export function buildSqlQuery(
  strings: TemplateStringsArray,
  ...values: unknown[]
): { query: string; params: unknown[] } {
  const params: unknown[] = [];
  let query = strings[0];

  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val instanceof RawSql) {
      // Raw SQL fragment — inject directly (no parameterization)
      query += val.value + strings[i + 1];
    } else {
      query += '?' + strings[i + 1];
      params.push(val);
    }
  }

  return { query, params };
}

/**
 * Create a `db.sql` tagged template function bound to a DO's SQLite storage.
 */
export function createSqlTaggedTemplate(
  sqlExec: (query: string, ...params: unknown[]) => SqlStorageCursor,
) {
  return function sql(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Record<string, unknown>[] {
    const { query, params } = buildSqlQuery(strings, ...values);
    return [...sqlExec(query, ...params)];
  };
}

/**
 * Minimal cursor interface for DO SQLite.
 * The actual type is provided by @cloudflare/workers-types.
 */
type SqlStorageCursor = Iterable<Record<string, unknown>>;
