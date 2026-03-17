<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'value'> {
		label?: string;
		value?: string;
		error?: string;
	}

	let {
		id,
		label,
		value = $bindable(''),
		type = 'text',
		placeholder = '',
		error,
		disabled = false,
		...rest
	}: Props = $props();

	const fallbackId = `input-${Math.random().toString(36).slice(2, 9)}`;
	let inputId = $derived(id ?? fallbackId);
</script>

<div class="field">
	{#if label}
		<label class="field__label" for={inputId}>{label}</label>
	{/if}
	<input
		id={inputId}
		class="field__input"
		class:field__input--error={!!error}
		{type}
		{placeholder}
		{disabled}
		{...rest}
		bind:value
	/>
	{#if error}
		<p class="field__error">{error}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field__label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.field__input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font-size: 0.875rem;
		font-family: inherit;
		line-height: 1.25rem;
		color: var(--color-text);
		background-color: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		outline: none;
		transition: border-color 0.15s;
		box-sizing: border-box;
	}

	.field__input::placeholder {
		color: var(--color-text-secondary);
	}

	.field__input:focus {
		border-color: var(--color-primary);
	}

	.field__input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.field__input--error {
		border-color: var(--color-danger);
	}

	.field__input--error:focus {
		border-color: var(--color-danger);
	}

	.field__error {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-danger);
	}
</style>
