<script lang="ts">
	import { ApiError } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { validateCustomRecordId } from '$lib/record-id';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte';
	import CreateRowPanel from '$lib/components/ui/CreateRowPanel.svelte';

	// ── Types ──────────────────────────────────────────
	export interface GridColumn {
		key: string;
		label: string;
		type: 'text' | 'number' | 'boolean' | 'json' | 'datetime' | 'enum';
		width?: number;
		minWidth?: number;
		editable?: boolean;
		enumValues?: string[];
		/** If set, renders the cell value as a navigable link. Function receives the cell value and returns an href, or null to skip. */
		linkFn?: (value: unknown) => string | null;
	}

	interface Props {
		columns: GridColumn[];
		rows: Record<string, unknown>[];
		loading?: boolean;
		readonly?: boolean;
		emptyMessage?: string;
		totalCount?: number;
		page?: number;
		pageSize?: number;
		onSave?: (rowId: string, changes: Record<string, unknown>) => Promise<void>;
		onDelete?: (rowIds: string[]) => Promise<void>;
		onCreate?: (data: Record<string, unknown>) => Promise<void>;
		onPageChange?: (page: number) => void;
		onPageSizeChange?: (size: number) => void;
		onSort?: (key: string, dir: 'asc' | 'desc') => void;
		onRowInspect?: (row: Record<string, unknown>) => void;
		onDuplicate?: (row: Record<string, unknown>) => void;
		onBulkEdit?: (rowIds: string[]) => void;
		tableName?: string;
	}

	let {
		columns = [],
		rows = [],
		loading = false,
		readonly = false,
		emptyMessage = 'No data available.',
		totalCount = 0,
		page = 1,
		pageSize = 20,
		onSave,
		onDelete,
		onCreate,
		onPageChange,
		onPageSizeChange,
		onSort,
		onRowInspect,
		onDuplicate,
		onBulkEdit,
		tableName = '',
	}: Props = $props();

	// ── State ──────────────────────────────────────────
	let selectedRows = $state<Set<string>>(new Set());
	let dirtyRows = $state<Map<string, Map<string, unknown>>>(new Map());
	let savingRows = $state<Set<string>>(new Set());
	let focusedCell = $state<{ rowId: string; colKey: string } | null>(null);
	let editingCell = $state<{ rowId: string; colKey: string } | null>(null);
	let editValue = $state<string>('');
	let sortKey = $state<string | null>(null);
	let sortDir = $state<'asc' | 'desc'>('asc');
	let columnWidths = $state<Map<string, number>>(new Map());
	let resizingCol = $state<string | null>(null);
	let resizeStartX = $state(0);
	let resizeStartW = $state(0);
	let tableWrapEl = $state<HTMLDivElement | null>(null);

	// Column visibility
	let hiddenColumns = $state<Set<string>>(new Set());
	let showColumnPicker = $state(false);

	// New row state
	let createPanelOpen = $state(false);
	let newRowData = $state<Record<string, string>>({});
	let newRowErrors = $state<Record<string, string>>({});
	let newRowSaving = $state(false);

	// ── Derived ─────────────────────────────────────────
	let allSelected = $derived(rows.length > 0 && rows.every((r) => selectedRows.has(String(r.id))));
	let someSelected = $derived(selectedRows.size > 0);
	let pageCount = $derived(Math.max(1, Math.ceil(totalCount / pageSize)));
	let hasDirty = $derived(dirtyRows.size > 0);
	let visibleColumns = $derived(columns.filter(c => !hiddenColumns.has(c.key)));
	function focusCellElement(rowId: string, colKey: string) {
		requestAnimationFrame(() => {
			const cellEl = tableWrapEl?.querySelector<HTMLElement>(`[data-row-id="${rowId}"][data-col-key="${colKey}"]`);
			cellEl?.focus();
		});
	}

	$effect(() => {
		if (!focusedCell || editingCell) return;
		focusCellElement(focusedCell.rowId, focusedCell.colKey);
	});

	// ── Column Visibility ───────────────────────────────
	$effect(() => {
		if (tableName) {
			try {
				const stored = localStorage.getItem(`edgebase_grid_columns_${tableName}`);
				hiddenColumns = stored ? new Set(JSON.parse(stored)) : new Set();
			} catch {
				hiddenColumns = new Set();
			}
		}
	});

	function toggleColumn(key: string) {
		const next = new Set(hiddenColumns);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		hiddenColumns = next;
		if (tableName) {
			try {
				localStorage.setItem(`edgebase_grid_columns_${tableName}`, JSON.stringify([...next]));
			} catch { /* ignore */ }
		}
	}

	// ── Column Width ────────────────────────────────────
	function getColWidth(col: GridColumn): number {
		return columnWidths.get(col.key) ?? col.width ?? defaultWidth(col);
	}

	function defaultWidth(col: GridColumn): number {
		if (col.type === 'boolean') return 80;
		if (col.type === 'number') return 120;
		if (col.type === 'datetime') return 180;
		if (col.type === 'json') return 200;
		return 160;
	}

	// ── Selection ───────────────────────────────────────
	function toggleAll() {
		if (allSelected) {
			selectedRows = new Set();
		} else {
			selectedRows = new Set(rows.map((r) => String(r.id)));
		}
	}

	function toggleRow(id: string) {
		const next = new Set(selectedRows);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedRows = next;
	}

	// ── Sorting ─────────────────────────────────────────
	function handleSort(key: string) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = 'asc';
		}
		onSort?.(key, sortDir);
	}

	// ── Cell Display ────────────────────────────────────
	function getCellValue(row: Record<string, unknown>, key: string): unknown {
		const dirty = dirtyRows.get(String(row.id));
		if (dirty?.has(key)) return dirty.get(key);
		return row[key];
	}

	function formatCell(val: unknown, col: GridColumn): string {
		if (val === null || val === undefined) return '';
		if (col.type === 'boolean') return val ? 'true' : 'false';
		if (col.type === 'json' && typeof val === 'object') return JSON.stringify(val);
		if (col.type === 'datetime' && typeof val === 'string') {
			try {
				return new Date(val).toLocaleString();
			} catch {
				return String(val);
			}
		}
		return String(val);
	}

	function isNull(val: unknown): boolean {
		return val === null || val === undefined;
	}

	function isDirty(rowId: string, key: string): boolean {
		return dirtyRows.get(rowId)?.has(key) ?? false;
	}

	// ── Clipboard ───────────────────────────────────────
	async function copyCell(val: unknown) {
		const text = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
		try {
			await navigator.clipboard.writeText(text);
			toastSuccess('Copied to clipboard');
		} catch {
			/* ignore */
		}
	}

	// ── Editing ─────────────────────────────────────────
	function startEdit(rowId: string, colKey: string, currentVal: unknown) {
		if (readonly) return;
		const col = columns.find((c) => c.key === colKey);
		if (!col || col.editable === false) return;
		if (colKey === 'id' || colKey === 'createdAt' || colKey === 'updatedAt') return;

		editingCell = { rowId, colKey };
		if (currentVal === null || currentVal === undefined) {
			editValue = '';
		} else if (typeof currentVal === 'object') {
			editValue = JSON.stringify(currentVal, null, 2);
		} else {
			editValue = String(currentVal);
		}

		// Focus the input after render
		requestAnimationFrame(() => {
			const el = document.querySelector('.dg-cell-editor') as HTMLElement;
			el?.focus();
		});
	}

	function confirmEdit() {
		if (!editingCell) return;
		const { rowId, colKey } = editingCell;
		const col = columns.find((c) => c.key === colKey);
		if (!col) { cancelEdit(); return; }

		let parsedValue: unknown;
		if (editValue === '' && col.type !== 'text') {
			parsedValue = null;
		} else if (col.type === 'number') {
			parsedValue = editValue === '' ? null : Number(editValue);
			if (parsedValue !== null && isNaN(parsedValue as number)) { cancelEdit(); return; }
		} else if (col.type === 'boolean') {
			parsedValue = editValue === 'true' || editValue === '1';
		} else if (col.type === 'json') {
			try {
				parsedValue = editValue ? JSON.parse(editValue) : null;
			} catch {
				toastError('Invalid JSON');
				return;
			}
		} else {
			parsedValue = editValue;
		}

		// Check if value actually changed
		const row = rows.find((r) => String(r.id) === rowId);
		const originalVal = row?.[colKey];
		if (JSON.stringify(parsedValue) === JSON.stringify(originalVal)) {
			// No change — remove from dirty if present
			const dirty = dirtyRows.get(rowId);
			if (dirty) {
				dirty.delete(colKey);
				if (dirty.size === 0) dirtyRows.delete(rowId);
				dirtyRows = new Map(dirtyRows);
			}
		} else {
			// Set dirty value
			if (!dirtyRows.has(rowId)) dirtyRows.set(rowId, new Map());
			dirtyRows.get(rowId)!.set(colKey, parsedValue);
			dirtyRows = new Map(dirtyRows);
		}

		editingCell = null;
	}

	function cancelEdit() {
		editingCell = null;
	}

	// ── Save / Revert ───────────────────────────────────
	async function saveRow(rowId: string) {
		const dirty = dirtyRows.get(rowId);
		if (!dirty || !onSave) return;

		savingRows = new Set([...savingRows, rowId]);
		try {
			const changes: Record<string, unknown> = {};
			for (const [k, v] of dirty) changes[k] = v;
			await onSave(rowId, changes);
			dirtyRows.delete(rowId);
			dirtyRows = new Map(dirtyRows);
		} catch (err) {
			toastError(describeActionError(err, 'Save failed.'));
		} finally {
			const next = new Set(savingRows);
			next.delete(rowId);
			savingRows = next;
		}
	}

	function revertRow(rowId: string) {
		dirtyRows.delete(rowId);
		dirtyRows = new Map(dirtyRows);
	}

	async function saveAll() {
		for (const rowId of dirtyRows.keys()) {
			await saveRow(rowId);
		}
	}

	function revertAll() {
		dirtyRows = new Map();
	}

	// ── Bulk Delete ─────────────────────────────────────
	async function bulkDelete() {
		if (selectedRows.size === 0 || !onDelete) return;
		const ids = [...selectedRows];
		try {
			await onDelete(ids);
			selectedRows = new Set();
		} catch (err) {
			toastError(describeActionError(err, 'Delete failed.'));
		}
	}

	// ── New Row ─────────────────────────────────────────
	function openNewRow() {
		createPanelOpen = true;
		newRowData = {};
		newRowErrors = {};
	}

	type ApiFieldError = { code?: string; message?: string };

	function extractFieldErrors(err: unknown): Record<string, string> {
		if (!(err instanceof ApiError) || !err.data || typeof err.data !== 'object') return {};
		const next: Record<string, string> = {};
		for (const [key, value] of Object.entries(err.data as Record<string, unknown>)) {
			if (
				value &&
				typeof value === 'object' &&
				'message' in value &&
				typeof (value as ApiFieldError).message === 'string'
			) {
				next[key] = (value as ApiFieldError).message as string;
			}
		}
		return next;
	}

	async function saveNewRow() {
		if (!onCreate) return;
		newRowSaving = true;
		newRowErrors = {};
		try {
			const payload: Record<string, unknown> = {};
			for (const col of columns) {
				if (col.key === 'createdAt' || col.key === 'updatedAt') continue;
				const v = newRowData[col.key];
				if (col.key === 'id') {
					const idValue = String(v ?? '').trim();
					const idError = validateCustomRecordId(idValue);
					if (idError) {
						newRowErrors = { id: idError };
						return;
					}
					if (idValue) payload.id = idValue;
					continue;
				}
				if (!v && v !== '0') continue;
				if (col.type === 'number') payload[col.key] = Number(v);
				else if (col.type === 'boolean') payload[col.key] = v === 'true' || v === '1';
				else if (col.type === 'json') {
					try {
						payload[col.key] = JSON.parse(v);
					} catch {
						newRowErrors = { [col.key]: `Invalid JSON for ${col.label}` };
						return;
					}
				} else payload[col.key] = v;
			}
			await onCreate(payload);
			createPanelOpen = false;
			newRowData = {};
			newRowErrors = {};
		} catch (err) {
			const fieldErrors = extractFieldErrors(err);
			if (Object.keys(fieldErrors).length > 0) {
				newRowErrors = fieldErrors;
				return;
			}
			toastError(describeActionError(err, 'Create failed.'));
		} finally {
			newRowSaving = false;
		}
	}

	function cancelNewRow() {
		createPanelOpen = false;
		newRowData = {};
		newRowErrors = {};
	}

	// ── Column Resize ───────────────────────────────────
	function startResize(e: MouseEvent, colKey: string) {
		e.preventDefault();
		e.stopPropagation();
		resizingCol = colKey;
		resizeStartX = e.clientX;
		resizeStartW = getColWidth(columns.find((c) => c.key === colKey)!);
		document.addEventListener('mousemove', onResizeMove);
		document.addEventListener('mouseup', onResizeEnd);
	}

	function onResizeMove(e: MouseEvent) {
		if (!resizingCol) return;
		const diff = e.clientX - resizeStartX;
		const col = columns.find((c) => c.key === resizingCol);
		const min = col?.minWidth ?? 60;
		const newW = Math.max(min, resizeStartW + diff);
		columnWidths.set(resizingCol, newW);
		columnWidths = new Map(columnWidths);
	}

	function onResizeEnd() {
		resizingCol = null;
		document.removeEventListener('mousemove', onResizeMove);
		document.removeEventListener('mouseup', onResizeEnd);
	}

	// ── Keyboard Navigation ─────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLAnchorElement && e.key === 'Enter') {
			return;
		}

		if (editingCell) {
			if (e.key === 'Escape') { cancelEdit(); e.preventDefault(); }
			else if (e.key === 'Enter' && !e.shiftKey) {
				const col = columns.find((c) => c.key === editingCell!.colKey);
				if (col?.type !== 'json') { confirmEdit(); e.preventDefault(); }
			}
			else if (e.key === 'Tab') { confirmEdit(); /* let default tab happen */ }
			return;
		}

		if (!focusedCell) return;

		const rowIds = rows.map((r) => String(r.id));
		const colKeys = visibleColumns.map((c) => c.key);
		const ri = rowIds.indexOf(focusedCell.rowId);
		const ci = colKeys.indexOf(focusedCell.colKey);

		if (e.key === 'ArrowDown' && ri < rowIds.length - 1) {
			focusedCell = { rowId: rowIds[ri + 1], colKey: focusedCell.colKey };
			e.preventDefault();
		} else if (e.key === 'ArrowUp' && ri > 0) {
			focusedCell = { rowId: rowIds[ri - 1], colKey: focusedCell.colKey };
			e.preventDefault();
		} else if (e.key === 'ArrowRight' && ci < colKeys.length - 1) {
			focusedCell = { rowId: focusedCell.rowId, colKey: colKeys[ci + 1] };
			e.preventDefault();
		} else if (e.key === 'ArrowLeft' && ci > 0) {
			focusedCell = { rowId: focusedCell.rowId, colKey: colKeys[ci - 1] };
			e.preventDefault();
		} else if (e.key === 'Enter' || e.key === 'F2') {
			const val = getCellValue(rows.find((r) => String(r.id) === focusedCell!.rowId)!, focusedCell.colKey);
			startEdit(focusedCell.rowId, focusedCell.colKey, val);
			e.preventDefault();
		} else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
			const val = getCellValue(rows.find((r) => String(r.id) === focusedCell!.rowId)!, focusedCell.colKey);
			copyCell(val);
			e.preventDefault();
		} else if (e.key === 'Delete' && someSelected && !readonly) {
			bulkDelete();
			e.preventDefault();
		}
	}

	// ── Pagination ──────────────────────────────────────
	function prevPage() { if (page > 1) onPageChange?.(page - 1); }
	function nextPage() { if (page < pageCount) onPageChange?.(page + 1); }
	function changePageSize(e: Event) {
		const v = parseInt((e.target as HTMLSelectElement).value, 10);
		onPageSizeChange?.(v);
	}
