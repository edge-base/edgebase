<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string;
		docsHref?: string;
		actions?: Snippet;
		children?: Snippet;
	}

	let { title, description, docsHref, actions, children }: Props = $props();
</script>

<div class="page-shell">
	<div class="page-shell__header">
		<div class="page-shell__info">
			<h2 class="page-shell__title">{title}</h2>
			{#if description}
				<p class="page-shell__description">{description}</p>
			{/if}
		</div>
		{#if docsHref || actions}
			<div class="page-shell__actions">
				{#if docsHref}
					<a class="page-shell__docs-link" href={docsHref} target="_blank" rel="noreferrer">
						<span>Docs</span>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path d="M6 3H13V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
							<path d="M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					</a>
				{/if}
				{#if actions}
					{@render actions()}
				{/if}
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

	.page-shell__docs-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-decoration: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		transition: background 0.1s, color 0.1s, border-color 0.1s;
	}

	.page-shell__docs-link:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border-color: color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
	}

</style>
