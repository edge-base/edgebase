import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	type TableSchemaDef = {
		namespace: string;
		provider: 'do' | 'd1' | 'postgres';
		dynamic?: boolean;
		instanceDiscovery?: {
			source: 'table' | 'manual' | 'function';
			targetLabel?: string;
			helperText?: string;
		};
		fields: Record<string, unknown>;
	};
	type PageState = {
		params: { table: string };
		url: URL;
	};

	let pageState: PageState = {
		params: { table: 'members' },
		url: new URL('http://localhost/admin/database/tables/members'),
	};
	const pageSubscribers = new Set<(value: PageState) => void>();
	const schemaState: { schema: Record<string, TableSchemaDef> } = {
		schema: {
			members: {
				namespace: 'workspace',
				provider: 'do' as const,
				dynamic: true,
				instanceDiscovery: {
					source: 'table' as const,
					targetLabel: 'Workspace',
					helperText: "Pick a workspace to view this table's records or run queries.",
				},
				fields: {},
			},
		},
	};

	return {
		goto: vi.fn(),
		apiFetch: vi.fn(),
		schemaMutation: vi.fn(),
		page: {
			subscribe(run: (value: PageState) => void) {
				run(pageState);
				pageSubscribers.add(run);
				return () => pageSubscribers.delete(run);
			},
			set(url: string) {
				pageState = {
					params: { table: 'members' },
					url: new URL(url),
				};
				for (const run of pageSubscribers) run(pageState);
			},
		},
		schemaStore: {
			subscribe(run: (value: typeof schemaState) => void) {
				run(schemaState);
				return () => undefined;
			},
			loadSchema: vi.fn().mockResolvedValue(null),
			setTableDef(next: TableSchemaDef) {
				schemaState.schema.members = next;
			},
		},
		devMode: true,
		devInfoStore: {
			subscribe(run: (value: { devMode: boolean }) => void) {
				run({ devMode: mocks.devMode });
				return () => undefined;
			},
		},
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

vi.mock('$lib/api', () => ({
	api: {
		fetch: mocks.apiFetch,
		schemaMutation: mocks.schemaMutation,
	},
}));

vi.mock('$lib/stores/schema', () => ({
	schemaStore: mocks.schemaStore,
}));

vi.mock('$lib/stores/devInfo', () => ({
	devInfoStore: mocks.devInfoStore,
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock('$lib/components/database/RecordsTab.svelte', async () => ({
	default: (await import('../../../../test/fixtures/MockDatabaseSection.svelte')).default,
}));

vi.mock('$lib/components/database/SchemaTab.svelte', async () => ({
	default: (await import('../../../../test/fixtures/MockDatabaseSection.svelte')).default,
}));

vi.mock('$lib/components/database/RulesTab.svelte', async () => ({
	default: (await import('../../../../test/fixtures/MockDatabaseSection.svelte')).default,
}));

vi.mock('$lib/components/database/SdkSnippets.svelte', async () => ({
	default: (await import('../../../../test/fixtures/MockDatabaseSection.svelte')).default,
}));

vi.mock('$lib/components/database/TableSqlTab.svelte', async () => ({
	default: (await import('../../../../test/fixtures/MockDatabaseSection.svelte')).default,
}));

import TableDetailPage from './+page.svelte';

describe('table detail page', () => {
	beforeEach(() => {
		mocks.devMode = true;
		mocks.goto.mockReset();
		mocks.apiFetch.mockReset();
		mocks.schemaMutation.mockReset();
		mocks.schemaStore.loadSchema.mockClear();
		mocks.schemaMutation.mockResolvedValue({
			items: [
				{
					projectId: 'proj_123',
					projectName: 'shared-prod',
					orgId: 'org_123',
					orgName: 'EdgeBase',
				},
			],
		});
		mocks.page.set('http://localhost/admin/database/tables/members');
		mocks.schemaStore.setTableDef({
			namespace: 'workspace',
			provider: 'do',
			dynamic: true,
			instanceDiscovery: {
				source: 'table',
				targetLabel: 'Workspace',
				helperText: "Pick a workspace to view this table's records or run queries.",
			},
			fields: {},
		});
	});

	it('shows discovered instances for dynamic tables and applies one on click', async () => {
		mocks.apiFetch.mockResolvedValue({
			items: [{ id: 'ws-1', label: 'Acme' }],
		});

		render(TableDetailPage);

		expect(await screen.findByText('Choose Workspace')).toBeInTheDocument();
		expect(await screen.findByText("Pick a workspace to view this table's records or run queries.")).toBeInTheDocument();
		expect(screen.getByLabelText('Workspace ID')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Query' })).toBeInTheDocument();
		expect(await screen.findByRole('button', { name: /Acme/ })).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /Acme/ }));

		await waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith(
				'/admin/database/tables/members?instance=ws-1',
				{
					replaceState: true,
					keepFocus: true,
					noScroll: true,
				},
			);
		});
	});

	it('shows the Postgres upgrade action for single database tables', async () => {
		mocks.schemaStore.setTableDef({
			namespace: 'shared',
			provider: 'd1',
			dynamic: false,
			fields: {},
		});

		render(TableDetailPage);

		expect(await screen.findByRole('button', { name: 'Upgrade to Postgres' })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Postgres' }));
		expect(
			await screen.findByText((content) => content.includes('This migrates the entire')),
		).toBeInTheDocument();
		expect(screen.getByText('What happens during this migration')).toBeInTheDocument();
		expect(screen.getByText('Export all tables from the current D1-backed database block.')).toBeInTheDocument();
		expect(screen.getByText('Automatic Postgres Env Key')).toBeInTheDocument();
		expect(screen.getByText('DB_POSTGRES_SHARED_URL')).toBeInTheDocument();
	});

	it('uses the Neon upgrade helper without requiring a manual env key', async () => {
		mocks.schemaStore.setTableDef({
			namespace: 'shared',
			provider: 'd1',
			dynamic: false,
			fields: {},
		});

		render(TableDetailPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Postgres' }));
		await screen.findByRole('option', { name: 'shared-prod (EdgeBase)' });
		await fireEvent.click(screen.getByRole('button', { name: 'Connect Existing Neon' }));

		await waitFor(() => {
			expect(mocks.schemaMutation).toHaveBeenCalledWith('integrations/neon/upgrade', {
				method: 'POST',
				body: {
					namespace: 'shared',
					projectId: 'proj_123',
					mode: 'reuse',
				},
			});
		});
	});

	it('passes the requested Neon project name when creating a new Neon project during upgrade', async () => {
		mocks.schemaStore.setTableDef({
			namespace: 'check44',
			provider: 'd1',
			dynamic: false,
			fields: {},
		});

		render(TableDetailPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Postgres' }));
		await fireEvent.input(screen.getByLabelText('New Neon Project Name'), {
			target: { value: 'check44-prod' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create New Neon Project' }));

		await waitFor(() => {
			expect(mocks.schemaMutation).toHaveBeenCalledWith('integrations/neon/upgrade', {
				method: 'POST',
				body: {
					namespace: 'check44',
					projectId: undefined,
					projectName: 'check44-prod',
					mode: 'create',
				},
			});
		});
	});

	it('shows a disabled upgrade action with guidance outside dev mode', async () => {
		mocks.devMode = false;
		mocks.schemaStore.setTableDef({
			namespace: 'shared',
			provider: 'd1',
			dynamic: false,
			fields: {},
		});

		render(TableDetailPage);

		expect(await screen.findByRole('button', { name: 'Upgrade to Postgres' })).toBeDisabled();
		expect(screen.getByText(/Start/i)).toHaveTextContent('Start pnpm dev to enable DB block upgrades.');
	});
});
