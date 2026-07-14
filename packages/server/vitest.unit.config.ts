import { defineConfig } from 'vitest/config';
import { localCiTimeout } from './vitest-local-ci-timeout';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: localCiTimeout(5_000),
    hookTimeout: localCiTimeout(10_000),
    // No retry for unit tests — deterministic by nature
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      // Exclude lib files that do not have dedicated tests yet.
      // Mirror UNTESTED_LIBS in meta-export-coverage.test.ts.
      exclude: [
        'src/lib/analytics-adapter.ts',
        'src/lib/analytics-query.ts',
        'src/lib/auth-d1.ts',
        'src/lib/cron.ts',
        'src/lib/db-sql.ts',
        // Provider request handlers — validated by the integration suite (the
        // `shared` namespace routes to D1) plus mocked-executor unit tests, the
        // same way the canonical database-do.ts handler sits outside src/lib/.
        // Both are already classified integration-only in UNTESTED_LIBS.
        'src/lib/d1-handler.ts',
        'src/lib/postgres-handler.ts',
        'src/lib/email-templates.ts',
        'src/lib/functions.ts',
        'src/lib/log-writer.ts',
        'src/lib/password-policy.ts',
        'src/lib/push-provider.ts',
        'src/lib/push-token.ts',
        'src/lib/route-parser.ts',
      ],
      thresholds: {
        // Baseline: enforce that coverage does not regress.
        // Increase these as untested code paths get covered.
        branches: 80,
        functions: 60,
        lines: 50,
      },
    },
  },
});
