<script lang="ts">
	import { api } from '$lib/api';
	import { toastError } from '$lib/stores/toast.svelte';
	import { schemaStore } from '$lib/stores/schema';
	import Button from '$lib/components/ui/Button.svelte';

	let { tableName }: { tableName: string } = $props();

	// ── State ────────────────────────────────────────
	let users = $state<Array<{ id: string; email: string; role?: string }>>([]);
	let loading = $state(false);
	let namespace = $state('shared');

	// Form
	let authMode = $state<'user' | 'custom' | 'anonymous'>('anonymous');
	let selectedUserId = $state('');
	let customAuth = $state('{\n  "id": "",\n  "email": "",\n  "role": ""\n}');
	let operations = $state(['read', 'insert', 'update', 'delete', 'access']);

	// Results
	interface RuleResult {
		operation: string;
		allowed: boolean;
		rule: string;
		error?: string;
	}

	let results = $state<RuleResult[]>([]);
	let tested = $state(false);
	const userSelectId = `rules-user-${Math.random().toString(36).slice(2, 9)}`;
	const authJsonId = `rules-auth-json-${Math.random().toString(36).slice(2, 9)}`;

	// Sync namespace from schema
	$effect(() => {
		if (tableName) {
			const unsub = schemaStore.subscribe((state) => {
				const table = state.schema[tableName];
				if (table) {
					namespace = (table as { namespace: string }).namespace;
				}
			});
			unsub();
			// Reset results on table change
			results = [];
			tested = false;
		}
	});

	// Load users on first render
	$effect(() => {
		loadUsers();
	});

	async function loadUsers() {
		try {
			const res = await api.fetch<{ users: Array<{ id: string; email?: string; role?: string }> }>('data/users?limit=100');
			users = (res.users ?? []).map((u) => ({
				id: u.id,
				email: u.email ?? `user-${u.id.slice(0, 8)}`,
				role: u.role,
			}));
		} catch { /* ignore */ }
	}

	// ── Test ─────────────────────────────────────────
	async function runTest() {
		loading = true;
		tested = false;
		results = [];

		let auth: Record<string, unknown> | null = null;

		if (authMode === 'user' && selectedUserId) {
			const user = users.find((u) => u.id === selectedUserId);
			if (user) auth = { id: user.id, email: user.email, role: user.role };
		} else if (authMode === 'custom') {
			try {
				auth = JSON.parse(customAuth);
			} catch {
				toastError('Invalid JSON for custom auth context');
				loading = false;
				return;
			}
		}

		try {
			const res = await api.fetch<{ results: RuleResult[] }>('data/rules-test', {
				method: 'POST',
				body: {
					namespace,
					table: tableName,
					auth,
					operations,
				},
			});
			results = res.results ?? [];
			tested = true;
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Test failed');
		} finally {
			loading = false;
		}
	}
</script>

<div class="rt-layout">
	<!-- Form -->
	<div class="rt-form">
		<fieldset class="rt-field">
			<legend class="rt-label">Auth Context</legend>
			<div class="rt-radio-group">
				<label class="rt-radio">
					<input type="radio" bind:group={authMode} value="anonymous" /> Anonymous (null)
				</label>
				<label class="rt-radio">
					<input type="radio" bind:group={authMode} value="user" /> Select User
				</label>
				<label class="rt-radio">
					<input type="radio" bind:group={authMode} value="custom" /> Custom JSON
				</label>
			</div>
		</fieldset>

		{#if authMode === 'user'}
			<div class="rt-field">
				<label class="rt-label" for={userSelectId}>User</label>
				<select id={userSelectId} class="rt-select" bind:value={selectedUserId}>
					<option value="">Select a user...</option>
					{#each users as u}
						<option value={u.id}>{u.email} {u.role ? `(${u.role})` : ''}</option>
					{/each}
				</select>
			</div>
		{/if}

		{#if authMode === 'custom'}
			<div class="rt-field">
				<label class="rt-label" for={authJsonId}>Auth JSON</label>
				<textarea
					id={authJsonId}
					class="rt-textarea"
					bind:value={customAuth}
					rows="5"
					spellcheck="false"
				></textarea>
			</div>
		{/if}

		<Button variant="primary" onclick={runTest} {loading}>Test Rules</Button>
	</div>

	<!-- Results -->
	{#if tested}
		<div class="rt-results">
			<h3 class="rt-results-title">Results</h3>
			<div class="rt-results-grid">
				{#each results as r}
					<div class="rt-result-card" class:rt-result-card--allowed={r.allowed} class:rt-result-card--denied={!r.allowed}>
						<div class="rt-result-header">
							<span class="rt-result-op">{r.operation}</span>
							<span class="rt-result-badge" class:rt-badge--allowed={r.allowed} class:rt-badge--denied={!r.allowed}>
								{r.allowed ? '\u2714 Allowed' : '\u2718 Denied'}
							</span>
						</div>
						<code class="rt-result-rule">{r.rule}</code>
						{#if r.error}
							<div class="rt-result-error">{r.error}</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.rt-layout { display: flex; flex-direction: column; gap: var(--space-5); }

	.rt-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: 600px;
	}

	.rt-field { display: flex; flex-direction: column; gap: var(--space-1); border: none; padding: 0; margin: 0; min-width: 0; }
	.rt-label { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }

	.rt-select, .rt-textarea {
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		font-family: inherit;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text);
		outline: none;
	}

	.rt-select:focus, .rt-textarea:focus { border-color: var(--color-primary); }
	.rt-textarea { font-family: var(--font-mono); resize: vertical; }

	.rt-radio-group { display: flex; gap: var(--space-4); }
	.rt-radio { display: flex; align-items: center; gap: var(--space-1); font-size: 13px; cursor: pointer; }

	/* Results */
	.rt-results-title { font-size: 14px; font-weight: 600; margin: 0 0 var(--space-3); }

	.rt-results-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--space-3);
	}

	.rt-result-card {
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		border-left: 3px solid var(--color-border);
	}

	.rt-result-card--allowed { border-left-color: var(--color-success); }
	.rt-result-card--denied { border-left-color: var(--color-danger); }

	.rt-result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2); }
	.rt-result-op { font-weight: 600; font-size: 13px; text-transform: uppercase; }

	.rt-result-badge {
		font-size: 11px;
		font-weight: 600;
		padding: 2px 8px;
		border-radius: 10px;
	}

	.rt-badge--allowed { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }
	.rt-badge--denied { background: color-mix(in srgb, var(--color-danger) 15%, transparent); color: var(--color-danger); }

	.rt-result-rule { font-size: 11px; color: var(--color-text-tertiary); display: block; }
	.rt-result-error { font-size: 11px; color: var(--color-danger); margin-top: var(--space-1); }
</style>
