import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	type DevInfoState = { devMode: boolean; sidecarPort: number | null; loaded: boolean };
	let devInfoState: DevInfoState = { devMode: true, sidecarPort: 4312, loaded: true };
	const subscribers = new Set<(value: DevInfoState) => void>();

	return {
		apiFetch: vi.fn(),
		schemaMutation: vi.fn(),
		ApiError: class ApiError extends Error {
			status: number;
			code: number | string;

			constructor(status: number, code: number | string, message: string) {
				super(message);
				this.name = 'ApiError';
				this.status = status;
				this.code = code;
			}
		},
		toastError: vi.fn(),
		addToast: vi.fn(),
		loadDevInfo: vi.fn().mockResolvedValue(undefined),
		devInfoStore: {
			subscribe(run: (value: DevInfoState) => void) {
				run(devInfoState);
				subscribers.add(run);
				return () => subscribers.delete(run);
			},
		},
		setDevMode(value: boolean) {
			devInfoState = { devMode: value, sidecarPort: value ? 4312 : null, loaded: true };
			for (const run of subscribers) run(devInfoState);
		},
	};
});

vi.mock('$app/paths', () => ({
	base: '/admin',
}));

vi.mock('$lib/api', () => ({
	ApiError: mocks.ApiError,
	api: {
		fetch: mocks.apiFetch,
		schemaMutation: mocks.schemaMutation,
	},
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastError: mocks.toastError,
	addToast: mocks.addToast,
}));

vi.mock('$lib/stores/devInfo', () => ({
	devInfoStore: mocks.devInfoStore,
	loadDevInfo: mocks.loadDevInfo,
}));

import AuthSettingsPage from './+page.svelte';

function buildSettings(overrides: Record<string, unknown> = {}) {
	return {
		providers: ['google'],
		emailAuth: true,
		anonymousAuth: false,
		allowedRedirectUrls: ['https://app.example.com/auth/*'],
		session: {
			accessTokenTTL: '15m',
			refreshTokenTTL: '14d',
			maxActiveSessions: 5,
		},
		magicLink: {
			enabled: true,
			autoCreate: false,
			tokenTTL: '20m',
		},
		emailOtp: {
			enabled: false,
			autoCreate: true,
		},
		passkeys: {
			enabled: true,
			rpName: 'JuneBase',
			rpID: 'edgebase.fun',
			origin: ['https://edgebase.fun'],
		},
		oauth: {
			google: {
				clientId: 'gid',
				clientSecret: 'gsecret',
			},
		},
		...overrides,
	};
}

