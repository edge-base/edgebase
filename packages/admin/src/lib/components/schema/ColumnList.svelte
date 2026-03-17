<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { AUTO_FIELDS, type SchemaField } from '$lib/constants';

	interface Props {
		fields: Record<string, SchemaField>;
		readonly?: boolean;
		onaddclick?: () => void;
		oneditclick?: (name: string, field: SchemaField) => void;
		ondeleteclick?: (name: string) => void;
	}

	let {
		fields = {},
		readonly = false,
		onaddclick,
		oneditclick,
		ondeleteclick,
	}: Props = $props();

	let fieldEntries = $derived(Object.entries(fields));

	function isAutoField(name: string): boolean {
		return AUTO_FIELDS.includes(name as typeof AUTO_FIELDS[number]);
	}
</script>

<div class="column-list">
	<div class="column-list__header">
		<span class="column-list__title">Columns ({fieldEntries.length})</span>
		{#if !readonly}
			<Button variant="secondary" size="sm" onclick={onaddclick}>Add Column</Button>
		{/if}
	</div>

	<div class="column-list__table">
		<div class="column-list__row column-list__row--header">
			<span class="column-list__cell column-list__cell--name">Name</span>
			<span class="column-list__cell column-list__cell--type">Type</span>
			<span class="column-list__cell column-list__cell--attrs">Attributes</span>
			{#if !readonly}
				<span class="column-list__cell column-list__cell--actions">Actions</span>
			{/if}
		</div>

		{#each fieldEntries as [name, field] (name)}
			<div class="column-list__row" class:column-list__row--auto={isAutoField(name)}>
				<span class="column-list__cell column-list__cell--name">
					<code>{name}</code>
					{#if isAutoField(name)}
						<Badge variant="default" text="auto" />
					{/if}
				</span>
				<span class="column-list__cell column-list__cell--type">
					<code class="type-badge">{field.type}</code>
				</span>
				<span class="column-list__cell column-list__cell--attrs">
					{#if field.required}
						<Badge variant="warning" text="required" />
					{/if}
					{#if field.unique}
						<Badge variant="primary" text="unique" />
					{/if}
					{#if field.default !== undefined}
						<Badge variant="default" text="default" />
					{/if}
					{#if field.references}
						<Badge variant="success" text="FK" />
					{/if}
				</span>
				{#if !readonly}
					<span class="column-list__cell column-list__cell--actions">
						{#if !isAutoField(name)}
							<button class="action-btn" onclick={() => oneditclick?.(name, field)} title="Edit">
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
									<path d="M10.5 1.5L12.5 3.5L4 12H2V10L10.5 1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
								</svg>
							</button>
							<button class="action-btn action-btn--danger" onclick={() => ondeleteclick?.(name)} title="Delete">
								<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
									<path d="M4 4L10 10M10 4L4 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
								</svg>
							</button>
						{:else}
							<span class="auto-hint">auto-managed</span>
						{/if}
					</span>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.column-list {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.column-list__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.column-list__title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.column-list__table {
		display: flex;
		flex-direction: column;
	}

	.column-list__row {
		display: grid;
		grid-template-columns: 1fr 120px 1fr auto;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
	}

	.column-list__row:last-child {
		border-bottom: none;
	}

	.column-list__row--header {
		background: var(--color-bg-secondary);
		font-weight: 500;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.column-list__row--auto {
		opacity: 0.7;
	}

	.column-list__cell {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.column-list__cell--name code {
		font-family: var(--font-mono);
		font-size: 13px;
		overflow-wrap: break-word;
		word-break: break-all;
	}

	.column-list__cell--actions {
		display: flex;
		gap: var(--space-1);
		justify-content: flex-end;
	}

	.type-badge {
		display: inline-block;
		padding: 1px 6px;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.action-btn {
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
		transition: background 0.1s, color 0.1s;
	}

	.action-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.action-btn--danger:hover {
		background: #fee2e2;
		color: var(--color-danger);
	}

	.auto-hint {
		font-size: 11px;
		color: var(--color-text-tertiary);
	}
</style>
