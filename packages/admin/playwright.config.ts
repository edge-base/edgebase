import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
	testDir: './e2e',
	testIgnore: ['**/live/**'],
	timeout: 30_000,
	expect: {
		timeout: 5_000,
	},
	fullyParallel: true,
	reporter: 'list',
	use: {
		baseURL: `http://127.0.0.1:${port}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off',
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
			},
		},
	],
	webServer: {
		command: `pnpm exec vite dev --host 127.0.0.1 --port ${port}`,
		url: `http://127.0.0.1:${port}/admin/login`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
