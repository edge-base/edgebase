import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	apiFetch: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
	toastInfo: vi.fn(),
}));

vi.mock('$lib/api', () => ({
	api: {
		fetch: mocks.apiFetch,
	},
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastSuccess: mocks.toastSuccess,
	toastError: mocks.toastError,
	toastInfo: mocks.toastInfo,
}));

import BackupPage from './+page.svelte';

describe('backup page', () => {
	beforeEach(() => {
		mocks.apiFetch.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
		mocks.toastInfo.mockReset();
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
	});

	it('downloads a full backup even when one DO dump fails', async () => {
		mocks.apiFetch.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
			if (path === 'data/backup/list-dos') {
				return Promise.resolve({
					dos: [
						{ doName: 'workspace:one', type: 'database', namespace: 'workspace' },
						{ doName: 'auth:main', type: 'auth', namespace: 'auth' },
					],
				});
			}
			if (path === 'data/backup/dump-do' && options?.body?.doName === 'workspace:one') {
				return Promise.resolve({ doName: 'workspace:one', type: 'database', tables: { posts: [] } });
			}
			if (path === 'data/backup/dump-do' && options?.body?.doName === 'auth:main') {
				return Promise.reject(new Error('auth dump failed'));
			}
			if (path === 'data/backup/dump-d1') {
				return Promise.resolve({ tables: { _users: [] } });
			}
			return Promise.resolve({});
		});

		render(BackupPage);
		expect(await screen.findByText('workspace:one')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /Download Full Backup/ }));

		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith('Backup downloaded');
		});
		expect(URL.createObjectURL).toHaveBeenCalled();
	});

	it('validates restore files and restores valid backup data', async () => {
		mocks.apiFetch.mockImplementation((path: string) => {
			if (path === 'data/backup/list-dos') {
				return Promise.resolve({ dos: [] });
			}
			return Promise.resolve({ ok: true });
		});

		const { container } = render(BackupPage);
		await screen.findByText('Create Backup');
		const fileInput = container.querySelector('input[type="file"]')!;

		const invalidFile = new File(['not-json'], 'bad.json', { type: 'application/json' });
		invalidFile.text = vi.fn().mockResolvedValue('not-json');
		await fireEvent.change(fileInput, {
			target: { files: [invalidFile] },
		});
		await waitFor(() => {
			expect(mocks.toastError).toHaveBeenCalledWith(
				'Invalid backup file. Please select a valid EdgeBase JSON backup file.',
			);
		});

		const validFile = new File([JSON.stringify({
			timestamp: '2026-03-10T00:00:00.000Z',
			dos: [
				{ doName: 'workspace:one', type: 'database', tables: { posts: [] } },
			],
			d1: { tables: { _users: [] } },
		})], 'backup.json', { type: 'application/json' });
		validFile.text = vi.fn().mockResolvedValue(JSON.stringify({
			timestamp: '2026-03-10T00:00:00.000Z',
			dos: [
				{ doName: 'workspace:one', type: 'database', tables: { posts: [] } },
			],
			d1: { tables: { _users: [] } },
		}));

		await fireEvent.change(fileInput, {
			target: { files: [validFile] },
		});

		await waitFor(() => {
			expect(mocks.toastInfo).toHaveBeenCalledWith('Backup loaded: backup.json');
		});
		expect(await screen.findByText((content) => content.includes('DOs: 1 components'))).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Restore Backup' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/backup/restore-do', {
				method: 'POST',
				body: {
					doName: 'workspace:one',
					type: 'database',
					tables: { posts: [] },
				},
			});
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/backup/restore-d1', {
				method: 'POST',
				body: {
					tables: { _users: [] },
				},
			});
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith('Restored 2 components');
	});
});
