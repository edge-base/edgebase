<script lang="ts">
	interface Props {
		src: string;
		alt?: string;
		class?: string;
	}

	let { src, alt = '', class: className = '' }: Props = $props();
</script>

<img {src} {alt} class={className} data-testid="mock-auth-image" />
