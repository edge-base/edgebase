import { expect, test } from '@playwright/test';

import { bootstrapAdminApp, signIn } from './support/adminApp';

test('signs in through the login page and logs out through the header', async ({ page }) => {
	const mock = await bootstrapAdminApp(page);

	await signIn(page);

	await expect(page.getByRole('link', { name: 'Users' }).first()).toBeVisible();
	await expect(page.getByText('admin@example.com')).toBeVisible();
	await expect(page.getByText('Development')).toBeVisible();

	await page.getByRole('button', { name: 'Logout' }).click();

	await expect(page).toHaveURL(/\/admin\/login$/);
	await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

	mock.assertNoUnhandled();
});
