import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	type AuthState = {
		accessToken: string | null;
		refreshToken: string | null;
		admin: { id: string; email: string } | null;
	};

	let authState: AuthState = {
		accessToken: null,
		refreshToken: null,
		admin: null,
	};
	const subscribers = new Set<(value: AuthState) => void>();

	return {
		authStore: {
			subscribe(run: (value: AuthState) => void) {
				run(authState);
				subscribers.add(run);
				return () => subscribers.delete(run);
			},
			set(value: AuthState) {
				authState = value;
				for (const subscriber of subscribers) subscriber(authState);
			},
		},
		getAdminApiUrl: vi.fn((path = '') => `http://admin.test/admin/api/${path}`),
	};
});

vi.mock('$lib/stores/auth', () => ({
	authStore: mocks.authStore,
}));

vi.mock('$lib/runtime-config', () => ({
	getAdminApiUrl: mocks.getAdminApiUrl,
}));

describe('devInfoStore', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllGlobals();
		mocks.authStore.set({
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			admin: { id: 'admin_1', email: 'admin@example.com' },
		});
		mocks.getAdminApiUrl.mockClear();
		mocks.getAdminApiUrl.mockImplementation((path = '') => `http://admin.test/admin/api/${path}`);
	});

	it('does not cache a 401 so the request can be retried after auth is ready', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
		const { devInfoStore, loadDevInfo } = await import('./devInfo');

		let snapshot: { devMode: boolean; sidecarPort: number | null; loaded: boolean } | undefined;
		const unsubscribe = devInfoStore.subscribe((value) => {
			snapshot = value;
		});

		await loadDevInfo();
		expect(snapshot).toEqual({ devMode: false, sidecarPort: null, loaded: false });
		unsubscribe();
	});

	it('caches successful responses and skips duplicate network requests until reset', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			devMode: true,
			sidecarPort: 4312,
		}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
		vi.stubGlobal('fetch', fetchMock);

		const { devInfoStore, loadDevInfo, resetDevInfo } = await import('./devInfo');
		let snapshot: { devMode: boolean; sidecarPort: number | null; loaded: boolean } | undefined;
		const unsubscribe = devInfoStore.subscribe((value) => {
			snapshot = value;
		});

		await loadDevInfo();
		await loadDevInfo();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			'http://admin.test/admin/api/data/dev-info',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer access-token',
				}),
			}),
		);
		expect(snapshot).toEqual({ devMode: true, sidecarPort: 4312, loaded: true });

		resetDevInfo();
		expect(snapshot).toEqual({ devMode: false, sidecarPort: null, loaded: false });
		unsubscribe();
	});

	it('falls back to production mode when the request fails or returns a non-auth error', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(null, { status: 500 }))
			.mockRejectedValueOnce(new Error('network down'));
		vi.stubGlobal('fetch', fetchMock);

		const firstModule = await import('./devInfo');
		await firstModule.loadDevInfo();

		let snapshot:
			| { devMode: boolean; sidecarPort: number | null; loaded: boolean }
			| undefined;
		const unsubscribe = firstModule.devInfoStore.subscribe((value) => {
			snapshot = value;
		});
		expect(snapshot).toEqual({ devMode: false, sidecarPort: null, loaded: true });
		unsubscribe();

		vi.resetModules();
		const secondModule = await import('./devInfo');
		await secondModule.loadDevInfo();
		let secondSnapshot:
			| { devMode: boolean; sidecarPort: number | null; loaded: boolean }
			| undefined;
		const stop = secondModule.devInfoStore.subscribe((value) => {
			secondSnapshot = value;
		});
		expect(secondSnapshot).toEqual({ devMode: false, sidecarPort: null, loaded: true });
		stop();
	});

	it('resets cached dev info when the auth session changes after initialization', async () => {
		mocks.authStore.set({
			accessToken: null,
			refreshToken: null,
			admin: null,
		});

		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(null, { status: 500 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				devMode: true,
				sidecarPort: 4312,
			}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
		vi.stubGlobal('fetch', fetchMock);

		const { devInfoStore, loadDevInfo } = await import('./devInfo');
		let snapshot:
			| { devMode: boolean; sidecarPort: number | null; loaded: boolean }
			| undefined;
		const unsubscribe = devInfoStore.subscribe((value) => {
			snapshot = value;
		});

		await loadDevInfo();
		expect(snapshot).toEqual({ devMode: false, sidecarPort: null, loaded: true });

		mocks.authStore.set({
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			admin: { id: 'admin_1', email: 'admin@example.com' },
		});
		expect(snapshot).toEqual({ devMode: false, sidecarPort: null, loaded: false });

		await loadDevInfo();
		expect(snapshot).toEqual({ devMode: true, sidecarPort: 4312, loaded: true });

		mocks.authStore.set({
			accessToken: null,
			refreshToken: null,
			admin: null,
		});
		expect(snapshot).toEqual({ devMode: false, sidecarPort: null, loaded: false });
		unsubscribe();
	});
});
