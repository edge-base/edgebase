export type PresetAnalyticsRange = '1h' | '6h' | '24h' | '7d' | '30d';
export type AnalyticsRange = PresetAnalyticsRange | 'custom';

function getCustomRangeDurationMs(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return endMs - startMs;
}

export function getAnalyticsTimeFormatter(
  range: AnalyticsRange,
  customStart?: string,
  customEnd?: string,
): (ts: number) => string {
  const customDurationMs = range === 'custom' ? getCustomRangeDurationMs(customStart, customEnd) : null;
  const useDayLabels =
    range === '7d' ||
    range === '30d' ||
    (customDurationMs !== null && customDurationMs > 48 * 60 * 60 * 1000);

  if (useDayLabels) {
    return (ts: number) => {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    };
  }

  return (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };
}
