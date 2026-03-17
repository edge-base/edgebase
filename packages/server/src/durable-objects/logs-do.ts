/**
 * LogsDO — Analytics log storage Durable Object.
 *
 * Provides SQLite-based log storage for Docker/self-hosted environments
 * where Cloudflare Analytics Engine is not available.
 *
 * Architecture:
 *   - Single instance per project: `logs:main`
 *   - 3-tier pre-aggregation for fast reads:
 *       _logs_raw    (24h)     — exact per-request data
 *       _logs_hourly (90d)     — hourly aggregates
 *       _logs_daily  (forever) — daily aggregates
 *   - Alarm-based hourly aggregation + cleanup
 *
 * Internal Routes:
 *   POST /internal/logs/write  — batch insert raw log entries
 *   GET  /internal/logs/query  — query aggregated analytics data
 *   GET  /internal/logs/recent — query recent raw request logs
 */
import { DurableObject } from 'cloudflare:workers';

const SERVER_ERROR_STATUS = 500;

interface LogsDOEnv {
  [key: string]: unknown;
}

export class LogsDO extends DurableObject<LogsDOEnv> {
  private initialized = false;

  // ─── Schema ───

  private ensureSchema(): void {
    if (this.initialized) return;
    this.initialized = true;

    const sql = this.ctx.storage.sql;

    // Raw logs — exact per-request data, kept for 24 hours
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _logs_raw (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        duration REAL NOT NULL,
        userId TEXT,
        error TEXT,
        category TEXT,
        subcategory TEXT,
        target1 TEXT,
        target2 TEXT,
        operation TEXT,
        region TEXT,
        requestSize INTEGER DEFAULT 0,
        responseSize INTEGER DEFAULT 0,
        resultCount INTEGER DEFAULT 0
      )
    `);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_logs_raw_ts ON _logs_raw(timestamp)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_logs_raw_cat ON _logs_raw(category)`);

