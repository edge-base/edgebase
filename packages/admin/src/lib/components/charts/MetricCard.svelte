<script lang="ts">
  /**
   * MetricCard — summary statistic card for analytics dashboard.
   * Displays a label, formatted value, optional trend indicator, and unit.
   */
  interface Props {
    label: string;
    value: number | string;
    trend?: number;       // percentage change (positive = up, negative = down)
    unit?: string;        // e.g., 'ms', '%', 'req/s'
    icon?: string;        // inline SVG string
    loading?: boolean;
  }

  let { label, value, trend, unit, icon, loading = false }: Props = $props();

  const formattedValue = $derived(() => {
    if (typeof value === 'string') return value;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toFixed(1);
  });

  const trendClass = $derived(() => {
    if (trend == null) return '';
    return trend > 0 ? 'metric-card__trend--up' : trend < 0 ? 'metric-card__trend--down' : '';
  });
</script>

<div class="metric-card" class:metric-card--loading={loading}>
  {#if icon}
    <div class="metric-card__icon">{@html icon}</div>
  {/if}
  <div class="metric-card__body">
    <div class="metric-card__label">{label}</div>
    <div class="metric-card__value">
      {#if loading}
        <span class="metric-card__skeleton"></span>
      {:else}
        {formattedValue()}
        {#if unit}
          <span class="metric-card__unit">{unit}</span>
        {/if}
      {/if}
    </div>
    {#if trend != null && !loading}
      <div class="metric-card__trend {trendClass()}">
        {#if trend > 0}↑{:else if trend < 0}↓{/if}
        {Math.abs(trend).toFixed(1)}%
      </div>
    {/if}
  </div>
</div>

<style>
  .metric-card {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    transition: box-shadow 0.15s;
  }

  .metric-card:hover {
    box-shadow: var(--shadow-sm);
  }

  .metric-card__icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }

  .metric-card__body {
    flex: 1;
    min-width: 0;
  }

  .metric-card__label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-1);
  }

  .metric-card__value {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--color-text);
    line-height: 1.2;
  }

  .metric-card__unit {
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--color-text-secondary);
    margin-left: 2px;
  }

  .metric-card__trend {
    font-size: 0.75rem;
    font-weight: 500;
    margin-top: var(--space-1);
    color: var(--color-text-tertiary);
  }

  .metric-card__trend--up {
    color: var(--color-success);
  }

  .metric-card__trend--down {
    color: var(--color-danger);
  }

  .metric-card__skeleton {
    display: inline-block;
    width: 60px;
    height: 24px;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
