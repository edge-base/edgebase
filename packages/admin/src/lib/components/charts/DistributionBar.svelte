<script lang="ts">
  /**
   * DistributionBar — horizontal stacked bar showing category proportions.
   * Used for showing request distribution by category (auth, db, storage, etc.)
   */
  interface BarItem {
    label: string;
    value: number;
    color?: string;
  }

  interface Props {
    items: BarItem[];
    title?: string;
    loading?: boolean;
  }

  let { items, title, loading = false }: Props = $props();

  const COLORS = [
    '#2563eb', // blue
    '#16a34a', // green
    '#d97706', // amber
    '#dc2626', // red
    '#7c3aed', // violet
    '#0891b2', // cyan
    '#c026d3', // fuchsia
    '#ea580c', // orange
    '#4f46e5', // indigo
    '#059669', // emerald
  ];

  const total = $derived(() => items.reduce((sum, item) => sum + item.value, 0));

  const processedItems = $derived(() => {
    const t = total();
    if (t === 0) return [];
    return items
      .filter(item => item.value > 0)
      .map((item, i) => ({
        ...item,
        color: item.color || COLORS[i % COLORS.length],
        percentage: (item.value / t) * 100,
      }));
  });
</script>

<div class="dist-bar">
  {#if title}
    <div class="dist-bar__title">{title}</div>
  {/if}

  {#if loading}
    <div class="dist-bar__loading">
      <div class="dist-bar__skeleton-bar"></div>
      <div class="dist-bar__skeleton-legend"></div>
    </div>
  {:else if !processedItems().length}
    <div class="dist-bar__empty">No data available</div>
  {:else}
    <!-- Stacked bar -->
    <div class="dist-bar__bar">
      {#each processedItems() as item}
        <div
          class="dist-bar__segment"
          style="width: {item.percentage}%; background-color: {item.color}"
          title="{item.label}: {item.value.toLocaleString()} ({item.percentage.toFixed(1)}%)"
        ></div>
      {/each}
    </div>

    <!-- Legend -->
    <div class="dist-bar__legend">
      {#each processedItems() as item}
        <div class="dist-bar__legend-item">
          <span class="dist-bar__legend-dot" style="background-color: {item.color}"></span>
          <span class="dist-bar__legend-label">{item.label}</span>
          <span class="dist-bar__legend-value">{item.percentage.toFixed(1)}%</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .dist-bar {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }

  .dist-bar__title {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-3);
  }

  .dist-bar__bar {
    display: flex;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--color-bg-tertiary);
  }

  .dist-bar__segment {
    min-width: 2px;
    transition: width 0.3s ease;
  }

  .dist-bar__segment:first-child {
    border-radius: 6px 0 0 6px;
  }

  .dist-bar__segment:last-child {
    border-radius: 0 6px 6px 0;
  }

  .dist-bar__segment:only-child {
    border-radius: 6px;
  }

  .dist-bar__legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .dist-bar__legend-item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: 0.75rem;
  }

  .dist-bar__legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dist-bar__legend-label {
    color: var(--color-text-secondary);
  }

  .dist-bar__legend-value {
    color: var(--color-text-tertiary);
    font-weight: 500;
  }

  .dist-bar__empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }

  .dist-bar__loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .dist-bar__skeleton-bar {
    height: 12px;
    background: var(--color-bg-tertiary);
    border-radius: 6px;
    animation: pulse 1.5s ease-in-out infinite;
  }

  .dist-bar__skeleton-legend {
    height: 16px;
    width: 60%;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
