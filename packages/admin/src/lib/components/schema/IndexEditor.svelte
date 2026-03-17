<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';

	interface IndexConfig {
		fields: string[];
		unique?: boolean;
	}

	interface Props {
		indexes: IndexConfig[];
		availableFields?: string[];
		readonly?: boolean;
		onadd?: (index: IndexConfig) => void;
		ondelete?: (idx: number) => void;
	}

	let {
		indexes = [],
		availableFields = [],
		readonly = false,
		onadd,
		ondelete,
	}: Props = $props();

	let showForm = $state(false);
	let newFields = $state('');
	let newUnique = $state(false);
	let error = $state('');

	function handleAdd() {
		const fields = newFields.split(',').map(f => f.trim()).filter(Boolean);
		if (fields.length === 0) {
			error = 'At least one field is required.';
			return;
		}
		const invalid = fields.filter(f => !availableFields.includes(f));
		if (invalid.length > 0) {
			error = `Unknown field(s): ${invalid.join(', ')}`;
			return;
		}
		onadd?.({ fields, unique: newUnique || undefined });
		newFields = '';
		newUnique = false;
		error = '';
		showForm = false;
	}
</script>

<div class="index-editor">
	<div class="index-editor__header">
		<span class="index-editor__title">Indexes ({indexes.length})</span>
		{#if !readonly}
			<Button variant="secondary" size="sm" onclick={() => (showForm = !showForm)}>
				{showForm ? 'Cancel' : 'Add Index'}
			</Button>
		{/if}
	</div>

	{#if showForm}
		<div class="index-form">
			{#if error}
				<div class="index-error">{error}</div>
			{/if}
			<div class="index-form__row">
				<Input bind:value={newFields} placeholder="field1, field2" label="Fields (comma-separated)" />
			</div>
			<div class="index-form__row">
				<Toggle bind:checked={newUnique} label="Unique index" />
			</div>
			<div class="index-form__actions">
				<Button variant="primary" size="sm" onclick={handleAdd}>Add</Button>
			</div>
		</div>
	{/if}

	{#if indexes.length === 0 && !showForm}
		<div class="index-empty">No indexes defined.</div>
	{:else}
		{#each indexes as index, i}
			<div class="index-row">
				<code class="index-fields">{index.fields.join(', ')}</code>
				{#if index.unique}
					<span class="index-unique">UNIQUE</span>
				{/if}
				{#if !readonly}
					<button class="index-delete" onclick={() => ondelete?.(i)} title="Remove index">
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<path d="M4 4L10 10M10 4L4 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
						</svg>
					</button>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.index-editor {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.index-editor__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.index-editor__title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.index-form {
		padding: var(--space-4);
		border-bottom: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.index-form__actions {
		display: flex;
		justify-content: flex-end;
	}

	.index-error {
		padding: var(--space-2) var(--space-3);
		background: #fee2e2;
		color: #991b1b;
		font-size: 12px;
		border-radius: var(--radius-sm);
	}

	.index-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.index-row:last-child {
		border-bottom: none;
	}

	.index-fields {
		font-family: var(--font-mono);
		font-size: 13px;
		flex: 1;
	}

	.index-unique {
		padding: 1px 6px;
		background: #dbeafe;
		color: #1e40af;
		font-size: 11px;
		font-weight: 500;
		border-radius: var(--radius-sm);
	}

	.index-empty {
		padding: var(--space-4);
		text-align: center;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.index-delete {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.index-delete:hover {
		background: #fee2e2;
		color: var(--color-danger);
	}
</style>
