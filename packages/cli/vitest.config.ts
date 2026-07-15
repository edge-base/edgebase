import { defineConfig } from 'vitest/config';

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const testTimeout =
  process.env.LOCAL_CI === '1'
    ? 180_000
    : process.env.EDGEBASE_LOCAL_CI_EMULATED_AMD64 === '1'
      ? 60_000
      : 20_000;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout,
    fileParallelism: !isCI,
    maxWorkers: isCI ? 1 : undefined,
    minWorkers: isCI ? 1 : undefined,
  },
});
