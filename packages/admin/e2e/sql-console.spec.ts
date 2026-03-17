import { expect, test } from '@playwright/test';

import { bootstrapAdminApp, signIn } from './support/adminApp';

test('runs queries from a table query tab and keeps the legacy sql route redirected', async ({ page }) => {
	const mock = await bootstrapAdminApp(page);

	await signIn(page);

	await page.locator('.sidebar').getByRole('link', { name: 'Tables' }).click();
	await expect(page).toHaveURL(/\/admin\/database\/tables$/);

	await page.locator('a[href="/admin/database/tables/posts"]').click();
	await expect(page).toHaveURL(/\/admin\/database\/tables\/posts$/);

	await page.getByRole('button', { name: 'Query' }).click();
	await page.getByRole('button', { name: 'Execute' }).click();
	await expect(page.getByText(/1 row · \d+ms/)).toBeVisible();
	await expect(page.getByText('Hello world')).toBeVisible();

	await page.goto('/admin/database/sql');
	await expect(page).toHaveURL(/\/admin\/database\/tables$/);

	mock.assertNoUnhandled();
});
