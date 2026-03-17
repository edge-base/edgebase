<script lang="ts">
  /**
   * TimeChart — SVG time series chart for analytics dashboard.
   * Supports line and bar chart types with responsive width.
   */
  import { onMount } from 'svelte';

  interface DataPoint {
    timestamp: number;
    value: number;
  }

  interface Props {
    data: DataPoint[];
    type?: 'line' | 'bar';
    height?: number;
    color?: string;
    label?: string;
    loading?: boolean;
    formatValue?: (v: number) => string;
    formatTime?: (ts: number) => string;
  }

  let {
    data,
    type = 'line',
    height = 200,
    color = 'var(--color-primary)',
    label = '',
    loading = false,
    formatValue = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)),
    formatTime = (ts: number) => {
      const d = new Date(ts);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    },
  }: Props = $props();

  let containerRef: HTMLDivElement;
  let width = $state(600);

  const PADDING = { top: 20, right: 16, bottom: 28, left: 48 };
  const chartWidth = $derived(width - PADDING.left - PADDING.right);
  const chartHeight = $derived(height - PADDING.top - PADDING.bottom);

  const maxValue = $derived(() => {
    if (!data.length) return 1;
    const max = Math.max(...data.map(d => d.value));
    return max === 0 ? 1 : max * 1.1; // 10% headroom
  });

  // Y-axis ticks (4 evenly spaced)
  const yTicks = $derived(() => {
    const max = maxValue();
    return [0, max * 0.25, max * 0.5, max * 0.75, max].map(v => ({
      value: v,
      label: formatValue(v),
      y: PADDING.top + chartHeight - (v / max) * chartHeight,
    }));
  });

  // X positions for data points
  const points = $derived(() => {
    if (!data.length) return [];
    const step = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth / 2;
    const max = maxValue();
    return data.map((d, i) => ({
      x: PADDING.left + (data.length > 1 ? i * step : chartWidth / 2),
      y: PADDING.top + chartHeight - (d.value / max) * chartHeight,
      value: d.value,
      timestamp: d.timestamp,
    }));
  });

  // SVG polyline path
  const linePath = $derived(() => {
    const pts = points();
    if (!pts.length) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  });

  // Area fill path (line + bottom edge)
  const areaPath = $derived(() => {
    const pts = points();
    if (!pts.length) return '';
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const bottom = PADDING.top + chartHeight;
    return `${line} L${pts[pts.length - 1].x},${bottom} L${pts[0].x},${bottom} Z`;
  });

  // Bar dimensions
  const barWidth = $derived(() => {
    if (data.length <= 1) return Math.min(40, chartWidth);
    const gap = 2;
    return Math.max(2, (chartWidth / data.length) - gap);
  });

  // X-axis labels (show ~6 labels max)
  const xLabels = $derived(() => {
    const pts = points();
    if (!pts.length) return [];
    const step = Math.max(1, Math.floor(pts.length / 6));
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => ({
      x: p.x,
      label: formatTime(p.timestamp),
    }));
  });

  // Hover state
  let hoverIndex = $state<number | null>(null);

  function handleMouseMove(e: MouseEvent) {
    const rect = containerRef.getBoundingClientRect();
    const x = e.clientX - rect.left - PADDING.left;
    const pts = points();
    if (!pts.length) return;
    const step = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
    const idx = Math.round(x / step);
    hoverIndex = Math.max(0, Math.min(pts.length - 1, idx));
  }

  function handleMouseLeave() {
    hoverIndex = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!data.length) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      hoverIndex = hoverIndex == null ? 0 : Math.min(points().length - 1, hoverIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      hoverIndex = hoverIndex == null ? points().length - 1 : Math.max(0, hoverIndex - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      hoverIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      hoverIndex = points().length - 1;
    } else if (e.key === 'Escape') {
      hoverIndex = null;
    }
  }

  onMount(() => {
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        width = entry.contentRect.width;
      }
    });
    observer.observe(containerRef);
    return () => observer.disconnect();
  });
</script>

