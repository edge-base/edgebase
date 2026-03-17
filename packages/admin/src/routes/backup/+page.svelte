<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { toastSuccess, toastError, toastInfo } from '$lib/stores/toast.svelte';
	import { downloadBlob } from '$lib/download';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

	interface DOInfo {
		doName: string;
		type: string;
		namespace: string;
	}

	let loading = $state(true);
	let dos = $state<DOInfo[]>([]);
	let dumpingAll = $state(false);
	let dumpingD1 = $state(false);

	// Restore
	let restoreFile = $state<File | null>(null);
	let restoreData = $state<Record<string, unknown> | null>(null);
	let restoring = $state(false);
	let restoreConfirmOpen = $state(false);

	onMount(async () => {
		try {
			const res = await api.fetch<{ dos: DOInfo[] }>('data/backup/list-dos', { method: 'POST' });
			dos = res.dos;
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to load DO list');
		} finally {
			loading = false;
		}
	});

	async function dumpAll() {
		dumpingAll = true;
		try {
			const backup: Record<string, unknown> = { version: 1, timestamp: new Date().toISOString(), dos: [] };
			const doDumps: Array<Record<string, unknown>> = [];

			for (const doInfo of dos) {
				try {
					const data = await api.fetch<Record<string, unknown>>('data/backup/dump-do', {
						method: 'POST',
						body: { doName: doInfo.doName, type: doInfo.type },
					});
					doDumps.push(data);
				} catch {
					doDumps.push({ doName: doInfo.doName, type: doInfo.type, error: 'Failed to dump' });
				}
			}

			// D1 dump
			let d1Data: Record<string, unknown> = {};
			try {
				d1Data = await api.fetch<Record<string, unknown>>('data/backup/dump-d1', { method: 'POST' });
			} catch (err) { console.warn('[EdgeBase] D1 dump failed:', err); }

			backup.dos = doDumps;
			backup.d1 = d1Data;

			// Download JSON
			const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
			downloadBlob(blob, `edgebase-backup-${new Date().toISOString().slice(0, 10)}.json`);

			toastSuccess('Backup downloaded');
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Backup failed');
		} finally {
			dumpingAll = false;
		}
	}

	async function dumpD1Only() {
		dumpingD1 = true;
		try {
			const data = await api.fetch<Record<string, unknown>>('data/backup/dump-d1', { method: 'POST' });
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			downloadBlob(blob, `edgebase-d1-backup-${new Date().toISOString().slice(0, 10)}.json`);
			toastSuccess('D1 backup downloaded');
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'D1 backup failed');
		} finally {
			dumpingD1 = false;
		}
	}

	async function handleRestoreFile(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files?.[0]) return;
		restoreFile = input.files[0];
		try {
			const text = await restoreFile.text();
			restoreData = JSON.parse(text);
			toastInfo(`Backup loaded: ${restoreFile.name}`);
		} catch {
			toastError('Invalid backup file. Please select a valid EdgeBase JSON backup file.');
			restoreFile = null;
			restoreData = null;
		}
	}

	async function handleRestore() {
		restoreConfirmOpen = false;
		if (!restoreData) return;
		restoring = true;

		try {
			const backup = restoreData as Record<string, unknown>;
			let restoredCount = 0;

			// Restore DOs
			const doDumps = (backup.dos ?? []) as Array<Record<string, unknown>>;
			for (const dump of doDumps) {
				if (dump.error || !dump.tables) continue;
				try {
					await api.fetch('data/backup/restore-do', {
						method: 'POST',
						body: { doName: dump.doName, type: dump.type, tables: dump.tables },
					});
					restoredCount++;
				} catch { /* continue */ }
			}

			// Restore D1
			const d1Data = backup.d1 as Record<string, unknown> | undefined;
			if (d1Data?.tables) {
				try {
					await api.fetch('data/backup/restore-d1', {
						method: 'POST',
						body: { tables: d1Data.tables },
					});
					restoredCount++;
				} catch { /* continue */ }
			}

			toastSuccess(`Restored ${restoredCount} components`);
			restoreFile = null;
			restoreData = null;
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Restore failed');
		} finally {
			restoring = false;
		}
	}
</script>

<PageShell title="Backup & Restore" description="Create backups and restore data">
	<div class="backup-layout">
		<!-- Create Backup -->
		<div class="card">
			<div class="card__header"><h3 class="card__title">Create Backup</h3></div>
			<div class="card__body">
				<p class="card__desc">Download a full backup of all Durable Objects and Auth data.</p>

				{#if loading}
					<p class="card__loading">Loading DO list...</p>
				{:else}
					<div class="do-list">
						{#each dos as doInfo (doInfo.doName)}
							<div class="do-item">
								<Badge variant={doInfo.type === 'auth' ? 'warning' : 'primary'} text={doInfo.type} />
								<span class="do-item__name">{doInfo.doName}</span>
							</div>
						{/each}
					</div>

					<div class="card__actions">
						<Button variant="primary" onclick={dumpAll} loading={dumpingAll}>
							Download Full Backup ({dos.length} DOs + D1)
						</Button>
						<Button variant="secondary" onclick={dumpD1Only} loading={dumpingD1}>
							D1 Only
						</Button>
					</div>
				{/if}
			</div>
		</div>

		<!-- Restore -->
		<div class="card">
			<div class="card__header"><h3 class="card__title">Restore from Backup</h3></div>
			<div class="card__body">
				<p class="card__desc">Upload a backup JSON file to restore. This will <strong>overwrite existing data</strong>.</p>

				<div class="restore-upload">
					<input type="file" accept=".json" onchange={handleRestoreFile} class="restore-input" />
				</div>

				{#if restoreData}
					<div class="restore-preview">
						<p class="restore-preview__label">Backup Contents:</p>
						<ul class="restore-preview__list">
							<li>DOs: {((restoreData.dos ?? []) as unknown[]).length} components</li>
							<li>D1: {restoreData.d1 ? 'Included' : 'Not included'}</li>
							<li>Timestamp: {String(restoreData.timestamp ?? 'Unknown')}</li>
						</ul>
					</div>

					<div class="card__actions">
						<Button variant="danger" onclick={() => (restoreConfirmOpen = true)} loading={restoring}>
							Restore Backup
						</Button>
					</div>
				{/if}
			</div>
		</div>
	</div>
</PageShell>

<ConfirmDialog
	bind:open={restoreConfirmOpen}
	title="Confirm Restore"
	message="This will overwrite existing data with the backup contents. This action cannot be undone. Are you sure?"
	confirmLabel="Restore"
	confirmVariant="danger"
	onconfirm={handleRestore}
/>

<style>
	.backup-layout {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
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
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.card__body {
		padding: var(--space-4);
	}

	.card__desc {
		margin: 0 0 var(--space-3);
		font-size: 0.875rem;
		color: var(--color-text-secondary);
	}

	.card__loading {
		color: var(--color-text-tertiary);
		font-size: 0.875rem;
	}

	.card__actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.do-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	.do-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		font-size: 12px;
	}

	.do-item__name {
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.restore-upload {
		margin-bottom: var(--space-3);
	}

	.restore-input {
		font-size: 13px;
	}

	.restore-preview {
		padding: var(--space-3);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.restore-preview__label {
		margin: 0 0 var(--space-2);
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.restore-preview__list {
		margin: 0;
		padding-left: var(--space-4);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}
</style>
