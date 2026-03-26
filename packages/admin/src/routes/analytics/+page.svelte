<script lang="ts">
  /**
   * Analytics Overview — main analytics dashboard page.
   * Shows summary metrics, request time series, category distribution,
   * and top endpoints.
   */
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { describeActionError } from '$lib/error-messages';
  import { getAnalyticsTimeFormatter, type AnalyticsRange } from '$lib/analytics-range';
  import { toastError } from '$lib/stores/toast.svelte';
  import PageShell from '$lib/components/layout/PageShell.svelte';
  import { adminDashboardAnalyticsDocs } from '$lib/docs-links';
  import MetricCard from '$lib/components/charts/MetricCard.svelte';
  import TimeChart from '$lib/components/charts/TimeChart.svelte';
  import DistributionBar from '$lib/components/charts/DistributionBar.svelte';
  import TopList from '$lib/components/charts/TopList.svelte';

  // ─── Types ───

  interface AnalyticsData {
    timeSeries: Array<{ timestamp: number; requests?: number; value?: number; errors?: number; avgLatency?: number; uniqueUsers?: number }>;
    summary: { totalRequests: number; totalErrors: number; avgLatency: number; uniqueUsers: number };
    breakdown: Array<{ label: string; count: number; percentage: number }>;
    topItems: Array<{ label: string; count: number; avgLatency: number; errorRate: number }>;
  }

  // ─── State ───

  let loading = $state(true);
  let data = $state<AnalyticsData | null>(null);
  let range = $state<AnalyticsRange>('24h');
  let autoRefresh = $state(true);
  let lastUpdated = $state('');
  let excludeAdminTraffic = $state(false);

  const ranges: Array<{ value: AnalyticsRange; label: string }> = [
    { value: '1h', label: '1H' },
    { value: '6h', label: '6H' },
    { value: '24h', label: '24H' },
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: 'custom', label: 'Custom' },
  ];

  // Custom date range
  let customStart = $state('');
  let customEnd = $state('');

  const customRangeError = $derived(() => {
    if (range !== 'custom' || !customStart || !customEnd) return '';
    const startMs = new Date(customStart).getTime();
    const endMs = new Date(customEnd).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 'Enter a valid start and end time.';
    if (endMs < startMs) return 'End time must be after the start time.';
    return '';
  });

  // ─── Data Fetching ───

  async function fetchAnalytics() {
    try {
      const params = new URLSearchParams({ metric: 'overview' });
      if (range === 'custom' && customStart && customEnd) {
        params.set('start', new Date(customStart).toISOString());
        params.set('end', new Date(customEnd).toISOString());
      } else {
        params.set('range', range);
      }
      if (excludeAdminTraffic) {
        params.set('excludeCategory', 'admin');
      }
      const url = `data/analytics?${params.toString()}`;
      const res = await api.fetch<AnalyticsData>(url);
      data = res;
      lastUpdated = new Date().toLocaleTimeString();
    } catch (err) {
      toastError(describeActionError(err, 'Failed to load analytics data.'));
    } finally {
      loading = false;
    }
  }

  function handleRangeChange(newRange: AnalyticsRange) {
    range = newRange;
    if (newRange !== 'custom') {
      loading = true;
      void fetchAnalytics();
    }
  }

  function handleExcludeAdminTrafficToggle() {
    excludeAdminTraffic = !excludeAdminTraffic;
    if (range !== 'custom' || (customStart && customEnd && !customRangeError())) {
      loading = true;
      void fetchAnalytics();
    }
  }

  function applyCustomRange() {
    if (!customStart || !customEnd) return;
    if (customRangeError()) {
      toastError(customRangeError());
      return;
    }
    loading = true;
    void fetchAnalytics();
  }

  // ─── Lifecycle ───

  onMount(() => {
    void fetchAnalytics();

    const interval = setInterval(() => {
      if (autoRefresh) {
        void fetchAnalytics();
      }
    }, 30_000); // 30s refresh

    return () => clearInterval(interval);
  });

  // ─── Derived values ───

  const errorRate = $derived(() => {
    if (!data?.summary) return 0;
    const { totalRequests, totalErrors } = data.summary;
    return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  });

  const chartData = $derived(() => {
    if (!data?.timeSeries) return [];
    return data.timeSeries.map(p => ({
      timestamp: p.timestamp,
      value: p.requests ?? p.value ?? 0,
    }));
  });

  const chartTimeFormatter = $derived(getAnalyticsTimeFormatter(range, customStart, customEnd));

  const breakdownItems = $derived(() => {
    if (!data?.breakdown) return [];
    return data.breakdown.map(b => ({
      label: b.label || 'other',
      value: b.count,
    }));
  });

  const topItems = $derived(() => {
    if (!data?.topItems) return [];
    return data.topItems.map(t => ({
      label: t.label,
      count: t.count,
      secondary: `${Math.round(t.avgLatency)}ms avg · ${t.errorRate.toFixed(1)}% 5xx`,
    }));
  });
</script>

