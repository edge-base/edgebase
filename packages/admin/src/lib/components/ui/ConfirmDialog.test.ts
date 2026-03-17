import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import ConfirmDialog from './ConfirmDialog.svelte';

describe('ConfirmDialog', () => {
    it('closes on Escape, calls cancel, and restores focus', async () => {
        const cancel = vi.fn();
        const trigger = document.createElement('button');
        trigger.textContent = 'Trigger';
        document.body.appendChild(trigger);
        trigger.focus();

        render(ConfirmDialog, {
            open: true,
            title: 'Delete item',
            message: 'Delete this record?',
            oncancel: cancel,
        });

        const dialog = await screen.findByRole('alertdialog', { name: 'Delete item' });
        await waitFor(() => expect(dialog).toHaveFocus());

        await fireEvent.keyDown(window, { key: 'Escape' });

        expect(cancel).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        });
        await waitFor(() => expect(trigger).toHaveFocus());
        trigger.remove();
    });

    it('calls confirm and closes when the confirm button is pressed', async () => {
        const confirm = vi.fn();

        render(ConfirmDialog, {
            open: true,
            title: 'Delete item',
            message: 'Delete this record?',
            confirmLabel: 'Delete',
            confirmVariant: 'danger',
            onconfirm: confirm,
        });

        await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        expect(confirm).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        });
    });
});
