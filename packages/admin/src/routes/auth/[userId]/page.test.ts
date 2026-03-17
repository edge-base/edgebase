import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	let pageState = {
		params: { userId: 'user_123' },
		url: new URL('http://localhost/admin/auth/user_123'),
	};
	const subscribers = new Set<(value: typeof pageState) => void>();

	return {
		page: {
			subscribe(run: (value: typeof pageState) => void) {
				run(pageState);
				subscribers.add(run);
				return () => subscribers.delete(run);
			},
			set(userId: string, url = `http://localhost/admin/auth/${userId}`) {
				pageState = {
					params: { userId },
					url: new URL(url),
				};
				for (const subscriber of subscribers) subscriber(pageState);
			},
		},
		goto: vi.fn(),
		apiFetch: vi.fn(),
		toastSuccess: vi.fn(),
		toastError: vi.fn(),
	};
});

vi.mock('$app/stores', () => ({
	page: mocks.page,
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
}));

vi.mock('$app/paths', () => ({
	base: '/admin',
}));

vi.mock('$lib/api', () => ({
	api: {
		fetch: mocks.apiFetch,
	},
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastSuccess: mocks.toastSuccess,
	toastError: mocks.toastError,
}));

import UserDetailPage from './+page.svelte';

describe('user detail page', () => {
	beforeEach(() => {
		mocks.page.set('user_123');
		mocks.goto.mockReset();
		mocks.apiFetch.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
	});

	it('loads a user, saves edited status/role values, and renders profile data', async () => {
		mocks.apiFetch.mockImplementation((path: string, options?: { method?: string; body?: Record<string, string> }) => {
			if (path === 'data/users/user_123') {
				if (options?.method === 'PUT') return Promise.resolve({ ok: true });
				return Promise.resolve({
					user: {
						id: 'user_123',
						email: 'user@example.com',
						status: 'active',
						role: 'user',
						createdAt: '2026-03-01T10:00:00.000Z',
						lastSignedInAt: '2026-03-04T12:00:00.000Z',
					},
				});
			}
			if (path === 'data/users/user_123/profile') {
				return Promise.resolve({
					id: 'user_123',
					displayName: 'June',
					theme: 'dark',
				});
			}
			return Promise.resolve({ ok: true });
		});

		render(UserDetailPage);

		expect(await screen.findByText('user@example.com')).toBeInTheDocument();
		expect(screen.getByText('displayName')).toBeInTheDocument();
		expect(screen.getByText('June')).toBeInTheDocument();

		const selects = screen.getAllByRole('combobox');
		await fireEvent.change(selects[0], { target: { value: 'banned' } });
		await fireEvent.change(selects[1], { target: { value: 'admin' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/users/user_123', {
				method: 'PUT',
				body: { status: 'banned', role: 'admin' },
			});
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith('User updated successfully');
	});

	it('shows a not-found state when the user lookup fails', async () => {
		mocks.apiFetch.mockRejectedValue(new Error('missing'));

		render(UserDetailPage);

		expect(await screen.findByText('User not found.')).toBeInTheDocument();
	});

	it('handles password reset, session revoke, MFA disable, and deletion flows', async () => {
		mocks.apiFetch.mockImplementation((path: string, options?: { method?: string }) => {
			if (path === 'data/users/user_123') {
				if (options?.method === 'DELETE') return Promise.resolve({ ok: true });
				return Promise.resolve({
					user: {
						id: 'user_123',
						email: 'user@example.com',
						status: 'active',
						role: 'user',
						createdAt: '2026-03-01T10:00:00.000Z',
						lastSignedInAt: null,
					},
				});
			}
			if (path === 'data/users/user_123/profile') {
				return Promise.resolve({});
			}
			return Promise.resolve({ ok: true });
		});

		render(UserDetailPage);
		expect(await screen.findByText('user@example.com')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Send Reset Email' }));
		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/users/user_123/send-password-reset', { method: 'POST' });
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Revoke Sessions' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }));
		await fireEvent.click(screen.getAllByRole('button', { name: 'Disable MFA' }).at(-1)!);
		await fireEvent.click(screen.getByRole('button', { name: 'Delete User' }));
		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete User' }).at(-1)!);

		await waitFor(() => {
			expect(mocks.toastSuccess).toHaveBeenCalledWith('Password reset email sent');
			expect(mocks.toastSuccess).toHaveBeenCalledWith('All sessions revoked');
			expect(mocks.toastSuccess).toHaveBeenCalledWith('MFA disabled');
			expect(mocks.toastSuccess).toHaveBeenCalledWith('User deleted');
		});
		expect(mocks.goto).toHaveBeenCalledWith('/admin/auth');
	});
});
