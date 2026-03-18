import type { GeneratedDbApi } from '@edgebase-fun/core';

type AnalyticsProperties = Record<string, string | number | boolean>;

export interface AnalyticsEvent {
  name: string;
  properties?: AnalyticsProperties;
  timestamp?: number;
}

/**
 * React Native analytics helper.
 *
 * Unlike the browser client, RN sends events immediately because there is no
 * sendBeacon/page-unload behavior to coordinate against.
 */
export class ClientAnalytics {
  constructor(private core: GeneratedDbApi) {}

  async track(name: string, properties?: AnalyticsProperties): Promise<void> {
    await this.trackBatch([{ name, properties }]);
  }

  async trackBatch(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.core.trackEvents({
      events: events.map((event) => ({
        name: event.name,
        properties: event.properties,
        timestamp: event.timestamp ?? Date.now(),
      })),
    });
  }

  async flush(): Promise<void> {
    // RN sends immediately, so flush is a compatibility no-op.
  }

  destroy(): void {
    // No retained listeners/resources in the RN implementation.
  }
}
