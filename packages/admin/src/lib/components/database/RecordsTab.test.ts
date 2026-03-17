import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const schemaState = {
		schema: {
			posts: {
				fields: {
					id: { type: 'string' },
					title: { type: 'string' },
				},
			},
		},
	};

	return {
		apiFetch: vi.fn(),
		toastError: vi.fn(),
		toastSuccess: vi.fn(),
		downloadBlob: vi.fn(),
		schemaStore: {
			subscribe(run: (value: typeof schemaState) => void) {
				run(schemaState);
				return () => undefined;
			},
		},
	};
});

vi.mock('$app/paths', () => ({
	base: '/admin',
}));

vi.mock('$lib/api', () => ({
	api: {
		fetch: mocks.apiFetch,
	},
}));

vi.mock('$lib/stores/schema', () => ({
	schemaStore: mocks.schemaStore,
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastError: mocks.toastError,
	toastSuccess: mocks.toastSuccess,
}));

vi.mock('$lib/download', () => ({
	downloadBlob: mocks.downloadBlob,
}));

vi.mock('$lib/components/ui/DataGrid.svelte', async () => ({
	default: (await import('../../../test/fixtures/MockDataGrid.svelte')).default,
}));

vi.mock('$lib/components/ui/RowDetailPanel.svelte', async () => ({
	default: (await import('../../../test/fixtures/MockDatabaseSection.svelte')).default,
}));

import RecordsTab from './RecordsTab.svelte';

describe('RecordsTab', () => {
	beforeEach(() => {
		mocks.apiFetch.mockReset();
		mocks.toastError.mockReset();
		mocks.toastSuccess.mockReset();
		mocks.apiFetch.mockResolvedValue({
			items: [],
			total: 0,
		});
	});

	it('shows the record browser without embedded query mode tabs', async () => {
		render(RecordsTab, {
			props: {
				tableName: 'posts',
			},
		});

		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalled();
		});

		expect(screen.getByPlaceholderText('Search records...')).toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Browse' })).not.toBeInTheDocument();
		expect(screen.queryByRole('tab', { name: 'Query' })).not.toBeInTheDocument();
	});
});
