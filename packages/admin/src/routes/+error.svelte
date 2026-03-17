<script lang="ts">
	import { page } from '$app/stores';
	import { base } from '$app/paths';

	const statusMessages: Record<number, string> = {
		400: 'Bad Request',
		401: 'Authentication required',
		403: 'You don\'t have permission to access this page',
		404: 'Page not found',
		408: 'Request timed out',
		429: 'Too many requests — please try again later',
		500: 'Internal server error',
		502: 'Bad gateway — the server may be restarting',
		503: 'Service temporarily unavailable',
	};

	const friendlyMessage = $derived(
		$page.error?.message || statusMessages[$page.status] || 'Something went wrong. Please try reloading the page.'
	);
</script>

<div class="error-page">
	<div class="error-card">
		<h1 class="error-code">{$page.status}</h1>
		<p class="error-status">{statusMessages[$page.status] ?? 'Error'}</p>
		<p class="error-message">{friendlyMessage}</p>
		<a href="{base}/" class="error-link">Back to Dashboard</a>
	</div>
</div>

<style>
	.error-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--color-bg-secondary);
	}

	.error-card {
		text-align: center;
		padding: var(--space-7);
	}

	.error-code {
		font-size: 64px;
		font-weight: 700;
		color: var(--color-text-tertiary);
		margin: 0;
	}

	.error-status {
		margin-top: var(--space-1);
		font-size: 18px;
		font-weight: 600;
		color: var(--color-text);
	}

	.error-message {
		margin-top: var(--space-2);
		font-size: 14px;
		color: var(--color-text-secondary);
		max-width: 400px;
	}

	.error-link {
		display: inline-block;
		margin-top: var(--space-5);
		padding: var(--space-2) var(--space-4);
		background: var(--color-primary);
		color: #fff;
		border-radius: var(--radius-md);
		font-size: 13px;
		font-weight: 500;
		text-decoration: none;
	}

	.error-link:hover {
		filter: brightness(1.1);
		text-decoration: none;
	}
</style>
