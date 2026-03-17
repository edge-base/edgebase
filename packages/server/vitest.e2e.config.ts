import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * E2E test config for wrangler dev tests (Decision #102, #103).
 *
 * Runs in Node.js (NOT vitest-pool-workers) so real TCP connections are available.
 * Requires wrangler dev to be running:
 *   TMPDIR=/tmp XDG_CONFIG_HOME=/tmp npx wrangler dev --config wrangler.test.toml --port 8688
 */
export default defineConfig({
  resolve: {
    alias: {
      '@edgebase/sdk': path.resolve(__dirname, '../sdk/js/src/index.ts'),
      '@edgebase/web': path.resolve(__dirname, '../sdk/js/packages/web/src/index.ts'),
    },
  },
  test: {
    include: ['test/integration/realtime-e2e.test.ts', 'test/integration/sdk-live.test.ts', 'test/integration/room-e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
