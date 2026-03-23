<script lang="ts">
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { devInfoStore } from '$lib/stores/devInfo';

	interface NavItem {
		label: string;
		href: string;
		icon: string;
	}

	interface NavSection {
		title: string;
		items: NavItem[];
	}

	let { collapsed = $bindable(false) }: { collapsed?: boolean } = $props();

	const overviewLink: NavItem = { label: 'Overview', href: `${base}/`, icon: 'overview' };

	const sections: NavSection[] = [
		{
			title: 'Auth',
			items: [
				{ label: 'Users', href: `${base}/auth`, icon: 'users' },
				{ label: 'Auth Settings', href: `${base}/auth/settings`, icon: 'settings' },
				{ label: 'Email Templates', href: `${base}/auth/email-templates`, icon: 'email' },
			],
		},
		{
			title: 'Database',
			items: [
				{ label: 'Tables', href: `${base}/database/tables`, icon: 'tables' },
				{ label: 'ERD', href: `${base}/database/erd`, icon: 'erd' },
				{ label: 'SQL', href: `${base}/database/sql`, icon: 'sql' },
			],
		},
		{
			title: 'Storage',
			items: [
				{ label: 'Files', href: `${base}/storage`, icon: 'storage' },
			],
		},
		{
			title: 'Functions',
			items: [
				{ label: 'Functions', href: `${base}/functions`, icon: 'functions' },
			],
		},
		{
			title: 'Push',
			items: [
				{ label: 'Notifications', href: `${base}/push`, icon: 'push' },
			],
		},
		{
			title: 'Analytics',
			items: [
				{ label: 'Overview', href: `${base}/analytics`, icon: 'analytics' },
				{ label: 'Events', href: `${base}/analytics/events`, icon: 'events' },
				{ label: 'Auth', href: `${base}/analytics/auth`, icon: 'analyticsAuth' },
				{ label: 'Database', href: `${base}/analytics/database`, icon: 'analyticsDb' },
				{ label: 'Storage', href: `${base}/analytics/storage`, icon: 'analyticsStorage' },
				{ label: 'Functions', href: `${base}/analytics/functions`, icon: 'analyticsFn' },
			],
		},
		{
			title: 'Monitoring',
			items: [
				{ label: 'Logs', href: `${base}/logs`, icon: 'logs' },
				{ label: 'Live', href: `${base}/monitoring`, icon: 'live' },
			],
		},
		{
			title: 'System',
			items: [
				{ label: 'API Docs', href: `${base}/docs`, icon: 'apiDocs' },
				{ label: 'Backup', href: `${base}/backup`, icon: 'backup' },
				{ label: 'Project Info', href: `${base}/settings`, icon: 'configView' },
			],
		},
	];

	function isActive(href: string, currentPath: string): boolean {
		// Overview: exact match only
		if (href === `${base}/`) return currentPath === `${base}/` || currentPath === base;
		if (href === `${base}/auth` && currentPath === `${base}/auth`) return true;
		if (href === `${base}/auth` && currentPath.startsWith(`${base}/auth/`) && !currentPath.startsWith(`${base}/auth/settings`) && !currentPath.startsWith(`${base}/auth/email-templates`)) return true;
		// Analytics overview: exact match only (don't highlight for sub-routes)
		if (href === `${base}/analytics` && currentPath !== `${base}/analytics`) return false;
		if (href !== `${base}/auth`) return currentPath.startsWith(href);
		return false;
	}
</script>

