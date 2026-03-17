<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		description?: string;
		children?: Snippet;
	}

	let {
		title = 'No data',
		description,
		children,
	}: Props = $props();
</script>

<div class="empty">
	<div class="empty__icon" aria-hidden="true">
		<svg width="48" height="48" viewBox="0 0 48 48" fill="none">
			<rect x="8" y="12" width="32" height="24" rx="3" stroke="currentColor" stroke-width="2"/>
			<path d="M8 20H40" stroke="currentColor" stroke-width="2"/>
			<circle cx="14" cy="16" r="1.5" fill="currentColor"/>
			<circle cx="20" cy="16" r="1.5" fill="currentColor"/>
		</svg>
	</div>
	<h3 class="empty__title">{title}</h3>
	{#if description}
		<p class="empty__description">{description}</p>
	{/if}
	{#if children}
		<div class="empty__action">
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-8);
		text-align: center;
	}

	.empty__icon {
		color: var(--color-text-secondary);
		opacity: 0.4;
		margin-bottom: var(--space-4);
	}

	.empty__title {
		margin: 0 0 var(--space-1) 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.empty__description {
		margin: 0 0 var(--space-4) 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		max-width: 320px;
		line-height: 1.5;
	}

	.empty__action {
		margin-top: var(--space-2);
	}
</style>
