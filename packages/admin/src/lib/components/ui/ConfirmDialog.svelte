<script lang="ts">
	import Button from './Button.svelte';

	interface Props {
		open?: boolean;
		title?: string;
		message?: string;
		confirmLabel?: string;
		confirmVariant?: 'primary' | 'danger';
		onconfirm?: () => void;
		oncancel?: () => void;
	}

	let {
		open = $bindable(false),
		title = 'Confirm',
		message = 'Are you sure?',
		confirmLabel = 'Confirm',
		confirmVariant = 'primary',
		onconfirm,
		oncancel,
	}: Props = $props();

	let dialogEl: HTMLDivElement | undefined = $state();
	let previouslyFocused: HTMLElement | null = null;

	function close() {
		open = false;
	}

	function handleCancel() {
		close();
		oncancel?.();
	}

	function handleConfirm() {
		close();
		onconfirm?.();
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			handleCancel();
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
	<div class="confirm-layer">
		<button
			type="button"
			class="confirm-backdrop"
			aria-label={`Close ${title}`}
			onclick={handleCancel}
		></button>
		<div
			bind:this={dialogEl}
			class="confirm"
			role="alertdialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
		>
			<div class="confirm__header">
				<h2 class="confirm__title">{title}</h2>
			</div>
			<div class="confirm__body">
				<p class="confirm__message">{message}</p>
			</div>
			<div class="confirm__footer">
				<Button variant="secondary" onclick={handleCancel}>Cancel</Button>
				<Button variant={confirmVariant} onclick={handleConfirm}>{confirmLabel}</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.confirm-layer {
		position: fixed;
		inset: 0;
		z-index: 1100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
	}

	.confirm-backdrop {
		position: absolute;
		inset: 0;
		border: none;
		padding: 0;
		background-color: rgba(0, 0, 0, 0.5);
		animation: fadeIn 0.15s ease-out;
		cursor: pointer;
	}

	.confirm {
		position: relative;
		z-index: 1;
		background-color: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
		width: 100%;
		max-width: 400px;
		animation: slideUp 0.15s ease-out;
	}

	.confirm__header {
		padding: var(--space-4) var(--space-5) 0;
	}

	.confirm__title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.confirm__body {
		padding: var(--space-3) var(--space-5);
	}

	.confirm__message {
		margin: 0;
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.confirm__footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5) var(--space-4);
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
