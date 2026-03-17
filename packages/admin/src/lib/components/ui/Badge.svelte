<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
		text?: string;
		children?: Snippet;
	}

	let {
		variant = 'default',
		text = '',
		children,
	}: Props = $props();
</script>

<span class="badge badge--{variant}">{#if children}{@render children()}{:else}{text}{/if}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 2px var(--space-2);
		font-size: 0.6875rem;
		font-weight: 500;
		line-height: 1.25rem;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.badge--default {
		background-color: var(--color-bg-secondary);
		color: var(--color-text-secondary);
	}

	.badge--primary {
		background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
		color: var(--color-primary);
	}

	.badge--success {
		background-color: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-success);
	}

	.badge--warning {
		background-color: color-mix(in srgb, var(--color-warning) 15%, transparent);
		color: var(--color-warning);
	}

	.badge--danger {
		background-color: color-mix(in srgb, var(--color-danger) 15%, transparent);
		color: var(--color-danger);
	}
</style>
