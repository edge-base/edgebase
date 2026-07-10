<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { describeActionError } from '$lib/error-messages';
	import { apiReferenceDocs } from '$lib/docs-links';
	import { buildScalarHtml } from '$lib/api-docs';
	import { authStore } from '$lib/stores/auth';
	import { getAdminApiOrigin } from '$lib/runtime-config';

	let iframeSrc = $state('');
	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let loading = $state(true);
	let error = $state('');

	// The docs iframe runs on an opaque origin (no `allow-same-origin`) and cannot
	// read the admin session. It requests the short-lived access token over
	// postMessage; the long-lived refresh token stays in the server-issued
	// HttpOnly cookie and is never readable by either frame.
	async function respondWithToken(target: Window, refresh: boolean) {
		if (refresh) {
			await authStore.refresh();
		}
		const accessToken = get(authStore).accessToken ?? null;
		target.postMessage({ type: 'edgebase-admin-token', accessToken }, '*');
	}

	function handleIframeMessage(event: MessageEvent) {
		const frameWindow = iframeEl?.contentWindow;
		if (!frameWindow || event.source !== frameWindow) return;
		const data = event.data;
		if (!data || (data.type !== 'edgebase-docs-ready' && data.type !== 'edgebase-docs-request-token')) {
			return;
		}
		void respondWithToken(frameWindow, data.type === 'edgebase-docs-request-token' && data.refresh === true);
	}

	onMount(() => {
		window.addEventListener('message', handleIframeMessage);

		let objectUrl = '';
		(async () => {
			try {
				const apiOrigin = getAdminApiOrigin();
				const specRes = await fetch(`${apiOrigin}/openapi.json`);
				if (!specRes.ok) throw new Error(`Failed to fetch OpenAPI spec (${specRes.status})`);
				const specJson = await specRes.text();
				const html = buildScalarHtml(specJson, apiOrigin);

				const blob = new Blob([html], { type: 'text/html' });
				objectUrl = URL.createObjectURL(blob);
				iframeSrc = objectUrl;
				loading = false;
			} catch (err) {
				loading = false;
				error = describeActionError(err, 'Failed to initialize API docs.');
			}
		})();

		return () => {
			window.removeEventListener('message', handleIframeMessage);
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
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
				bind:this={iframeEl}
				src={iframeSrc}
				class="scalar-frame"
				title="API Documentation"
				sandbox="allow-scripts allow-popups"
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
