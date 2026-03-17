/**
 * Toast notification store using Svelte 5 runes.
 *
 * Simple queue with auto-dismiss:
 *  - success: 3 seconds
 *  - error: 5 seconds
 *  - info/warning: 4 seconds
 */

// ── Types ───────────────────────────────────────────────

export interface Toast {
	id: number;
	type: 'success' | 'error' | 'info' | 'warning';
	message: string;
}

export interface ToastHistoryItem extends Toast {
	timestamp: number;
}

export type ToastInput = Omit<Toast, 'id'>;

// ── Durations (ms) ──────────────────────────────────────

const DURATIONS: Record<Toast['type'], number> = {
	success: 3000,
	error: 5000,
	info: 4000,
	warning: 4000
};

// ── Reactive state ──────────────────────────────────────

const MAX_HISTORY = 50;

let nextId = 1;

export let toasts: Toast[] = $state([]);
export let toastHistory: ToastHistoryItem[] = $state([]);

const _unread = $state({ count: 0 });
export function getUnreadCount(): number {
	return _unread.count;
}

/**
 * Add a toast notification. Auto-dismisses after the type-specific duration.
 */
export function addToast(input: ToastInput): number {
	const id = nextId++;
	const toast: Toast = { id, ...input };

	toasts.push(toast);

	// Track in history
	toastHistory.unshift({ ...toast, timestamp: Date.now() });
	if (toastHistory.length > MAX_HISTORY) {
		toastHistory.length = MAX_HISTORY;
	}
	_unread.count++;

	const duration = DURATIONS[input.type];
	setTimeout(() => {
		removeToast(id);
	}, duration);

	return id;
}

/**
 * Remove a specific toast by id.
 */
export function removeToast(id: number): void {
	const idx = toasts.findIndex((t) => t.id === id);
	if (idx !== -1) {
		toasts.splice(idx, 1);
	}
}

/**
 * Clear all toasts.
 */
export function clearToasts(): void {
	toasts.length = 0;
}

/**
 * Mark all notifications as read.
 */
export function markAllRead(): void {
	_unread.count = 0;
}

/**
 * Clear notification history.
 */
export function clearHistory(): void {
	toastHistory.length = 0;
	_unread.count = 0;
}

// ── Convenience shortcuts ───────────────────────────────

export function toastSuccess(message: string): number {
	return addToast({ type: 'success', message });
}

export function toastError(message: string): number {
	return addToast({ type: 'error', message });
}

export function toastInfo(message: string): number {
	return addToast({ type: 'info', message });
}

export function toastWarning(message: string): number {
	return addToast({ type: 'warning', message });
}
