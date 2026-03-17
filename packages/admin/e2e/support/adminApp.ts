import { expect, type Page } from '@playwright/test';

import {
	installMockAdminApi,
	type MockAdminApiOptions,
	type MockAdminController,
} from './mockAdminApi';

export async function bootstrapAdminApp(
	page: Page,
	options: MockAdminApiOptions = {},
): Promise<MockAdminController> {
	await page.addInitScript(() => {
		localStorage.setItem('edgebase_onboarding_dismissed', 'true');
	});

	return installMockAdminApi(page, options);
}

export async function signIn(page: Page, email = 'admin@example.com', password = 'Password123!') {
	await page.goto('/admin/login');
	await expect(page.getByText('Sign in to Admin Dashboard')).toBeVisible();

	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill(password);
	await page.getByRole('button', { name: 'Sign In' }).click();

	await expect(page).toHaveURL(/\/admin\/?$/);
	await expect(page.getByText('Total Users')).toBeVisible();
}
