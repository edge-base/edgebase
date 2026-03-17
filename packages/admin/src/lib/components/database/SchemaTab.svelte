<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { schemaStore, type TableDef } from '$lib/stores/schema';
	import { devInfoStore } from '$lib/stores/devInfo';
	import { api } from '$lib/api';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Tabs from '$lib/components/ui/Tabs.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import ColumnList from '$lib/components/schema/ColumnList.svelte';
	import SchemaFieldEditor from '$lib/components/schema/SchemaFieldEditor.svelte';
	import IndexEditor from '$lib/components/schema/IndexEditor.svelte';
	import FtsEditor from '$lib/components/schema/FtsEditor.svelte';
	import type { SchemaField, IndexConfig } from '$lib/constants';

	let { tableName }: { tableName: string } = $props();

	let tableDef = $state<TableDef | null>(null);
	let activeTab = $state('columns');
	let isDevMode = $derived($devInfoStore.devMode);

	// Field editor modal state
	let editorOpen = $state(false);
	let editorMode = $state<'create' | 'edit'>('create');
	let editorColumn = $state('');
	let editorField = $state<SchemaField>({ type: 'string' });

	// Delete confirmation
	let confirmDeleteOpen = $state(false);
	let pendingDeleteColumn = $state('');

	// Table delete confirmation
	let confirmTableDeleteOpen = $state(false);

	// Rename state
	let renaming = $state(false);
	let newTableName = $state('');

	const tabs = [
		{ id: 'columns', label: 'Columns' },
		{ id: 'indexes', label: 'Indexes' },
		{ id: 'fts', label: 'FTS' },
	];

	// Sync tableDef from schema store (auto-subscribed via $schemaStore)
	$effect(() => {
		const state = $schemaStore;
		if (tableName && state.schema[tableName]) {
			tableDef = state.schema[tableName];
		} else {
			tableDef = null;
		}
	});

	let fields = $derived(tableDef?.fields ?? {});
	let indexes = $derived<IndexConfig[]>(tableDef?.indexes ?? []);
	let ftsFields = $derived(tableDef?.fts ?? []);
	let dbKey = $derived(tableDef?.namespace ?? 'default');
	let renameBlockedReason = $derived(
		tableDef?.dynamic
			? 'Table rename is unavailable for per-tenant databases because each tenant instance has its own physical database.'
			: ''
	);

	let eligibleFtsFields = $derived(
		Object.entries(fields)
			.filter(([, f]) => f.type === 'string' || f.type === 'text')
			.map(([name]) => name)
	);

	// ── Column Actions ───────────────────────────
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

	function confirmDeleteColumn(name: string) {
		pendingDeleteColumn = name;
		confirmDeleteOpen = true;
	}

	function normalizeIndex(index: IndexConfig): string {
		return JSON.stringify({
			fields: index.fields,
			unique: index.unique === true ? true : undefined
		});
	}

	function sameField(a: SchemaField | undefined, b: SchemaField): boolean {
		return JSON.stringify(a ?? null) === JSON.stringify(b);
	}

	function sameIndexList(a: IndexConfig[], b: IndexConfig[]): boolean {
		if (a.length !== b.length) return false;
		return a.every((index, idx) => normalizeIndex(index) === normalizeIndex(b[idx]));
	}

	function sameFieldSet(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		const left = [...a].sort();
		const right = [...b].sort();
		return left.every((field, idx) => field === right[idx]);
	}

	async function handleFieldSave(name: string, field: SchemaField) {
		try {
			if (editorMode === 'create') {
				await api.schemaMutation(`schema/tables/${encodeURIComponent(tableName)}/columns`, {
					method: 'POST',
					body: { dbKey, columnName: name, fieldDef: field },
				});
				toastSuccess(`Column "${name}" added`);
			} else {
				await api.schemaMutation(`schema/tables/${encodeURIComponent(tableName)}/columns/${name}`, {
					method: 'PUT',
					body: { dbKey, fieldDef: field },
				});
				toastSuccess(`Column "${name}" updated`);
			}
			await schemaStore.waitForSchema((schema) => {
				const nextTable = schema[tableName];
				return Boolean(nextTable && sameField(nextTable.fields[name], field));
			});
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to save column');
		}
	}

	async function handleDeleteColumn() {
		confirmDeleteOpen = false;
		try {
			await api.schemaMutation(`schema/tables/${encodeURIComponent(tableName)}/columns/${pendingDeleteColumn}`, {
				method: 'DELETE',
				body: { dbKey },
			});
			toastSuccess(`Column "${pendingDeleteColumn}" deleted`);
			await schemaStore.waitForSchema((schema) => {
				const nextTable = schema[tableName];
				return Boolean(nextTable && !(pendingDeleteColumn in nextTable.fields));
			});
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to delete column');
		}
	}

	// ── Index Actions ────────────────────────────
	async function handleAddIndex(indexDef: IndexConfig) {
		try {
			const expectedIndexes = [...indexes, indexDef];
			await api.schemaMutation(`schema/tables/${encodeURIComponent(tableName)}/indexes`, {
				method: 'POST',
				body: { dbKey, indexDef },
			});
			toastSuccess('Index added');
			await schemaStore.waitForSchema((schema) => {
				const nextTable = schema[tableName];
				return Boolean(nextTable && sameIndexList(nextTable.indexes ?? [], expectedIndexes));
			});
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to add index');
		}
	}

	async function handleDeleteIndex(idx: number) {
		try {
			const expectedIndexes = indexes.filter((_, currentIdx) => currentIdx !== idx);
			await api.schemaMutation(`schema/tables/${encodeURIComponent(tableName)}/indexes/${idx}`, {
				method: 'DELETE',
				body: { dbKey },
			});
			toastSuccess('Index removed');
			await schemaStore.waitForSchema((schema) => {
				const nextTable = schema[tableName];
				return Boolean(nextTable && sameIndexList(nextTable.indexes ?? [], expectedIndexes));
			});
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to remove index');
		}
	}

	// ── FTS Actions ──────────────────────────────
	async function handleSaveFts(newFields: string[]) {
		try {
			await api.schemaMutation(`schema/tables/${encodeURIComponent(tableName)}/fts`, {
				method: 'PUT',
				body: { dbKey, fields: newFields },
			});
			toastSuccess('FTS configuration updated');
			await schemaStore.waitForSchema((schema) => {
				const nextTable = schema[tableName];
				return Boolean(nextTable && sameFieldSet(nextTable.fts ?? [], newFields));
			});
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to update FTS');
		}
	}

	// ── Table Actions ────────────────────────────
	async function handleDeleteTable() {
		confirmTableDeleteOpen = false;
		try {
			await api.schemaMutation(`schema/tables/${encodeURIComponent(tableName)}`, {
				method: 'DELETE',
				body: { dbKey },
			});
			toastSuccess(`Table "${tableName}" deleted`);
			await schemaStore.waitForSchema((schema) => !(tableName in schema));
			goto(`${base}/database/tables`);
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to delete table');
		}
	}

	async function handleRename() {
		const nextTableName = newTableName.trim();
		if (!nextTableName) return;
		try {
			await api.schemaMutation(`schema/tables/${encodeURIComponent(tableName)}/rename`, {
				method: 'PUT',
				body: { dbKey, newName: nextTableName },
			});
			toastSuccess(`Table renamed to "${nextTableName}"`);
			await schemaStore.waitForSchema(
				(schema) => !(tableName in schema) && Boolean(schema[nextTableName]),
				{ timeoutMessage: `Table rename to "${nextTableName}" did not propagate in time.` }
			);
			await schemaStore.waitForTableReady(nextTableName, { namespace: dbKey });
			goto(`${base}/database/tables/${encodeURIComponent(nextTableName)}`);
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to rename table');
		} finally {
			renaming = false;
		}
	}
