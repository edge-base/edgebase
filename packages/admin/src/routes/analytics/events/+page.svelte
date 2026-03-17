<script lang="ts">
	/**
	 * Event Timeline — browsable timeline of auth and custom events.
	 * Uses the analytics events API to display events chronologically.
	 */
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toastError } from '$lib/stores/toast.svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';

	// ── Types ────────────────────────────────────────
	interface TimelineEvent {
		id?: string;
		type: string;
		category?: string;
		userId?: string;
		userEmail?: string;
		timestamp: string | number;
		metadata?: Record<string, unknown>;
		[key: string]: unknown;
	}

	// ── State ────────────────────────────────────────
	let loading = $state(true);
	let events = $state<TimelineEvent[]>([]);
	let eventType = $state('all');
	let range = $state('24h');
	let userFilter = $state('');
	let expandedSet = $state<Set<number>>(new Set());

	const typeOptions = [
		{ value: 'all', label: 'All Events' },
		{ value: 'signup', label: 'Signup' },
		{ value: 'signin', label: 'Sign In' },
		{ value: 'signout', label: 'Sign Out' },
		{ value: 'password_reset', label: 'Password Reset' },
		{ value: 'oauth', label: 'OAuth' },
		{ value: 'custom', label: 'Custom' },
	];

	const rangeOptions = [
		{ value: '1h', label: 'Last 1 Hour' },
		{ value: '6h', label: 'Last 6 Hours' },
		{ value: '24h', label: 'Last 24 Hours' },
		{ value: '7d', label: 'Last 7 Days' },
		{ value: '30d', label: 'Last 30 Days' },
	];

	// ── Data ─────────────────────────────────────────
	async function fetchEvents() {
		loading = true;
		try {
			let url = `data/analytics/events?range=${range}&limit=100`;
			if (eventType !== 'all') {
				url += `&type=${encodeURIComponent(eventType)}`;
			}
			if (userFilter.trim()) {
				url += `&userId=${encodeURIComponent(userFilter.trim())}`;
			}

			const res = await api.fetch<{ events?: TimelineEvent[]; data?: TimelineEvent[] }>(url);
			events = res.events ?? res.data ?? [];
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to load events');
			events = [];
		} finally {
			loading = false;
		}
	}

	function handleSearch() {
		expandedSet = new Set();
		fetchEvents();
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

	onMount(() => {
		fetchEvents();
	});

	// ── Helpers ──────────────────────────────────────
	function formatTimestamp(ts: string | number): string {
		try {
			return new Date(ts).toLocaleString();
		} catch {
			return String(ts);
		}
	}

	function relativeTime(ts: string | number): string {
		try {
			const diff = Date.now() - new Date(ts).getTime();
			if (diff < 60_000) return 'just now';
			if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
			if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
			return `${Math.floor(diff / 86_400_000)}d ago`;
		} catch {
			return '';
		}
	}

	function eventBadgeVariant(type: string): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
		switch (type) {
			case 'signup': return 'success';
			case 'signin': return 'primary';
			case 'signout': return 'default';
			case 'password_reset': return 'warning';
			case 'oauth': return 'primary';
			case 'error':
			case 'failed': return 'danger';
			default: return 'default';
		}
	}

	function eventIcon(type: string): string {
		switch (type) {
			case 'signup': return '\u2795';
			case 'signin': return '\u2192';
			case 'signout': return '\u2190';
			case 'password_reset': return '\uD83D\uDD11';
			case 'oauth': return '\uD83D\uDD17';
			default: return '\u25CB';
		}
	}
</script>

<PageShell title="Event Timeline" description="Browse auth and custom events chronologically">
	<div class="controls">
		<div class="controls__fields">
			<Select
				label="Event Type"
				bind:value={eventType}
				options={typeOptions}
			/>
			<Select
				label="Time Range"
				bind:value={range}
				options={rangeOptions}
			/>
			<Input
				label="User ID"
				placeholder="Filter by user..."
				bind:value={userFilter}
			/>
		</div>
		<div class="controls__actions">
			<Button variant="primary" onclick={handleSearch}>Search</Button>
		</div>
	</div>

	{#if loading}
		<div class="loading-state">Loading events...</div>
	{:else if events.length === 0}
		<EmptyState
			title="No events found"
			description="No events match the current filters."
		/>
	{:else}
		<div class="timeline">
			{#each events as event, idx (event.id ?? idx)}
				{@const expanded = expandedSet.has(idx)}

				<button
					class="timeline-item"
					class:timeline-item--expanded={expanded}
					onclick={() => toggleExpand(idx)}
					type="button"
				>
					<div class="timeline-item__connector">
						<span class="timeline-item__icon">{eventIcon(event.type)}</span>
						{#if idx < events.length - 1}
							<span class="timeline-item__line"></span>
						{/if}
					</div>

					<div class="timeline-item__content">
						<div class="timeline-item__header">
							<Badge variant={eventBadgeVariant(event.type)}>{event.type}</Badge>
							{#if event.userEmail}
								<span class="timeline-item__user">{event.userEmail}</span>
							{:else if event.userId}
								<span class="timeline-item__user">{event.userId}</span>
							{/if}
							<span class="timeline-item__time" title={formatTimestamp(event.timestamp)}>
								{relativeTime(event.timestamp)}
							</span>
						</div>

						{#if expanded && event.metadata}
							<pre class="timeline-item__detail">{JSON.stringify(event.metadata, null, 2)}</pre>
						{:else if expanded}
							<pre class="timeline-item__detail">{JSON.stringify(event, null, 2)}</pre>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</PageShell>

<style>
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

	.timeline {
		display: flex;
		flex-direction: column;
	}

	.timeline-item {
		display: flex;
		gap: var(--space-3);
		padding: 0;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
		color: inherit;
		width: 100%;
	}

	.timeline-item:hover .timeline-item__content {
		background: var(--color-bg-secondary);
	}

	.timeline-item__connector {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 28px;
		flex-shrink: 0;
	}

	.timeline-item__icon {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 50%;
		flex-shrink: 0;
	}

	.timeline-item__line {
		width: 1px;
		flex: 1;
		min-height: 16px;
		background: var(--color-border);
	}

	.timeline-item__content {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		transition: background 0.1s;
		margin-bottom: var(--space-1);
	}

	.timeline-item__header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.timeline-item__user {
		font-size: 12px;
		font-family: var(--font-mono);
		color: var(--color-text-secondary);
	}

	.timeline-item__time {
		font-size: 11px;
		color: var(--color-text-tertiary);
		margin-left: auto;
	}

	.timeline-item__detail {
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.5;
		color: var(--color-text-secondary);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
