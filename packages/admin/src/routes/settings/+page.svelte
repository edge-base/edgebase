<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import { downloadBlob } from '$lib/download';
	import { devInfoStore } from '$lib/stores/devInfo';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';

	// ── State ────────────────────────────────────────
	let loading = $state(true);
	let config = $state<{
		devMode: boolean;
		release: boolean;
		databases: Array<{ name: string; tableCount: number; hasAccess: boolean }>;
		storageBuckets: string[];
		serviceKeyCount: number;
		serviceKeys?: string[];
		bindings: { kv: string[]; d1: string[]; vectorize: string[] };
		auth: { providers: string[]; anonymousAuth: boolean };
		rateLimiting: Array<{
			group: string;
			requests: number;
			window: string;
			binding: {
				enabled: boolean;
				limit?: number;
				period?: number;
				source: 'default' | 'override' | 'disabled' | 'custom';
			} | null;
		}>;
	} | null>(null);

	function formatRequests(requests: number, window: string) {
		return `${requests.toLocaleString()} / ${window}`;
	}

	function formatBinding(binding: {
		enabled: boolean;
		limit?: number;
		period?: number;
		source: 'default' | 'override' | 'disabled' | 'custom';
	} | null) {
		if (!binding) return 'No binding';
		if (!binding.enabled) return 'Binding disabled';
		if (binding.limit == null || binding.period == null) return 'Binding configured';
		const label = `${binding.limit.toLocaleString()} / ${binding.period}s`;
		if (binding.source === 'override' || binding.source === 'custom') return `Binding ${label}`;
		return `Binding ${label} (default)`;
	}

	function formatBindingNames(names: string[]) {
		return names.length > 0 ? names.join(', ') : 'None configured';
	}

	function getBindingBadgeVariant(binding: {
		enabled: boolean;
		limit?: number;
		period?: number;
		source: 'default' | 'override' | 'disabled' | 'custom';
	} | null): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
		if (!binding) return 'default';
		if (!binding.enabled) return 'danger';
		if (binding.source === 'override') return 'primary';
		if (binding.source === 'custom') return 'warning';
		return 'default';
	}

	function getBindingBadgeText(binding: {
		enabled: boolean;
		limit?: number;
		period?: number;
		source: 'default' | 'override' | 'disabled' | 'custom';
	} | null) {
		if (!binding) return 'Soft only';
		if (!binding.enabled) return 'Binding off';
		if (binding.source === 'override') return 'Binding override';
		if (binding.source === 'custom') return 'Custom group';
		return 'Default binding';
	}

	async function copyKey(maskedKey: string) {
		try {
			await navigator.clipboard.writeText(maskedKey);
			toastSuccess('Copied to clipboard (masked)');
		} catch {
			toastError('Failed to copy');
		}
	}

	onMount(async () => {
		try {
			config = await api.fetch('data/config-info');
		} catch {
			config = null;
		} finally {
			loading = false;
		}
		fetchAdmins();
	});

	// ── Admin Management ────────────────────────────
	interface AdminAccount {
		id: string;
		email: string;
		createdAt: string;
		updatedAt: string;
	}

	let admins = $state<AdminAccount[]>([]);
	let adminsLoading = $state(true);
	let showAddAdmin = $state(false);
	let newAdminEmail = $state('');
	let newAdminPassword = $state('');
	let addingAdmin = $state(false);
	let deleteTarget = $state<AdminAccount | null>(null);
	let passwordTarget = $state<AdminAccount | null>(null);
	let newPassword = $state('');
	let changingPassword = $state(false);

	async function fetchAdmins() {
		try {
			const res = await api.fetch<{ admins: AdminAccount[] }>('data/admins');
			admins = res.admins;
		} catch {
			admins = [];
		} finally {
			adminsLoading = false;
		}
	}

	async function addAdmin() {
		if (!newAdminEmail.trim() || !newAdminPassword.trim()) return;
		addingAdmin = true;
		try {
			await api.fetch('data/admins', {
				method: 'POST',
				body: { email: newAdminEmail, password: newAdminPassword },
			});
			toastSuccess('Admin account created');
			showAddAdmin = false;
			newAdminEmail = '';
			newAdminPassword = '';
			await fetchAdmins();
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to create admin');
		} finally {
			addingAdmin = false;
		}
	}

	async function confirmDeleteAdmin() {
		if (!deleteTarget) return;
		const target = deleteTarget;
		deleteTarget = null;
		try {
			await api.fetch(`data/admins/${target.id}`, { method: 'DELETE' });
			toastSuccess('Admin account deleted');
			await fetchAdmins();
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to delete admin');
		}
	}

	async function changePassword() {
		if (!passwordTarget || !newPassword.trim()) return;
		changingPassword = true;
		try {
			await api.fetch(`data/admins/${passwordTarget.id}/password`, {
				method: 'PUT',
				body: { password: newPassword },
			});
			toastSuccess('Password updated');
			passwordTarget = null;
			newPassword = '';
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to change password');
		} finally {
			changingPassword = false;
		}
	}

	async function downloadConfig() {
		try {
			const snapshot = await api.fetch<Record<string, unknown>>('data/backup/config');
			const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
			downloadBlob(blob, `edgebase-config-snapshot-${new Date().toISOString().slice(0, 10)}.json`);
			toastSuccess('Config snapshot downloaded');
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to download config');
		}
	}

	// ── Delete App (Self-Destruct) ────────────────────
	let showDeleteStep1 = $state(false);
	let showDeleteStep2 = $state(false);
	let deleteConfirmText = $state('');
	let destroying = $state(false);
	let destroyResult = $state<{
		success: boolean;
		deleted: string[];
		failed: Array<{ resource: string; error: string }>;
		message: string;
	} | null>(null);

	function beginDeleteApp() {
		showDeleteStep1 = true;
	}

	function proceedToStep2() {
		showDeleteStep1 = false;
		showDeleteStep2 = true;
		deleteConfirmText = '';
	}

	function cancelDelete() {
		showDeleteStep1 = false;
		showDeleteStep2 = false;
		deleteConfirmText = '';
	}

	async function executeDestroyApp() {
		destroying = true;
		try {
			const result = await api.fetch<{
				success: boolean;
				deleted: string[];
				failed: Array<{ resource: string; error: string }>;
				message: string;
			}>('data/destroy-app', {
				method: 'POST',
				body: { confirm: 'DELETE_ALL_RESOURCES' },
			});
			destroyResult = result;
			showDeleteStep2 = false;
			if (result.success) {
				toastSuccess('All resources destroyed. This app has been deleted.');
			} else {
				toastError(`Partial destruction: ${result.failed.length} resource(s) failed to delete.`);
			}
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to destroy app');
		} finally {
			destroying = false;
			deleteConfirmText = '';
		}
	}
