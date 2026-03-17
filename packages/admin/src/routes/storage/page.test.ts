import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';

const mocks = vi.hoisted(() => ({
	apiFetch: vi.fn(),
	schemaMutation: vi.fn(),
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock('$app/paths', () => ({
	base: '/admin',
}));

vi.mock('$lib/api', () => ({
	api: {
		fetch: mocks.apiFetch,
		schemaMutation: mocks.schemaMutation,
	},
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastError: mocks.toastError,
	toastSuccess: mocks.toastSuccess,
}));

vi.mock('$lib/stores/devInfo', () => ({
	devInfoStore: writable({ devMode: true, sidecarPort: 4312, loaded: true }),
}));

import StoragePage from './+page.svelte';

describe('storage page', () => {
	beforeEach(() => {
		mocks.apiFetch.mockReset();
		mocks.schemaMutation.mockReset();
		mocks.toastError.mockReset();
		mocks.toastSuccess.mockReset();
	});

	it('loads bucket cards and gracefully tolerates per-bucket stats failures', async () => {
		mocks.apiFetch.mockImplementation((path: string) => {
			if (path === 'data/storage/buckets') {
				return Promise.resolve({ buckets: ['avatars', 'docs'] });
			}
			if (path === 'data/storage/buckets/avatars/stats') {
				return Promise.resolve({ totalObjects: 12, totalSize: 1024 });
			}
			if (path === 'data/storage/buckets/docs/stats') {
				return Promise.reject(new Error('stats unavailable'));
			}
			return Promise.resolve({});
		});

		render(StoragePage);

		expect(await screen.findByText('avatars')).toBeInTheDocument();
		expect(screen.getByText('docs')).toBeInTheDocument();
		await waitFor(() => {
			expect(screen.getByText('12 files')).toBeInTheDocument();
			expect(screen.getByText('1.0 KB')).toBeInTheDocument();
		});
		expect(screen.getByText('Browse files')).toBeInTheDocument();
		expect(mocks.toastError).not.toHaveBeenCalled();
	});

	it('shows helpful empty and error states', async () => {
		mocks.apiFetch.mockResolvedValueOnce({ buckets: [] });

		const { unmount } = render(StoragePage);
		expect(await screen.findByText('No buckets')).toBeInTheDocument();
		unmount();

		mocks.apiFetch.mockRejectedValueOnce(new Error('server down'));
		render(StoragePage);

		await waitFor(() => {
			expect(mocks.toastError).toHaveBeenCalledWith('server down');
		});
	});

	it('creates a bucket through the dev sidecar and refreshes the list', async () => {
		let bucketListCalls = 0;
		mocks.apiFetch.mockImplementation((path: string) => {
			if (path === 'data/storage/buckets') {
				bucketListCalls += 1;
				if (bucketListCalls < 3) {
					return Promise.resolve({ buckets: ['avatars'] });
				}
				return Promise.resolve({ buckets: ['avatars', 'uploads'] });
			}
			if (path === 'data/storage/buckets/avatars/stats') {
				return Promise.resolve({ totalObjects: 1, totalSize: 128 });
			}
			if (path === 'data/storage/buckets/uploads/stats') {
				return Promise.resolve({ totalObjects: 0, totalSize: 0 });
			}
			return Promise.resolve({});
		});
		mocks.schemaMutation.mockResolvedValue({ ok: true });

		render(StoragePage);
		expect(await screen.findByText('avatars')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /\+ create bucket/i }));
		await fireEvent.input(screen.getByLabelText('Bucket Name'), { target: { value: 'uploads' } });
		await fireEvent.click(screen.getByRole('button', { name: /^Create Bucket$/i }));

		await waitFor(() => {
			expect(mocks.schemaMutation).toHaveBeenCalledWith('schema/storage/buckets', {
				method: 'POST',
				body: { name: 'uploads' },
			});
		});
		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/storage/buckets');
		});
		expect(await screen.findByText('uploads')).toBeInTheDocument();
		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith('Bucket "uploads" created');
		});
	});
});
