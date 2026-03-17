import { render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	schemaMutation: vi.fn(),
	loadSchema: vi.fn().mockResolvedValue(null),
	devMode: false,
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
}));

vi.mock('$app/paths', () => ({
	base: '/admin',
}));

vi.mock('$app/stores', () => ({
	page: writable({
		url: new URL('http://localhost/admin/database/tables/new'),
	}),
}));

vi.mock('$lib/api', () => ({
	api: {
		schemaMutation: mocks.schemaMutation,
	},
}));

vi.mock('$lib/stores/schema', () => ({
	schemaStore: {
		loadSchema: mocks.loadSchema,
		waitForTableReady: vi.fn().mockResolvedValue(undefined),
	},
	namespaceNames: writable(['shared', 'workspace']),
}));

vi.mock('$lib/stores/devInfo', () => ({
	devInfoStore: {
		subscribe(run: (value: { devMode: boolean }) => void) {
			run({ devMode: mocks.devMode });
			return () => undefined;
		},
	},
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

import CreateTablePage from './+page.svelte';

describe('create table page', () => {
	it('shows a dev-mode notice and disables table creation outside local dev mode', async () => {
		render(CreateTablePage);

		expect(await screen.findByText(/Creating tables requires dev mode/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create Table' })).toBeDisabled();
		expect(screen.queryByRole('button', { name: 'Add Column' })).not.toBeInTheDocument();
	});
});
