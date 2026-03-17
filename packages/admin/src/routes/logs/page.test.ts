import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    apiFetch: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));

vi.mock('$lib/api', () => ({
    api: {
        fetch: mocks.apiFetch,
    },
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastError: mocks.toastError,
    toastSuccess: mocks.toastSuccess,
}));

import LogsPage from './+page.svelte';

describe('logs page', () => {
    beforeEach(() => {
        mocks.apiFetch.mockReset();
        mocks.toastError.mockReset();
        mocks.toastSuccess.mockReset();
    });

    it('loads, expands, and paginates log entries', async () => {
        mocks.apiFetch
            .mockResolvedValueOnce({
                logs: [
                    {
                        method: 'GET',
                        path: '/api/posts',
                        status: 500,
                        duration: 21,
                        category: 'db',
                        timestamp: '2026-03-13T12:00:00.000Z',
                        message: 'boom',
                    },
                ],
                cursor: 'next-cursor',
            })
            .mockResolvedValueOnce({
                logs: [
                    {
                        method: 'POST',
                        path: '/api/posts',
                        status: 201,
                        duration: 9,
                        category: 'db',
                        timestamp: '2026-03-13T12:01:00.000Z',
                        message: 'created',
                    },
                ],
                cursor: null,
            });

        render(LogsPage);

        await waitFor(() => {
            expect(mocks.apiFetch).toHaveBeenCalledWith(expect.stringContaining('data/logs?limit=50'));
        });

        expect(await screen.findByText('1 total')).toBeInTheDocument();
        expect(screen.getByText('1 server errors')).toBeInTheDocument();

        await fireEvent.click(screen.getByRole('button', { name: /GET \/api\/posts/i }));
        expect(screen.getByText(/"status": 500/)).toBeInTheDocument();

        await fireEvent.click(screen.getByRole('button', { name: 'Load More' }));

        await waitFor(() => {
            expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
        });

        expect(screen.getByText('2 total')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /POST \/api\/posts/i })).toBeInTheDocument();
        expect(mocks.toastError).not.toHaveBeenCalled();
    });
});
