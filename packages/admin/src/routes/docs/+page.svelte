<script lang="ts">
	import { onMount } from 'svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { describeActionError } from '$lib/error-messages';
	import { apiReferenceDocs } from '$lib/docs-links';
	import { buildScalarHtml } from '$lib/api-docs';
	import { ADMIN_AUTH_STORAGE_KEY } from '$lib/stores/auth';
	import { getAdminApiOrigin } from '$lib/runtime-config';

	let iframeSrc = $state('');
	let loading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			const apiOrigin = getAdminApiOrigin();
			const specRes = await fetch(`${apiOrigin}/openapi.json`);
			if (!specRes.ok) throw new Error(`Failed to fetch OpenAPI spec (${specRes.status})`);
			const specJson = await specRes.text();
			const html = buildScalarHtml(specJson, apiOrigin, ADMIN_AUTH_STORAGE_KEY);

			const blob = new Blob([html], { type: 'text/html' });
			iframeSrc = URL.createObjectURL(blob);
			loading = false;
		} catch (err) {
			loading = false;
			error = describeActionError(err, 'Failed to initialize API docs.');
		}
	});
</script>

<PageShell title="API Docs" description="Interactive OpenAPI documentation for your EdgeBase instance" docsHref={apiReferenceDocs}>
	<div class="api-docs">
		{#if loading}
			<div class="loading-state">Loading API documentation...</div>
		{/if}
		{#if error}
			<div class="error-state">{error}</div>
		{/if}
		{#if iframeSrc}
			<iframe
				src={iframeSrc}
				class="scalar-frame"
				title="API Documentation"
				sandbox="allow-scripts allow-same-origin allow-popups"
			></iframe>
		{/if}
	</div>
</PageShell>

<style>
	.api-docs {
		min-height: 70vh;
		display: flex;
		flex-direction: column;
	}

	.loading-state {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-text-secondary);
	}

	.error-state {
		padding: var(--space-5);
		text-align: center;
		color: var(--color-danger);
		background: color-mix(in srgb, var(--color-danger) 8%, transparent);
		border-radius: var(--radius-md);
		font-size: 13px;
	}

	.scalar-frame {
		flex: 1;
		width: 100%;
		min-height: 80vh;
		border: none;
		border-radius: var(--radius-md);
	}
</style>
