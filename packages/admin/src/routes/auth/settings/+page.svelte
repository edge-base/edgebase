<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { ApiError, api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { addToast, toastError } from '$lib/stores/toast.svelte';
	import { devInfoStore, loadDevInfo } from '$lib/stores/devInfo';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { authDocs } from '$lib/docs-links';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';

	const OAUTH_PROVIDERS = [
		{ id: 'google', label: 'Google' },
		{ id: 'github', label: 'GitHub' },
		{ id: 'apple', label: 'Apple' },
		{ id: 'discord', label: 'Discord' },
		{ id: 'microsoft', label: 'Microsoft' },
		{ id: 'facebook', label: 'Facebook' },
		{ id: 'kakao', label: 'Kakao' },
		{ id: 'naver', label: 'Naver' },
		{ id: 'x', label: 'X' },
		{ id: 'reddit', label: 'Reddit' },
		{ id: 'line', label: 'Line' },
		{ id: 'slack', label: 'Slack' },
		{ id: 'spotify', label: 'Spotify' },
		{ id: 'twitch', label: 'Twitch' },
	] as const;

	type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]['id'];
	type AuthEnvTarget = 'development' | 'release';

	const AUTH_ENV_TARGETS = [
		{ id: 'development', label: 'Development' },
		{ id: 'release', label: 'Release' }
	] as const satisfies ReadonlyArray<{ id: AuthEnvTarget; label: string }>;

	interface AuthSettings {
		providers: string[];
		emailAuth: boolean;
		anonymousAuth: boolean;
		allowedRedirectUrls: string[];
		session: {
			accessTokenTTL: string | null;
			refreshTokenTTL: string | null;
			maxActiveSessions: number | null;
		};
		magicLink: {
			enabled: boolean;
			autoCreate: boolean;
			tokenTTL: string | null;
		};
		emailOtp: {
			enabled: boolean;
			autoCreate: boolean;
		};
		passkeys: {
			enabled: boolean;
			rpName: string | null;
			rpID: string | null;
			origin: string[];
		};
		oauth?: Partial<Record<string, {
			clientId: string | null;
			clientSecret: string | null;
		}>>;
	}

	interface SharedAuthSettingsForm {
		emailAuth: boolean;
		anonymousAuth: boolean;
		allowedRedirectUrlsText: string;
		sessionAccessTokenTTL: string;
		sessionRefreshTokenTTL: string;
		sessionMaxActiveSessions: string;
		magicLinkEnabled: boolean;
		magicLinkAutoCreate: boolean;
		magicLinkTokenTTL: string;
		emailOtpEnabled: boolean;
		emailOtpAutoCreate: boolean;
		passkeysEnabled: boolean;
		passkeysRpName: string;
		passkeysRpID: string;
		passkeysOriginText: string;
	}

	type OAuthSettingsForm = Record<OAuthProviderId, {
		enabled: boolean;
		clientId: string;
		clientSecret: string;
	}>;

	type SavePayload = {
		emailAuth: boolean;
		anonymousAuth: boolean;
		allowedOAuthProviders: OAuthProviderId[];
		allowedRedirectUrls: string[];
		session: {
			accessTokenTTL: string | null;
			refreshTokenTTL: string | null;
			maxActiveSessions: number | null;
		};
		magicLink: {
			enabled: boolean;
			autoCreate: boolean;
			tokenTTL: string | null;
		};
		emailOtp: {
			enabled: boolean;
			autoCreate: boolean;
		};
		passkeys: {
			enabled: boolean;
			rpName: string | null;
			rpID: string | null;
			origin: string[];
		};
		oauth: Record<OAuthProviderId, {
			clientId: string | null;
			clientSecret: string | null;
		}>;
	};

	let loading = $state(true);
	let saving = $state(false);
	let editable = $state(false);
	let staleSidecar = $state(false);
	let loadError = $state('');
	let selectedTarget = $state<AuthEnvTarget>('development');
	let sharedForm = $state<SharedAuthSettingsForm | null>(null);
	let savedSharedForm = $state<SharedAuthSettingsForm | null>(null);
	let oauthForms = $state<Record<AuthEnvTarget, OAuthSettingsForm> | null>(null);
	let savedOauthForms = $state<Record<AuthEnvTarget, OAuthSettingsForm> | null>(null);

	function normalizeLines(value: string): string[] {
		return value
			.split(/\r?\n/)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	function normalizeOptionalString(value: string): string | null {
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	}

	function normalizeOptionalNumber(value: string): number | null {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function cloneSharedForm(form: SharedAuthSettingsForm): SharedAuthSettingsForm {
		return { ...form };
	}

	function toSharedForm(data: AuthSettings): SharedAuthSettingsForm {
		return {
			emailAuth: data.emailAuth !== false,
			anonymousAuth: !!data.anonymousAuth,
			allowedRedirectUrlsText: (data.allowedRedirectUrls ?? []).join('\n'),
			sessionAccessTokenTTL: data.session?.accessTokenTTL ?? '',
			sessionRefreshTokenTTL: data.session?.refreshTokenTTL ?? '',
			sessionMaxActiveSessions:
				typeof data.session?.maxActiveSessions === 'number'
					? String(data.session.maxActiveSessions)
					: '',
			magicLinkEnabled: !!data.magicLink?.enabled,
			magicLinkAutoCreate: data.magicLink?.autoCreate !== false,
			magicLinkTokenTTL: data.magicLink?.tokenTTL ?? '',
			emailOtpEnabled: !!data.emailOtp?.enabled,
			emailOtpAutoCreate: data.emailOtp?.autoCreate !== false,
			passkeysEnabled: !!data.passkeys?.enabled,
			passkeysRpName: data.passkeys?.rpName ?? '',
			passkeysRpID: data.passkeys?.rpID ?? '',
			passkeysOriginText: (data.passkeys?.origin ?? []).join('\n')
		};
	}

	function toOAuthForm(data: AuthSettings): OAuthSettingsForm {
		const oauth = {} as OAuthSettingsForm;
		for (const provider of OAUTH_PROVIDERS) {
			const config = data.oauth?.[provider.id];
			oauth[provider.id] = {
				enabled: data.providers.includes(provider.id),
				clientId: config?.clientId ?? '',
				clientSecret: config?.clientSecret ?? ''
			};
		}
		return oauth;
	}

	function cloneOAuthForm(form: OAuthSettingsForm): OAuthSettingsForm {
		const clone = {} as OAuthSettingsForm;
		for (const provider of OAUTH_PROVIDERS) {
			clone[provider.id] = { ...form[provider.id] };
		}
		return clone;
	}

	function buildPath(target: AuthEnvTarget): string {
		return `auth/settings?target=${target}`;
	}

	function buildPayload(
		currentSharedForm: SharedAuthSettingsForm,
		currentOAuthForm: OAuthSettingsForm,
	): SavePayload {
		const allowedOAuthProviders = OAUTH_PROVIDERS
			.filter((provider) => currentOAuthForm[provider.id].enabled)
			.map((provider) => provider.id);

		const oauth = {} as SavePayload['oauth'];
		for (const provider of OAUTH_PROVIDERS) {
			oauth[provider.id] = {
				clientId: normalizeOptionalString(currentOAuthForm[provider.id].clientId),
				clientSecret: normalizeOptionalString(currentOAuthForm[provider.id].clientSecret)
			};
		}

		return {
			emailAuth: currentSharedForm.emailAuth,
			anonymousAuth: currentSharedForm.anonymousAuth,
			allowedOAuthProviders,
			allowedRedirectUrls: normalizeLines(currentSharedForm.allowedRedirectUrlsText),
			session: {
				accessTokenTTL: normalizeOptionalString(currentSharedForm.sessionAccessTokenTTL),
				refreshTokenTTL: normalizeOptionalString(currentSharedForm.sessionRefreshTokenTTL),
				maxActiveSessions: normalizeOptionalNumber(currentSharedForm.sessionMaxActiveSessions)
			},
			magicLink: {
				enabled: currentSharedForm.magicLinkEnabled,
				autoCreate: currentSharedForm.magicLinkAutoCreate,
				tokenTTL: normalizeOptionalString(currentSharedForm.magicLinkTokenTTL)
			},
			emailOtp: {
				enabled: currentSharedForm.emailOtpEnabled,
				autoCreate: currentSharedForm.emailOtpAutoCreate
			},
			passkeys: {
				enabled: currentSharedForm.passkeysEnabled,
				rpName: normalizeOptionalString(currentSharedForm.passkeysRpName),
				rpID: normalizeOptionalString(currentSharedForm.passkeysRpID),
				origin: normalizeLines(currentSharedForm.passkeysOriginText)
			},
			oauth
		};
	}

	function getCurrentOAuthForm(): OAuthSettingsForm | null {
		return oauthForms ? oauthForms[selectedTarget] : null;
	}

	function validateForm(
		currentSharedForm: SharedAuthSettingsForm,
		currentOAuthForm: OAuthSettingsForm,
	): string | null {
		for (const provider of OAUTH_PROVIDERS) {
			const config = currentOAuthForm[provider.id];
			if (!config.enabled) continue;
			if (!config.clientId.trim() || !config.clientSecret.trim()) {
				return `${provider.label} requires both a client ID and client secret.`;
			}
		}

		if (currentSharedForm.passkeysEnabled) {
			if (!currentSharedForm.passkeysRpName.trim() || !currentSharedForm.passkeysRpID.trim()) {
				return 'Passkeys require both RP Name and RP ID.';
			}
			if (normalizeLines(currentSharedForm.passkeysOriginText).length === 0) {
				return 'Passkeys require at least one allowed origin.';
			}
		}

		if (
			currentSharedForm.sessionMaxActiveSessions.trim()
			&& normalizeOptionalNumber(currentSharedForm.sessionMaxActiveSessions) === null
		) {
			return 'Max active sessions must be a valid number.';
		}

		return null;
	}

	function applySettings(
		developmentSettings: AuthSettings,
		releaseSettings?: AuthSettings,
	): void {
		const nextSharedForm = toSharedForm(developmentSettings);
		const nextSavedOauthForms = {
			development: toOAuthForm(developmentSettings),
			release: toOAuthForm(releaseSettings ?? developmentSettings)
		} satisfies Record<AuthEnvTarget, OAuthSettingsForm>;

		savedSharedForm = cloneSharedForm(nextSharedForm);
		sharedForm = cloneSharedForm(nextSharedForm);
		savedOauthForms = {
			development: cloneOAuthForm(nextSavedOauthForms.development),
			release: cloneOAuthForm(nextSavedOauthForms.release)
		};
		oauthForms = {
			development: cloneOAuthForm(nextSavedOauthForms.development),
			release: cloneOAuthForm(nextSavedOauthForms.release)
		};
	}

	function resetForm() {
		if (!savedSharedForm || !savedOauthForms || !oauthForms) return;
		sharedForm = cloneSharedForm(savedSharedForm);
		oauthForms = {
			...oauthForms,
			[selectedTarget]: cloneOAuthForm(savedOauthForms[selectedTarget])
		};
	}

	const hasChanges = $derived(
		(() => {
			const currentOAuthForm = getCurrentOAuthForm();
			if (!sharedForm || !savedSharedForm || !currentOAuthForm || !savedOauthForms) return false;

			return JSON.stringify(buildPayload(sharedForm, currentOAuthForm))
				!== JSON.stringify(buildPayload(savedSharedForm, savedOauthForms[selectedTarget]));
		})()
	);

	const enabledProviderCount = $derived(
		(() => {
			const currentOAuthForm = getCurrentOAuthForm();
			return currentOAuthForm
				? OAUTH_PROVIDERS.filter((provider) => currentOAuthForm[provider.id]?.enabled).length
				: 0;
		})(),
	);

	async function saveSettings() {
		const currentOAuthForm = getCurrentOAuthForm();
		if (!editable || !sharedForm || !currentOAuthForm || !savedOauthForms) return;

		const validationError = validateForm(sharedForm, currentOAuthForm);
		if (validationError) {
			toastError(validationError);
			return;
		}

		saving = true;
		try {
			const payload = buildPayload(sharedForm, currentOAuthForm);
			await api.schemaMutation(buildPath(selectedTarget), {
				method: 'PUT',
				body: payload
			});

			savedSharedForm = cloneSharedForm(sharedForm);
			savedOauthForms = {
				...savedOauthForms,
				[selectedTarget]: cloneOAuthForm(currentOAuthForm)
			};
			oauthForms = {
				...oauthForms!,
				[selectedTarget]: cloneOAuthForm(currentOAuthForm)
			};
			addToast({
				type: 'success',
				message: selectedTarget === 'release'
					? 'Release auth settings saved to edgebase.config.ts and .env.release.'
					: 'Development auth settings saved to edgebase.config.ts and local env files.'
			});
		} catch (err) {
			toastError(describeActionError(err, 'Failed to save auth settings.'));
		} finally {
			saving = false;
		}
	}

	onMount(async () => {
		try {
			await loadDevInfo();
			editable = get(devInfoStore).devMode;
			if (editable) {
				try {
					const developmentSettings = await api.schemaMutation<AuthSettings>(buildPath('development'));
					const releaseSettings = await api.schemaMutation<AuthSettings>(buildPath('release'));
					applySettings(developmentSettings, releaseSettings);
				} catch (err) {
					if (err instanceof ApiError && err.status === 404) {
						staleSidecar = true;
						editable = false;
						addToast({
							type: 'warning',
							message: 'Dev sidecar is outdated. Showing read-only auth settings until you restart `pnpm dev`.'
						});
						const runtimeSettings = await api.fetch<AuthSettings>('data/auth/settings');
						applySettings(runtimeSettings);
					} else {
						throw err;
					}
				}
			} else {
				const runtimeSettings = await api.fetch<AuthSettings>('data/auth/settings');
				applySettings(runtimeSettings);
			}
		} catch (err) {
			loadError = describeActionError(err, 'Failed to load auth settings.');
			toastError(loadError);
		} finally {
			loading = false;
		}
	});
</script>

<PageShell title="Auth Settings" description="Manage authentication methods and OAuth providers" docsHref={authDocs}>
	{#snippet actions()}
		<a href="{base}/auth">
			<Button variant="ghost" size="sm">Back to Users</Button>
		</a>
		{#if editable && sharedForm}
			<Button variant="secondary" size="sm" onclick={resetForm} disabled={!hasChanges || saving}>
				Reset
			</Button>
			<Button size="sm" onclick={saveSettings} disabled={!hasChanges} loading={saving}>
				Save Changes
			</Button>
		{/if}
	{/snippet}

	{#if loading}
		<div class="loading-state">
			<span class="spinner"></span>
			Loading settings...
		</div>
	{:else if !sharedForm || !oauthForms}
		<div class="error-state">{loadError || 'Failed to load authentication settings. Check that the EdgeBase admin API is running and retry.'}</div>
	{:else}
		<div class="settings-grid">
			<div class="card">
				<div class="card__header">
					<div>
						<h3 class="card__title">Core Methods</h3>
						<p class="card__subtitle">Shared across Development and Release.</p>
					</div>
					<Badge variant="default" text="Shared Config" />
				</div>
				<div class="card__body card__body--stack">
					<div class="toggle-row">
						<Toggle label="Email / Password" bind:checked={sharedForm.emailAuth} disabled={!editable} />
						<Badge variant={sharedForm.emailAuth ? 'success' : 'default'} text={sharedForm.emailAuth ? 'Enabled' : 'Disabled'} />
					</div>
					<div class="toggle-row">
						<Toggle label="Anonymous Sign-In" bind:checked={sharedForm.anonymousAuth} disabled={!editable} />
						<Badge variant={sharedForm.anonymousAuth ? 'success' : 'default'} text={sharedForm.anonymousAuth ? 'Enabled' : 'Disabled'} />
					</div>
					<div class="subsection">
						<div class="subsection__row">
							<Toggle label="Magic Link" bind:checked={sharedForm.magicLinkEnabled} disabled={!editable} />
							<Toggle label="Auto-create User" bind:checked={sharedForm.magicLinkAutoCreate} disabled={!editable} />
						</div>
						<Input
							label="Magic Link Token TTL"
							bind:value={sharedForm.magicLinkTokenTTL}
							placeholder="15m"
							disabled={!editable}
						/>
					</div>
					<div class="subsection">
						<div class="subsection__row">
							<Toggle label="Email OTP" bind:checked={sharedForm.emailOtpEnabled} disabled={!editable} />
							<Toggle label="Auto-create User" bind:checked={sharedForm.emailOtpAutoCreate} disabled={!editable} />
						</div>
					</div>
				</div>
			</div>

			<div class="card">
				<div class="card__header">
					<h3 class="card__title">Session</h3>
				</div>
				<div class="card__body card__body--stack">
					<Input
						label="Access Token TTL"
						bind:value={sharedForm.sessionAccessTokenTTL}
						placeholder="15m"
						disabled={!editable}
					/>
					<Input
						label="Refresh Token TTL"
						bind:value={sharedForm.sessionRefreshTokenTTL}
						placeholder="7d"
						disabled={!editable}
					/>
					<Input
						label="Max Active Sessions"
						type="number"
						bind:value={sharedForm.sessionMaxActiveSessions}
						placeholder="Blank = unlimited"
						disabled={!editable}
					/>
				</div>
			</div>

			<div class="card">
				<div class="card__header">
					<div>
						<h3 class="card__title">Passkeys</h3>
						<p class="card__subtitle">Shared across Development and Release.</p>
					</div>
					<Badge variant={sharedForm.passkeysEnabled ? 'success' : 'default'} text={sharedForm.passkeysEnabled ? 'Enabled' : 'Disabled'} />
				</div>
				<div class="card__body card__body--stack">
					<Toggle label="Enable Passkeys" bind:checked={sharedForm.passkeysEnabled} disabled={!editable} />
					<Input label="RP Name" bind:value={sharedForm.passkeysRpName} placeholder="My App" disabled={!editable} />
					<Input label="RP ID" bind:value={sharedForm.passkeysRpID} placeholder="example.com" disabled={!editable} />
					<label class="textarea-field">
						<span class="textarea-field__label">Allowed Origins</span>
						<textarea
							class="textarea-field__input"
							bind:value={sharedForm.passkeysOriginText}
							rows="4"
							placeholder="https://example.com"
							disabled={!editable}
						></textarea>
					</label>
				</div>
			</div>

			<div class="card card--wide">
				<div class="card__header">
					<div>
						<h3 class="card__title">Allowed Redirect URLs</h3>
						<p class="card__subtitle">Shared across Development and Release.</p>
					</div>
					<Badge variant="default" text="Shared Config" />
				</div>
				<div class="card__body">
					<label class="textarea-field">
						<span class="textarea-field__label">One URL or wildcard per line</span>
						<textarea
							class="textarea-field__input"
							bind:value={sharedForm.allowedRedirectUrlsText}
							rows="5"
							placeholder="https://app.example.com/auth/*"
							disabled={!editable}
						></textarea>
					</label>
				</div>
			</div>

			<div class="card card--wide">
				<div class="card__header card__header--wrap">
					<div>
						<h3 class="card__title">OAuth Providers</h3>
						<p class="card__subtitle">Provider allowlists and credentials are stored per target environment.</p>
					</div>
					<div class="oauth-header-controls">
						<Badge variant={enabledProviderCount > 0 ? 'primary' : 'default'} text={`${enabledProviderCount} enabled`} />
						{#if editable}
							<div class="target-switch" role="tablist" aria-label="OAuth environment target">
								{#each AUTH_ENV_TARGETS as target (target.id)}
									<button
										type="button"
										class:target-switch__button--active={selectedTarget === target.id}
										class="target-switch__button"
										role="tab"
										aria-selected={selectedTarget === target.id}
										onclick={() => {
											selectedTarget = target.id;
										}}
									>
										{target.label}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
				<div class="card__body provider-grid">
					{#each OAUTH_PROVIDERS as provider (provider.id)}
						<div class="provider-card">
							<div class="provider-card__header">
								<div>
									<h4 class="provider-card__title">{provider.label}</h4>
									<p class="provider-card__hint">Toggle the provider and set its OAuth credentials.</p>
								</div>
								<div class="provider-card__status">
									<Badge
										variant={oauthForms[selectedTarget][provider.id].enabled ? 'success' : 'default'}
										text={oauthForms[selectedTarget][provider.id].enabled ? 'Enabled' : 'Disabled'}
									/>
									<Toggle
										label={`Enable ${provider.label}`}
										bind:checked={oauthForms[selectedTarget][provider.id].enabled}
										disabled={!editable}
									/>
								</div>
							</div>
							<div class="provider-card__fields">
								<Input
									label="Client ID"
									bind:value={oauthForms[selectedTarget][provider.id].clientId}
									placeholder={`${provider.label} client ID`}
									disabled={!editable}
								/>
								<Input
									label="Client Secret"
									type="password"
									bind:value={oauthForms[selectedTarget][provider.id].clientSecret}
									placeholder={`${provider.label} client secret`}
									disabled={!editable}
								/>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<div class="notice">
			{#if editable}
				Core auth behavior is written to <code>edgebase.config.ts</code> and shared across environments. OAuth provider enablement and secrets follow the selected target: <code>Development</code> writes to <code>.env.development</code> and syncs <code>.dev.vars</code>, while <code>Release</code> writes to <code>.env.release</code>, which the deploy pipeline syncs to Cloudflare secrets.
			{:else if staleSidecar}
				The dashboard detected an older dev sidecar that does not support auth editing yet. Restart <code>pnpm dev</code> to enable edits.
			{:else}
				This dashboard is showing runtime auth configuration only. Editing remains disabled outside local dev mode.
			{/if}
		</div>
	{/if}
</PageShell>

<style>
	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-7);
		color: var(--color-text-secondary);
	}

	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-state {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-danger);
	}

	.settings-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: var(--space-4);
	}

	.card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg);
		overflow: hidden;
	}

	.card--wide {
		grid-column: 1 / -1;
	}

	.card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		background-color: var(--color-bg-secondary);
	}

	.card__header--wrap {
		flex-wrap: wrap;
		align-items: flex-start;
	}

	.card__title {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.card__subtitle {
		margin: var(--space-1) 0 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.card__body {
		padding: var(--space-4);
	}

	.card__body--stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.subsection {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--color-border);
	}

	.subsection__row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}

	.textarea-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.textarea-field__label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text);
	}

	.textarea-field__input {
		width: 100%;
		box-sizing: border-box;
		padding: var(--space-2) var(--space-3);
		font-size: 0.875rem;
		font-family: var(--font-mono);
		line-height: 1.4;
		color: var(--color-text);
		background-color: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		resize: vertical;
	}

	.textarea-field__input:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.provider-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: var(--space-3);
	}

	.oauth-header-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}

	.target-switch {
		display: inline-flex;
		padding: 2px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg);
	}

	.target-switch__button {
		border: 0;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 999px;
		padding: 0.35rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.target-switch__button--active {
		background: var(--color-primary);
		color: var(--color-primary-foreground, white);
	}

	.provider-card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		background: color-mix(in srgb, var(--color-bg) 92%, var(--color-bg-secondary));
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.provider-card__header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.provider-card__title {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.provider-card__hint {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.provider-card__status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.provider-card__fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.notice {
		margin-top: var(--space-5);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	@media (min-width: 720px) {
		.provider-card__header {
			flex-direction: row;
			align-items: flex-start;
			justify-content: space-between;
		}
	}
</style>
