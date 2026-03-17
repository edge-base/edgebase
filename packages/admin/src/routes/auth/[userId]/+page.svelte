<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

	interface UserProfile {
		id: string;
		profile: Record<string, unknown>;
	}

	interface UserBasic {
		id: string;
		email: string;
		status: string;
		role: string;
		createdAt: string;
		lastSignedInAt: string | null;
	}

	let userId = $derived($page.params.userId ?? '');

	let notFound = $state(false);
	let user = $state<UserBasic | null>(null);
	let profile = $state<Record<string, unknown>>({});

	// Editable fields
	let editStatus = $state('');
	let editRole = $state('');
	let saving = $state(false);
	let revokingOpen = $state(false);
	let revoking = $state(false);
	let deleteOpen = $state(false);
	let deletingUser = $state(false);
	let disableMfaOpen = $state(false);
	let disablingMfa = $state(false);
	let sendingReset = $state(false);

	const statusOptions = [
		{ value: 'active', label: 'Active' },
		{ value: 'suspended', label: 'Suspended' },
		{ value: 'banned', label: 'Banned' },
		{ value: 'disabled', label: 'Disabled' },
	];

	const roleOptions = [
		{ value: 'user', label: 'User' },
		{ value: 'admin', label: 'Admin' },
	];

	let hasChanges = $derived(
		user !== null && (editStatus !== user.status || editRole !== user.role)
	);

	async function loadUser() {
		user = null;
		notFound = false;
		profile = {};

		try {
			const res = await api.fetch<{ user: UserBasic }>(`data/users/${userId}`);
			user = res.user;
			editStatus = res.user.status ?? 'active';
			editRole = res.user.role ?? 'user';

			try {
				const profileRes = await api.fetch<Record<string, unknown>>(`data/users/${userId}/profile`);
				// Profile endpoint returns flat user profile object
				const { id: _id, ...rest } = profileRes;
				profile = rest;
			} catch {
				profile = {};
			}
		} catch {
			notFound = true;
		}
	}

	onMount(() => {
		loadUser();
	});

	async function handleSave() {
		saving = true;
		try {
			await api.fetch<{ ok: boolean }>(`data/users/${userId}`, {
				method: 'PUT',
				body: { status: editStatus, role: editRole },
			});
			if (user) {
				user = { ...user, status: editStatus, role: editRole };
			}
			toastSuccess('User updated successfully');
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to update user');
		} finally {
			saving = false;
		}
	}

	async function handleRevokeSessions() {
		revokingOpen = false;
		revoking = true;
		try {
			await api.fetch<{ ok: boolean }>(`data/users/${userId}/sessions`, {
				method: 'DELETE',
			});
			toastSuccess('All sessions revoked');
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to revoke sessions');
		} finally {
			revoking = false;
		}
	}

	function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'default' {
		switch (status) {
			case 'active': return 'success';
			case 'suspended': return 'warning';
			case 'banned': return 'danger';
			case 'disabled': return 'danger';
			default: return 'default';
		}
	}

	function formatDate(dateStr: string | null): string {
		if (!dateStr) return '-';
		const d = new Date(dateStr);
		return d.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	}

	async function handleDeleteUser() {
		deleteOpen = false;
		deletingUser = true;
		try {
			await api.fetch(`data/users/${userId}`, { method: 'DELETE' });
			toastSuccess('User deleted');
			goto(`${base}/auth`);
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to delete user');
		} finally {
			deletingUser = false;
		}
	}

	async function handleSendPasswordReset() {
		sendingReset = true;
		try {
			await api.fetch(`data/users/${userId}/send-password-reset`, { method: 'POST' });
			toastSuccess('Password reset email sent');
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to send password reset email');
		} finally {
			sendingReset = false;
		}
	}

	async function handleDisableMfa() {
		disableMfaOpen = false;
		disablingMfa = true;
		try {
			await api.fetch(`data/users/${userId}/mfa`, { method: 'DELETE' });
			toastSuccess('MFA disabled');
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to disable MFA');
		} finally {
			disablingMfa = false;
		}
	}

	function formatProfileValue(value: unknown): string {
		if (value === null || value === undefined) return '-';
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}

	let profileEntries = $derived(Object.entries(profile));
</script>

