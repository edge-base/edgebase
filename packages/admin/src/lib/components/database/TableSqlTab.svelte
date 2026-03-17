<script lang="ts">
	import { api } from '$lib/api';
	import { toastError } from '$lib/stores/toast.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DataGrid from '$lib/components/ui/DataGrid.svelte';
	import type { GridColumn } from '$lib/components/ui/DataGrid.svelte';
	import SqlEditor from '$lib/components/ui/SqlEditor.svelte';
	import { schemaStore } from '$lib/stores/schema';

	let {
		tableName,
		namespace,
		instanceId,
	}: {
		tableName: string;
		namespace: string;
		instanceId?: string;
	} = $props();

	interface QueryResult {
		id: number;
		sql: string;
		columns: GridColumn[];
		rows: Record<string, unknown>[];
		rowCount: number;
		time: number;
		error?: string;
	}

	let sql = $state('');
	let executing = $state(false);
	let results = $state<QueryResult[]>([]);
	let activeTab = $state(0);
	let resultCounter = $state(0);
	let tableDef = $derived($schemaStore.schema[tableName]);

	let cmSchema = $derived((() => {
		const result: Record<string, string[]> = {};
		const schema = $schemaStore.schema;
		for (const [name, table] of Object.entries(schema)) {
			const fields = (table as { fields?: Record<string, unknown> }).fields;
			result[name] = fields ? Object.keys(fields) : [];
		}
		return result;
	})());

	let databaseBadgeValue = $derived.by(() => (tableDef?.dynamic ? 'Per-tenant DB' : 'Single DB'));

	let targetBadgeLabel = $derived.by(() =>
		tableDef?.instanceDiscovery?.targetLabel?.trim() || 'Target'
	);

	let targetBadgeValue = $derived.by(() => instanceId || 'Not selected');

	function buildDefaultSql(name: string): string {
		return `SELECT * FROM "${name}" LIMIT 100;`;
	}

	$effect(() => {
		sql = buildDefaultSql(tableName);
	});

	$effect(() => {
		if (Object.keys($schemaStore.schema).length === 0) {
			void schemaStore.loadSchema({ silent: true });
		}
	});

	async function execute() {
		if (!sql.trim()) return;
		executing = true;

		try {
			const res = await api.fetch<{
				columns: string[];
				rows: Record<string, unknown>[];
				rowCount: number;
				time: number;
			}>('data/sql', {
				method: 'POST',
				body: {
					namespace,
					id: instanceId || undefined,
					sql: sql.trim(),
				},
			});

			const columns: GridColumn[] = (res.columns ?? []).map((key) => ({
				key,
				label: key,
				type: 'text',
				editable: false,
			}));

			resultCounter += 1;
			results = [
				...results,
				{
					id: resultCounter,
					sql: sql.trim(),
					columns,
					rows: res.rows ?? [],
					rowCount: res.rowCount ?? 0,
					time: res.time ?? 0,
				},
			];
			activeTab = results.length - 1;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Query failed';
			toastError(message);
			resultCounter += 1;
			results = [
				...results,
				{
					id: resultCounter,
					sql: sql.trim(),
					columns: [],
					rows: [],
					rowCount: 0,
					time: 0,
					error: message,
				},
			];
			activeTab = results.length - 1;
		} finally {
			executing = false;
		}
	}

	function closeTab(index: number) {
		const nextResults = results.filter((_, i) => i !== index);
		if (activeTab > index) {
			activeTab -= 1;
		} else if (activeTab === index) {
			activeTab = Math.min(index, Math.max(0, nextResults.length - 1));
		}
		results = nextResults;
	}
</script>

<div class="table-sql">
	<div class="table-sql__toolbar">
		<div class="table-sql__target">
			<span class="table-sql__target-label">Database</span>
			<code>{databaseBadgeValue}</code>
		</div>
		{#if tableDef?.dynamic}
			<div class="table-sql__target">
				<span class="table-sql__target-label">{targetBadgeLabel}</span>
				<code>{targetBadgeValue}</code>
			</div>
		{/if}
		<Button variant="primary" size="sm" onclick={execute} loading={executing} disabled={executing || !sql.trim()}>
			{executing ? 'Executing...' : 'Execute'}
		</Button>
		<span class="table-sql__shortcut">{navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter</span>
	</div>

	<SqlEditor
		value={sql}
		onchange={(value) => (sql = value)}
		onExecute={execute}
		placeholder={`SELECT * FROM "${tableName}" LIMIT 100;`}
		schema={cmSchema}
	/>

	{#if results.length > 0}
		<div class="table-sql__result-tabs">
			{#each results as result, index (result.id)}
				<div
					class="table-sql__result-tab"
					class:table-sql__result-tab--active={index === activeTab}
				>
					<button
						type="button"
						class="table-sql__result-open"
						onclick={() => (activeTab = index)}
					>
						<span>Result {index + 1}</span>
					</button>
					<button
						type="button"
						class="table-sql__result-close"
						onclick={(event) => {
							event.stopPropagation();
							closeTab(index);
						}}
						aria-label={`Close result ${index + 1}`}
					>
						&times;
					</button>
				</div>
			{/each}
		</div>

		{#if results[activeTab]}
			<div class="table-sql__result-panel">
				<div class="table-sql__result-meta">
					{#if results[activeTab].error}
						<span class="table-sql__result-error">{results[activeTab].error}</span>
					{:else}
						<span>{results[activeTab].rowCount} row{results[activeTab].rowCount === 1 ? '' : 's'} · {results[activeTab].time}ms</span>
					{/if}
				</div>

				{#if results[activeTab].error}
					<pre class="table-sql__error-block">{results[activeTab].sql}</pre>
				{:else if results[activeTab].rows.length === 0}
					<div class="table-sql__empty">Query returned no rows.</div>
				{:else}
						<DataGrid
							columns={results[activeTab].columns}
							rows={results[activeTab].rows}
							readonly={true}
						/>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="table-sql__empty">
			Run a query against <code>{tableName}</code> to inspect rows, joins, or aggregates for this target.
		</div>
	{/if}
</div>

<style>
	.table-sql {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.table-sql__toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.table-sql__target {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		font-size: 12px;
	}

	.table-sql__target-label {
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.table-sql__target code {
		font-family: var(--font-mono);
		color: var(--color-text);
	}

	.table-sql__shortcut {
		font-size: 12px;
		color: var(--color-text-tertiary);
		margin-left: auto;
	}

	.table-sql__result-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.table-sql__result-tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.table-sql__result-tab--active {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.table-sql__result-open {
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0;
		font: inherit;
	}

	.table-sql__result-close {
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}

	.table-sql__result-panel {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		background: var(--color-bg);
	}

	.table-sql__result-meta {
		margin-bottom: var(--space-3);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.table-sql__result-error {
		color: var(--color-danger, #ef4444);
	}

	.table-sql__error-block,
	.table-sql__empty {
		margin: 0;
		padding: var(--space-4);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		font-size: 13px;
	}
</style>
