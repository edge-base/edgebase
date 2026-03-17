<script lang="ts">
	import type { GridColumn } from '$lib/components/ui/DataGrid.svelte';

	interface Props {
		open: boolean;
		columns: GridColumn[];
		values: Record<string, string>;
		errors?: Record<string, string>;
		saving?: boolean;
		onClose: () => void;
		onSubmit: () => void;
	}

	let {
		open = $bindable(),
		columns = [],
		values = $bindable({}),
		errors = $bindable({}),
		saving = false,
		onClose,
		onSubmit,
	}: Props = $props();

	const AUTO_GENERATED_FIELDS = new Set(['createdAt', 'updatedAt']);
	let panelEl = $state<HTMLDivElement | null>(null);

	let idColumn = $derived(columns.find((col) => col.key === 'id') ?? null);
	let editableColumns = $derived(
		columns.filter((col) => !AUTO_GENERATED_FIELDS.has(col.key) && col.key !== 'id' && col.editable !== false),
	);
	let createColumns = $derived([
		...(idColumn ? [{ ...idColumn, label: 'Record ID', editable: true }] : []),
		...editableColumns,
	]);
	let hasOnlyIdField = $derived(Boolean(idColumn) && editableColumns.length === 0);
	let hasNoManualFields = $derived(createColumns.length === 0);

	$effect(() => {
		if (!open) return;
		requestAnimationFrame(() => {
			const firstField = panelEl?.querySelector<HTMLElement>('input, select, textarea');
			firstField?.focus();
		});
	});

	function handleWindowKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape' && !saving) {
			onClose();
		}
	}

	function getInputType(col: GridColumn): string {
		if (col.type === 'number') return 'number';
		if (col.type === 'datetime') return 'datetime-local';
		return 'text';
	}

	function getFieldPlaceholder(col: GridColumn): string {
		if (col.key === 'id') return 'Leave blank to auto-generate';
		if (col.type === 'json') return '{ "key": "value" }';
		if (col.type === 'number') return '0';
		return col.label;
	}

	function getFieldId(key: string): string {
		return `create-row-${key}`;
	}

	function clearFieldError(key: string): void {
		if (!errors[key]) return;
		const next = { ...errors };
		delete next[key];
		errors = next;
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
	<button
		type="button"
		class="crp-overlay"
		aria-label="Close create record panel"
		onclick={() => !saving && onClose()}
	></button>

	<div
		class="crp"
		role="dialog"
		aria-modal="true"
		aria-labelledby="create-record-title"
		bind:this={panelEl}
	>
		<div class="crp-header">
			<div>
				<h3 id="create-record-title" class="crp-title">Create Record</h3>
				<p class="crp-subtitle">
					{#if hasNoManualFields}
						This table only uses auto-managed fields. Creating a row will generate the record automatically.
					{:else if hasOnlyIdField}
						This table only uses auto-managed fields. You can optionally set a custom record ID.
					{:else}
						Fill in the fields for the new row. Record ID is optional.
					{/if}
				</p>
			</div>
			<button
				type="button"
				class="crp-close"
				aria-label="Close create record panel"
				disabled={saving}
				onclick={onClose}
			>
				&times;
			</button>
		</div>

		<form
			class="crp-body"
			onsubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			{#if hasOnlyIdField}
				<div class="crp-note">
					Leave <strong>Record ID</strong> blank to let EdgeBase generate <code>id</code>, <code>createdAt</code>,
					and <code>updatedAt</code> automatically.
				</div>
			{:else if hasNoManualFields}
				<div class="crp-note">
					This table does not expose any manual fields. EdgeBase will create the row with auto-managed values only.
				</div>
			{/if}

			{#each createColumns as col (col.key)}
				<div class="crp-field">
					<div class="crp-field__header">
						<label class="crp-field__name" for={getFieldId(col.key)}>{col.label}</label>
						<span class="crp-field__type">{col.type}</span>
					</div>

					{#if col.type === 'boolean'}
						<select
							id={getFieldId(col.key)}
							class="crp-input"
							class:crp-input--error={Boolean(errors[col.key])}
							bind:value={values[col.key]}
							disabled={saving}
							onchange={() => clearFieldError(col.key)}
						>
							<option value="">Unset</option>
							<option value="true">true</option>
							<option value="false">false</option>
						</select>
					{:else if col.type === 'enum' && col.enumValues}
						<select
							id={getFieldId(col.key)}
							class="crp-input"
							class:crp-input--error={Boolean(errors[col.key])}
							bind:value={values[col.key]}
							disabled={saving}
							onchange={() => clearFieldError(col.key)}
						>
							<option value="">Select value</option>
							{#each col.enumValues as option}
								<option value={option}>{option}</option>
							{/each}
						</select>
					{:else if col.type === 'json'}
						<textarea
							id={getFieldId(col.key)}
							class="crp-input crp-input--textarea"
							class:crp-input--error={Boolean(errors[col.key])}
							rows="6"
							placeholder={getFieldPlaceholder(col)}
							bind:value={values[col.key]}
							disabled={saving}
							oninput={() => clearFieldError(col.key)}
						></textarea>
					{:else}
						<input
							id={getFieldId(col.key)}
							class="crp-input"
							class:crp-input--error={Boolean(errors[col.key])}
							type={getInputType(col)}
							placeholder={getFieldPlaceholder(col)}
							bind:value={values[col.key]}
							disabled={saving}
							oninput={() => clearFieldError(col.key)}
						/>
					{/if}

					{#if col.key === 'id'}
						<p class="crp-helper">
							Optional. Leave blank to auto-generate. Custom IDs may only use English letters, numbers,
							hyphen (-), or underscore (_).
						</p>
					{/if}

					{#if errors[col.key]}
						<p class="crp-error">{errors[col.key]}</p>
					{/if}
				</div>
			{/each}

			<div class="crp-footer">
				<button type="button" class="crp-btn" disabled={saving} onclick={onClose}>Cancel</button>
				<button type="submit" class="crp-btn crp-btn--primary" disabled={saving}>
					{#if saving}
						<span class="crp-spinner"></span>
					{:else}
						{hasNoManualFields ? 'Create Empty Row' : 'Create Row'}
					{/if}
				</button>
			</div>
		</form>
	</div>
{/if}

<style>
	.crp-overlay {
		position: fixed;
		inset: 0;
		border: none;
		padding: 0;
		background: rgba(0, 0, 0, 0.35);
		z-index: 40;
		cursor: pointer;
	}

	.crp {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 420px;
		max-width: min(92vw, 420px);
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		border-left: 1px solid var(--color-border);
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.18);
		z-index: 41;
		animation: crp-slide 0.2s ease-out;
	}

	@keyframes crp-slide {
		from { transform: translateX(100%); }
		to { transform: translateX(0); }
	}

	.crp-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.crp-title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.crp-subtitle {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.crp-close {
		display: inline-flex;
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

	.crp-close:hover:not(:disabled) {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.crp-body {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.crp-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.crp-note {
		padding: 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		font-size: 12px;
		color: var(--color-text-secondary);
		line-height: 1.55;
	}

	.crp-field__header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.crp-field__name {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.crp-field__type {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 9999px;
		background: var(--color-bg-secondary);
		color: var(--color-text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.crp-input {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font: inherit;
	}

	.crp-input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 22%, transparent);
	}

	.crp-input--error {
		border-color: var(--color-danger);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-danger) 18%, transparent);
	}

	.crp-input--textarea {
		resize: vertical;
		min-height: 120px;
		font-family: var(--font-mono);
	}

	.crp-helper,
	.crp-error {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
	}

	.crp-helper {
		color: var(--color-text-secondary);
	}

	.crp-error {
		color: var(--color-danger);
	}

	.crp-footer {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: auto;
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	.crp-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}

	.crp-btn:disabled,
	.crp-close:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.crp-btn--primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
	}

	.crp-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		border-radius: 9999px;
		animation: crp-spin 0.7s linear infinite;
	}

	@keyframes crp-spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
