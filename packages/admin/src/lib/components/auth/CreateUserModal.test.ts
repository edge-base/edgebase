import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	apiFetch: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
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

import CreateUserModal from './CreateUserModal.svelte';

describe('CreateUserModal', () => {
	beforeEach(() => {
		mocks.apiFetch.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.toastError.mockReset();
	});

	it('validates required fields before submitting', async () => {
		render(CreateUserModal, {
			props: {
				open: true,
				onCreated: vi.fn(),
			},
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
		expect(await screen.findByText('Email is required.')).toBeInTheDocument();

		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'not-an-email' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
		expect(await screen.findByText('Invalid email format.')).toBeInTheDocument();

		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'user@example.com' },
		});
		await fireEvent.input(screen.getByLabelText('Password'), {
			target: { value: 'short' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
		expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
		expect(mocks.apiFetch).not.toHaveBeenCalled();
	});

	it('submits successfully, resets state, and notifies the parent callback', async () => {
		const onCreated = vi.fn();
		mocks.apiFetch.mockResolvedValue({ ok: true });

		render(CreateUserModal, {
			props: {
				open: true,
				onCreated,
			},
		});

		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'user@example.com' },
		});
		await fireEvent.input(screen.getByLabelText('Password'), {
			target: { value: 'Password123!' },
		});
		await fireEvent.input(screen.getByLabelText('Display Name'), {
			target: { value: 'June User' },
		});
		await fireEvent.change(screen.getByLabelText('Role'), {
			target: { value: 'admin' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/users', {
				method: 'POST',
				body: {
					email: 'user@example.com',
					password: 'Password123!',
					displayName: 'June User',
					role: 'admin',
				},
			});
		});

		expect(mocks.toastSuccess).toHaveBeenCalledWith('User created successfully');
		expect(onCreated).toHaveBeenCalledTimes(1);
		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: 'Create User' })).not.toBeInTheDocument();
		});
	});

	it('shows API failures inline and via toast without clearing the form', async () => {
		mocks.apiFetch.mockRejectedValue(new Error('Email already exists'));

		render(CreateUserModal, {
			props: {
				open: true,
				onCreated: vi.fn(),
			},
		});

		await fireEvent.input(screen.getByLabelText('Email'), {
			target: { value: 'user@example.com' },
		});
		await fireEvent.input(screen.getByLabelText('Password'), {
			target: { value: 'Password123!' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

		expect(await screen.findByText('Email already exists')).toBeInTheDocument();
		expect(screen.getByLabelText('Email')).toHaveValue('user@example.com');
		expect(mocks.toastError).toHaveBeenCalledWith('Email already exists');
	});
});
