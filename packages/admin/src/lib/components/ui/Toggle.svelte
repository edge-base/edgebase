<script lang="ts">
	interface Props {
		label?: string;
		checked?: boolean;
		disabled?: boolean;
	}

	let {
		label,
		checked = $bindable(false),
		disabled = false,
	}: Props = $props();

	const toggleId = `toggle-${Math.random().toString(36).slice(2, 9)}`;

	function toggle() {
		if (!disabled) {
			checked = !checked;
		}
	}
</script>

<div class="toggle-field">
	<button
		id={toggleId}
		role="switch"
		type="button"
		class="toggle"
		class:toggle--on={checked}
		aria-checked={checked}
		aria-label={label ?? 'Toggle'}
		{disabled}
		onclick={toggle}
	>
		<span class="toggle__thumb"></span>
	</button>
	{#if label}
		<label class="toggle__label" for={toggleId}>{label}</label>
	{/if}
</div>

<style>
	.toggle-field {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.toggle {
		position: relative;
		width: 36px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 10px;
		background-color: var(--color-border);
		cursor: pointer;
		transition: background-color 0.2s;
		flex-shrink: 0;
	}

	.toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.toggle--on {
		background-color: var(--color-primary);
	}

	.toggle__thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background-color: #fff;
		transition: transform 0.2s;
	}

	.toggle--on .toggle__thumb {
		transform: translateX(16px);
	}

	.toggle__label {
		font-size: 0.875rem;
		color: var(--color-text);
		cursor: pointer;
		user-select: none;
	}

	.toggle:disabled + .toggle__label {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
