/**
 * Analytics query builder.
 *
 * Generates SQL for Cloudflare Analytics Engine (cloud) and normalizes
 * responses into a common format consumed by the admin dashboard.
 *
 * Data Point Layout (Analytics Engine):
 *   index1:  userId ('anonymous' if not authenticated)
 *   blob1:   method        blob6:  subcategory
 *   blob2:   path          blob7:  target1
 *   blob3:   status (str)  blob8:  target2
 *   blob4:   error         blob9:  operation
 *   blob5:   category      blob10: region
 *   double1: status        double4: requestSize
 *   double2: duration      double5: responseSize
 *   double3: timestamp     double6: resultCount
 *
 * LogsDO SQLite queries are handled directly in logs-do.ts.
 * This module focuses on Analytics Engine SQL generation + response transform.
 */

// ─── Types ───

export interface QueryParams {
  range: string;      // '1h'|'6h'|'24h'|'7d'|'30d'|'90d'
  category?: string;  // filter by category
  metric: string;     // 'overview'|'timeSeries'|'breakdown'|'topEndpoints'
  groupBy?: string;   // 'minute'|'tenMinute'|'hour'|'day'
  excludeCategory?: string; // exclude a category (e.g. 'admin' to hide dashboard traffic)
  start?: string;     // ISO timestamp for custom start range
  end?: string;       // ISO timestamp for custom end range
}

export type AnalyticsGroupBy = 'minute' | 'tenMinute' | 'hour' | 'day';
export type OverviewAutoRange = '1h' | '6h' | '24h';

export interface AnalyticsSummary {
  totalRequests: number;
  totalErrors: number;
  avgLatency: number;
  uniqueUsers: number;
}

export interface TimeSeriesPoint {
  timestamp: number;
  requests: number;
  errors: number;
  avgLatency: number;
  uniqueUsers: number;
}

export interface BreakdownItem {
  label: string;
  count: number;
  percentage: number;
  avgLatency?: number;
  errorRate?: number;
}

export interface TopItem {
  label: string;
  count: number;
  avgLatency: number;
  errorRate: number;
}

export interface AnalyticsResponse {
  timeSeries: TimeSeriesPoint[];
  summary: AnalyticsSummary;
  breakdown: BreakdownItem[];
  topItems: TopItem[];
}

// ─── Time Range ───

export function parseTimeRange(range: string, start?: string, end?: string): { startTs: number; endTs: number } {
  if (start && end) {
    const startTs = new Date(start).getTime();
    const endTs = new Date(end).getTime();
    if (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs >= startTs) {
      return { startTs, endTs };
    }
  }

  const now = Date.now();
  let startTs: number;

  switch (range) {
    case '1h':  startTs = now - 3600_000;         break;
    case '6h':  startTs = now - 6 * 3600_000;     break;
    case '24h': startTs = now - 86400_000;         break;
    case '7d':  startTs = now - 7 * 86400_000;     break;
    case '30d': startTs = now - 30 * 86400_000;    break;
    case '90d': startTs = now - 90 * 86400_000;    break;
    default:    startTs = now - 86400_000;          break;
  }

  return { startTs, endTs: now };
}

export function resolveAnalyticsGroupBy(
  range: string,
  start?: string,
  end?: string,
  requestedGroupBy?: string,
): AnalyticsGroupBy {
  if (
    requestedGroupBy === 'minute' ||
    requestedGroupBy === 'tenMinute' ||
    requestedGroupBy === 'hour' ||
    requestedGroupBy === 'day'
  ) {
    return requestedGroupBy;
  }

  if (start && end) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      const diffHours = (endMs - startMs) / 3_600_000;
      if (diffHours <= 1) return 'minute';
      if (diffHours <= 6) return 'tenMinute';
      if (diffHours <= 48) return 'hour';
      return 'day';
    }
  }

  switch (range) {
    case '1h':
      return 'minute';
    case '6h':
      return 'tenMinute';
    case '7d':
    case '30d':
    case '90d':
      return 'day';
    case '24h':
    default:
      return 'hour';
  }
}

