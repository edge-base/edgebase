/**
 * D1Client — SDK client for user-defined D1 databases
 *
 * Usage:
 *   const admin = createAdminClient(url, { serviceKey });
 *   const rows = await admin.d1('analytics').exec('SELECT * FROM events WHERE type = ?', ['pageview']);
 */
import type { HttpClient } from '@edgebase/core';
import { HttpClientAdapter } from '@edgebase/core';
import { DefaultAdminApi } from './generated/admin-api-core.js';

export class D1Client {
  private adminCore: DefaultAdminApi;
  private database: string;

  constructor(httpClient: HttpClient, database: string) {
    this.adminCore = new DefaultAdminApi(new HttpClientAdapter(httpClient));
    this.database = database;
  }

  /**
   * Execute a SQL query on the D1 database.
   * All SQL is allowed (DDL included) — Service Key holders are admin-level trusted.
   * Use ? placeholders for bind parameters (SQL injection prevention).
   *
   * @param query SQL query string with ? placeholders
   * @param params Bind parameters
   * @returns Array of result rows
   */
  async exec<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    const res = await this.adminCore.executeD1Query(this.database, {
      query,
      params,
    }) as { results: T[] };
    return res.results;
  }

  /**
   * Alias for `exec()` — execute a SQL query on the D1 database.
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.exec<T>(sql, params);
  }
}
