/**
 * AnalyticsAdapter pattern.
 *
 * Provides environment-aware analytics storage for App Functions:
 * - Cloud:         AnalyticsEngineAdapter (separate ANALYTICS_APP dataset)
 * - Self-hosted:   ConsoleAnalyticsAdapter (fallback)
 *
 * Separate from LogWriter (#83) — different lifecycle & retention policy.
 * LogWriter = operational metrics, AnalyticsAdapter = business analytics.
 *
 * Usage (inside App Functions):
 *   ctx.analytics.write({ event: 'page_view', blobs: ['/home'], doubles: [1] });
 *   const result = await ctx.analytics.query({ sql: 'SELECT ...' });
 */

// ─── Types ───

export interface AnalyticsDataPoint {
  event: string;              // e.g. 'page_view', 'button_click'
  blobs?: string[];           // String dimensions (max 20)
  doubles?: number[];         // Numeric metrics (max 20)
  timestamp?: number;         // Default: Date.now()
}

export interface AnalyticsQuery {
  sql: string;                // Cloud: Analytics Engine SQL API, self-hosted: SQLite SQL
  timeRange?: { start: string; end: string };
}

export interface AnalyticsResult {
  data: Record<string, unknown>[];
}

export interface AnalyticsAdapter {
  write(dataPoint: AnalyticsDataPoint): void;
  query(params: AnalyticsQuery): Promise<AnalyticsResult>;
}

// ─── AnalyticsEngineAdapter (Cloud) ───

/**
 * Analytics adapter using a dedicated Cloudflare Analytics Engine dataset.
 * Separate from LogWriter's ANALYTICS binding — uses ANALYTICS_APP binding.
 * Non-blocking fire-and-forget write. SQL API for queries.
 */
export class AnalyticsEngineAdapter implements AnalyticsAdapter {
  constructor(private engine: AnalyticsEngineDataset) {}

  write(dp: AnalyticsDataPoint): void {
    this.engine.writeDataPoint({
      indexes: [dp.event],
      blobs: [dp.event, ...(dp.blobs || [])],
      doubles: [...(dp.doubles || []), dp.timestamp || Date.now()],
    });
  }

  async query(_params: AnalyticsQuery): Promise<AnalyticsResult> {
    // Analytics Engine SQL API requires account-level credentials
    // and is called via the Cloudflare REST API, not from Workers.
    // App Functions should use client.functions.call() → server-side query endpoint.
    return { data: [] };
  }
}

// ─── ConsoleAnalyticsAdapter (Self-hosted / Dev fallback) ───

/**
 * Fallback analytics adapter using console.log.
 * Used when neither Analytics Engine nor SQLite analytics DB is available.
 *
 * Note: In production self-hosted, this would use a dedicated SQLite file (analytics.db).
 * For M19, we implement the interface and fall back to console logging
 * when ANALYTICS_APP binding is not present.
 */
export class ConsoleAnalyticsAdapter implements AnalyticsAdapter {
  write(dp: AnalyticsDataPoint): void {
    const ts = new Date(dp.timestamp || Date.now()).toISOString();
    console.log(
      `[EdgeBase:Analytics] ${ts} event=${dp.event}` +
      (dp.blobs?.length ? ` blobs=[${dp.blobs.join(',')}]` : '') +
      (dp.doubles?.length ? ` doubles=[${dp.doubles.join(',')}]` : ''),
    );
  }

  async query(_params: AnalyticsQuery): Promise<AnalyticsResult> {
    return { data: [] };
  }
}

// ─── Factory ───

/**
 * Create the appropriate AnalyticsAdapter based on environment bindings.
 * - `env.ANALYTICS_APP` exists → AnalyticsEngineAdapter (separate from LogWriter's ANALYTICS)
 * - Otherwise → ConsoleAnalyticsAdapter (fallback)
 */
export function createAnalyticsAdapter(env: Record<string, unknown>): AnalyticsAdapter {
  const analyticsApp = env.ANALYTICS_APP as AnalyticsEngineDataset | undefined;
  if (analyticsApp) {
    return new AnalyticsEngineAdapter(analyticsApp);
  }
  return new ConsoleAnalyticsAdapter();
}
