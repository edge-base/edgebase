<script lang="ts">
	interface Props {
		columns?: Array<{ key: string; label: string }>;
		rows?: Array<Record<string, unknown>>;
		totalCount?: number;
		emptyMessage?: string;
	}

	let { columns = [], rows = [], totalCount = 0, emptyMessage = 'No rows' }: Props = $props();
</script>

<div data-testid="mock-data-grid">
	<div data-testid="mock-data-grid-columns">{columns.map((column) => column.label).join(', ')}</div>
	{#if rows.length === 0}
		<div>{emptyMessage}</div>
	{:else}
		<div data-testid="mock-data-grid-total">{totalCount}</div>
		<pre data-testid="mock-data-grid-rows">{JSON.stringify(rows, null, 2)}</pre>
	{/if}
</div>
