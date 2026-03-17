/**
 * @edgebase/admin — Admin/Server-side EdgeBase SDK (Node.js / Edge Functions).
 *: 독립 패키지
 *
 * Usage:
 * ```ts
 * import { createAdminClient } from '@edgebase/admin';
 * const admin = createAdminClient('https://my-app.edgebase.fun', { serviceKey: '...' });
 * ```
 */

// Admin entry point
export { AdminEdgeBase, createAdminClient, type JuneAdminClientOptions } from './client.js';

// Admin modules
export { AdminAuthClient } from './admin-auth.js';
export { KvClient } from './kv.js';
export { D1Client } from './d1.js';
export { VectorizeClient } from './vectorize.js';
export { PushClient, type PushPayload, type PushResult, type PushLogEntry, type DeviceTokenInfo } from './push.js';
export {
  AnalyticsClient,
  type AnalyticsQueryOptions,
  type AnalyticsOverview,
  type TimeSeriesPoint,
  type AnalyticsSummary,
  type BreakdownItem,
  type TopItem,
  type TrackEventData,
  type EventQueryOptions,
  type EventItem,
  type EventListResult,
  type EventCountResult,
  type EventTimeSeriesResult,
  type EventTopResult,
} from './analytics.js';
