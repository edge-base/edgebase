<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { schemaStore, namespaceNames } from '$lib/stores/schema';
	import { devInfoStore } from '$lib/stores/devInfo';
	import { api } from '$lib/api';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import { LIMITS, type SchemaField } from '$lib/constants';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import ColumnList from '$lib/components/schema/ColumnList.svelte';
	import SchemaFieldEditor from '$lib/components/schema/SchemaFieldEditor.svelte';

	let dbKey = $state('');
	let tableName = $state('');
	let schema = $state<Record<string, SchemaField>>({});
	let saving = $state(false);
	let error = $state('');
	let isDevMode = $derived($devInfoStore.devMode);

	// Field editor modal state
	let editorOpen = $state(false);
	let editorMode = $state<'create' | 'edit'>('create');
	let editorColumn = $state('');
	let editorField = $state<SchemaField>({ type: 'string' });
	const namespaceSelectId = `create-table-namespace-${Math.random().toString(36).slice(2, 9)}`;

	// Existing namespaces
	let existingNamespaces = $derived($namespaceNames);

	onMount(async () => {
		await schemaStore.loadSchema();
		const requestedNamespace = get(page).url.searchParams.get('dbKey')?.trim();
		const namespaces = get(namespaceNames);
		dbKey = requestedNamespace || (namespaces.includes('shared') ? 'shared' : namespaces[0] ?? 'shared');
	});

	function openAddColumn() {
		editorMode = 'create';
		editorColumn = '';
		editorField = { type: 'string' };
		editorOpen = true;
	}

	function openEditColumn(name: string, field: SchemaField) {
		editorMode = 'edit';
		editorColumn = name;
		editorField = { ...field };
		editorOpen = true;
	}

	function handleFieldSave(name: string, field: SchemaField) {
		schema = { ...schema, [name]: field };
	}

	function handleFieldDelete(name: string) {
		const { [name]: _, ...rest } = schema;
		schema = rest;
	}

	function validate(): boolean {
		const nextTableName = tableName.trim();
		if (!nextTableName) {
			error = 'Table name is required.';
			return false;
		}
		if (nextTableName.length > LIMITS.TABLE_NAME_MAX) {
			error = `Table name must be ${LIMITS.TABLE_NAME_MAX} chars or less.`;
			return false;
		}
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nextTableName)) {
			error = 'Table name must start with a letter or underscore.';
			return false;
		}
		return true;
	}

	async function handleCreate() {
		if (!isDevMode) {
			error = 'Creating tables requires dev mode with the schema sidecar. Start `pnpm dev` and try again.';
			toastError(error);
			return;
		}
		if (!validate()) return;

		saving = true;
		error = '';
		const nextDbKey = dbKey.trim() || 'shared';
		const nextTableName = tableName.trim();

		try {
			await api.schemaMutation(`schema/tables`, {
				method: 'POST',
				body: { dbKey: nextDbKey, name: nextTableName, schema },
			});
			toastSuccess(`Table "${nextTableName}" created`);
			await schemaStore.waitForTableReady(nextTableName, { namespace: nextDbKey });
			goto(`${base}/database/tables/${encodeURIComponent(nextTableName)}`);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create table.';
			toastError(error);
		} finally {
			saving = false;
		}
	}
</script>

<div class="create-page">
	<h2 class="create-title">Create Table</h2>
	<p class="create-desc">Define a new database table</p>

	<div class="create-form">
		{#if error}
			<div class="create-error">{error}</div>
		{/if}

		{#if !isDevMode}
			<div class="readonly-banner">
				Creating tables requires dev mode. Start <code>pnpm dev</code> to enable schema edits.
			</div>
		{/if}

		<div class="create-section">
			<div class="create-row">
				<div class="create-field">
					<label class="create-label" for={namespaceSelectId}>Database</label>
					<div class="ns-select">
						<select id={namespaceSelectId} class="ns-dropdown" bind:value={dbKey}>
							{#each existingNamespaces as ns}
								<option value={ns}>{ns}</option>
							{/each}
							{#if !existingNamespaces.includes(dbKey) && dbKey !== 'default'}
								<option value={dbKey}>{dbKey} (new)</option>
							{/if}
						</select>
						<Input
							label="Choose or create a database"
							bind:value={dbKey}
							placeholder="Type a new database name..."
						/>
					</div>
				</div>
				<div class="create-field">
					<Input label="Table Name" bind:value={tableName} placeholder="my_table" />
				</div>
			</div>
		</div>

		<div class="create-section">
			<div class="auto-fields-info">
				Auto-managed fields (id, createdAt, updatedAt) are automatically included.
			</div>

			<ColumnList
				fields={schema}
				readonly={!isDevMode}
				onaddclick={openAddColumn}
				oneditclick={openEditColumn}
				ondeleteclick={handleFieldDelete}
			/>
		</div>

		<div class="create-actions">
			<a href="{base}/database/tables">
				<Button variant="secondary">Cancel</Button>
			</a>
			<Button variant="primary" loading={saving} disabled={!isDevMode} onclick={handleCreate}>
				Create Table
			</Button>
		</div>
	</div>

	<SchemaFieldEditor
		bind:open={editorOpen}
		mode={editorMode}
		columnName={editorColumn}
		field={editorField}
		existingColumns={Object.keys(schema)}
		onsave={handleFieldSave}
	/>
</div>

<style>
	.create-page {
		max-width: 800px;
	}

	.create-title {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}

	.create-desc {
		margin: var(--space-1) 0 var(--space-5);
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.create-error {
		padding: var(--space-3) var(--space-4);
		background: #fee2e2;
		color: #991b1b;
		font-size: 13px;
		border-radius: var(--radius-md);
	}

	.readonly-banner {
		padding: var(--space-3) var(--space-4);
		background: #fef3c7;
		color: #92400e;
		font-size: 13px;
		line-height: 1.6;
		border-radius: var(--radius-md);
	}

	.readonly-banner code {
		font-family: var(--font-mono);
	}

	.create-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.create-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}

	.create-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.create-label {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text);
	}

	.ns-select {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.ns-dropdown {
		padding: var(--space-2) var(--space-3);
		font-size: 0.875rem;
		font-family: inherit;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		outline: none;
	}

	.ns-dropdown:focus {
		border-color: var(--color-primary);
	}

	.auto-fields-info {
		padding: var(--space-3) var(--space-4);
		background: #eff6ff;
		color: #1e40af;
		font-size: 13px;
		border-radius: var(--radius-md);
	}

	.create-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
</style>
