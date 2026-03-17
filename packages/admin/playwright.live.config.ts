import { defineConfig, devices } from '@playwright/test';

const appPort = 4174;
const apiPort = 8788;
const sidecarPort = apiPort + 1;

export default defineConfig({
	testDir: './e2e/live',
	timeout: 60_000,
	expect: {
		timeout: 10_000,
	},
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'list',
	use: {
		baseURL: `http://127.0.0.1:${appPort}`,
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
	webServer: [
		{
			command: './scripts/start-live-worker.sh',
			url: `http://127.0.0.1:${apiPort}/admin/api/setup/status`,
			reuseExistingServer: false,
			timeout: 180_000,
			env: {
				...process.env,
				EDGEBASE_LIVE_API_PORT: String(apiPort),
				EDGEBASE_LIVE_SIDECAR_PORT: String(sidecarPort),
			},
		},
		{
			command: './scripts/start-live-dashboard.sh',
			url: `http://127.0.0.1:${appPort}/admin/login`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				...process.env,
				EDGEBASE_LIVE_APP_PORT: String(appPort),
				EDGEBASE_LIVE_API_PORT: String(apiPort),
				EDGEBASE_LIVE_SIDECAR_PORT: String(sidecarPort),
			},
		},
	],
});
