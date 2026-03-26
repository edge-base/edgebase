<script lang="ts">
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { schemaStore } from '$lib/stores/schema';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import { downloadBlob } from '$lib/download';
	import type { SchemaField, FkReference } from '$lib/constants';
	import { AUTO_FIELDS } from '$lib/constants';
	import { buildAdminRecordsPath, buildTableHref } from '$lib/database-target';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import DataGrid, { type GridColumn } from '$lib/components/ui/DataGrid.svelte';
	import { buildRecordsQuery } from '$lib/components/database/records-query';
	import RowDetailPanel from '$lib/components/ui/RowDetailPanel.svelte';
	import { parseCSV, generateCSV, inferTypes } from '$lib/csv';

	let {
		tableName,
		instanceId,
	}: {
		tableName: string;
		instanceId?: string;
	} = $props();

	// ── State ────────────────────────────────────────────
	let loading = $state(true);
	let records = $state<Record<string, unknown>[]>([]);
	let fields = $state<Record<string, SchemaField>>({});
	let totalCount = $state(0);
	let provider = $state<'do' | 'd1' | 'neon' | 'postgres' | undefined>(undefined);

	// Pagination / search
	let pageNum = $state(1);
	let pageSize = $state(20);
	let search = $state('');
	let searchInput = $state('');
	let sortKey = $state('');
	let sortDir = $state<'asc' | 'desc'>('asc');

	// Row Detail
	let detailRow = $state<Record<string, unknown> | null>(null);
	let detailOpen = $state(false);

	// CSV Import
	let csvModalOpen = $state(false);
	let csvFile = $state<File | null>(null);
	let csvPreviewHeaders = $state<string[]>([]);
	let csvPreviewRows = $state<string[][]>([]);
	let csvMapping = $state<Record<string, string>>({});
	let csvImporting = $state(false);
	let csvError = $state('');

	// ── Derived ──────────────────────────────────────────
	let editableFields = $derived(
		Object.entries(fields).filter(([name]) => !AUTO_FIELDS.includes(name as typeof AUTO_FIELDS[number]))
	);
	let allFieldNames = $derived(Object.keys(fields));

	let gridColumns = $derived<GridColumn[]>(
		allFieldNames.map((name) => {
			const field = fields[name];
			const isAuto = AUTO_FIELDS.includes(name as typeof AUTO_FIELDS[number]);
			let type: GridColumn['type'] = 'text';
			if (field?.type === 'number' || field?.type === 'integer' || field?.type === 'float') type = 'number';
			else if (field?.type === 'boolean') type = 'boolean';
			else if (field?.type === 'json') type = 'json';
			else if (field?.type === 'datetime' || field?.type === 'date') type = 'datetime';
			else if (field?.enum && field.enum.length > 0) type = 'enum';

				// FK navigation
				let linkFn: ((value: unknown) => string | null) | undefined;
				if (field?.references) {
					const ref = field.references;
					const targetTable = typeof ref === 'string' ? ref : (ref as FkReference).table;
					linkFn = (value: unknown) => {
						if (value == null || value === '') return null;
						return buildTableHref(base, targetTable, {
							instanceId,
							search: String(value),
						});
					};
				}

			return {
				key: name,
				label: name,
				type,
				editable: !isAuto && name !== 'id',
				width: name === 'id' ? 280 : type === 'json' ? 200 : 150,
				enumValues: field?.enum,
				linkFn,
			};
		})
	);

	// ── Data loading ─────────────────────────────────────
	function buildRecordPath(rowId?: string): string {
		const basePath = rowId
			? `data/tables/${encodeURIComponent(tableName)}/records/${encodeURIComponent(rowId)}`
			: `data/tables/${encodeURIComponent(tableName)}/records`;
		if (!instanceId) return basePath;
		const params = new URLSearchParams({ instanceId });
		return `${basePath}?${params.toString()}`;
	}

	function isPostgresTable(): boolean {
		return provider === 'postgres' || provider === 'neon';
	}

	async function loadTotalCount() {
		try {
			const query = buildRecordsQuery({
				limit: 1,
				offset: 0,
				search,
				includeTotal: true,
			});
			const res = await api.fetch<{ total?: number }>(
				buildAdminRecordsPath(tableName, {
					instanceId,
					params: new URLSearchParams(query),
				})
			);
			if (typeof res.total === 'number') {
				totalCount = res.total;
			}
		} catch {
			// Keep the lightweight row-derived fallback count on total lookup failure.
		}
	}

	async function loadRecords(options: { refreshTotal?: boolean } = {}) {
		loading = true;
		try {
			const offset = (pageNum - 1) * pageSize;
			const query = buildRecordsQuery({
				limit: pageSize,
				offset,
				search,
				sortKey,
				sortDir,
				includeTotal: !isPostgresTable(),
			});

			const res = await api.fetch<{ items?: Record<string, unknown>[]; data?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; total?: number }>(
				buildAdminRecordsPath(tableName, {
					instanceId,
					params: new URLSearchParams(query),
				})
			);
			const nextRecords = res.items ?? res.data ?? res.rows ?? [];
			records = nextRecords;
			totalCount = typeof res.total === 'number' ? res.total : records.length;
			if (detailOpen && detailRow) {
				const refreshedDetail = nextRecords.find((candidate) => String(candidate.id) === String(detailRow?.id));
				if (refreshedDetail) {
					detailRow = refreshedDetail;
				}
			}
			if (isPostgresTable() && options.refreshTotal !== false) {
				void loadTotalCount();
			}
		} catch (err) {
			toastError(describeActionError(err, 'Failed to load records.'));
			records = [];
		} finally {
			loading = false;
		}
	}

	// Reload when tableName changes
	$effect(() => {
		const currentTableName = tableName;
		const currentInstanceId = instanceId;
		if (currentTableName) {
			const table = $schemaStore.schema[tableName];
			if (table) {
				fields = table.fields as Record<string, SchemaField>;
				provider = table.provider;
			}
			pageNum = 1;
			search = '';
			searchInput = '';
			sortKey = '';
			sortDir = 'asc';
			// Use untrack to prevent loadRecords' reactive reads (sortKey, pageSize, etc.)
			// from becoming dependencies of this effect
			void currentInstanceId;
			untrack(() => loadRecords());
		}
	});

	// ── Search ───────────────────────────────────────────
	function handleSearch() {
		search = searchInput;
		pageNum = 1;
		loadRecords();
	}

	function clearSearch() {
		searchInput = '';
		search = '';
		pageNum = 1;
		loadRecords();
	}

	// ── DataGrid callbacks ───────────────────────────────
	async function handleSave(rowId: string, changes: Record<string, unknown>) {
		await api.fetch(buildRecordPath(rowId), {
			method: 'PUT',
			body: changes,
		});
		if (detailRow && String(detailRow.id) === rowId) {
			detailRow = {
				...detailRow,
				...changes,
			};
		}
		toastSuccess('Record updated');
		await loadRecords({ refreshTotal: false });
	}

	async function handleDelete(rowIds: string[]) {
		for (const id of rowIds) {
			await api.fetch(buildRecordPath(id), {
				method: 'DELETE',
			});
		}
		toastSuccess(`${rowIds.length} record${rowIds.length > 1 ? 's' : ''} deleted`);
		await loadRecords();
	}

	async function handleCreate(data: Record<string, unknown>) {
		await api.fetch(buildAdminRecordsPath(tableName, { instanceId }), {
			method: 'POST',
			body: data,
		});
		toastSuccess('Record created');
		await loadRecords();
	}

	function handlePageChange(p: number) {
		pageNum = p;
		loadRecords({ refreshTotal: false });
	}

	function handlePageSizeChange(size: number) {
		pageSize = size;
		pageNum = 1;
		loadRecords();
	}

	function handleSort(key: string, dir: 'asc' | 'desc') {
		sortKey = key;
		sortDir = dir;
		loadRecords({ refreshTotal: false });
	}

	function handleRowInspect(row: Record<string, unknown>) {
		detailRow = row;
		detailOpen = true;
	}

	// ── CSV Export ────────────────────────────────────────
	async function exportCSV() {
		try {
			const res = await api.fetch<{ items?: Record<string, unknown>[]; data?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; total?: number }>(
				buildAdminRecordsPath(tableName, {
					instanceId,
					params: { limit: 10000, includeTotal: 0 },
				})
			);
			const allRecords = res.items ?? res.data ?? res.rows ?? [];
			if (allRecords.length === 0) {
				toastError('No records to export');
				return;
			}

			const csv = generateCSV(allFieldNames, allRecords);
			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
			downloadBlob(blob, `${tableName}.csv`);
			toastSuccess('CSV exported');
		} catch (err) {
			toastError(describeActionError(err, 'CSV export failed.'));
		}
	}

	// ── JSON Export ──────────────────────────────────────
	async function exportJSON() {
		try {
			const res = await api.fetch<{ items?: Record<string, unknown>[]; data?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; total?: number }>(
				buildAdminRecordsPath(tableName, {
					instanceId,
					params: { limit: 10000, includeTotal: 0 },
				})
			);
			const allRecords = res.items ?? res.data ?? res.rows ?? [];
			if (allRecords.length === 0) {
				toastError('No records to export');
				return;
			}

			const blob = new Blob([JSON.stringify(allRecords, null, 2)], { type: 'application/json' });
			downloadBlob(blob, `${tableName}.json`);
			toastSuccess('JSON exported');
		} catch (err) {
			toastError(describeActionError(err, 'JSON export failed.'));
		}
	}

	// ── CSV Import ───────────────────────────────────────
	function openCsvImport() {
		csvFile = null;
		csvPreviewHeaders = [];
		csvPreviewRows = [];
		csvMapping = {};
		csvError = '';
		csvModalOpen = true;
	}

	async function handleCsvFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		csvFile = file;
		csvError = '';

		try {
			const text = await file.text();
			const parsed = parseCSV(text);
			csvPreviewHeaders = parsed.headers;
			csvPreviewRows = parsed.rows.slice(0, 5);

			const mapping: Record<string, string> = {};
			for (const header of parsed.headers) {
				const normalizedHeader = header.toLowerCase().trim();
				for (const [fieldName] of editableFields) {
					if (fieldName.toLowerCase() === normalizedHeader) {
						mapping[header] = fieldName;
						break;
					}
				}
			}
			csvMapping = mapping;
		} catch {
			csvError = 'Failed to parse CSV file';
		}
	}

	async function executeCsvImport() {
		if (!csvFile) return;
		csvImporting = true;
		csvError = '';

		try {
			const text = await csvFile.text();
			const parsed = parseCSV(text);

			const importRecords: Record<string, unknown>[] = [];
			for (const row of parsed.rows) {
				const record: Record<string, unknown> = {};
				for (let ci = 0; ci < parsed.headers.length; ci++) {
					const csvHeader = parsed.headers[ci];
					const fieldName = csvMapping[csvHeader];
					if (!fieldName) continue;

					const val = row[ci];
					if (val === '' || val === undefined) continue;

					const fieldDef = fields[fieldName];
					if (fieldDef?.type === 'number' || fieldDef?.type === 'integer' || fieldDef?.type === 'float') {
						record[fieldName] = Number(val);
					} else if (fieldDef?.type === 'boolean') {
						record[fieldName] = val === 'true' || val === '1';
					} else if (fieldDef?.type === 'json') {
						try { record[fieldName] = JSON.parse(val); } catch { record[fieldName] = val; }
					} else {
						record[fieldName] = val;
					}
				}
				if (Object.keys(record).length > 0) {
					importRecords.push(record);
				}
			}

			if (importRecords.length === 0) {
				csvError = 'No valid records to import. Check column mapping.';
				return;
			}

			const res = await api.fetch<{ imported: number; errors: { row: number; message: string }[] }>(
				`data/tables/${encodeURIComponent(tableName)}/import`, {
				method: 'POST',
				body: { records: importRecords, mode: 'create' },
			});

			if (res.errors && res.errors.length > 0) {
				toastError(`Imported ${res.imported} records with ${res.errors.length} errors`);
			} else {
				toastSuccess(`Imported ${res.imported} records`);
			}

			csvModalOpen = false;
			await loadRecords();
		} catch (err) {
			csvError = describeActionError(err, 'Import failed.');
		} finally {
			csvImporting = false;
		}
	}