<PageShell title="Analytics" description="API traffic and performance overview" docsHref={adminDashboardAnalyticsDocs}>
  {#snippet actions()}
    <div class="analytics-actions">
      <div class="analytics-actions__ranges">
        {#each ranges as r}
          <button
            class="analytics-actions__range-btn"
            class:analytics-actions__range-btn--active={range === r.value}
            onclick={() => handleRangeChange(r.value)}
          >{r.label}</button>
        {/each}
      </div>

      <button
        type="button"
        class="analytics-actions__filter-btn"
        class:analytics-actions__filter-btn--active={excludeAdminTraffic}
        onclick={handleExcludeAdminTrafficToggle}
      >
        Exclude admin traffic
      </button>

      {#if range === 'custom'}
        <div class="analytics-actions__custom">
          <input type="datetime-local" class="custom-date-input" bind:value={customStart} />
          <span class="custom-date-sep">→</span>
          <input type="datetime-local" class="custom-date-input" bind:value={customEnd} />
          <button
            class="custom-date-apply"
            onclick={applyCustomRange}
            disabled={!customStart || !customEnd || !!customRangeError()}
          >Apply</button>
        </div>
      {/if}

      <div class="analytics-actions__status">
        {#if lastUpdated}
          <span class="analytics-actions__updated">Updated {lastUpdated}</span>
        {/if}
        <button
          class="analytics-actions__refresh-btn"
          class:analytics-actions__refresh-btn--active={autoRefresh}
          onclick={() => autoRefresh = !autoRefresh}
          title={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
        >
          {#if autoRefresh}
            <span class="analytics-actions__dot"></span>
          {/if}
          ⟳
        </button>
      </div>
    </div>
  {/snippet}

  <!-- Metric Cards -->
  <div class="analytics-grid">
    <MetricCard
      label="Total Requests"
      value={data?.summary?.totalRequests ?? 0}
      {loading}
      icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 14V8L5 4L8 7L11 2L14 6V14H2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    />
    <MetricCard
      label="Unique Users"
      value={data?.summary?.uniqueUsers ?? 0}
      {loading}
      icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 14C3 11.2386 5.23858 9 8 9C10.7614 9 13 11.2386 13 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
    />
    <MetricCard
      label="5xx Rate"
      value={errorRate().toFixed(1)}
      unit="%"
      {loading}
      icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5V9M8 11V11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
    />
    <MetricCard
      label="Avg Latency"
      value={Math.round(data?.summary?.avgLatency ?? 0)}
      unit="ms"
      {loading}
      icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 4V8L10.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    />
  </div>

  <!-- Time Series Chart -->
  <div class="analytics-chart">
    <TimeChart
      data={chartData()}
      type="line"
      height={260}
      label="Requests over time"
      formatTime={chartTimeFormatter}
      {loading}
    />
  </div>

  {#if range === 'custom' && customRangeError()}
    <p class="analytics-custom-error">{customRangeError()}</p>
  {/if}

  <!-- Bottom row: Distribution + Top Endpoints -->
  <div class="analytics-bottom">
    <DistributionBar
      items={breakdownItems()}
      title="Category Distribution"
      {loading}
    />
    <TopList
      items={topItems()}
      title="Top Endpoints"
      {loading}
    />
  </div>
</PageShell>

<style>
  .analytics-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .analytics-actions__ranges {
    display: flex;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-md);
    padding: 2px;
  }

  .analytics-actions__range-btn {
    padding: var(--space-1) var(--space-3);
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s;
  }

  .analytics-actions__range-btn:hover {
    color: var(--color-text);
  }

  .analytics-actions__range-btn--active {
    background: var(--color-bg);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .analytics-actions__status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .analytics-actions__filter-btn {
    padding: var(--space-1) var(--space-3);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.15s;
  }

  .analytics-actions__filter-btn:hover {
    color: var(--color-text);
    background: var(--color-bg-secondary);
  }

  .analytics-actions__filter-btn--active {
    border-color: var(--color-primary);
    background: var(--color-bg-secondary);
    color: var(--color-text);
  }

  .analytics-actions__updated {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
  }

  .analytics-actions__refresh-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: var(--space-1) var(--space-2);
    font-size: 0.8125rem;
    color: var(--color-text-secondary);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.15s;
  }

  .analytics-actions__refresh-btn:hover {
    background: var(--color-bg-secondary);
  }

  .analytics-actions__refresh-btn--active {
    border-color: var(--color-success);
    color: var(--color-success);
  }

  .analytics-actions__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-success);
    animation: pulse 2s ease-in-out infinite;
  }

  .analytics-custom-error {
    margin: calc(var(--space-4) * -1) 0 var(--space-4);
    font-size: 0.75rem;
    color: var(--color-danger);
  }

  @media (max-width: 768px) {
    .analytics-actions {
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-2);
    }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .analytics-actions__custom {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: var(--space-2);
  }

  .custom-date-input {
    font-size: 12px;
    font-family: inherit;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg);
    color: var(--color-text);
    outline: none;
  }

  .custom-date-input:focus {
    border-color: var(--color-primary);
  }

  .custom-date-sep {
    font-size: 12px;
    color: var(--color-text-tertiary);
  }

  .custom-date-apply {
    font-size: 12px;
    font-family: inherit;
    font-weight: 500;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: white;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .custom-date-apply:hover { opacity: 0.9; }
  .custom-date-apply:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
