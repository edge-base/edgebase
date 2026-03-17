<script lang="ts">
  /**
   * Functions Analytics — serverless function execution metrics.
   * Shows invocation counts, response times, error rates per function.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { toastError } from '$lib/stores/toast.svelte';
  import PageShell from '$lib/components/layout/PageShell.svelte';
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
  let range = $state('24h');

  const ranges = [
    { value: '1h', label: '1H' },
    { value: '6h', label: '6H' },
    { value: '24h', label: '24H' },
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
  ];

  const groupBy = $derived(() => {
    switch (range) {
      case '1h': return 'minute';
      case '6h':
      case '24h': return 'hour';
      default: return 'day';
    }
  });

  async function fetchAnalytics() {
    try {
      const res = await api.fetch<AnalyticsData>(`data/analytics?range=${range}&category=function&metric=overview&groupBy=${groupBy()}`);
      data = res;
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to load functions analytics');
    } finally {
      loading = false;
    }
  }

  function handleRangeChange(newRange: string) {
    range = newRange;
    loading = true;
    fetchAnalytics();
  }

  onMount(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 30_000);
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

<PageShell title="Functions Analytics" description="Serverless function execution and performance metrics">
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
    <MetricCard label="Invocations" value={data?.summary?.totalRequests ?? 0} {loading} />
    <MetricCard label="Unique Users" value={data?.summary?.uniqueUsers ?? 0} {loading} />
    <MetricCard label="5xx Rate" value={errorRate().toFixed(1)} unit="%" {loading} />
    <MetricCard label="Avg Duration" value={Math.round(data?.summary?.avgLatency ?? 0)} unit="ms" {loading} />
  </div>

  <div class="analytics-chart">
    <TimeChart data={chartData()} type="bar" height={240} label="Function invocations over time" {loading} color="#dc2626" />
  </div>

  <div class="analytics-bottom">
    <DistributionBar items={breakdownItems()} title="Functions by invocation count" {loading} />
    <TopList items={topItems()} title="Top Functions" {loading} />
  </div>
</PageShell>
