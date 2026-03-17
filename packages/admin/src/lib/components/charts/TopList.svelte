<script lang="ts">
  /**
   * TopList — ranked list with inline bar chart for analytics dashboard.
   * Shows top N items with count, optional secondary metric, and visual bar.
   */
  interface ListItem {
    label: string;
    count: number;
    secondary?: string;  // e.g., "42ms avg" or "2.1% 5xx"
  }

  interface Props {
    items: ListItem[];
    title?: string;
    limit?: number;
    loading?: boolean;
  }

  let { items, title, limit = 10, loading = false }: Props = $props();

  const displayItems = $derived(() => items.slice(0, limit));
  const maxCount = $derived(() => {
    const d = displayItems();
    if (!d.length) return 1;
    return Math.max(...d.map(i => i.count)) || 1;
  });

  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  }
</script>

<div class="top-list">
  {#if title}
    <div class="top-list__title">{title}</div>
  {/if}

  {#if loading}
    <div class="top-list__loading">
      {#each Array(5) as _}
        <div class="top-list__skeleton-row">
          <div class="top-list__skeleton-label"></div>
          <div class="top-list__skeleton-value"></div>
        </div>
      {/each}
    </div>
  {:else if !displayItems().length}
    <div class="top-list__empty">No data available</div>
  {:else}
    <div class="top-list__items">
      {#each displayItems() as item, i}
        <div class="top-list__item">
          <div class="top-list__rank">{i + 1}</div>
          <div class="top-list__content">
            <div class="top-list__row">
              <span class="top-list__label" title={item.label}>{item.label}</span>
              <span class="top-list__count">{formatCount(item.count)}</span>
            </div>
            <div class="top-list__bar-bg">
              <div
                class="top-list__bar-fill"
                style="width: {(item.count / maxCount()) * 100}%"
              ></div>
            </div>
            {#if item.secondary}
              <div class="top-list__secondary">{item.secondary}</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .top-list {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }

  .top-list__title {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    margin-bottom: var(--space-3);
  }

  .top-list__items {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .top-list__item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .top-list__rank {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-text-tertiary);
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-sm);
    margin-top: 1px;
  }

  .top-list__content {
    flex: 1;
    min-width: 0;
  }

  .top-list__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .top-list__label {
    font-size: 0.8125rem;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  .top-list__count {
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .top-list__bar-bg {
    height: 4px;
    background: var(--color-bg-tertiary);
    border-radius: 2px;
    margin-top: 4px;
    overflow: hidden;
  }

  .top-list__bar-fill {
    height: 100%;
    background: var(--color-primary);
    border-radius: 2px;
    transition: width 0.3s ease;
    min-width: 2px;
  }

  .top-list__secondary {
    font-size: 0.6875rem;
    color: var(--color-text-tertiary);
    margin-top: 2px;
  }

  .top-list__empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }

  .top-list__loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .top-list__skeleton-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .top-list__skeleton-label {
    height: 14px;
    width: 60%;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .top-list__skeleton-value {
    height: 14px;
    width: 40px;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
