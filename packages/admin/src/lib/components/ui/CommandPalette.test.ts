import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	type SchemaState = {
		schema: Record<string, unknown>;
		namespaces?: Record<string, unknown>;
	};

	let schemaState: SchemaState = { schema: {} };
	const subscribers = new Set<(value: SchemaState) => void>();

	return {
		goto: vi.fn(),
		schemaStore: {
			subscribe(run: (value: SchemaState) => void) {
				run(schemaState);
				subscribers.add(run);
				return () => subscribers.delete(run);
			},
			set(value: SchemaState) {
				schemaState = value;
				for (const subscriber of subscribers) subscriber(schemaState);
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

vi.mock('$lib/stores/schema', () => ({
	schemaStore: mocks.schemaStore,
}));

import CommandPalette from './CommandPalette.svelte';

describe('CommandPalette', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
		mocks.schemaStore.set({
			schema: {
				posts: { namespace: 'shared' },
				comments: { namespace: 'shared' },
			},
		});
	});

	it('filters navigation and schema items together', async () => {
		render(CommandPalette, {
			props: {
				open: true,
			},
		});

		const search = screen.getByPlaceholderText('Search pages, tables...');
		await fireEvent.input(search, {
			target: { value: 'post' },
		});

		expect(await screen.findByText('posts')).toBeInTheDocument();
		expect(screen.getByText('Table: posts')).toBeInTheDocument();
		expect(screen.queryByText('Users')).not.toBeInTheDocument();
	});

	it('supports keyboard navigation and closes after navigation', async () => {
		render(CommandPalette, {
			props: {
				open: true,
			},
		});

		const search = screen.getByPlaceholderText('Search pages, tables...');
		await fireEvent.input(search, {
			target: { value: 'analytics' },
		});
		await fireEvent.keyDown(search, { key: 'ArrowDown' });
		await fireEvent.keyDown(search, { key: 'Enter' });

		await waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/admin/analytics/events');
		});
		expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
	});

	it('closes on escape and shows an empty state for unmatched queries', async () => {
		render(CommandPalette, {
			props: {
				open: true,
			},
		});

		const search = screen.getByPlaceholderText('Search pages, tables...');
		await fireEvent.input(search, {
			target: { value: 'zzzz' },
		});
		expect(await screen.findByText('No results found')).toBeInTheDocument();

		await fireEvent.keyDown(search, { key: 'Escape' });
		expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
	});
});
