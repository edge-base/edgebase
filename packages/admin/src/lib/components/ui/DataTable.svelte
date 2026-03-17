<script lang="ts">
	interface Column {
		key: string;
		label: string;
		sortable?: boolean;
	}

	interface Props {
		columns?: Column[];
		rows?: Record<string, unknown>[];
		loading?: boolean;
		emptyMessage?: string;
		onclick?: (row: Record<string, unknown>) => void;
	}

	let {
		columns = [],
		rows = [],
		loading = false,
		emptyMessage = 'No data available.',
		onclick,
	}: Props = $props();

	let sortKey: string | null = $state(null);
	let sortDir: 'asc' | 'desc' = $state('asc');

	function toggleSort(key: string) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = 'asc';
		}
	}

	let sortedRows = $derived.by(() => {
		if (!sortKey) return rows;
		const key = sortKey;
		const dir = sortDir;
		return [...rows].sort((a, b) => {
			const va = a[key];
			const vb = b[key];
			if (va == null && vb == null) return 0;
			if (va == null) return 1;
			if (vb == null) return -1;
			if (typeof va === 'number' && typeof vb === 'number') {
				return dir === 'asc' ? va - vb : vb - va;
			}
			const sa = String(va);
			const sb = String(vb);
			const cmp = sa.localeCompare(sb);
			return dir === 'asc' ? cmp : -cmp;
		});
	});

	function handleRowClick(row: Record<string, unknown>) {
		onclick?.(row);
	}

	function handleRowKeydown(e: KeyboardEvent, row: Record<string, unknown>) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onclick?.(row);
		}
	}
</script>

<div class="table-wrapper">
	<table class="table">
		<thead>
			<tr>
				{#each columns as col (col.key)}
					<th class="table__th" class:table__th--sortable={col.sortable}>
						{#if col.sortable}
							<button class="table__sort-btn" onclick={() => toggleSort(col.key)}>
								{col.label}
								<span class="table__sort-icon" aria-hidden="true">
									{#if sortKey === col.key}
										{#if sortDir === 'asc'}
											<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
												<path d="M6 3L9 7H3L6 3Z" fill="currentColor"/>
											</svg>
										{:else}
											<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
												<path d="M6 9L3 5H9L6 9Z" fill="currentColor"/>
											</svg>
										{/if}
									{:else}
										<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
											<path d="M6 3L8 5.5H4L6 3Z" fill="currentColor" opacity="0.3"/>
											<path d="M6 9L4 6.5H8L6 9Z" fill="currentColor" opacity="0.3"/>
										</svg>
									{/if}
								</span>
							</button>
						{:else}
							{col.label}
						{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if loading}
				<tr>
					<td class="table__td table__td--empty" colspan={columns.length}>
						<div class="table__loading">
							<span class="table__spinner"></span>
							Loading...
						</div>
					</td>
				</tr>
			{:else if sortedRows.length === 0}
				<tr>
					<td class="table__td table__td--empty" colspan={columns.length}>
						{emptyMessage}
					</td>
				</tr>
			{:else}
				{#each sortedRows as row, i (i)}
					<tr
						class="table__row"
						class:table__row--clickable={!!onclick}
						onclick={() => handleRowClick(row)}
						onkeydown={(e) => handleRowKeydown(e, row)}
						tabindex={onclick ? 0 : undefined}
						role={onclick ? 'button' : undefined}
					>
						{#each columns as col (col.key)}
							<td class="table__td">{row[col.key] ?? ''}</td>
						{/each}
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<style>
	.table-wrapper {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.table__th {
		position: sticky;
		top: 0;
		padding: var(--space-3) var(--space-4);
		text-align: left;
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-secondary);
		background-color: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
		user-select: none;
	}

	.table__sort-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		cursor: pointer;
	}

	.table__sort-btn:hover {
		color: var(--color-text);
	}

	.table__sort-icon {
		display: inline-flex;
		align-items: center;
	}

	.table__td {
		padding: var(--space-3) var(--space-4);
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}

	.table__td--empty {
		padding: var(--space-8) var(--space-4);
		text-align: center;
		color: var(--color-text-secondary);
	}

	.table__row:last-child .table__td {
		border-bottom: none;
	}

	.table__row--clickable {
		cursor: pointer;
		transition: background-color 0.1s;
	}

	.table__row--clickable:hover {
		background-color: var(--color-bg-secondary);
	}

	.table__row--clickable:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: -2px;
	}

	.table__loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		color: var(--color-text-secondary);
	}

	.table__spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
