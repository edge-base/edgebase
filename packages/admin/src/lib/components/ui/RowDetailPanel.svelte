<script lang="ts">
	import { toastError } from '$lib/stores/toast.svelte';
	import type { GridColumn } from '$lib/components/ui/DataGrid.svelte';

	const AUTO_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);
	const INVALID_VALUE = Symbol('invalid-value');

	interface Props {
		open: boolean;
		row: Record<string, unknown> | null;
		columns: GridColumn[];
		onClose: () => void;
		onSave?: (rowId: string, changes: Record<string, unknown>) => Promise<void> | void;
	}

	let { open = $bindable(), row, columns, onClose, onSave }: Props = $props();

	let panelEl = $state<HTMLDivElement | null>(null);
	let draftValues = $state<Record<string, string>>({});
	let baselineRow = $state<Record<string, unknown> | null>(null);
	let saving = $state(false);

	let editableColumns = $derived(
		columns.filter((col) => !AUTO_FIELDS.has(col.key) && col.editable !== false),
	);

	let hasEditableFields = $derived(editableColumns.length > 0 && !!onSave);
	let hasChanges = $derived(Boolean(collectChanges()));

	$effect(() => {
		if (!open || !row) return;

		baselineRow = { ...row };
		draftValues = buildDraftValues(row);

		requestAnimationFrame(() => {
			const firstField = panelEl?.querySelector<HTMLElement>('input, select, textarea');
			firstField?.focus();
		});
	});

	function buildDraftValues(sourceRow: Record<string, unknown>): Record<string, string> {
		const next: Record<string, string> = {};
		for (const col of columns) {
			const value = sourceRow[col.key];
			if (value === null || value === undefined) {
				next[col.key] = '';
				continue;
			}

			if (col.type === 'boolean') {
				next[col.key] = value ? 'true' : 'false';
				continue;
			}

			if (col.type === 'json' && typeof value === 'object') {
				next[col.key] = JSON.stringify(value, null, 2);
				continue;
			}

			if (col.type === 'datetime' && typeof value === 'string') {
				next[col.key] = toDateTimeLocalValue(value);
				continue;
			}

			next[col.key] = String(value);
		}
		return next;
	}

	function toDateTimeLocalValue(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return localDate.toISOString().slice(0, 16);
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape' && !saving) {
			onClose();
		}
	}

	function formatValue(val: unknown, col: GridColumn): string {
		if (val === null || val === undefined) return 'null';
		if (col.type === 'boolean') return val ? 'true' : 'false';
		if (col.type === 'json' && typeof val === 'object') return JSON.stringify(val, null, 2);
		if (col.type === 'datetime' && typeof val === 'string') {
			try {
				return new Date(val).toLocaleString();
			} catch {
				return String(val);
			}
		}
		return String(val);
	}

	function parseDraftValue(col: GridColumn, rawValue: string): unknown | typeof INVALID_VALUE {
		if (rawValue === '' && col.type !== 'text') {
			return null;
		}
		if (col.type === 'number') {
			const value = Number(rawValue);
			return Number.isNaN(value) ? INVALID_VALUE : value;
		}
		if (col.type === 'boolean') {
			if (rawValue === '') return null;
			return rawValue === 'true' || rawValue === '1';
		}
		if (col.type === 'json') {
			if (rawValue === '') return null;
			try {
				return JSON.parse(rawValue);
			} catch {
				return INVALID_VALUE;
			}
		}
		return rawValue;
	}

	function isNull(val: unknown): boolean {
		return val === null || val === undefined;
	}

	function isJson(val: unknown): boolean {
		return typeof val === 'object' && val !== null;
	}

	function valuesEqual(a: unknown, b: unknown): boolean {
		return JSON.stringify(a) === JSON.stringify(b);
	}

	function collectChanges(): Record<string, unknown> | null {
		if (!baselineRow) return null;

		const changes: Record<string, unknown> = {};

		for (const col of editableColumns) {
			const parsedValue = parseDraftValue(col, draftValues[col.key] ?? '');
			if (parsedValue === INVALID_VALUE) return null;
			if (!valuesEqual(parsedValue, baselineRow[col.key])) {
				changes[col.key] = parsedValue;
			}
		}

		return Object.keys(changes).length > 0 ? changes : null;
	}

	function getInputType(col: GridColumn): string {
		if (col.type === 'number') return 'number';
		if (col.type === 'datetime') return 'datetime-local';
		return 'text';
	}

	function getInputId(key: string): string {
		return `row-detail-field-${key}`;
	}

	async function handleSave() {
		if (!baselineRow || !onSave) return;

		const changes = collectChanges();
		if (!changes) return;

		for (const col of editableColumns) {
			if (parseDraftValue(col, draftValues[col.key] ?? '') === INVALID_VALUE) {
				toastError(`Invalid ${col.type} value for ${col.label}`);
				return;
			}
		}

		saving = true;
		try {
			await onSave(String(baselineRow.id), changes);
			baselineRow = { ...baselineRow, ...changes };
			draftValues = buildDraftValues(baselineRow);
		} catch (error) {
			toastError(error instanceof Error ? error.message : 'Save failed');
		} finally {
			saving = false;
		}
	}

	function handleReset() {
		if (!baselineRow) return;
		draftValues = buildDraftValues(baselineRow);
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open && baselineRow}
	<button
		type="button"
		class="rdp-overlay"
		aria-label="Close row detail"
		onclick={() => !saving && onClose()}
	></button>
	<div class="rdp" role="dialog" aria-modal="true" aria-labelledby="row-detail-title" bind:this={panelEl}>
		<div class="rdp-header">
			<div>
				<h3 id="row-detail-title" class="rdp-title">Row Detail</h3>
				<p class="rdp-subtitle">
					{#if hasEditableFields}
						Inspect and update this record without leaving the table.
					{:else}
						This record is read-only.
					{/if}
				</p>
			</div>
			<button
				type="button"
				class="rdp-close"
				onclick={onClose}
				aria-label="Close row detail"
				disabled={saving}
			>
				&times;
			</button>
		</div>
		<div class="rdp-body">
			{#each columns as col (col.key)}
				{@const value = baselineRow[col.key]}
				{@const editable = !AUTO_FIELDS.has(col.key) && col.editable !== false && !!onSave}
				<div class="rdp-field">
					<div class="rdp-field__header">
						{#if editable}
							<label class="rdp-field__name" for={getInputId(col.key)}>{col.label}</label>
						{:else}
							<span class="rdp-field__name">{col.label}</span>
						{/if}
						<span class="rdp-field__type">{col.type}</span>
					</div>

					{#if editable}
						{#if col.type === 'boolean'}
							<select
								id={getInputId(col.key)}
								class="rdp-input"
								bind:value={draftValues[col.key]}
								disabled={saving}
							>
								<option value="">Unset</option>
								<option value="true">true</option>
								<option value="false">false</option>
							</select>
						{:else if col.type === 'enum' && col.enumValues}
							<select
								id={getInputId(col.key)}
								class="rdp-input"
								bind:value={draftValues[col.key]}
								disabled={saving}
							>
								<option value="">Select value</option>
								{#each col.enumValues as option}
									<option value={option}>{option}</option>
								{/each}
							</select>
						{:else if col.type === 'json'}
							<textarea
								id={getInputId(col.key)}
								class="rdp-input rdp-input--textarea"
								rows="6"
								bind:value={draftValues[col.key]}
								disabled={saving}
							></textarea>
						{:else}
							<input
								id={getInputId(col.key)}
								class="rdp-input"
								type={getInputType(col)}
								bind:value={draftValues[col.key]}
								disabled={saving}
							/>
						{/if}
					{:else}
						<div class="rdp-field__value" class:rdp-field__value--null={isNull(value)}>
							{#if isNull(value)}
								<em>null</em>
							{:else if col.type === 'boolean'}
								<span class="rdp-bool">{value ? 'true' : 'false'}</span>
							{:else if col.type === 'json' && isJson(value)}
								<pre class="rdp-json">{JSON.stringify(value, null, 2)}</pre>
							{:else if col.linkFn}
								{@const href = col.linkFn(value)}
								{#if href}
									<a class="rdp-link" href={href}>{formatValue(value, col)}</a>
								{:else}
									{formatValue(value, col)}
								{/if}
							{:else}
								{formatValue(value, col)}
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<div class="rdp-footer">
			<button type="button" class="rdp-btn" disabled={saving} onclick={onClose}>Close</button>
			{#if hasEditableFields}
				<button
					type="button"
					class="rdp-btn"
					disabled={saving || !hasChanges}
					onclick={handleReset}
				>
					Reset
				</button>
				<button
					type="button"
					class="rdp-btn rdp-btn--primary"
					disabled={saving || !hasChanges}
					onclick={handleSave}
				>
					{#if saving}
						<span class="rdp-spinner"></span>
					{:else}
						Save Changes
					{/if}
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.rdp-overlay {
		position: fixed;
		inset: 0;
		border: none;
		padding: 0;
		background: rgba(0, 0, 0, 0.3);
		z-index: 40;
		cursor: pointer;
	}

	.rdp {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 420px;
		max-width: 90vw;
		background: var(--color-bg);
		border-left: 1px solid var(--color-border);
		box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
		z-index: 41;
		display: flex;
		flex-direction: column;
		animation: rdp-slide 0.2s ease-out;
	}

	@keyframes rdp-slide {
		from { transform: translateX(100%); }
		to { transform: translateX(0); }
	}

	.rdp-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.rdp-title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}

	.rdp-subtitle {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.rdp-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 18px;
		cursor: pointer;
	}

	.rdp-close:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.rdp-body {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-3);
	}

	.rdp-field {
		padding: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.rdp-field:last-child {
		border-bottom: none;
	}

	.rdp-field__header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.rdp-field__name {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-secondary);
		font-family: var(--font-mono);
	}

	.rdp-field__type {
		font-size: 10px;
		color: var(--color-text-tertiary);
		padding: 1px 6px;
		background: var(--color-bg-secondary);
		border-radius: 9999px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.rdp-field__value {
		font-size: 13px;
		font-family: var(--font-mono);
		color: var(--color-text);
		word-break: break-all;
	}

	.rdp-field__value--null {
		color: var(--color-text-tertiary);
		font-style: italic;
	}

	.rdp-input {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font: inherit;
	}

	.rdp-input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 22%, transparent);
	}

	.rdp-input--textarea {
		resize: vertical;
		min-height: 120px;
		font-family: var(--font-mono);
	}

	.rdp-bool {
		font-size: 13px;
	}

	.rdp-json {
		margin: 0;
		padding: var(--space-2);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		font-size: 12px;
		overflow-x: auto;
		white-space: pre-wrap;
	}

	.rdp-link {
		color: var(--color-primary);
		text-decoration: none;
	}

	.rdp-link:hover {
		text-decoration: underline;
	}

	.rdp-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-4);
		border-top: 1px solid var(--color-border);
	}

	.rdp-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 96px;
		padding: 8px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}

	.rdp-btn:disabled,
	.rdp-close:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.rdp-btn--primary {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: white;
	}

	.rdp-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: rgba(255, 255, 255, 0.95);
		border-radius: 9999px;
		animation: rdp-spin 0.8s linear infinite;
	}

	@keyframes rdp-spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
 </style>
