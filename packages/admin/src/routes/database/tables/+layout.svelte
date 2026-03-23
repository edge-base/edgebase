<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { schemaStore, tablesByNamespace, namespaceNames } from '$lib/stores/schema';
	import { devInfoStore } from '$lib/stores/devInfo';
	import Button from '$lib/components/ui/Button.svelte';

	let { children }: { children: Snippet } = $props();

	let selectedTable = $derived($page.params.table ?? '');
	let isDevMode = $derived($devInfoStore.devMode);
	const SIDEBAR_WIDTH_KEY = 'edgebase_tables_sidebar_width';
	const SIDEBAR_MIN_WIDTH = 180;
	const SIDEBAR_MAX_WIDTH = 360;
	const SIDEBAR_DEFAULT_WIDTH = 200;
	let sidebarWidth = $state(SIDEBAR_DEFAULT_WIDTH);
	let resizing = $state(false);
	let isMobile = $state(false);
	let resizerEl = $state<HTMLButtonElement | null>(null);
	let resizeStartX = 0;
	let resizeStartWidth = SIDEBAR_DEFAULT_WIDTH;

	// Namespace filter
	let namespaceFilter = $state('all');
	let namespaces = $derived($namespaceNames);
	let allTables = $derived.by(() => {
		const items: Array<{ name: string; namespace: string; provider?: string; dynamic?: boolean }> = [];
		for (const [ns, tables] of Object.entries($tablesByNamespace)) {
			for (const t of tables) {
				items.push({
					name: t.name,
					namespace: ns,
					provider: t.def.provider,
					dynamic: t.def.dynamic,
				});
			}
		}
		items.sort((a, b) => a.name.localeCompare(b.name));
		return items;
	});

	let filteredTables = $derived(
		namespaceFilter === 'all'
			? allTables
			: allTables.filter((t) => t.namespace === namespaceFilter)
	);

	const devModeNotice = 'Schema changes require dev mode. Start `pnpm dev` to create DB blocks, add tables, edit schema, or run upgrades.';

	function topologyLabel(dynamic?: boolean): string {
		return dynamic ? 'Multi' : 'Single';
	}

	onMount(() => {
		void schemaStore.loadSchema();

		if (typeof window === 'undefined') {
			return;
		}

		try {
			const stored = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? '', 10);
			if (Number.isFinite(stored)) {
				sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, stored));
			}
		} catch {
			// Ignore storage access failures and keep the default width.
		}

		const syncMobile = () => {
			isMobile = window.innerWidth <= 768;
		};
		syncMobile();
		window.addEventListener('resize', syncMobile);

		return () => {
			stopResizing();
			window.removeEventListener('resize', syncMobile);
		};
	});

	function clampSidebarWidth(nextWidth: number): number {
		return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, nextWidth));
	}

	function persistSidebarWidth(nextWidth: number) {
		if (typeof window === 'undefined') return;
		try {
			localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
		} catch {
			// Ignore storage access failures.
		}
	}

	function stopResizing() {
		if (!resizing) return;
		resizing = false;
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
		persistSidebarWidth(sidebarWidth);
	}

	function handleResizeMove(event: PointerEvent) {
		if (!resizing) return;
		event.preventDefault();
		sidebarWidth = clampSidebarWidth(resizeStartWidth + event.clientX - resizeStartX);
	}

	function startResizing(event: PointerEvent) {
		if (isMobile) return;
		event.preventDefault();
		resizing = true;
		resizeStartX = event.clientX;
		resizeStartWidth = sidebarWidth;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		resizerEl?.setPointerCapture(event.pointerId);
	}
</script>