<div class="time-chart" bind:this={containerRef}>
  {#if label}
    <div class="time-chart__label">{label}</div>
  {/if}

  {#if loading}
    <div class="time-chart__loading" style="height: {height}px">
      <div class="time-chart__skeleton"></div>
    </div>
  {:else if !data.length}
    <div class="time-chart__empty" style="height: {height}px">
      No data available
    </div>
  {:else}
    <button
      type="button"
      class="time-chart__canvas"
      aria-label={label || 'Time series chart'}
      onmousemove={handleMouseMove}
      onmouseleave={handleMouseLeave}
      onfocus={() => { if (hoverIndex == null && points().length > 0) hoverIndex = 0; }}
      onblur={handleMouseLeave}
      onkeydown={handleKeydown}
    >
      <svg
        {width}
        {height}
        class="time-chart__svg"
        aria-hidden="true"
      >
      <!-- Grid lines -->
      {#each yTicks() as tick}
        <line
          x1={PADDING.left}
          y1={tick.y}
          x2={PADDING.left + chartWidth}
          y2={tick.y}
          class="time-chart__grid"
        />
        <text
          x={PADDING.left - 8}
          y={tick.y + 4}
          class="time-chart__axis-label"
          text-anchor="end"
        >{tick.label}</text>
      {/each}

      <!-- X-axis labels -->
      {#each xLabels() as tick}
        <text
          x={tick.x}
          y={PADDING.top + chartHeight + 18}
          class="time-chart__axis-label"
          text-anchor="middle"
        >{tick.label}</text>
      {/each}

      {#if type === 'line'}
        <!-- Area fill -->
        <path d={areaPath()} class="time-chart__area" style="fill: {color}" />
        <!-- Line -->
        <path d={linePath()} class="time-chart__line" style="stroke: {color}" />
        <!-- Data points -->
        {#each points() as point, i}
          {#if i === hoverIndex}
            <circle cx={point.x} cy={point.y} r="4" class="time-chart__dot" style="fill: {color}" />
          {/if}
        {/each}
      {:else}
        <!-- Bars -->
        {#each points() as point, i}
          <rect
            x={point.x - barWidth() / 2}
            y={point.y}
            width={barWidth()}
            height={PADDING.top + chartHeight - point.y}
            class="time-chart__bar"
            class:time-chart__bar--active={i === hoverIndex}
            style="fill: {color}"
            rx="2"
          />
        {/each}
      {/if}

      <!-- Hover tooltip -->
      {#if hoverIndex != null && points()[hoverIndex]}
        {@const pt = points()[hoverIndex]}
        <g class="time-chart__tooltip-group">
          <!-- Vertical guide line -->
          <line
            x1={pt.x}
            y1={PADDING.top}
            x2={pt.x}
            y2={PADDING.top + chartHeight}
            class="time-chart__guide"
          />
          <!-- Tooltip background -->
          <rect
            x={pt.x - 36}
            y={pt.y - 28}
            width="72"
            height="22"
            rx="4"
            class="time-chart__tooltip-bg"
          />
          <!-- Tooltip text -->
          <text
            x={pt.x}
            y={pt.y - 14}
            class="time-chart__tooltip-text"
            text-anchor="middle"
          >{formatValue(pt.value)}</text>
        </g>
      {/if}
      </svg>
    </button>
  {/if}
</div>

<style>
  .time-chart {
    width: 100%;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .time-chart__label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary);
    padding: var(--space-3) var(--space-4) 0;
  }

  .time-chart__canvas {
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    cursor: crosshair;
  }

  .time-chart__svg {
    display: block;
  }

  .time-chart__canvas:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
  }

  .time-chart__grid {
    stroke: var(--color-border);
    stroke-width: 1;
    stroke-dasharray: 4 4;
  }

  .time-chart__axis-label {
    font-size: 10px;
    fill: var(--color-text-tertiary);
    font-family: var(--font-sans);
  }

  .time-chart__line {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .time-chart__area {
    opacity: 0.1;
  }

  .time-chart__dot {
    stroke: var(--color-bg);
    stroke-width: 2;
  }

  .time-chart__bar {
    opacity: 0.7;
    transition: opacity 0.1s;
  }

  .time-chart__bar--active {
    opacity: 1;
  }

  .time-chart__guide {
    stroke: var(--color-border-strong);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }

  .time-chart__tooltip-bg {
    fill: var(--color-text);
    opacity: 0.9;
  }

  .time-chart__tooltip-text {
    font-size: 11px;
    fill: var(--color-bg);
    font-weight: 500;
    font-family: var(--font-sans);
  }

  .time-chart__loading,
  .time-chart__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
    font-size: 0.8125rem;
  }

  .time-chart__skeleton {
    width: 80%;
    height: 60%;
    background: var(--color-bg-tertiary);
    border-radius: var(--radius-md);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>