<PageShell title="User Detail" description="User ID: {userId}">
	{#snippet actions()}
		<a href="{base}/auth">
			<Button variant="ghost" size="sm">Back to Users</Button>
		</a>
	{/snippet}

	{#if !user && !notFound}
		<div class="loading-state">
			<span class="spinner"></span>
			Loading user...
		</div>
	{:else if notFound}
		<div class="error-state">
			<p>User not found.</p>
			<a href="{base}/auth">
				<Button variant="secondary">Back to Users</Button>
			</a>
		</div>
	{:else if user}
		<div class="user-layout">
			<!-- User Info Card -->
			<div class="card">
				<div class="card__header">
					<h3 class="card__title">Account Info</h3>
				</div>
				<div class="card__body">
					<div class="info-grid">
						<div class="info-row">
							<span class="info-label">ID</span>
							<span class="info-value info-value--mono">{user.id}</span>
						</div>
						<div class="info-row">
							<span class="info-label">Email</span>
							<span class="info-value">{user.email}</span>
						</div>
						<div class="info-row">
							<span class="info-label">Status</span>
							<span class="info-value">
								<Badge variant={statusVariant(user.status)} text={user.status} />
							</span>
						</div>
						<div class="info-row">
							<span class="info-label">Role</span>
							<span class="info-value">
								<Badge variant={user.role === 'admin' ? 'primary' : 'default'} text={user.role} />
							</span>
						</div>
						<div class="info-row">
							<span class="info-label">Created</span>
							<span class="info-value">{formatDate(user.createdAt)}</span>
						</div>
						<div class="info-row">
							<span class="info-label">Last Sign-in</span>
							<span class="info-value">{formatDate(user.lastSignedInAt)}</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Edit Status/Role Card -->
			<div class="card">
				<div class="card__header">
					<h3 class="card__title">Manage User</h3>
				</div>
				<div class="card__body">
					<div class="form-fields">
						<Select
							label="Status"
							options={statusOptions}
							bind:value={editStatus}
						/>
						<Select
							label="Role"
							options={roleOptions}
							bind:value={editRole}
						/>
					</div>
					<div class="card__actions">
						<Button
							variant="primary"
							onclick={handleSave}
							disabled={!hasChanges}
							loading={saving}
						>
							Save Changes
						</Button>
					</div>
				</div>
			</div>

			<!-- Profile Card -->
			<div class="card">
				<div class="card__header">
					<h3 class="card__title">Profile</h3>
				</div>
				<div class="card__body">
					{#if profileEntries.length === 0}
						<p class="no-data">No profile data available.</p>
					{:else}
						<div class="info-grid">
							{#each profileEntries as [key, value] (key)}
								<div class="info-row">
									<span class="info-label">{key}</span>
									<span class="info-value">{formatProfileValue(value)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- Danger Zone -->
			<!-- Actions Card -->
			<div class="card">
				<div class="card__header">
					<h3 class="card__title">Actions</h3>
				</div>
				<div class="card__body">
					<div class="danger-row">
						<div class="danger-info">
							<p class="danger-title">Send Password Reset Email</p>
							<p class="danger-desc">Send a password reset link to the user's email address.</p>
						</div>
						<Button
							variant="secondary"
							size="sm"
							onclick={handleSendPasswordReset}
							loading={sendingReset}
						>
							Send Reset Email
						</Button>
					</div>
				</div>
			</div>

			<div class="card card--danger">
				<div class="card__header">
					<h3 class="card__title card__title--danger">Danger Zone</h3>
				</div>
				<div class="card__body">
					<div class="danger-row">
						<div class="danger-info">
							<p class="danger-title">Revoke All Sessions</p>
							<p class="danger-desc">Force sign-out from all devices. The user will need to sign in again.</p>
						</div>
						<Button
							variant="danger"
							size="sm"
							onclick={() => (revokingOpen = true)}
							loading={revoking}
						>
							Revoke Sessions
						</Button>
					</div>
					<hr class="danger-divider" />
					<div class="danger-row">
						<div class="danger-info">
							<p class="danger-title">Disable MFA</p>
							<p class="danger-desc">Remove all multi-factor authentication methods. The user can re-enroll later.</p>
						</div>
						<Button
							variant="danger"
							size="sm"
							onclick={() => (disableMfaOpen = true)}
							loading={disablingMfa}
						>
							Disable MFA
						</Button>
					</div>
					<hr class="danger-divider" />
					<div class="danger-row">
						<div class="danger-info">
							<p class="danger-title">Delete User</p>
							<p class="danger-desc">Permanently delete this user and all associated data. This cannot be undone.</p>
						</div>
						<Button
							variant="danger"
							size="sm"
							onclick={() => (deleteOpen = true)}
							loading={deletingUser}
						>
							Delete User
						</Button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</PageShell>

<ConfirmDialog
	bind:open={revokingOpen}
	title="Revoke All Sessions"
	message="Are you sure you want to revoke all sessions for this user? They will be signed out from all devices immediately."
	confirmLabel="Revoke"
	confirmVariant="danger"
	onconfirm={handleRevokeSessions}
/>

<ConfirmDialog
	bind:open={disableMfaOpen}
	title="Disable MFA"
	message="Are you sure you want to disable all multi-factor authentication methods for this user?"
	confirmLabel="Disable MFA"
	confirmVariant="danger"
	onconfirm={handleDisableMfa}
/>

<ConfirmDialog
	bind:open={deleteOpen}
	title="Delete User"
	message="Are you sure you want to permanently delete this user? All associated data (auth indexes, sessions, push tokens) will be removed. This action cannot be undone."
	confirmLabel="Delete User"
	confirmVariant="danger"
	onconfirm={handleDeleteUser}
/>

<style>
	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-7);
		color: var(--color-text-secondary);
	}

	.spinner {
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

	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-7);
		color: var(--color-text-secondary);
	}

	.user-layout {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
	}

	.card--danger {
		border-color: color-mix(in srgb, var(--color-danger) 30%, var(--color-border));
	}

	.card__header {
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-bg-secondary);
	}

	.card__title {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.card__title--danger {
		color: var(--color-danger);
	}

	.card__body {
		padding: var(--space-4);
	}

	.card__actions {
		margin-top: var(--space-4);
		display: flex;
		justify-content: flex-end;
	}

	.info-grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.info-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
	}

	.info-label {
		flex-shrink: 0;
		width: 120px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.info-value {
		font-size: 0.8125rem;
		color: var(--color-text);
		word-break: break-all;
	}

	.info-value--mono {
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.form-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 320px;
	}

	.no-data {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: 0.875rem;
	}

	.danger-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.danger-info {
		flex: 1;
		min-width: 0;
	}

	.danger-title {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.danger-desc {
		margin: var(--space-1) 0 0;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.danger-divider {
		border: none;
		border-top: 1px solid var(--color-border);
		margin: var(--space-3) 0;
	}
</style>
