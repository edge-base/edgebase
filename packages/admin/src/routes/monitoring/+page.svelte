<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toastError } from '$lib/stores/toast.svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { adminDashboardAnalyticsDocs } from '$lib/docs-links';
	import Badge from '$lib/components/ui/Badge.svelte';

	interface ChannelDetail {
		channel: string;
		subscribers: number;
	}

	interface MonitoringData {
		activeConnections: number;
		authenticatedConnections?: number;
		channels: number;
		channelDetails?: ChannelDetail[];
		[key: string]: unknown;
	}

	let loading = $state(true);
	let data = $state<MonitoringData | null>(null);
	let lastUpdated = $state<string>('');
	let autoRefresh = $state(true);

	async function fetchMonitoring() {
		try {
			const res = await api.fetch<MonitoringData>('data/monitoring');
			data = res;
			lastUpdated = new Date().toLocaleTimeString();
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to load monitoring data');
		} finally {
			loading = false;
		}
	}

	function toggleAutoRefresh() {
		autoRefresh = !autoRefresh;
	}

	/** Known stats shown as primary cards */
	const knownStats: { key: keyof MonitoringData; label: string; icon: string }[] = [
		{ key: 'activeConnections', label: 'Active Connections', icon: 'connections' },
		{ key: 'authenticatedConnections', label: 'Authenticated', icon: 'auth' },
		{ key: 'channels', label: 'Active Channels', icon: 'channels' },
	];

	onMount(() => {
		fetchMonitoring();

		const interval = setInterval(() => {
			if (autoRefresh) {
				fetchMonitoring();
			}
		}, 5000);

		return () => {
			clearInterval(interval);
		};
	});
</script>

<PageShell title="Live Monitoring" description="Active connections and channels" docsHref={adminDashboardAnalyticsDocs}>
	{#snippet actions()}
		<div class="refresh-controls">
			{#if lastUpdated}
				<span class="last-updated">Updated {lastUpdated}</span>
			{/if}
			<button
				class="auto-refresh-toggle"
				class:auto-refresh-toggle--active={autoRefresh}
				onclick={toggleAutoRefresh}
				type="button"
				title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
			>
				<span class="auto-refresh-dot"></span>
				{autoRefresh ? 'Live' : 'Paused'}
			</button>
		</div>
	{/snippet}

	{#if loading}
		<div class="loading-state">Loading monitoring data...</div>
	{:else if data}
		<div class="stat-grid">
			{#each knownStats as stat (stat.key)}
				{@const value = data[stat.key]}
				<div class="stat-card">
					<div class="stat-card__icon" aria-hidden="true">
						{#if stat.icon === 'connections'}
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
								<circle cx="9" cy="7" r="4" />
								<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
								<path d="M16 3.13a4 4 0 0 1 0 7.75" />
							</svg>
						{:else if stat.icon === 'auth'}
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
								<path d="M7 11V7a5 5 0 0 1 10 0v4" />
							</svg>
						{:else if stat.icon === 'channels'}
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M4 11a9 9 0 0 1 9 9" />
								<path d="M4 4a16 16 0 0 1 16 16" />
								<circle cx="5" cy="19" r="1" />
							</svg>
						{/if}
					</div>
					<div class="stat-card__value">{typeof value === 'number' ? value.toLocaleString() : '--'}</div>
					<div class="stat-card__label">{stat.label}</div>
				</div>
			{/each}
		</div>

		<!-- Channel Details -->
		{#if data.channelDetails && data.channelDetails.length > 0}
			<div class="channel-section">
				<h3 class="section-title">Active Channels</h3>
				<div class="channel-table-wrap">
					<table class="channel-table">
						<thead>
							<tr>
								<th class="channel-th">Channel</th>
								<th class="channel-th channel-th--right">Subscribers</th>
							</tr>
						</thead>
						<tbody>
							{#each data.channelDetails as ch (ch.channel)}
								<tr class="channel-row">
									<td class="channel-td">
										<code class="channel-name">{ch.channel}</code>
									</td>
									<td class="channel-td channel-td--right">
										<span class="subscriber-count">{ch.subscribers}</span>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{:else}
			<div class="channel-empty">No active channel subscriptions.</div>
		{/if}
	{:else}
		<div class="loading-state">No monitoring data available.</div>
	{/if}
</PageShell>

<style>
	.loading-state {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-text-secondary);
	}

	.refresh-controls {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.last-updated {
		font-size: 12px;
		color: var(--color-text-tertiary);
	}

	.auto-refresh-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		font-size: 12px;
		font-weight: 500;
		font-family: inherit;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.auto-refresh-toggle:hover {
		background: var(--color-bg-secondary);
	}

	.auto-refresh-toggle--active {
		border-color: var(--color-success);
		color: var(--color-success);
	}

	.auto-refresh-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-text-tertiary);
	}

	.auto-refresh-toggle--active .auto-refresh-dot {
		background: var(--color-success);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--space-4);
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-4);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-align: center;
		transition: box-shadow 0.15s;
	}

	.stat-card:hover {
		box-shadow: var(--shadow-sm);
	}

	.stat-card__icon {
		color: var(--color-primary);
		opacity: 0.7;
	}

	.stat-card__value {
		font-size: 28px;
		font-weight: 700;
		color: var(--color-text);
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.stat-card__label {
		font-size: 13px;
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	/* ── Channel Table ─────────────── */
	.channel-section {
		margin-top: var(--space-5);
	}

	.section-title {
		margin: 0 0 var(--space-3);
		font-size: 14px;
		font-weight: 600;
	}

	.channel-table-wrap {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.channel-table {
		width: 100%;
		border-collapse: collapse;
	}

	.channel-th {
		padding: var(--space-2) var(--space-3);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		text-align: left;
		color: var(--color-text-secondary);
	}

	.channel-th--right { text-align: right; }

	.channel-row:not(:last-child) .channel-td {
		border-bottom: 1px solid var(--color-border);
	}

	.channel-td {
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
	}

	.channel-td--right { text-align: right; }

	.channel-name {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-primary);
		background: none;
		padding: 0;
	}

	.subscriber-count {
		font-family: var(--font-mono);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.channel-empty {
		margin-top: var(--space-5);
		padding: var(--space-4);
		text-align: center;
		color: var(--color-text-tertiary);
		font-size: 13px;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
	}
</style>
