<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';

	interface SelectOption {
		value: string;
		label: string;
	}

	interface Props extends Omit<HTMLSelectAttributes, 'value'> {
		id?: string;
		label?: string;
		value?: string;
		options?: SelectOption[];
		error?: string;
	}

	let {
		id,
		label,
		value = $bindable(''),
		options = [],
		error,
		disabled = false,
		...rest
	}: Props = $props();

	const fallbackId = `select-${Math.random().toString(36).slice(2, 9)}`;
	let selectId = $derived(id ?? fallbackId);
</script>

<div class="field">
	{#if label}
		<label class="field__label" for={selectId}>{label}</label>
	{/if}
	<div class="field__select-wrapper">
		<select
			id={selectId}
			class="field__select"
			class:field__select--error={!!error}
			{disabled}
			{...rest}
			bind:value
		>
			{#each options as opt (opt.value)}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
		<span class="field__chevron" aria-hidden="true">
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
				<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</span>
	</div>
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

	.field__select-wrapper {
		position: relative;
	}

	.field__select {
		width: 100%;
		padding: var(--space-2) var(--space-6) var(--space-2) var(--space-3);
		font-size: 0.875rem;
		font-family: inherit;
		line-height: 1.25rem;
		color: var(--color-text);
		background-color: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		outline: none;
		appearance: none;
		cursor: pointer;
		transition: border-color 0.15s;
		box-sizing: border-box;
	}

	.field__select:focus {
		border-color: var(--color-primary);
	}

	.field__select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.field__select--error {
		border-color: var(--color-danger);
	}

	.field__chevron {
		position: absolute;
		right: var(--space-3);
		top: 50%;
		transform: translateY(-50%);
		pointer-events: none;
		color: var(--color-text-secondary);
	}

	.field__error {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-danger);
	}
</style>
