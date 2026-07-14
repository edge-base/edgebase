import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { localCiTimeout } from './vitest-local-ci-timeout';

export default defineWorkersConfig({
  test: {
    include: ['bench/**/*.bench.ts', 'test/bench/**/*.bench.ts'],
    testTimeout: localCiTimeout(120_000),
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