export function chooseOverviewAutoRange(oldestTimestamp: number | null, now = Date.now()): OverviewAutoRange {
  if (oldestTimestamp == null || !Number.isFinite(oldestTimestamp)) return '1h';

  const historyMs = Math.max(0, now - oldestTimestamp);
  if (historyMs <= 3 * 3_600_000) return '1h';
  if (historyMs <= 12 * 3_600_000) return '6h';
  return '24h';
}

/** Get the Analytics Engine timestamp format for a given timestamp (seconds) */
function toAETimestamp(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace('Z', '');
}

/** Get group-by interval SQL expression for Analytics Engine */
function aeGroupByInterval(groupBy: string): string {
  switch (groupBy) {
    case 'minute': return "toStartOfInterval(timestamp, INTERVAL '1' MINUTE)";
    case 'tenMinute': return "toStartOfInterval(timestamp, INTERVAL '10' MINUTE)";
    case 'hour':   return "toStartOfInterval(timestamp, INTERVAL '1' HOUR)";
    case 'day':    return "toStartOfInterval(timestamp, INTERVAL '1' DAY)";
    default:       return "toStartOfInterval(timestamp, INTERVAL '1' HOUR)";
  }
}

// ─── Escaping ───

/** Basic SQL string escaping to prevent injection in interpolated values */
function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

// ─── Analytics Engine SQL Builders ───

const AE_DATASET = 'ANALYTICS';
const SERVER_ERROR_STATUS = 500;

/** Build Analytics Engine SQL for overview query (summary + timeSeries + breakdown + topItems) */
export function buildOverviewSQL(params: QueryParams): string[] {
  const { startTs, endTs } = parseTimeRange(params.range, params.start, params.end);
  const start = toAETimestamp(startTs);
  const end = toAETimestamp(endTs);
  const catFilter = params.category ? ` AND blob5 = '${escapeSql(params.category)}'` : '';
  const excludeFilter = params.excludeCategory ? ` AND blob5 != '${escapeSql(params.excludeCategory)}'` : '';
  const interval = aeGroupByInterval(params.groupBy || 'hour');

  // 1. Summary
  const summarySQL = `
    SELECT
      SUM(_sample_interval) as totalRequests,
      SUM(IF(double1 >= ${SERVER_ERROR_STATUS}, _sample_interval, 0)) as totalErrors,
      AVG(double2) as avgLatency,
      COUNT(DISTINCT index1) as uniqueUsers
    FROM ${AE_DATASET}
    WHERE timestamp >= '${start}' AND timestamp < '${end}'${catFilter}${excludeFilter}
  `;

  // 2. Time series
  const tsSQL = `
    SELECT
      ${interval} as ts,
      SUM(_sample_interval) as requests,
      SUM(IF(double1 >= ${SERVER_ERROR_STATUS}, _sample_interval, 0)) as errors,
      AVG(double2) as avgLatency,
      COUNT(DISTINCT index1) as uniqueUsers
    FROM ${AE_DATASET}
    WHERE timestamp >= '${start}' AND timestamp < '${end}'${catFilter}${excludeFilter}
    GROUP BY ts
    ORDER BY ts
  `;

  // 3. Category breakdown
  const breakdownSQL = `
    SELECT
      blob5 as label,
      SUM(_sample_interval) as count
    FROM ${AE_DATASET}
    WHERE timestamp >= '${start}' AND timestamp < '${end}'${catFilter}${excludeFilter}
    GROUP BY blob5
    ORDER BY count DESC
    LIMIT 20
  `;

  // 4. Top endpoints
  const topSQL = `
    SELECT
      blob2 as label,
      SUM(_sample_interval) as count,
      AVG(double2) as avgLatency,
      SUM(IF(double1 >= ${SERVER_ERROR_STATUS}, _sample_interval, 0)) * 100.0 / SUM(_sample_interval) as errorRate
    FROM ${AE_DATASET}
    WHERE timestamp >= '${start}' AND timestamp < '${end}'${catFilter}${excludeFilter}
    GROUP BY blob2
    ORDER BY count DESC
    LIMIT 10
  `;

  return [summarySQL, tsSQL, breakdownSQL, topSQL];
}

