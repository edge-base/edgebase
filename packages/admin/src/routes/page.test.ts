import { render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const authState = {
		accessToken: 'admin-token',
		refreshToken: 'refresh-token',
		admin: { id: 'admin_1', email: 'admin@example.com' },
	};

	return {
		apiFetch: vi.fn(),
		toastError: vi.fn(),
		authStore: {
			subscribe(run: (value: typeof authState) => void) {
				run(authState);
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

vi.mock('$lib/stores/auth', () => ({
	authStore: mocks.authStore,
}));

vi.mock('$lib/stores/toast.svelte', () => ({
	toastError: mocks.toastError,
}));

import OverviewPage from './+page.svelte';

const overviewResponse = {
	project: {
		totalUsers: 12,
		totalTables: 4,
		databases: [{ name: 'shared', tableCount: 4 }],
		storageBuckets: ['avatars'],
		serviceKeyCount: 1,
		authProviders: ['google'],
		liveConnections: 3,
		liveChannels: 2,
		devMode: true,
	},
	traffic: {
		appliedRange: '6h',
		summary: { totalRequests: 420, totalErrors: 7, avgLatency: 23, uniqueUsers: 19 },
		timeSeries: [
			{ timestamp: Date.now() - 60_000, requests: 200 },
			{ timestamp: Date.now(), requests: 220 },
		],
		breakdown: [],
		topItems: [],
	},
};

describe('overview page', () => {
	beforeEach(() => {
		mocks.apiFetch.mockReset();
		mocks.toastError.mockReset();
		mocks.apiFetch.mockResolvedValue(overviewResponse);
	});

	it('loads overview and renders the auto-selected range returned by the server', async () => {
		render(OverviewPage);

		await waitFor(() => {
			expect(mocks.apiFetch).toHaveBeenCalledWith('data/overview');
		});

		expect(await screen.findByText('Requests (6H)')).toBeInTheDocument();
		expect(screen.getByText('Requests — Last 6 hours')).toBeInTheDocument();
	});
});