    // Hourly aggregates — kept for 90 days
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _logs_hourly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hour_ts INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        subcategory TEXT NOT NULL DEFAULT '',
        target1 TEXT NOT NULL DEFAULT '',
        target2 TEXT NOT NULL DEFAULT '',
        operation TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT '',
        request_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        avg_duration REAL NOT NULL DEFAULT 0,
        p95_duration REAL NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0,
        total_request_size INTEGER NOT NULL DEFAULT 0,
        total_response_size INTEGER NOT NULL DEFAULT 0,
        total_result_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_logs_hourly_ts ON _logs_hourly(hour_ts)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_logs_hourly_cat ON _logs_hourly(hour_ts, category)`);

    // Daily aggregates — kept permanently
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _logs_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_ts INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        subcategory TEXT NOT NULL DEFAULT '',
        target1 TEXT NOT NULL DEFAULT '',
        target2 TEXT NOT NULL DEFAULT '',
        operation TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT '',
        request_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        avg_duration REAL NOT NULL DEFAULT 0,
        p95_duration REAL NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0,
        total_request_size INTEGER NOT NULL DEFAULT 0,
        total_response_size INTEGER NOT NULL DEFAULT 0,
        total_result_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_logs_daily_ts ON _logs_daily(day_ts)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_logs_daily_cat ON _logs_daily(day_ts, category)`);

    // Custom events — raw events (90-day retention)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        userId TEXT,
        eventName TEXT NOT NULL,
        properties TEXT,
        region TEXT
      )
    `);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_ts ON _events(timestamp)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_name ON _events(eventName)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_user ON _events(userId)`);

    // Custom events — daily aggregates (permanent)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _events_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_ts INTEGER NOT NULL,
        eventName TEXT NOT NULL,
        event_count INTEGER NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0
      )
    `);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_daily_ts ON _events_daily(day_ts)`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_daily_name ON _events_daily(day_ts, eventName)`);

    // Schedule first alarm if not already scheduled
    this.scheduleNextAlarm();
  }

  // ─── Alarm ───

  private scheduleNextAlarm(): void {
    // Next full hour
    const next = new Date();
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    this.ctx.storage.setAlarm(next.getTime());
  }

  async alarm(): Promise<void> {
    this.ensureSchema();

    try {
      this.aggregateHourly();
      this.aggregateDaily();
      this.aggregateEvents();
      this.cleanup();
    } catch (err) {
      console.error('[LogsDO] Alarm aggregation failed:', err);
    }

    // Reschedule
    this.scheduleNextAlarm();
  }

  /**
   * Aggregate raw logs older than 1 hour into _logs_hourly.
   * Groups by (hour, category, subcategory, target1, target2, operation, region).
   */
  private aggregateHourly(): void {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    // Aggregate everything older than 1 hour
    const cutoff = now - 3600_000;

    // Find the oldest raw log timestamp to determine range
    const oldest = sql.exec(`SELECT MIN(timestamp) as min_ts FROM _logs_raw WHERE timestamp < ?`, cutoff).toArray();
    if (!oldest.length || oldest[0].min_ts == null) return;

    const minTs = oldest[0].min_ts as number;

    // Process hour by hour
    const startHour = Math.floor(minTs / 3600_000) * 3600_000;
    const endHour = Math.floor(cutoff / 3600_000) * 3600_000;

    for (let hourTs = startHour; hourTs <= endHour; hourTs += 3600_000) {
      const hourEnd = hourTs + 3600_000;

      // Check if already aggregated
      const existing = sql.exec(
        `SELECT COUNT(*) as cnt FROM _logs_hourly WHERE hour_ts = ?`,
        hourTs,
      ).toArray();
      if (existing.length && (existing[0].cnt as number) > 0) continue;

      // Aggregate
      sql.exec(`
        INSERT INTO _logs_hourly (hour_ts, category, subcategory, target1, target2, operation, region,
          request_count, error_count, avg_duration, p95_duration, unique_users,
          total_request_size, total_response_size, total_result_count)
        SELECT
          ? as hour_ts,
          COALESCE(category, '') as category,
          COALESCE(subcategory, '') as subcategory,
          COALESCE(target1, '') as target1,
          COALESCE(target2, '') as target2,
          COALESCE(operation, '') as operation,
          COALESCE(region, '') as region,
          COUNT(*) as request_count,
          SUM(CASE WHEN status >= ${SERVER_ERROR_STATUS} THEN 1 ELSE 0 END) as error_count,
          AVG(duration) as avg_duration,
          0 as p95_duration,
          COUNT(DISTINCT userId) as unique_users,
          SUM(COALESCE(requestSize, 0)) as total_request_size,
          SUM(COALESCE(responseSize, 0)) as total_response_size,
          SUM(COALESCE(resultCount, 0)) as total_result_count
        FROM _logs_raw
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY category, subcategory, target1, target2, operation, region
      `, hourTs, hourTs, hourEnd);
    }
  }

  /**
   * Aggregate hourly data older than 90 days into _logs_daily.
   */
  private aggregateDaily(): void {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const cutoff90d = now - 90 * 86400_000;

    const oldest = sql.exec(
      `SELECT MIN(hour_ts) as min_ts FROM _logs_hourly WHERE hour_ts < ?`,
      cutoff90d,
    ).toArray();
    if (!oldest.length || oldest[0].min_ts == null) return;

    const minTs = oldest[0].min_ts as number;
    const startDay = Math.floor(minTs / 86400_000) * 86400_000;
    const endDay = Math.floor(cutoff90d / 86400_000) * 86400_000;

    for (let dayTs = startDay; dayTs <= endDay; dayTs += 86400_000) {
      const dayEnd = dayTs + 86400_000;

      const existing = sql.exec(
        `SELECT COUNT(*) as cnt FROM _logs_daily WHERE day_ts = ?`,
        dayTs,
      ).toArray();
      if (existing.length && (existing[0].cnt as number) > 0) continue;

      sql.exec(`
        INSERT INTO _logs_daily (day_ts, category, subcategory, target1, target2, operation, region,
          request_count, error_count, avg_duration, p95_duration, unique_users,
          total_request_size, total_response_size, total_result_count)
        SELECT
          ? as day_ts,
          category, subcategory, target1, target2, operation, region,
          SUM(request_count) as request_count,
          SUM(error_count) as error_count,
          CASE WHEN SUM(request_count) > 0
            THEN SUM(avg_duration * request_count) / SUM(request_count)
            ELSE 0 END as avg_duration,
          MAX(p95_duration) as p95_duration,
          SUM(unique_users) as unique_users,
          SUM(total_request_size) as total_request_size,
          SUM(total_response_size) as total_response_size,
          SUM(total_result_count) as total_result_count
        FROM _logs_hourly
        WHERE hour_ts >= ? AND hour_ts < ?
        GROUP BY category, subcategory, target1, target2, operation, region
      `, dayTs, dayTs, dayEnd);
    }

    // Delete aggregated hourly rows
    sql.exec(`DELETE FROM _logs_hourly WHERE hour_ts < ?`, cutoff90d);
  }

  /**
   * Aggregate custom events older than 90 days into _events_daily.
   */
  private aggregateEvents(): void {
    const sql = this.ctx.storage.sql;
    const cutoff90d = Date.now() - 90 * 86400_000;

    const oldest = sql.exec(
      `SELECT MIN(timestamp) as min_ts FROM _events WHERE timestamp < ?`,
      cutoff90d,
    ).toArray();
    if (!oldest.length || oldest[0].min_ts == null) return;

    const minTs = oldest[0].min_ts as number;
    const startDay = Math.floor(minTs / 86400_000) * 86400_000;
    const endDay = Math.floor(cutoff90d / 86400_000) * 86400_000;

    for (let dayTs = startDay; dayTs <= endDay; dayTs += 86400_000) {
      const dayEnd = dayTs + 86400_000;

      const existing = sql.exec(
        `SELECT COUNT(*) as cnt FROM _events_daily WHERE day_ts = ?`,
        dayTs,
      ).toArray();
      if (existing.length && (existing[0].cnt as number) > 0) continue;

      sql.exec(`
        INSERT INTO _events_daily (day_ts, eventName, event_count, unique_users)
        SELECT
          ? as day_ts,
          eventName,
          COUNT(*) as event_count,
          COUNT(DISTINCT userId) as unique_users
        FROM _events
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY eventName
      `, dayTs, dayTs, dayEnd);
    }

    // Delete aggregated events
    sql.exec(`DELETE FROM _events WHERE timestamp < ?`, cutoff90d);
  }

  /**
   * Remove raw logs older than 24 hours (already aggregated into hourly).
   */
  private cleanup(): void {
    const cutoff24h = Date.now() - 86400_000;
    this.ctx.storage.sql.exec(`DELETE FROM _logs_raw WHERE timestamp < ?`, cutoff24h);
  }

  // ─── Request Handler ───

  async fetch(request: Request): Promise<Response> {
    this.ensureSchema();

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/internal/logs/write' && request.method === 'POST') {
      return this.handleWrite(request);
    }

    if (path === '/internal/logs/query' && request.method === 'GET') {
      return this.handleQuery(url);
    }

    if (path === '/internal/logs/history' && request.method === 'GET') {
      return this.handleHistory(url);
    }

    if (path === '/internal/logs/recent' && request.method === 'GET') {
      return this.handleRecent(url);
    }

    if (path === '/internal/events/write' && request.method === 'POST') {
      return this.handleEventsWrite(request);
    }

    if (path === '/internal/events/query' && request.method === 'GET') {
      return this.handleEventsQuery(url);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }

  // ─── Write Handler ───

  private async handleWrite(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as { entries: Array<Record<string, unknown>> };
      const entries = body.entries;
      if (!Array.isArray(entries) || entries.length === 0) {
        return new Response(JSON.stringify({ ok: true, count: 0 }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const sql = this.ctx.storage.sql;

      for (const e of entries) {
        sql.exec(`
          INSERT INTO _logs_raw (timestamp, method, path, status, duration, userId, error,
            category, subcategory, target1, target2, operation, region,
            requestSize, responseSize, resultCount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          (e.timestamp as number) || Date.now(),
          (e.method as string) || '',
          (e.path as string) || '',
          (e.status as number) || 0,
          (e.duration as number) || 0,
          (e.userId as string) || null,
          (e.error as string) || null,
          (e.category as string) || '',
          (e.subcategory as string) || '',
          (e.target1 as string) || '',
          (e.target2 as string) || '',
          (e.operation as string) || '',
          (e.region as string) || '',
          (e.requestSize as number) || 0,
          (e.responseSize as number) || 0,
          (e.resultCount as number) || 0,
        );
      }

      return new Response(JSON.stringify({ ok: true, count: entries.length }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('[LogsDO] Write failed:', err);
      return new Response(JSON.stringify({ error: 'Write failed' }), { status: 500 });
    }
  }

  // ─── Query Handler ───

  /**
   * Query analytics data.
   *
   * Query params:
   *   range:    '1h'|'6h'|'24h'|'7d'|'30d'|'90d' (default '24h')
   *   category: filter by category (optional)
   *   metric:   'overview'|'timeSeries'|'breakdown'|'topEndpoints' (default 'overview')
   *   groupBy:  'minute'|'tenMinute'|'hour'|'day' (default 'hour')
   */
  private handleQuery(url: URL): Response {
    try {
      const range = url.searchParams.get('range') || '24h';
      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      const category = url.searchParams.get('category') || '';
      const excludeCategory = url.searchParams.get('excludeCategory') || '';
      const metric = url.searchParams.get('metric') || 'overview';
      const groupBy = url.searchParams.get('groupBy') || 'hour';

      const { startTs, endTs } = this.parseTimeRange(range, start, end);
      const table = this.selectTable(range);
      const tsCol = table === '_logs_raw' ? 'timestamp' : table === '_logs_hourly' ? 'hour_ts' : 'day_ts';

      // Build combined category filter
      const catParts: string[] = [];
      if (category) catParts.push(`category = '${escapeSql(category)}'`);
      if (excludeCategory) catParts.push(`category != '${escapeSql(excludeCategory)}'`);
      const catFilter = catParts.length > 0 ? ` AND ${catParts.join(' AND ')}` : '';

      const sql = this.ctx.storage.sql;

      if (metric === 'overview') {
        return this.queryOverview(sql, table, tsCol, startTs, endTs, catFilter, groupBy);
      }

      if (metric === 'timeSeries') {
        return this.queryTimeSeries(sql, table, tsCol, startTs, endTs, catFilter, groupBy);
      }

      if (metric === 'breakdown') {
        return this.queryBreakdown(sql, table, tsCol, startTs, endTs, catFilter, category);
      }

      if (metric === 'topEndpoints') {
        return this.queryTopEndpoints(sql, table, tsCol, startTs, endTs, catFilter);
      }

      return jsonResponse({ error: 'Unknown metric' }, 400);
    } catch (err) {
      console.error('[LogsDO] Query failed:', err);
      return jsonResponse({ error: 'Query failed' }, 500);
    }
  }

  private handleRecent(url: URL): Response {
    try {
      const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200));
      const level = (url.searchParams.get('level') || '').toLowerCase();
      const pathFilter = url.searchParams.get('path') || '';
      const category = (url.searchParams.get('category') || '').toLowerCase();

      const whereParts: string[] = [];
      const params: Array<string | number> = [];

      if (level === 'error') {
        whereParts.push('status >= ?');
        params.push(SERVER_ERROR_STATUS);
      } else if (level === 'warn') {
        whereParts.push('status >= ? AND status < ?');
        params.push(300, SERVER_ERROR_STATUS);
      } else if (level === 'info') {
        whereParts.push('status >= ? AND status < ?');
        params.push(200, 300);
      }

      if (pathFilter.trim()) {
        whereParts.push('path LIKE ?');
        params.push(`%${pathFilter.trim()}%`);
      }

      if (category && category !== 'all') {
        whereParts.push('LOWER(category) = ?');
        params.push(category);
      }

      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
      const sql = this.ctx.storage.sql;
      const rows = sql.exec(
        `
          SELECT
            timestamp,
            method,
            path,
            status,
            duration,
            userId,
            error,
            category,
            subcategory,
            target1,
            target2,
            operation,
            region,
            requestSize,
            responseSize,
            resultCount
          FROM _logs_raw
          ${whereClause}
          ORDER BY timestamp DESC
          LIMIT ?
        `,
        ...params,
        limit,
      ).toArray();

      return jsonResponse({
        logs: rows.map((row) => ({
          timestamp: Number(row.timestamp ?? 0),
          method: String(row.method ?? ''),
          path: String(row.path ?? ''),
          status: Number(row.status ?? 0),
          duration: Number(row.duration ?? 0),
          userId: row.userId ? String(row.userId) : undefined,
          error: row.error ? String(row.error) : undefined,
          category: String(row.category ?? ''),
          subcategory: String(row.subcategory ?? ''),
          target1: String(row.target1 ?? ''),
          target2: String(row.target2 ?? ''),
          operation: String(row.operation ?? ''),
          region: String(row.region ?? ''),
          requestSize: Number(row.requestSize ?? 0),
          responseSize: Number(row.responseSize ?? 0),
          resultCount: Number(row.resultCount ?? 0),
        })),
        total: rows.length,
      });
    } catch (err) {
      console.error('[LogsDO] Recent logs query failed:', err);
      return jsonResponse({ error: 'Recent logs query failed' }, 500);
    }
  }

  private handleHistory(url: URL): Response {
    try {
      const category = url.searchParams.get('category') || '';
      const excludeCategory = url.searchParams.get('excludeCategory') || '';
      const catParts: string[] = [];
      if (category) catParts.push(`category = '${escapeSql(category)}'`);
      if (excludeCategory) catParts.push(`category != '${escapeSql(excludeCategory)}'`);
      const whereClause = catParts.length > 0 ? ` WHERE ${catParts.join(' AND ')}` : '';

      const sql = this.ctx.storage.sql;
      const rows = sql.exec(
        `
          SELECT MIN(ts) as oldestTimestamp
          FROM (
            SELECT MIN(timestamp) as ts FROM _logs_raw${whereClause}
            UNION ALL
            SELECT MIN(hour_ts) as ts FROM _logs_hourly${whereClause}
            UNION ALL
            SELECT MIN(day_ts) as ts FROM _logs_daily${whereClause}
          )
          WHERE ts IS NOT NULL
        `,
      ).toArray();

      const oldestTimestamp = rows[0]?.oldestTimestamp;
      return jsonResponse({
        oldestTimestamp:
          oldestTimestamp == null || !Number.isFinite(Number(oldestTimestamp))
            ? null
            : Number(oldestTimestamp),
      });
    } catch (err) {
      console.error('[LogsDO] History query failed:', err);
      return jsonResponse({ error: 'History query failed' }, 500);
    }
  }

  // ─── Query implementations ───

  private queryOverview(
    sql: SqlStorage, table: string, tsCol: string,
    startTs: number, endTs: number, catFilter: string, groupBy: string,
  ): Response {

    // Summary
    let summary: Record<string, unknown>;
    if (table === '_logs_raw') {
      const rows = sql.exec(`
        SELECT
          COUNT(*) as totalRequests,
          SUM(CASE WHEN status >= ${SERVER_ERROR_STATUS} THEN 1 ELSE 0 END) as totalErrors,
          AVG(duration) as avgLatency,
          COUNT(DISTINCT userId) as uniqueUsers
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
      `, startTs, endTs).toArray();
      summary = rows[0] || { totalRequests: 0, totalErrors: 0, avgLatency: 0, uniqueUsers: 0 };
    } else {
      const rows = sql.exec(`
        SELECT
          SUM(request_count) as totalRequests,
          SUM(error_count) as totalErrors,
          CASE WHEN SUM(request_count) > 0
            THEN SUM(avg_duration * request_count) / SUM(request_count)
            ELSE 0 END as avgLatency,
          SUM(unique_users) as uniqueUsers
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
      `, startTs, endTs).toArray();
      summary = rows[0] || { totalRequests: 0, totalErrors: 0, avgLatency: 0, uniqueUsers: 0 };
    }

    // Time series
    const bucketMs = this.groupByToMs(groupBy);
    let timeSeries: Record<string, unknown>[];
    if (table === '_logs_raw') {
      timeSeries = sql.exec(`
        SELECT
          (CAST(${tsCol} / ? AS INTEGER) * ?) as ts,
          COUNT(*) as value
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY ts
        ORDER BY ts
      `, bucketMs, bucketMs, startTs, endTs).toArray();
    } else {
      timeSeries = sql.exec(`
        SELECT
          (CAST(${tsCol} / ? AS INTEGER) * ?) as ts,
          SUM(request_count) as value
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY ts
        ORDER BY ts
      `, bucketMs, bucketMs, startTs, endTs).toArray();
    }

    // Breakdown by category
    let breakdown: Record<string, unknown>[];
    if (table === '_logs_raw') {
      breakdown = sql.exec(`
        SELECT
          COALESCE(category, 'other') as label,
          COUNT(*) as count
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY category
        ORDER BY count DESC
        LIMIT 20
      `, startTs, endTs).toArray();
    } else {
      breakdown = sql.exec(`
        SELECT
          category as label,
          SUM(request_count) as count
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY category
        ORDER BY count DESC
        LIMIT 20
      `, startTs, endTs).toArray();
    }

    // Add percentages
    const totalCount = breakdown.reduce((sum, b) => sum + ((b.count as number) || 0), 0);
    const breakdownWithPct = breakdown.map(b => ({
      ...b,
      percentage: totalCount > 0 ? Math.round(((b.count as number) / totalCount) * 1000) / 10 : 0,
    }));

    // Top endpoints
    let topItems: Record<string, unknown>[];
    if (table === '_logs_raw') {
      topItems = sql.exec(`
        SELECT
          path as label,
          COUNT(*) as count,
          AVG(duration) as avgLatency,
          ROUND(SUM(CASE WHEN status >= ${SERVER_ERROR_STATUS} THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100, 1) as errorRate
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY path
        ORDER BY count DESC
        LIMIT 10
      `, startTs, endTs).toArray();
    } else {
      topItems = sql.exec(`
        SELECT
          (category || ':' || operation) as label,
          SUM(request_count) as count,
          CASE WHEN SUM(request_count) > 0
            THEN SUM(avg_duration * request_count) / SUM(request_count)
            ELSE 0 END as avgLatency,
          CASE WHEN SUM(request_count) > 0
            THEN ROUND(SUM(error_count) * 100.0 / SUM(request_count), 1)
            ELSE 0 END as errorRate
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY category, operation
        ORDER BY count DESC
        LIMIT 10
      `, startTs, endTs).toArray();
    }

    return jsonResponse({
      timeSeries: timeSeries.map(r => ({ timestamp: r.ts, value: r.value })),
      summary,
      breakdown: breakdownWithPct,
      topItems,
    });
  }

  private queryTimeSeries(
    sql: SqlStorage, table: string, tsCol: string,
    startTs: number, endTs: number, catFilter: string, groupBy: string,
  ): Response {
    const bucketMs = this.groupByToMs(groupBy);

    let rows: Record<string, unknown>[];
    if (table === '_logs_raw') {
      rows = sql.exec(`
        SELECT
          (CAST(${tsCol} / ? AS INTEGER) * ?) as ts,
          COUNT(*) as requests,
          SUM(CASE WHEN status >= ${SERVER_ERROR_STATUS} THEN 1 ELSE 0 END) as errors,
          AVG(duration) as avgLatency,
          COUNT(DISTINCT userId) as uniqueUsers
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY ts
        ORDER BY ts
      `, bucketMs, bucketMs, startTs, endTs).toArray();
    } else {
      rows = sql.exec(`
        SELECT
          (CAST(${tsCol} / ? AS INTEGER) * ?) as ts,
          SUM(request_count) as requests,
          SUM(error_count) as errors,
          CASE WHEN SUM(request_count) > 0
            THEN SUM(avg_duration * request_count) / SUM(request_count)
            ELSE 0 END as avgLatency,
          SUM(unique_users) as uniqueUsers
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY ts
        ORDER BY ts
      `, bucketMs, bucketMs, startTs, endTs).toArray();
    }

    return jsonResponse({
      timeSeries: rows.map(r => ({
        timestamp: r.ts,
        requests: r.requests,
        errors: r.errors,
        avgLatency: r.avgLatency,
        uniqueUsers: r.uniqueUsers,
      })),
    });
  }

  private queryBreakdown(
    sql: SqlStorage, table: string, tsCol: string,
    startTs: number, endTs: number, catFilter: string, category: string,
  ): Response {

    // If filtering by category, break down by subcategory; otherwise by category
    const groupCol = category
      ? 'subcategory'
      : 'category';

    let rows: Record<string, unknown>[];
    if (table === '_logs_raw') {
      rows = sql.exec(`
        SELECT
          COALESCE(${groupCol}, 'other') as label,
          COUNT(*) as count,
          AVG(duration) as avgLatency,
          ROUND(SUM(CASE WHEN status >= ${SERVER_ERROR_STATUS} THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100, 1) as errorRate
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY ${groupCol}
        ORDER BY count DESC
        LIMIT 20
      `, startTs, endTs).toArray();
    } else {
      rows = sql.exec(`
        SELECT
          ${groupCol} as label,
          SUM(request_count) as count,
          CASE WHEN SUM(request_count) > 0
            THEN SUM(avg_duration * request_count) / SUM(request_count)
            ELSE 0 END as avgLatency,
          CASE WHEN SUM(request_count) > 0
            THEN ROUND(SUM(error_count) * 100.0 / SUM(request_count), 1)
            ELSE 0 END as errorRate
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY ${groupCol}
        ORDER BY count DESC
        LIMIT 20
      `, startTs, endTs).toArray();
    }

    const total = rows.reduce((sum, r) => sum + ((r.count as number) || 0), 0);
    const withPct = rows.map(r => ({
      ...r,
      percentage: total > 0 ? Math.round(((r.count as number) / total) * 1000) / 10 : 0,
    }));

    return jsonResponse({ breakdown: withPct });
  }

  private queryTopEndpoints(
    sql: SqlStorage, table: string, tsCol: string,
    startTs: number, endTs: number, catFilter: string,
  ): Response {

    let rows: Record<string, unknown>[];
    if (table === '_logs_raw') {
      rows = sql.exec(`
        SELECT
          path as label,
          COUNT(*) as count,
          AVG(duration) as avgLatency,
          ROUND(SUM(CASE WHEN status >= ${SERVER_ERROR_STATUS} THEN 1.0 ELSE 0.0 END) / COUNT(*) * 100, 1) as errorRate
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY path
        ORDER BY count DESC
        LIMIT 20
      `, startTs, endTs).toArray();
    } else {
      rows = sql.exec(`
        SELECT
          (target1 || '/' || target2) as label,
          SUM(request_count) as count,
          CASE WHEN SUM(request_count) > 0
            THEN SUM(avg_duration * request_count) / SUM(request_count)
            ELSE 0 END as avgLatency,
          CASE WHEN SUM(request_count) > 0
            THEN ROUND(SUM(error_count) * 100.0 / SUM(request_count), 1)
            ELSE 0 END as errorRate
        FROM ${table}
        WHERE ${tsCol} >= ? AND ${tsCol} < ?${catFilter}
        GROUP BY target1, target2
        ORDER BY count DESC
        LIMIT 20
      `, startTs, endTs).toArray();
    }

    return jsonResponse({ topItems: rows });
  }

  // ─── Events Write Handler ───

  private async handleEventsWrite(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as { events: Array<Record<string, unknown>> };
      const events = body.events;
      if (!Array.isArray(events) || events.length === 0) {
        return jsonResponse({ ok: true, count: 0 });
      }

      const sql = this.ctx.storage.sql;

      for (const e of events) {
        sql.exec(`
          INSERT INTO _events (timestamp, userId, eventName, properties, region)
          VALUES (?, ?, ?, ?, ?)
        `,
          (e.timestamp as number) || Date.now(),
          (e.userId as string) || null,
          (e.eventName as string) || '',
          e.properties ? (typeof e.properties === 'string' ? e.properties : JSON.stringify(e.properties)) : null,
          (e.region as string) || '',
        );
      }

      return jsonResponse({ ok: true, count: events.length });
    } catch (err) {
      console.error('[LogsDO] Events write failed:', err);
      return jsonResponse({ error: 'Events write failed' }, 500);
    }
  }

  // ─── Events Query Handler ───

  /**
   * Query custom events.
   *
   * Query params:
   *   range:   '1h'|'6h'|'24h'|'7d'|'30d'|'90d' (default '24h')
   *   event:   filter by event name (optional)
   *   userId:  filter by userId (optional)
   *   metric:  'list'|'count'|'timeSeries'|'topEvents' (default 'list')
   *   groupBy: 'minute'|'tenMinute'|'hour'|'day' (default 'hour')
   *   limit:   max items for list (default 50)
   *   cursor:  pagination cursor for list
   */
  private handleEventsQuery(url: URL): Response {
    try {
      const range = url.searchParams.get('range') || '24h';
      const event = url.searchParams.get('event') || '';
      const userId = url.searchParams.get('userId') || '';
      const metric = url.searchParams.get('metric') || 'list';
      const groupBy = url.searchParams.get('groupBy') || 'hour';
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const cursor = url.searchParams.get('cursor') || '';

      const { startTs, endTs } = this.parseTimeRange(range);
      const sql = this.ctx.storage.sql;

      // Determine if we need _events or _events_daily
      const useDaily = range !== '1h' && range !== '6h' && range !== '24h'
        && range !== '7d' && range !== '30d' && range !== '90d';

      if (metric === 'list') {
        return this.queryEventsList(sql, startTs, endTs, event, userId, limit, cursor);
      }

      if (metric === 'count') {
        return this.queryEventsCount(sql, startTs, endTs, event, userId);
      }

      if (metric === 'timeSeries') {
        return this.queryEventsTimeSeries(sql, startTs, endTs, event, userId, groupBy, useDaily);
      }

      if (metric === 'topEvents') {
        return this.queryEventsTop(sql, startTs, endTs, userId, limit, useDaily);
      }

      return jsonResponse({ error: 'Unknown metric' }, 400);
    } catch (err) {
      console.error('[LogsDO] Events query failed:', err);
      return jsonResponse({ error: 'Events query failed' }, 500);
    }
  }

  private queryEventsList(
    sql: SqlStorage, startTs: number, endTs: number,
    event: string, userId: string, limit: number, cursor: string,
  ): Response {
    let where = `WHERE timestamp >= ? AND timestamp < ?`;
    const params: unknown[] = [startTs, endTs];

    if (event) {
      where += ` AND eventName = ?`;
      params.push(event);
    }
    if (userId) {
      where += ` AND userId = ?`;
      params.push(userId);
    }
    if (cursor) {
      where += ` AND id < ?`;
      params.push(parseInt(cursor, 10));
    }

    const rows = sql.exec(
      `SELECT id, timestamp, userId, eventName, properties FROM _events ${where} ORDER BY id DESC LIMIT ?`,
      ...params, limit + 1,
    ).toArray();

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);

    return jsonResponse({
      events: items.map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        userId: r.userId,
        eventName: r.eventName,
        properties: r.properties ? JSON.parse(r.properties as string) : null,
      })),
      cursor: hasMore && items.length > 0 ? String(items[items.length - 1].id) : undefined,
      hasMore,
    });
  }

  private queryEventsCount(
    sql: SqlStorage, startTs: number, endTs: number,
    event: string, userId: string,
  ): Response {
    let where = `WHERE timestamp >= ? AND timestamp < ?`;
    const params: unknown[] = [startTs, endTs];

    if (event) {
      where += ` AND eventName = ?`;
      params.push(event);
    }
    if (userId) {
      where += ` AND userId = ?`;
      params.push(userId);
    }

    const rows = sql.exec(
      `SELECT COUNT(*) as totalEvents, COUNT(DISTINCT userId) as uniqueUsers FROM _events ${where}`,
      ...params,
    ).toArray();

    const row = rows[0] || { totalEvents: 0, uniqueUsers: 0 };
    return jsonResponse({
      totalEvents: Number(row.totalEvents) || 0,
      uniqueUsers: Number(row.uniqueUsers) || 0,
    });
  }

  private queryEventsTimeSeries(
    sql: SqlStorage, startTs: number, endTs: number,
    event: string, userId: string, groupBy: string, useDaily: boolean,
  ): Response {
    const bucketMs = this.groupByToMs(groupBy);

    if (useDaily) {
      // Use _events_daily for ranges > 90d
      let where = `WHERE day_ts >= ? AND day_ts < ?`;
      const params: unknown[] = [startTs, endTs];
      if (event) {
        where += ` AND eventName = ?`;
        params.push(event);
      }

      const rows = sql.exec(`
        SELECT
          (CAST(day_ts / ? AS INTEGER) * ?) as ts,
          SUM(event_count) as count
        FROM _events_daily
        ${where}
        GROUP BY ts
        ORDER BY ts
      `, bucketMs, bucketMs, ...params).toArray();

      return jsonResponse({
        timeSeries: rows.map(r => ({ timestamp: r.ts, count: Number(r.count) || 0 })),
      });
    }

    // Use _events for ranges ≤ 90d
    let where = `WHERE timestamp >= ? AND timestamp < ?`;
    const params: unknown[] = [startTs, endTs];
    if (event) {
      where += ` AND eventName = ?`;
      params.push(event);
    }
    if (userId) {
      where += ` AND userId = ?`;
      params.push(userId);
    }

    const rows = sql.exec(`
      SELECT
        (CAST(timestamp / ? AS INTEGER) * ?) as ts,
        COUNT(*) as count
      FROM _events
      ${where}
      GROUP BY ts
      ORDER BY ts
    `, bucketMs, bucketMs, ...params).toArray();

    return jsonResponse({
      timeSeries: rows.map(r => ({ timestamp: r.ts, count: Number(r.count) || 0 })),
    });
  }

  private queryEventsTop(
    sql: SqlStorage, startTs: number, endTs: number,
    userId: string, limit: number, useDaily: boolean,
  ): Response {
    if (useDaily) {
      const where = `WHERE day_ts >= ? AND day_ts < ?`;
      const params: unknown[] = [startTs, endTs];

      const rows = sql.exec(`
        SELECT
          eventName,
          SUM(event_count) as count,
          SUM(unique_users) as uniqueUsers
        FROM _events_daily
        ${where}
        GROUP BY eventName
        ORDER BY count DESC
        LIMIT ?
      `, ...params, limit).toArray();

      return jsonResponse({ topEvents: rows });
    }

    let where = `WHERE timestamp >= ? AND timestamp < ?`;
    const params: unknown[] = [startTs, endTs];
    if (userId) {
      where += ` AND userId = ?`;
      params.push(userId);
    }

    const rows = sql.exec(`
      SELECT
        eventName,
        COUNT(*) as count,
        COUNT(DISTINCT userId) as uniqueUsers
      FROM _events
      ${where}
      GROUP BY eventName
      ORDER BY count DESC
      LIMIT ?
    `, ...params, limit).toArray();

    return jsonResponse({ topEvents: rows });
  }

  // ─── Utility ───

  private parseTimeRange(range: string, start?: string | null, end?: string | null): { startTs: number; endTs: number } {
    if (start && end) {
      const startTs = new Date(start).getTime();
      const endTs = new Date(end).getTime();
      if (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs >= startTs) {
        return { startTs, endTs };
      }
    }

    const now = Date.now();
    const endTs = now;
    let startTs: number;

    switch (range) {
      case '1h':  startTs = now - 3600_000;       break;
      case '6h':  startTs = now - 6 * 3600_000;   break;
      case '24h': startTs = now - 86400_000;       break;
      case '7d':  startTs = now - 7 * 86400_000;   break;
      case '30d': startTs = now - 30 * 86400_000;  break;
      case '90d': startTs = now - 90 * 86400_000;  break;
      default:    startTs = now - 86400_000;        break;
    }

    return { startTs, endTs };
  }

  /**
   * Select the appropriate table based on time range:
   *   ≤24h → _logs_raw (exact data)
   *   ≤90d → _logs_hourly (aggregated)
   *   >90d → _logs_daily (long-term)
   */
  private selectTable(range: string): string {
    switch (range) {
      case '1h':
      case '6h':
      case '24h': return '_logs_raw';
      case '7d':
      case '30d':
      case '90d': return '_logs_hourly';
      default:    return '_logs_daily';
    }
  }

  private groupByToMs(groupBy: string): number {
    switch (groupBy) {
      case 'minute': return 60_000;
      case 'tenMinute': return 600_000;
      case 'hour':   return 3600_000;
      case 'day':    return 86400_000;
      default:       return 3600_000;
    }
  }
}

// ─── Helpers ───

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Basic SQL string escaping to prevent injection in category/subcategory filters */
function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}
