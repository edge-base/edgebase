<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { schemaStore } from '$lib/stores/schema';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let query = $state('');
	let selectedIndex = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();

	interface PaletteItem {
		label: string;
		description: string;
		href: string;
		category: string;
	}

	const navItems: PaletteItem[] = [
		{ label: 'Overview', description: 'Dashboard home', href: `${base}/`, category: 'Navigation' },
		{ label: 'Users', description: 'Manage user accounts', href: `${base}/auth`, category: 'Auth' },
		{ label: 'Auth Settings', description: 'Manage authentication providers and methods', href: `${base}/auth/settings`, category: 'Auth' },
		{ label: 'Tables', description: 'Database tables', href: `${base}/database/tables`, category: 'Database' },
		{ label: 'ERD Diagram', description: 'Entity relationship diagram', href: `${base}/database/erd`, category: 'Database' },
		{ label: 'Storage', description: 'File storage buckets', href: `${base}/storage`, category: 'Storage' },
		{ label: 'Functions', description: 'Serverless functions', href: `${base}/functions`, category: 'Functions' },
		{ label: 'Push Notifications', description: 'Push token management', href: `${base}/push`, category: 'Push' },
		{ label: 'Analytics', description: 'Traffic and performance', href: `${base}/analytics`, category: 'Analytics' },
		{ label: 'Events', description: 'Event timeline', href: `${base}/analytics/events`, category: 'Analytics' },
		{ label: 'Logs', description: 'Application logs', href: `${base}/logs`, category: 'Monitoring' },
		{ label: 'Live', description: 'WebSocket monitoring', href: `${base}/monitoring`, category: 'Monitoring' },
		{ label: 'Backup', description: 'Backup and restore', href: `${base}/backup`, category: 'System' },
		{ label: 'Project Info', description: 'Environment and resource overview', href: `${base}/settings`, category: 'System' },
	];

	let tableItems = $derived<PaletteItem[]>(
		Object.keys($schemaStore.schema || {}).map((name) => ({
			label: name,
			description: `Table: ${name}`,
			href: `${base}/database/tables/${name}`,
			category: 'Tables',
		}))
	);

	let allItems = $derived([...navItems, ...tableItems]);

	let filtered = $derived(() => {
		if (!query.trim()) return allItems;
		const q = query.toLowerCase();
		return allItems.filter(
			(item) =>
				item.label.toLowerCase().includes(q) ||
				item.description.toLowerCase().includes(q) ||
				item.category.toLowerCase().includes(q)
		);
	});

	let results = $derived(filtered());

	$effect(() => {
		if (open) {
			query = '';
			selectedIndex = 0;
			// Focus input after mount
			requestAnimationFrame(() => inputEl?.focus());
		}
	});

	// Reset selection when query changes
	$effect(() => {
		query; // track
		selectedIndex = 0;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, results.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (results[selectedIndex]) {
				navigate(results[selectedIndex].href);
			}
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	function navigate(href: string) {
		open = false;
		goto(href);
	}

	function close() {
		open = false;
	}

	function stopPropagation(e: MouseEvent) {
		e.stopPropagation();
	}
</script>

{#if open}
	<div class="palette-layer">
		<button
			type="button"
			class="palette-backdrop"
			aria-label="Close command palette"
			onclick={close}
		></button>
		<div
			class="palette"
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
			tabindex="-1"
			onclick={stopPropagation}
			onkeydown={handleKeydown}
		>
			<div class="palette__search">
				<svg class="palette__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
				</svg>
				<input
					bind:this={inputEl}
					class="palette__input"
					type="text"
					bind:value={query}
					placeholder="Search pages, tables..."
					onkeydown={handleKeydown}
				/>
				<kbd class="palette__kbd">ESC</kbd>
			</div>
			<div class="palette__results">
				{#if results.length === 0}
					<div class="palette__empty">No results found</div>
				{:else}
					{#each results as item, i (item.href)}
						<button
							class="palette__item"
							class:palette__item--selected={i === selectedIndex}
							onclick={() => navigate(item.href)}
							onmouseenter={() => (selectedIndex = i)}
						>
							<span class="palette__item-label">{item.label}</span>
							<span class="palette__item-desc">{item.description}</span>
							<span class="palette__item-cat">{item.category}</span>
						</button>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.palette-layer {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 20vh;
	}

	.palette-backdrop {
		position: absolute;
		inset: 0;
		border: none;
		padding: 0;
		background: rgba(0, 0, 0, 0.4);
		cursor: pointer;
	}

	.palette {
		max-width: min(560px, calc(100vw - 2rem));
		position: relative;
		z-index: 1;
		width: 560px;
		max-height: 420px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.palette__search {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.palette__search-icon {
		color: var(--color-text-tertiary);
		flex-shrink: 0;
	}

	.palette__input {
		flex: 1;
		border: none;
		background: transparent;
		font-size: 15px;
		outline: none;
		color: var(--color-text);
	}

	.palette__input::placeholder {
		color: var(--color-text-tertiary);
	}

	.palette__kbd {
		padding: 2px 6px;
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--color-text-tertiary);
		background: var(--color-bg-tertiary);
		border: 1px solid var(--color-border);
		border-radius: 3px;
	}

	.palette__results {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-1) 0;
	}

	.palette__empty {
		padding: var(--space-5);
		text-align: center;
		font-size: 0.875rem;
		color: var(--color-text-tertiary);
	}

	.palette__item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-4);
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background 0.05s;
	}

	.palette__item--selected {
		background: var(--color-bg-tertiary);
	}

	.palette__item-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.palette__item-desc {
		flex: 1;
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.palette__item-cat {
		font-size: 0.6875rem;
		padding: 1px 6px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}
</style>
