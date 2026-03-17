<script lang="ts">
	interface Props {
		width?: string;
		height?: string;
		variant?: 'text' | 'card' | 'circle';
		lines?: number;
	}

	let {
		width = '100%',
		height = '16px',
		variant = 'text',
		lines = 1,
	}: Props = $props();

	const resolvedHeight = $derived(() => {
		if (variant === 'card') return height === '16px' ? '120px' : height;
		if (variant === 'circle') return height === '16px' ? '40px' : height;
		return height;
	});
</script>

{#if lines > 1}
	<div class="skeleton-lines">
		{#each Array(lines) as _, i}
			<div
				class="skeleton skeleton--{variant}"
				style:width={i === lines - 1 ? '60%' : width}
				style:height={resolvedHeight()}
			></div>
		{/each}
	</div>
{:else}
	<div
		class="skeleton skeleton--{variant}"
		style:width={width}
		style:height={resolvedHeight()}
	></div>
{/if}

<style>
	.skeleton {
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
		position: relative;
		overflow: hidden;
	}

	.skeleton::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			var(--color-border) 50%,
			transparent 100%
		);
		animation: shimmer 1.5s infinite;
	}

	.skeleton--circle {
		border-radius: 50%;
	}

	.skeleton--card {
		border-radius: var(--radius-md);
	}

	.skeleton-lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	@keyframes shimmer {
		0% { transform: translateX(-100%); }
		100% { transform: translateX(100%); }
	}
</style>
