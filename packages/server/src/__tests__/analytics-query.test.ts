import { describe, expect, it } from 'vitest';
import {
  buildBreakdownSQL,
  buildOverviewSQL,
  buildTimeSeriesSQL,
  buildTopEndpointsSQL,
  chooseOverviewAutoRange,
  parseTimeRange,
  resolveAnalyticsGroupBy,
} from '../lib/analytics-query.js';

describe('parseTimeRange', () => {
  it('prefers explicit custom start/end when provided', () => {
    const start = '2026-01-01T00:00:00.000Z';
    const end = '2026-01-01T01:00:00.000Z';

    const result = parseTimeRange('24h', start, end);

    expect(result).toEqual({
      startTs: new Date(start).getTime(),
      endTs: new Date(end).getTime(),
    });
  });

  it('falls back to preset range when custom range is invalid', () => {
    const result = parseTimeRange('1h', 'invalid', 'also-invalid');

    expect(result.endTs).toBeGreaterThan(result.startTs);
    expect(result.endTs - result.startTs).toBeLessThanOrEqual(3_700_000);
  });
});

describe('analytics SQL builders', () => {
  it('chooses compact overview ranges from available history span', () => {
    const now = new Date('2026-01-01T12:00:00.000Z').getTime();
    expect(chooseOverviewAutoRange(now - 2 * 3_600_000, now)).toBe('1h');
    expect(chooseOverviewAutoRange(now - 8 * 3_600_000, now)).toBe('6h');
    expect(chooseOverviewAutoRange(now - 18 * 3_600_000, now)).toBe('24h');
    expect(chooseOverviewAutoRange(null, now)).toBe('1h');
  });

  it('uses shared default grouping rules for overview ranges', () => {
    expect(resolveAnalyticsGroupBy('1h')).toBe('minute');
    expect(resolveAnalyticsGroupBy('6h')).toBe('tenMinute');
    expect(resolveAnalyticsGroupBy('24h')).toBe('hour');
    expect(resolveAnalyticsGroupBy('7d')).toBe('day');
  });

  it('derives custom grouping from the selected time span', () => {
    expect(resolveAnalyticsGroupBy('24h', '2026-01-01T00:00:00.000Z', '2026-01-01T00:30:00.000Z')).toBe('minute');
    expect(resolveAnalyticsGroupBy('24h', '2026-01-01T00:00:00.000Z', '2026-01-01T03:00:00.000Z')).toBe('tenMinute');
    expect(resolveAnalyticsGroupBy('24h', '2026-01-01T00:00:00.000Z', '2026-01-02T12:00:00.000Z')).toBe('hour');
  });

  it('counts only 5xx responses as errors', () => {
    const params = { range: '24h', metric: 'overview' };
    const overviewSql = buildOverviewSQL(params).join('\n');
    const timeSeriesSql = buildTimeSeriesSQL(params);
    const breakdownSql = buildBreakdownSQL(params);
    const topSql = buildTopEndpointsSQL(params);

    for (const sql of [overviewSql, timeSeriesSql, breakdownSql, topSql]) {
      expect(sql).toContain('>= 500');
      expect(sql).not.toContain('>= 400');
    }
  });

  it('supports ten-minute grouping for medium-range views', () => {
    const overviewSql = buildOverviewSQL({ range: '6h', metric: 'overview', groupBy: 'tenMinute' }).join('\n');
    const timeSeriesSql = buildTimeSeriesSQL({ range: '6h', metric: 'timeSeries', groupBy: 'tenMinute' });

    expect(overviewSql).toContain("INTERVAL '10' MINUTE");
    expect(timeSeriesSql).toContain("INTERVAL '10' MINUTE");
  });
});
