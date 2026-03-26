<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { pushDocs } from '$lib/docs-links';
	import Tabs from '$lib/components/ui/Tabs.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	let activeTab = $state('tokens');
	const tabs = [
		{ id: 'tokens', label: 'Tokens' },
		{ id: 'send', label: 'Test Send' },
		{ id: 'logs', label: 'Logs' },
	];

	// ─── Tokens Tab ───
	let tokenUserId = $state('');
	let tokens = $state<Array<Record<string, unknown>>>([]);
	let tokensLoading = $state(false);

	async function fetchTokens() {
		if (!tokenUserId.trim()) {
			tokens = [];
			return;
		}
		tokensLoading = true;
		try {
			const res = await api.fetch<{ items: Array<Record<string, unknown>> }>(`data/push/tokens?userId=${encodeURIComponent(tokenUserId.trim())}`);
			tokens = res.items;
		} catch (err) {
			toastError(describeActionError(err, 'Failed to load push tokens.'));
			tokens = [];
		} finally {
			tokensLoading = false;
		}
	}

	// ─── Send Tab ───
	let sendUserId = $state('');
	let sendTitle = $state('');
	let sendBody = $state('');
	let sendData = $state('');
	let sending = $state(false);
	let sendResult = $state<Record<string, unknown> | null>(null);
	const sendDataId = `push-send-data-${Math.random().toString(36).slice(2, 9)}`;

	async function handleSend() {
		if (!sendUserId.trim() || !sendTitle.trim()) return;
		sending = true;
		sendResult = null;
		try {
			const payload: Record<string, unknown> = {
				userId: sendUserId.trim(),
				title: sendTitle.trim(),
				body: sendBody.trim(),
			};
			if (sendData.trim()) {
				try {
					payload.data = JSON.parse(sendData.trim());
				} catch {
					toastError('Invalid JSON in data field. Example: {"key": "value"}');
					sending = false;
					return;
				}
			}
			const res = await api.fetch<Record<string, unknown>>('data/push/test-send', {
				method: 'POST',
				body: payload,
			});
			sendResult = res;
			toastSuccess(`Sent to ${res.sent ?? 0} device(s)`);
		} catch (err) {
			toastError(describeActionError(err, 'Failed to send the test push notification.'));
		} finally {
			sending = false;
		}
	}

	// ─── Logs Tab ───
	let logUserId = $state('');
	let logs = $state<Array<Record<string, unknown>>>([]);
	let logsLoading = $state(false);

	async function fetchLogs() {
		logsLoading = true;
		try {
			let path = 'data/push/logs?limit=50';
			if (logUserId.trim()) path += `&userId=${encodeURIComponent(logUserId.trim())}`;
			const res = await api.fetch<{ items: Array<Record<string, unknown>> }>(path);
			logs = res.items;
		} catch (err) {
			toastError(describeActionError(err, 'Failed to load push logs.'));
			logs = [];
		} finally {
			logsLoading = false;
		}
	}

	onMount(() => {
		fetchLogs();
	});

	function formatDate(d: unknown): string {
		if (!d) return '-';
		try { return new Date(d as string).toLocaleString(); } catch { return String(d); }
	}

	function truncate(s: string, len = 24): string {
		return s.length > len ? s.slice(0, len) + '...' : s;
	}
</script>

