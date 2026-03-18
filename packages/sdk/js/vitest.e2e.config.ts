import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * E2E vitest config — requires wrangler dev --port 8688.
 *
 * Run: pnpm test:e2e
 */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    environment: 'happy-dom',
    hookTimeout: Number(process.env['VITEST_HOOK_TIMEOUT_MS'] || process.env['EDGEBASE_E2E_TIMEOUT_MS'] || '30000'),
    testTimeout: Number(process.env['VITEST_TEST_TIMEOUT_MS'] || process.env['EDGEBASE_E2E_TIMEOUT_MS'] || '30000'),
    env: {
      BASE_URL: process.env['BASE_URL'] || 'http://localhost:8688',
      SERVICE_KEY: process.env['SERVICE_KEY'] || process.env['EDGEBASE_SERVICE_KEY'] || 'test-service-key-for-admin',
      EDGEBASE_SERVICE_KEY: process.env['EDGEBASE_SERVICE_KEY'] || process.env['SERVICE_KEY'] || 'test-service-key-for-admin',
    },
  },
  resolve: {
    alias: {
      '@edgebase-fun/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@edgebase-fun/web': resolve(__dirname, 'packages/web/src/index.ts'),
      '@edgebase-fun/admin': resolve(__dirname, 'packages/admin/src/index.ts'),
    },
  },
});
