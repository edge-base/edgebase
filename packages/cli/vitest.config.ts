import { defineConfig } from 'vitest/config';

const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    fileParallelism: !isCI,
    maxWorkers: isCI ? 1 : undefined,
    minWorkers: isCI ? 1 : undefined,
  },
});
