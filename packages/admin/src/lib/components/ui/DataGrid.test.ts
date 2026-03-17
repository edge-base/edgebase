import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/stores/toast.svelte', () => ({
	toastError: vi.fn(),
	toastSuccess: vi.fn(),
}));

import DataGrid, { type GridColumn } from './DataGrid.svelte';

describe('DataGrid', () => {
	it('opens the create drawer and submits parsed row data', async () => {
		const onCreate = vi.fn().mockResolvedValue(undefined);
		const columns: GridColumn[] = [
			{ key: 'id', label: 'ID', type: 'text', editable: false },
			{ key: 'title', label: 'Title', type: 'text' },
			{ key: 'views', label: 'Views', type: 'number' },
			{ key: 'isPublished', label: 'Published', type: 'boolean' },
			{ key: 'status', label: 'Status', type: 'enum', enumValues: ['draft', 'live'] },
		];

		render(DataGrid, {
			props: {
				columns,
				rows: [],
				onCreate,
			},
		});

		await fireEvent.click(screen.getByRole('button', { name: '+ Add Row' }));

		expect(screen.getByRole('dialog', { name: 'Create Record' })).toBeInTheDocument();
		expect(screen.getByLabelText('Record ID')).toBeInTheDocument();

		await fireEvent.input(screen.getByLabelText('Title'), {
			target: { value: 'Hello drawer' },
		});
		await fireEvent.input(screen.getByLabelText('Views'), {
			target: { value: '3' },
		});
		await fireEvent.change(screen.getByLabelText('Published'), {
			target: { value: 'true' },
		});
		await fireEvent.change(screen.getByLabelText('Status'), {
			target: { value: 'draft' },
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Create Row' }));

		await waitFor(() => {
			expect(onCreate).toHaveBeenCalledWith({
				title: 'Hello drawer',
				views: 3,
				isPublished: true,
				status: 'draft',
			});
		});

		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: 'Create Record' })).not.toBeInTheDocument();
		});
	});

	it('shows a clear inline error when a custom record id contains Korean characters', async () => {
		const onCreate = vi.fn().mockResolvedValue(undefined);
		const columns: GridColumn[] = [
			{ key: 'id', label: 'ID', type: 'text', editable: false },
		];

		render(DataGrid, {
			props: {
				columns,
				rows: [],
				onCreate,
			},
		});

		await fireEvent.click(screen.getByRole('button', { name: '+ Add Row' }));
		await fireEvent.input(screen.getByLabelText('Record ID'), {
			target: { value: '한글-id' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Create Row' }));

		expect(onCreate).not.toHaveBeenCalled();
		expect(
			screen.getByText('Record ID must use English letters, numbers, hyphen (-), or underscore (_).'),
		).toBeInTheDocument();
	});
});