<div class="tables-layout">
	<!-- Inner Sidebar -->
	<aside class="tables-sidebar" style={`width:${sidebarWidth}px; min-width:${sidebarWidth}px;`}>
		<div class="tables-sidebar__header">
			<select class="tables-ns-filter" bind:value={namespaceFilter} aria-label="Database filter">
				<option value="all">All databases</option>
				{#each namespaces as ns}
					<option value={ns}>{ns}</option>
				{/each}
			</select>
			{#if isDevMode}
				<div class="tables-create-actions">
					<a href="{base}/database/new" class="tables-create-link">
						<Button variant="secondary" size="sm">+ DB</Button>
					</a>
					<a href="{base}/database/tables/new" class="tables-create-link">
						<Button variant="primary" size="sm">+ Table</Button>
					</a>
				</div>
			{:else}
				<div class="tables-create-actions" aria-label="Schema editing unavailable outside dev mode">
					<Button variant="secondary" size="sm" disabled>+ DB</Button>
					<Button variant="primary" size="sm" disabled>+ Table</Button>
				</div>
				<p class="tables-dev-note">
					Schema changes require dev mode. Start <code>pnpm dev</code> to create DB blocks, add tables,
					edit schema, or run upgrades.
				</p>
			{/if}
		</div>

		<nav class="tables-sidebar__list">
			{#each filteredTables as table}
				<a
					href="{base}/database/tables/{encodeURIComponent(table.name)}"
					class="tables-sidebar__item"
					class:tables-sidebar__item--active={selectedTable === table.name}
					title="{table.name} ({table.namespace}{table.provider ? ` · ${table.provider}` : ''} · {topologyLabel(table.dynamic)})"
				>
					<span class="tables-sidebar__icon">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
							<rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
							<path d="M2 6H14M2 10H14M6 6V14" stroke="currentColor" stroke-width="1.5"/>
						</svg>
					</span>
					<span class="tables-sidebar__name">{table.name}</span>
					{#if table.provider}
						<span class="tables-sidebar__provider-badge">
							{table.provider === 'postgres'
								? 'PG'
								: table.provider.toUpperCase()}
						</span>
					{/if}
					<span
						class="tables-sidebar__topology-badge"
						class:tables-sidebar__topology-badge--tenant={table.dynamic}
					>
						{topologyLabel(table.dynamic)}
					</span>
				</a>
			{/each}

			{#if filteredTables.length === 0}
				<div class="tables-sidebar__empty">No tables</div>
			{/if}
		</nav>
	</aside>
	{#if !isMobile}
		<button
			type="button"
			bind:this={resizerEl}
			class="tables-sidebar__resizer"
			class:tables-sidebar__resizer--active={resizing}
			aria-label="Resize tables sidebar"
			onpointerdown={startResizing}
			onpointermove={handleResizeMove}
			onpointerup={stopResizing}
			onpointercancel={stopResizing}
		></button>
	{/if}

	<!-- Main Content -->
	<div class="tables-main">
		{@render children()}
	</div>
</div>

<style>
	.tables-layout {
		display: flex;
		height: 100%;
		overflow: hidden;
	}

	/* ── Inner Sidebar ── */
	.tables-sidebar {
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		border-right: 1px solid var(--color-border);
		overflow: hidden;
	}

	.tables-sidebar__header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.tables-ns-filter {
		width: 100%;
		padding: var(--space-1) var(--space-2);
		font-size: 12px;
		font-family: inherit;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		outline: none;
	}

	.tables-ns-filter:focus {
		border-color: var(--color-primary);
	}

	.tables-create-link {
		text-decoration: none;
	}

	.tables-create-actions {
		display: flex;
		gap: var(--space-2);
	}

	.tables-dev-note {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.tables-dev-note code {
		font-family: var(--font-mono);
		padding: 1px 6px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
	}

	.tables-create-link :global(button) {
		width: 100%;
	}

	.tables-sidebar__list {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-2) 0;
	}

	.tables-sidebar__item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		font-family: var(--font-mono);
		color: var(--color-text-secondary);
		text-decoration: none;
		border-left: 2px solid transparent;
		transition: background-color 0.1s, color 0.1s;
	}

	.tables-sidebar__item:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.tables-sidebar__item--active {
		background: var(--color-bg-tertiary);
		color: var(--color-primary);
		border-left-color: var(--color-primary);
	}

	.tables-sidebar__icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		opacity: 0.6;
	}

	.tables-sidebar__item--active .tables-sidebar__icon {
		opacity: 1;
	}

	.tables-sidebar__name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tables-sidebar__provider-badge {
		flex-shrink: 0;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.5px;
		padding: 1px 4px;
		border-radius: 3px;
		background: var(--color-primary-subtle, rgba(99, 102, 241, 0.12));
		color: var(--color-primary);
		text-transform: uppercase;
		line-height: 1.4;
	}

	.tables-sidebar__topology-badge {
		flex-shrink: 0;
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.5px;
		padding: 1px 4px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
		color: var(--color-text-secondary);
		text-transform: uppercase;
		line-height: 1.4;
	}

	.tables-sidebar__topology-badge--tenant {
		background: color-mix(in srgb, var(--color-primary) 12%, transparent);
		color: var(--color-primary);
	}

	.tables-sidebar__empty {
		padding: var(--space-4) var(--space-3);
		font-size: 12px;
		color: var(--color-text-tertiary);
		text-align: center;
	}

	.tables-sidebar__resizer {
		flex: 0 0 8px;
		cursor: col-resize;
		position: relative;
		padding: 0;
		border: none;
		background: transparent;
	}

	.tables-sidebar__resizer::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 3px;
		width: 2px;
		border-radius: 999px;
		background: transparent;
		transition: background-color 0.12s ease;
	}

	.tables-sidebar__resizer:hover::before,
	.tables-sidebar__resizer--active::before {
		background: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
	}

	/* ── Main Content ── */
	.tables-main {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		padding: var(--space-5);
	}
</style>
