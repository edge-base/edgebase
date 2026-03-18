<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { api } from '$lib/api';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import RecordsTab from '$lib/components/database/RecordsTab.svelte';
	import SchemaTab from '$lib/components/database/SchemaTab.svelte';
	import RulesTab from '$lib/components/database/RulesTab.svelte';
	import SdkSnippets from '$lib/components/database/SdkSnippets.svelte';
	import { schemaStore, type TableDef } from '$lib/stores/schema';
	import { devInfoStore } from '$lib/stores/devInfo';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte';
	import { normalizeInstanceId } from '$lib/database-target';
	import { databaseDocs } from '$lib/docs-links';
	import {
		getRecentInstances,
		rememberRecentInstance,
		type InstanceDiscoveryItem,
		type InstanceDiscoveryMeta,
	} from '$lib/instance-discovery';

	type TableTab = 'records' | 'query' | 'schema' | 'rules' | 'sdk';
	type NamespaceInstancesResponse = {
		discovery?: InstanceDiscoveryMeta;
		items?: InstanceDiscoveryItem[];
	};
	type NeonProjectItem = {
		projectId: string;
		projectName: string;
		orgId: string;
		orgName: string;
	};
	type UpgradeStepState = 'done' | 'active' | 'pending';
	type TableSqlTabModule = typeof import('$lib/components/database/TableSqlTab.svelte');

	let tableName = $derived($page.params.table ?? '');
	let tableDef = $derived(($schemaStore.schema[tableName] as TableDef | undefined) ?? undefined);
	let namespace = $derived(tableDef?.namespace ?? '');
	let provider = $derived(tableDef?.provider ?? 'do');
	let dynamic = $derived(Boolean(tableDef?.dynamic));
	let instanceDiscovery = $derived(tableDef?.instanceDiscovery);
	let selectedInstanceId = $derived(normalizeInstanceId($page.url.searchParams.get('instance')));
	let activeTab = $derived.by<TableTab>(() => {
		const requested = $page.url.searchParams.get('tab');
		if (!tableDef) {
			return requested === 'query' || requested === 'sql' ? 'query' : 'schema';
		}
		if (requested === 'sql') {
			return 'query';
		}
		if (
			requested === 'records' ||
			requested === 'query' ||
			requested === 'schema' ||
			requested === 'rules' ||
			requested === 'sdk'
		) {
			return requested;
		}
		return dynamic && !selectedInstanceId ? 'schema' : 'records';
	});
	let instanceInput = $state('');
	let instanceSuggestionsLoading = $state(false);
	let instanceSuggestionsError = $state('');
	let discoveredInstances = $state<InstanceDiscoveryItem[]>([]);
	let recentInstances = $state<InstanceDiscoveryItem[]>([]);
	let upgradeModalOpen = $state(false);
	let upgradeEnvKey = $state('');
	let customizeUpgradeEnvKey = $state(false);
	let upgradeAction = $state<'reuse' | 'create' | null>(null);
	let upgradeProgressStep = $state(0);
	let newNeonProjectName = $state('');
	let neonProjects = $state<NeonProjectItem[]>([]);
	let neonProjectsLoading = $state(false);
	let neonProjectsLoaded = $state(false);
	let neonProjectsError = $state('');
	let selectedNeonProjectId = $state('');
	let tableSqlTabModulePromise = $state<Promise<TableSqlTabModule> | null>(null);
	let isDevMode = $derived($devInfoStore.devMode);

	$effect(() => {
		instanceInput = selectedInstanceId ?? '';
	});

	$effect(() => {
		if (typeof window === 'undefined' || !dynamic || !namespace) {
			recentInstances = [];
			return;
		}
		recentInstances = getRecentInstances(namespace);
	});

	$effect(() => {
		if (!dynamic || !namespace) {
			instanceSuggestionsLoading = false;
			instanceSuggestionsError = '';
			discoveredInstances = [];
			return;
		}

		if (instanceDiscovery?.source === 'manual') {
			instanceSuggestionsLoading = false;
			instanceSuggestionsError = '';
			discoveredInstances = [];
			return;
		}

		const search = instanceInput.trim();
		let cancelled = false;
		const delayMs = search ? 160 : 0;
		instanceSuggestionsLoading = true;
		instanceSuggestionsError = '';

		const timer = window.setTimeout(async () => {
			try {
				const params = new URLSearchParams({ limit: '8' });
				if (search) params.set('q', search);
				const result = await api.fetch<NamespaceInstancesResponse>(
					`data/namespaces/${encodeURIComponent(namespace)}/instances?${params.toString()}`,
				);
				if (cancelled) return;
				discoveredInstances = result.items ?? [];
				instanceSuggestionsError = '';
			} catch (err) {
				if (cancelled) return;
				discoveredInstances = [];
				instanceSuggestionsError = err instanceof Error ? err.message : 'Failed to load instance suggestions';
			} finally {
				if (!cancelled) instanceSuggestionsLoading = false;
			}
		}, delayMs);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	});

	function providerLabel(value: TableDef['provider']): string {
		if (value === 'postgres' || value === 'neon') return 'PG';
		if (value === 'd1') return 'D1';
		return 'DO';
	}

	function defaultPostgresEnvKey(namespaceName: string): string {
		const normalized = namespaceName.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
		return normalized ? `DB_POSTGRES_${normalized}_URL` : 'DB_POSTGRES_SHARED_URL';
	}

	function defaultNeonProjectName(namespaceName: string): string {
		const normalized = namespaceName
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.replace(/-{2,}/g, '-');
		return normalized || 'edgebase-db';
	}

	$effect(() => {
		if (!namespace) return;
		if ((!upgradeModalOpen || !upgradeEnvKey.trim()) && !customizeUpgradeEnvKey) {
			upgradeEnvKey = defaultPostgresEnvKey(namespace);
		}
	});

	$effect(() => {
		if (canUpgradeFromD1() && !neonProjectsLoaded && !neonProjectsLoading) {
			void loadNeonProjects();
		}
	});

	function ensureTableSqlTabLoaded(): Promise<TableSqlTabModule> {
		tableSqlTabModulePromise ??= import('$lib/components/database/TableSqlTab.svelte');
		return tableSqlTabModulePromise;
	}

	$effect(() => {
		if (activeTab === 'query') {
			void ensureTableSqlTabLoaded();
		}
	});

	function topologyLabel(isDynamic: boolean): string {
		return isDynamic ? 'Per-tenant DB' : 'Single DB';
	}

	function effectiveUpgradeEnvKey(): string {
		return customizeUpgradeEnvKey
			? upgradeEnvKey.trim() || defaultPostgresEnvKey(namespace)
			: defaultPostgresEnvKey(namespace);
	}

	function effectiveNewNeonProjectName(): string {
		return newNeonProjectName.trim() || defaultNeonProjectName(namespace);
	}

	function canUpgradeFromD1(): boolean {
		return isDevMode && canMigrateFromD1();
	}

	function canMigrateFromD1(): boolean {
		return !dynamic && provider === 'd1';
	}

	function upgradeBlockedReason(): string {
		if (!canMigrateFromD1()) return '';
		if (!isDevMode) {
			return 'Database block upgrades require dev mode with the schema sidecar. Start `pnpm dev` to enable Neon/Postgres migration.';
		}
		return '';
	}

	function toggleCustomizeUpgradeEnvKey() {
		customizeUpgradeEnvKey = !customizeUpgradeEnvKey;
		if (customizeUpgradeEnvKey && !upgradeEnvKey.trim()) {
			upgradeEnvKey = defaultPostgresEnvKey(namespace);
		}
	}

	$effect(() => {
		if (!namespace) return;
		if (!newNeonProjectName.trim()) {
			newNeonProjectName = defaultNeonProjectName(namespace);
		}
	});

	$effect(() => {
		if (!upgradeAction || typeof window === 'undefined') {
			upgradeProgressStep = 0;
			return;
		}

		upgradeProgressStep = 0;
		const timers = [
			window.setTimeout(() => (upgradeProgressStep = 1), 1200),
			window.setTimeout(() => (upgradeProgressStep = 2), 4200),
			window.setTimeout(() => (upgradeProgressStep = 3), 8200),
		];

		return () => {
			for (const timer of timers) window.clearTimeout(timer);
		};
	});

	async function loadNeonProjects(force = false) {
		if (!force && (neonProjectsLoaded || neonProjectsLoading)) return;

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
			neonProjectsError = err instanceof Error ? err.message : 'Failed to load Neon projects.';
		} finally {
			neonProjectsLoading = false;
		}
	}

	function targetLabel(meta?: InstanceDiscoveryMeta): string {
		const value = meta?.targetLabel?.trim();
		return value || 'Target';
	}

	function targetTitle(meta?: InstanceDiscoveryMeta): string {
		return `Choose ${targetLabel(meta)}`;
	}

	function targetInputLabel(meta?: InstanceDiscoveryMeta): string {
		return `${targetLabel(meta)} ID`;
	}

	function targetPlaceholder(meta?: InstanceDiscoveryMeta): string {
		return `Paste ${targetLabel(meta).toLowerCase()} ID`;
	}

	function primaryActionLabel(meta?: InstanceDiscoveryMeta): string {
		return targetLabel(meta) === 'Target' ? 'Apply' : 'Open';
	}

	function targetDescription(meta?: InstanceDiscoveryMeta): string {
		const helperText = meta?.helperText;
		if (helperText) return helperText;
		const label = targetLabel(meta).toLowerCase();
		return `Pick a ${label} to view this table's records or run queries.`;
	}

	function emptyStateHeading(meta?: InstanceDiscoveryMeta): string {
		return `${targetTitle(meta)} First`;
	}

	function emptyStateDescription(meta: InstanceDiscoveryMeta | undefined, action: 'records' | 'query'): string {
		const subject = targetLabel(meta).toLowerCase();
		if (action === 'records') {
			return `Select a ${subject} above to view records for this table.`;
		}
		return `Select a ${subject} above to run queries for this table.`;
	}

	function recentLabel(meta?: InstanceDiscoveryMeta): string {
		const label = targetLabel(meta);
		return label === 'Target' ? 'Recent' : `Recent ${label}s`;
	}

	function suggestedLabel(meta?: InstanceDiscoveryMeta): string {
		const label = targetLabel(meta);
		return label === 'Target' ? 'Suggestions' : `Suggested ${label}s`;
	}

	async function updateSearchParams(mutator: (params: URLSearchParams) => void) {
		const url = new URL($page.url);
		mutator(url.searchParams);
		await goto(`${url.pathname}${url.search}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true,
		});
	}

	function setTab(tab: TableTab) {
		if (tab === 'query') {
			void ensureTableSqlTabLoaded();
		}
		void updateSearchParams((params) => {
			if (tab === 'records') {
				params.delete('tab');
			} else {
				params.set('tab', tab);
			}
		});
	}

	function getKnownInstance(id: string): InstanceDiscoveryItem | undefined {
		return (
			discoveredInstances.find((item) => item.id === id) ??
			recentInstances.find((item) => item.id === id)
		);
	}

	function persistRecentInstance(item: InstanceDiscoveryItem): void {
		if (typeof window === 'undefined' || !namespace) return;
		rememberRecentInstance(namespace, item);
		recentInstances = getRecentInstances(namespace);
	}

	function applyInstance(item?: InstanceDiscoveryItem) {
		const nextInstanceId = normalizeInstanceId(item?.id ?? instanceInput);
		void updateSearchParams((params) => {
			if (nextInstanceId) {
				const nextItem = item ?? getKnownInstance(nextInstanceId) ?? { id: nextInstanceId };
				persistRecentInstance(nextItem);
				params.set('instance', nextInstanceId);
				if (dynamic && activeTab === 'schema') {
					params.delete('tab');
				}
			} else {
				params.delete('instance');
				if (dynamic && activeTab === 'records') {
					params.set('tab', 'schema');
				}
			}
		});
	}

	function clearInstance() {
		instanceInput = '';
		applyInstance();
	}

	function chooseInstance(item: InstanceDiscoveryItem) {
		instanceInput = item.id;
		applyInstance(item);
	}

	async function handleUpgradeToNeon(mode: 'reuse' | 'create') {
		if (!namespace) return;
		if (mode === 'reuse' && !selectedNeonProjectId) {
			toastError(neonProjectsError || 'Choose an existing Neon project first, or create a new one.');
			return;
		}
		if (mode === 'create' && !effectiveNewNeonProjectName()) {
			toastError('Neon project name is required.');
			return;
		}
		upgradeAction = mode;
		try {
			await api.schemaMutation('integrations/neon/upgrade', {
				method: 'POST',
				body: {
					namespace,
					projectId: mode === 'reuse' ? selectedNeonProjectId : undefined,
					projectName: mode === 'create' ? effectiveNewNeonProjectName() : undefined,
					mode,
					...(customizeUpgradeEnvKey ? { envKey: effectiveUpgradeEnvKey() } : {}),
				},
			});
			await schemaStore.loadSchema({ silent: true });
			upgradeModalOpen = false;
			toastSuccess(`"${namespace}" upgraded from D1 to Postgres`);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to upgrade database block.';
			toastError(message);
		} finally {
			upgradeAction = null;
		}
	}

	function canConnectExistingNeon(): boolean {
		return !neonProjectsLoading && neonProjects.length > 0 && Boolean(selectedNeonProjectId);
	}

	function upgradeStatusTitle(): string {
		if (upgradeAction === 'reuse') return 'Migrating Database Block to Postgres';
		if (upgradeAction === 'create') return 'Creating Neon Project and Migrating Database Block';
		return 'Database Block Migration';
	}

	function upgradeStepState(index: number): UpgradeStepState {
		if (index < upgradeProgressStep) return 'done';
		if (index === upgradeProgressStep) return 'active';
		return 'pending';
	}

	function upgradeSteps(): Array<{ label: string; state: UpgradeStepState }> {
		return [
			{
				label: `Export every table in the "${namespace}" database block from D1`,
				state: upgradeStepState(0),
			},
			{
				label: upgradeAction === 'create'
					? `Create the Neon project "${effectiveNewNeonProjectName()}" and write the Postgres env key`
					: 'Connect the selected Neon project and write the Postgres env key',
				state: upgradeStepState(1),
			},
			{
				label: 'Restart the dev worker on Postgres',
				state: upgradeStepState(2),
			},
			{
				label: `Restore all rows back into the "${namespace}" database block`,
				state: upgradeStepState(3),
			},
		];
	}

	function currentUpgradeStepLabel(): string {
		return upgradeSteps()[upgradeProgressStep]?.label ?? 'Preparing migration...';
	}

	let suggestedInstances = $derived.by<InstanceDiscoveryItem[]>(() => {
		const recentIds = new Set(recentInstances.map((item) => item.id));
		return discoveredInstances.filter((item) => !recentIds.has(item.id));
	});

	const tabs = [
		{ id: 'records', label: 'Records' },
		{ id: 'query', label: 'Query' },
		{ id: 'schema', label: 'Schema' },
		{ id: 'rules', label: 'Rules' },
		{ id: 'sdk', label: 'SDK' },
	] as const;
</script>

<div class="table-detail">
	<div class="table-header">
		<div class="table-header__meta">
			<h2 class="table-title">{tableName}</h2>
			<div class="table-badges">
				<span class="table-badge">{namespace}</span>
				<span class="table-badge">{providerLabel(provider)}</span>
				<span class="table-badge" class:table-badge--dynamic={dynamic}>
					{topologyLabel(dynamic)}
				</span>
			</div>
		</div>
		<div class="table-header__actions">
			{#if canUpgradeFromD1()}
				<Button variant="secondary" size="sm" onclick={() => (upgradeModalOpen = true)}>
					Upgrade to Postgres
				</Button>
			{:else if canMigrateFromD1()}
				<span title={upgradeBlockedReason()}>
					<Button variant="secondary" size="sm" disabled>
						Upgrade to Postgres
					</Button>
				</span>
			{/if}
			<a href="{base}/database/erd" class="erd-link" title="View ERD Diagram">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<rect x="1" y="2" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
					<rect x="10" y="10" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/>
					<path d="M6 4H8.5V12H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
				ERD
			</a>
			<a href={databaseDocs} class="erd-link" target="_blank" rel="noreferrer" title="Open database docs">
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
					<path d="M3 2H10L13 5V14H3V2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
					<path d="M10 2V5H13" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
					<path d="M6 8H10M6 10.5H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				Docs
			</a>
			{#if upgradeBlockedReason()}
				<div class="table-header__hint">
					Start <code>pnpm dev</code> to enable DB block upgrades.
				</div>
			{/if}
		</div>
	</div>

	<Modal bind:open={upgradeModalOpen} title="Migrate Database Block to Postgres" maxWidth="560px">
		<div class="upgrade-modal">
			<p class="upgrade-modal__text">
				This migrates the entire <strong>{namespace}</strong> database block from D1 to Postgres. The current table is just the entry point. Every table in this block is exported, the dev worker restarts on Postgres, and then the full block is restored.
			</p>
			<div class="upgrade-modal__notice">
				<div class="upgrade-modal__notice-title">What happens during this migration</div>
				<ol class="upgrade-modal__steps">
					<li>Export all tables from the current D1-backed database block.</li>
					<li>Connect an existing Neon project or create a new one.</li>
					<li>Restart the dev worker with `provider: 'postgres'`.</li>
					<li>Restore every table in the database block into Postgres.</li>
				</ol>
			</div>
			<div class="upgrade-modal__field">
				<label class="upgrade-modal__label" for="upgrade-env-key-display">Automatic Postgres Env Key</label>
				<div id="upgrade-env-key-display" class="upgrade-modal__static">
					<code>{effectiveUpgradeEnvKey()}</code>
				</div>
				<p class="upgrade-modal__hint">
					EdgeBase will write this key during migration. Only override it if you already use a specific Postgres env key name.
				</p>
				<div class="upgrade-modal__actions-row">
					<Button variant="ghost" onclick={toggleCustomizeUpgradeEnvKey} disabled={upgradeAction !== null}>
						{customizeUpgradeEnvKey ? 'Hide Env Key Override' : 'Customize Env Key'}
					</Button>
				</div>
				{#if customizeUpgradeEnvKey}
					<input
						id="upgrade-env-key"
						class="upgrade-modal__input"
						bind:value={upgradeEnvKey}
						placeholder={defaultPostgresEnvKey(namespace)}
					/>
					<p class="upgrade-modal__hint">
						Only change this if you already use a specific Postgres env key name.
					</p>
				{/if}
			</div>
			<div class="upgrade-modal__choices">
				<div class="upgrade-modal__choices-copy">
					<div class="upgrade-modal__notice-title">Neon Setup</div>
					<p class="upgrade-modal__hint">
						Both options migrate the same database block and use the env key above. Pick the path that matches whether the Neon project already exists.
					</p>
				</div>

				<div class="upgrade-modal__choice-grid">
					<section class="upgrade-modal__choice-card">
						<div class="upgrade-modal__choice-header">
							<div class="upgrade-modal__choice-eyebrow">Existing project</div>
							<h3 class="upgrade-modal__choice-title">1. Connect an existing Neon project</h3>
							<p class="upgrade-modal__hint">Best when the Neon project already exists in your account.</p>
						</div>
						<label class="upgrade-modal__label" for="upgrade-neon-project">Existing Neon Project</label>
						<select
							id="upgrade-neon-project"
							class="upgrade-modal__select"
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
						<div class="upgrade-modal__actions-row">
							<Button variant="ghost" onclick={() => loadNeonProjects(true)} loading={neonProjectsLoading}>
								Refresh Projects
							</Button>
						</div>
						{#if neonProjectsError}
							<p class="upgrade-modal__hint upgrade-modal__hint--error">{neonProjectsError}</p>
						{:else if !neonProjectsLoading && neonProjects.length === 0}
							<p class="upgrade-modal__hint">No existing Neon projects were found.</p>
						{:else if !neonProjectsLoading}
							<p class="upgrade-modal__hint">
								EdgeBase will use the selected project, restart on Postgres, and restore every table in this block.
							</p>
						{/if}
						<div class="upgrade-modal__actions-row upgrade-modal__choice-actions">
							<Button
								variant="secondary"
								disabled={!canConnectExistingNeon() || upgradeAction !== null}
								onclick={() => handleUpgradeToNeon('reuse')}
							>
								{upgradeAction === 'reuse' ? 'Connecting Existing Neon...' : 'Connect Existing Neon'}
							</Button>
						</div>
					</section>

					<section class="upgrade-modal__choice-card">
						<div class="upgrade-modal__choice-header">
							<div class="upgrade-modal__choice-eyebrow">Provision new project</div>
							<h3 class="upgrade-modal__choice-title">2. Create a new Neon project</h3>
							<p class="upgrade-modal__hint">Best when you want EdgeBase to provision Neon before migrating.</p>
						</div>
						<label class="upgrade-modal__label" for="upgrade-project-name">New Neon Project Name</label>
						<input
							id="upgrade-project-name"
							class="upgrade-modal__input"
							bind:value={newNeonProjectName}
							placeholder={defaultNeonProjectName(namespace)}
							disabled={upgradeAction !== null}
						/>
						<p class="upgrade-modal__hint">
							EdgeBase will try this name first, then append a suffix if Neon already has one.
						</p>
						<div class="upgrade-modal__actions-row upgrade-modal__choice-actions">
							<Button variant="primary" disabled={upgradeAction !== null} onclick={() => handleUpgradeToNeon('create')}>
								{upgradeAction === 'create' ? 'Creating Neon Project...' : 'Create New Neon Project'}
							</Button>
						</div>
					</section>
				</div>
			</div>
			{#if upgradeAction}
				<div class="upgrade-modal__status" role="status" aria-live="polite">
					<div class="upgrade-modal__status-title">{upgradeStatusTitle()}</div>
					<p class="upgrade-modal__status-copy">
						EdgeBase is migrating the full <strong>{namespace}</strong> database block. This can take a while because every table is exported, the worker restarts on Postgres, and then the block is restored.
					</p>
					<div class="upgrade-modal__status-current">Current step: {currentUpgradeStepLabel()}</div>
					<ol class="upgrade-modal__steps upgrade-modal__steps--status">
						{#each upgradeSteps() as step}
							<li class={`upgrade-modal__step upgrade-modal__step--${step.state}`}>{step.label}</li>
						{/each}
					</ol>
				</div>
			{/if}
		</div>

		{#snippet footer()}
			<Button variant="secondary" disabled={upgradeAction !== null} onclick={() => (upgradeModalOpen = false)}>Cancel</Button>
		{/snippet}
	</Modal>

	{#if dynamic}
		<div class="target-bar">
			<div class="target-bar__copy">
				<div class="target-bar__title">{targetTitle(instanceDiscovery)}</div>
				<div class="target-bar__description">{targetDescription(instanceDiscovery)}</div>
			</div>
			<div class="target-bar__controls">
				<div class="target-bar__field">
					<label class="target-bar__field-label" for="database-target-input">
						{targetInputLabel(instanceDiscovery)}
					</label>
					<input
						id="database-target-input"
						class="target-bar__input"
						type="text"
						aria-label={targetInputLabel(instanceDiscovery)}
						placeholder={instanceDiscovery?.placeholder ?? targetPlaceholder(instanceDiscovery)}
						bind:value={instanceInput}
						maxlength="128"
						onkeydown={(event) => {
							if (event.key === 'Enter') applyInstance();
						}}
					/>
				</div>
				<button class="target-bar__button target-bar__button--primary" onclick={() => applyInstance()}>
					{primaryActionLabel(instanceDiscovery)}
				</button>
				{#if selectedInstanceId}
					<button class="target-bar__button" onclick={clearInstance}>Clear</button>
				{/if}
			</div>
			{#if recentInstances.length > 0 || suggestedInstances.length > 0 || instanceSuggestionsLoading || instanceSuggestionsError}
				<div class="target-bar__suggestions">
					{#if recentInstances.length > 0}
						<div class="target-bar__section">
							<div class="target-bar__section-label">{recentLabel(instanceDiscovery)}</div>
							<div class="target-bar__chip-row">
								{#each recentInstances as item (item.id)}
									<button class="target-chip" type="button" onclick={() => chooseInstance(item)}>
										<span class="target-chip__label">{item.label ?? item.id}</span>
										{#if item.label}
											<span class="target-chip__meta">{item.id}</span>
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					{#if suggestedInstances.length > 0}
						<div class="target-bar__section">
							<div class="target-bar__section-label">{suggestedLabel(instanceDiscovery)}</div>
							<div class="target-bar__chip-row">
								{#each suggestedInstances as item (item.id)}
									<button class="target-chip" type="button" onclick={() => chooseInstance(item)}>
										<span class="target-chip__label">{item.label ?? item.id}</span>
										{#if item.label || item.description}
											<span class="target-chip__meta">
												{item.description ?? item.id}
											</span>
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/if}

					{#if instanceSuggestionsLoading}
						<div class="target-bar__status">Loading instance suggestions...</div>
					{:else if instanceSuggestionsError}
						<div class="target-bar__status target-bar__status--error">{instanceSuggestionsError}</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<div class="tab-bar">
		{#each tabs as tab}
			<button
				class="tab-btn"
				class:tab-btn--active={activeTab === tab.id}
				onclick={() => setTab(tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<div class="tab-content">
		{#if activeTab === 'records'}
			{#if dynamic && !selectedInstanceId}
				<div class="target-empty">
					<h3>{emptyStateHeading(instanceDiscovery)}</h3>
					<p>{emptyStateDescription(instanceDiscovery, 'records')}</p>
				</div>
			{:else}
				<RecordsTab
					{tableName}
					instanceId={selectedInstanceId}
				/>
			{/if}
		{:else if activeTab === 'query'}
			{#if dynamic && !selectedInstanceId}
				<div class="target-empty">
					<h3>{emptyStateHeading(instanceDiscovery)}</h3>
					<p>{emptyStateDescription(instanceDiscovery, 'query')}</p>
				</div>
			{:else}
				{#await ensureTableSqlTabLoaded()}
					<div class="tab-loading">Loading query tools...</div>
				{:then module}
					{@const TableSqlTab = module.default}
					<TableSqlTab
						{tableName}
						{namespace}
						instanceId={selectedInstanceId}
					/>
				{:catch err}
					<div class="target-empty">
						<h3>Query tools unavailable</h3>
						<p>{err instanceof Error ? err.message : 'Failed to load query tools.'}</p>
					</div>
				{/await}
			{/if}
		{:else if activeTab === 'schema'}
			<SchemaTab {tableName} />
		{:else if activeTab === 'rules'}
			<RulesTab {tableName} />
		{:else if activeTab === 'sdk'}
			<SdkSnippets {tableName} />
		{/if}
	</div>
</div>

<style>
	.table-detail {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.table-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}

	.table-header__meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.table-header__actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.table-header__hint {
		width: 100%;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-text-secondary);
		text-align: right;
	}

	.table-header__hint code {
		font-family: var(--font-mono);
		padding: 1px 6px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
	}

	.table-title {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		font-family: var(--font-mono);
		color: var(--color-text);
	}

	.table-badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.table-badge {
		display: inline-flex;
		align-items: center;
		padding: 4px 8px;
		border-radius: 999px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		font-size: 11px;
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.table-badge--dynamic {
		color: var(--color-primary);
		border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
	}

	.erd-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-3);
		font-size: 12px;
		color: var(--color-text-secondary);
		text-decoration: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition: background-color 0.1s, color 0.1s;
	}

	.erd-link:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.upgrade-modal {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.upgrade-modal__text {
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.upgrade-modal__field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.upgrade-modal__choices {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.upgrade-modal__choices-copy {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.upgrade-modal__choice-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-3);
	}

	.upgrade-modal__choice-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		height: 100%;
		padding: var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
	}

	.upgrade-modal__choice-eyebrow {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.upgrade-modal__choice-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.upgrade-modal__choice-title {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text);
	}

	.upgrade-modal__notice,
	.upgrade-modal__status {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.upgrade-modal__notice-title,
	.upgrade-modal__status-title {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text);
	}

	.upgrade-modal__status {
		border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
		background: color-mix(in srgb, var(--color-primary) 8%, var(--color-bg-secondary));
	}

	.upgrade-modal__status-copy {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.upgrade-modal__status-current {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text);
	}

	.upgrade-modal__steps {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.upgrade-modal__step--active {
		color: var(--color-text);
		font-weight: 600;
	}

	.upgrade-modal__step--done {
		color: var(--color-success);
	}

	.upgrade-modal__label {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text);
	}

	.upgrade-modal__input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-family: var(--font-mono);
		box-sizing: border-box;
	}

	.upgrade-modal__static {
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

	.upgrade-modal__static code {
		font-family: var(--font-mono, 'SFMono-Regular', monospace);
		font-size: 0.8125rem;
	}

	.upgrade-modal__select {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		box-sizing: border-box;
	}

	.upgrade-modal__actions-row {
		display: flex;
		justify-content: flex-start;
	}

	.upgrade-modal__choice-actions {
		margin-top: auto;
	}

	.upgrade-modal__hint {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-tertiary);
	}

	.upgrade-modal__hint--error {
		color: var(--color-danger);
	}

	.target-bar {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-4);
		margin-bottom: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: linear-gradient(180deg, var(--color-bg-secondary), var(--color-bg));
	}

	.target-bar__copy {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.target-bar__title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.target-bar__description {
		font-size: 12px;
		color: var(--color-text-secondary);
		max-width: 520px;
	}

	.target-bar__controls {
		display: flex;
		align-items: flex-end;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.target-bar__field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: min(280px, 100%);
	}

	.target-bar__field-label {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.target-bar__input {
		width: min(280px, 100%);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		font-family: var(--font-mono);
	}

	.target-bar__button {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}

	.target-bar__button--primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: white;
	}

	.target-bar__suggestions {
		flex: 1 0 100%;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid color-mix(in srgb, var(--color-border) 75%, transparent);
	}

	.target-bar__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.target-bar__section-label {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.target-bar__chip-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.target-chip {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
		text-align: left;
	}

	.target-chip:hover {
		border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
		background: var(--color-bg-secondary);
	}

	.target-chip__label {
		font-size: 13px;
		font-weight: 600;
	}

	.target-chip__meta {
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.target-bar__status {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.target-bar__status--error {
		color: var(--color-danger);
	}

	.tab-bar {
		display: flex;
		gap: 0;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: var(--space-4);
		overflow-x: auto;
		overflow-y: hidden;
	}

	.tab-btn {
		padding: var(--space-2) var(--space-4);
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-secondary);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		transition: color 0.1s, border-color 0.1s;
		margin-bottom: -1px;
		white-space: nowrap;
	}

	.tab-btn:hover {
		color: var(--color-text);
	}

	.tab-btn.tab-btn--active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.tab-content {
		flex: 1;
	}

	.tab-loading {
		padding: var(--space-5);
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.target-empty {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-5);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-secondary);
	}

	.target-empty h3 {
		margin: 0;
		font-size: 16px;
		color: var(--color-text);
	}

	.target-empty p {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	@media (max-width: 900px) {
		.table-header,
		.target-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.target-bar__controls {
			width: 100%;
			align-items: stretch;
		}

		.target-bar__field,
		.target-bar__input {
			flex: 1;
			width: 100%;
		}
	}
</style>
