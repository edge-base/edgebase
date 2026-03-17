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

import FunctionsPage from './+page.svelte';

describe('functions page', () => {
	beforeEach(() => {
		mocks.apiFetch.mockReset();
		mocks.toastError.mockReset();
		mocks.toastSuccess.mockReset();
		vi.unstubAllGlobals();
	});

	it('validates header and body input before executing a function', async () => {
		mocks.apiFetch.mockResolvedValue({
			functions: [{
				path: 'hello',
				methods: ['POST'],
				type: 'public',
			}],
		});
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		render(FunctionsPage);
		await fireEvent.click(await screen.findByRole('button', { name: /\/hello/i }));

		const textareas = screen.getAllByRole('textbox');
		await fireEvent.input(textareas[1], {
			target: { value: 'BadHeader' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
		expect(mocks.toastError).toHaveBeenCalledWith('Invalid header format: "BadHeader". Use "Key: Value" format.');

		await fireEvent.input(textareas[1], {
			target: { value: 'X-Test: one' },
		});
		await fireEvent.input(textareas[0], {
			target: { value: '{bad-json' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Execute' }));
		expect(mocks.toastError).toHaveBeenCalledWith('Invalid JSON in request body. Example: {"key": "value"}');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('executes functions, renders responses, and records history entries', async () => {
		mocks.apiFetch.mockResolvedValue({
			functions: [{
				path: 'hello',
				methods: ['POST', 'GET'],
				type: 'public',
			}],
		});

		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, message: 'hi' }), {
			status: 200,
			statusText: 'OK',
			headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' },
		}));
		vi.stubGlobal('fetch', fetchMock);

		render(FunctionsPage);
		await fireEvent.click(await screen.findByRole('button', { name: /\/hello/i }));

		const [bodyArea, headersArea] = screen.getAllByRole('textbox');
		await fireEvent.input(bodyArea, {
			target: { value: '{"name":"June"}' },
		});
		await fireEvent.input(headersArea, {
			target: { value: 'X-Test: yes' },
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Execute' }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith('/api/functions/hello', expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'Content-Type': 'application/json',
					'X-Test': 'yes',
				}),
				body: '{"name":"June"}',
			}));
		});

		expect(await screen.findByText(/200 OK/)).toBeInTheDocument();
		expect(screen.getByText(/"message": "hi"/)).toBeInTheDocument();
		expect(screen.getAllByText('/hello')).toHaveLength(2);
	});
});
