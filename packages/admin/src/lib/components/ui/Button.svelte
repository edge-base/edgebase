<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md';
		disabled?: boolean;
		loading?: boolean;
		type?: 'button' | 'submit' | 'reset';
		onclick?: (e: MouseEvent) => void;
		children?: Snippet;
	}

	let {
		variant = 'primary',
		size = 'md',
		disabled = false,
		loading = false,
		type = 'button',
		onclick,
		children,
	}: Props = $props();
</script>

<button
	class="btn btn--{variant} btn--{size}"
	{type}
	disabled={disabled || loading}
	{onclick}
>
	{#if loading}
		<span class="spinner" aria-hidden="true"></span>
	{/if}
	<span class="btn__content" class:btn__content--hidden={loading}>
		{#if children}
			{@render children()}
		{/if}
	</span>
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		font-weight: 500;
		font-family: inherit;
		cursor: pointer;
		transition: background-color 0.15s, border-color 0.15s, opacity 0.15s;
		position: relative;
		white-space: nowrap;
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Sizes */
	.btn--sm {
		padding: var(--space-1) var(--space-3);
		font-size: 0.8125rem;
		line-height: 1.25rem;
	}

	.btn--md {
		padding: var(--space-2) var(--space-4);
		font-size: 0.875rem;
		line-height: 1.25rem;
	}

	/* Variants */
	.btn--primary {
		background-color: var(--color-primary);
		color: #fff;
		border-color: var(--color-primary);
	}

	.btn--primary:not(:disabled):hover {
		filter: brightness(1.1);
	}

	.btn--secondary {
		background-color: var(--color-bg-secondary);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.btn--secondary:not(:disabled):hover {
		background-color: var(--color-border);
	}

	.btn--danger {
		background-color: var(--color-danger);
		color: #fff;
		border-color: var(--color-danger);
	}

	.btn--danger:not(:disabled):hover {
		filter: brightness(1.1);
	}

	.btn--ghost {
		background-color: transparent;
		color: var(--color-text);
		border-color: transparent;
	}

	.btn--ghost:not(:disabled):hover {
		background-color: var(--color-bg-secondary);
	}

	/* Spinner */
	.spinner {
		position: absolute;
		width: 1em;
		height: 1em;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.btn__content--hidden {
		visibility: hidden;
	}
</style>