</script>

<PageShell title="Project Info" description="Environment and resource overview with admin account controls">
	{#snippet actions()}
		<Button variant="secondary" size="sm" onclick={downloadConfig}>Download Config Snapshot</Button>
	{/snippet}
	{#if loading}
		<div class="settings-grid">
			{#each Array(5) as _}
				<div class="settings-card">
					<h3 class="settings-card__title"><Skeleton width="120px" height="13px" /></h3>
					<div class="settings-rows">
						{#each Array(3) as __}
							<div class="settings-row">
								<Skeleton width="80px" height="12px" />
								<Skeleton width="100px" height="12px" />
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else if !config}
		<div class="settings-error">Failed to load configuration.</div>
	{:else}
		<div class="settings-grid">
			<!-- Environment -->
			<div class="settings-card">
				<h3 class="settings-card__title">Environment</h3>
				<div class="settings-rows">
					<div class="settings-row">
						<span class="settings-key">Mode</span>
						<Badge variant={config.devMode ? 'warning' : 'success'}>
							{config.devMode ? 'Development' : 'Production'}
						</Badge>
					</div>
					<div class="settings-row">
						<span class="settings-key">Release</span>
						<Badge variant={config.release ? 'success' : 'default'}>
							{config.release ? 'Enabled (deny-by-default)' : 'Disabled (dev permissive)'}
						</Badge>
					</div>
					<div class="settings-row">
						<span class="settings-key">Service Keys</span>
						<span class="settings-value">{config.serviceKeyCount} configured</span>
					</div>
					{#if config.serviceKeys && config.serviceKeys.length > 0}
						{#each config.serviceKeys as key, i}
							<div class="settings-row">
								<span class="settings-key">Key {i + 1}</span>
								<span class="settings-value settings-value--key">
									<code class="key-preview">{key}</code>
									<button class="copy-btn" title="Copy masked key" onclick={() => copyKey(key)}>
										<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11V3h8" stroke-linecap="round" stroke-linejoin="round"/></svg>
									</button>
								</span>
							</div>
						{/each}
					{/if}
				</div>
			</div>

			<!-- Databases -->
			<div class="settings-card">
				<h3 class="settings-card__title">Databases</h3>
				<div class="settings-rows">
					{#each config.databases as db}
						<div class="settings-row">
							<span class="settings-key">{db.name}</span>
							<span class="settings-value">
								{db.tableCount} table{db.tableCount !== 1 ? 's' : ''}
								{#if db.hasAccess}
									<Badge variant="primary">access rule</Badge>
								{/if}
							</span>
						</div>
					{/each}
					{#if config.databases.length === 0}
						<div class="settings-empty">No databases configured</div>
					{/if}
				</div>
			</div>

			<!-- Bindings -->
			<div class="settings-card">
				<h3 class="settings-card__title">Bindings</h3>
				<div class="settings-rows">
					<div class="settings-row">
						<span class="settings-key">KV Namespaces</span>
						<span class="settings-value">{formatBindingNames(config.bindings.kv)}</span>
					</div>
					<div class="settings-row">
						<span class="settings-key">D1 Databases</span>
						<span class="settings-value">{formatBindingNames(config.bindings.d1)}</span>
					</div>
					<div class="settings-row">
						<span class="settings-key">Vectorize Indexes</span>
						<span class="settings-value">{formatBindingNames(config.bindings.vectorize)}</span>
					</div>
				</div>
			</div>

			<!-- Auth -->
			<div class="settings-card">
				<h3 class="settings-card__title">Auth</h3>
				<div class="settings-rows">
					<div class="settings-row">
						<span class="settings-key">Anonymous Auth</span>
						<Badge variant={config.auth.anonymousAuth ? 'success' : 'default'}>
							{config.auth.anonymousAuth ? 'Enabled' : 'Disabled'}
						</Badge>
					</div>
					<div class="settings-row">
						<span class="settings-key">OAuth Providers</span>
						<span class="settings-value">
							{#if config.auth.providers.length > 0}
								{config.auth.providers.join(', ')}
							{:else}
								None configured
							{/if}
						</span>
					</div>
				</div>
			</div>

			<!-- Storage -->
			<div class="settings-card">
				<h3 class="settings-card__title">Storage</h3>
				<div class="settings-rows">
					<div class="settings-row">
						<span class="settings-key">Buckets</span>
						<span class="settings-value">
							{#if config.storageBuckets.length > 0}
								{config.storageBuckets.join(', ')}
							{:else}
								None configured
							{/if}
						</span>
					</div>
				</div>
			</div>

			<!-- Rate Limiting -->
			<div class="settings-card">
				<h3 class="settings-card__title">Rate Limiting</h3>
				<div class="settings-rows">
					{#if config.rateLimiting.length > 0}
						{#each config.rateLimiting as limit}
							<div class="settings-row settings-row--top">
								<span class="settings-key settings-key--stack">
									<code class="settings-code">{limit.group}</code>
									<Badge variant={getBindingBadgeVariant(limit.binding)}>
										{getBindingBadgeText(limit.binding)}
									</Badge>
								</span>
								<span class="settings-value settings-value--stack settings-value--rate">
									<span><span class="settings-inline-label">Soft</span>{formatRequests(limit.requests, limit.window)}</span>
									<span class="settings-subvalue">{formatBinding(limit.binding)}</span>
								</span>
							</div>
						{/each}
					{:else}
						<div class="settings-empty">No rate limit settings found</div>
					{/if}
				</div>
				<div class="settings-note">
					Defined in <code>edgebase.config.ts</code> or <code>config/rate-limits.ts</code>.
				</div>
			</div>

			<!-- Native Resources -->
			<div class="settings-card">
				<h3 class="settings-card__title">Native Resources</h3>
				<div class="settings-rows">
					<div class="settings-row">
						<span class="settings-key">KV Namespaces</span>
						<span class="settings-value">
							{config.bindings.kv.length > 0 ? config.bindings.kv.join(', ') : 'None'}
						</span>
					</div>
					<div class="settings-row">
						<span class="settings-key">D1 Databases</span>
						<span class="settings-value">
							{config.bindings.d1.length > 0 ? config.bindings.d1.join(', ') : 'None'}
						</span>
					</div>
					<div class="settings-row">
						<span class="settings-key">Vectorize Indexes</span>
						<span class="settings-value">
							{config.bindings.vectorize.length > 0 ? config.bindings.vectorize.join(', ') : 'None'}
						</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Admin Accounts -->
		<div class="settings-card settings-card--full">
			<h3 class="settings-card__title">
				Admin Accounts
				<Button variant="primary" size="sm" onclick={() => (showAddAdmin = true)}>+ Add Admin</Button>
			</h3>
			<div class="settings-rows">
				{#if adminsLoading}
					{#each Array(2) as _}
						<div class="settings-row">
							<Skeleton width="150px" height="12px" />
							<Skeleton width="80px" height="12px" />
						</div>
					{/each}
				{:else if admins.length === 0}
					<div class="settings-empty">No admin accounts found</div>
				{:else}
					{#each admins as admin (admin.id)}
						<div class="settings-row">
							<span class="settings-key">{admin.email}</span>
							<span class="settings-value settings-value--actions">
								<span class="settings-date">{new Date(admin.createdAt).toLocaleDateString()}</span>
								<Button variant="secondary" size="sm" onclick={() => { passwordTarget = admin; newPassword = ''; }}>
									Change Password
								</Button>
								<Button
									variant="danger"
									size="sm"
									onclick={() => (deleteTarget = admin)}
									disabled={admins.length <= 1}
								>
									Delete
								</Button>
							</span>
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<!-- Danger Zone (deployed mode only) -->
		{#if !config.devMode}
			<div class="danger-zone">
				<div class="danger-zone__header">
					<h3 class="danger-zone__title">Danger Zone</h3>
				</div>
				{#if destroyResult}
					<div class="danger-zone__result">
						<p class="danger-zone__result-message" class:danger-zone__result-message--success={destroyResult.success}>
							{destroyResult.message}
						</p>
						{#if destroyResult.deleted.length > 0}
							<div class="danger-zone__result-section">
								<strong>Deleted:</strong>
								<ul>
									{#each destroyResult.deleted as item}
										<li>{item}</li>
									{/each}
								</ul>
							</div>
						{/if}
						{#if destroyResult.failed.length > 0}
							<div class="danger-zone__result-section danger-zone__result-section--error">
								<strong>Failed:</strong>
								<ul>
									{#each destroyResult.failed as item}
										<li>{item.resource}: {item.error}</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{:else}
					<div class="danger-zone__content">
						<div class="danger-zone__item">
							<div>
								<p class="danger-zone__item-title">Delete this app</p>
								<p class="danger-zone__item-desc">
									Permanently delete all Cloudflare resources including databases, storage, KV namespaces, and the Worker itself. This action cannot be undone.
								</p>
							</div>
							<Button variant="danger" size="sm" onclick={beginDeleteApp}>
								Delete App
							</Button>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</PageShell>

<!-- Delete App Step 1: Are you sure? -->
{#if showDeleteStep1}
	<ConfirmDialog
		open={true}
		title="Delete App"
		message="This will permanently delete ALL Cloudflare resources (databases, storage, KV, vectorize indexes, and the Worker). This action cannot be undone. Do you want to proceed?"
		confirmLabel="Yes, delete everything"
		confirmVariant="danger"
		onconfirm={proceedToStep2}
		oncancel={cancelDelete}
	/>
{/if}

<!-- Delete App Step 2: Type to confirm -->
{#if showDeleteStep2}
	<Modal open={true} title="Confirm App Deletion" onclose={cancelDelete}>
		<div class="delete-confirm">
			<p class="delete-confirm__warning">
				This is your final confirmation. All data will be permanently lost.
			</p>
			<p class="delete-confirm__instruction">
				Type <strong>DELETE_ALL_RESOURCES</strong> to confirm:
			</p>
			<Input bind:value={deleteConfirmText} placeholder="DELETE_ALL_RESOURCES" />
			<div class="modal-actions">
				<Button variant="secondary" onclick={cancelDelete}>Cancel</Button>
				<Button
					variant="danger"
					loading={destroying}
					disabled={deleteConfirmText !== 'DELETE_ALL_RESOURCES'}
					onclick={executeDestroyApp}
				>
					Permanently Delete App
				</Button>
			</div>
		</div>
	</Modal>
{/if}

<!-- Add Admin Modal -->
{#if showAddAdmin}
	<Modal open={true} title="Add Admin Account" onclose={() => (showAddAdmin = false)}>
		<form onsubmit={(e) => { e.preventDefault(); addAdmin(); }}>
			<div class="modal-fields">
				<Input label="Email" type="email" bind:value={newAdminEmail} />
				<Input label="Password" type="password" bind:value={newAdminPassword} />
			</div>
			<div class="modal-actions">
				<Button variant="secondary" onclick={() => (showAddAdmin = false)}>Cancel</Button>
				<Button variant="primary" type="submit" loading={addingAdmin} disabled={!newAdminEmail.trim() || newAdminPassword.length < 8}>
					Create Admin
				</Button>
			</div>
		</form>
	</Modal>
{/if}

<!-- Change Password Modal -->
{#if passwordTarget}
	<Modal open={true} title="Change Password" onclose={() => (passwordTarget = null)}>
		<form onsubmit={(e) => { e.preventDefault(); changePassword(); }}>
			<p class="modal-info">Changing password for <strong>{passwordTarget.email}</strong></p>
			<div class="modal-fields">
				<Input label="New Password" type="password" bind:value={newPassword} />
			</div>
			<div class="modal-actions">
				<Button variant="secondary" onclick={() => (passwordTarget = null)}>Cancel</Button>
				<Button variant="primary" type="submit" loading={changingPassword} disabled={newPassword.length < 8}>
					Update Password
				</Button>
			</div>
		</form>
	</Modal>
{/if}

<!-- Delete Admin Confirm -->
{#if deleteTarget}
	<ConfirmDialog
		open={true}
		title="Delete Admin Account"
		message="Are you sure you want to delete the admin account {deleteTarget.email}? This cannot be undone."
		confirmLabel="Delete"
		confirmVariant="danger"
		onconfirm={confirmDeleteAdmin}
		oncancel={() => (deleteTarget = null)}
	/>
{/if}

<style>
	.settings-error {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-danger);
	}

	.settings-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: var(--space-4);
	}

	.settings-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.settings-card__title {
		margin: 0;
		padding: var(--space-3) var(--space-4);
		font-size: 13px;
		font-weight: 600;
		background: var(--color-bg-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.settings-rows { display: flex; flex-direction: column; }

	.settings-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		gap: var(--space-2);
	}

	.settings-row:last-child { border-bottom: none; }
	.settings-row--top { align-items: flex-start; }

	.settings-key { font-size: 12px; color: var(--color-text-secondary); font-weight: 500; }
	.settings-key--stack { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
	.settings-value { font-size: 12px; font-family: var(--font-mono); color: var(--color-text); text-align: right; }
	.settings-value--stack { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
	.settings-value--rate { gap: 4px; }
	.settings-subvalue { font-size: 11px; color: var(--color-text-tertiary); }
	.settings-inline-label {
		display: inline-block;
		margin-right: 6px;
		font-size: 10px;
		font-family: var(--font-sans, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-tertiary);
	}
	.settings-code {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--color-text);
		background: var(--color-bg-secondary);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
	}
	.settings-empty { padding: var(--space-3) var(--space-4); color: var(--color-text-tertiary); font-size: 12px; }
	.settings-note {
		padding: var(--space-2) var(--space-4);
		border-top: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		font-size: 11px;
		color: var(--color-text-tertiary);
	}

	.settings-value--key {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.key-preview {
		font-size: 11px;
		color: var(--color-text-secondary);
		background: var(--color-bg-secondary);
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		letter-spacing: 0.02em;
	}

	.copy-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.copy-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border-color: var(--color-border-hover, var(--color-border));
	}

	.settings-card--full {
		grid-column: 1 / -1;
	}

	.settings-card__title {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.settings-value--actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.settings-date {
		font-size: 11px;
		color: var(--color-text-tertiary);
		margin-right: var(--space-2);
	}

	.modal-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.modal-info {
		font-size: 13px;
		color: var(--color-text-secondary);
		margin: 0 0 var(--space-3) 0;
	}

	/* ── Danger Zone ── */
	.danger-zone {
		margin-top: var(--space-6);
		border: 1px solid var(--color-danger, #dc3545);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.danger-zone__header {
		padding: var(--space-3) var(--space-4);
		background: color-mix(in srgb, var(--color-danger, #dc3545) 8%, var(--color-bg-secondary));
		border-bottom: 1px solid var(--color-danger, #dc3545);
	}

	.danger-zone__title {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-danger, #dc3545);
	}

	.danger-zone__content {
		padding: 0;
	}

	.danger-zone__item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		gap: var(--space-4);
	}

	.danger-zone__item-title {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.danger-zone__item-desc {
		margin: var(--space-1) 0 0;
		font-size: 12px;
		color: var(--color-text-secondary);
		line-height: 1.4;
	}

	.danger-zone__result {
		padding: var(--space-4);
	}

	.danger-zone__result-message {
		margin: 0 0 var(--space-3);
		font-size: 13px;
		font-weight: 600;
		color: var(--color-danger, #dc3545);
	}

	.danger-zone__result-message--success {
		color: var(--color-success, #28a745);
	}

	.danger-zone__result-section {
		font-size: 12px;
		color: var(--color-text-secondary);
		margin-bottom: var(--space-2);
	}

	.danger-zone__result-section ul {
		margin: var(--space-1) 0 0;
		padding-left: var(--space-4);
	}

	.danger-zone__result-section li {
		margin-bottom: 2px;
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.danger-zone__result-section--error {
		color: var(--color-danger, #dc3545);
	}

	.delete-confirm {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.delete-confirm__warning {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-danger, #dc3545);
	}

	.delete-confirm__instruction {
		margin: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
	}
</style>
