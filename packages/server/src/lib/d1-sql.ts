export interface D1SqlResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

function isRowsQuery(sql: string): boolean {
  const normalized = sql.trim().replace(/^\(+/, '').toUpperCase();
  return /^(SELECT|WITH|PRAGMA|EXPLAIN|VALUES)\b/.test(normalized) || /\bRETURNING\b/i.test(sql);
}

export async function executeD1Sql(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<D1SqlResult> {
  const stmt = db.prepare(sql);
  const bound = params.length > 0 ? stmt.bind(...params) : stmt;

  if (isRowsQuery(sql)) {
    const result = await bound.all();
    const rows = (result.results ?? []) as Record<string, unknown>[];
    return {
      rows,
      rowCount: rows.length,
    };
  }

  const result = await bound.run();
  return {
    rows: [],
    rowCount: result.meta?.changes ?? 0,
  };
}