/** Build Analytics Engine SQL for time series only */
export function buildTimeSeriesSQL(params: QueryParams): string {
  const { startTs, endTs } = parseTimeRange(params.range, params.start, params.end);
  const start = toAETimestamp(startTs);
  const end = toAETimestamp(endTs);
  const catFilter = params.category ? ` AND blob5 = '${escapeSql(params.category)}'` : '';
  const interval = aeGroupByInterval(params.groupBy || 'hour');

  return `
    SELECT
      ${interval} as ts,
      SUM(_sample_interval) as requests,
      SUM(IF(double1 >= ${SERVER_ERROR_STATUS}, _sample_interval, 0)) as errors,
      AVG(double2) as avgLatency,
      COUNT(DISTINCT index1) as uniqueUsers
    FROM ${AE_DATASET}
    WHERE timestamp >= '${start}' AND timestamp < '${end}'${catFilter}
    GROUP BY ts
    ORDER BY ts
  `;
}

/** Build Analytics Engine SQL for breakdown */
export function buildBreakdownSQL(params: QueryParams): string {
  const { startTs, endTs } = parseTimeRange(params.range, params.start, params.end);
  const start = toAETimestamp(startTs);
  const end = toAETimestamp(endTs);
  const catFilter = params.category ? ` AND blob5 = '${escapeSql(params.category)}'` : '';

  // If filtering by category, break down by subcategory; otherwise by category
  const groupCol = params.category ? 'blob6' : 'blob5';

  return `
    SELECT
      ${groupCol} as label,
      SUM(_sample_interval) as count,
      AVG(double2) as avgLatency,
      SUM(IF(double1 >= ${SERVER_ERROR_STATUS}, _sample_interval, 0)) * 100.0 / SUM(_sample_interval) as errorRate
    FROM ${AE_DATASET}
    WHERE timestamp >= '${start}' AND timestamp < '${end}'${catFilter}
    GROUP BY ${groupCol}
    ORDER BY count DESC
    LIMIT 20
  `;
}

/** Build Analytics Engine SQL for top endpoints */
export function buildTopEndpointsSQL(params: QueryParams): string {
  const { startTs, endTs } = parseTimeRange(params.range, params.start, params.end);
  const start = toAETimestamp(startTs);
  const end = toAETimestamp(endTs);
  const catFilter = params.category ? ` AND blob5 = '${escapeSql(params.category)}'` : '';

  return `
    SELECT
      blob2 as label,
      SUM(_sample_interval) as count,
      AVG(double2) as avgLatency,
      SUM(IF(double1 >= ${SERVER_ERROR_STATUS}, _sample_interval, 0)) * 100.0 / SUM(_sample_interval) as errorRate
    FROM ${AE_DATASET}
    WHERE timestamp >= '${start}' AND timestamp < '${end}'${catFilter}
    GROUP BY blob2
    ORDER BY count DESC
    LIMIT 20
  `;
}

// ─── Response Transformers ───

