<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	// ── State ────────────────────────────────────────
	interface FunctionEntry {
		path: string;
		methods: string[];
		type: string;
	}

	let functions = $state<FunctionEntry[]>([]);
	let loading = $state(true);

	// Execution
	let selectedFn = $state<FunctionEntry | null>(null);
	let method = $state('POST');
	let requestBody = $state('{}');
	let requestHeaders = $state('');
	let executing = $state(false);
	const requestBodyId = `function-request-body-${Math.random().toString(36).slice(2, 9)}`;
	const requestHeadersId = `function-request-headers-${Math.random().toString(36).slice(2, 9)}`;

	// Response
	interface ExecResult {
		status: number;
		statusText: string;
		body: string;
		time: number;
		headers: Record<string, string>;
	}

	let response = $state<ExecResult | null>(null);
	let execHistory = $state<Array<{ fn: string; method: string; status: number; time: number; timestamp: string }>>([]);

	// ── Load ─────────────────────────────────────────
	onMount(async () => {
		try {
			const res = await api.fetch<{ functions: FunctionEntry[] }>('data/functions');
			functions = res.functions ?? [];
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to load functions');
			functions = [];
		} finally {
			loading = false;
		}
	});

	function selectFn(fn: FunctionEntry) {
		selectedFn = fn;
		method = fn.methods[0] || 'POST';
		requestBody = method === 'GET' ? '' : '{}';
		response = null;
	}

	// ── Execute ──────────────────────────────────────
	async function executeFn() {
		if (!selectedFn) return;
		executing = true;
		response = null;

		const start = Date.now();
		try {
			const url = `/api/functions/${selectedFn.path}`;
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };

			// Parse custom headers
			if (requestHeaders.trim()) {
				for (const line of requestHeaders.split('\n')) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					const colonIdx = trimmed.indexOf(':');
					if (colonIdx === -1) {
						toastError(`Invalid header format: "${trimmed}". Use "Key: Value" format.`);
						executing = false;
						return;
					}
					const key = trimmed.slice(0, colonIdx).trim();
					const val = trimmed.slice(colonIdx + 1).trim();
					if (key) headers[key] = val;
				}
			}

			const opts: RequestInit = {
				method,
				headers,
			};

			if (method !== 'GET' && method !== 'HEAD' && requestBody.trim()) {
				// Validate JSON before sending
				try {
					JSON.parse(requestBody);
				} catch {
					toastError('Invalid JSON in request body. Example: {"key": "value"}');
					executing = false;
					return;
				}
				opts.body = requestBody;
			}

			const res = await fetch(url, opts);
			const elapsed = Date.now() - start;
			let body: string;
			const ct = res.headers.get('content-type') || '';

			if (ct.includes('json')) {
				const json = await res.json();
				body = JSON.stringify(json, null, 2);
			} else {
				body = await res.text();
			}

			const respHeaders: Record<string, string> = {};
			res.headers.forEach((v, k) => { respHeaders[k] = v; });

			response = {
				status: res.status,
				statusText: res.statusText,
				body,
				time: elapsed,
				headers: respHeaders,
			};

			execHistory = [
				{ fn: selectedFn.path, method, status: res.status, time: elapsed, timestamp: new Date().toISOString() },
				...execHistory.slice(0, 19),
			];
		} catch (err) {
			const elapsed = Date.now() - start;
			response = {
				status: 0,
				statusText: 'Network Error',
				body: err instanceof Error ? err.message : 'Request failed',
				time: elapsed,
				headers: {},
			};
		} finally {
			executing = false;
		}
	}
</script>