</script>

<div class="dg" role="grid" tabindex="0" onkeydown={handleKeydown}>
	<!-- Toolbar -->
	{#if !readonly}
		<div class="dg-toolbar">
			<div class="dg-toolbar__left">
				{#if someSelected}
					<button class="dg-btn dg-btn--danger" onclick={bulkDelete}>
						Delete {selectedRows.size} row{selectedRows.size > 1 ? 's' : ''}
					</button>
					{#if onBulkEdit}
						<button class="dg-btn" onclick={() => onBulkEdit?.([...selectedRows])}>
							Edit {selectedRows.size} row{selectedRows.size > 1 ? 's' : ''}
						</button>
					{/if}
				{/if}
				{#if hasDirty}
					<button class="dg-btn dg-btn--primary" onclick={saveAll}>Save All Changes</button>
					<button class="dg-btn" onclick={revertAll}>Revert All</button>
				{/if}
			</div>
			<div class="dg-toolbar__right">
				{#if tableName}
					<div class="dg-col-picker-wrap">
						<button
							class="dg-btn"
							aria-haspopup="dialog"
							aria-expanded={showColumnPicker}
							onclick={() => showColumnPicker = !showColumnPicker}
						>
							Columns ({visibleColumns.length}/{columns.length})
						</button>
						{#if showColumnPicker}
							<button
								type="button"
								class="dg-col-picker-backdrop"
								aria-label="Close column picker"
								onclick={() => showColumnPicker = false}
							></button>
							<div class="dg-col-picker" role="dialog" aria-modal="true" aria-label="Column picker">
								{#each columns as col (col.key)}
									<label class="dg-col-picker__item">
										<input
											type="checkbox"
											checked={!hiddenColumns.has(col.key)}
											disabled={col.key === 'id'}
											onchange={() => toggleColumn(col.key)}
										/>
										<span>{col.label}</span>
									</label>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				{#if !createPanelOpen}
					<button class="dg-btn dg-btn--primary" onclick={openNewRow}>+ Add Row</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Table -->
	<div class="dg-table-wrap" bind:this={tableWrapEl}>
		<table class="dg-table">
			<thead>
				<tr>
					{#if !readonly}
						<th class="dg-th dg-th--checkbox" style="width:36px;">
							<input type="checkbox" checked={allSelected} onchange={toggleAll} />
						</th>
					{/if}
					{#each visibleColumns as col (col.key)}
						<th class="dg-th" style="width:{getColWidth(col)}px;min-width:{col.minWidth ?? 60}px;">
							<div class="dg-th__inner">
								<button class="dg-sort-btn" onclick={() => handleSort(col.key)}>
									{col.label}
									{#if sortKey === col.key}
										<span class="dg-sort-icon">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
									{/if}
								</button>
								{#if !readonly}
									<button
										type="button"
										class="dg-resize-handle"
										tabindex="-1"
										aria-label={`Resize ${col.label} column`}
										onmousedown={(e) => startResize(e, col.key)}
									></button>
								{/if}
							</div>
						</th>
					{/each}
					{#if !readonly}
						<th class="dg-th dg-th--actions" style="width:80px;">Actions</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr>
						<td class="dg-td dg-td--empty" colspan={visibleColumns.length + (readonly ? 0 : 2)}>
							<div class="dg-loading"><span class="dg-spinner"></span> Loading...</div>
						</td>
					</tr>
				{:else if rows.length === 0}
					<tr>
						<td class="dg-td dg-td--empty" colspan={visibleColumns.length + (readonly ? 0 : 2)}>
							{emptyMessage}
						</td>
					</tr>
				{:else}
					{#each rows as row (row.id ?? rows.indexOf(row))}
						{@const rowId = String(row.id)}
						{@const rowDirty = dirtyRows.has(rowId)}
						<tr class="dg-row" class:dg-row--selected={selectedRows.has(rowId)} class:dg-row--dirty={rowDirty}>
							{#if !readonly}
								<td class="dg-td dg-td--checkbox">
									<input type="checkbox" checked={selectedRows.has(rowId)} onchange={() => toggleRow(rowId)} />
								</td>
							{/if}
							{#each visibleColumns as col (col.key)}
								{@const cellVal = getCellValue(row, col.key)}
								{@const cellDirty = isDirty(rowId, col.key)}
								{@const isEditing = editingCell?.rowId === rowId && editingCell?.colKey === col.key}
								{@const isFocused = focusedCell?.rowId === rowId && focusedCell?.colKey === col.key}
								<td
									class="dg-td"
									class:dg-td--dirty={cellDirty}
									class:dg-td--focused={isFocused}
									class:dg-td--editing={isEditing}
									style="width:{getColWidth(col)}px;"
								>
									{#if isEditing}
										<!-- Inline editor -->
										{#if col.type === 'boolean'}
											<select
												class="dg-cell-editor"
												bind:value={editValue}
												onblur={confirmEdit}
												onkeydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
											>
												<option value="">null</option>
												<option value="true">true</option>
												<option value="false">false</option>
											</select>
										{:else if col.type === 'enum' && col.enumValues}
											<select
												class="dg-cell-editor"
												bind:value={editValue}
												onblur={confirmEdit}
												onkeydown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
											>
												<option value="">—</option>
												{#each col.enumValues as opt}
													<option value={opt}>{opt}</option>
												{/each}
											</select>
										{:else if col.type === 'json'}
											<textarea
												class="dg-cell-editor dg-cell-editor--json"
												bind:value={editValue}
												onblur={confirmEdit}
												rows="4"
											></textarea>
										{:else}
											<input
												class="dg-cell-editor"
												type={col.type === 'number' ? 'number' : col.type === 'datetime' ? 'datetime-local' : 'text'}
												bind:value={editValue}
												onblur={confirmEdit}
											/>
										{/if}
									{:else}
										<!-- Display value -->
										{@const fkHref = col.linkFn && !isNull(cellVal) ? col.linkFn(cellVal) : null}
										{#if fkHref}
											<a
												class="dg-cell-link"
												href={fkHref}
												title="Navigate to related record"
												data-row-id={rowId}
												data-col-key={col.key}
												onfocus={() => { focusedCell = { rowId, colKey: col.key }; }}
											>
												{formatCell(cellVal, col)}
											</a>
										{:else}
											<button
												type="button"
												class="dg-cell-trigger"
												class:dg-cell-trigger--null={isNull(cellVal)}
												data-row-id={rowId}
												data-col-key={col.key}
												aria-label={`${col.label}: ${isNull(cellVal) ? 'null' : formatCell(cellVal, col)}`}
												onclick={() => { focusedCell = { rowId, colKey: col.key }; }}
												ondblclick={() => startEdit(rowId, col.key, cellVal)}
												onfocus={() => { focusedCell = { rowId, colKey: col.key }; }}
											>
												<span class="dg-cell-value" class:dg-cell-value--null={isNull(cellVal)}>
													{#if isNull(cellVal)}
														<em>null</em>
													{:else if col.type === 'boolean'}
														<span class="dg-bool">{cellVal ? '\u2714' : '\u2718'}</span>
													{:else}
														{formatCell(cellVal, col)}
													{/if}
												</span>
											</button>
										{/if}
									{/if}
								</td>
							{/each}
							{#if !readonly}
								<td class="dg-td dg-td--actions">
									{#if onDuplicate}
										<button class="dg-act-btn" title="Duplicate" onclick={() => onDuplicate?.(row)}>
											<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 11V3.5C3 2.67 3.67 2 4.5 2H11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
										</button>
									{/if}
									{#if onRowInspect}
										<button class="dg-act-btn" title="Inspect" onclick={() => onRowInspect?.(row)}>
											<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
										</button>
									{/if}
									{#if rowDirty}
										<button class="dg-act-btn dg-act-btn--save" title="Save" disabled={savingRows.has(rowId)} onclick={() => saveRow(rowId)}>
											{#if savingRows.has(rowId)}
												<span class="dg-spinner-sm"></span>
											{:else}
												&#x2714;
											{/if}
										</button>
										<button class="dg-act-btn" title="Revert" onclick={() => revertRow(rowId)}>&#x21A9;</button>
									{/if}
								</td>
							{/if}
						</tr>
					{/each}

				{/if}
			</tbody>
		</table>
	</div>

	<!-- Footer / Pagination -->
	<div class="dg-footer">
		<div class="dg-footer__left">
			<span class="dg-count">{totalCount} row{totalCount !== 1 ? 's' : ''}</span>
			{#if !readonly}
				<select class="dg-page-size" value={String(pageSize)} onchange={changePageSize}>
					<option value="20">20 / page</option>
					<option value="50">50 / page</option>
					<option value="100">100 / page</option>
					<option value="200">200 / page</option>
					<option value="500">500 / page</option>
				</select>
			{/if}
		</div>
		{#if pageCount > 1}
			<div class="dg-footer__right">
				<button class="dg-btn dg-btn--sm" disabled={page <= 1} onclick={prevPage}>&#x2190; Prev</button>
				<span class="dg-page-info">Page {page} / {pageCount}</span>
				<button class="dg-btn dg-btn--sm" disabled={page >= pageCount} onclick={nextPage}>Next &#x2192;</button>
			</div>
		{/if}
	</div>
</div>

{#if !readonly}
	<CreateRowPanel
		bind:open={createPanelOpen}
		bind:values={newRowData}
		bind:errors={newRowErrors}
		columns={columns}
		saving={newRowSaving}
		onClose={cancelNewRow}
		onSubmit={saveNewRow}
	/>
{/if}

<style>
	/* ── Container ─────────────────────────── */
	.dg {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		outline: none;
		font-size: 13px;
	}

	.dg:focus-within {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
	}

	/* ── Toolbar ───────────────────────────── */
	.dg-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		gap: var(--space-2);
		min-height: 36px;
		flex-wrap: wrap;
	}

	.dg-toolbar__left, .dg-toolbar__right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.dg-toolbar__left {
		flex: 1 1 240px;
		min-width: 0;
	}

	.dg-toolbar__right {
		justify-content: flex-end;
		margin-left: auto;
	}

	/* ── Buttons ───────────────────────────── */
	.dg-btn {
		display: inline-flex;
		align-items: center;
		padding: 4px 10px;
		font-size: 12px;
		font-family: inherit;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
		white-space: nowrap;
	}

	.dg-btn:hover { background: var(--color-bg-tertiary); }
	.dg-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.dg-btn--sm { padding: 2px 8px; }
	.dg-btn--primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
	.dg-btn--primary:hover { filter: brightness(1.1); }
	.dg-btn--danger { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
	.dg-btn--danger:hover { filter: brightness(1.1); }

	/* ── Table ─────────────────────────────── */
	.dg-table-wrap {
		position: relative;
		overflow-x: auto;
		overflow-y: auto;
		max-height: 70vh;
	}

	.dg-table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	/* ── Header ────────────────────────────── */
	.dg-th {
		position: sticky;
		top: 0;
		z-index: 2;
		padding: 0;
		text-align: left;
		font-weight: 600;
		font-size: 12px;
		color: var(--color-text-secondary);
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		user-select: none;
	}

	.dg-th--checkbox {
		width: 36px !important;
		min-width: 36px !important;
		text-align: center;
		padding: var(--space-2);
	}

	.dg-th--actions {
		position: sticky;
		right: 0;
		z-index: 4;
		width: 80px !important;
		min-width: 80px !important;
		text-align: right;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-secondary);
		box-shadow: -12px 0 16px -16px color-mix(in srgb, var(--color-text) 55%, transparent);
	}

	.dg-th__inner {
		display: flex;
		align-items: center;
		position: relative;
	}

	.dg-sort-btn {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: var(--space-2) var(--space-3);
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		font-weight: 600;
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.dg-sort-btn:hover { color: var(--color-text); }

	.dg-sort-icon {
		font-size: 9px;
		opacity: 0.6;
	}

	.dg-resize-handle {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		cursor: col-resize;
		background: transparent;
	}

	.dg-resize-handle:hover, .dg-resize-handle:active {
		background: var(--color-primary);
		opacity: 0.5;
	}

	/* ── Cells ─────────────────────────────── */
	.dg-td {
		padding: var(--space-1) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: default;
		height: 32px;
		vertical-align: middle;
	}

	.dg-td--checkbox {
		text-align: center;
		width: 36px;
	}

	.dg-td--actions {
		position: sticky;
		right: 0;
		z-index: 1;
		text-align: right;
		white-space: nowrap;
		background: var(--dg-row-bg, var(--color-bg));
		box-shadow: -12px 0 16px -16px color-mix(in srgb, var(--color-text) 55%, transparent);
	}

	.dg-td--empty {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-text-secondary);
	}

	.dg-td--focused {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.dg-td--dirty {
		background: color-mix(in srgb, var(--color-warning) 10%, transparent);
	}

	.dg-td--editing {
		padding: 0;
		overflow: visible;
	}

	/* ── Cell Values ───────────────────────── */
	.dg-cell-value {
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.dg-cell-trigger {
		display: flex;
		align-items: center;
		width: 100%;
		height: 100%;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.dg-cell-trigger:focus {
		outline: none;
	}

	.dg-cell-value--null {
		color: var(--color-text-tertiary);
		font-style: italic;
	}

	.dg-cell-link {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-primary);
		text-decoration: none;
		cursor: pointer;
	}

	.dg-cell-link:hover {
		text-decoration: underline;
	}

	.dg-bool {
		font-size: 14px;
	}

	/* ── Inline Editor ─────────────────────── */
	.dg-cell-editor {
		width: 100%;
		height: 100%;
		min-height: 30px;
		padding: 2px var(--space-2);
		border: 2px solid var(--color-primary);
		border-radius: 0;
		background: var(--color-bg);
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: 12px;
		outline: none;
		box-sizing: border-box;
	}

	.dg-cell-editor--json {
		min-height: 80px;
		resize: vertical;
		position: absolute;
		z-index: 10;
		width: 300px;
		box-shadow: var(--shadow-md);
	}

	select.dg-cell-editor {
		appearance: none;
		cursor: pointer;
	}

	/* ── Row States ────────────────────────── */
	.dg-row {
		--dg-row-bg: var(--color-bg);
		transition: background 0.1s;
	}
	.dg-row:hover {
		--dg-row-bg: var(--color-bg-secondary);
		background: var(--dg-row-bg);
	}
	.dg-row--selected {
		--dg-row-bg: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg));
		background: var(--dg-row-bg);
	}
	.dg-row--dirty {
		--dg-row-bg: color-mix(in srgb, var(--color-warning) 6%, var(--color-bg));
		background: var(--dg-row-bg);
	}
	.dg-row:last-child .dg-td { border-bottom: none; }

	/* ── Action Buttons ────────────────────── */
	.dg-act-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		font-size: 14px;
	}

	.dg-act-btn:hover { background: var(--color-bg-tertiary); color: var(--color-text); }
	.dg-act-btn--save { color: var(--color-success); }
	.dg-act-btn--save:hover { background: color-mix(in srgb, var(--color-success) 15%, transparent); }
	.dg-act-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	/* ── Footer ────────────────────────────── */
	.dg-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		font-size: 12px;
	}

	.dg-footer__left, .dg-footer__right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.dg-count {
		color: var(--color-text-tertiary);
	}

	.dg-page-size {
		padding: 2px 6px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 11px;
		cursor: pointer;
	}

	.dg-page-info {
		color: var(--color-text-secondary);
	}

	/* ── Column Picker ────────────────────── */
	.dg-col-picker-wrap {
		position: relative;
	}

	.dg-col-picker-backdrop {
		position: fixed;
		inset: 0;
		z-index: 9;
		border: none;
		background: transparent;
	}

	.dg-col-picker {
		position: absolute;
		right: 0;
		top: 100%;
		margin-top: 4px;
		z-index: 10;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		padding: var(--space-2);
		min-width: 180px;
		max-height: 300px;
		overflow-y: auto;
	}

	.dg-col-picker__item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		font-size: 12px;
		cursor: pointer;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.dg-col-picker__item:hover {
		background: var(--color-bg-secondary);
	}

	.dg-col-picker__item input[type="checkbox"] {
		margin: 0;
	}

	.dg-col-picker__item input:disabled + span {
		opacity: 0.5;
	}

	/* ── Loading ───────────────────────────── */
	.dg-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		color: var(--color-text-secondary);
	}

	.dg-spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: dg-spin 0.6s linear infinite;
	}

	.dg-spinner-sm {
		display: inline-block;
		width: 10px;
		height: 10px;
		border: 1.5px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: dg-spin 0.6s linear infinite;
	}

	@keyframes dg-spin { to { transform: rotate(360deg); } }
</style>
