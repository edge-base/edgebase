/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.unit.config.ts',
  },
  // Note: TypeScript checker requires @stryker-mutator/typescript-checker.
  // Disable for now — mutation testing validates behavior, not types.
  checkers: [],
  plugins: [
    '@stryker-mutator/vitest-runner',
  ],
  mutate: [
    // Core business logic with strong unit test coverage
    'src/lib/query-engine.ts',
    'src/lib/validation.ts',
    'src/lib/schema.ts',
    'src/lib/op-parser.ts',
    'src/lib/uuid.ts',
    'src/lib/errors.ts',
    'src/lib/cidr.ts',
    'src/lib/password.ts',
    'src/lib/do-router.ts',
    'src/lib/service-key.ts',
    // Excluded: schemas.ts (declarative Zod — mutations in .openapi() metadata are meaningless)
    // Excluded: oauth-providers.ts (pure config objects for 13 providers — unit tests cover parse/validate helpers only)
  ],
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