</script>

<div class="schema-tab">
	{#if $schemaStore.loading}
		<div class="schema-empty">Loading schema...</div>
	{:else if !tableDef}
		<div class="schema-empty">Table "{tableName}" not found.</div>
	{:else}
		{#if !isDevMode}
			<div class="readonly-banner">
				Schema editing requires dev mode. Viewing in read-only mode.
			</div>
		{/if}

		{#if isDevMode}
			<div class="schema-actions">
				{#if renaming}
					<div class="rename-inline">
						<input
							class="rename-input"
							bind:value={newTableName}
							placeholder="new_name"
							onkeydown={(e) => e.key === 'Enter' && handleRename()}
						/>
						<Button variant="primary" size="sm" onclick={handleRename}>Rename</Button>
						<Button variant="secondary" size="sm" onclick={() => (renaming = false)}>Cancel</Button>
					</div>
				{:else}
					<Button
						variant="secondary"
						size="sm"
						disabled={Boolean(renameBlockedReason)}
						onclick={() => {
							renaming = true;
							newTableName = tableName;
						}}
					>
						Rename
					</Button>
					<Button variant="danger" size="sm" onclick={() => (confirmTableDeleteOpen = true)}>Delete Table</Button>
				{/if}
			</div>
			{#if renameBlockedReason}
				<div class="schema-note">{renameBlockedReason}</div>
			{/if}
		{/if}

		<div class="schema-namespace">
			Namespace: <code>{dbKey}</code>
		</div>

		<Tabs {tabs} bind:activeTab>
			{#if activeTab === 'columns'}
				<ColumnList
					{fields}
					readonly={!isDevMode}
					onaddclick={openAddColumn}
					oneditclick={openEditColumn}
					ondeleteclick={confirmDeleteColumn}
				/>
			{:else if activeTab === 'indexes'}
				<IndexEditor
					{indexes}
					availableFields={Object.keys(fields)}
					readonly={!isDevMode}
					onadd={handleAddIndex}
					ondelete={handleDeleteIndex}
				/>
			{:else if activeTab === 'fts'}
				<FtsEditor
					{ftsFields}
					availableFields={eligibleFtsFields}
					readonly={!isDevMode}
					onsave={handleSaveFts}
				/>
			{/if}
		</Tabs>
	{/if}
</div>

<SchemaFieldEditor
	bind:open={editorOpen}
	mode={editorMode}
	columnName={editorColumn}
	field={editorField}
	existingColumns={Object.keys(fields)}
	onsave={handleFieldSave}
/>

<ConfirmDialog
	bind:open={confirmDeleteOpen}
	title="Delete Column"
	message='Are you sure you want to delete column "{pendingDeleteColumn}"? This action will modify edgebase.config.ts.'
	confirmLabel="Delete"
	confirmVariant="danger"
	onconfirm={handleDeleteColumn}
/>

<ConfirmDialog
	bind:open={confirmTableDeleteOpen}
	title="Delete Table"
	message='Are you sure you want to delete table "{tableName}"? This will remove it from edgebase.config.ts.'
	confirmLabel="Delete Table"
	confirmVariant="danger"
	onconfirm={handleDeleteTable}
/>

<style>
	.schema-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.schema-empty {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-danger);
	}

	.readonly-banner {
		padding: var(--space-3) var(--space-4);
		background: #fef3c7;
		color: #92400e;
		font-size: 13px;
		border-radius: var(--radius-md);
	}

	.schema-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.schema-note {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.schema-namespace {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.schema-namespace code {
		font-family: var(--font-mono);
		padding: 1px 6px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
	}

	.rename-inline {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.rename-input {
		padding: var(--space-1) var(--space-3);
		font-size: 13px;
		font-family: var(--font-mono);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		outline: none;
		width: 180px;
	}

	.rename-input:focus {
		border-color: var(--color-primary);
	}
</style>
