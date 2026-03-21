import { defineConfig, devices } from '@playwright/test';

const appPort = Number(process.env['EDGEBASE_ROOM_MEDIA_APP_PORT'] ?? '4175');
const apiPort = Number(process.env['EDGEBASE_ROOM_MEDIA_API_PORT'] ?? '8796');
const inspectorPort = Number(process.env['EDGEBASE_ROOM_MEDIA_WRANGLER_INSPECTOR_PORT'] ?? '9230');
const persistTo = process.env['EDGEBASE_ROOM_MEDIA_PERSIST_TO'] ?? `../server/.wrangler/room-media-state-${apiPort}`;
const outputDir = process.env['EDGEBASE_ROOM_MEDIA_OUTPUT_DIR'] ?? 'test-results';

const accountId = process.env['EDGEBASE_ROOM_MEDIA_CF_ACCOUNT_ID'] ?? '';
const apiToken = process.env['EDGEBASE_ROOM_MEDIA_CF_API_TOKEN'] ?? '';
const appId = process.env['EDGEBASE_ROOM_MEDIA_CF_APP_ID'] ?? '';
const presetName = process.env['EDGEBASE_ROOM_MEDIA_CF_PRESET_NAME'] ?? 'group_call_participant';

export default defineConfig({
  testDir: './e2e/live',
  testMatch: /room-media\.spec\.ts/,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir,
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: [
    {
      command: [
        'pnpm --dir ../server exec wrangler dev --config wrangler.test.toml --local',
        `--port ${apiPort}`,
        `--inspector-port ${inspectorPort}`,
        `--persist-to ${persistTo}`,
        `--var CF_ACCOUNT_ID:${accountId}`,
        `--var CF_API_TOKEN:${apiToken}`,
        `--var CF_REALTIME_APP_ID:${appId}`,
        `--var CF_REALTIME_PRESET_NAME:${presetName}`,
      ].join(' '),
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
      },
    },
    {
      command: `pnpm --dir ../sdk/js/packages/web build && cd ../.. && python3 -m http.server ${appPort} --bind 127.0.0.1`,
      url: `http://127.0.0.1:${appPort}/packages/admin/e2e/support/room-media-harness.html`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
      },
    },
  ],
});
