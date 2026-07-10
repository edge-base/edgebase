import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAdminApiUrl: vi.fn((path = '') => `http://admin.test/admin/api/${path}`),
}));

vi.mock('$lib/runtime-config', () => ({
	getAdminApiUrl: mocks.getAdminApiUrl,
}));

type Snapshot = {
	accessToken: string | null;
	admin: { id: string; email: string } | null;
};

function sessionResponse(accessToken: string) {
	return new Response(JSON.stringify({
		accessToken,
		admin: { id: 'admin_1', email: 'admin@example.com' },
		sessionTransport: 'cookie',
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('authStore HttpOnly-cookie sessions', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.unstubAllGlobals();
		localStorage.clear();
		sessionStorage.clear();
		mocks.getAdminApiUrl.mockClear();
		mocks.getAdminApiUrl.mockImplementation((path = '') => `http://admin.test/admin/api/${path}`);
	});

	it('removes legacy browser tokens immediately and migrates one refresh token to the cookie', async () => {
		localStorage.setItem('edgebase_admin_auth', JSON.stringify({
			accessToken: 'stored-access',
			refreshToken: 'stored-refresh',
			admin: { id: 'admin_1', email: 'stored@example.com' },
		}));
		sessionStorage.setItem('edgebase_admin_auth', JSON.stringify({
			accessToken: 'session-access',
			refreshToken: 'session-refresh',
		}));
		const fetchMock = vi.fn().mockResolvedValue(sessionResponse('fresh-access'));
		vi.stubGlobal('fetch', fetchMock);

		const { authStore } = await import('./auth');
		expect(localStorage.getItem('edgebase_admin_auth')).toBeNull();
		expect(sessionStorage.getItem('edgebase_admin_auth')).toBeNull();

		await expect(authStore.initialize()).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledWith(
			'http://admin.test/admin/api/auth/refresh',
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
					'X-EdgeBase-Auth-Transport': 'cookie',
				},
				body: JSON.stringify({ refreshToken: 'stored-refresh' }),
			}),
		);
		let snapshot: Snapshot | undefined;
		const stop = authStore.subscribe((value) => { snapshot = value; });
		expect(snapshot).toEqual({
			accessToken: 'fresh-access',
			admin: { id: 'admin_1', email: 'admin@example.com' },
		});
		expect(localStorage.getItem('edgebase_admin_auth')).toBeNull();
		expect(sessionStorage.getItem('edgebase_admin_auth')).toBeNull();
		stop();
	});

	it('logs in, refreshes, and logs out with memory-only access state', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(sessionResponse('access-1'))
			.mockResolvedValueOnce(sessionResponse('access-2'))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}));
		vi.stubGlobal('fetch', fetchMock);

		const { authStore, ADMIN_AUTH_STORAGE_KEY } = await import('./auth');
		let snapshot: Snapshot | undefined;
		const unsubscribe = authStore.subscribe((value) => { snapshot = value; });

		await authStore.login('admin@example.com', 'Password123!');
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			'http://admin.test/admin/api/auth/login',
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
				body: JSON.stringify({ email: 'admin@example.com', password: 'Password123!' }),
			}),
		);
		expect(snapshot?.accessToken).toBe('access-1');
		expect(localStorage.getItem(ADMIN_AUTH_STORAGE_KEY)).toBeNull();

		await expect(authStore.refresh()).resolves.toBe(true);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			'http://admin.test/admin/api/auth/refresh',
			expect.objectContaining({ body: JSON.stringify({}), credentials: 'include' }),
		);
		expect(snapshot?.accessToken).toBe('access-2');

		const logout = authStore.logout();
		expect(snapshot).toEqual({ accessToken: null, admin: null });
		await logout;
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			'http://admin.test/admin/api/auth/logout',
			expect.objectContaining({ body: JSON.stringify({}), credentials: 'include' }),
		);
		expect(localStorage.getItem(ADMIN_AUTH_STORAGE_KEY)).toBeNull();
		expect(sessionStorage.getItem(ADMIN_AUTH_STORAGE_KEY)).toBeNull();
		unsubscribe();
	});

	it('single-flights refresh and clears memory on a definitive rejection', async () => {
		let resolveResponse!: (response: Response) => void;
		const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
			resolveResponse = resolve;
		}));
		vi.stubGlobal('fetch', fetchMock);
		const { authStore } = await import('./auth');
		authStore.set({
			accessToken: 'access',
			admin: { id: 'admin_1', email: 'admin@example.com' },
		});

		const first = authStore.refresh();
		const second = authStore.refresh();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		resolveResponse(new Response(null, { status: 401 }));
		await expect(Promise.all([first, second])).resolves.toEqual([false, false]);

		let snapshot: Snapshot | undefined;
		const stop = authStore.subscribe((value) => { snapshot = value; });
		expect(snapshot).toEqual({ accessToken: null, admin: null });
		stop();
	});

	it('does not let a late refresh reopen state after local-first logout', async () => {
		let resolveRefresh!: (response: Response) => void;
		const fetchMock = vi.fn()
			.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRefresh = resolve; }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const { authStore } = await import('./auth');
		authStore.set({
			accessToken: 'stale-access',
			admin: { id: 'admin_1', email: 'admin@example.com' },
		});

		const refresh = authStore.refresh();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const logout = authStore.logout();
		resolveRefresh(sessionResponse('late-access'));
		await expect(refresh).resolves.toBe(false);
		await logout;

		let snapshot: Snapshot | undefined;
		const stop = authStore.subscribe((value) => { snapshot = value; });
		expect(snapshot).toEqual({ accessToken: null, admin: null });
		stop();
	});

	it('bounds hung login, setup, refresh, and logout requests and releases the fallback lease', async () => {
		vi.useFakeTimers();
		try {
			const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
			vi.stubGlobal('fetch', fetchMock);
			const { authStore, ADMIN_LOGOUT_PENDING_KEY } = await import('./auth');

			const loginExpectation = expect(
				authStore.login('admin@example.com', 'Password123!'),
			).rejects.toThrow('Admin session request timed out');
			await vi.advanceTimersByTimeAsync(15_050);
			await loginExpectation;
			expect(localStorage.getItem('edgebase_admin_refresh_lease')).toBeNull();

			const setupExpectation = expect(
				authStore.setup('admin@example.com', 'Password123!'),
			).rejects.toThrow('Admin session request timed out');
			await vi.advanceTimersByTimeAsync(15_050);
			await setupExpectation;
			expect(localStorage.getItem('edgebase_admin_refresh_lease')).toBeNull();

			await expect((async () => {
				const result = authStore.refresh();
				await vi.advanceTimersByTimeAsync(15_050);
				return result;
			})()).resolves.toBe(false);
			expect(localStorage.getItem('edgebase_admin_refresh_lease')).toBeNull();

			const logout = authStore.logout();
			await vi.advanceTimersByTimeAsync(15_050);
			await expect(logout).resolves.toBeUndefined();
			expect(localStorage.getItem('edgebase_admin_refresh_lease')).toBeNull();
			expect(localStorage.getItem(ADMIN_LOGOUT_PENDING_KEY)).not.toBeNull();
			expect(fetchMock).toHaveBeenCalledTimes(4);
		} finally {
			vi.useRealTimers();
		}
	});

	it('times out a headers-only login response whose body never completes', async () => {
		vi.useFakeTimers();
		try {
			const stalledBody = new ReadableStream<Uint8Array>({ start() { /* never close */ } });
			vi.stubGlobal('fetch', vi.fn(async () => new Response(stalledBody, {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})));
			const { authStore } = await import('./auth');

			const login = expect(
				authStore.login('admin@example.com', 'Password123!'),
			).rejects.toThrow('Admin session request timed out');
			await vi.advanceTimersByTimeAsync(15_050);
			await login;
			expect(localStorage.getItem('edgebase_admin_refresh_lease')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('aborts a hung login before revoking on local-first logout', async () => {
		let loginStarted!: () => void;
		const started = new Promise<void>((resolve) => { loginStarted = resolve; });
		const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
			if (String(input).endsWith('/auth/login')) {
				loginStarted();
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						reject(new DOMException('Aborted', 'AbortError'));
					}, { once: true });
				});
			}
			return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		});
		vi.stubGlobal('fetch', fetchMock);
		const { authStore, ADMIN_LOGOUT_PENDING_KEY } = await import('./auth');

		const login = authStore.login('admin@example.com', 'Password123!');
		await started;
		const logout = authStore.logout();
		await expect(login).rejects.toThrow('Admin session request was cancelled');
		await expect(logout).resolves.toBeUndefined();

		expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
			'http://admin.test/admin/api/auth/login',
			'http://admin.test/admin/api/auth/logout',
		]);
		expect(localStorage.getItem(ADMIN_LOGOUT_PENDING_KEY)).toBeNull();
	});

	it('serializes rotating-cookie refreshes across independent tab stores', async () => {
		let lockTail = Promise.resolve<unknown>(undefined);
		const lockRequest = vi.fn((
			_name: string,
			_options: LockOptions,
			callback: () => Promise<unknown>,
		) => {
			const result = lockTail.then(callback);
			lockTail = result.then(() => undefined, () => undefined);
			return result;
		});
		vi.stubGlobal('navigator', { locks: { request: lockRequest } });

		let resolveFirst!: (response: Response) => void;
		const fetchMock = vi.fn()
			.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveFirst = resolve; }))
			.mockResolvedValueOnce(sessionResponse('tab-2-access'));
		vi.stubGlobal('fetch', fetchMock);

		const firstTab = await import('./auth');
		vi.resetModules();
		const secondTab = await import('./auth');
		const firstRefresh = firstTab.authStore.refresh();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const secondRefresh = secondTab.authStore.refresh();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fetchMock).toHaveBeenCalledTimes(1);

		resolveFirst(sessionResponse('tab-1-access'));
		await expect(firstRefresh).resolves.toBe(true);
		await expect(secondRefresh).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(lockRequest).toHaveBeenCalledTimes(2);
	});

	it('verifies fallback lease ownership before either contender enters', async () => {
		const firstTab = await import('./auth');
		vi.resetModules();
		const secondTab = await import('./auth');
		const entries: string[] = [];
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

		const first = firstTab.withAdminSessionLock(async () => {
			entries.push('first-enter');
			await firstGate;
			entries.push('first-exit');
		});
		const second = secondTab.withAdminSessionLock(async () => {
			entries.push('second-enter');
		});

		await vi.waitFor(() => expect(entries).toEqual(['first-enter']));
		expect(localStorage.getItem('edgebase_admin_refresh_lease')).not.toBeNull();
		releaseFirst();
		await Promise.all([first, second]);

		expect(entries).toEqual(['first-enter', 'first-exit', 'second-enter']);
		expect(localStorage.getItem('edgebase_admin_refresh_lease')).toBeNull();
	});

	it('invalidates another tab immediately when the shared cookie principal changes', async () => {
		const responseFor = (adminId: string, accessToken: string) => new Response(JSON.stringify({
			accessToken,
			admin: { id: adminId, email: `${adminId}@example.com` },
			sessionTransport: 'cookie',
		}), { status: 200, headers: { 'Content-Type': 'application/json' } });
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(responseFor('admin-a', 'access-a'))
			.mockResolvedValueOnce(responseFor('admin-b', 'access-b'))
			.mockResolvedValueOnce(responseFor('admin-b', 'access-b-verified'));
		vi.stubGlobal('fetch', fetchMock);

		const firstTab = await import('./auth');
		vi.resetModules();
		const secondTab = await import('./auth');
		await firstTab.authStore.login('a@example.com', 'Password123!');
		await secondTab.authStore.login('b@example.com', 'Password123!');

		firstTab.handleAdminAuthStorageEvent(new StorageEvent('storage', {
			key: secondTab.ADMIN_SESSION_MARKER_KEY,
			newValue: localStorage.getItem(secondTab.ADMIN_SESSION_MARKER_KEY),
		}));
		await expect(firstTab.authStore.refresh()).resolves.toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(3);

		let firstSnapshot: Snapshot | undefined;
		const stop = firstTab.authStore.subscribe((value) => { firstSnapshot = value; });
		await vi.waitFor(() => expect(firstSnapshot).toEqual({
			accessToken: 'access-b-verified',
			admin: { id: 'admin-b', email: 'admin-b@example.com' },
		}));
		expect(localStorage.getItem(secondTab.ADMIN_SESSION_MARKER_KEY)).toBe(
			JSON.stringify({ version: 1, adminId: 'admin-b' }),
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(fetchMock).toHaveBeenCalledTimes(3);
		stop();
	});

	it('keeps a non-secret pending-logout marker and blocks reload restore after network failure', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
		vi.stubGlobal('fetch', fetchMock);
		const firstLoad = await import('./auth');

		await firstLoad.authStore.logout();
		expect(localStorage.getItem(firstLoad.ADMIN_LOGOUT_PENDING_KEY)).not.toBeNull();

		vi.resetModules();
		const reloaded = await import('./auth');
		await expect(reloaded.authStore.initialize()).resolves.toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const call of fetchMock.mock.calls) {
			expect(call[0]).toBe('http://admin.test/admin/api/auth/logout');
		}
		expect(localStorage.getItem(reloaded.ADMIN_LOGOUT_PENDING_KEY)).not.toBeNull();

		fetchMock.mockReset()
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
			.mockResolvedValueOnce(sessionResponse('new-login-access'));
		await reloaded.authStore.login('admin@example.com', 'Password123!');
		expect(localStorage.getItem(reloaded.ADMIN_LOGOUT_PENDING_KEY)).toBeNull();
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			'http://admin.test/admin/api/auth/login',
			expect.objectContaining({ credentials: 'include' }),
		);
	});

	it('surfaces setup and login failures with friendly errors', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Email already exists' }), {
				status: 409,
				headers: { 'Content-Type': 'application/json' },
			}))
			.mockResolvedValueOnce(new Response('not-json', { status: 500 }));
		vi.stubGlobal('fetch', fetchMock);

		const { authStore } = await import('./auth');
		await expect(authStore.setup('admin@example.com', 'Password123!')).rejects.toThrow('Email already exists');
		await expect(authStore.login('admin@example.com', 'bad-password')).rejects.toThrow(
			'Login failed. Please check your email and password.',
		);
	});
});
