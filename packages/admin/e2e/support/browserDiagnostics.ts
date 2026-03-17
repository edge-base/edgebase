import type { Page } from '@playwright/test';

const ignoredConsolePatterns = [
	/^Failed to load resource: the server responded with a status of 404\b/i,
];

export interface BrowserDiagnostics {
	assertNoUnexpectedErrors(): void;
}

export function monitorBrowserDiagnostics(page: Page): BrowserDiagnostics {
	const errors: string[] = [];

	page.on('pageerror', (error) => {
		errors.push(`pageerror: ${error.message}`);
	});

	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const text = message.text().trim();
		if (ignoredConsolePatterns.some((pattern) => pattern.test(text))) return;
		const location = message.location();
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
