<script lang="ts">
	import Layout from '../../routes/+layout.svelte';
</script>

<Layout>
	{#snippet children()}
		<div data-testid="layout-child">Layout child</div>
	{/snippet}
</Layout>
