<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { authStore } from '$lib/stores/auth';
	import { markManualLogout } from '$lib/login-redirect';
	import ThemeToggle from '$lib/components/ui/ThemeToggle.svelte';
	import NotificationCenter from '$lib/components/ui/NotificationCenter.svelte';

	interface Props {
		title?: string;
		actions?: Snippet;
	}

	let { title, actions }: Props = $props();

	function handleLogout() {
		markManualLogout();
		authStore.logout();
	}

	function computeBreadcrumbs(pathname: string): Array<{ label: string; href: string }> {
		const crumbs: Array<{ label: string; href: string }> = [];
		const stripped = pathname.replace(base, '');
		const segments = stripped.split('/').filter(Boolean);

		const labelMap: Record<string, string> = {
			database: 'Database',
			schema: 'Schema',
			records: 'Records',
			auth: 'Auth',
			settings: 'Settings',
			storage: 'Storage',
			logs: 'Logs',
			monitoring: 'Monitoring',
			new: 'New',
		};

		let path = base;
		for (const [index, seg] of segments.entries()) {
			path += `/${seg}`;
			const decoded = decodeURIComponent(seg);
			// Truncate UUID-like segments (8-4-4-4-12 or 32+ hex chars)
			const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded)
				|| (/^[0-9a-f]{20,}$/i.test(decoded));
			let label = labelMap[seg] ?? (isUuid ? decoded.slice(0, 8) + '...' : decoded);
			if (seg === 'settings') {
				label = segments[index - 1] === 'auth' ? 'Auth Settings' : 'Project Info';
			}
			crumbs.push({ label, href: path });
		}

		return crumbs;
	}

	let breadcrumbs = $derived(computeBreadcrumbs($page.url.pathname));
</script>

<header class="header">
	<div class="header__left">
		<nav class="header__breadcrumbs" aria-label="Breadcrumb">
			{#each breadcrumbs as crumb, i}
				{#if i > 0}
					<span class="header__separator">/</span>
				{/if}
				{#if i === breadcrumbs.length - 1}
					<span class="header__crumb header__crumb--current">{crumb.label}</span>
				{:else}
					<a href={crumb.href} class="header__crumb">{crumb.label}</a>
				{/if}
			{/each}
		</nav>
		{#if title}
			<h1 class="header__title">{title}</h1>
		{/if}
	</div>
	<div class="header__right">
		{#if actions}
			{@render actions()}
		{/if}
		<NotificationCenter />
		<ThemeToggle />
		<div class="header__user">
			<span class="header__email">{$authStore.admin?.email ?? ''}</span>
			<button class="header__logout" onclick={handleLogout}>Logout</button>
		</div>
	</div>
</header>

<style>
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 52px;
		padding: 0 var(--space-5);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg);
		flex-shrink: 0;
	}

	.header__left {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}

	.header__breadcrumbs {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		font-size: 13px;
	}

	.header__separator {
		color: var(--color-text-tertiary);
	}

	.header__crumb {
		color: var(--color-text-secondary);
		text-decoration: none;
	}

	.header__crumb:hover {
		color: var(--color-text);
		text-decoration: none;
	}

	.header__crumb--current {
		color: var(--color-text);
		font-weight: 500;
	}

	.header__title {
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
		white-space: nowrap;
	}

	.header__right {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.header__user {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.header__email {
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.header__logout {
		padding: var(--space-1) var(--space-3);
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-secondary);
		background: transparent;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: background 0.1s, color 0.1s;
	}

	.header__logout:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}
</style>
