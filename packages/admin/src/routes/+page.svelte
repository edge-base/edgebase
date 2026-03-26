<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { toastError } from '$lib/stores/toast.svelte';
	import { getAnalyticsTimeFormatter, type PresetAnalyticsRange } from '$lib/analytics-range';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import MetricCard from '$lib/components/charts/MetricCard.svelte';
	import TimeChart from '$lib/components/charts/TimeChart.svelte';
	import { adminDashboardDocs } from '$lib/docs-links';

	// ─── Types ───

	interface OverviewData {
		project: {
			totalUsers: number;
			totalTables: number;
			databases: Array<{ name: string; tableCount: number }>;
			storageBuckets: string[];
			serviceKeyCount: number;
			authProviders: string[];
			liveConnections: number;
			liveChannels: number;
			devMode: boolean;
		};
		traffic: {
			appliedRange?: '1h' | '6h' | '24h';
			summary: { totalRequests: number; totalErrors: number; avgLatency: number; uniqueUsers: number };
			timeSeries: Array<{ timestamp: number; requests?: number; value?: number; errors?: number }>;
			breakdown: Array<{ label: string; count: number; percentage: number }>;
			topItems: Array<{ label: string; count: number; avgLatency: number; errorRate: number }>;
		};
	}

	// ─── State ───

	let ready = $state(false);
	let loading = $state(true);
	let data = $state<OverviewData | null>(null);
	const rangeOptions: Record<'1h' | '6h' | '24h', { cardLabel: string; chartLabel: string }> = {
		'1h': { cardLabel: '1H', chartLabel: 'Last 1 hour' },
		'6h': { cardLabel: '6H', chartLabel: 'Last 6 hours' },
		'24h': { cardLabel: '24H', chartLabel: 'Last 24 hours' },
	};

	// ─── Data Fetching ───

	async function fetchOverview() {
		try {
			const res = await api.fetch<OverviewData>('data/overview');
			data = res;
		} catch (err) {
			toastError(describeActionError(err, 'Failed to load the dashboard overview.', {
				hint: 'Check your server connection and try reloading.',
			}));
		} finally {
			loading = false;
		}
	}

	// ─── Derived ───

	const errorRate = $derived(() => {
		if (!data?.traffic?.summary) return 0;
		const { totalRequests, totalErrors } = data.traffic.summary;
		return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
	});

	const chartData = $derived(() => {
		if (!data?.traffic?.timeSeries) return [];
		return data.traffic.timeSeries.map(p => ({
			timestamp: p.timestamp,
			value: p.requests ?? p.value ?? 0,
		}));
	});

	const appliedRange = $derived((data?.traffic.appliedRange ?? '24h') as '1h' | '6h' | '24h');
	const selectedRangeMeta = $derived(rangeOptions[appliedRange]);

	const chartTimeFormatter = $derived(getAnalyticsTimeFormatter(appliedRange as PresetAnalyticsRange));

	// ─── Lifecycle ───

	onMount(() => {
		// Auth gate in +layout.svelte handles unauthenticated redirects.
		// Do NOT call goto() here — it races with the layout's reactive
		// $effect and causes competing navigations → infinite reload loop.
		if ($authStore.accessToken) {
			ready = true;
			void fetchOverview();
		}
	});

	// ─── Quick actions ───

	const quickActions = [
		{ label: 'Users', href: `${base}/auth`, icon: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 14C3 11.2386 5.23858 9 8 9C10.7614 9 13 11.2386 13 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
		{ label: 'Schema', href: `${base}/database/tables`, icon: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M7 4.5H9.5V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
		{ label: 'ERD', href: `${base}/database/erd`, icon: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M6 4H8.5V12H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
		{ label: 'Files', href: `${base}/storage`, icon: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 4L8 2L14 4V12L8 14L2 12V4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 4L8 6L14 4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6V14" stroke="currentColor" stroke-width="1.5"/></svg>' },
		{ label: 'Analytics', href: `${base}/analytics`, icon: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="2" y="9" width="3" height="5" rx="0.5" stroke="currentColor" stroke-width="1.5"/><rect x="6.5" y="5" width="3" height="9" rx="0.5" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="2" width="3" height="12" rx="0.5" stroke="currentColor" stroke-width="1.5"/></svg>' },
		{ label: 'Logs', href: `${base}/logs`, icon: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 4H12M4 7H10M4 10H12M4 13H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
		{ label: 'Docs', href: adminDashboardDocs, external: true, icon: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V14H3V2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 2V5H13" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 8H10M6 10.5H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
	];

	// ─── Services ───

	const services = $derived(() => {
		if (!data) return [];
		const p = data.project;
		return [
			{ name: 'Auth', active: true, detail: `${p.authProviders.length} provider${p.authProviders.length !== 1 ? 's' : ''}` },
			{ name: 'Database', active: p.totalTables > 0, detail: `${p.totalTables} table${p.totalTables !== 1 ? 's' : ''}` },
			{ name: 'Storage', active: p.storageBuckets.length > 0, detail: `${p.storageBuckets.length} bucket${p.storageBuckets.length !== 1 ? 's' : ''}` },
			{ name: 'Live', active: true, detail: `${p.liveConnections} conn${p.liveConnections !== 1 ? 's' : ''}` },
		];
	});
</script>

	{#if ready}
		<PageShell title="Overview" description="Project dashboard" docsHref={adminDashboardDocs}>
			<!-- Metric Cards -->
			<div class="overview-metrics">
			<MetricCard
				label="Total Users"
				value={data?.project?.totalUsers ?? 0}
				{loading}
				icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 14C3 11.2386 5.23858 9 8 9C10.7614 9 13 11.2386 13 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
			/>
			<MetricCard
				label="Tables"
				value={data?.project?.totalTables ?? 0}
				{loading}
				icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M7 4.5H9.5V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
			/>
			<MetricCard
				label={`Requests (${selectedRangeMeta.cardLabel})`}
				value={data?.traffic?.summary?.totalRequests ?? 0}
				{loading}
				icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 14V8L5 4L8 7L11 2L14 6V14H2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
			/>
			<MetricCard
				label="5xx Rate"
				value={errorRate().toFixed(1)}
				unit="%"
				{loading}
				icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5V9M8 11V11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
			/>
			<MetricCard
					label="Live"
					value={data?.project?.liveConnections ?? 0}
					unit="conns"
				{loading}
				icon='<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8H3L5 3L8 13L11 6L13 8H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
			/>
		</div>

		<!-- Traffic Chart -->
		<div class="overview-chart">
			<TimeChart
				data={chartData()}
				type="line"
				height={240}
				label={`Requests — ${selectedRangeMeta.chartLabel}`}
				formatTime={chartTimeFormatter}
				{loading}
			/>
		</div>

		<!-- Bottom panels -->
		<div class="overview-panels">
			<!-- Service Status -->
			<div class="overview-panel">
				<h3 class="overview-panel__title">Services</h3>
				{#if loading}
					<div class="overview-panel__loading">Loading...</div>
				{:else}
					<div class="overview-services">
						{#each services() as svc}
							<div class="overview-service">
								<span class="overview-service__dot" class:overview-service__dot--active={svc.active}></span>
								<span class="overview-service__name">{svc.name}</span>
								<span class="overview-service__detail">{svc.detail}</span>
							</div>
						{/each}
					</div>
				{/if}

				{#if data?.project}
					<div class="overview-info">
						{#if data.project.authProviders.length > 0}
							<div class="overview-info__row">
								<span class="overview-info__label">Auth</span>
								<span class="overview-info__value">
									{data.project.authProviders.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}
								</span>
							</div>
						{/if}
						{#if data.project.storageBuckets.length > 0}
							<div class="overview-info__row">
								<span class="overview-info__label">Buckets</span>
								<span class="overview-info__value">{data.project.storageBuckets.join(', ')}</span>
							</div>
						{/if}
						<div class="overview-info__row">
							<span class="overview-info__label">Service Keys</span>
							<span class="overview-info__value">{data.project.serviceKeyCount}</span>
						</div>
						<div class="overview-info__row">
							<span class="overview-info__label">Mode</span>
							<span class="overview-info__value overview-info__badge" class:overview-info__badge--dev={data.project.devMode}>
								{data.project.devMode ? 'Development' : 'Production'}
							</span>
						</div>
					</div>
				{/if}
			</div>

			<!-- Quick Actions -->
			<div class="overview-panel">
				<h3 class="overview-panel__title">Quick Actions</h3>
				<div class="overview-actions">
					{#each quickActions as action}
						<a
							href={action.href}
							class="overview-action"
							target={action.external ? '_blank' : undefined}
							rel={action.external ? 'noreferrer' : undefined}
						>
							<span class="overview-action__icon">{@html action.icon}</span>
							<span class="overview-action__label">{action.label}</span>
							<span class="overview-action__arrow">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
							</span>
						</a>
					{/each}
				</div>
			</div>
		</div>
	</PageShell>
{/if}

<style>
	.overview-metrics {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.overview-chart {
		margin-bottom: var(--space-4);
	}

	.overview-panels {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}

	.overview-panel {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4) var(--space-5);
	}

	@media (max-width: 900px) {
		.overview-panels {
			grid-template-columns: 1fr;
		}
	}

	.overview-panel__title {
		margin: 0 0 var(--space-3);
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.overview-panel__loading {
		font-size: 0.8125rem;
		color: var(--color-text-tertiary);
	}

	/* Services */

	.overview-services {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}

	.overview-service {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.8125rem;
	}

	.overview-service__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-text-tertiary);
		flex-shrink: 0;
	}

	.overview-service__dot--active {
		background: var(--color-success);
	}

	.overview-service__name {
		font-weight: 500;
		color: var(--color-text);
	}

	.overview-service__detail {
		margin-left: auto;
		color: var(--color-text-tertiary);
		font-size: 0.75rem;
	}

	/* Project Info */

	.overview-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
	}

	.overview-info__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.8125rem;
	}

	.overview-info__label {
		color: var(--color-text-tertiary);
	}

	.overview-info__value {
		color: var(--color-text);
		font-weight: 500;
		text-align: right;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.overview-info__badge {
		display: inline-flex;
		padding: 1px 8px;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 600;
		background: #dcfce7;
		color: #166534;
	}

	.overview-info__badge--dev {
		background: #fef3c7;
		color: #92400e;
	}

	/* Quick Actions */

	.overview-actions {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.overview-action {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-2);
		border-radius: var(--radius-md);
		text-decoration: none;
		color: var(--color-text);
		font-size: 0.8125rem;
		font-weight: 500;
		transition: background-color 0.1s;
	}

	.overview-action:hover {
		background: var(--color-bg-secondary);
		text-decoration: none;
	}

	.overview-action__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.overview-action__label {
		flex: 1;
	}

	.overview-action__arrow {
		color: var(--color-text-tertiary);
		display: flex;
		align-items: center;
	}

	@media (max-width: 768px) {
		.overview-metrics {
			grid-template-columns: repeat(2, 1fr);
		}

		.overview-panels {
			grid-template-columns: 1fr;
		}
	}
</style>
