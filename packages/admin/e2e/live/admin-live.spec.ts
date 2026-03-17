import { expect, test } from '@playwright/test';

import { monitorBrowserDiagnostics } from '../support/browserDiagnostics';
import {
	bootstrapLiveAdminApp,
	ensureAdminSession,
	LIVE_ADMIN_EMAIL,
	LIVE_ADMIN_PASSWORD,
	logoutFromAdmin,
	openAdminLogin,
} from '../support/liveAdminApp';

test.describe.serial('live admin smoke', () => {
	test('boots a fresh worker, creates the first admin account, and enforces auth redirects', async ({ page }) => {
		const diagnostics = monitorBrowserDiagnostics(page);

		await bootstrapLiveAdminApp(page);
		const mode = await openAdminLogin(page);
		expect(mode).toBe('setup');

		await page.getByLabel('Admin Email').fill(LIVE_ADMIN_EMAIL);
		await page.getByLabel('Choose Password').fill(LIVE_ADMIN_PASSWORD);
		await page.getByRole('button', { name: 'Create Admin Account' }).click();

		await expect(page).toHaveURL(/\/admin\/?$/);
		await expect(page.getByText('Total Users')).toBeVisible();
		await expect(page.getByText('Project dashboard')).toBeVisible();
		await expect(page.getByText(LIVE_ADMIN_EMAIL)).toBeVisible();
		await expect(page.getByText('5 buckets')).toBeVisible();

		await logoutFromAdmin(page);

		await page.goto('/admin');
		await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);

		diagnostics.assertNoUnexpectedErrors();
	});

	test('signs back in, runs a table query, and loads real storage buckets', async ({ page }) => {
		const diagnostics = monitorBrowserDiagnostics(page);

		await ensureAdminSession(page);

		await page.locator('.sidebar').getByRole('link', { name: 'Tables' }).click();
		await expect(page).toHaveURL(/\/admin\/database\/tables$/);

		await page.locator('a[href="/admin/database/tables/posts"]').click();
		await expect(page).toHaveURL(/\/admin\/database\/tables\/posts$/);
		await page.getByRole('button', { name: 'Query' }).click();
		await page.getByRole('button', { name: 'Execute' }).click();
		await expect(page.getByText(/\d+ rows? · \d+ms/).first()).toBeVisible();

		await page.locator('.sidebar').getByRole('link', { name: 'Files' }).click();
		await expect(page).toHaveURL(/\/admin\/storage$/);
		await expect(page.getByRole('link', { name: /avatars/i })).toBeVisible();
		await expect(page.getByRole('link', { name: /documents/i })).toBeVisible();

		await page.getByRole('link', { name: /avatars/i }).click();
		await expect(page).toHaveURL(/\/admin\/storage\/avatars$/);
		await expect(page.getByText('This bucket is empty.')).toBeVisible();

		diagnostics.assertNoUnexpectedErrors();
	});

	test('creates a real auth user, opens the detail screen, and deletes the user cleanly', async ({ page }) => {
		const diagnostics = monitorBrowserDiagnostics(page);
		const userEmail = `live.user+${Date.now()}@example.com`;

		await ensureAdminSession(page);

		await page.locator('.sidebar').getByRole('link', { name: 'Users' }).click();
		await expect(page).toHaveURL(/\/admin\/auth$/);

		await page.getByRole('button', { name: '+ Create User' }).click();
		await page.getByLabel('Email').fill(userEmail);
		await page.getByLabel('Password').fill('Password123!');
		await page.getByRole('button', { name: 'Create User', exact: true }).click();

		await expect(page.getByText('User created successfully')).toBeVisible();
		await expect(page.getByText(userEmail)).toBeVisible();

		await page.locator('tr[role="button"]', { hasText: userEmail }).click();
		await expect(page).toHaveURL(/\/admin\/auth\/.+$/);
		await expect(page.getByText('Account Info')).toBeVisible();
		await expect(page.getByText(userEmail)).toBeVisible();

		await page.getByRole('button', { name: 'Delete User' }).click();
		await page.getByRole('alertdialog', { name: 'Delete User' }).getByRole('button', { name: 'Delete User' }).click();

		await expect(page).toHaveURL(/\/admin\/auth$/);
		await expect(page.getByText('User deleted')).toBeVisible();
		await expect(page.getByText(userEmail)).toHaveCount(0);

		diagnostics.assertNoUnexpectedErrors();
	});
});
