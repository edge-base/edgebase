import { expect, type Page } from '@playwright/test';

export const LIVE_ADMIN_EMAIL = 'live-admin@example.com';
export const LIVE_ADMIN_PASSWORD = 'Admin12345!';

export async function bootstrapLiveAdminApp(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem('edgebase_onboarding_dismissed', 'true');
	});
}

async function waitForLoginMode(page: Page): Promise<'setup' | 'login'> {
	const createButton = page.getByRole('button', { name: 'Create Admin Account' });
	const signInButton = page.getByRole('button', { name: 'Sign In' });

	await expect
		.poll(
			async () => {
				if (await createButton.isVisible().catch(() => false)) return 'setup';
				if (await signInButton.isVisible().catch(() => false)) return 'login';
				return 'loading';
			},
			{
				timeout: 20_000,
				message: 'expected the admin login screen to finish loading',
			},
		)
		.not.toBe('loading');

	if (await createButton.isVisible().catch(() => false)) return 'setup';
	return 'login';
}

export async function openAdminLogin(page: Page): Promise<'setup' | 'login'> {
	await page.goto('/admin/login');
	await expect(page.getByRole('heading', { name: 'EdgeBase' })).toBeVisible();
	return waitForLoginMode(page);
}

export async function ensureAdminSession(
	page: Page,
	email = LIVE_ADMIN_EMAIL,
	password = LIVE_ADMIN_PASSWORD,
) {
	await bootstrapLiveAdminApp(page);
	const mode = await openAdminLogin(page);

	if (mode === 'setup') {
		await page.getByLabel('Admin Email').fill(email);
		await page.getByLabel('Choose Password').fill(password);
		await page.getByRole('button', { name: 'Create Admin Account' }).click();
	} else {
		await page.getByLabel('Email').fill(email);
		await page.getByLabel('Password').fill(password);
		await page.getByRole('button', { name: 'Sign In' }).click();
	}

	await expect(page).toHaveURL(/\/admin\/?$/);
	await expect(page.getByText('Total Users')).toBeVisible();
}

export async function logoutFromAdmin(page: Page) {
	await page.getByRole('button', { name: 'Logout' }).click();
	await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);
}
