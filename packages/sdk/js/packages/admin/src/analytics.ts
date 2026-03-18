/**
 * AnalyticsClient — Analytics query + custom event tracking for Admin/Server SDK
 *
 * Feature 1: Request log metrics query (same data as admin dashboard)
 * Feature 2: Custom event tracking (server-side) + query
 *
 * Usage:
 *   const admin = createAdminClient(url, { serviceKey });
 *
 *   // Request log metrics
 *   const overview = await admin.analytics.overview({ range: '7d' });
 *   const ts = await admin.analytics.timeSeries({ range: '24h', category: 'db' });
 *
 *   // Custom events
 *   await admin.analytics.track('user_upgraded', { plan: 'pro', amount: 29.99 }, 'user-123');
 *   const events = await admin.analytics.queryEvents({ event: 'user_upgraded', metric: 'count' });
 */
import type { HttpClient } from '@edgebase-fun/core';
import { HttpClientAdapter, DefaultDbApi } from '@edgebase-fun/core';
import { DefaultAdminApi } from './generated/admin-api-core.js';

// ─── Feature 1: Request Log Metric Types ───

/** Options for querying request log metrics. */
export interface AnalyticsQueryOptions {
  /** Time range for the query. */
  range?: '1h' | '6h' | '24h' | '7d' | '30d' | '90d';
  /** Filter by route category (e.g. 'db', 'auth', 'storage'). */
  category?: string;
  /** Grouping interval for time series data. */
  groupBy?: 'minute' | 'hour' | 'day';
}

/** A single point in a time series. */
export interface TimeSeriesPoint {
  timestamp: number;
  requests: number;
  errors: number;
  avgLatency: number;
  uniqueUsers: number;
}

/** Aggregate summary of request metrics. */
export interface AnalyticsSummary {
  totalRequests: number;
  totalErrors: number;
  avgLatency: number;
  uniqueUsers: number;
}

/** Breakdown item (e.g. by category or status code). */
export interface BreakdownItem {
  label: string;
  count: number;
  percentage: number;
  avgLatency?: number;
  errorRate?: number;
}

/** Top endpoint/item entry. */
export interface TopItem {
  label: string;
  count: number;
  avgLatency: number;
  errorRate: number;
}

/** Full overview response from the analytics query endpoint. */
export interface AnalyticsOverview {
  timeSeries: TimeSeriesPoint[];
  summary: AnalyticsSummary;
  breakdown: BreakdownItem[];
  topItems: TopItem[];
}

// ─── Feature 2: Custom Event Types ───

/** Data for tracking a single custom event. */
export interface TrackEventData {
  /** Event name (required). */
  name: string;
  /** Arbitrary properties (max 50 keys, max 4KB JSON). */
  properties?: Record<string, string | number | boolean>;
  /** Unix timestamp in ms (default: now). */
  timestamp?: number;
  /** User ID override (Service Key only — ignored with JWT). */
  userId?: string;
}

/** Options for querying custom events. */
export interface EventQueryOptions {
  /** Time range. */
  range?: '1h' | '6h' | '24h' | '7d' | '30d' | '90d';
  /** Filter by event name. */
  event?: string;
  /** Filter by user ID. */
  userId?: string;
  /** Query metric type. */
  metric?: 'list' | 'count' | 'timeSeries' | 'topEvents';
  /** Grouping interval for time series. */
  groupBy?: 'minute' | 'hour' | 'day';
  /** Max results (for list metric). */
  limit?: number;
  /** Cursor for pagination (for list metric). */
  cursor?: string;
}

/** A single custom event record. */
export interface EventItem {
  id: number;
  timestamp: number;
  userId: string | null;
  eventName: string;
  properties: Record<string, unknown> | null;
}

/** Result for metric='list'. */
export interface EventListResult {
  events: EventItem[];
  cursor?: string;
  hasMore: boolean;
}

/** Result for metric='count'. */
export interface EventCountResult {
  totalEvents: number;
  uniqueUsers: number;
}

/** Result for metric='timeSeries'. */
export interface EventTimeSeriesResult {
  timeSeries: Array<{ timestamp: number; count: number }>;
}

/** Result for metric='topEvents'. */
export interface EventTopResult {
  topEvents: Array<{ eventName: string; count: number; uniqueUsers: number }>;
}

// ─── AnalyticsClient ───

export class AnalyticsClient {
  private core: DefaultDbApi;
  private adminCore: DefaultAdminApi;

  constructor(httpClient: HttpClient) {
    const adapter = new HttpClientAdapter(httpClient);
    this.core = new DefaultDbApi(adapter);
    this.adminCore = new DefaultAdminApi(adapter);
  }

