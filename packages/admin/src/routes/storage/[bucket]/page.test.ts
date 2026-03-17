import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	let pageState = {
		params: { bucket: 'avatars' },
		url: new URL('http://localhost/admin/storage/avatars?prefix=folder/'),
	};
	const pageSubscribers = new Set<(value: typeof pageState) => void>();

	type AuthState = {
		accessToken: string | null;
		refreshToken: string | null;
		admin: { id: string; email: string } | null;
	};

	let authState: AuthState = {
		accessToken: 'access-token',
		refreshToken: 'refresh-token',
		admin: { id: 'admin_1', email: 'admin@example.com' },
	};
	const authSubscribers = new Set<(value: AuthState) => void>();

	return {
		page: {
			subscribe(run: (value: typeof pageState) => void) {
				run(pageState);
				pageSubscribers.add(run);
				return () => pageSubscribers.delete(run);
			},
			set(url: string) {
				pageState = {
					params: { bucket: 'avatars' },
					url: new URL(url, 'http://localhost'),
				};
				for (const subscriber of pageSubscribers) subscriber(pageState);
			},
		},
		authStore: {
			subscribe(run: (value: AuthState) => void) {
				run(authState);
				authSubscribers.add(run);
				return () => authSubscribers.delete(run);
			},
			set(value: AuthState) {
				authState = value;
				for (const subscriber of authSubscribers) subscriber(authState);
			},
		},
		apiFetch: vi.fn(),
		toastSuccess: vi.fn(),
		toastError: vi.fn(),
		getAdminApiUrl: vi.fn((path = '') => `http://admin.test/admin/api/${path}`),
	};
});

vi.mock('$app/stores', () => ({
	page: mocks.page,
}));

vi.mock('$lib/api', () => ({
	api: {
		fetch: mocks.apiFetch,
	},
}));

vi.mock('$lib/runtime-config', () => ({
	ADMIN_APP_BASE_PATH: '/admin',
	getAdminApiUrl: mocks.getAdminApiUrl,
}));

vi.mock('$lib/stores/auth', () => ({
	authStore: mocks.authStore,
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastSuccess: mocks.toastSuccess,
	toastError: mocks.toastError,
}));

vi.mock('$lib/components/ui/AuthImage.svelte', async () => ({
	default: (await import('../../../test/fixtures/MockAuthImage.svelte')).default,
}));

import BucketPage from './+page.svelte';

