import { expect, test } from '@playwright/test';

import { bootstrapAdminApp, signIn } from './support/adminApp';
import { monitorBrowserDiagnostics } from './support/browserDiagnostics';

test('walks database tools and ops pages while exercising core controls', async ({ page }) => {
	const diagnostics = monitorBrowserDiagnostics(page);
	const mock = await bootstrapAdminApp(page);

	await page.route('**/api/functions/hello', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				ok: true,
				message: 'from-function',
			}),
		});
	});

	await page.route('**/openapi.json', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				openapi: '3.1.0',
				info: {
					title: 'EdgeBase Admin API',
					version: '0.1.0',
				},
				paths: {},
			}),
		});
	});

	await page.route('https://cdn.jsdelivr.net/npm/@scalar/api-reference', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/javascript',
			body: 'window.Scalar = window.Scalar || {};',
		});
	});

	await page.route('https://proxy.scalar.com/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({}),
		});
	});

	await signIn(page);

	await page.locator('.sidebar').getByRole('link', { name: 'Tables' }).click();
	await expect(page).toHaveURL(/\/admin\/database\/tables$/);
	await page.getByRole('link', { name: 'View ERD Diagram' }).click();
	await expect(page).toHaveURL(/\/admin\/database\/erd$/);
	await expect(page.getByRole('heading', { name: 'Schema ERD' })).toBeVisible();

	await page.getByRole('link', { name: 'Open table posts' }).click();
	await expect(page).toHaveURL(/\/admin\/database\/tables\/posts$/);
	await page.getByRole('button', { name: 'Query' }).click();
	await page.getByRole('button', { name: 'Execute' }).click();
	await expect(page.getByText(/1 row · \d+ms/)).toBeVisible();

	await page.locator('.sidebar a[href="/admin/functions"]').click();
	await expect(page).toHaveURL(/\/admin\/functions$/);
	await expect(page.getByRole('heading', { name: 'Functions' })).toBeVisible();
	await page.getByRole('button', { name: /\/hello/i }).click();
	await page.getByRole('button', { name: 'Execute' }).click();
	await expect(page.getByText(/200 OK/)).toBeVisible();
	await expect(page.getByText(/from-function/)).toBeVisible();

	await page.locator('.sidebar a[href="/admin/push"]').click();
	await expect(page).toHaveURL(/\/admin\/push$/);
	await expect(page.getByRole('heading', { name: 'Push Notifications' })).toBeVisible();

	await page.getByRole('tab', { name: 'Test Send' }).click();
	await page.getByLabel('User ID').fill('user_alpha');
	await page.getByLabel('Title').fill('Hello');
	await page.getByLabel('Body').fill('World');
	await page.getByRole('button', { name: 'Send Test Notification' }).click();
	await expect(page.getByText('Sent: 1, Failed: 0, Total: 1')).toBeVisible();

	await page.getByRole('tab', { name: 'Tokens' }).click();
	await page.getByPlaceholder('Enter User ID...').fill('user_alpha');
	await page.getByRole('button', { name: 'Search' }).click();
	await expect(page.getByText('device_alpha')).toBeVisible();

	await page.locator('.sidebar a[href="/admin/logs"]').click();
	await expect(page).toHaveURL(/\/admin\/logs$/);
	await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible();
	await expect(page.getByText('1 total')).toBeVisible();
	await page.getByRole('button', { name: /GET \/api\/posts/i }).click();
	await expect(page.getByText(/"status": 500/)).toBeVisible();
	await page.getByRole('button', { name: 'Load More' }).click();
	await expect(page.getByText('2 total')).toBeVisible();

	await page.locator('.sidebar a[href="/admin/monitoring"]').click();
	await expect(page).toHaveURL(/\/admin\/monitoring$/);
	await expect(page.getByRole('heading', { name: 'Live Monitoring' })).toBeVisible();
	await expect(page.getByText('posts:shared')).toBeVisible();
	await page.getByRole('button', { name: 'Live' }).click();
	await expect(page.getByRole('button', { name: 'Paused' })).toBeVisible();

	await page.locator('.sidebar a[href="/admin/analytics"]').click();
	await expect(page).toHaveURL(/\/admin\/analytics$/);
	await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
	await page.getByRole('button', { name: 'Exclude admin traffic' }).click();
	await expect(page.getByText('200')).toBeVisible();

	await page.locator('.sidebar a[href="/admin/analytics/events"]').click();
	await expect(page).toHaveURL(/\/admin\/analytics\/events$/);
	await expect(page.getByRole('heading', { name: 'Event Timeline' })).toBeVisible();
	await page.locator('.timeline-item').first().click();
	await expect(page.getByText(/127\.0\.0\.1/)).toBeVisible();

	await page.locator('.sidebar a[href="/admin/docs"]').click();
	await expect(page).toHaveURL(/\/admin\/docs$/);
	await expect(page.getByRole('heading', { name: 'API Docs' })).toBeVisible();

	diagnostics.assertNoUnexpectedErrors();
	mock.assertNoUnhandled();
});
