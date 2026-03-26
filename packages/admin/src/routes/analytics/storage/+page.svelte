<script lang="ts">
  /**
   * Storage Analytics — file upload/download metrics dashboard.
   * Shows upload/download rates, bucket usage, transfer sizes.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { describeActionError } from '$lib/error-messages';
  import { getAnalyticsTimeFormatter, type PresetAnalyticsRange } from '$lib/analytics-range';
  import { toastError } from '$lib/stores/toast.svelte';
  import PageShell from '$lib/components/layout/PageShell.svelte';
  import { adminDashboardAnalyticsDocs } from '$lib/docs-links';
  import MetricCard from '$lib/components/charts/MetricCard.svelte';
  import TimeChart from '$lib/components/charts/TimeChart.svelte';
  import DistributionBar from '$lib/components/charts/DistributionBar.svelte';
  import TopList from '$lib/components/charts/TopList.svelte';

  interface AnalyticsData {
    timeSeries: Array<{ timestamp: number; requests?: number; value?: number }>;
    summary: { totalRequests: number; totalErrors: number; avgLatency: number; uniqueUsers: number };
    breakdown: Array<{ label: string; count: number; percentage: number }>;
    topItems: Array<{ label: string; count: number; avgLatency: number; errorRate: number }>;
  }

  let loading = $state(true);
  let data = $state<AnalyticsData | null>(null);
  let range = $state<PresetAnalyticsRange>('24h');

  const ranges: Array<{ value: PresetAnalyticsRange; label: string }> = [
    { value: '1h', label: '1H' },
    { value: '6h', label: '6H' },
    { value: '24h', label: '24H' },
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
  ];

  async function fetchAnalytics() {
    try {
      const res = await api.fetch<AnalyticsData>(`data/analytics?range=${range}&category=storage&metric=overview`);
      data = res;
    } catch (err) {
      toastError(describeActionError(err, 'Failed to load storage analytics.'));
    } finally {
      loading = false;
    }
  }

  function handleRangeChange(newRange: PresetAnalyticsRange) {
    range = newRange;
    loading = true;
    void fetchAnalytics();
  }

  onMount(() => {
    void fetchAnalytics();
    const interval = setInterval(() => void fetchAnalytics(), 30_000);
    return () => clearInterval(interval);
  });

  const errorRate = $derived(() => {
    if (!data?.summary) return 0;
    const { totalRequests, totalErrors } = data.summary;
    return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  });

  const chartData = $derived(() =>
    (data?.timeSeries || []).map(p => ({ timestamp: p.timestamp, value: p.requests ?? p.value ?? 0 }))
  );

  const chartTimeFormatter = $derived(getAnalyticsTimeFormatter(range));

  const breakdownItems = $derived(() =>
    (data?.breakdown || []).map(b => ({ label: b.label || 'other', value: b.count }))
  );

  const topItems = $derived(() =>
    (data?.topItems || []).map(t => ({
      label: t.label,
      count: t.count,
      secondary: `${Math.round(t.avgLatency)}ms · ${t.errorRate.toFixed(1)}% 5xx`,
    }))
  );
</script>

<PageShell title="Storage Analytics" description="File upload, download, and bucket usage metrics" docsHref={adminDashboardAnalyticsDocs}>
  {#snippet actions()}
    <div class="range-selector">
      {#each ranges as r}
        <button
          class="range-btn"
          class:range-btn--active={range === r.value}
          onclick={() => handleRangeChange(r.value)}
        >{r.label}</button>
      {/each}
    </div>
  {/snippet}

  <div class="analytics-grid">
    <MetricCard label="Storage Ops" value={data?.summary?.totalRequests ?? 0} {loading} />
    <MetricCard label="Unique Users" value={data?.summary?.uniqueUsers ?? 0} {loading} />
    <MetricCard label="5xx Rate" value={errorRate().toFixed(1)} unit="%" {loading} />
    <MetricCard label="Avg Latency" value={Math.round(data?.summary?.avgLatency ?? 0)} unit="ms" {loading} />
  </div>

  <div class="analytics-chart">
    <TimeChart data={chartData()} type="line" height={240} label="Storage operations over time" formatTime={chartTimeFormatter} {loading} color="#d97706" />
  </div>

  <div class="analytics-bottom">
    <DistributionBar items={breakdownItems()} title="Operation Distribution (upload, download, list...)" {loading} />
    <TopList items={topItems()} title="Top Buckets / Operations" {loading} />
  </div>
</PageShell>
