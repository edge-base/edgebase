<script lang="ts">
	import { toasts, removeToast } from '$lib/stores/toast.svelte';
</script>

{#if toasts.length > 0}
	<div class="toast-container" aria-live="polite">
		{#each toasts as toast (toast.id)}
			<div class="toast toast--{toast.type}" role="status">
				<span class="toast__icon" aria-hidden="true">
					{#if toast.type === 'success'}
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<path d="M4 8.5L6.5 11L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					{:else if toast.type === 'error'}
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<path d="M5 5L11 11M11 5L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						</svg>
					{:else}
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<circle cx="8" cy="5" r="0.75" fill="currentColor"/>
							<path d="M8 7.5V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						</svg>
					{/if}
				</span>
				<span class="toast__message">{toast.message}</span>
				<button class="toast__dismiss" onclick={() => removeToast(toast.id)} aria-label="Dismiss">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
						<path d="M4 4L10 10M10 4L4 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		top: var(--space-4);
		right: var(--space-4);
		z-index: 2000;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 380px;
		width: 100%;
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background-color: var(--color-bg);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
		animation: toastIn 0.25s ease-out;
		pointer-events: auto;
	}

	.toast--success {
		border-left: 3px solid var(--color-success);
	}

	.toast--success .toast__icon {
		color: var(--color-success);
	}

	.toast--error {
		border-left: 3px solid var(--color-danger);
	}

	.toast--error .toast__icon {
		color: var(--color-danger);
	}

	.toast--info {
		border-left: 3px solid var(--color-primary);
	}

	.toast--info .toast__icon {
		color: var(--color-primary);
	}

	.toast__icon {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.toast__message {
		flex: 1;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--color-text);
	}

	.toast__dismiss {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.toast__dismiss:hover {
		background-color: var(--color-bg-secondary);
	}

	@keyframes toastIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
