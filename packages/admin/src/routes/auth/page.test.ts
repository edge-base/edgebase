import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	apiFetch: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
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

import AuthPage from './+page.svelte';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('auth page', () => {
	beforeEach(() => {
		vi.useRealTimers();
		mocks.goto.mockReset();
		mocks.apiFetch.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
	});

	it('loads users, applies filters, and clears selection when the filter scope changes', async () => {
		mocks.apiFetch.mockResolvedValue({
			users: [
				{
					id: 'user_1',
					email: 'active@example.com',
					status: 'active',
					role: 'user',
					createdAt: '2026-03-01T10:00:00.000Z',
					lastSignedInAt: null,
				},
				{
					id: 'user_2',
					email: 'banned@example.com',
					status: 'banned',
					role: 'admin',
					createdAt: '2026-03-02T10:00:00.000Z',
					lastSignedInAt: null,
				},
			],
			cursor: null,
			total: 2,
		});

		render(AuthPage);

		expect(await screen.findByText('active@example.com')).toBeInTheDocument();
		expect(screen.getByText('banned@example.com')).toBeInTheDocument();

		await fireEvent.click(screen.getByLabelText('Select all users'));
		expect(screen.getByText('2 selected')).toBeInTheDocument();

		const [, roleFilter] = screen.getAllByRole('combobox');
		await fireEvent.change(roleFilter, {
			target: { value: 'admin' },
		});

		expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
		expect(screen.queryByText('active@example.com')).not.toBeInTheDocument();
		expect(screen.getByText('banned@example.com')).toBeInTheDocument();
	});

	it('debounces search requests and ignores stale responses that arrive late', async () => {
		vi.useFakeTimers();
		const aliSearch = deferred<{
			users: Array<Record<string, unknown>>;
			cursor: string | null;
			total: number;
		}>();
		const bobSearch = deferred<{
			users: Array<Record<string, unknown>>;
			cursor: string | null;
			total: number;
		}>();

		mocks.apiFetch.mockImplementation((path: string) => {
			if (path.includes('email=ali')) return aliSearch.promise;
			if (path.includes('email=bob')) return bobSearch.promise;
			return Promise.resolve({
				users: [],
				cursor: null,
				total: 0,
			});
		});

		render(AuthPage);
		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/users?limit=20&cursor=0');
		});

		const search = screen.getByPlaceholderText('Search by email...');
		await fireEvent.input(search, {
			target: { value: 'ali' },
		});
		await vi.advanceTimersByTimeAsync(300);

		await fireEvent.input(search, {
			target: { value: 'bob' },
		});
		await vi.advanceTimersByTimeAsync(300);

		bobSearch.resolve({
			users: [{
				id: 'user_bob',
				email: 'bob@example.com',
				status: 'active',
				role: 'user',
				createdAt: '2026-03-03T10:00:00.000Z',
				lastSignedInAt: null,
			}],
			cursor: null,
			total: 1,
		});
		await screen.findByText('bob@example.com');

		aliSearch.resolve({
			users: [{
				id: 'user_ali',
				email: 'alice@example.com',
				status: 'active',
				role: 'user',
				createdAt: '2026-03-04T10:00:00.000Z',
				lastSignedInAt: null,
			}],
			cursor: null,
			total: 1,
		});
		await vi.runAllTimersAsync();

		expect(screen.getByText('bob@example.com')).toBeInTheDocument();
		expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
	});

	it('reports partial failures during bulk delete and refreshes the table afterwards', async () => {
		const initialUsers = {
			users: [
				{
					id: 'user_1',
					email: 'one@example.com',
					status: 'active',
					role: 'user',
					createdAt: '2026-03-01T10:00:00.000Z',
					lastSignedInAt: null,
				},
				{
					id: 'user_2',
					email: 'two@example.com',
					status: 'active',
					role: 'user',
					createdAt: '2026-03-02T10:00:00.000Z',
					lastSignedInAt: null,
				},
			],
			cursor: null,
			total: 2,
		};
		const refreshedUsers = {
			users: [{
				id: 'user_1',
				email: 'one@example.com',
				status: 'active',
				role: 'user',
				createdAt: '2026-03-01T10:00:00.000Z',
				lastSignedInAt: null,
			}],
			cursor: null,
			total: 1,
		};

		mocks.apiFetch.mockImplementation((path: string, options?: { method?: string }) => {
			if (path.startsWith('data/users?limit=20&cursor=0')) {
				return Promise.resolve(
					mocks.apiFetch.mock.calls.filter(([calledPath]) => calledPath === path).length > 1
						? refreshedUsers
						: initialUsers,
				);
			}
			if (path === 'data/users/user_1' && options?.method === 'DELETE') {
				return Promise.resolve({ ok: true });
			}
			if (path === 'data/users/user_2' && options?.method === 'DELETE') {
				return Promise.reject(new Error('backend failed'));
			}
			return Promise.resolve({ ok: true });
		});

		render(AuthPage);
		expect(await screen.findByText('one@example.com')).toBeInTheDocument();

		await fireEvent.click(screen.getByLabelText('Select all users'));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

		await waitFor(() => {
			expect(mocks.toastError).toHaveBeenCalledWith('1 succeeded, 1 failed');
		});
		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/users?limit=20&cursor=0');
		});
		expect(screen.queryByText('two@example.com')).not.toBeInTheDocument();
	});
});
