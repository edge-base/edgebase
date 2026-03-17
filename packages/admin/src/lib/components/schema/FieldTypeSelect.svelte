<script lang="ts">
	import { FIELD_TYPES } from '$lib/constants';

	interface Props {
		id?: string;
		value?: string;
		disabled?: boolean;
	}

	let { id, value = $bindable('string'), disabled = false }: Props = $props();

	const fallbackId = `field-type-${Math.random().toString(36).slice(2, 9)}`;
	let selectId = $derived(id ?? fallbackId);

	const typeDescriptions: Record<string, string> = {
		string: 'Short text (VARCHAR)',
		text: 'Long text (TEXT)',
		number: 'Numeric value',
		boolean: 'True/False',
		datetime: 'Date and time (ISO 8601)',
		json: 'JSON object/array',
	};
</script>

<select id={selectId} class="field-type-select" bind:value {disabled}>
	{#each FIELD_TYPES as ft}
		<option value={ft}>{ft} — {typeDescriptions[ft]}</option>
	{/each}
</select>

<style>
	.field-type-select {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font-size: 0.875rem;
		font-family: inherit;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		outline: none;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.field-type-select:focus {
		border-color: var(--color-primary);
	}

	.field-type-select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
