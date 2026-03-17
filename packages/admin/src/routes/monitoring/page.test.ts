import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    apiFetch: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock('$lib/api', () => ({
    api: {
        fetch: mocks.apiFetch,
    },
}));

vi.mock('$lib/stores/toast.svelte', () => ({
    toastError: mocks.toastError,
}));

import MonitoringPage from './+page.svelte';

describe('monitoring page', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.apiFetch.mockReset();
        mocks.toastError.mockReset();
        mocks.apiFetch.mockResolvedValue({
            activeConnections: 12,
            authenticatedConnections: 7,
            channels: 2,
            channelDetails: [{ channel: 'posts:shared', subscribers: 3 }],
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('loads monitoring data and honors the auto-refresh toggle', async () => {
        render(MonitoringPage);

        await waitFor(() => {
            expect(mocks.apiFetch).toHaveBeenCalledWith('data/monitoring');
        });

        expect(await screen.findByText('Live Monitoring')).toBeInTheDocument();
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('posts:shared')).toBeInTheDocument();

        await vi.advanceTimersByTimeAsync(5000);
        await waitFor(() => {
            expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
        });

        await fireEvent.click(screen.getByRole('button', { name: 'Live' }));
        expect(screen.getByRole('button', { name: 'Paused' })).toBeInTheDocument();

        await vi.advanceTimersByTimeAsync(5000);
        expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
        expect(mocks.toastError).not.toHaveBeenCalled();
    });
});