/** Transform Analytics Engine API response to standard format */
export function transformAEResponse(
  summaryData: AEQueryResult,
  timeSeriesData: AEQueryResult,
  breakdownData: AEQueryResult,
  topData: AEQueryResult,
): AnalyticsResponse {
  // Summary
  const summaryRow = summaryData.data?.[0] || {};
  const summary: AnalyticsSummary = {
    totalRequests: Number(summaryRow.totalRequests) || 0,
    totalErrors: Number(summaryRow.totalErrors) || 0,
    avgLatency: Number(summaryRow.avgLatency) || 0,
    uniqueUsers: Number(summaryRow.uniqueUsers) || 0,
  };

  // Time series
  const timeSeries: TimeSeriesPoint[] = (timeSeriesData.data || []).map(row => ({
    timestamp: new Date(row.ts as string).getTime(),
    requests: Number(row.requests) || 0,
    errors: Number(row.errors) || 0,
    avgLatency: Number(row.avgLatency) || 0,
    uniqueUsers: Number(row.uniqueUsers) || 0,
  }));

  // Breakdown
  const rawBreakdown = breakdownData.data || [];
  const totalBd = rawBreakdown.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
  const breakdown: BreakdownItem[] = rawBreakdown.map(row => ({
    label: String(row.label || 'other'),
    count: Number(row.count) || 0,
    percentage: totalBd > 0 ? Math.round((Number(row.count) / totalBd) * 1000) / 10 : 0,
    avgLatency: Number(row.avgLatency) || 0,
    errorRate: Number(row.errorRate) || 0,
  }));

  // Top items
  const topItems: TopItem[] = (topData.data || []).map(row => ({
    label: String(row.label || ''),
    count: Number(row.count) || 0,
    avgLatency: Number(row.avgLatency) || 0,
    errorRate: Number(row.errorRate) || 0,
  }));

  return { timeSeries, summary, breakdown, topItems };
}

/** Empty analytics response (used when no backend is available) */
export function emptyResponse(): AnalyticsResponse {
  return {
    timeSeries: [],
    summary: { totalRequests: 0, totalErrors: 0, avgLatency: 0, uniqueUsers: 0 },
    breakdown: [],
    topItems: [],
  };
}

// ─── Analytics Engine API Types ───

export interface AEQueryResult {
  data: Record<string, unknown>[];
  meta?: Record<string, unknown>[];
  rows?: number;
}

/**
 * Execute a SQL query against the Analytics Engine SQL API.
 * Requires CF_ACCOUNT_ID and CF_API_TOKEN environment variables.
 */
export async function queryAnalyticsEngine(
  sql: string,
  accountId: string,
  apiToken: string,
): Promise<AEQueryResult> {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      body: sql,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'text/plain',
      },
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Analytics Engine query failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as AEQueryResult;
}

