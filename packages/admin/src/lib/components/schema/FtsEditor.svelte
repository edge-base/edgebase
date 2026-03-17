<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';

	interface Props {
		ftsFields: string[];
		availableFields?: string[];
		readonly?: boolean;
		onsave?: (fields: string[]) => void;
	}

	let {
		ftsFields = [],
		availableFields = [],
		readonly = false,
		onsave,
	}: Props = $props();

	// Only string/text fields are eligible for FTS
	let selected = $state<Record<string, boolean>>({});
	let dirty = $state(false);

	// Sync from props
	$effect(() => {
		const s: Record<string, boolean> = {};
		for (const f of availableFields) {
			s[f] = ftsFields.includes(f);
		}
		selected = s;
		dirty = false;
	});

	function toggle(field: string) {
		selected[field] = !selected[field];
		dirty = true;
	}

	function handleSave() {
		const fields = Object.entries(selected)
			.filter(([, v]) => v)
			.map(([k]) => k);
		onsave?.(fields);
		dirty = false;
	}
</script>

<div class="fts-editor">
	<div class="fts-editor__header">
		<span class="fts-editor__title">Full-Text Search</span>
		{#if !readonly && dirty}
			<Button variant="primary" size="sm" onclick={handleSave}>Save FTS</Button>
		{/if}
	</div>

	{#if availableFields.length === 0}
		<div class="fts-empty">No string/text fields available for FTS.</div>
	{:else}
		<div class="fts-list">
			{#each availableFields as field (field)}
				<label class="fts-item">
					<input
						type="checkbox"
						checked={selected[field] ?? false}
						disabled={readonly}
						onchange={() => toggle(field)}
					/>
					<code>{field}</code>
					{#if ftsFields.includes(field)}
						<span class="fts-active">active</span>
					{/if}
				</label>
			{/each}
		</div>
	{/if}
</div>

<style>
	.fts-editor {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.fts-editor__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.fts-editor__title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.fts-list {
		display: flex;
		flex-direction: column;
	}

	.fts-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
		cursor: pointer;
	}

	.fts-item:last-child {
		border-bottom: none;
	}

	.fts-item:hover {
		background: var(--color-bg-secondary);
	}

	.fts-item code {
		font-family: var(--font-mono);
		font-size: 13px;
	}

	.fts-active {
		margin-left: auto;
		padding: 1px 6px;
		background: #dcfce7;
		color: #166534;
		font-size: 11px;
		font-weight: 500;
		border-radius: var(--radius-sm);
	}

	.fts-empty {
		padding: var(--space-4);
		text-align: center;
		font-size: 13px;
		color: var(--color-text-secondary);
	}
</style>
