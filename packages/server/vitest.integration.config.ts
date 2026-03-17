import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

process.env.EDGEBASE_USE_TEST_CONFIG ??= '1';

export default defineWorkersConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    exclude: ['test/integration/sdk-*.test.ts'],
    setupFiles: ['./test/integration/setup.ts'],
    fileParallelism: false,
    retry: 1, // in-process retry는 DO invalidation에 무의미 — 프로세스 레벨 재시도 사용 (run-integration-shards.sh)
    testTimeout: 30_000,
    hookTimeout: 15_000,
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.test.toml' },
        miniflare: {
          compatibilityDate: '2025-02-10',
          compatibilityFlags: ['nodejs_compat'],
          durableObjectsPersist: false,
          d1Persist: false,
          kvPersist: false,
          r2Persist: false,
          ratelimits: {
            TEST_RATE_LIMITER: {
              simple: { limit: 5, period: 10 },
            },
          },
        },
      },
    },
  },
});