async function queryAnalyticsHistoryStart(
  accountId: string,
  apiToken: string,
  excludeCategory?: string,
): Promise<number | null> {
  const excludeFilter = excludeCategory ? ` WHERE blob5 != '${escapeSql(excludeCategory)}'` : '';
  const result = await queryAnalyticsEngine(
    `SELECT MIN(timestamp) as oldestTs FROM ${AE_DATASET}${excludeFilter}`,
    accountId,
    apiToken,
  );
  const raw = result.data?.[0]?.oldestTs;
  if (!raw) return null;
  const parsed = typeof raw === 'number' ? raw : new Date(String(raw)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export async function resolveOverviewAutoRange(
  env: { ANALYTICS?: AnalyticsEngineDataset; CF_ACCOUNT_ID?: string; CF_API_TOKEN?: string; LOGS?: DurableObjectNamespace },
  excludeCategory?: string,
): Promise<OverviewAutoRange> {
  if (env.ANALYTICS && env.CF_ACCOUNT_ID && env.CF_API_TOKEN) {
    try {
      const oldestTimestamp = await queryAnalyticsHistoryStart(
        env.CF_ACCOUNT_ID,
        env.CF_API_TOKEN,
        excludeCategory,
      );
      return chooseOverviewAutoRange(oldestTimestamp);
    } catch (err) {
      console.error('[Analytics] Failed to resolve history start from AE:', err);
    }
  }

  if (env.LOGS) {
    try {
      const logsDO = env.LOGS.get(env.LOGS.idFromName('logs:main'));
      const params = new URLSearchParams();
      if (excludeCategory) params.set('excludeCategory', excludeCategory);
      const resp = await logsDO.fetch(
        new Request(`http://internal/internal/logs/history?${params.toString()}`),
      );
      if (resp.ok) {
        const body = (await resp.json()) as { oldestTimestamp?: number | null };
        return chooseOverviewAutoRange(body.oldestTimestamp ?? null);
      }
    } catch (err) {
      console.error('[Analytics] Failed to resolve history start from LogsDO:', err);
    }
  }

  return '1h';
}

// ─── Shared Query Executor ───

/**
 * Execute analytics query against the appropriate backend (AE or LogsDO).
 * Used by both /admin/api/data/analytics and /api/analytics/query.
 */
export async function executeAnalyticsQuery(
  env: { ANALYTICS?: AnalyticsEngineDataset; CF_ACCOUNT_ID?: string; CF_API_TOKEN?: string; LOGS?: DurableObjectNamespace },
  params: QueryParams,
): Promise<AnalyticsResponse> {
  // Cloud: Analytics Engine SQL API
  if (env.ANALYTICS && env.CF_ACCOUNT_ID && env.CF_API_TOKEN) {
    try {
      if (params.metric === 'overview') {
        const sqls = buildOverviewSQL(params);
        const [summary, timeSeries, breakdown, top] = await Promise.all(
          sqls.map(sql => queryAnalyticsEngine(sql, env.CF_ACCOUNT_ID!, env.CF_API_TOKEN!)),
        );
        return transformAEResponse(summary, timeSeries, breakdown, top);
      }

      if (params.metric === 'timeSeries') {
        const sql = buildTimeSeriesSQL(params);
        const result = await queryAnalyticsEngine(sql, env.CF_ACCOUNT_ID!, env.CF_API_TOKEN!);
        return {
          ...emptyResponse(),
          timeSeries: (result.data || []).map(row => ({
            timestamp: new Date(row.ts as string).getTime(),
            requests: Number(row.requests) || 0,
            errors: Number(row.errors) || 0,
            avgLatency: Number(row.avgLatency) || 0,
            uniqueUsers: Number(row.uniqueUsers) || 0,
          })),
        };
      }

      if (params.metric === 'breakdown') {
        const sql = buildBreakdownSQL(params);
        const result = await queryAnalyticsEngine(sql, env.CF_ACCOUNT_ID!, env.CF_API_TOKEN!);
        const rows = result.data || [];
        const total = rows.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
        return {
          ...emptyResponse(),
          breakdown: rows.map(r => ({
            label: String(r.label || 'other'),
            count: Number(r.count) || 0,
            percentage: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
            avgLatency: Number(r.avgLatency) || 0,
            errorRate: Number(r.errorRate) || 0,
          })),
        };
      }

      if (params.metric === 'topEndpoints') {
        const sql = buildTopEndpointsSQL(params);
        const result = await queryAnalyticsEngine(sql, env.CF_ACCOUNT_ID!, env.CF_API_TOKEN!);
        return {
          ...emptyResponse(),
          topItems: (result.data || []).map(r => ({
            label: String(r.label || ''),
            count: Number(r.count) || 0,
            avgLatency: Number(r.avgLatency) || 0,
            errorRate: Number(r.errorRate) || 0,
          })),
        };
      }
    } catch (err) {
      console.error('[Analytics] AE query failed:', err);
      // Fall through to LogsDO
    }
  }

  // Docker/Self-hosted: LogsDO SQLite query proxy
  if (env.LOGS) {
    try {
      const logsDO = env.LOGS.get(env.LOGS.idFromName('logs:main'));
      const queryParams = new URLSearchParams({
        range: params.range,
        category: params.category || '',
        metric: params.metric,
        groupBy: params.groupBy || 'hour',
        excludeCategory: params.excludeCategory || '',
      });
      if (params.start) queryParams.set('start', params.start);
      if (params.end) queryParams.set('end', params.end);
      const resp = await logsDO.fetch(
        new Request(`http://internal/internal/logs/query?${queryParams}`),
      );
      if (!resp.ok) {
        console.error('[Analytics] LogsDO query returned', resp.status);
        return emptyResponse();
      }
      return (await resp.json()) as AnalyticsResponse;
    } catch (err) {
      console.error('[Analytics] LogsDO query failed:', err);
    }
  }

  // No analytics backend available
  return emptyResponse();
}

// ─── Type Helpers for executeAnalyticsQuery ───

interface AnalyticsEngineDataset {
  writeDataPoint(event: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