</script>

<div class="records-tab">
	<div class="toolbar">
		<form class="search-bar" onsubmit={(e) => { e.preventDefault(); handleSearch(); }}>
			<input
				class="search-input"
				type="text"
				placeholder="Search records..."
				bind:value={searchInput}
			/>
			<Button variant="secondary" size="sm" type="submit">Search</Button>
			{#if search}
				<Button variant="ghost" size="sm" onclick={clearSearch}>Clear</Button>
			{/if}
		</form>
		<div class="toolbar__right">
			<div class="toolbar__meta">
				{totalCount} record{totalCount !== 1 ? 's' : ''}
			</div>
			<Button variant="ghost" size="sm" onclick={openCsvImport}>Import CSV</Button>
			<Button variant="ghost" size="sm" onclick={exportCSV}>Export CSV</Button>
			<Button variant="ghost" size="sm" onclick={exportJSON}>Export JSON</Button>
		</div>
	</div>

	<DataGrid
		columns={gridColumns}
		rows={records}
		{tableName}
		{loading}
		{totalCount}
		page={pageNum}
		{pageSize}
		emptyMessage={search ? 'No records match your search.' : 'This table has no records yet.'}
		onSave={handleSave}
		onDelete={handleDelete}
		onCreate={handleCreate}
		onPageChange={handlePageChange}
		onPageSizeChange={handlePageSizeChange}
		onSort={handleSort}
		onRowInspect={handleRowInspect}
	/>

<!-- CSV Import Modal -->
<Modal bind:open={csvModalOpen} title="Import CSV">
	<div class="csv-import">
		{#if csvError}
			<div class="csv-error">{csvError}</div>
		{/if}

		<div class="csv-upload">
			<label class="csv-upload-label">
				<span>Choose CSV file</span>
				<input type="file" accept=".csv,text/csv" onchange={handleCsvFile} class="csv-file-input" />
			</label>
			{#if csvFile}
				<span class="csv-filename">{csvFile.name}</span>
			{/if}
		</div>

		{#if csvPreviewHeaders.length > 0}
			<div class="csv-section">
				<h4 class="csv-section-title">Column Mapping</h4>
				<div class="csv-mappings">
					{#each csvPreviewHeaders as header}
						<div class="csv-map-row">
							<span class="csv-map-from">{header}</span>
							<span class="csv-map-arrow">&rarr;</span>
							<select class="csv-map-select" bind:value={csvMapping[header]}>
								<option value="">— Skip —</option>
								{#each editableFields as [name]}
									<option value={name}>{name}</option>
								{/each}
							</select>
						</div>
					{/each}
				</div>
			</div>

			<div class="csv-section">
				<h4 class="csv-section-title">Preview (first 5 rows)</h4>
				<div class="csv-preview-wrap">
					<table class="csv-preview-table">
						<thead>
							<tr>
								{#each csvPreviewHeaders as header}
									<th class="csv-preview-th">{header}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each csvPreviewRows as row}
								<tr>
									{#each row as cell}
										<td class="csv-preview-td">{cell}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => (csvModalOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			disabled={!csvFile || csvPreviewHeaders.length === 0}
			loading={csvImporting}
			onclick={executeCsvImport}
		>
			Import
		</Button>
	{/snippet}
</Modal>

<RowDetailPanel
	bind:open={detailOpen}
	row={detailRow}
	columns={gridColumns}
	onSave={handleSave}
	onClose={() => { detailOpen = false; }}
/>
</div>

<style>
	.records-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.search-input {
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		font-family: inherit;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		outline: none;
		min-width: 200px;
	}

	.search-input:focus { border-color: var(--color-primary); }

	.toolbar__right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.toolbar__meta {
		font-size: 12px;
		color: var(--color-text-tertiary);
	}

	/* ── CSV Import ────────────────── */
	.csv-import { display: flex; flex-direction: column; gap: var(--space-4); }
	.csv-error { padding: var(--space-3); background: #fee2e2; color: #991b1b; font-size: 13px; border-radius: var(--radius-md); }
	.csv-upload { display: flex; align-items: center; gap: var(--space-3); }
	.csv-upload-label { display: inline-flex; align-items: center; padding: var(--space-2) var(--space-3); font-size: 13px; border: 1px solid var(--color-border); border-radius: var(--radius-md); cursor: pointer; background: var(--color-bg-secondary); color: var(--color-text); }
	.csv-upload-label:hover { background: var(--color-bg-tertiary); }
	.csv-file-input { display: none; }
	.csv-filename { font-size: 12px; color: var(--color-text-secondary); font-family: var(--font-mono); }
	.csv-section { display: flex; flex-direction: column; gap: var(--space-2); }
	.csv-section-title { margin: 0; font-size: 13px; font-weight: 600; }
	.csv-mappings { display: flex; flex-direction: column; gap: var(--space-2); }
	.csv-map-row { display: flex; align-items: center; gap: var(--space-2); }
	.csv-map-from { min-width: 120px; font-size: 12px; font-family: var(--font-mono); color: var(--color-text-secondary); }
	.csv-map-arrow { font-size: 12px; color: var(--color-text-tertiary); }
	.csv-map-select { padding: var(--space-1) var(--space-2); font-size: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg); color: var(--color-text); min-width: 140px; }
	.csv-preview-wrap { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
	.csv-preview-table { width: 100%; border-collapse: collapse; font-size: 12px; }
	.csv-preview-th { padding: var(--space-1) var(--space-2); text-align: left; font-weight: 600; font-family: var(--font-mono); font-size: 11px; background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border); white-space: nowrap; }
	.csv-preview-td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--color-border); font-family: var(--font-mono); font-size: 11px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
