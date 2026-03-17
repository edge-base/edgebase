import { expect, test } from '@playwright/test';

import { bootstrapAdminApp, signIn } from './support/adminApp';

test('creates a user, handles partial bulk deletion, and opens the surviving detail page', async ({ page }) => {
	const mock = await bootstrapAdminApp(page, {
		failDeleteUserIds: ['user_bravo'],
	});

	await signIn(page);

	await page.locator('.sidebar').getByRole('link', { name: 'Users' }).click();
	await expect(page).toHaveURL(/\/admin\/auth$/);

	await page.getByRole('button', { name: '+ Create User' }).click();
	await page.getByLabel('Email').fill('new.user@example.com');
	await page.getByLabel('Password').fill('Password123!');
	await page.getByRole('button', { name: 'Create User', exact: true }).click();

	await expect(page.getByText('User created successfully')).toBeVisible();
	await expect(page.getByText('new.user@example.com')).toBeVisible();

	await page.getByLabel('Select all users').click();
	await page.getByRole('button', { name: 'Delete Selected' }).click();
	await page.getByRole('alertdialog', { name: /Delete 3 users\?/ }).getByRole('button', { name: 'Delete' }).click();

	await expect(page.getByText('2 succeeded, 1 failed')).toBeVisible();
	await expect(page.getByText('bravo@example.com')).toBeVisible();
	await expect(page.getByText('alpha@example.com')).toHaveCount(0);

	await page.getByRole('button', { name: /bravo@example\.com/i }).click();
	await expect(page).toHaveURL(/\/admin\/auth\/user_bravo$/);
	await expect(page.getByText('Account Info')).toBeVisible();

	await page.getByRole('button', { name: 'Send Reset Email' }).click();
	await expect(page.getByText('Password reset email sent')).toBeVisible();

	mock.assertNoUnhandled();
});

test('navigates storage buckets, paginates objects, and deletes a file from the bucket view', async ({ page }) => {
	const mock = await bootstrapAdminApp(page);

	await signIn(page);

	await page.locator('.sidebar').getByRole('link', { name: 'Files' }).click();
	await expect(page).toHaveURL(/\/admin\/storage$/);
	await expect(page.getByRole('link', { name: /avatars/i })).toBeVisible();

	await page.getByRole('link', { name: /avatars/i }).click();
	await expect(page).toHaveURL(/\/admin\/storage\/avatars$/);

	await page.getByRole('button', { name: 'folder/' }).click();
	await expect(page).toHaveURL(/\/admin\/storage\/avatars\?prefix=folder%2F$/);
	await expect(page.getByText('avatar.png')).toBeVisible();

	await page.getByRole('button', { name: 'Load More' }).click();
	await expect(page.getByText('report.pdf')).toBeVisible();

	await page.getByRole('button', { name: 'nested/' }).click();
	await expect(page.getByText('This folder is empty.')).toBeVisible();

	await page.getByRole('button', { name: 'folder' }).click();
	await expect(page.getByText('avatar.png')).toBeVisible();

	const avatarRow = page.locator('tr', { hasText: 'avatar.png' });
	await avatarRow.getByRole('button', { name: 'Delete' }).click();
	await page.getByRole('alertdialog', { name: 'Delete File' }).getByRole('button', { name: 'Delete' }).click();

	await expect(page.getByText('Deleted folder/avatar.png')).toBeVisible();
	await expect(page.getByText('avatar.png')).toHaveCount(0);

	mock.assertNoUnhandled();
});
