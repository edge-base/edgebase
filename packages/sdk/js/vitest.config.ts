import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

/**
 * Default vitest config — unit tests only.
 * E2E tests (require wrangler dev :8688) use vitest.e2e.config.ts.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.unit.test.ts'],
    environment: 'happy-dom',
  },
  resolve: {
    alias: {
      '@edgebase-fun/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@edgebase-fun/web': resolve(__dirname, 'packages/web/src/index.ts'),
      '@edgebase-fun/admin': resolve(__dirname, 'packages/admin/src/index.ts'),
    },
  },
});
