<script lang="ts">
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { toastError } from '$lib/stores/toast.svelte';
	import { schemaStore, namespaceNames, namespaceDefs } from '$lib/stores/schema';
	import { onMount } from 'svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { databaseDocs } from '$lib/docs-links';

	interface QueryResult {
		id: number;
		sql: string;
		columns: string[];
		rows: Record<string, unknown>[];
		rowCount: number;
		time: number;
		error?: string;
	}

	let sql = $state('SELECT name FROM sqlite_master WHERE type=\'table\';');
	let executing = $state(false);
	let results = $state<QueryResult[]>([]);
	let resultCounter = $state(0);
	let namespaces = $derived($namespaceNames);
	let selectedNamespace = $state('shared');

	$effect(() => {
		if (namespaces.length > 0 && !namespaces.includes(selectedNamespace)) {
			selectedNamespace = namespaces.includes('shared') ? 'shared' : namespaces[0];
		}
	});

	let isDynamicNamespace = $derived.by(() => {
		const defs = $namespaceDefs;
		return Boolean(defs[selectedNamespace]?.dynamic);
	});

	let SqlEditorComponent = $state<typeof import('$lib/components/ui/SqlEditor.svelte').default | null>(null);

	let cmSchema = $derived((() => {
		const result: Record<string, string[]> = {};
		const schema = $schemaStore.schema;
		for (const [name, table] of Object.entries(schema)) {
			const fields = (table as { fields?: Record<string, unknown> }).fields;
			result[name] = fields ? Object.keys(fields) : [];
		}
		return result;
	})());

	onMount(async () => {
		void schemaStore.loadSchema({ silent: true });
		try {
			const mod = await import('$lib/components/ui/SqlEditor.svelte');
			SqlEditorComponent = mod.default;
		} catch {
			// SqlEditor import failed; fallback to textarea
		}
	});

	async function execute() {
		if (!sql.trim()) return;
		if (isDynamicNamespace) {
			toastError('Dynamic namespaces require a target instance. Use the Query tab on a specific table instead.');
			return;
		}
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
					namespace: selectedNamespace,
					sql: sql.trim(),
				},
			});

			resultCounter += 1;
			results = [{
				id: resultCounter,
				sql: sql.trim(),
				columns: res.columns ?? [],
				rows: res.rows ?? [],
				rowCount: res.rowCount ?? 0,
				time: res.time ?? 0,
			}, ...results];
		} catch (err) {
			const message = describeActionError(err, 'Query failed.');
			toastError(message);
			resultCounter += 1;
			results = [{
				id: resultCounter,
				sql: sql.trim(),
				columns: [],
				rows: [],
				rowCount: 0,
				time: 0,
				error: message,
			}, ...results];
		} finally {
			executing = false;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			execute();
		}
	}
</script>

<PageShell title="SQL Console" description="Execute SQL queries against your databases" docsHref={databaseDocs}>
	<div class="sql-page">
		<div class="sql-page__toolbar">
			<div class="sql-page__ns">
				<label for="ns-select">Database</label>
				<select id="ns-select" bind:value={selectedNamespace}>
					{#each namespaces as ns}
						<option value={ns}>{ns}</option>
					{/each}
				</select>
			</div>
			<Button variant="primary" size="sm" onclick={execute} loading={executing} disabled={executing || !sql.trim() || isDynamicNamespace}>
				{executing ? 'Executing...' : 'Execute'}
			</Button>
			{#if isDynamicNamespace}
				<span class="sql-page__dynamic-warn">Dynamic namespace — use table Query tab</span>
			{:else}
				<span class="sql-page__shortcut">{typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter</span>
			{/if}
		</div>

		<div class="sql-page__editor">
			{#if SqlEditorComponent}
				<SqlEditorComponent
					value={sql}
					onchange={(value) => (sql = value)}
					onExecute={execute}
					placeholder="SELECT * FROM table_name LIMIT 100;"
					schema={cmSchema}
				/>
			{:else}
				<textarea
					class="sql-page__textarea"
					bind:value={sql}
					onkeydown={handleKeydown}
					placeholder="SELECT * FROM table_name LIMIT 100;"
					rows="6"
				></textarea>
			{/if}
		</div>

		{#if results.length > 0}
			{#each results as result (result.id)}
				<div class="sql-page__result">
					<div class="sql-page__result-header">
						<code class="sql-page__result-sql">{result.sql}</code>
						{#if result.error}
							<span class="sql-page__result-error">{result.error}</span>
						{:else}
							<span class="sql-page__result-meta">{result.rowCount} rows · {result.time}ms</span>
						{/if}
					</div>
					{#if !result.error && result.columns.length > 0}
						<div class="sql-page__table-wrap">
							<table class="sql-page__table">
								<thead>
									<tr>
										{#each result.columns as col}
											<th>{col}</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each result.rows as row}
										<tr>
											{#each result.columns as col}
												<td>{row[col] ?? 'null'}</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</PageShell>

<style>
	.sql-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.sql-page__toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.sql-page__ns {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 13px;
	}

	.sql-page__ns label {
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	.sql-page__ns select {
		padding: 4px 8px;
		border-radius: 4px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 13px;
		font-family: var(--font-mono);
	}

	.sql-page__shortcut {
		font-size: 11px;
		color: var(--color-text-tertiary);
	}

	.sql-page__dynamic-warn {
		font-size: 11px;
		color: var(--color-warning, #f59e0b);
	}

	.sql-page__editor {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.sql-page__textarea {
		width: 100%;
		padding: var(--space-3);
		border: none;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: 13px;
		resize: vertical;
	}

	.sql-page__result {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.sql-page__result-header {
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-secondary);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.sql-page__result-sql {
		font-size: 12px;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 60%;
	}

	.sql-page__result-meta {
		font-size: 12px;
		color: var(--color-text-tertiary);
		white-space: nowrap;
	}

	.sql-page__result-error {
		font-size: 12px;
		color: var(--color-error);
	}

	.sql-page__table-wrap {
		overflow-x: auto;
		max-height: 400px;
		overflow-y: auto;
	}

	.sql-page__table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
		font-family: var(--font-mono);
	}

	.sql-page__table th {
		position: sticky;
		top: 0;
		padding: var(--space-2) var(--space-3);
		text-align: left;
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		font-weight: 600;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}

	.sql-page__table td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sql-page__table tr:hover td {
		background: var(--color-bg-secondary);
	}
</style>
