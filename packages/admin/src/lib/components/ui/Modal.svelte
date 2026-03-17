<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		title?: string;
		children?: Snippet;
		footer?: Snippet;
		maxWidth?: string;
		onclose?: () => void;
	}

	let {
		open = $bindable(false),
		title,
		children,
		footer,
		maxWidth = '480px',
		onclose,
	}: Props = $props();

	let dialogEl: HTMLDivElement | undefined = $state();
	let previouslyFocused: HTMLElement | null = null;

	function close() {
		open = false;
		onclose?.();
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			close();
		}
	}

	$effect(() => {
		if (!open || typeof document === 'undefined') return;
		previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		requestAnimationFrame(() => dialogEl?.focus());

		return () => {
			previouslyFocused?.focus?.();
			previouslyFocused = null;
		};
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#if open}
	<div class="modal-layer">
		<button
			type="button"
			class="modal-backdrop"
			aria-label={title ? `Close ${title}` : 'Close dialog'}
			onclick={close}
		></button>
		<div
			bind:this={dialogEl}
			class="modal"
			style:max-width={maxWidth}
			role="dialog"
			aria-modal="true"
			aria-label={title ?? 'Dialog'}
			tabindex="-1"
		>
			{#if title}
				<div class="modal__header">
					<h2 class="modal__title">{title}</h2>
					<button class="modal__close" onclick={close} aria-label="Close">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						</svg>
					</button>
				</div>
			{/if}
			<div class="modal__body">
				{#if children}
					{@render children()}
				{/if}
			</div>
			{#if footer}
				<div class="modal__footer">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.modal-layer {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.modal-backdrop {
		position: absolute;
		inset: 0;
		border: none;
		padding: 0;
		background-color: rgba(0, 0, 0, 0.5);
		animation: fadeIn 0.15s ease-out;
		cursor: pointer;
	}

	.modal {
		position: relative;
		z-index: 1;
		background-color: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
		width: 100%;
		max-width: 480px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		animation: slideUp 0.15s ease-out;
	}

	.modal__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
	}

	.modal__title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.modal__close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 0.15s, color 0.15s;
	}

	.modal__close:hover {
		background-color: var(--color-bg-secondary);
		color: var(--color-text);
	}

	.modal__body {
		padding: var(--space-5);
		overflow-y: auto;
		flex: 1;
	}

	.modal__footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-5);
		border-top: 1px solid var(--color-border);
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes slideUp {
		from { transform: translateY(8px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}
</style>
