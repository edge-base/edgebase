import { defineConfig } from 'vitest/config';

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const isSlowLocalCi =
  process.env.LOCAL_CI === '1' || process.env.EDGEBASE_LOCAL_CI_EMULATED_AMD64 === '1';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: isSlowLocalCi ? 60_000 : 20_000,
    fileParallelism: !isCI,
    maxWorkers: isCI ? 1 : undefined,
    minWorkers: isCI ? 1 : undefined,
  },
});
