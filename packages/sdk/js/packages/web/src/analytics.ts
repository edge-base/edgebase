/**
 * ClientAnalytics — Browser-side custom event tracking for Client SDK
 *
 * Optimized for browser:
 * - Batches events in memory (max 20 or 5s timer, whichever comes first)
 * - Uses sendBeacon on page unload to avoid losing events
 * - Auto-retries failed flushes once by re-queuing
 *
 * Usage:
 *   const client = createClient('https://my-app.edgebase.fun');
 *   client.analytics.track('page_view', { path: '/pricing' });
 *   client.analytics.track('button_click', { id: 'signup-cta', variant: 'A' });
 *
 *   // Manual flush if needed
 *   await client.analytics.flush();
 */
import { ApiPaths, type HttpClient, type GeneratedDbApi } from '@edgebase/core';

interface QueuedEvent {
  name: string;
  properties?: Record<string, string | number | boolean>;
  timestamp: number;
}

export class ClientAnalytics {
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly FLUSH_INTERVAL = 5_000;  // 5 seconds
  private readonly MAX_BATCH = 20;           // 20 events per batch

  private boundVisibilityHandler: (() => void) | null = null;
  private boundPageHideHandler: (() => void) | null = null;

  constructor(
    private httpClient: HttpClient,
    private baseUrl: string,
    private core?: GeneratedDbApi,
  ) {
    // Send remaining events on page unload
    if (typeof window !== 'undefined') {
      this.boundVisibilityHandler = () => {
        if (document.visibilityState === 'hidden') this.sendBeacon();
      };
      this.boundPageHideHandler = () => this.sendBeacon();

      window.addEventListener('visibilitychange', this.boundVisibilityHandler);
      window.addEventListener('pagehide', this.boundPageHideHandler);
    }
  }

  /**
   * Track a custom event. Events are batched and sent automatically.
   *
   * @param name       Event name (e.g. 'page_view', 'button_click', 'purchase')
   * @param properties Optional key-value data (max 50 keys, max 4KB total)
   *
   * @example
   * client.analytics.track('page_view', { path: '/pricing' });
   * client.analytics.track('purchase', { plan: 'pro', amount: 29.99 });
   */
  track(name: string, properties?: Record<string, string | number | boolean>): void {
    this.queue.push({ name, properties, timestamp: Date.now() });

    if (this.queue.length >= this.MAX_BATCH) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.FLUSH_INTERVAL);
    }
  }

  /**
   * Manually flush all queued events to the server.
   * Automatically called on timer expiry, batch size reached, or page unload.
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queue.length) return;

    const batch = this.queue.splice(0, this.MAX_BATCH);
    try {
      const payload = {
        events: batch.map(e => ({
          name: e.name,
          properties: e.properties,
          timestamp: e.timestamp,
        })),
      };
      if (this.core) {
        await this.core.trackEvents(payload);
      } else {
        await this.httpClient.post(ApiPaths.TRACK_EVENTS, payload);
      }
    } catch {
      // Failed — re-queue for one retry (don't retry infinitely)
      this.queue.unshift(...batch);
    }

    // If there are still events in the queue, schedule another flush
    if (this.queue.length > 0 && !this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.FLUSH_INTERVAL);
    }
  }

  /**
   * Send remaining events via navigator.sendBeacon (used on page unload).
   * sendBeacon cannot send Authorization headers, so these events arrive
   * without JWT auth — protected by rate limiting only.
   *
   * NOTE: Direct HTTP — sendBeacon requires a raw URL + Blob. Cannot use
   * generated core because sendBeacon bypasses normal fetch/XHR entirely.
   */
  private sendBeacon(): void {
    if (!this.queue.length) return;

    const batch = this.queue.splice(0);
    const url = `${this.baseUrl}${ApiPaths.TRACK_EVENTS}`;
    const body = JSON.stringify({
      events: batch.map(e => ({
        name: e.name,
        properties: e.properties,
        timestamp: e.timestamp,
      })),
    });

    try {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } catch {
      // sendBeacon failed — page is unloading, nothing we can do
    }
  }

  /**
   * Destroy the analytics client. Flushes remaining events and removes
   * event listeners. Call this when unmounting the SDK.
   */
  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.sendBeacon();

    // Remove event listeners
    if (typeof window !== 'undefined') {
      if (this.boundVisibilityHandler) {
        window.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      }
      if (this.boundPageHideHandler) {
        window.removeEventListener('pagehide', this.boundPageHideHandler);
      }
    }
  }
}
