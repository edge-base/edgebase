import { mutationTargets } from './mutation-targets.mjs';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.unit.config.ts',
  },
  // Note: TypeScript checker requires @stryker-mutator/typescript-checker.
  // Disable for now — mutation testing validates behavior, not types.
  checkers: [],
  plugins: ['@stryker-mutator/vitest-runner'],
  // Core business logic with strong unit test coverage. Declarative schemas.ts
  // and provider configuration objects remain deliberately excluded.
  mutate: [...mutationTargets],
  thresholds: {
    high: 90,
    low: 85,
    break: 85,
  },
  reporters: ['clear-text', 'progress'],
  tempDirName: '/tmp/stryker-tmp',
  // Run mutations in-place (no sandbox). Required because the monorepo
  // tsconfig.json uses relative `extends` paths that break in /tmp sandbox.
  inPlace: true,
  concurrency: 4,
  timeoutMS: 30000,
};
