<script lang="ts">
	import { base } from '$app/paths';
	import { devInfoStore } from '$lib/stores/devInfo';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
</script>

<div class="tables-welcome">
	<EmptyState
		title="Select a table"
		description="Choose a table from the sidebar to inspect schema, browse records, or run queries against the current database target."
	/>

	<div class="tables-hint">
		{#if $devInfoStore.devMode}
			<a href="{base}/database/new" class="hint-link">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path d="M3 4.5C3 3.67157 3.67157 3 4.5 3H11.5C12.3284 3 13 3.67157 13 4.5V11.5C13 12.3284 12.3284 13 11.5 13H4.5C3.67157 13 3 12.3284 3 11.5V4.5Z" stroke="currentColor" stroke-width="1.5"/>
					<path d="M8 5.5V10.5M5.5 8H10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				Create Database
			</a>
			<a href="{base}/database/tables/new" class="hint-link hint-link--primary">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				Create Table
			</a>
		{:else}
			<span class="hint-note">
				Create DB, create table, schema edits, and upgrades require dev mode. Start <code>pnpm dev</code>.
			</span>
		{/if}

		<a href="{base}/database/erd" class="hint-link">
			<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
				<rect x="1" y="2" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
				<rect x="10" y="10" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
				<path d="M6 4H8.5V12H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
			View ERD Diagram
		</a>
	</div>
</div>

<style>
	.tables-welcome {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 400px;
		gap: var(--space-4);
	}

	.tables-hint {
		display: flex;
		gap: var(--space-3);
	}

	.hint-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		color: var(--color-primary);
		text-decoration: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: background-color 0.1s;
	}

	.hint-link:hover {
		background: var(--color-bg-secondary);
	}

	.hint-link--primary {
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
		border-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
		color: var(--color-primary);
	}

	.hint-note {
		display: inline-flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		color: var(--color-text-tertiary);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
	}

	.hint-note code {
		margin-left: 4px;
		font-family: var(--font-mono);
	}
</style>
