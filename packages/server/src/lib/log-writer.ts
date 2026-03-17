/**
 * LogWriter adapter pattern.
 *
 * Provides environment-aware log storage with extended analytics fields:
 * - Cloud:         AnalyticsEngineWriter — 10 blobs, 6 doubles
 * - Docker/Self-hosted: SQLiteLogWriter — LogsDO with 3-tier pre-aggregation
 * - Dev fallback:  ConsoleLogWriter — structured console output
 *
 * Usage:
 *   const logger = createLogWriter(env, executionCtx);
 *   logger.write({ method, path, status, duration, userId, category, ... });
 *
 * Data Point Layout (Analytics Engine):
 *   index1:  userId (or 'anonymous')
 *   blob1:   method        blob6:  subcategory
 *   blob2:   path          blob7:  target1
 *   blob3:   status (str)  blob8:  target2
 *   blob4:   error         blob9:  operation
 *   blob5:   category      blob10: region
 *   double1: status        double4: requestSize
 *   double2: duration      double5: responseSize
 *   double3: timestamp     double6: resultCount
 */

// ─── Types ───

export interface LogEntry {
  // Core fields (original)
  method: string;
  path: string;
  status: number;
  duration: number;
  userId?: string;
  error?: string;
  timestamp?: number;
  // Route classification (from route-parser)
  category?: string;
  subcategory?: string;
  target1?: string;
  target2?: string;
  operation?: string;
  // Request context
  region?: string;
  requestSize?: number;
  responseSize?: number;
  resultCount?: number;
}

export interface QueryResult {
  data: Record<string, unknown>[];
}

export interface LogWriter {
  write(entry: LogEntry): void;
  query(sql: string): Promise<QueryResult>;
}

function isDurableObjectResetError(err: unknown): boolean {
  return (
    typeof err === 'object'
    && err !== null
    && 'durableObjectReset' in err
    && (err as { durableObjectReset?: unknown }).durableObjectReset === true
  );
}

// ─── AnalyticsEngineWriter (Cloud) ───

/**
 * Log writer using Cloudflare Analytics Engine.
 * Non-blocking fire-and-forget write. 10 blobs + 6 doubles per data point.
 * SQL API queries are proxied via admin endpoint (requires CF account credentials).
 */
export class AnalyticsEngineWriter implements LogWriter {
  constructor(private analytics: AnalyticsEngineDataset) {}

  write(entry: LogEntry): void {
    this.analytics.writeDataPoint({
      indexes: [entry.userId || 'anonymous'],
      blobs: [
        entry.method,                      // blob1
        entry.path,                        // blob2
        String(entry.status),              // blob3
        entry.error || '',                 // blob4
        entry.category || '',              // blob5
        entry.subcategory || '',           // blob6
        entry.target1 || '',               // blob7
        entry.target2 || '',               // blob8
        entry.operation || '',             // blob9
        entry.region || '',                // blob10
      ],
      doubles: [
        entry.status,                      // double1
        entry.duration,                    // double2
        entry.timestamp || Date.now(),     // double3
        entry.requestSize || 0,            // double4
        entry.responseSize || 0,           // double5
        entry.resultCount || 0,            // double6
      ],
    });
  }

  async query(_sql: string): Promise<QueryResult> {
    // Analytics Engine SQL API requires account-level credentials
    // and is called via the Cloudflare REST API, not from Workers.
    // Admin endpoint /admin/api/data/analytics proxies these queries.
    return { data: [] };
  }
}

// ─── SQLiteLogWriter (Docker / Self-hosted) ───

/**
 * Log writer that buffers entries and flushes to LogsDO in batches.
 * LogsDO stores logs in SQLite with 3-tier pre-aggregation:
 *   _logs_raw (24h) → _logs_hourly (90d) → _logs_daily (permanent)
 *
 * Buffering: flushes at 50 entries or after 100ms, whichever comes first.
 * Uses ExecutionContext.waitUntil() for non-blocking writes.
 *
 * Retry policy: failed batches are re-queued once (retried = true).
 * If a retried batch fails again, entries fall back to console.
 * Buffer is capped at 1000 entries to prevent memory exhaustion.
 */
export class SQLiteLogWriter implements LogWriter {
  private static readonly MAX_BUFFER = 1000;
  private buffer: (LogEntry & { _retried?: boolean })[] = [];
  private flushScheduled = false;

  constructor(
    private logsDO: { fetch: (input: RequestInfo) => Promise<Response> },
    private ctx?: { waitUntil: (promise: Promise<unknown>) => void },
  ) {}

