<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Tab {
		id: string;
		label: string;
	}

	interface Props {
		tabs?: Tab[];
		activeTab?: string;
		children?: Snippet;
	}

	let {
		tabs = [],
		activeTab = $bindable(''),
		children,
	}: Props = $props();

	// Default to first tab if none specified
	$effect(() => {
		if (!activeTab && tabs.length > 0) {
			activeTab = tabs[0].id;
		}
	});
</script>

<div class="tabs">
	<div class="tabs__header" role="tablist">
		{#each tabs as tab (tab.id)}
			<button
				class="tabs__tab"
				class:tabs__tab--active={activeTab === tab.id}
				role="tab"
				aria-selected={activeTab === tab.id}
				onclick={() => (activeTab = tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>
	<div class="tabs__content" role="tabpanel">
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	.tabs {
		display: flex;
		flex-direction: column;
	}

	.tabs__header {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--color-border);
		overflow-x: auto;
		overflow-y: hidden;
	}

	.tabs__tab {
		padding: var(--space-2) var(--space-4);
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		color: var(--color-text-secondary);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.15s, border-color 0.15s;
	}

	.tabs__tab:hover {
		color: var(--color-text);
	}

	.tabs__tab--active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.tabs__content {
		padding-top: var(--space-4);
	}
</style>
