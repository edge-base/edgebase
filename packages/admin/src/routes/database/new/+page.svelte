<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { adminDashboardSchemaDocs } from '$lib/docs-links';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { devInfoStore } from '$lib/stores/devInfo';
	import { schemaStore } from '$lib/stores/schema';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte';

	type Topology = 'single' | 'dynamic';
	type SingleProvider = 'd1' | 'do' | 'postgres';
	type NeonAction = 'reuse' | 'create';
	type NeonProjectItem = {
		projectId: string;
		projectName: string;
		orgId: string;
		orgName: string;
	};

	let name = $state('');
	let topology = $state<Topology>('single');
	let provider = $state<SingleProvider>('d1');
	let connectionString = $state('');
	let targetLabel = $state('');
	let placeholder = $state('');
	let helperText = $state('');
	let saving = $state(false);
	let neonAction = $state<NeonAction | null>(null);
	let error = $state('');
	let customizeConnectionKey = $state(false);
	let newNeonProjectName = $state('');
	let neonProjects = $state<NeonProjectItem[]>([]);
	let neonProjectsLoading = $state(false);
	let neonProjectsLoaded = $state(false);
	let neonProjectsError = $state('');
	let selectedNeonProjectId = $state('');
	let isDevMode = $derived($devInfoStore.devMode);

	function defaultPostgresEnvKey(blockName: string): string {
		const normalized = blockName.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
		return normalized ? `DB_POSTGRES_${normalized}_URL` : 'DB_POSTGRES_APP_URL';
	}

	function defaultNeonProjectName(blockName: string): string {
		const normalized = blockName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.replace(/-{2,}/g, '-');
		return normalized || 'edgebase-db';
	}

	function effectiveConnectionKey(): string {
		return customizeConnectionKey
			? connectionString.trim() || defaultPostgresEnvKey(name)
			: defaultPostgresEnvKey(name);
	}

	function effectiveNeonProjectName(): string {
		return newNeonProjectName.trim() || defaultNeonProjectName(name);
	}

	function validate(): boolean {
		const trimmedName = name.trim();
		if (!trimmedName) {
			error = 'Database block name is required.';
			return false;
		}
		if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
			error = 'Database block name must start with a letter or underscore.';
			return false;
		}
		if (topology === 'single' && provider === 'postgres' && !effectiveConnectionKey()) {
			error = 'Connection string env key is required for postgres.';
			return false;
		}
		if (topology === 'single' && provider === 'postgres' && neonAction === 'create' && !effectiveNeonProjectName()) {
			error = 'Neon project name is required.';
			return false;
		}
		error = '';
		return true;
	}

	async function loadNeonProjects(force = false) {
		if (!isDevMode) return;
		if (!force && (neonProjectsLoaded || neonProjectsLoading || provider !== 'postgres')) return;

		neonProjectsLoading = true;
		neonProjectsError = '';
		try {
			const result = await api.schemaMutation<{ items?: NeonProjectItem[] }>(
				force ? 'integrations/neon/projects?refresh=1' : 'integrations/neon/projects',
				{
					method: 'GET'
				},
			);
			neonProjects = result.items ?? [];
			selectedNeonProjectId = neonProjects[0]?.projectId ?? '';
			neonProjectsLoaded = true;
		} catch (err) {
			neonProjectsError = describeActionError(err, 'Failed to load Neon projects.');
		} finally {
			neonProjectsLoading = false;
		}
	}

	$effect(() => {
		if (isDevMode && topology === 'single' && provider === 'postgres' && !neonProjectsLoaded && !neonProjectsLoading) {
			void loadNeonProjects();
		}
	});

	$effect(() => {
		if (topology !== 'single' || provider !== 'postgres') {
			customizeConnectionKey = false;
		}
	});

	$effect(() => {
		if (provider !== 'postgres' || topology !== 'single') {
			newNeonProjectName = '';
		}
	});

	function toggleCustomizeConnectionKey() {
		customizeConnectionKey = !customizeConnectionKey;
		if (customizeConnectionKey && !connectionString.trim()) {
			connectionString = defaultPostgresEnvKey(name);
		}
	}

	async function handleCreate() {
		if (!isDevMode) {
			error = 'Creating database blocks requires dev mode with the schema sidecar. Start `pnpm dev` and try again.';
			toastError(error);
			return;
		}
		if (!validate()) return;

		saving = true;
		try {
			await api.schemaMutation('schema/databases', {
				method: 'POST',
				body: {
					name: name.trim(),
					topology,
					provider: topology === 'single' ? provider : 'do',
					connectionString: topology === 'single' && provider === 'postgres'
						? effectiveConnectionKey()
						: undefined,
					targetLabel: targetLabel.trim() || undefined,
					placeholder: placeholder.trim() || undefined,
					helperText: helperText.trim() || undefined,
				},
			});
			await schemaStore.waitForNamespaceReady(name.trim(), {
				timeoutMessage: `Database block "${name.trim()}" is still syncing. Please try again in a moment.`,
			});
			toastSuccess(`Database block "${name.trim()}" created`);
			goto(`${base}/database/tables/new?dbKey=${encodeURIComponent(name.trim())}`);
		} catch (err) {
			error = describeActionError(err, 'Failed to create the database block.');
			toastError(error);
		} finally {
			saving = false;
		}
	}

	async function handleNeonCreate(mode: NeonAction) {
		if (!isDevMode) {
			error = 'Neon helpers require dev mode with the schema sidecar. Start `pnpm dev` and try again.';
			toastError(error);
			return;
		}
		if (topology !== 'single') {
			error = 'Neon helper only supports single database blocks.';
			return;
		}
		if (provider !== 'postgres') {
			provider = 'postgres';
		}
		if (mode === 'create' && !effectiveNeonProjectName()) {
			error = 'Neon project name is required.';
			return;
		}
		if (!validate()) return;
		if (mode === 'reuse' && !selectedNeonProjectId) {
			error = neonProjectsError || 'Choose an existing Neon project first, or create a new one.';
			return;
		}

		neonAction = mode;
		try {
			await api.schemaMutation('integrations/neon/databases', {
				method: 'POST',
				body: {
					name: name.trim(),
					topology: 'single',
					projectId: mode === 'reuse' ? selectedNeonProjectId : undefined,
					projectName: mode === 'create' ? effectiveNeonProjectName() : undefined,
					mode,
					...(customizeConnectionKey ? { envKey: effectiveConnectionKey() } : {}),
				},
			});
			await schemaStore.waitForNamespaceReady(name.trim(), {
				timeoutMessage: `Database block "${name.trim()}" is still syncing. Please try again in a moment.`,
			});
			toastSuccess(`Database block "${name.trim()}" connected to Neon`);
			goto(`${base}/database/tables/new?dbKey=${encodeURIComponent(name.trim())}`);
		} catch (err) {
			error = describeActionError(err, 'Failed to connect with Neon.');
			toastError(error);
		} finally {
			neonAction = null;
		}
	}

	function canConnectExistingNeon(): boolean {
		return !neonProjectsLoading && neonProjects.length > 0 && Boolean(selectedNeonProjectId);
	}
