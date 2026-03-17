import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
	schemaMutation: vi.fn(),
	loadSchema: vi.fn().mockResolvedValue(null),
	waitForNamespaceReady: vi.fn().mockResolvedValue(undefined),
	devMode: true,
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
}));

vi.mock('$app/paths', () => ({
	base: '/admin',
}));

vi.mock('$lib/api', () => ({
	api: {
		schemaMutation: mocks.schemaMutation,
	},
}));

vi.mock('$lib/stores/schema', () => ({
	schemaStore: {
		loadSchema: mocks.loadSchema,
		waitForNamespaceReady: mocks.waitForNamespaceReady,
	},
}));

vi.mock('$lib/stores/devInfo', () => ({
	devInfoStore: {
		subscribe(run: (value: { devMode: boolean }) => void) {
			run({ devMode: mocks.devMode });
			return () => undefined;
		},
	},
}));

import DatabaseNewPage from './+page.svelte';

describe('database new page', () => {
	beforeEach(() => {
		mocks.devMode = true;
		mocks.goto.mockReset();
		mocks.schemaMutation.mockReset();
		mocks.loadSchema.mockClear();
		mocks.waitForNamespaceReady.mockClear();
		mocks.schemaMutation.mockImplementation(async (path: string) => {
			if (path === 'integrations/neon/projects') {
				return {
					items: [
						{
							projectId: 'proj_123',
							projectName: 'billing-prod',
							orgId: 'org_123',
							orgName: 'EdgeBase',
						},
					],
				};
			}
			return { ok: true };
		});
	});

	it('creates a postgres DB block with the computed env key', async () => {
		render(DatabaseNewPage);

		await fireEvent.input(screen.getByLabelText('Database Block Name'), {
			target: { value: 'analytics' },
		});
		await fireEvent.change(screen.getByLabelText('Provider'), {
			target: { value: 'postgres' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create Database' }));

		await waitFor(() => {
			expect(mocks.schemaMutation).toHaveBeenCalledWith('schema/databases', {
				method: 'POST',
				body: expect.objectContaining({
					name: 'analytics',
					topology: 'single',
					provider: 'postgres',
					connectionString: 'DB_POSTGRES_ANALYTICS_URL',
				}),
			});
		});
		expect(mocks.waitForNamespaceReady).toHaveBeenCalledWith('analytics', {
			timeoutMessage: 'Database block "analytics" is still syncing. Please try again in a moment.',
		});
	});

	it('uses the Neon helper endpoint for existing Neon connections', async () => {
		render(DatabaseNewPage);

		await fireEvent.input(screen.getByLabelText('Database Block Name'), {
			target: { value: 'billing' },
		});
		await fireEvent.change(screen.getByLabelText('Provider'), {
			target: { value: 'postgres' },
		});
		expect(screen.getByText('Automatic Postgres Env Key')).toBeInTheDocument();
		expect(screen.getByText('DB_POSTGRES_BILLING_URL')).toBeInTheDocument();
		await screen.findByRole('option', { name: 'billing-prod (EdgeBase)' });
		await fireEvent.click(screen.getByRole('button', { name: 'Connect Existing Neon' }));

		await waitFor(() => {
			expect(mocks.schemaMutation).toHaveBeenCalledWith('integrations/neon/databases', {
				method: 'POST',
				body: {
					name: 'billing',
					topology: 'single',
					projectId: 'proj_123',
					mode: 'reuse',
				},
			});
		});
		expect(mocks.waitForNamespaceReady).toHaveBeenCalledWith('billing', {
			timeoutMessage: 'Database block "billing" is still syncing. Please try again in a moment.',
		});
	});

	it('passes the requested Neon project name when creating a new Neon project', async () => {
		render(DatabaseNewPage);

		await fireEvent.input(screen.getByLabelText('Database Block Name'), {
			target: { value: 'check44' },
		});
		await fireEvent.change(screen.getByLabelText('Provider'), {
			target: { value: 'postgres' },
		});
		await fireEvent.input(screen.getByLabelText('New Neon Project Name'), {
			target: { value: 'check44-prod' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create New Neon Project' }));

		await waitFor(() => {
			expect(mocks.schemaMutation).toHaveBeenCalledWith('integrations/neon/databases', {
				method: 'POST',
				body: {
					name: 'check44',
					topology: 'single',
					projectId: undefined,
					projectName: 'check44-prod',
					mode: 'create',
				},
			});
		});
	});

	it('shows a dev-mode notice and disables creation outside local dev mode', async () => {
		mocks.devMode = false;

		render(DatabaseNewPage);

		expect(await screen.findByText(/Creating database blocks requires dev mode/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create Database' })).toBeDisabled();
		await fireEvent.change(screen.getByLabelText('Provider'), {
			target: { value: 'postgres' },
		});
		expect(screen.getByRole('button', { name: 'Connect Existing Neon' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Create New Neon Project' })).toBeDisabled();
	});
});
