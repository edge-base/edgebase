<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { authDocs } from '$lib/docs-links';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import CreateUserModal from '$lib/components/auth/CreateUserModal.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Skeleton from '$lib/components/ui/Skeleton.svelte';

	let createUserOpen = $state(false);

	interface User {
		id: string;
		email: string;
		status: string;
		role: string;
		createdAt: string;
		lastSignedInAt: string | null;
	}

	interface UsersResponse {
		users: User[];
		cursor: string | null;
		total?: number;
	}

	const PAGE_SIZE = 20;

	let loading = $state(true);
	let users = $state<User[]>([]);
	let cursor = $state<string | null>(null);
	let totalUsers = $state<number | null>(null);
	let searchEmail = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let loadingMore = $state(false);
	let latestFetchRequest = 0;

	// Filter state
	let statusFilter = $state('all');
	let roleFilter = $state('all');

	const statusOptions = [
		{ value: 'all', label: 'All Status' },
		{ value: 'active', label: 'Active' },
		{ value: 'suspended', label: 'Suspended' },
		{ value: 'banned', label: 'Banned' },
		{ value: 'disabled', label: 'Disabled' },
	];

	const roleOptions = [
		{ value: 'all', label: 'All Roles' },
		{ value: 'user', label: 'User' },
		{ value: 'admin', label: 'Admin' },
	];

	const filteredUsers = $derived(users.filter((u) => {
		if (statusFilter !== 'all' && u.status !== statusFilter) return false;
		if (roleFilter !== 'all' && u.role !== roleFilter) return false;
		return true;
	}));

	// Bulk selection state
	let selectedUsers = $state(new Set<string>());
	let bulkAction = $state<'delete' | 'ban' | null>(null);
	let bulkProcessing = $state(false);
	let prevStatusFilter = $state('all');
	let prevRoleFilter = $state('all');

	$effect(() => {
		if (statusFilter !== prevStatusFilter || roleFilter !== prevRoleFilter) {
			selectedUsers = new Set();
			prevStatusFilter = statusFilter;
			prevRoleFilter = roleFilter;
		}
	});

	function toggleUser(userId: string) {
		const next = new Set(selectedUsers);
		if (next.has(userId)) {
			next.delete(userId);
		} else {
			next.add(userId);
		}
		selectedUsers = next;
	}

	function toggleAll() {
		if (selectedUsers.size === filteredUsers.length) {
			selectedUsers = new Set();
		} else {
			selectedUsers = new Set(filteredUsers.map((u) => u.id));
		}
	}

	function clearSelection() {
		selectedUsers = new Set();
	}

	function bulkActionTitle(): string {
		if (!bulkAction) return 'Confirm';
		return `${bulkAction === 'delete' ? 'Delete' : 'Ban'} ${selectedUsers.size} user${selectedUsers.size !== 1 ? 's' : ''}?`;
	}

	function bulkActionMessage(): string {
		if (!bulkAction) return 'Are you sure?';
		if (bulkAction === 'delete') {
			return 'This will permanently delete the selected users and all associated data. This action cannot be undone.';
		}
		return 'This will ban the selected users, preventing them from signing in.';
	}

	async function executeBulkAction() {
		const action = bulkAction;
		if (!action || selectedUsers.size === 0) return;
		bulkAction = null;
		bulkProcessing = true;

		const ids = [...selectedUsers];
		const results = await Promise.allSettled(
			ids.map(async (id) => {
				if (action === 'delete') {
					await api.fetch(`data/users/${id}`, { method: 'DELETE' });
				} else if (action === 'ban') {
					await api.fetch(`data/users/${id}`, {
						method: 'PUT',
						body: { status: 'banned' },
					});
				}
			}),
		);

		const succeeded = results.filter((r) => r.status === 'fulfilled').length;
		const failed = results.filter((r) => r.status === 'rejected').length;

		if (failed === 0) {
			toastSuccess(`${action === 'delete' ? 'Deleted' : 'Banned'} ${succeeded} user${succeeded !== 1 ? 's' : ''}`);
		} else {
			toastError(`${succeeded} succeeded, ${failed} failed`);
		}

		selectedUsers = new Set();
		bulkProcessing = false;
		fetchUsers();
	}

	async function fetchUsers(cursorValue: string | number = 0, append = false) {
		const requestId = ++latestFetchRequest;
		if (append) {
			loadingMore = true;
		} else {
			loading = true;
		}

		try {
			let path = `data/users?limit=${PAGE_SIZE}&cursor=${cursorValue}`;
			if (searchEmail.trim()) {
				path += `&email=${encodeURIComponent(searchEmail.trim())}`;
			}
			const res = await api.fetch<UsersResponse>(path);
			if (requestId !== latestFetchRequest) return;
			users = append ? [...users, ...res.users] : res.users;
			cursor = res.cursor;
			if (res.total != null) totalUsers = res.total;
		} catch (err) {
			if (requestId !== latestFetchRequest) return;
			toastError(describeActionError(err, 'Failed to load users.'));
		} finally {
			if (requestId === latestFetchRequest) {
				loading = false;
				loadingMore = false;
			}
		}
	}

	onMount(() => {
		fetchUsers();
	});

	function handleSearchInput() {
		selectedUsers = new Set();
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			fetchUsers();
		}, 300);
	}

	function handleLoadMore() {
		if (cursor) {
			fetchUsers(cursor, true);
		}
	}

	function navigateToUser(userId: string) {
		goto(`${base}/auth/${userId}`);
	}

	function truncateId(id: string): string {
		if (id.length <= 12) return id;
		return id.slice(0, 8) + '...';
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

	function roleVariant(role: string): 'primary' | 'default' {
		return role === 'admin' ? 'primary' : 'default';
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
</script>

<PageShell title="Users" description="Manage user accounts" docsHref={authDocs}>
	{#snippet actions()}
		<Button variant="primary" size="sm" onclick={() => (createUserOpen = true)}>+ Create User</Button>
		<a href="{base}/auth/settings">
			<Button variant="secondary" size="sm">Auth Settings</Button>
		</a>
	{/snippet}

	<div class="toolbar">
		<div class="toolbar__search">
			<Input
				placeholder="Search by email..."
				bind:value={searchEmail}
				oninput={handleSearchInput}
			/>
		</div>
		<div class="toolbar__filters">
			<Select bind:value={statusFilter} options={statusOptions} />
			<Select bind:value={roleFilter} options={roleOptions} />
		</div>
	</div>

	{#if selectedUsers.size > 0}
		<div class="bulk-bar">
			<span class="bulk-bar__count">{selectedUsers.size} selected</span>
			<div class="bulk-bar__actions">
				<Button variant="secondary" size="sm" onclick={() => (bulkAction = 'ban')} disabled={bulkProcessing}>Ban Selected</Button>
				<Button variant="danger" size="sm" onclick={() => (bulkAction = 'delete')} disabled={bulkProcessing}>Delete Selected</Button>
			</div>
			<button class="bulk-bar__clear" onclick={clearSelection}>Clear</button>
		</div>
	{/if}

	{#if loading}
		<div class="table-wrapper">
			<table class="table">
				<thead>
					<tr>
						<th class="table__th table__th--checkbox" style="width:40px"></th>
						<th class="table__th">ID</th>
						<th class="table__th">Email</th>
						<th class="table__th">Status</th>
						<th class="table__th">Role</th>
						<th class="table__th">Created</th>
					</tr>
				</thead>
				<tbody>
					{#each Array(8) as _}
						<tr class="table__row">
							<td class="table__td" style="width:40px"><Skeleton width="16px" height="16px" /></td>
							<td class="table__td"><Skeleton width="70px" height="14px" /></td>
							<td class="table__td"><Skeleton width="160px" height="14px" /></td>
							<td class="table__td"><Skeleton width="60px" height="20px" /></td>
							<td class="table__td"><Skeleton width="50px" height="14px" /></td>
							<td class="table__td"><Skeleton width="80px" height="14px" /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if filteredUsers.length === 0}
		<EmptyState
			title="No users found"
			description={searchEmail || statusFilter !== 'all' || roleFilter !== 'all' ? 'Try adjusting your search or filters.' : 'No users have been created yet.'}
		/>
	{:else}
		<div class="table-wrapper">
			<table class="table">
				<thead>
					<tr>
						<th class="table__th table__th--checkbox">
							<input
								type="checkbox"
								checked={filteredUsers.length > 0 && selectedUsers.size === filteredUsers.length}
								onchange={toggleAll}
								aria-label="Select all users"
							/>
						</th>
						<th class="table__th">ID</th>
						<th class="table__th">Email</th>
						<th class="table__th">Status</th>
						<th class="table__th">Role</th>
						<th class="table__th">Created</th>
						<th class="table__th">Last Sign-in</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredUsers as user (user.id)}
						<tr
							class="table__row table__row--clickable"
							class:table__row--selected={selectedUsers.has(user.id)}
							onclick={() => navigateToUser(user.id)}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToUser(user.id); } }}
							tabindex={0}
							role="button"
						>
								<td class="table__td table__td--checkbox">
									<input
										type="checkbox"
										checked={selectedUsers.has(user.id)}
										onchange={(e) => { e.stopPropagation(); toggleUser(user.id); }}
										aria-label="Select user {user.email}"
									/>
								</td>
							<td class="table__td table__td--mono" title={user.id}>{truncateId(user.id)}</td>
							<td class="table__td">{user.email}</td>
							<td class="table__td">
								<Badge variant={statusVariant(user.status || 'active')} text={user.status || 'active'} />
							</td>
							<td class="table__td">
								<Badge variant={roleVariant(user.role)} text={user.role} />
							</td>
							<td class="table__td table__td--secondary">{formatDate(user.createdAt)}</td>
							<td class="table__td table__td--secondary">{formatDate(user.lastSignedInAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if cursor || totalUsers != null}
			<div class="pagination">
				{#if totalUsers != null}
					<span class="pagination__info">Showing {filteredUsers.length} of {totalUsers} users</span>
				{/if}
				{#if cursor}
					<Button variant="secondary" onclick={handleLoadMore} loading={loadingMore}>
						Load More
					</Button>
				{/if}
			</div>
		{/if}
	{/if}
</PageShell>

<style>
	.toolbar {
		display: flex;
		align-items: flex-end;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
		flex-wrap: wrap;
	}

	.toolbar__search {
		max-width: 320px;
		flex: 1;
		min-width: 200px;
	}

	.toolbar__filters {
		display: flex;
		gap: var(--space-2);
	}

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

	.table__td {
		padding: var(--space-3) var(--space-4);
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}

	.table__td--mono {
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.table__td--secondary {
		color: var(--color-text-secondary);
		font-size: 0.75rem;
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

	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-4) 0;
	}

	.pagination__info {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	/* Bulk selection */
	.table__th--checkbox,
	.table__td--checkbox {
		width: 40px;
		text-align: center;
		padding-left: var(--space-3);
		padding-right: 0;
	}

	.table__td--checkbox input,
	.table__th--checkbox input {
		cursor: pointer;
		accent-color: var(--color-primary);
	}

	.table__row--selected {
		background-color: color-mix(in srgb, var(--color-primary) 6%, transparent);
	}

	.table__row--selected:hover {
		background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
	}

	.bulk-bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-3);
		background: color-mix(in srgb, var(--color-primary) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
		border-radius: var(--radius-md);
	}

	.bulk-bar__count {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.bulk-bar__actions {
		display: flex;
		gap: var(--space-2);
	}

	.bulk-bar__clear {
		margin-left: auto;
		padding: 0;
		background: none;
		border: none;
		font-size: 12px;
		color: var(--color-text-secondary);
		cursor: pointer;
		text-decoration: underline;
	}

	.bulk-bar__clear:hover {
		color: var(--color-text);
	}

</style>

<ConfirmDialog
	open={bulkAction !== null}
	title={bulkActionTitle()}
	message={bulkActionMessage()}
	confirmLabel={bulkAction === 'delete' ? 'Delete' : 'Ban'}
	confirmVariant={bulkAction === 'delete' ? 'danger' : 'primary'}
	oncancel={() => (bulkAction = null)}
	onconfirm={executeBulkAction}
/>

<CreateUserModal bind:open={createUserOpen} onCreated={() => fetchUsers()} />
