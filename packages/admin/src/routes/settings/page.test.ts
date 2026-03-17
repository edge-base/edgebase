import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	type DevInfoState = { devMode: boolean; sidecarPort: number | null; loaded: boolean };
	let devInfoState: DevInfoState = { devMode: true, sidecarPort: 4312, loaded: true };
	const subscribers = new Set<(value: DevInfoState) => void>();

	return {
		apiFetch: vi.fn(),
		toastSuccess: vi.fn(),
		toastError: vi.fn(),
		devInfoStore: {
			subscribe(run: (value: DevInfoState) => void) {
				run(devInfoState);
				subscribers.add(run);
				return () => subscribers.delete(run);
			},
		},
	};
});

vi.mock('$lib/api', () => ({
	api: {
		fetch: mocks.apiFetch,
	},
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastSuccess: mocks.toastSuccess,
	toastError: mocks.toastError,
}));

vi.mock('$lib/stores/devInfo', () => ({
	devInfoStore: mocks.devInfoStore,
}));

import SettingsPage from './+page.svelte';

const baseConfig = {
	devMode: true,
	release: false,
	databases: [{ name: 'shared', tableCount: 2, hasAccess: true }],
	storageBuckets: ['avatars'],
	serviceKeyCount: 1,
	serviceKeys: ['svc_***masked'],
	bindings: { kv: ['KV_MAIN'], d1: ['DB_MAIN'], vectorize: [] },
	auth: { providers: ['google'], anonymousAuth: true },
	rateLimiting: [{
		group: 'db',
		requests: 100,
		window: '60s',
		binding: { enabled: true, limit: 1000, period: 60, source: 'default' as const },
	}],
};

describe('settings page', () => {
	beforeEach(() => {
		mocks.apiFetch.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: {
				writeText: vi.fn().mockResolvedValue(undefined),
			},
		});
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
	});

	it('renders config/admin summaries and supports copy/download actions', async () => {
		mocks.apiFetch.mockImplementation((path: string) => {
			if (path === 'data/config-info') return Promise.resolve(baseConfig);
			if (path === 'data/admins') {
				return Promise.resolve({
					admins: [{
						id: 'admin_1',
						email: 'admin@example.com',
						createdAt: '2026-03-01T10:00:00.000Z',
						updatedAt: '2026-03-01T10:00:00.000Z',
					}],
				});
			}
			if (path === 'data/backup/config') {
				return Promise.resolve({ snapshot: true });
			}
			return Promise.resolve({});
		});

		render(SettingsPage);

		expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
		expect(screen.getByText('svc_***masked')).toBeInTheDocument();

		await fireEvent.click(screen.getByTitle('Copy masked key'));
		await waitFor(() => {
			expect(navigator.clipboard.writeText).toHaveBeenCalledWith('svc_***masked');
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Download Config Snapshot' }));
		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/backup/config');
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith('Config snapshot downloaded');
	});

	it('adds admins, changes passwords, and deletes accounts', async () => {
		let adminList = [{
			id: 'admin_1',
			email: 'admin@example.com',
			createdAt: '2026-03-01T10:00:00.000Z',
			updatedAt: '2026-03-01T10:00:00.000Z',
		}];

		mocks.apiFetch.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
			if (path === 'data/config-info') return Promise.resolve(baseConfig);
			if (path === 'data/admins' && !options?.method) return Promise.resolve({ admins: adminList });
			if (path === 'data/admins' && options?.method === 'POST') {
				adminList = [...adminList, {
					id: 'admin_2',
					email: String(options.body?.email ?? ''),
					createdAt: '2026-03-02T10:00:00.000Z',
					updatedAt: '2026-03-02T10:00:00.000Z',
				}];
				return Promise.resolve({ ok: true });
			}
			if (path === 'data/admins/admin_1/password') return Promise.resolve({ ok: true });
			if (path === 'data/admins/admin_2' && options?.method === 'DELETE') {
				adminList = adminList.filter((admin) => admin.id !== 'admin_2');
				return Promise.resolve({ ok: true });
			}
			return Promise.resolve({});
		});

		render(SettingsPage);
		expect(await screen.findByText('admin@example.com')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: '+ Add Admin' }));
		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'second@example.com' },
		});
		await fireEvent.input(screen.getByLabelText('Password'), {
			target: { value: 'Password123!' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create Admin' }));
		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith('Admin account created');
		});
		expect(await screen.findByText('second@example.com')).toBeInTheDocument();

		await fireEvent.click(screen.getAllByRole('button', { name: 'Change Password' })[0]);
		await fireEvent.input(screen.getByLabelText('New Password'), {
			target: { value: 'NewPassword123!' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Update Password' }));
		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith('Password updated');
		});

		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
		const confirmDialog = await screen.findByRole('alertdialog', { name: 'Delete Admin Account' });
		await fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));
		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith('Admin account deleted');
		});
	});
});
