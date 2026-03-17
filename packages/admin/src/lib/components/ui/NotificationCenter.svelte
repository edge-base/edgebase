<script lang="ts">
	import { toastHistory, getUnreadCount, markAllRead, clearHistory } from '$lib/stores/toast.svelte';

	let open = $state(false);
	let dropdownEl: HTMLDivElement | undefined = $state();

	function toggle() {
		open = !open;
		if (open) markAllRead();
	}

	function close() {
		open = false;
	}

	function formatTime(ts: number): string {
		const diff = Date.now() - ts;
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	const typeIcons: Record<string, string> = {
		success: '✓',
		error: '✕',
		warning: '⚠',
		info: 'ℹ',
	};

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	$effect(() => {
		if (!open) return;
		requestAnimationFrame(() => dropdownEl?.focus());
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="notification-center">
	<button class="nc-btn" onclick={toggle} aria-label="Notifications">
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
			<path d="M8 1.5C5.5 1.5 4 3.5 4 5.5V8L2.5 10.5H13.5L12 8V5.5C12 3.5 10.5 1.5 8 1.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
			<path d="M6 11.5C6 12.6046 6.89543 13.5 8 13.5C9.10457 13.5 10 12.6046 10 11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
		</svg>
		{#if getUnreadCount() > 0}
			<span class="nc-badge">{getUnreadCount() > 9 ? '9+' : getUnreadCount()}</span>
		{/if}
	</button>

	{#if open}
		<button
			type="button"
			class="nc-backdrop"
			aria-label="Close notifications"
			onclick={close}
		></button>
		<div
			bind:this={dropdownEl}
			class="nc-dropdown"
			role="dialog"
			aria-modal="true"
			aria-label="Notifications"
			tabindex="-1"
		>
			<div class="nc-header">
				<span class="nc-title">Notifications</span>
				{#if toastHistory.length > 0}
					<button class="nc-clear" onclick={clearHistory}>Clear all</button>
				{/if}
			</div>
			<div class="nc-list">
				{#if toastHistory.length === 0}
					<div class="nc-empty">No notifications</div>
				{:else}
					{#each toastHistory as item (item.id)}
						<div class="nc-item nc-item--{item.type}">
							<span class="nc-icon nc-icon--{item.type}">{typeIcons[item.type]}</span>
							<span class="nc-message">{item.message}</span>
							<span class="nc-time">{formatTime(item.timestamp)}</span>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.notification-center {
		position: relative;
	}

	.nc-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: all 0.15s;
		position: relative;
	}

	.nc-btn:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.nc-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 16px;
		height: 16px;
		padding: 0 4px;
		background: var(--color-danger);
		color: #fff;
		font-size: 10px;
		font-weight: 600;
		border-radius: 9999px;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.nc-backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
		border: none;
		padding: 0;
		background: transparent;
	}

	.nc-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: var(--space-2);
		width: 340px;
		max-height: 400px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.15));
		z-index: 100;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.nc-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.nc-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
	}

	.nc-clear {
		font-size: 12px;
		font-family: inherit;
		color: var(--color-text-tertiary);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}

	.nc-clear:hover {
		color: var(--color-text);
	}

	.nc-list {
		overflow-y: auto;
		flex: 1;
	}

	.nc-empty {
		padding: var(--space-6);
		text-align: center;
		color: var(--color-text-tertiary);
		font-size: 13px;
	}

	.nc-item {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.nc-item:last-child {
		border-bottom: none;
	}

	.nc-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		font-size: 11px;
		border-radius: 50%;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.nc-icon--success { background: var(--color-success-bg, #dcfce7); color: var(--color-success, #16a34a); }
	.nc-icon--error { background: var(--color-danger-bg, #fee2e2); color: var(--color-danger, #dc2626); }
	.nc-icon--warning { background: #fef3c7; color: #92400e; }
	.nc-icon--info { background: #dbeafe; color: #1d4ed8; }

	.nc-message {
		flex: 1;
		font-size: 12px;
		color: var(--color-text);
		line-height: 1.4;
	}

	.nc-time {
		font-size: 11px;
		color: var(--color-text-tertiary);
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