describe('bucket page', () => {
	beforeEach(() => {
		mocks.page.set('/admin/storage/avatars?prefix=folder/');
		mocks.apiFetch.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
		mocks.getAdminApiUrl.mockClear();
		mocks.getAdminApiUrl.mockImplementation((path = '') => `http://admin.test/admin/api/${path}`);
		vi.unstubAllGlobals();
		vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
	});

	it('loads the current prefix, navigates folders, and appends more files', async () => {
		mocks.apiFetch.mockImplementation((path: string) => {
			if (path === 'data/storage/buckets/avatars/objects?limit=50&delimiter=/&prefix=folder%2F') {
				return Promise.resolve({
					objects: [{
						key: 'folder/avatar.png',
						size: 1024,
						uploaded: '2026-03-04T10:00:00.000Z',
						httpMetadata: { contentType: 'image/png' },
					}],
					folders: ['folder/nested/'],
					cursor: 'cursor_1',
				});
			}
			if (path === 'data/storage/buckets/avatars/objects?limit=50&delimiter=/&prefix=folder%2F&cursor=cursor_1') {
				return Promise.resolve({
					objects: [{
						key: 'folder/report.pdf',
						size: 2048,
						uploaded: '2026-03-05T10:00:00.000Z',
						httpMetadata: { contentType: 'application/pdf' },
					}],
					folders: [],
					cursor: null,
				});
			}
			if (path === 'data/storage/buckets/avatars/objects?limit=50&delimiter=/&prefix=folder%2Fnested%2F') {
				return Promise.resolve({
					objects: [],
					folders: [],
					cursor: null,
				});
			}
			return Promise.resolve({ objects: [], folders: [], cursor: null });
		});

		render(BucketPage);

		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith(
				'data/storage/buckets/avatars/objects?limit=50&delimiter=/&prefix=folder%2F',
			);
		});
		expect(await screen.findByText('avatar.png')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'nested/' }));
		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith(
				'data/storage/buckets/avatars/objects?limit=50&delimiter=/&prefix=folder%2Fnested%2F',
			);
		});

		mocks.page.set('/admin/storage/avatars?prefix=folder/');
		render(BucketPage);
		expect(await screen.findByText('avatar.png')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Load More' }));
		await waitFor(() => {
			expect(screen.getByText('report.pdf')).toBeInTheDocument();
		});
	});

	it('opens an image preview modal from the thumbnail', async () => {
		mocks.apiFetch.mockResolvedValue({
			objects: [{
				key: 'folder/avatar.png',
				size: 1024,
				uploaded: '2026-03-04T10:00:00.000Z',
				httpMetadata: { contentType: 'image/png' },
			}],
			folders: [],
			cursor: null,
		});

		render(BucketPage);
		expect(await screen.findByText('avatar.png')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Preview avatar.png' }));

		const previewDialog = await screen.findByRole('dialog', { name: 'avatar.png' });
		expect(within(previewDialog).getByText('folder/avatar.png')).toBeInTheDocument();
		expect(within(previewDialog).getByAltText('Preview of avatar.png')).toBeInTheDocument();

		await fireEvent.click(within(previewDialog).getByRole('button', { name: 'Close' }));
		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: 'avatar.png' })).not.toBeInTheDocument();
		});
	});

	it('supports bulk deletion, single deletion, and authenticated downloads', async () => {
		mocks.apiFetch.mockImplementation((path: string, options?: { method?: string }) => {
			if (path.startsWith('data/storage/buckets/avatars/objects?limit=50&delimiter=/')) {
				return Promise.resolve({
					objects: [
						{
							key: 'folder/avatar.png',
							size: 1024,
							uploaded: '2026-03-04T10:00:00.000Z',
							httpMetadata: { contentType: 'image/png' },
						},
						{
							key: 'folder/report.pdf',
							size: 2048,
							uploaded: '2026-03-05T10:00:00.000Z',
							httpMetadata: { contentType: 'application/pdf' },
						},
					],
					folders: [],
					cursor: null,
				});
			}
			if (path === 'data/storage/buckets/avatars/objects/folder%2Favatar.png' && options?.method === 'DELETE') {
				return Promise.resolve({ ok: true });
			}
			if (path === 'data/storage/buckets/avatars/objects/folder%2Freport.pdf' && options?.method === 'DELETE') {
				return Promise.reject(new Error('cannot delete'));
			}
			return Promise.resolve({ ok: true });
		});

		const fetchMock = vi.fn().mockResolvedValue(new Response('file', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

		render(BucketPage);
		expect(await screen.findByText('avatar.png')).toBeInTheDocument();

		await fireEvent.click(screen.getByLabelText('Select all files'));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete All' }));

		await waitFor(() => {
			expect(mocks.toastError).toHaveBeenCalledWith('1 succeeded, 1 failed');
		});

		await fireEvent.click(screen.getAllByTitle('Download')[0]);
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith(
				'http://admin.test/admin/api/data/storage/buckets/avatars/objects/folder%2Favatar.png',
				expect.objectContaining({
					headers: {
						Authorization: 'Bearer access-token',
					},
				}),
			);
		});
		await waitFor(() => {
			expect(anchorClick).toHaveBeenCalled();
		});

		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
		const confirmDialog = await screen.findByRole('alertdialog', { name: 'Delete File' });
		await fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));
		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith('Deleted folder/avatar.png');
		});
	});
});
