<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import { ADMIN_APP_BASE_PATH, getAdminApiUrl } from '$lib/runtime-config';
	import { authStore } from '$lib/stores/auth';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import { downloadBlob } from '$lib/download';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { storageDocs } from '$lib/docs-links';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import FileUploadModal from '$lib/components/storage/FileUploadModal.svelte';
	import AuthImage from '$lib/components/ui/AuthImage.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import ShareDialog from '$lib/components/storage/ShareDialog.svelte';

	let uploadOpen = $state(false);
	let shareOpen = $state(false);
	let shareKey = $state('');

	function isImageType(contentType?: string): boolean {
		return !!contentType && contentType.startsWith('image/');
	}

	interface StorageObject {
		key: string;
		size: number;
		uploaded: string;
		httpMetadata?: { contentType?: string };
	}

	let bucket = $derived($page.params.bucket ?? '');

	let loading = $state(true);
	let objects = $state<StorageObject[]>([]);
	let folders = $state<string[]>([]);
	let cursor = $state<string | null>(null);
	let loadingMore = $state(false);
	let currentPrefix = $state('');

	let confirmOpen = $state(false);
	let deleteTarget = $state<string | null>(null);
	let deleting = $state(false);
	let previewOpen = $state(false);
	let previewTarget = $state<StorageObject | null>(null);

	// Bulk selection
	let selectedFiles = $state(new Set<string>());
	let bulkDeleteOpen = $state(false);
	let bulkDeleting = $state(false);

	function toggleFile(key: string) {
		const next = new Set(selectedFiles);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		selectedFiles = next;
	}

	function toggleAll() {
		if (selectedFiles.size === objects.length) {
			selectedFiles = new Set();
		} else {
			selectedFiles = new Set(objects.map((o) => o.key));
		}
	}

	function clearSelection() {
		selectedFiles = new Set();
	}

	async function executeBulkDelete() {
		bulkDeleteOpen = false;
		bulkDeleting = true;
		const keys = [...selectedFiles];
		const results = await Promise.allSettled(
			keys.map(async (key) => {
				await api.fetch(`data/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`, { method: 'DELETE' });
			}),
		);
		const succeeded = results.filter((r) => r.status === 'fulfilled').length;
		const failed = results.filter((r) => r.status === 'rejected').length;

		if (failed === 0) {
			toastSuccess(`Deleted ${succeeded} file${succeeded !== 1 ? 's' : ''}`);
		} else {
			toastError(`${succeeded} succeeded, ${failed} failed`);
		}

		selectedFiles = new Set();
		bulkDeleting = false;
		loadObjects();
	}

	// Breadcrumb segments
	let breadcrumbs = $derived((() => {
		if (!currentPrefix) return [];
		const parts = currentPrefix.replace(/\/$/, '').split('/');
		return parts.map((part, i) => ({
			label: part,
			prefix: parts.slice(0, i + 1).join('/') + '/',
		}));
	})());

	function normalizePrefix(prefix: string): string {
		if (!prefix) return '';
		return prefix.endsWith('/') ? prefix : `${prefix}/`;
	}

	function syncPrefixToUrl(prefix: string) {
		const url = new URL(window.location.href);
		if (prefix) {
			url.searchParams.set('prefix', prefix);
		} else {
			url.searchParams.delete('prefix');
		}
		history.replaceState(history.state, '', url.toString());
	}

	async function loadObjects(append = false) {
		if (append) {
			loadingMore = true;
		} else {
			loading = true;
		}

		try {
			let url = `data/storage/buckets/${bucket}/objects?limit=50&delimiter=/`;
			if (currentPrefix) {
				url += `&prefix=${encodeURIComponent(currentPrefix)}`;
			}
			if (append && cursor) {
				url += `&cursor=${encodeURIComponent(cursor)}`;
			}

			const res = await api.fetch<{ objects: StorageObject[]; folders?: string[]; cursor: string | null }>(url);

			// Filter objects to only show files (not the prefix itself)
			const files = (res.objects || []).filter(o => {
				// Skip "directory marker" objects whose key is exactly the current prefix
				const relKey = currentPrefix ? o.key.replace(currentPrefix, '') : o.key;
				return relKey.length > 0;
			});

			if (append) {
				objects = [...objects, ...files];
			} else {
				objects = files;
				folders = res.folders || [];
			}
			cursor = res.cursor;
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to load objects');
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	function navigateToFolder(prefix: string) {
		currentPrefix = normalizePrefix(prefix);
		syncPrefixToUrl(currentPrefix);
		cursor = null;
		selectedFiles = new Set();
		loadObjects();
	}

	function navigateUp() {
		if (!currentPrefix) return;
		const parts = currentPrefix.replace(/\/$/, '').split('/');
		parts.pop();
		currentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
		syncPrefixToUrl(currentPrefix);
		cursor = null;
		selectedFiles = new Set();
		loadObjects();
	}

	function promptDelete(key: string) {
		deleteTarget = key;
		confirmOpen = true;
	}

	function openPreview(obj: StorageObject) {
		previewTarget = obj;
		previewOpen = true;
	}

	function closePreview() {
		previewOpen = false;
		previewTarget = null;
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		deleting = true;

		try {
			await api.fetch<{ ok: true; deleted: string }>(
				`data/storage/buckets/${bucket}/objects/${encodeURIComponent(deleteTarget)}`,
				{ method: 'DELETE' }
			);
			objects = objects.filter((o) => o.key !== deleteTarget);
			selectedFiles.delete(deleteTarget);
			selectedFiles = new Set(selectedFiles);
			toastSuccess(`Deleted ${deleteTarget}`);
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to delete object');
		} finally {
			deleting = false;
			deleteTarget = null;
		}
	}

	function getObjectUrl(key: string): string {
		return getAdminApiUrl(`data/storage/buckets/${bucket}/objects/${encodeURIComponent(key)}`);
	}

	async function copyUrl(key: string) {
		try {
			await navigator.clipboard.writeText(getObjectUrl(key));
			toastSuccess('URL copied to clipboard');
		} catch {
			toastError('Failed to copy URL');
		}
	}

	async function downloadFile(key: string) {
		try {
			const resp = await fetch(getObjectUrl(key), {
				headers: {
					Authorization: `Bearer ${$authStore.accessToken}`,
				},
			});
			if (!resp.ok) {
				const err = await resp.json().catch(() => ({ message: 'Download failed' }));
				throw new Error((err as { message?: string }).message || 'Download failed');
			}

			const blob = await resp.blob();
			downloadBlob(blob, displayKey(key));
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to download file');
		}
	}

	function formatSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		const value = bytes / Math.pow(1024, i);
		return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatDate(iso: string): string {
		try {
			return new Date(iso).toLocaleString();
		} catch {
			return iso;
		}
	}

	function displayKey(key: string): string {
		// Show only the file name, not the full prefix path
		if (currentPrefix && key.startsWith(currentPrefix)) {
			return key.slice(currentPrefix.length);
		}
		return key;
	}

	onMount(() => {
		currentPrefix = normalizePrefix($page.url.searchParams.get('prefix') ?? '');
		loadObjects();
	});
</script>

<PageShell title={bucket} description="Browse files in this bucket" docsHref={storageDocs}>
	{#snippet actions()}
		<Button variant="primary" size="sm" onclick={() => (uploadOpen = true)}>Upload Files</Button>
		<a href={`${ADMIN_APP_BASE_PATH}/storage`}>
			<Button variant="secondary" size="sm">Back to Buckets</Button>
		</a>
	{/snippet}

	<!-- Breadcrumb -->
	<nav class="breadcrumb">
		<button class="breadcrumb__item" class:breadcrumb__item--active={!currentPrefix} onclick={() => navigateToFolder('')}>
			{bucket}
		</button>
		{#each breadcrumbs as crumb}
			<span class="breadcrumb__sep">/</span>
			<button class="breadcrumb__item" class:breadcrumb__item--active={crumb.prefix === currentPrefix} onclick={() => navigateToFolder(crumb.prefix)}>
				{crumb.label}
			</button>
		{/each}
	</nav>

	<!-- Bulk action bar -->
	{#if selectedFiles.size > 0}
		<div class="bulk-bar">
			<span class="bulk-bar__count">{selectedFiles.size} selected</span>
			<div class="bulk-bar__actions">
				<Button variant="danger" size="sm" onclick={() => (bulkDeleteOpen = true)} disabled={bulkDeleting}>Delete Selected</Button>
			</div>
			<button class="bulk-bar__clear" onclick={clearSelection}>Clear</button>
		</div>
	{/if}

	{#if loading}
		<div class="loading-state">Loading files...</div>
	{:else if objects.length === 0 && folders.length === 0}
		<EmptyState
			title="No files"
			description={currentPrefix ? 'This folder is empty.' : 'This bucket is empty.'}
		/>
	{:else}
		<div class="table-wrapper">
			<table class="file-table">
				<thead>
					<tr>
						<th class="col-checkbox">
							<input
								type="checkbox"
								checked={objects.length > 0 && selectedFiles.size === objects.length}
								onchange={toggleAll}
								aria-label="Select all files"
							/>
						</th>
						<th class="col-preview"></th>
						<th class="col-key">Name</th>
						<th class="col-size">Size</th>
						<th class="col-type">Type</th>
						<th class="col-date">Uploaded</th>
						<th class="col-actions"></th>
					</tr>
				</thead>
				<tbody>
					<!-- Folders -->
					{#each folders as folder (folder)}
						<tr class="folder-row">
							<td class="col-checkbox"></td>
							<td class="col-preview">
								<span class="folder-icon">
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4V13H14V5H8L6.5 3H2V4Z" stroke-linejoin="round"/></svg>
								</span>
							</td>
							<td class="col-key" colspan="4">
								<button class="folder-btn" onclick={() => navigateToFolder(folder)}>
									{folder.replace(currentPrefix, '').replace(/\/$/, '')}/
								</button>
							</td>
							<td class="col-actions"></td>
						</tr>
					{/each}

					<!-- Files -->
					{#each objects as obj (obj.key)}
						<tr class:row--selected={selectedFiles.has(obj.key)}>
							<td class="col-checkbox">
								<input
									type="checkbox"
									checked={selectedFiles.has(obj.key)}
									onchange={() => toggleFile(obj.key)}
									aria-label="Select {displayKey(obj.key)}"
								/>
							</td>
							<td class="col-preview">
								{#if isImageType(obj.httpMetadata?.contentType)}
									<button
										type="button"
										class="thumb-button"
										aria-label={`Preview ${displayKey(obj.key)}`}
										title={`Preview ${displayKey(obj.key)}`}
										onclick={() => openPreview(obj)}
									>
										<AuthImage
											class="file-thumb"
											src={getObjectUrl(obj.key)}
											alt={displayKey(obj.key)}
										/>
									</button>
								{:else}
									<span class="file-icon">
										<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2H10L13 5V14H4V2Z" stroke-linejoin="round"/><path d="M10 2V5H13"/></svg>
									</span>
								{/if}
							</td>
							<td class="col-key">
								<span class="file-key" title={obj.key}>{displayKey(obj.key)}</span>
							</td>
							<td class="col-size">{formatSize(obj.size)}</td>
							<td class="col-type">
								<span class="mime-type">{obj.httpMetadata?.contentType ?? '--'}</span>
							</td>
							<td class="col-date">{formatDate(obj.uploaded)}</td>
							<td class="col-actions">
								<div class="action-btns">
									<button class="icon-btn" title="Download" onclick={() => downloadFile(obj.key)}>
										<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v9M4 8l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 13h12" stroke-linecap="round"/></svg>
									</button>
									<button class="icon-btn" title="Share" onclick={() => { shareKey = obj.key; shareOpen = true; }}>
										<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="8" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="12" cy="12" r="2"/><path d="M5.7 7l4.6-2M5.7 9l4.6 2"/></svg>
									</button>
									<Button variant="danger" size="sm" onclick={() => promptDelete(obj.key)}>
										Delete
									</Button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if cursor}
			<div class="pagination">
				<Button
					variant="secondary"
					loading={loadingMore}
					onclick={() => loadObjects(true)}
				>
					Load More
				</Button>
			</div>
		{/if}
	{/if}
</PageShell>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete File"
	message={`Are you sure you want to delete "${deleteTarget ?? ''}"? This action cannot be undone.`}
	confirmLabel="Delete"
	confirmVariant="danger"
	onconfirm={handleDelete}
/>

<ConfirmDialog
	bind:open={bulkDeleteOpen}
	title="Delete {selectedFiles.size} File{selectedFiles.size !== 1 ? 's' : ''}"
	message={`Are you sure you want to delete ${selectedFiles.size} selected file${selectedFiles.size !== 1 ? 's' : ''}? This action cannot be undone.`}
	confirmLabel="Delete All"
	confirmVariant="danger"
	onconfirm={executeBulkDelete}
/>

<FileUploadModal bind:open={uploadOpen} bucket={bucket} onUploaded={() => loadObjects()} />

<Modal
	bind:open={previewOpen}
	title={previewTarget ? displayKey(previewTarget.key) : 'Image Preview'}
	maxWidth="min(92vw, 960px)"
	onclose={closePreview}
>
	{#if previewTarget}
		<div class="image-preview">
			<div class="image-preview__frame">
				<AuthImage
					class="image-preview__image"
					src={getObjectUrl(previewTarget.key)}
					alt={`Preview of ${displayKey(previewTarget.key)}`}
				/>
			</div>
			<dl class="image-preview__meta">
				<div class="image-preview__meta-row">
					<dt>Path</dt>
					<dd>{previewTarget.key}</dd>
				</div>
				<div class="image-preview__meta-row">
					<dt>Type</dt>
					<dd>{previewTarget.httpMetadata?.contentType ?? '--'}</dd>
				</div>
				<div class="image-preview__meta-row">
					<dt>Size</dt>
					<dd>{formatSize(previewTarget.size)}</dd>
				</div>
				<div class="image-preview__meta-row">
					<dt>Uploaded</dt>
					<dd>{formatDate(previewTarget.uploaded)}</dd>
				</div>
			</dl>
		</div>
	{/if}
</Modal>

<ShareDialog bind:open={shareOpen} {bucket} fileKey={shareKey} />

<style>
	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0;
		padding: var(--space-2) 0;
		margin-bottom: var(--space-3);
		font-size: 13px;
	}

	.breadcrumb__item {
		padding: var(--space-1) var(--space-2);
		border: none;
		background: none;
		color: var(--color-primary);
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: 13px;
		border-radius: var(--radius-sm);
	}

	.breadcrumb__item:hover {
		background: var(--color-bg-secondary);
	}

	.breadcrumb__item--active {
		color: var(--color-text);
		font-weight: 600;
		cursor: default;
	}

	.breadcrumb__item--active:hover {
		background: none;
	}

	.breadcrumb__sep {
		color: var(--color-text-tertiary);
		margin: 0 2px;
	}

	.loading-state {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-text-secondary);
	}

	.table-wrapper {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.file-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.file-table thead {
		background: var(--color-bg-secondary);
	}

	.file-table th {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		font-weight: 500;
		color: var(--color-text-secondary);
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}

	.file-table td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		vertical-align: middle;
	}

	.file-table tbody tr:last-child td {
		border-bottom: none;
	}

	.file-table tbody tr:hover {
		background: var(--color-bg-secondary);
	}

	.col-checkbox {
		width: 36px;
		text-align: center;
		padding-left: var(--space-3);
		padding-right: 0;
	}

	.col-checkbox input {
		cursor: pointer;
		accent-color: var(--color-primary);
	}

	.row--selected {
		background-color: color-mix(in srgb, var(--color-primary) 6%, transparent);
	}

	.row--selected:hover {
		background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
	}

	.col-preview {
		width: 40px;
		text-align: center;
	}

	.thumb-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: none;
		cursor: zoom-in;
		transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
	}

	.thumb-button:hover {
		transform: translateY(-1px);
		border-color: var(--color-primary);
	}

	.thumb-button:focus-visible {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 20%, transparent);
	}

	:global(.file-thumb) {
		display: block;
		width: 32px;
		height: 32px;
		object-fit: cover;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
	}

	.file-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-tertiary);
	}

	.folder-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-warning);
	}

	.folder-row {
		cursor: pointer;
	}

	.folder-btn {
		border: none;
		background: none;
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		padding: 0;
	}

	.folder-btn:hover {
		color: var(--color-primary);
	}

	.col-key {
		min-width: 200px;
		max-width: 400px;
	}

	.col-size {
		white-space: nowrap;
		width: 100px;
	}

	.col-type {
		width: 160px;
	}

	.col-date {
		white-space: nowrap;
		width: 180px;
	}

	.col-actions {
		width: 140px;
		text-align: right;
	}

	.action-btns {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.icon-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border-color: var(--color-text-tertiary);
	}

	.file-key {
		font-family: var(--font-mono);
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: block;
		max-width: 400px;
	}

	.mime-type {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.pagination {
		display: flex;
		justify-content: center;
		padding: var(--space-4) 0;
	}

	/* Bulk selection bar */
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

	.image-preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.image-preview__frame {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 260px;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 88%, black 12%);
	}

	:global(.image-preview__image) {
		display: block;
		max-width: 100%;
		max-height: min(70vh, 720px);
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: var(--radius-sm);
	}

	.image-preview__meta {
		display: grid;
		gap: var(--space-2);
		margin: 0;
	}

	.image-preview__meta-row {
		display: grid;
		grid-template-columns: 84px minmax(0, 1fr);
		gap: var(--space-3);
		align-items: start;
	}

	.image-preview__meta-row dt {
		margin: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-tertiary);
	}

	.image-preview__meta-row dd {
		margin: 0;
		font-size: 13px;
		color: var(--color-text);
		word-break: break-all;
	}

	@media (max-width: 640px) {
		.image-preview__meta-row {
			grid-template-columns: 1fr;
			gap: var(--space-1);
		}
	}
</style>
