<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { authStore } from '$lib/stores/auth';
	import { buildLoginPath, consumeManualLogout } from '$lib/login-redirect';
	import { fetchSetupStatus } from '$lib/setup-status';
	import { loadDevInfo } from '$lib/stores/devInfo';
	import { initTheme } from '$lib/stores/theme';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import Header from '$lib/components/layout/Header.svelte';
	import Toast from '$lib/components/ui/Toast.svelte';
	import CommandPalette from '$lib/components/ui/CommandPalette.svelte';

	let { children }: { children: Snippet } = $props();

	let sidebarCollapsed = $state(false);
	let isMobile = $state(false);
	let setupChecked = $state(false);
	let cmdPaletteOpen = $state(false);

	// Initialize theme on mount
	$effect(() => {
		initTheme();
	});

	// Mobile responsive: auto-collapse sidebar on small screens
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(max-width: 768px)');
		const handler = (e: MediaQueryListEvent | MediaQueryList) => {
			isMobile = e.matches;
			if (e.matches) sidebarCollapsed = true;
		};
		handler(mql);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	});

	function closeMobileSidebar() {
		if (isMobile) sidebarCollapsed = true;
	}

	// Determine if we're on the login page
	let isLoginPage = $derived($page.url.pathname === `${base}/login` || $page.url.pathname === `${base}/login/`);

	// On app start, verify session is still valid against server setup state.
	// If the server was reset (needsSetup=true) but we have a stale token, clear it.
	$effect(() => {
		if (!isLoginPage && $authStore.accessToken && !setupChecked) {
			checkSetupState();
		} else if (!$authStore.accessToken) {
			setupChecked = true;
		}
	});

	async function checkSetupState() {
		try {
			const data = await fetchSetupStatus();
			if (data.needsSetup) {
				// Server was reset — clear stale token.
				// Do NOT call goto() here: the auth gate $effect will
				// react to the token becoming null and redirect to login.
				// Calling goto() alongside the reactive redirect causes
				// competing navigations that trigger an infinite reload loop.
				authStore.logout();
				return;
			}
		} catch {
			// Server unreachable — let normal auth flow handle it
		}
		setupChecked = true;
	}

	// Auth gate: redirect to login if not authenticated (except on login page)
	$effect(() => {
		if (!isLoginPage && !$authStore.accessToken) {
			const loginPath = consumeManualLogout() ? `${base}/login` : buildLoginPath($page.url);
			goto(loginPath, { replaceState: true });
		}
	});

	// Load dev info on mount (one-shot)
	$effect(() => {
		if ($authStore.accessToken && setupChecked) {
			loadDevInfo();
		}
	});
</script>

{#if isLoginPage}
	<!-- Login page renders without layout chrome -->
	{@render children()}
{:else if $authStore.accessToken}
	<!-- Authenticated layout -->
		<div class="app-layout" class:app-layout--mobile={isMobile}>
			{#if isMobile && !sidebarCollapsed}
				<button
					type="button"
					class="sidebar-overlay"
					aria-label="Close navigation menu"
					onclick={closeMobileSidebar}
				></button>
			{/if}
		<Sidebar bind:collapsed={sidebarCollapsed} />
		<div class="app-main">
			{#if isMobile}
				<button class="mobile-menu-btn" onclick={() => (sidebarCollapsed = !sidebarCollapsed)} aria-label="Toggle menu">
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
						<path d="M3 5H17M3 10H17M3 15H17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
				</button>
			{/if}
			<Header />
			<main class="app-content">
				{@render children()}
			</main>
		</div>
	</div>
{:else}
	<!-- Loading / redirecting to login -->
	<div class="app-loading">
		<span>Loading...</span>
	</div>
{/if}

<!-- Toast container — self-manages its own rendering from the toast store -->
<Toast />

<!-- Command Palette (Cmd+K) -->
<CommandPalette bind:open={cmdPaletteOpen} />

<svelte:window onkeydown={(e) => {
	if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
		e.preventDefault();
		cmdPaletteOpen = !cmdPaletteOpen;
	}
}} />

<style>
	.app-layout {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	.app-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.app-content {
		flex: 1;
		overflow-y: auto;
		background: var(--color-bg-secondary);
	}

	.app-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100vh;
		color: var(--color-text-secondary);
	}

	.mobile-menu-btn {
		display: none;
	}

		.sidebar-overlay {
			display: none;
			border: none;
			padding: 0;
		}

	@media (max-width: 768px) {
		.mobile-menu-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			position: absolute;
			top: 10px;
			left: var(--space-3);
			z-index: 50;
			width: 36px;
			height: 36px;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-md);
			background: var(--color-bg);
			color: var(--color-text);
			cursor: pointer;
		}

		.app-layout--mobile :global(.sidebar) {
			position: fixed;
			z-index: 100;
			height: 100vh;
			width: 220px !important;
			min-width: 220px !important;
			transition: transform 0.2s ease;
		}

		.app-layout--mobile :global(.sidebar--collapsed) {
			transform: translateX(-100%);
		}

		.sidebar-overlay {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 99;
			background: rgba(0, 0, 0, 0.4);
		}
	}

</style>
