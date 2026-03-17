<script lang="ts">
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';

	interface Props {
		src: string;
		alt?: string;
		class?: string;
	}

	let { src, alt = '', class: className = '' }: Props = $props();
	let blobUrl = $state<string | null>(null);
	let failed = $state(false);

	$effect(() => {
		const currentSrc = src;
		let cancelled = false;
		let objectUrl: string | null = null;

		blobUrl = null;
		failed = false;

		const auth = get(authStore);

		fetch(currentSrc, {
			headers: auth.accessToken
				? { Authorization: `Bearer ${auth.accessToken}` }
				: {}
		})
			.then((res) => {
				if (cancelled || !res.ok) {
					if (!cancelled) failed = true;
					return null;
				}
				return res.blob();
			})
			.then((blob) => {
				if (cancelled || !blob) return;
				objectUrl = URL.createObjectURL(blob);
				blobUrl = objectUrl;
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});

		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});
</script>

{#if blobUrl}
	<img src={blobUrl} {alt} class={className} />
{:else if failed}
	<span class="auth-img-fallback {className}" aria-label={alt}>
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
			<rect x="2" y="2" width="12" height="12" rx="1.5" />
			<circle cx="5.5" cy="5.5" r="1" />
			<path d="M2 11l3-3 2 2 3-3 4 4" />
		</svg>
	</span>
{:else}
	<span class="auth-img-loading {className}"></span>
{/if}

<style>
	img {
		display: block;
	}

	.auth-img-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-secondary);
		color: var(--color-text-tertiary);
	}

	.auth-img-loading {
		display: inline-flex;
		background: var(--color-bg-secondary);
		animation: pulse 1.2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 0.8; }
	}
</style>