  write(entry: LogEntry): void {
    if (this.buffer.length >= SQLiteLogWriter.MAX_BUFFER) {
      // Drop oldest to prevent memory exhaustion
      this.buffer.shift();
    }
    this.buffer.push(entry);

    if (this.buffer.length >= 50) {
      // Immediate flush when buffer is full
      const promise = this.flush();
      if (this.ctx) {
        this.ctx.waitUntil(promise);
      }
    } else if (!this.flushScheduled) {
      // Schedule delayed flush for batching
      this.flushScheduled = true;
      const promise = this.scheduledFlush();
      if (this.ctx) {
        this.ctx.waitUntil(promise);
      }
    }
  }

  private async scheduledFlush(): Promise<void> {
    await new Promise(r => setTimeout(r, 100));
    this.flushScheduled = false;
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (!this.buffer.length) return;
    const batch = [...this.buffer];
    this.buffer = [];

    try {
      await this.logsDO.fetch(
        new Request('http://internal/internal/logs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: batch }),
        }),
      );
    } catch (err) {
      // Split batch: re-queue entries that haven't been retried yet
      const retryable = batch.filter(e => !e._retried);
      const dropped = batch.filter(e => e._retried);

      if (retryable.length) {
        for (const e of retryable) e._retried = true;
        // Re-queue at front, respecting buffer cap
        const space = SQLiteLogWriter.MAX_BUFFER - this.buffer.length;
        this.buffer.unshift(...retryable.slice(0, space));
      }

      if (isDurableObjectResetError(err)) {
        return;
      }

      if (dropped.length) {
        console.error(`[EdgeBase] Failed to write ${dropped.length} logs to LogsDO (retry exhausted):`, err);
        for (const entry of dropped) {
          console.log(`[LOG] ${entry.method} ${entry.path} ${entry.status} ${entry.duration}ms`);
        }
      } else {
        console.warn(`[EdgeBase] LogsDO write failed, ${retryable.length} entries queued for retry:`, err);
      }
    }
  }

  async query(sql: string): Promise<QueryResult> {
    try {
      const params = new URLSearchParams({ sql });
      const resp = await this.logsDO.fetch(
        new Request(`http://internal/internal/logs/query?${params}`),
      );
      return (await resp.json()) as QueryResult;
    } catch {
      return { data: [] };
    }
  }
}

// ─── ConsoleLogWriter (Dev fallback) ───

/**
 * Fallback log writer for local development.
 * Outputs structured log lines to console. No persistence.
 */
export class ConsoleLogWriter implements LogWriter {
  write(entry: LogEntry): void {
    const ts = new Date(entry.timestamp || Date.now()).toISOString();
    const cat = entry.category ? ` [${entry.category}]` : '';
    const line = `[${ts}]${cat} ${entry.method} ${entry.path} ${entry.status} ${entry.duration}ms${entry.userId ? ` user=${entry.userId}` : ''}${entry.error ? ` error=${entry.error}` : ''}`;
    if (entry.status >= 500) {
      console.error(line);
    } else if (entry.status >= 400) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  async query(_sql: string): Promise<QueryResult> {
    return { data: [] };
  }
}

// ─── Factory ───

/**
 * Create the appropriate LogWriter based on environment bindings.
 *
 * Priority:
 *   1. env.ANALYTICS exists → AnalyticsEngineWriter (Cloud)
 *   2. env.LOGS exists      → SQLiteLogWriter (Docker / Self-hosted)
 *   3. Otherwise            → ConsoleLogWriter (dev fallback)
 */
export function createLogWriter(
  env: Record<string, unknown>,
  executionCtx?: { waitUntil: (promise: Promise<unknown>) => void },
): LogWriter {
  // Cloud: Analytics Engine
  const analytics = env.ANALYTICS as AnalyticsEngineDataset | undefined;
  if (analytics) {
    return new AnalyticsEngineWriter(analytics);
  }

  // Docker / Self-hosted: LogsDO SQLite
  const logsNs = env.LOGS as { idFromName: (name: string) => { toString: () => string }; get: (id: unknown) => { fetch: (input: RequestInfo) => Promise<Response> } } | undefined;
  if (logsNs) {
    const logsId = logsNs.idFromName('logs:main');
    const logsDO = logsNs.get(logsId);
    return new SQLiteLogWriter(logsDO, executionCtx);
  }

  // Dev fallback
  return new ConsoleLogWriter();
}
