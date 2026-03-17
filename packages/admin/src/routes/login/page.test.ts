import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { vi, describe, beforeEach, expect, it } from 'vitest';

const mocks = vi.hoisted(() => {
    type AuthState = {
        accessToken: string | null;
        refreshToken: string | null;
        admin: { id: string; email: string } | null;
    };

    let authState: AuthState = {
        accessToken: null,
        refreshToken: null,
        admin: null,
    };
    const authSubscribers = new Set<(value: AuthState) => void>();

    let pageState = { url: new URL('http://localhost/admin/login') };
    const pageSubscribers = new Set<(value: typeof pageState) => void>();

    const authStore = {
        subscribe(run: (value: AuthState) => void) {
            run(authState);
            authSubscribers.add(run);
            return () => authSubscribers.delete(run);
        },
        set(value: AuthState) {
            authState = value;
            for (const run of authSubscribers) run(authState);
        },
        login: vi.fn(),
        setup: vi.fn(),
        refresh: vi.fn(),
        logout: vi.fn(),
    };

    const page = {
        subscribe(run: (value: typeof pageState) => void) {
            run(pageState);
            pageSubscribers.add(run);
            return () => pageSubscribers.delete(run);
        },
        set(url: string) {
            pageState = { url: new URL(url) };
            for (const run of pageSubscribers) run(pageState);
        },
    };

    return {
        authStore,
        page,
        goto: vi.fn(),
        fetchSetupStatus: vi.fn(),
        getPostLoginPath: vi.fn(() => '/admin'),
    };
});

vi.mock('$app/navigation', () => ({
    goto: mocks.goto,
}));

vi.mock('$app/paths', () => ({
    base: '/admin',
}));

vi.mock('$app/stores', () => ({
    page: mocks.page,
}));

vi.mock('$lib/setup-status', () => ({
    fetchSetupStatus: mocks.fetchSetupStatus,
}));

vi.mock('$lib/login-redirect', () => ({
    getPostLoginPath: mocks.getPostLoginPath,
}));

vi.mock('$lib/stores/auth', () => ({
    authStore: mocks.authStore,
}));

import LoginPage from './+page.svelte';

describe('login page', () => {
    beforeEach(() => {
        mocks.goto.mockReset();
        mocks.fetchSetupStatus.mockReset();
        mocks.getPostLoginPath.mockReset();
        mocks.getPostLoginPath.mockReturnValue('/admin');
        mocks.authStore.login.mockReset();
        mocks.authStore.setup.mockReset();
        mocks.authStore.refresh.mockReset();
        mocks.authStore.logout.mockReset();
        mocks.authStore.set({
            accessToken: null,
            refreshToken: null,
            admin: null,
        });
        mocks.page.set('http://localhost/admin/login');
    });

    it('blocks setup submission when the password is too short', async () => {
        mocks.fetchSetupStatus.mockResolvedValue({ needsSetup: true });

        render(LoginPage);

        await screen.findByText('Create your admin account');
        expect(screen.getByAltText('EdgeBase logo')).toHaveAttribute('src', '/admin/favicon.svg');

        await fireEvent.input(screen.getByLabelText('Admin Email'), {
            target: { value: 'admin@example.com' },
        });
        await fireEvent.input(screen.getByLabelText('Choose Password'), {
            target: { value: 'short7!' },
        });
        await fireEvent.submit(screen.getByRole('button', { name: 'Create Admin Account' }).closest('form')!);

        expect(await screen.findByText('Password must be at least 8 characters.')).toBeInTheDocument();
        expect(mocks.authStore.setup).not.toHaveBeenCalled();
    });

    it('shows the recovery hint when login fails with invalid credentials', async () => {
        mocks.fetchSetupStatus.mockResolvedValue({ needsSetup: false });
        mocks.authStore.login.mockRejectedValue(new Error('Invalid credentials'));

        render(LoginPage);

        await screen.findByText('Sign in to Admin Dashboard');

        await fireEvent.input(screen.getByLabelText('Email'), {
            target: { value: 'admin@example.com' },
        });
        await fireEvent.input(screen.getByLabelText('Password'), {
            target: { value: 'WrongPassword1!' },
        });
        await fireEvent.submit(screen.getByRole('button', { name: 'Sign In' }).closest('form')!);

        expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
        expect(
            screen.getByText(/Admin password recovery is handled through the CLI/i),
        ).toBeInTheDocument();
        expect(screen.getByText('npx edgebase admin reset-password --local')).toBeInTheDocument();
        expect(mocks.authStore.login).toHaveBeenCalledWith('admin@example.com', 'WrongPassword1!');
    });

    it('redirects after a successful login once auth state is populated', async () => {
        mocks.fetchSetupStatus.mockResolvedValue({ needsSetup: false });
        mocks.getPostLoginPath.mockReturnValue('/admin/auth');
        mocks.authStore.login.mockImplementation(async () => {
            mocks.authStore.set({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                admin: { id: 'admin_1', email: 'admin@example.com' },
            });
        });

        render(LoginPage);

        await screen.findByText('Sign in to Admin Dashboard');

        await fireEvent.input(screen.getByLabelText('Email'), {
            target: { value: 'admin@example.com' },
        });
        await fireEvent.input(screen.getByLabelText('Password'), {
            target: { value: 'CorrectPassword1!' },
        });
        await fireEvent.submit(screen.getByRole('button', { name: 'Sign In' }).closest('form')!);

        await waitFor(() => {
            expect(mocks.goto).toHaveBeenCalledWith('/admin/auth', { replaceState: true });
        });
    });
});