<aside class="sidebar" class:sidebar--collapsed={collapsed}>
	<div class="sidebar__logo">
		{#if !collapsed}
			<a href="{base}/" class="sidebar__brand" aria-label="EdgeBase home">
				<img class="sidebar__brand-icon" src={`${base}/favicon.svg`} alt="" />
				<span class="sidebar__brand-text">EdgeBase</span>
			</a>
		{:else}
			<a href="{base}/" class="sidebar__brand" aria-label="EdgeBase home">
				<img class="sidebar__brand-icon" src={`${base}/favicon.svg`} alt="" />
			</a>
		{/if}
	</div>

	{#if $devInfoStore.devMode}
		<div class="sidebar__dev-badge">
			{#if !collapsed}DEV{/if}
		</div>
	{/if}

	<nav class="sidebar__nav">
		<div class="sidebar__section sidebar__section--overview">
			<a
				href={overviewLink.href}
				class="sidebar__link"
				class:sidebar__link--active={isActive(overviewLink.href, $page.url.pathname)}
				title={collapsed ? overviewLink.label : undefined}
			>
				<span class="sidebar__icon">{@html getIcon(overviewLink.icon)}</span>
				{#if !collapsed}
					<span class="sidebar__label">{overviewLink.label}</span>
				{/if}
			</a>
		</div>

		{#each sections as section}
			<div class="sidebar__section">
				{#if !collapsed}
					<div class="sidebar__section-title">{section.title}</div>
				{/if}
				{#each section.items as item}
					<a
						href={item.href}
						class="sidebar__link"
						class:sidebar__link--active={isActive(item.href, $page.url.pathname)}
						title={collapsed ? item.label : undefined}
					>
						<span class="sidebar__icon">{@html getIcon(item.icon)}</span>
						{#if !collapsed}
							<span class="sidebar__label">{item.label}</span>
						{/if}
					</a>
				{/each}
			</div>
		{/each}
	</nav>

	<button class="sidebar__toggle" onclick={() => (collapsed = !collapsed)} aria-label="Toggle sidebar">
		<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
			{#if collapsed}
				<path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			{:else}
				<path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			{/if}
		</svg>
	</button>
</aside>

<script lang="ts" module>
	function getIcon(name: string): string {
		const icons: Record<string, string> = {
			overview: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>',
			tables: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M2 6H14M2 10H14M6 6V14" stroke="currentColor" stroke-width="1.5"/></svg>',
			schema: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M7 4.5H9.5V9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			records: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M2 8H14M2 12H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
			sql: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3H13M3 6H10M3 9H13M3 12H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 10L14 12L12 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			erd: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="5" height="4" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M6 4H8.5V12H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			rulesTest: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L12 4V7.5C12 10.5 10.2 12.8 8 14C5.8 12.8 4 10.5 4 7.5V4L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 8L7.5 9.5L10 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			users: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 14C3 11.2386 5.23858 9 8 9C10.7614 9 13 11.2386 13 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
			settings: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 1V3M8 13V15M1 8H3M13 8H15M2.93 2.93L4.34 4.34M11.66 11.66L13.07 13.07M13.07 2.93L11.66 4.34M4.34 11.66L2.93 13.07" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
			storage: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4L8 2L14 4V12L8 14L2 12V4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 4L8 6L14 4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6V14" stroke="currentColor" stroke-width="1.5"/></svg>',
			functions: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 2C4.89543 2 4 2.89543 4 4V6L3 8L4 10V12C4 13.1046 4.89543 14 6 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10 2C11.1046 2 12 2.89543 12 4V6L13 8L12 10V12C12 13.1046 11.1046 14 10 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6.5" cy="8" r="0.75" fill="currentColor"/><circle cx="9.5" cy="8" r="0.75" fill="currentColor"/></svg>',
			ai: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 1V3M8 13V15M1 8H3M13 8H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="6.5" r="0.75" fill="currentColor"/><circle cx="10" cy="6.5" r="0.75" fill="currentColor"/><path d="M5.5 9.5C6.1 10.3 6.95 10.75 8 10.75C9.05 10.75 9.9 10.3 10.5 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
			logs: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4H12M4 7H10M4 10H12M4 13H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
			live: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8H3L5 3L8 13L11 6L13 8H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			analytics: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="9" width="3" height="5" rx="0.5" stroke="currentColor" stroke-width="1.5"/><rect x="6.5" y="5" width="3" height="9" rx="0.5" stroke="currentColor" stroke-width="1.5"/><rect x="11" y="2" width="3" height="12" rx="0.5" stroke="currentColor" stroke-width="1.5"/></svg>',
			events: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="1.5" stroke="currentColor" stroke-width="1.5"/><circle cx="4" cy="8" r="1.5" stroke="currentColor" stroke-width="1.5"/><circle cx="4" cy="12" r="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 4H14M7 8H12M7 12H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
			analyticsAuth: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L12 4V7.5C12 10.5 10.2 12.8 8 14C5.8 12.8 4 10.5 4 7.5V4L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
			analyticsDb: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="4" rx="5" ry="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 4V12C3 13.1 5.24 14 8 14C10.76 14 13 13.1 13 12V4" stroke="currentColor" stroke-width="1.5"/><path d="M3 8C3 9.1 5.24 10 8 10C10.76 10 13 9.1 13 8" stroke="currentColor" stroke-width="1.5"/></svg>',
			analyticsStorage: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 5V11L8 14L2 11V5L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 8V14M2 5L8 8L14 5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
			analyticsFn: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5.5 2H10C11.1 2 12 2.9 12 4V5.5M4 10.5V12C4 13.1 4.9 14 6 14H10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3 7L6.5 7L8 5L10 9L11.5 7L13 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			push: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 3C4 2.44772 4.44772 2 5 2H11C11.5523 2 12 2.44772 12 3V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V3Z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="11" r="0.75" fill="currentColor"/><path d="M6.5 5H9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
			backup: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8V12C3 13.1046 3.89543 14 5 14H11C12.1046 14 13 13.1046 13 12V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
			apiDocs: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2H10L13 5V14H3V2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 2V5H13" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 8H10M6 10.5H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
			configView: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M2 6H14" stroke="currentColor" stroke-width="1.5"/><path d="M5 6V13" stroke="currentColor" stroke-width="1.5"/><circle cx="4" cy="4.5" r="0.5" fill="currentColor"/><circle cx="6" cy="4.5" r="0.5" fill="currentColor"/><circle cx="8" cy="4.5" r="0.5" fill="currentColor"/></svg>',
			email: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M2 3L8 9L14 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
		};
		return icons[name] ?? '';
	}
</script>

<style>
	.sidebar {
		width: 220px;
		min-width: 220px;
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		border-right: 1px solid var(--color-border);
		transition: width 0.2s, min-width 0.2s;
		position: relative;
		overflow: hidden;
	}

	.sidebar--collapsed {
		width: 56px;
		min-width: 56px;
	}

	.sidebar__logo {
		padding: var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.sidebar__brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		text-decoration: none;
		color: var(--color-text);
	}

	.sidebar__brand-icon {
		display: block;
		width: 24px;
		height: 24px;
		border-radius: var(--radius-sm);
		flex-shrink: 0;
	}

	.sidebar__brand-text {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
	}

	.sidebar__dev-badge {
		margin: var(--space-2) var(--space-4) 0;
		padding: 2px 8px;
		background: #fef3c7;
		color: #92400e;
		font-size: 11px;
		font-weight: 600;
		border-radius: 9999px;
		text-align: center;
		white-space: nowrap;
	}

	.sidebar__nav {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-3) var(--space-2);
	}

	.sidebar__section {
		margin-bottom: var(--space-3);
	}

	.sidebar__section-title {
		padding: var(--space-1) var(--space-2);
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-tertiary);
		white-space: nowrap;
	}

	.sidebar__link {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2);
		border-radius: var(--radius-md);
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-secondary);
		text-decoration: none;
		transition: background-color 0.1s, color 0.1s;
		white-space: nowrap;
	}

	.sidebar__link:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text);
		text-decoration: none;
	}

	.sidebar__link--active {
		background: var(--color-bg-tertiary);
		color: var(--color-primary);
	}

	.sidebar__icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}

	.sidebar__label {
		white-space: nowrap;
	}

	.sidebar__toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: var(--space-3);
		border: none;
		border-top: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text-tertiary);
		cursor: pointer;
		transition: color 0.15s;
	}

	.sidebar__toggle:hover {
		color: var(--color-text);
	}
</style>
