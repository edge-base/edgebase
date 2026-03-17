import { render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(),
}));

vi.mock('$app/navigation', () => ({
	goto: mocks.goto,
}));

vi.mock('$app/paths', () => ({
	base: '/admin',
}));

import SqlRedirectPage from './+page.svelte';

describe('database sql page', () => {
	beforeEach(() => {
		mocks.goto.mockReset();
	});

	it('redirects legacy SQL page visits to the tables view', async () => {
		render(SqlRedirectPage);

		await waitFor(() => {
			expect(mocks.goto).toHaveBeenCalledWith('/admin/database/tables', { replaceState: true });
		});
	});
});
