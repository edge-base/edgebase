<script lang="ts">
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { getWorkerUrl } from '$lib/runtime-config';

	interface Props {
		open?: boolean;
		bucket: string;
		fileKey: string;
	}

	let {
		open = $bindable(false),
		bucket,
		fileKey,
	}: Props = $props();

	let expiresIn = $state('1h');
	let signedUrl = $state('');
	let loading = $state(false);
	let copied = $state<'public' | 'signed' | null>(null);

	const expiryOptions = [
		{ value: '1h', label: '1 hour' },
		{ value: '1d', label: '1 day' },
		{ value: '7d', label: '7 days' },
		{ value: '30d', label: '30 days' },
	];

	let publicUrl = $derived(
		getWorkerUrl(`/api/storage/${bucket}/${fileKey}`)
	);

	let displayName = $derived(
		fileKey.includes('/') ? fileKey.split('/').pop() ?? fileKey : fileKey
	);

	async function generateSignedUrl() {
		loading = true;
		signedUrl = '';
		try {
			const res = await api.fetch<{ url: string; expiresAt: string }>(
				`data/storage/buckets/${bucket}/signed-url`,
				{
					method: 'POST',
					body: { key: fileKey, expiresIn },
				},
			);
			signedUrl = res.url;
		} catch (err) {
			toastError(describeActionError(err, 'Failed to create signed URL.'));
		} finally {
			loading = false;
		}
	}

	async function copyToClipboard(url: string, type: 'public' | 'signed') {
		try {
			await navigator.clipboard.writeText(url);
			copied = type;
			toastSuccess('URL copied to clipboard');
			setTimeout(() => { copied = null; }, 2000);
		} catch {
			toastError('Failed to copy URL');
		}
	}

	// Reset state when dialog opens
	$effect(() => {
		if (open) {
			signedUrl = '';
			copied = null;
		}
	});
</script>

<Modal bind:open title="Share File">
	<div class="share">
		<p class="share__filename">{displayName}</p>

		<!-- Public URL Section -->
		<div class="share__section">
			<div class="share__label">
				<span class="share__label-text">Public URL</span>
				<span class="share__hint">Works if bucket read rule allows public access</span>
			</div>
			<div class="share__url-row">
				<input
					class="share__url-input"
					type="text"
					readonly
					value={publicUrl}
					onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
				/>
				<Button
					variant={copied === 'public' ? 'primary' : 'secondary'}
					size="sm"
					onclick={() => copyToClipboard(publicUrl, 'public')}
				>
					{copied === 'public' ? 'Copied!' : 'Copy'}
				</Button>
			</div>
		</div>

		<!-- Signed URL Section -->
		<div class="share__section">
			<div class="share__label">
				<span class="share__label-text">Signed URL</span>
				<span class="share__hint">Time-limited access, no auth required</span>
			</div>
			<div class="share__signed-row">
				<Select
					bind:value={expiresIn}
					options={expiryOptions}
				/>
				<Button
					variant="primary"
					size="sm"
					{loading}
					onclick={generateSignedUrl}
				>
					Generate
				</Button>
			</div>
			{#if signedUrl}
				<div class="share__url-row">
					<input
						class="share__url-input"
						type="text"
						readonly
						value={signedUrl}
						onclick={(e) => (e.currentTarget as HTMLInputElement).select()}
					/>
					<Button
						variant={copied === 'signed' ? 'primary' : 'secondary'}
						size="sm"
						onclick={() => copyToClipboard(signedUrl, 'signed')}
					>
						{copied === 'signed' ? 'Copied!' : 'Copy'}
					</Button>
				</div>
			{/if}
		</div>

		<!-- Usage hint -->
		<div class="share__usage">
			<p class="share__usage-title">Usage in HTML</p>
			<code class="share__code">&lt;img src="<span class="share__code-url">…copied URL…</span>" /&gt;</code>
		</div>
	</div>
</Modal>

<style>
	.share {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.share__filename {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
		padding: var(--space-2) var(--space-3);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		word-break: break-all;
	}

	.share__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.share__label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.share__label-text {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.share__hint {
		font-size: 0.75rem;
		color: var(--color-text-tertiary);
	}

	.share__url-row {
		display: flex;
		gap: var(--space-2);
		align-items: stretch;
	}

	.share__url-input {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		font-size: 12px;
		font-family: var(--font-mono);
		color: var(--color-text-secondary);
		background-color: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		outline: none;
		cursor: text;
	}

	.share__url-input:focus {
		border-color: var(--color-primary);
	}

	.share__signed-row {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
	}

	.share__signed-row :global(.field) {
		flex: 1;
	}

	.share__usage {
		padding: var(--space-3);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border);
	}

	.share__usage-title {
		margin: 0 0 var(--space-2);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.share__code {
		display: block;
		font-size: 12px;
		font-family: var(--font-mono);
		color: var(--color-text-secondary);
		word-break: break-all;
		line-height: 1.5;
	}

	.share__code-url {
		color: var(--color-primary);
	}
</style>
