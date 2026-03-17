<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';

	// Redirect to tables by default
	$effect(() => {
		goto(`${base}/database/tables`, { replaceState: true });
	});
</script>
