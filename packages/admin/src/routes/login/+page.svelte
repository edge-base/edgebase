<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { base } from '$app/paths';
	import { authStore } from '$lib/stores/auth';
	import { describeActionError } from '$lib/error-messages';
	import { getPostLoginPath } from '$lib/login-redirect';
	import { fetchSetupStatus } from '$lib/setup-status';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);
	let needsSetup = $state<boolean | null>(null);
	let publicSetupAllowed = $state(false);
	let setupStatusError = $state('');
	let setupMessage = $state('');

	function isLocalOrigin(url: URL): boolean {
		return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	}

	const postLoginPath = $derived(getPostLoginPath($page.url));
	const isLocalDashboard = $derived(isLocalOrigin($page.url));
	const adminResetCommand = $derived(
		isLocalDashboard ? 'npx edgebase admin reset-password --local' : 'npx edgebase admin reset-password'
	);
	const adminBootstrapCommand = $derived(
		`npx edgebase admin bootstrap --url ${$page.url.origin} --service-key <service-key>`
	);
	const showInvalidCredentialsHint = $derived(
		(error.toLowerCase().includes('invalid') || error.toLowerCase().includes('credentials')) && needsSetup === false
	);
	const showCliBootstrapNotice = $derived(needsSetup === true && !publicSetupAllowed);

	// Check if already logged in
	$effect(() => {
		if ($authStore.accessToken) {
			goto(postLoginPath, { replaceState: true });
		}
	});

	// Check setup status on mount
	$effect(() => {
		void checkSetupStatus();
	});

	async function checkSetupStatus() {
		setupStatusError = '';
		needsSetup = null;

		try {
			const data = await fetchSetupStatus();
			needsSetup = data.needsSetup;
			publicSetupAllowed = data.publicSetupAllowed ?? false;
			setupMessage = data.message ?? '';
		} catch (err) {
			setupStatusError = describeActionError(
				err,
				'Could not reach the admin server.',
				{ hint: 'Make sure the fresh dev server is still running, then retry.' },
			);
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (needsSetup === null) {
			error = setupStatusError || 'Setup status is still loading.';
			return;
		}
			if (!email || !password) {
				error = 'Email and password are required.';
				return;
			}
			if (needsSetup && !publicSetupAllowed) {
				error = 'This deployment requires CLI bootstrap before the admin dashboard can be used.';
				return;
			}
			if (needsSetup && password.length < 8) {
				error = 'Password must be at least 8 characters.';
				return;
			}

		error = '';
		loading = true;

		try {
			if (needsSetup) {
				await authStore.setup(email, password);
			} else {
				await authStore.login(email, password);
			}
		} catch (err) {
			error = describeActionError(err, needsSetup ? 'Failed to create the admin account.' : 'Authentication failed.');
		} finally {
			loading = false;
		}
	}
</script>

<div class="login-page">
	<div class="login-card">
		<div class="login-header">
			<img class="login-logo" src={`${base}/favicon.svg`} alt="EdgeBase logo" />
			<h1 class="login-title">EdgeBase</h1>
			<p class="login-subtitle">
				{#if needsSetup === null}
					{setupStatusError ? 'Admin server unavailable' : 'Loading...'}
				{:else if needsSetup}
					{publicSetupAllowed ? 'Create your admin account' : 'Finish admin bootstrap from the CLI'}
				{:else}
					Sign in to Admin Dashboard
				{/if}
			</p>
		</div>

		{#if setupStatusError}
			<div class="login-error">
				<p class="login-error__msg">{setupStatusError}</p>
				<p class="login-error__hint">If this should be a fresh setup, the UI is not currently connected to the new server instance.</p>
			</div>
			<Button type="button" variant="secondary" onclick={() => void checkSetupStatus()}>
				Retry Connection
			</Button>
			{:else if needsSetup !== null}
				{#if showCliBootstrapNotice}
					<div class="setup-notice">
						<div class="setup-notice__icon">🛡️</div>
						<div class="setup-notice__text">
							<strong>Admin setup moved to the CLI.</strong>
							{setupMessage || 'Create the first admin from your project directory so production deployments never expose a public setup form.'}
						</div>
					</div>
					<div class="login-recovery">
						<p class="login-recovery__title">Run this once from your project folder</p>
						<code class="login-recovery__code">{adminBootstrapCommand}</code>
						<p class="login-recovery__hint">
							Use the same bootstrap admin email you deployed with. The command only creates the first admin when none exist.
						</p>
					</div>
				{:else}
					{#if needsSetup}
					<div class="setup-notice">
						<div class="setup-notice__icon">🚀</div>
						<div class="setup-notice__text">
							<strong>Welcome!</strong> This is your first time setting up EdgeBase.
							Enter your email and a password below to create the admin account.
						</div>
					</div>
					{/if}

					<form class="login-form" onsubmit={handleSubmit}>
						{#if error}
							<div class="login-error">
								<p class="login-error__msg">{error}</p>
								{#if showInvalidCredentialsHint}
									<p class="login-error__hint">Admin password recovery is handled through the CLI. Use the recovery command shown below instead of email reset.</p>
								{/if}
							</div>
						{/if}

						<div class="login-field">
							<label class="login-label" for="email">{needsSetup ? 'Admin Email' : 'Email'}</label>
							<Input
								id="email"
								type="email"
								placeholder="admin@example.com"
								bind:value={email}
								autocomplete="email"
							/>
						</div>

						<div class="login-field">
							<label class="login-label" for="password">{needsSetup ? 'Choose Password' : 'Password'}</label>
							<Input
								id="password"
								type="password"
								placeholder={needsSetup ? 'Min 8 characters' : 'Enter your password'}
								bind:value={password}
								autocomplete={needsSetup ? 'new-password' : 'current-password'}
							/>
							{#if needsSetup}
								<span class="login-hint">This will be your admin login password.</span>
							{/if}
						</div>

						<Button type="submit" variant="primary" {loading}>
							{needsSetup ? 'Create Admin Account' : 'Sign In'}
						</Button>

						{#if !needsSetup}
							<div class="login-recovery">
								<p class="login-recovery__title">Forgot password?</p>
								<code class="login-recovery__code">{adminResetCommand}</code>
								<p class="login-recovery__hint">
									{#if isLocalDashboard}
										Run this in your project folder. `--local` updates the local D1 admin account used by the dev server.
									{:else}
										Run this in your project folder. The CLI will use your configured Service Key or Cloudflare access for recovery.
									{/if}
								</p>
							</div>
						{/if}
					</form>
				{/if}
			{/if}
		</div>
	</div>

<style>
	.login-page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--color-bg-secondary);
	}

	.login-card {
		width: 100%;
		max-width: 380px;
		padding: var(--space-7);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	.login-header {
		text-align: center;
		margin-bottom: var(--space-6);
	}

	.login-logo {
		display: block;
		width: 56px;
		height: 56px;
		margin: 0 auto var(--space-3);
		border-radius: 14px;
	}

	.login-title {
		font-size: 24px;
		font-weight: 700;
		color: var(--color-text);
		margin: 0;
	}

	.login-subtitle {
		margin-top: var(--space-1);
		font-size: 14px;
		color: var(--color-text-secondary);
	}

	.login-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.login-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.login-label {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text);
	}

	.setup-notice {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-4);
		background: color-mix(in srgb, var(--color-primary) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-4);
	}

	.setup-notice__icon {
		font-size: 20px;
		flex-shrink: 0;
		line-height: 1.4;
	}

	.setup-notice__text {
		font-size: 13px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.setup-notice__text strong {
		color: var(--color-text);
	}

	.login-hint {
		font-size: 12px;
		color: var(--color-text-tertiary);
	}

	.login-error {
		padding: var(--space-3);
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
		color: var(--color-danger);
		font-size: 13px;
		border-radius: var(--radius-md);
		margin-bottom: var(--space-4);
	}

	.login-error__msg {
		margin: 0;
		font-weight: 500;
	}

	.login-error__hint {
		margin: var(--space-2) 0 0;
		font-size: 12px;
		color: var(--color-text-secondary);
		line-height: 1.5;
	}

	.login-recovery {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
	}

	.login-recovery__title {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		color: var(--color-text);
	}

	.login-recovery__code {
		display: block;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-text);
		white-space: nowrap;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.login-recovery__hint {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.login-form :global(button[type='submit']) {
		width: 100%;
		margin-top: var(--space-2);
	}

	.login-form :global(input) {
		width: 100%;
	}
</style>
