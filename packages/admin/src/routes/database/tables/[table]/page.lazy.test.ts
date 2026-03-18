import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	type TableSchemaDef = {
		namespace: string;
		provider: 'do' | 'd1' | 'postgres';
		dynamic?: boolean;
		fields: Record<string, unknown>;
	};
	type PageState = {
		params: { table: string };
		url: URL;
	};

	const pageState: PageState = {
		params: { table: 'posts' },
		url: new URL('http://localhost/admin/database/tables/posts'),
	};
	const schemaState: { schema: Record<string, TableSchemaDef> } = {
		schema: {
			posts: {
				namespace: 'shared',
				provider: 'do',
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
				return () => undefined;
			},
		},
		schemaStore: {
			subscribe(run: (value: typeof schemaState) => void) {
				run(schemaState);
				return () => undefined;
			},
			loadSchema: vi.fn().mockResolvedValue(schemaState.schema),
		},
		devInfoStore: {
			subscribe(run: (value: { devMode: boolean }) => void) {
				run({ devMode: true });
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

vi.mock('$lib/components/database/TableSqlTab.svelte', () => {
	throw new Error('TableSqlTab should be lazy-loaded');
});

describe('table detail page lazy loading', () => {
	it('renders the default records view without importing the query tab eagerly', async () => {
		const { default: TableDetailPage } = await import('./+page.svelte');
		render(TableDetailPage);

		expect(await screen.findByText('posts')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Query' })).toBeInTheDocument();
		expect(screen.getByTestId('mock-database-section')).toBeInTheDocument();
	});
});