<PageShell title="Functions" description="Execute and test your App Functions">
	<div class="fn-layout">
		<!-- Function List -->
		<div class="fn-sidebar">
			<div class="fn-sidebar__header">
				<span class="fn-sidebar__title">Functions</span>
				<span class="fn-sidebar__count">{functions.length}</span>
			</div>
			{#if loading}
				<div class="fn-empty">Loading...</div>
			{:else if functions.length === 0}
				<div class="fn-empty">No functions registered</div>
			{:else}
				{#each functions as fn}
					<button
						class="fn-item"
						class:fn-item--active={selectedFn?.path === fn.path}
						onclick={() => selectFn(fn)}
					>
						<span class="fn-item__path">/{fn.path}</span>
						<div class="fn-item__meta">
							{#each fn.methods as m}
								<span class="fn-method-badge">{m}</span>
							{/each}
							<span class="fn-type-badge">{fn.type}</span>
						</div>
					</button>
				{/each}
			{/if}
		</div>

		<!-- Execution Panel -->
		<div class="fn-main">
			{#if !selectedFn}
				<EmptyState title="Select a function" description="Choose a function from the list to execute it." />
			{:else}
				<div class="fn-exec">
					<div class="fn-exec__header">
						<code class="fn-path">/api/functions/{selectedFn.path}</code>
					</div>

					<div class="fn-exec__controls">
						<select class="fn-select" bind:value={method}>
							{#each selectedFn.methods as m}
								<option value={m}>{m}</option>
							{/each}
						</select>
						<Button variant="primary" size="sm" onclick={executeFn} loading={executing}>Execute</Button>
					</div>

						{#if method !== 'GET' && method !== 'HEAD'}
							<div class="fn-field">
								<label class="fn-label" for={requestBodyId}>Request Body (JSON)</label>
								<textarea id={requestBodyId} class="fn-textarea" bind:value={requestBody} rows="6" spellcheck="false"></textarea>
							</div>
						{/if}

						<div class="fn-field">
							<label class="fn-label" for={requestHeadersId}>Custom Headers (one per line: Key: Value)</label>
							<textarea id={requestHeadersId} class="fn-textarea fn-textarea--sm" bind:value={requestHeaders} rows="3" spellcheck="false" placeholder="X-Custom: value"></textarea>
						</div>
				</div>

				<!-- Response -->
				{#if response}
					<div class="fn-response">
						<div class="fn-response__header">
							<span
								class="fn-status"
								class:fn-status--ok={response.status >= 200 && response.status < 300}
								class:fn-status--err={response.status >= 400 || response.status === 0}
							>
								{response.status} {response.statusText}
							</span>
							<span class="fn-time">{response.time}ms</span>
						</div>
						<pre class="fn-response__body">{response.body}</pre>
					</div>
				{/if}

				<!-- History -->
				{#if execHistory.length > 0}
					<div class="fn-history">
						<span class="fn-history__title">Recent Executions</span>
						{#each execHistory as h, i (i)}
							<div class="fn-history__item">
								<span class="fn-history__method">{h.method}</span>
								<span class="fn-history__path">/{h.fn}</span>
								<span class="fn-history__status" class:fn-status--ok={h.status >= 200 && h.status < 300} class:fn-status--err={h.status >= 400}>{h.status}</span>
								<span class="fn-history__time">{h.time}ms</span>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	</div>
</PageShell>

<style>
	.fn-layout { display: flex; gap: var(--space-4); min-height: 500px; }

	/* Sidebar */
	.fn-sidebar {
		width: 260px;
		flex-shrink: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow-y: auto;
		max-height: 70vh;
	}

	.fn-sidebar__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		position: sticky;
		top: 0;
	}

	.fn-sidebar__title { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
	.fn-sidebar__count { font-size: 11px; color: var(--color-text-tertiary); }

	.fn-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-bottom: 1px solid var(--color-border);
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.fn-item:hover { background: var(--color-bg-secondary); }
	.fn-item--active { background: color-mix(in srgb, var(--color-primary) 8%, transparent); border-left: 2px solid var(--color-primary); }
	.fn-item__path { font-family: var(--font-mono); font-size: 12px; color: var(--color-text); }
	.fn-item__meta { display: flex; gap: 4px; }

	.fn-method-badge {
		font-size: 9px;
		font-weight: 600;
		padding: 1px 4px;
		border-radius: 3px;
		background: color-mix(in srgb, var(--color-primary) 15%, transparent);
		color: var(--color-primary);
	}

	.fn-type-badge {
		font-size: 9px;
		padding: 1px 4px;
		border-radius: 3px;
		background: var(--color-bg-tertiary);
		color: var(--color-text-tertiary);
	}

	.fn-empty { padding: var(--space-4); text-align: center; color: var(--color-text-tertiary); font-size: 12px; }

	/* Main */
	.fn-main { flex: 1; display: flex; flex-direction: column; gap: var(--space-4); }

	.fn-exec { display: flex; flex-direction: column; gap: var(--space-3); }
	.fn-exec__header { padding: var(--space-2) 0; }
	.fn-path { font-size: 14px; color: var(--color-text); }

	.fn-exec__controls { display: flex; align-items: center; gap: var(--space-2); }

	.fn-select {
		padding: var(--space-2) var(--space-3);
		font-size: 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}

	.fn-field { display: flex; flex-direction: column; gap: var(--space-1); }
	.fn-label { font-size: 11px; font-weight: 600; color: var(--color-text-secondary); text-transform: uppercase; }

	.fn-textarea {
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-mono);
		font-size: 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		resize: vertical;
		outline: none;
	}

	.fn-textarea:focus { border-color: var(--color-primary); }
	.fn-textarea--sm { min-height: 40px; }

	/* Response */
	.fn-response {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.fn-response__header {
		display: flex;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.fn-status { font-size: 13px; font-weight: 600; }
	.fn-status--ok { color: var(--color-success); }
	.fn-status--err { color: var(--color-danger); }
	.fn-time { font-size: 12px; color: var(--color-text-tertiary); }

	.fn-response__body {
		padding: var(--space-3);
		font-family: var(--font-mono);
		font-size: 12px;
		margin: 0;
		overflow-x: auto;
		max-height: 400px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-all;
	}

	/* History */
	.fn-history { display: flex; flex-direction: column; gap: var(--space-1); }
	.fn-history__title { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: var(--space-1); }

	.fn-history__item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		font-size: 11px;
		color: var(--color-text-tertiary);
	}

	.fn-history__method { font-weight: 600; width: 40px; color: var(--color-text-secondary); }
	.fn-history__path { font-family: var(--font-mono); flex: 1; }
	.fn-history__status { font-weight: 600; }
	.fn-history__time { color: var(--color-text-tertiary); }
</style>
