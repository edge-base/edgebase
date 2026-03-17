import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
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
		toastSuccess: vi.fn(),
		toastError: vi.fn(),
	};
});

vi.mock('$lib/stores/auth', () => ({
	authStore: mocks.authStore,
}));

vi.mock('$lib/runtime-config', () => ({
	getAdminApiUrl: mocks.getAdminApiUrl,
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastSuccess: mocks.toastSuccess,
	toastError: mocks.toastError,
}));

import FileUploadModal from './FileUploadModal.svelte';

describe('FileUploadModal', () => {
	beforeEach(() => {
		mocks.getAdminApiUrl.mockClear();
		mocks.getAdminApiUrl.mockImplementation((path = '') => `http://admin.test/admin/api/${path}`);
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
		vi.unstubAllGlobals();
	});

	it('uploads a single file with a custom key and closes on success', async () => {
		const onUploaded = vi.fn();
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));
		vi.stubGlobal('fetch', fetchMock);

		const { container } = render(FileUploadModal, {
			props: {
				open: true,
				bucket: 'avatars',
				onUploaded,
			},
		});

		const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
		await fireEvent.change(container.querySelector('input[type="file"]')!, {
			target: { files: [file] },
		});

		expect(await screen.findByLabelText('Custom key (optional)')).toBeInTheDocument();
		await fireEvent.input(screen.getByLabelText('Custom key (optional)'), {
			target: { value: 'profiles/june.png' },
		});

		await fireEvent.click(screen.getByRole('button', { name: /Upload \(1\)/ }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(fetchMock).toHaveBeenCalledWith(
			'http://admin.test/admin/api/data/storage/buckets/avatars/upload',
			expect.objectContaining({
				method: 'POST',
				headers: {
					Authorization: 'Bearer access-token',
				},
			}),
		);
		const formData = request.body as FormData;
		expect(formData.get('file')).toBe(file);
		expect(formData.get('key')).toBe('profiles/june.png');
		expect(mocks.toastSuccess).toHaveBeenCalledWith('Uploaded 1 file');
		expect(onUploaded).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: 'Upload Files' })).not.toBeInTheDocument();
		});
	});

	it('supports drag-and-drop uploads and reports partial failures without dropping successful files', async () => {
		const onUploaded = vi.fn();
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}))
			.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Virus scan failed' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}));
		vi.stubGlobal('fetch', fetchMock);

		const { container } = render(FileUploadModal, {
			props: {
				open: true,
				bucket: 'docs',
				onUploaded,
			},
		});

		const first = new File(['ok'], 'report.txt', { type: 'text/plain' });
		const second = new File(['bad'], 'report-2.txt', { type: 'text/plain' });

		await fireEvent.drop(container.querySelector('label.dropzone')!, {
			dataTransfer: {
				files: [first, second],
			},
		});

		expect(await screen.findByText('report.txt')).toBeInTheDocument();
		expect(screen.getByText('report-2.txt')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /Upload \(2\)/ }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		await waitFor(() => {
			expect(mocks.toastError).toHaveBeenCalledWith('Failed to upload report-2.txt: Virus scan failed');
			expect(mocks.toastSuccess).toHaveBeenCalledWith('Uploaded 1 file');
			expect(onUploaded).toHaveBeenCalledTimes(1);
		});
	});
});
