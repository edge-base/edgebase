<script lang="ts">
	import { authStore } from '$lib/stores/auth';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { getAdminApiUrl } from '$lib/runtime-config';

	let { open = $bindable(false), bucket, onUploaded = () => {} }: {
		open?: boolean;
		bucket: string;
		onUploaded?: () => void;
	} = $props();

	let files = $state<File[]>([]);
	let customKey = $state('');
	let uploading = $state(false);
	let dragOver = $state(false);
	const fileInputId = `file-upload-${Math.random().toString(36).slice(2, 9)}`;

	let previews = $derived(files.map((f) => ({
		name: f.name,
		size: formatSize(f.size),
		type: f.type,
		isImage: f.type.startsWith('image/'),
		url: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
	})));

	function reset() {
		files = [];
		customKey = '';
		dragOver = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files) {
			files = [...files, ...Array.from(e.dataTransfer.files)];
		}
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			files = [...files, ...Array.from(input.files)];
		}
		input.value = '';
	}

	function removeFile(index: number) {
		files = files.filter((_, i) => i !== index);
	}

	async function handleUpload() {
		if (files.length === 0) return;
		uploading = true;

		let successCount = 0;
		let failCount = 0;

		for (const file of files) {
			try {
				const formData = new FormData();
				formData.append('file', file);
				if (files.length === 1 && customKey.trim()) {
					formData.append('key', customKey.trim());
				}

				const resp = await fetch(getAdminApiUrl(`data/storage/buckets/${bucket}/upload`), {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${$authStore.accessToken}`,
					},
					body: formData,
				});

				if (!resp.ok) {
					const err = await resp.json().catch(() => ({ message: 'Upload failed' }));
					throw new Error((err as { message?: string }).message || 'Upload failed');
				}
				successCount++;
			} catch (err) {
				failCount++;
				toastError(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
			}
		}

		uploading = false;
		if (successCount > 0) {
			toastSuccess(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`);
			open = false;
			reset();
			onUploaded();
		}
	}

	function formatSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}
</script>

<Modal bind:open title="Upload Files" onclose={reset}>
	<label
		class="dropzone"
		class:dropzone--active={dragOver}
		ondragover={(e) => { e.preventDefault(); dragOver = true; }}
		ondragleave={() => { dragOver = false; }}
		ondrop={handleDrop}
		for={fileInputId}
	>
		<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
			<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
			<polyline points="17 8 12 3 7 8" />
			<line x1="12" y1="3" x2="12" y2="15" />
		</svg>
		<p class="dropzone__text">Drag & drop files here</p>
		<p class="dropzone__hint">or click to browse</p>
		<input id={fileInputId} type="file" multiple class="dropzone__input" onchange={handleFileInput} />
	</label>

	{#if files.length === 1}
		<div class="key-input">
			<Input label="Custom key (optional)" bind:value={customKey} placeholder={files[0].name} />
		</div>
	{/if}

	{#if previews.length > 0}
		<div class="file-list">
			{#each previews as preview, i (i)}
				<div class="file-item">
					{#if preview.isImage}
						<img src={preview.url} alt={preview.name} class="file-item__thumb" />
					{:else}
						<div class="file-item__icon">
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
								<polyline points="14 2 14 8 20 8" />
							</svg>
						</div>
					{/if}
					<div class="file-item__info">
						<span class="file-item__name">{preview.name}</span>
						<span class="file-item__meta">{preview.size} &middot; {preview.type || 'unknown'}</span>
					</div>
					<button class="file-item__remove" onclick={() => removeFile(i)} aria-label="Remove">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#snippet footer()}
		<Button variant="secondary" onclick={() => { open = false; reset(); }}>Cancel</Button>
		<Button variant="primary" onclick={handleUpload} loading={uploading} disabled={files.length === 0}>
			Upload {files.length > 0 ? `(${files.length})` : ''}
		</Button>
	{/snippet}
</Modal>

<style>
	.dropzone {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-6);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-md);
		text-align: center;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}

	.dropzone:hover,
	.dropzone--active {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 5%, transparent);
	}

	.dropzone__text {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.dropzone__hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}

	.dropzone__input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.key-input {
		margin-top: var(--space-3);
	}

	.file-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-3);
		max-height: 240px;
		overflow-y: auto;
	}

	.file-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg-secondary);
	}

	.file-item__thumb {
		width: 36px;
		height: 36px;
		object-fit: cover;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.file-item__icon {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-tertiary);
		flex-shrink: 0;
	}

	.file-item__info {
		flex: 1;
		min-width: 0;
	}

	.file-item__name {
		display: block;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-item__meta {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.file-item__remove {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		color: var(--color-text-tertiary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.file-item__remove:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-danger);
	}
</style>
