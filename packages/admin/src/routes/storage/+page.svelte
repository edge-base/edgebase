<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { devInfoStore } from '$lib/stores/devInfo';
	import { toastError, toastSuccess } from '$lib/stores/toast.svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { storageDocs } from '$lib/docs-links';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';

	interface BucketStats {
		totalObjects: number;
		totalSize: number;
	}

	let loading = $state(true);
	let buckets = $state<string[]>([]);
	let bucketStats = $state<Record<string, BucketStats>>({});
	let createOpen = $state(false);
	let createName = $state('');
	let createError = $state('');
	let creating = $state(false);

	function sleep(ms: number) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async function loadBuckets(): Promise<string[]> {
		const res = await api.fetch<{ buckets: string[] }>('data/storage/buckets');
		buckets = res.buckets;
		if (res.buckets.length > 0) {
			await loadStats(res.buckets);
		} else {
			bucketStats = {};
		}
		return res.buckets;
	}

	async function waitForBucketReload(name: string, attempts = 20, delayMs = 300): Promise<boolean> {
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			try {
				const current = await loadBuckets();
				if (current.includes(name)) {
					return true;
				}
			} catch {
				// The worker may still be restarting; keep polling until timeout.
			}

			if (attempt < attempts - 1) {
				await sleep(delayMs);
			}
		}

		return false;
	}

	function formatSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		const val = bytes / Math.pow(1024, i);
		return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
	}

	async function loadStats(bucketList: string[]) {
		const results = await Promise.allSettled(
			bucketList.map(async (bucket) => {
				const stats = await api.fetch<BucketStats>(`data/storage/buckets/${encodeURIComponent(bucket)}/stats`);
				return { bucket, stats };
			}),
		);
		const newStats: Record<string, BucketStats> = {};
		for (const result of results) {
			if (result.status === 'fulfilled') {
				newStats[result.value.bucket] = result.value.stats;
			}
		}
		bucketStats = newStats;
	}

	onMount(async () => {
		try {
			await loadBuckets();
		} catch (err) {
			toastError(describeActionError(err, 'Failed to load storage buckets.', {
				hint: 'Check your connection, then confirm the EdgeBase worker is running and the admin session is valid.',
			}));
		} finally {
			loading = false;
		}
	});

	async function handleCreateBucket() {
		const name = createName.trim();
		if (!name) {
			createError = 'Bucket name is required.';
			return;
		}

		creating = true;
		createError = '';
		try {
			await api.schemaMutation('schema/storage/buckets', {
				method: 'POST',
				body: { name },
			});

			const bucketVisible = await waitForBucketReload(name);
			if (!bucketVisible && !buckets.includes(name)) {
				buckets = [...buckets, name];
				bucketStats = {
					...bucketStats,
					[name]: { totalObjects: 0, totalSize: 0 },
				};
			}

			createOpen = false;
			createName = '';
			toastSuccess(`Bucket "${name}" created`);
		} catch (err) {
			createError = describeActionError(err, 'Failed to create bucket.');
			toastError(createError);
		} finally {
			creating = false;
		}
	}
</script>

<PageShell title="Storage" description="Manage file storage buckets" docsHref={storageDocs}>
	{#snippet actions()}
		{#if $devInfoStore.devMode}
			<Button variant="primary" size="sm" onclick={() => {
				createError = '';
				createOpen = true;
			}}>
				+ Create Bucket
			</Button>
		{/if}
	{/snippet}
	{#if loading}
		<div class="loading-state">
			<div class="loading-spinner"></div>
			<span>Loading storage buckets...</span>
		</div>
	{:else if buckets.length === 0}
		<EmptyState
			title="No buckets"
			description="No storage buckets found. Buckets are defined in your EdgeBase configuration."
		/>
	{:else}
		<div class="bucket-grid">
			{#each buckets as bucket (bucket)}
				{@const stats = bucketStats[bucket]}
				<a href="{base}/storage/{bucket}" class="bucket-card">
					<div class="bucket-card__icon" aria-hidden="true">
						<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
							<ellipse cx="12" cy="5" rx="9" ry="3" />
							<path d="M3 5V19C3 20.66 7.03 22 12 22C16.97 22 21 20.66 21 19V5" />
							<path d="M3 12C3 13.66 7.03 15 12 15C16.97 15 21 13.66 21 12" />
						</svg>
					</div>
					<div class="bucket-card__name">{bucket}</div>
					{#if stats}
						<div class="bucket-card__stats">
							<span>{stats.totalObjects} {stats.totalObjects === 1 ? 'file' : 'files'}</span>
							<span class="bucket-card__dot">&middot;</span>
							<span>{formatSize(stats.totalSize)}</span>
						</div>
					{:else}
						<div class="bucket-card__hint">Browse files</div>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</PageShell>

<Modal bind:open={createOpen} title="Create Bucket" maxWidth="420px">
	{#snippet children()}
		<div class="create-modal">
			<Input label="Bucket Name" bind:value={createName} placeholder="uploads" error={createError || undefined} />
			<p class="create-modal__hint">This adds a new bucket entry to <code>edgebase.config.ts</code> for local development.</p>
		</div>
	{/snippet}
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (createOpen = false)}>Cancel</Button>
		<Button variant="primary" loading={creating} onclick={handleCreateBucket}>Create Bucket</Button>
	{/snippet}
</Modal>

<style>
	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-7);
		text-align: center;
		color: var(--color-text-secondary);
	}

	.loading-spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.bucket-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--space-3);
	}

	.bucket-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-4);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		text-decoration: none;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	.bucket-card:hover {
		border-color: var(--color-primary);
		box-shadow: var(--shadow-sm);
		text-decoration: none;
	}

	.bucket-card__icon {
		color: var(--color-primary);
		opacity: 0.7;
	}

	.bucket-card__name {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text);
		font-family: var(--font-mono);
	}

	.bucket-card__stats {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 12px;
		color: var(--color-text-secondary);
		font-family: var(--font-mono);
	}

	.bucket-card__dot {
		color: var(--color-text-tertiary);
	}

	.bucket-card__hint {
		font-size: 12px;
		color: var(--color-text-tertiary);
	}

	.create-modal {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.create-modal__hint {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}
</style>