  // ── Feature 1: Request Log Metrics ──

  /**
   * Get a full analytics overview (time series + summary + breakdown + top endpoints).
   *
   * @example
   * const overview = await admin.analytics.overview({ range: '7d' });
   * console.log(overview.summary.totalRequests);
   */
  async overview(options?: AnalyticsQueryOptions): Promise<AnalyticsOverview> {
    const query = this.buildQuery({ ...options, metric: 'overview' });
    return this.adminCore.queryAnalytics(query) as Promise<AnalyticsOverview>;
  }

  /**
   * Get time series data only.
   *
   * @example
   * const ts = await admin.analytics.timeSeries({ range: '24h', category: 'db' });
   */
  async timeSeries(options?: AnalyticsQueryOptions): Promise<TimeSeriesPoint[]> {
    const query = this.buildQuery({ ...options, metric: 'timeSeries' });
    const res = await this.adminCore.queryAnalytics(query) as { timeSeries: TimeSeriesPoint[] };
    return res.timeSeries;
  }

  /**
   * Get breakdown data (by category, status code, etc.).
   *
   * @example
   * const breakdown = await admin.analytics.breakdown({ range: '30d' });
   */
  async breakdown(options?: AnalyticsQueryOptions): Promise<BreakdownItem[]> {
    const query = this.buildQuery({ ...options, metric: 'breakdown' });
    const res = await this.adminCore.queryAnalytics(query) as { breakdown: BreakdownItem[] };
    return res.breakdown;
  }

  /**
   * Get top endpoints by request count.
   *
   * @example
   * const top = await admin.analytics.topEndpoints({ range: '7d', category: 'auth' });
   */
  async topEndpoints(options?: AnalyticsQueryOptions): Promise<TopItem[]> {
    const query = this.buildQuery({ ...options, metric: 'topEndpoints' });
    const res = await this.adminCore.queryAnalytics(query) as { topItems: TopItem[] };
    return res.topItems;
  }

  // ── Feature 2: Custom Events ──

  /**
   * Track a single custom event.
   *
   * @param name       Event name (e.g. 'user_upgraded')
   * @param properties Arbitrary key-value data (max 50 keys, max 4KB)
   * @param userId     User ID to associate (Service Key callers only)
   *
   * @example
   * await admin.analytics.track('user_upgraded', { plan: 'pro', amount: 29.99 }, 'user-123');
   */
  async track(
    name: string,
    properties?: Record<string, string | number | boolean>,
    userId?: string,
  ): Promise<void> {
    const event: Record<string, unknown> = { name };
    if (properties) event.properties = properties;
    if (userId) event.userId = userId;
    await this.core.trackEvents({ events: [event] });
  }

  /**
   * Track multiple custom events in a single request (max 100).
   *
   * @example
   * await admin.analytics.trackBatch([
   *   { name: 'page_view', properties: { path: '/pricing' } },
   *   { name: 'page_view', properties: { path: '/docs' } },
   * ]);
   */
  async trackBatch(events: TrackEventData[]): Promise<void> {
    await this.core.trackEvents({ events });
  }

  /**
   * Query custom events. Returns different shapes based on `metric`.
   *
   * @example
   * // List events
   * const list = await admin.analytics.queryEvents({ event: 'purchase', metric: 'list', limit: 20 });
   *
   * // Count
   * const count = await admin.analytics.queryEvents({ event: 'purchase', metric: 'count' });
   *
   * // Time series
   * const ts = await admin.analytics.queryEvents({ metric: 'timeSeries', groupBy: 'day' });
   *
   * // Top events
   * const top = await admin.analytics.queryEvents({ metric: 'topEvents' });
   */
  async queryEvents<T = EventListResult | EventCountResult | EventTimeSeriesResult | EventTopResult>(
    options?: EventQueryOptions,
  ): Promise<T> {
    const query: Record<string, string> = {};
    if (options?.range) query.range = options.range;
    if (options?.event) query.event = options.event;
    if (options?.userId) query.userId = options.userId;
    if (options?.metric) query.metric = options.metric;
    if (options?.groupBy) query.groupBy = options.groupBy;
    if (options?.limit) query.limit = String(options.limit);
    if (options?.cursor) query.cursor = options.cursor;
    return this.adminCore.queryCustomEvents(query) as Promise<T>;
  }

  // ── Internal ──

  private buildQuery(opts: Partial<AnalyticsQueryOptions> & { metric: string }): Record<string, string> {
    const q: Record<string, string> = { metric: opts.metric };
    if (opts.range) q.range = opts.range;
    if (opts.category) q.category = opts.category;
    if (opts.groupBy) q.groupBy = opts.groupBy;
    return q;
  }
}
