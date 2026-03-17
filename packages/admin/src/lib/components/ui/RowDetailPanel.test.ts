import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/stores/toast.svelte', () => ({
	toastError: vi.fn(),
}));

import RowDetailPanel from './RowDetailPanel.svelte';
import type { GridColumn } from './DataGrid.svelte';

describe('RowDetailPanel', () => {
	it('allows editing a row and saves parsed changes', async () => {
		const onSave = vi.fn().mockResolvedValue(undefined);
		const columns: GridColumn[] = [
			{ key: 'id', label: 'id', type: 'text', editable: false },
			{ key: 'title', label: 'title', type: 'text' },
			{ key: 'views', label: 'views', type: 'number' },
			{ key: 'isPublished', label: 'isPublished', type: 'boolean' },
		];

		render(RowDetailPanel, {
			props: {
				open: true,
				row: {
					id: 'row-1',
					title: 'before',
					views: 1,
					isPublished: false,
				},
				columns,
				onClose: vi.fn(),
				onSave,
			},
		});

		await fireEvent.input(screen.getByLabelText('title'), {
			target: { value: 'after' },
		});
		await fireEvent.input(screen.getByLabelText('views'), {
			target: { value: '42' },
		});
		await fireEvent.change(screen.getByLabelText('isPublished'), {
			target: { value: 'true' },
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith('row-1', {
				title: 'after',
				views: 42,
				isPublished: true,
			});
		});

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
		});
	});
});
