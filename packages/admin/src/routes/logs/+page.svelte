<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte';
	import { downloadBlob } from '$lib/download';
	import { generateCSV } from '$lib/csv';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { adminDashboardAnalyticsDocs } from '$lib/docs-links';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';

	interface LogEntry {
		[key: string]: unknown;
	}

	let loading = $state(true);
	let logs = $state<LogEntry[]>([]);
	let cursor = $state<string | null>(null);
	let loadingMore = $state(false);

	let prefix = $state('log:');
	let limit = $state('50');
	let levelFilter = $state('all');
	let serviceFilter = $state('all');
	let pathFilter = $state('');
	let expandedSet = $state<Set<number>>(new Set());

	// Live mode
	let liveMode = $state(false);
	let liveInterval = $state<ReturnType<typeof setInterval> | null>(null);
	let logCount = $state(0);
	let errorCount = $state(0);

	const limitOptions = [
		{ value: '20', label: '20' },
		{ value: '50', label: '50' },
		{ value: '100', label: '100' },
	];

	const levelOptions = [
		{ value: 'all', label: 'All Levels' },
		{ value: 'info', label: 'Info' },
		{ value: 'warn', label: 'Warning (3xx/4xx)' },
		{ value: 'error', label: 'Error (5xx)' },
		{ value: 'debug', label: 'Debug' },
	];

	const serviceOptions = [
		{ value: 'all', label: 'All Services' },
		{ value: 'auth', label: 'Auth' },
		{ value: 'db', label: 'Database' },
		{ value: 'storage', label: 'Storage' },
		{ value: 'databaseLive', label: 'Live' },
		{ value: 'push', label: 'Push' },
		{ value: 'room', label: 'Rooms' },
		{ value: 'function', label: 'Functions' },
		{ value: 'kv', label: 'KV' },
		{ value: 'sql', label: 'SQL' },
		{ value: 'd1', label: 'D1' },
		{ value: 'vectorize', label: 'Vectorize' },
		{ value: 'users', label: 'Users API' },
		{ value: 'admin', label: 'Admin' },
		{ value: 'health', label: 'Health' },
	];

	async function fetchLogs(append = false) {
		if (append) {
			loadingMore = true;
		} else {
			loading = true;
			expandedSet = new Set();
		}

		try {
			let url = `data/logs?limit=${encodeURIComponent(limit)}`;
			if (prefix.trim()) {
				url += `&prefix=${encodeURIComponent(prefix.trim())}`;
			}
			if (levelFilter !== 'all') {
				url += `&level=${encodeURIComponent(levelFilter)}`;
			}
			if (serviceFilter !== 'all') {
				url += `&category=${encodeURIComponent(serviceFilter)}`;
			}
			if (pathFilter.trim()) {
				url += `&path=${encodeURIComponent(pathFilter.trim())}`;
			}
			if (append && cursor) {
				url += `&cursor=${encodeURIComponent(cursor)}`;
			}

			const res = await api.fetch<{ logs: LogEntry[]; cursor: string | null }>(url);

			if (append) {
				logs = [...logs, ...res.logs];
			} else {
				logs = res.logs;
			}
			cursor = res.cursor;

			// Update counters
			logCount = logs.length;
			errorCount = logs.filter((e) => {
				const l = getLogLevel(e);
				return l === 'error' || l === 'fatal' || l === 'critical';
			}).length;
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to load logs');
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	function handleSearch() {
		cursor = null;
		fetchLogs();
	}

	function toggleExpand(idx: number) {
		const next = new Set(expandedSet);
		if (next.has(idx)) {
			next.delete(idx);
		} else {
			next.add(idx);
		}
		expandedSet = next;
	}

	function toggleLive() {
		liveMode = !liveMode;
		if (liveMode) {
			// Start auto-refresh every 2 seconds
			fetchLogs();
			liveInterval = setInterval(() => {
				fetchLogs();
			}, 2000);
		} else {
			if (liveInterval) {
				clearInterval(liveInterval);
				liveInterval = null;
			}
		}
	}

	function getLogSummary(entry: LogEntry): string {
		const method = String(entry.method ?? '');
		const path = String(entry.path ?? entry.url ?? '');
		const status = getStatusCode(entry);
		const duration = typeof entry.duration === 'number' ? entry.duration : Number(entry.duration ?? 0);

		if (method && path) {
			const parts = [`${method.toUpperCase()} ${path}`];
			if (status > 0) {
				parts.push(String(status));
			}
			if (duration > 0) {
				parts.push(`${Math.round(duration)}ms`);
			}
			return parts.join(' · ');
		}

		if (typeof entry.message === 'string') return entry.message;
		if (typeof entry.msg === 'string') return entry.msg;
		if (typeof entry.level === 'string' && typeof entry.timestamp === 'string') {
			return `[${entry.level}] ${entry.timestamp}`;
		}
		const keys = Object.keys(entry);
		if (keys.length === 0) return '(empty)';
		return keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '');
	}

	function getLogLevel(entry: LogEntry): string {
		const level = entry.level ?? entry.severity ?? '';
		if (level) return String(level).toLowerCase();

		const status = getStatusCode(entry);
		if (status >= 500) return 'error';
		if (status >= 400) return 'warn';
		if (status >= 300) return 'warn';
		if (status >= 200) return 'info';
		if (status > 0) return 'debug';
		return '';
	}

	function getStatusCode(entry: LogEntry): number {
		if (typeof entry.status === 'number') return entry.status;
		if (typeof entry.status === 'string') {
			const parsed = Number.parseInt(entry.status, 10);
			return Number.isFinite(parsed) ? parsed : 0;
		}
		return 0;
	}

	function getTimestamp(entry: LogEntry): string {
		const ts = entry.timestamp ?? entry.time ?? entry.ts ?? entry.date ?? '';
		if (!ts) return '';
		try {
			const date =
				typeof ts === 'number' ? new Date(ts)
				: /^\d+$/.test(String(ts)) ? new Date(Number(ts))
				: new Date(String(ts));
			if (Number.isNaN(date.getTime())) return '';
			return date.toLocaleString();
		} catch {
			return String(ts);
		}
	}

	function formatJson(obj: unknown): string {
		try {
			return JSON.stringify(obj, null, 2);
		} catch {
			return String(obj);
		}
	}

	function levelVariant(level: string): string {
		switch (level) {
			case 'error':
			case 'fatal':
			case 'critical':
				return 'level--error';
			case 'warn':
			case 'warning':
				return 'level--warn';
			case 'info':
				return 'level--info';
			case 'debug':
			case 'trace':
				return 'level--debug';
			default:
				return '';
		}
	}

	function exportCSV() {
		if (logs.length === 0) return;
		const columns = Object.keys(logs[0]);
		const csv = generateCSV(columns, logs as unknown as Record<string, unknown>[]);
		const blob = new Blob([csv], { type: 'text/csv' });
		downloadBlob(blob, `logs-${new Date().toISOString().slice(0, 10)}.csv`);
		toastSuccess('Logs exported as CSV');
	}

	function exportJSON() {
		if (logs.length === 0) return;
		const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
		downloadBlob(blob, `logs-${new Date().toISOString().slice(0, 10)}.json`);
		toastSuccess('Logs exported as JSON');
	}

	onMount(() => {
		fetchLogs();

		return () => {
			if (liveInterval) {
				clearInterval(liveInterval);
			}
		};
	});
</script>

<PageShell title="Logs" description="View request logs and analytics" docsHref={adminDashboardAnalyticsDocs}>
	{#snippet actions()}
		<div class="log-actions">
			<div class="log-counters">
				<span class="log-counter">{logCount} total</span>
				{#if errorCount > 0}
					<span class="log-counter log-counter--error">{errorCount} server errors</span>
				{/if}
			</div>
			{#if logs.length > 0}
				<Button variant="secondary" size="sm" onclick={exportCSV}>Export CSV</Button>
				<Button variant="secondary" size="sm" onclick={exportJSON}>Export JSON</Button>
			{/if}
			<button
				class="live-btn"
				class:live-btn--active={liveMode}
				onclick={toggleLive}
			>
				{#if liveMode}
					<span class="live-dot"></span>
				{/if}
				{liveMode ? 'Live' : 'Paused'}
			</button>
		</div>
	{/snippet}

	<div class="controls">
		<div class="controls__fields">
			<Input
				label="Prefix filter"
				placeholder="log:"
				bind:value={prefix}
			/>
			<Select
				label="Level"
				bind:value={levelFilter}
				options={levelOptions}
			/>
			<Select
				label="Service"
				bind:value={serviceFilter}
				options={serviceOptions}
			/>
			<Input
				label="Search logs"
				placeholder="/api/..."
				bind:value={pathFilter}
			/>
			<Select
				label="Limit"
				bind:value={limit}
				options={limitOptions}
			/>
		</div>
		<div class="controls__actions">
			<Button variant="primary" onclick={handleSearch}>Search</Button>
		</div>
	</div>

	{#if loading}
		<div class="log-skeleton">
			{#each Array(10) as _}
				<div class="log-skeleton__row">
					<Skeleton width="60px" height="20px" />
					<Skeleton width="120px" height="14px" />
					<Skeleton height="14px" />
				</div>
			{/each}
		</div>
	{:else if logs.length === 0}
		<EmptyState
			title="No logs found"
			description="No log entries match the current filter."
		/>
	{:else}
		<div class="log-list">
			{#each logs as entry, idx (idx)}
				{@const level = getLogLevel(entry)}
				{@const ts = getTimestamp(entry)}
				{@const category = String(entry.category ?? '')}
				{@const expanded = expandedSet.has(idx)}

				<button
					class="log-entry"
					class:log-entry--expanded={expanded}
					onclick={() => toggleExpand(idx)}
					type="button"
				>
					<div class="log-entry__header">
						<span class="log-entry__chevron" class:log-entry__chevron--open={expanded}>
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
								<path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</span>
						{#if level}
							<span class="log-entry__level {levelVariant(level)}">{level.toUpperCase()}</span>
						{/if}
						{#if category}
							<span class="log-entry__service">{category}</span>
						{/if}
						{#if ts}
							<span class="log-entry__time">{ts}</span>
						{/if}
						<span class="log-entry__summary">{getLogSummary(entry)}</span>
					</div>
					{#if expanded}
						<pre class="log-entry__detail">{formatJson(entry)}</pre>
					{/if}
				</button>
			{/each}
		</div>

		{#if cursor && !liveMode}
			<div class="pagination">
				<Button
					variant="secondary"
					loading={loadingMore}
					onclick={() => fetchLogs(true)}
				>
					Load More
				</Button>
			</div>
		{/if}
	{/if}
</PageShell>

<style>
	.log-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.log-counters {
		display: flex;
		gap: var(--space-2);
	}

	.log-counter {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
	}

	.log-counter--error {
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		color: var(--color-danger);
	}

	.live-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-1) var(--space-3);
		font-size: 12px;
		font-weight: 600;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.live-btn:hover { background: var(--color-bg-secondary); }

	.live-btn--active {
		border-color: var(--color-success);
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 8%, var(--color-bg));
	}

	.live-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-success);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.3; }
	}

	.controls {
		display: flex;
		align-items: flex-end;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
		flex-wrap: wrap;
	}

	.controls__fields {
		display: flex;
		gap: var(--space-3);
		flex: 1;
		min-width: 0;
	}

	.controls__actions {
		flex-shrink: 0;
	}

	.loading-state {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-text-secondary);
	}

	.log-skeleton {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.log-skeleton__row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg);
		border-bottom: 1px solid var(--color-border);
	}

	.log-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-border);
	}

	.log-entry {
		display: block;
		width: 100%;
		background: var(--color-bg);
		border: none;
		padding: 0;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
		color: inherit;
		transition: background 0.1s;
	}

	.log-entry:hover {
		background: var(--color-bg-secondary);
	}

	.log-entry__header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		min-height: 36px;
	}

	.log-entry__chevron {
		flex-shrink: 0;
		color: var(--color-text-tertiary);
		transition: transform 0.15s;
		display: inline-flex;
	}

	.log-entry__chevron--open {
		transform: rotate(90deg);
	}

	.log-entry__level {
		flex-shrink: 0;
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
	}

	.level--error {
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		color: var(--color-danger);
	}

	.level--warn {
		background: color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent);
		color: var(--color-warning, #d97706);
	}

	.level--info {
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
		color: var(--color-primary);
	}

	.level--debug {
		background: var(--color-bg-tertiary);
		color: var(--color-text-tertiary);
	}

	.log-entry__service {
		flex-shrink: 0;
		font-size: 10px;
		font-weight: 500;
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		background: color-mix(in srgb, var(--color-text) 6%, transparent);
		color: var(--color-text-secondary);
	}

	.log-entry__time {
		flex-shrink: 0;
		font-size: 12px;
		color: var(--color-text-tertiary);
		font-family: var(--font-mono);
	}

	.log-entry__summary {
		font-size: 13px;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.log-entry__detail {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-text-secondary);
		background: var(--color-bg-tertiary);
		border-top: 1px solid var(--color-border);
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.pagination {
		display: flex;
		justify-content: center;
		padding: var(--space-4) 0;
	}
</style>
