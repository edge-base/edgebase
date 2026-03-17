<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		actions?: Snippet;
		children?: Snippet;
	}

	let { title, description, actions, children }: Props = $props();
</script>

<div class="page-shell">
	<div class="page-shell__header">
		<div class="page-shell__info">
			<h2 class="page-shell__title">{title}</h2>
			{#if description}
				<p class="page-shell__description">{description}</p>
			{/if}
		</div>
		{#if actions}
			<div class="page-shell__actions">
				{@render actions()}
			</div>
		{/if}
	</div>
	<div class="page-shell__content">
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	.page-shell {
		padding: var(--space-5) var(--space-6);
		max-width: 1200px;
	}

	.page-shell__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-5);
		flex-wrap: wrap;
	}

	.page-shell__info {
		min-width: 180px;
	}

	.page-shell__title {
		font-size: 20px;
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
	}

	.page-shell__description {
		margin-top: var(--space-1);
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.page-shell__actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

</style>
