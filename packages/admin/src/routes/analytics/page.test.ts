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

import AnalyticsPage from './+page.svelte';

const analyticsResponse = {
	timeSeries: [
		{ timestamp: Date.now(), requests: 120, errors: 4, avgLatency: 20, uniqueUsers: 10 },
		{ timestamp: Date.now() + 60_000, requests: 80, errors: 2, avgLatency: 18, uniqueUsers: 8 },
	],
	summary: { totalRequests: 200, totalErrors: 10, avgLatency: 21, uniqueUsers: 18 },
	breakdown: [{ label: 'db', count: 120, percentage: 60 }],
	topItems: [{ label: '/api/posts', count: 80, avgLatency: 42, errorRate: 2.5 }],
};

describe('analytics page', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.apiFetch.mockReset();
		mocks.toastError.mockReset();
		mocks.apiFetch.mockResolvedValue(analyticsResponse);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads the default range, auto-refreshes, and allows turning live refresh off', async () => {
		render(AnalyticsPage);

		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/analytics?metric=overview&range=24h');
		});
		expect(await screen.findByText('200')).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(30_000);
		expect(mocks.apiFetch).toHaveBeenCalledTimes(2);

		await fireEvent.click(screen.getByTitle('Auto-refresh ON (30s)'));
		await vi.advanceTimersByTimeAsync(30_000);
		expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
	});

	it('can exclude admin traffic from the analytics query', async () => {
		render(AnalyticsPage);
		await screen.findByText('Analytics');

		await fireEvent.click(screen.getByRole('button', { name: 'Exclude admin traffic' }));

		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenLastCalledWith(
				'data/analytics?metric=overview&range=24h&excludeCategory=admin',
			);
		});
	});

	it('validates and applies custom date ranges with an appropriate grouping', async () => {
		render(AnalyticsPage);
		await screen.findByText('Analytics');

		await fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

		const [startInput, endInput] = screen.getAllByDisplayValue('');
		await fireEvent.input(startInput, {
			target: { value: '2026-03-10T10:00' },
		});
		await fireEvent.input(endInput, {
			target: { value: '2026-03-10T09:00' },
		});
		expect(await screen.findByText('End time must be after the start time.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

		await fireEvent.input(endInput, {
			target: { value: '2026-03-10T12:00' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

			await waitFor(() => {
				expect(mocks.apiFetch).toHaveBeenLastCalledWith(
					expect.stringContaining('data/analytics?metric=overview&start='),
				);
			});
			expect(mocks.toastError).not.toHaveBeenCalled();
	});
});
