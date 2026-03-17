import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['bench/**/*.bench.ts', 'test/bench/**/*.bench.ts'],
    testTimeout: 120_000,
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: {
          configPath: './wrangler.bench.toml',
        },
      },
    },
  },
});
