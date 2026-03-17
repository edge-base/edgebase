<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import FieldTypeSelect from './FieldTypeSelect.svelte';
	import { AUTO_FIELDS, LIMITS, type SchemaField } from '$lib/constants';

	interface Props {
		open?: boolean;
		mode?: 'create' | 'edit';
		columnName?: string;
		field?: SchemaField;
		existingColumns?: string[];
		onsave?: (name: string, field: SchemaField) => void;
	}

	let {
		open = $bindable(false),
		mode = 'create',
		columnName = '',
		field = { type: 'string' },
		existingColumns = [],
		onsave,
	}: Props = $props();

	// Local editable state
	let name = $state('');
	let type = $state('string');
	let required = $state(false);
	let unique = $state(false);
	let defaultValue = $state('');
	let min = $state('');
	let max = $state('');
	let pattern = $state('');
	let enumValues = $state('');
	let references = $state('');
	let check = $state('');
	let error = $state('');
	const typeSelectId = `schema-field-type-${Math.random().toString(36).slice(2, 9)}`;

	// Sync external → local state when opening
	$effect(() => {
		if (open) {
			name = columnName;
			type = field.type || 'string';
			required = field.required ?? false;
			unique = field.unique ?? false;
			defaultValue = field.default !== undefined ? String(field.default) : '';
			min = field.min !== undefined ? String(field.min) : '';
			max = field.max !== undefined ? String(field.max) : '';
			pattern = field.pattern ?? '';
			enumValues = field.enum ? field.enum.join(', ') : '';
			references = typeof field.references === 'string' ? field.references : '';
			check = field.check ?? '';
			error = '';
		}
	});

	function validate(): boolean {
		if (!name.trim()) {
			error = 'Column name is required.';
			return false;
		}
		if (name.length > LIMITS.FIELD_NAME_MAX) {
			error = `Column name must be ${LIMITS.FIELD_NAME_MAX} chars or less.`;
			return false;
		}
		if (AUTO_FIELDS.includes(name as typeof AUTO_FIELDS[number])) {
			error = `"${name}" is an auto-managed field and cannot be created manually.`;
			return false;
		}
		if (mode === 'create' && existingColumns.includes(name)) {
			error = `Column "${name}" already exists.`;
			return false;
		}
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
			error = 'Column name must start with a letter or underscore and contain only alphanumeric characters.';
			return false;
		}
		return true;
	}

	function handleSave() {
		if (!validate()) return;

		const fieldDef: SchemaField = { type };
		if (required) fieldDef.required = true;
		if (unique) fieldDef.unique = true;
		if (defaultValue) {
			if (type === 'number') fieldDef.default = Number(defaultValue);
			else if (type === 'boolean') fieldDef.default = defaultValue === 'true';
			else fieldDef.default = defaultValue;
		}
		if (min) fieldDef.min = Number(min);
		if (max) fieldDef.max = Number(max);
		if (pattern) fieldDef.pattern = pattern;
		if (enumValues.trim()) {
			fieldDef.enum = enumValues.split(',').map(v => v.trim()).filter(Boolean);
		}
		if (references) fieldDef.references = references;
		if (check) fieldDef.check = check;

		onsave?.(name, fieldDef);
		open = false;
	}
</script>

<Modal bind:open title={mode === 'create' ? 'Add Column' : `Edit Column: ${columnName}`}>
	<div class="editor-form">
		{#if error}
			<div class="editor-error">{error}</div>
		{/if}

		<div class="editor-field">
			<Input label="Column Name" bind:value={name} placeholder="column_name" disabled={mode === 'edit'} />
		</div>

		<div class="editor-field">
			<label class="editor-label" for={typeSelectId}>Type</label>
			<FieldTypeSelect id={typeSelectId} bind:value={type} />
		</div>

		<div class="editor-row">
			<Toggle bind:checked={required} label="Required" />
			<Toggle bind:checked={unique} label="Unique" />
		</div>

		<div class="editor-field">
			<Input label="Default Value" bind:value={defaultValue} placeholder="Optional default" />
		</div>

		{#if type === 'number'}
			<div class="editor-row">
				<div class="editor-field">
					<Input label="Min" bind:value={min} type="number" placeholder="—" />
				</div>
				<div class="editor-field">
					<Input label="Max" bind:value={max} type="number" placeholder="—" />
				</div>
			</div>
		{/if}

		{#if type === 'string'}
			<div class="editor-field">
				<Input label="Pattern (regex)" bind:value={pattern} placeholder="^[a-z]+$" />
			</div>
			<div class="editor-field">
				<Input label="Enum (comma-separated)" bind:value={enumValues} placeholder="active, inactive, pending" />
			</div>
		{/if}

		<div class="editor-field">
			<Input label="References (table.column)" bind:value={references} placeholder="users.id" />
		</div>

		<div class="editor-field">
			<Input label="Check Expression" bind:value={check} placeholder="value > 0" />
		</div>
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" onclick={handleSave}>{mode === 'create' ? 'Add Column' : 'Save'}</Button>
	{/snippet}
</Modal>

<style>
	.editor-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.editor-error {
		padding: var(--space-3);
		background: #fee2e2;
		color: #991b1b;
		font-size: 13px;
		border-radius: var(--radius-md);
	}

	.editor-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		flex: 1;
	}

	.editor-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.editor-row {
		display: flex;
		gap: var(--space-4);
		align-items: flex-start;
	}
</style>