</script>

<PageShell title="Create Database" description="Add a new DB block to edgebase.config.ts" docsHref={adminDashboardSchemaDocs}>
	<div class="create-page">
		{#if error}
			<div class="create-error">{error}</div>
		{/if}

		{#if !isDevMode}
			<div class="readonly-banner">
				Creating database blocks requires dev mode. Start <code>pnpm dev</code> to enable schema edits and Neon helpers.
			</div>
		{/if}

		<div class="create-card">
			<Input label="Database Block Name" bind:value={name} placeholder="app" />

			<div class="field-group">
				<label class="field-label" for="db-topology">Type</label>
				<select id="db-topology" class="field-select" bind:value={topology}>
					<option value="single">Single DB</option>
					<option value="dynamic">Per-tenant DB</option>
				</select>
				<p class="field-help">
					{#if topology === 'single'}
						One database shared by the whole app.
					{:else}
						One isolated database per target ID.
					{/if}
				</p>
			</div>

			{#if topology === 'single'}
				<div class="field-group">
					<label class="field-label" for="db-provider">Provider</label>
					<select id="db-provider" class="field-select" bind:value={provider}>
						<option value="d1">D1 (default)</option>
						<option value="do">Durable Object</option>
						<option value="postgres">Postgres</option>
					</select>
				</div>

				{#if provider === 'postgres'}
					<div class="field-group field-group--helper">
						<label class="field-label" for="recommended-postgres-env-key">Automatic Postgres Env Key</label>
						<div id="recommended-postgres-env-key" class="field-static-display">
							<code>{effectiveConnectionKey()}</code>
						</div>
						<p class="field-help">
							EdgeBase will write this key into config automatically. Only override it if you already use a specific env key name.
						</p>
						<div class="helper-actions">
							<Button variant="ghost" onclick={toggleCustomizeConnectionKey}>
								{customizeConnectionKey ? 'Hide Env Key Override' : 'Customize Env Key'}
							</Button>
						</div>
						{#if customizeConnectionKey}
							<Input
								label="Custom Connection String Env Key"
								bind:value={connectionString}
								placeholder={defaultPostgresEnvKey(name)}
							/>
							<p class="field-help">
								Only change this if you already use a specific env key name.
							</p>
						{/if}
					</div>
					<div class="field-group field-group--helper neon-helper">
						<div class="neon-helper__intro">
							<div class="field-label">Neon Setup (Optional)</div>
							<p class="field-help">
								Need Neon right now? Pick one shortcut below. If you already have a connection string, skip this section and use <strong>Create Database</strong>.
							</p>
						</div>

						<div class="neon-helper__grid">
							<section class="neon-helper__option">
								<div class="neon-helper__option-header">
									<div class="neon-helper__eyebrow">Existing project</div>
									<h3 class="neon-helper__option-title">1. Connect an existing Neon project</h3>
									<p class="field-help">Best when the Neon project already exists in your account.</p>
								</div>
								<label class="field-label" for="existing-neon-project">Existing Neon Project</label>
								<select
									id="existing-neon-project"
									class="field-select"
									bind:value={selectedNeonProjectId}
									disabled={neonProjectsLoading || neonProjects.length === 0}
								>
									{#if neonProjects.length === 0}
										<option value="">
											{neonProjectsLoading ? 'Loading Neon projects...' : 'No Neon projects found'}
										</option>
									{:else}
										{#each neonProjects as project (project.projectId)}
											<option value={project.projectId}>
												{project.projectName} ({project.orgName})
											</option>
										{/each}
									{/if}
								</select>
								<div class="helper-actions helper-actions--compact">
									<Button variant="ghost" onclick={() => loadNeonProjects(true)} loading={neonProjectsLoading}>
										Refresh Projects
									</Button>
								</div>
								{#if neonProjectsError}
									<p class="field-help field-help--error">{neonProjectsError}</p>
								{:else if !neonProjectsLoading && neonProjects.length === 0}
									<p class="field-help">No existing Neon projects were found.</p>
								{:else if !neonProjectsLoading}
									<p class="field-help">
										EdgeBase will use the selected project and write the env key above.
									</p>
								{/if}
								<div class="helper-actions neon-helper__primary-actions">
									<Button
										variant="secondary"
										disabled={!isDevMode || !canConnectExistingNeon() || neonAction !== null}
										onclick={() => handleNeonCreate('reuse')}
									>
										{neonAction === 'reuse' ? 'Connecting Existing Neon...' : 'Connect Existing Neon'}
									</Button>
								</div>
							</section>

							<section class="neon-helper__option">
								<div class="neon-helper__option-header">
									<div class="neon-helper__eyebrow">Provision new project</div>
									<h3 class="neon-helper__option-title">2. Create a new Neon project</h3>
									<p class="field-help">Best when you want EdgeBase to provision Neon for this block.</p>
								</div>
								<Input
									label="New Neon Project Name"
									bind:value={newNeonProjectName}
									placeholder={defaultNeonProjectName(name)}
								/>
								<p class="field-help">
									EdgeBase will try this name first, then append a suffix if Neon already has one.
								</p>
								<div class="helper-actions neon-helper__primary-actions">
									<Button
										variant="secondary"
										disabled={!isDevMode || neonAction !== null}
										onclick={() => handleNeonCreate('create')}
									>
										{neonAction === 'create' ? 'Creating Neon Project...' : 'Create New Neon Project'}
									</Button>
								</div>
							</section>
						</div>
					</div>
				{/if}
			{:else}
				<div class="field-group">
					<label class="field-label" for="dynamic-provider">Provider</label>
					<input id="dynamic-provider" class="field-static" value="Durable Object" disabled />
					<p class="field-help">Per-tenant DB blocks always use Durable Objects for physical isolation.</p>
				</div>

				<Input label="Target Label" bind:value={targetLabel} placeholder="Workspace" />
				<Input label="Target ID Placeholder" bind:value={placeholder} placeholder="Enter workspace ID" />
				<Input label="Helper Text" bind:value={helperText} placeholder="Pick a workspace or enter an ID." />
			{/if}
		</div>

		<div class="create-actions">
			<a href="{base}/database/tables">
				<Button variant="secondary">Cancel</Button>
			</a>
			<Button variant="primary" loading={saving} disabled={!isDevMode} onclick={handleCreate}>Create Database</Button>
		</div>
	</div>
</PageShell>

<style>
	.create-page {
		max-width: 720px;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.create-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.create-error {
		padding: var(--space-3) var(--space-4);
		background: #fee2e2;
		color: #991b1b;
		font-size: 13px;
		border-radius: var(--radius-md);
	}

	.readonly-banner {
		padding: var(--space-3) var(--space-4);
		background: #fef3c7;
		color: #92400e;
		font-size: 13px;
		line-height: 1.6;
		border-radius: var(--radius-md);
	}

	.readonly-banner code {
		font-family: var(--font-mono);
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.field-select,
	.field-static {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font-size: 0.875rem;
		font-family: inherit;
		line-height: 1.25rem;
		color: var(--color-text);
		background-color: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		outline: none;
		box-sizing: border-box;
	}

	.field-select:focus {
		border-color: var(--color-primary);
	}

	.field-static:disabled {
		opacity: 0.75;
		cursor: not-allowed;
	}

	.field-static-display {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		font-size: 0.875rem;
		line-height: 1.25rem;
		color: var(--color-text);
		background-color: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-sizing: border-box;
	}

	.field-static-display code {
		font-family: var(--font-mono, 'SFMono-Regular', monospace);
		font-size: 0.8125rem;
	}

	.field-help {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.field-group--helper {
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
	}

	.neon-helper {
		gap: var(--space-3);
	}

	.neon-helper__intro {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.neon-helper__grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: var(--space-3);
		align-items: stretch;
	}

	.neon-helper__option {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		height: 100%;
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
	}

	.neon-helper__eyebrow {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.neon-helper__option-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.neon-helper__option-title {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.neon-helper__primary-actions {
		margin-top: auto;
	}

	.helper-actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.helper-actions--compact {
		justify-content: flex-end;
	}

	.field-help--error {
		color: var(--color-danger);
	}

	.create-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}
</style>