<PageShell title="Push Notifications" description="Manage push tokens, test sends, and view logs" docsHref={pushDocs}>
	<Tabs {tabs} bind:activeTab />

	<div class="tab-content">
		{#if activeTab === 'tokens'}
			<div class="search-bar">
				<Input placeholder="Enter User ID..." bind:value={tokenUserId} />
				<Button variant="primary" onclick={fetchTokens} loading={tokensLoading}>Search</Button>
			</div>

			{#if tokens.length === 0}
				<EmptyState title="No tokens" description="Enter a user ID to search for registered push tokens." />
			{:else}
				<div class="table-wrapper">
					<table class="data-table">
						<thead>
							<tr>
								<th>Device ID</th>
								<th>Platform</th>
								<th>Token</th>
								<th>Registered</th>
							</tr>
						</thead>
						<tbody>
							{#each tokens as t (t.deviceId ?? Math.random())}
								<tr>
									<td class="mono">{truncate(String(t.deviceId ?? ''), 16)}</td>
									<td><Badge variant="primary" text={String(t.platform ?? 'unknown')} /></td>
									<td class="mono" title={String(t.token ?? '')}>{truncate(String(t.token ?? ''), 30)}</td>
									<td class="secondary">{formatDate(t.registeredAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

		{:else if activeTab === 'send'}
			<div class="send-form">
					<Input label="User ID" bind:value={sendUserId} placeholder="Target user ID" required />
					<Input label="Title" bind:value={sendTitle} placeholder="Notification title" required />
					<Input label="Body" bind:value={sendBody} placeholder="Notification body (optional)" />
					<div class="form-field">
						<label class="form-label" for={sendDataId}>Custom Data (JSON)</label>
						<textarea
							id={sendDataId}
							class="form-textarea"
							bind:value={sendData}
							placeholder={'{"key": "value"}'}
						rows="3"
					></textarea>
				</div>
				<Button variant="primary" onclick={handleSend} loading={sending} disabled={!sendUserId.trim() || !sendTitle.trim()}>
					Send Test Notification
				</Button>

				{#if sendResult}
					<div class="send-result">
						<Badge variant="success" text="Sent" />
						<span>Sent: {sendResult.sent}, Failed: {sendResult.failed}, Total: {sendResult.total}</span>
					</div>
				{/if}
			</div>

		{:else if activeTab === 'logs'}
			<div class="search-bar">
				<Input placeholder="Filter by User ID (optional)..." bind:value={logUserId} />
				<Button variant="primary" onclick={fetchLogs} loading={logsLoading}>Refresh</Button>
			</div>

			{#if logs.length === 0}
				<EmptyState title="No logs" description="No push notification logs found." />
			{:else}
				<div class="table-wrapper">
					<table class="data-table">
						<thead>
							<tr>
								<th>Time</th>
								<th>User</th>
								<th>Status</th>
								<th>Sent/Failed</th>
								<th>Payload</th>
							</tr>
						</thead>
						<tbody>
							{#each logs as log (log.sentAt ?? Math.random())}
								<tr>
									<td class="secondary">{formatDate(log.sentAt)}</td>
									<td class="mono">{truncate(String(log.userId ?? ''), 16)}</td>
									<td>
										<Badge
											variant={log.status === 'success' ? 'success' : log.status === 'partial' ? 'warning' : 'danger'}
											text={String(log.status ?? '-')}
										/>
									</td>
									<td>{log.tokensSent ?? 0} / {log.tokensFailed ?? 0}</td>
									<td class="secondary">{truncate(JSON.stringify(log.payload ?? {}), 40)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</div>
</PageShell>

<style>
	.tab-content { margin-top: var(--space-4); }

	.search-bar {
		display: flex;
		gap: var(--space-2);
		align-items: flex-end;
		max-width: 500px;
		margin-bottom: var(--space-4);
	}

	.send-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 480px;
	}

	.form-field { display: flex; flex-direction: column; gap: var(--space-1); }
	.form-label { font-size: 0.8125rem; font-weight: 500; color: var(--color-text-secondary); }

	.form-textarea {
		padding: var(--space-2) var(--space-3);
		font-size: 13px;
		font-family: var(--font-mono);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		resize: vertical;
		outline: none;
	}
	.form-textarea:focus { border-color: var(--color-primary); }

	.send-result {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
		background: var(--color-bg-secondary);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
	}

	.table-wrapper {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	.data-table thead { background: var(--color-bg-secondary); }
	.data-table th {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-secondary);
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}
	.data-table td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
	}
	.data-table tbody tr:last-child td { border-bottom: none; }
	.data-table tbody tr:hover { background: var(--color-bg-secondary); }

	.mono { font-family: var(--font-mono); font-size: 12px; }
	.secondary { color: var(--color-text-secondary); font-size: 12px; }
</style>
