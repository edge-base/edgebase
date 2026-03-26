type ErrorLike = {
	message?: unknown;
	status?: unknown;
	code?: unknown;
};

const NETWORK_ERROR_PATTERNS = [
	/failed to fetch/i,
	/networkerror/i,
	/load failed/i,
	/network request failed/i,
	/fetch failed/i,
];

const GENERIC_MESSAGES = new Set([
	'unknown error',
	'internal server error',
	'internal server error.',
	'request failed',
	'request failed.',
	'operation failed',
	'operation failed.',
]);

function normalizeSentence(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return 'Request failed';
	return trimmed.replace(/\s+$/, '').replace(/\.+$/, '');
}

function extractMessage(error: unknown): string | null {
	if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
		return error.message.trim();
	}
	if (error && typeof error === 'object') {
		const rawMessage = (error as ErrorLike).message;
		if (typeof rawMessage === 'string' && rawMessage.trim()) {
			return rawMessage.trim();
		}
	}
	return null;
}

function extractStatus(error: unknown): number | null {
	if (error && typeof error === 'object') {
		const status = (error as ErrorLike).status;
		if (typeof status === 'number' && Number.isFinite(status)) {
			return status;
		}
	}
	return null;
}

function isGenericMessage(message: string): boolean {
	return GENERIC_MESSAGES.has(message.trim().toLowerCase());
}

export function describeActionError(
	error: unknown,
	fallback: string,
	options: {
		hint?: string;
		prefixKnownMessage?: string;
	} = {},
): string {
	const base = normalizeSentence(fallback);
	const message = extractMessage(error);
	const status = extractStatus(error);

	if (message && !isGenericMessage(message)) {
		if (options.prefixKnownMessage) {
			return `${normalizeSentence(options.prefixKnownMessage)}: ${message}`;
		}
		return message;
	}

	if (status === 0) {
		return `${base}. Could not reach the EdgeBase admin API or dev sidecar. Make sure EdgeBase is running and try again.`;
	}
	if (status === 401) {
		return `${base}. Your session may have expired. Sign in again and retry.`;
	}
	if (status === 403) {
		return `${base}. Your account does not have permission for this action.`;
	}
	if (status === 404) {
		return `${base}. The requested resource or admin endpoint was not found.`;
	}
	if (status === 409) {
		return `${base}. The request conflicted with the current server state. Refresh and try again.`;
	}
	if (status === 422) {
		return `${base}. The server rejected the request data. Review the input and try again.`;
	}

	if (message && NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
		return `${base}. Could not reach the EdgeBase server. Make sure it is running and try again.`;
	}

	if (options.hint) {
		return `${base}. ${options.hint}`;
	}

	return `${base}. Check that EdgeBase is running and inspect the logs for details.`;
}