describe('auth settings page', () => {
	beforeEach(() => {
		mocks.apiFetch.mockReset();
		mocks.schemaMutation.mockReset();
		mocks.toastError.mockReset();
		mocks.addToast.mockReset();
		mocks.loadDevInfo.mockClear();
		mocks.setDevMode(true);
	});

	it('loads development and release oauth settings and saves the selected target through the sidecar', async () => {
		mocks.schemaMutation.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
			if (path === 'auth/settings?target=development' && !opts?.method) {
				return Promise.resolve(buildSettings());
			}

			if (path === 'auth/settings?target=release' && !opts?.method) {
				return Promise.resolve(buildSettings({
					providers: ['google', 'github'],
					oauth: {
						google: {
							clientId: 'release-gid',
							clientSecret: 'release-gsecret',
						},
						github: {
							clientId: 'release-ghid',
							clientSecret: 'release-ghsecret',
						},
					},
				}));
			}

			if (path === 'auth/settings?target=release' && opts?.method === 'PUT') {
				return Promise.resolve({ ok: true });
			}

			return Promise.reject(new Error(`Unexpected call: ${path}`));
		});

		render(AuthSettingsPage);

		expect(await screen.findByDisplayValue('gid')).toBeInTheDocument();
		expect(screen.queryByDisplayValue('release-gid')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('tab', { name: 'Release' }));
		expect(await screen.findByDisplayValue('release-gid')).toBeInTheDocument();
		expect(screen.getByDisplayValue('release-ghid')).toBeInTheDocument();

		await fireEvent.input(screen.getByPlaceholderText('GitHub client secret'), {
			target: { value: 'release-ghsecret-next' },
		});

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

		await waitFor(() => {
			expect(mocks.schemaMutation).toHaveBeenCalledWith('auth/settings?target=release', {
				method: 'PUT',
				body: expect.objectContaining({
					emailAuth: true,
					allowedOAuthProviders: ['google', 'github'],
					oauth: expect.objectContaining({
						github: {
							clientId: 'release-ghid',
							clientSecret: 'release-ghsecret-next',
						},
					}),
				}),
			});
		});

		expect(mocks.addToast).toHaveBeenCalledWith({
			type: 'success',
			message: 'Release auth settings saved to edgebase.config.ts and .env.release.',
		});
	});

	it('includes newly enabled oauth providers in the save payload', async () => {
		mocks.schemaMutation.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
			if (path === 'auth/settings?target=development' && !opts?.method) {
				return Promise.resolve(buildSettings({
					providers: ['google'],
					oauth: {
						google: {
							clientId: 'gid',
							clientSecret: 'gsecret',
						},
						discord: {
							clientId: 'did',
							clientSecret: 'dsecret',
						},
					},
				}));
			}

			if (path === 'auth/settings?target=release' && !opts?.method) {
				return Promise.resolve(buildSettings({
					providers: ['google'],
					oauth: {
						google: {
							clientId: 'release-gid',
							clientSecret: 'release-gsecret',
						},
					},
				}));
			}

			if (path === 'auth/settings?target=development' && opts?.method === 'PUT') {
				return Promise.resolve({ ok: true });
			}

			return Promise.reject(new Error(`Unexpected call: ${path}`));
		});

		render(AuthSettingsPage);

		expect(await screen.findByDisplayValue('did')).toBeInTheDocument();

		const discordToggle = screen.getByRole('switch', { name: 'Enable Discord' });
		expect(discordToggle).toHaveAttribute('aria-checked', 'false');

		await fireEvent.click(discordToggle);

		await waitFor(() => {
			expect(discordToggle).toHaveAttribute('aria-checked', 'true');
			expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

		await waitFor(() => {
			expect(mocks.schemaMutation).toHaveBeenCalledWith('auth/settings?target=development', {
				method: 'PUT',
				body: expect.objectContaining({
					allowedOAuthProviders: ['google', 'discord'],
				}),
			});
		});
	});

	it('falls back to read-only worker data outside dev mode', async () => {
		mocks.setDevMode(false);
		mocks.apiFetch.mockResolvedValue(buildSettings({
			providers: ['google', 'github'],
			anonymousAuth: true,
			allowedRedirectUrls: [],
			session: {
				accessTokenTTL: '15m',
				refreshTokenTTL: '7d',
				maxActiveSessions: null,
			},
			magicLink: {
				enabled: false,
				autoCreate: true,
				tokenTTL: null,
			},
			emailOtp: {
				enabled: false,
				autoCreate: true,
			},
			passkeys: {
				enabled: false,
				rpName: null,
				rpID: null,
				origin: [],
			},
			oauth: {},
		}));

		render(AuthSettingsPage);

		expect(await screen.findByText(/runtime auth configuration only/i)).toBeInTheDocument();
		expect(mocks.apiFetch).toHaveBeenCalledWith('data/auth/settings');
		expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Release' })).not.toBeInTheDocument();
	});

	it('falls back to read-only data when the dev sidecar is stale', async () => {
		mocks.schemaMutation.mockRejectedValue(new mocks.ApiError(404, 'UNKNOWN', 'missing route'));
		mocks.apiFetch.mockResolvedValue(buildSettings({
			allowedRedirectUrls: [],
			session: {
				accessTokenTTL: '15m',
				refreshTokenTTL: '7d',
				maxActiveSessions: null,
			},
			magicLink: {
				enabled: false,
				autoCreate: true,
				tokenTTL: null,
			},
			emailOtp: {
				enabled: false,
				autoCreate: true,
			},
			passkeys: {
				enabled: false,
				rpName: null,
				rpID: null,
				origin: [],
			},
			oauth: {},
		}));

		render(AuthSettingsPage);

		expect(await screen.findByText(/older dev sidecar/i)).toBeInTheDocument();
		expect(mocks.apiFetch).toHaveBeenCalledWith('data/auth/settings');
		expect(mocks.addToast).toHaveBeenCalledWith({
			type: 'warning',
			message: 'Dev sidecar is outdated. Showing read-only auth settings until you restart `pnpm dev`.',
		});
		expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
	});

	it('shows an error state when auth settings cannot be loaded', async () => {
		mocks.schemaMutation.mockRejectedValue(new Error('settings down'));

		render(AuthSettingsPage);

		await waitFor(() => {
			expect(mocks.toastError).toHaveBeenCalledWith('settings down');
		});
		expect(await screen.findByText('settings down')).toBeInTheDocument();
	});
});
