import type { Page } from '@playwright/test';

const ignoredConsolePatterns = [
	/^Failed to load resource: the server responded with a status of 404\b/i,
];

const ignoredPageErrorPatterns = [
	// Scalar is intentionally isolated in an opaque-origin iframe. Its optional
	// preference storage probe is denied by the sandbox and cannot reach admin
	// credentials or the parent origin.
	/^Failed to read the 'localStorage' property from 'Window': The document is sandboxed/i,
];

export interface BrowserDiagnostics {
	assertNoUnexpectedErrors(): void;
}

export function monitorBrowserDiagnostics(page: Page): BrowserDiagnostics {
	const errors: string[] = [];

	page.on('pageerror', (error) => {
		if (ignoredPageErrorPatterns.some((pattern) => pattern.test(error.message))) return;
		errors.push(`pageerror: ${error.message}`);
	});

	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const text = message.text().trim();
		if (ignoredConsolePatterns.some((pattern) => pattern.test(text))) return;
		const location = message.location();
		if (
			/^Failed to load resource: the server responded with a status of 401\b/i.test(text)
			&& location.url.endsWith('/admin/api/auth/refresh')
		) return;
		const locationText = location.url ? ` @ ${location.url}:${location.lineNumber}:${location.columnNumber}` : '';
		errors.push(`console: ${text}${locationText}`);
	});

	page.on('requestfailed', (request) => {
		const failure = request.failure();
		errors.push(`requestfailed: ${request.url()} (${failure?.errorText ?? 'unknown'})`);
	});

	return {
		assertNoUnexpectedErrors() {
			if (errors.length > 0) {
				throw new Error(`Unexpected browser errors:\n${errors.join('\n')}`);
			}
		},
	};
}
