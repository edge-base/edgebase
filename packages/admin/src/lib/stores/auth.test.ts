import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getAdminApiUrl: vi.fn((path = '') => `http://admin.test/admin/api/${path}`),
}));

vi.mock('$lib/runtime-config', () => ({
	getAdminApiUrl: mocks.getAdminApiUrl,
}));

describe('authStore', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.resetModules();
		vi.unstubAllGlobals();
		mocks.getAdminApiUrl.mockClear();
		mocks.getAdminApiUrl.mockImplementation((path = '') => `http://admin.test/admin/api/${path}`);
	});

	it('hydrates from storage and clears corrupt persisted state', async () => {
		localStorage.setItem('edgebase_admin_auth', JSON.stringify({
			accessToken: 'stored-access',
			refreshToken: 'stored-refresh',
			admin: { id: 'admin_1', email: 'stored@example.com' },
		}));

		const { authStore, ADMIN_AUTH_STORAGE_KEY } = await import('./auth');
		let snapshot: { accessToken: string | null; refreshToken: string | null; admin: { id: string; email: string } | null } | undefined;
		const unsubscribe = authStore.subscribe((value) => {
			snapshot = value;
		});

		expect(snapshot).toEqual({
			accessToken: 'stored-access',
			refreshToken: 'stored-refresh',
			admin: { id: 'admin_1', email: 'stored@example.com' },
		});
		unsubscribe();

		vi.resetModules();
		localStorage.setItem(ADMIN_AUTH_STORAGE_KEY, '{bad-json');

		const { authStore: reloadedStore } = await import('./auth');
		let reloadedSnapshot:
			| { accessToken: string | null; refreshToken: string | null; admin: { id: string; email: string } | null }
			| undefined;
		const stop = reloadedStore.subscribe((value) => {
			reloadedSnapshot = value;
		});

		expect(reloadedSnapshot).toEqual({
			accessToken: null,
			refreshToken: null,
			admin: null,
		});
		expect(localStorage.getItem(ADMIN_AUTH_STORAGE_KEY)).toBeNull();
		stop();
	});

	it('logs in, refreshes, and logs out while keeping storage in sync', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({
				accessToken: 'access-1',
				refreshToken: 'refresh-1',
				admin: { id: 'admin_1', email: 'admin@example.com' },
			}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				accessToken: 'access-2',
				refreshToken: 'refresh-2',
				admin: { id: 'admin_1', email: 'admin@example.com' },
			}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
		vi.stubGlobal('fetch', fetchMock);

		const { authStore, ADMIN_AUTH_STORAGE_KEY } = await import('./auth');
		let snapshot:
			| { accessToken: string | null; refreshToken: string | null; admin: { id: string; email: string } | null }
			| undefined;
		const unsubscribe = authStore.subscribe((value) => {
			snapshot = value;
		});

		await authStore.login('admin@example.com', 'Password123!');
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			'http://admin.test/admin/api/auth/login',
			expect.objectContaining({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		expect(snapshot).toEqual({
			accessToken: 'access-1',
			refreshToken: 'refresh-1',
			admin: { id: 'admin_1', email: 'admin@example.com' },
		});
		expect(JSON.parse(localStorage.getItem(ADMIN_AUTH_STORAGE_KEY) ?? '{}')).toMatchObject({
			accessToken: 'access-1',
			refreshToken: 'refresh-1',
		});

		await expect(authStore.refresh()).resolves.toBe(true);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			'http://admin.test/admin/api/auth/refresh',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({ refreshToken: 'refresh-1' }),
			}),
		);
		expect(snapshot?.accessToken).toBe('access-2');

		authStore.logout();
		expect(snapshot).toEqual({
			accessToken: null,
			refreshToken: null,
			admin: null,
		});
		expect(localStorage.getItem(ADMIN_AUTH_STORAGE_KEY)).toBeNull();
		unsubscribe();
	});

	it('returns false when refresh cannot proceed or the backend rejects it', async () => {
		const { authStore } = await import('./auth');
		const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(authStore.refresh()).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();

		authStore.set({
			accessToken: 'access',
			refreshToken: 'refresh',
			admin: { id: 'admin_1', email: 'admin@example.com' },
		});

		await expect(authStore.refresh()).resolves.toBe(false);
		expect(fetchMock).toHaveBeenCalledTimes(1);
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
