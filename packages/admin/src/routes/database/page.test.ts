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

import DatabasePage from './+page.svelte';

describe('database page', () => {
    beforeEach(() => {
        mocks.goto.mockReset();
    });

    it('redirects to the tables view on mount', async () => {
        render(DatabasePage);

        await waitFor(() => {
            expect(mocks.goto).toHaveBeenCalledWith('/admin/database/tables', { replaceState: true });
        });
    });
});
