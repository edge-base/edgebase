#!/usr/bin/env node

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../../../../scripts/ci-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..');
const repoRootDir = path.resolve(packageDir, '../../..');
const tempDir = process.env['TMPDIR'] ?? process.env['TMP'] ?? process.env['TEMP'] ?? os.tmpdir();
const buildTargets = [
  ['packages/shared', 'dist/index.js'],
  ['packages/sdk/js/packages/core', 'dist/index.js'],
  ['packages/sdk/js/packages/web', 'dist/index.js'],
  ['packages/sdk/js/packages/admin', 'dist/index.js'],
  ['packages/sdk/js/packages/ssr', 'dist/index.js'],
];

const suites = [
  ['.', 'vitest.e2e.config.ts', [
    'test/core.e2e.test.ts',
    'test/web.e2e.test.ts',
    'test/web-storage.e2e.test.ts',
    'test/admin.e2e.test.ts',
    'test/ssr.e2e.test.ts',
  ]],
  ['.', 'vitest.ssr-e2e.config.ts', ['test/ssr-auth.e2e.test.ts']],
  ['packages/core', 'vitest.config.ts', 'test/e2e/core.e2e.test.ts'],
  ['packages/web', 'vitest.config.ts', 'test/e2e/web.e2e.test.ts'],
  ['packages/admin', 'vitest.config.ts', [
    'test/e2e/admin.e2e.test.ts',
    'test/e2e/property.e2e.test.ts',
  ]],
];

async function ensureBuildArtifacts() {
  const missingBuild = buildTargets.some(([relativeDir, artifactPath]) => {
    return !existsSync(path.join(repoRootDir, relativeDir, artifactPath));
  });

  if (!missingBuild) return;

  for (const [relativeDir] of buildTargets) {
    const result = await runCommand('pnpm', ['build'], {
      cwd: path.join(repoRootDir, relativeDir),
    });

    if (result.code !== 0) {
      process.exit(result.code ?? 1);
    }
  }
}

await ensureBuildArtifacts();

for (const [relativeDir, configPath, testPaths] of suites) {
  const paths = Array.isArray(testPaths) ? testPaths : [testPaths];
  const result = await runCommand(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', configPath, ...paths],
    {
      cwd: path.join(packageDir, relativeDir),
      env: {
        TMPDIR: tempDir,
        TMP: tempDir,
        TEMP: tempDir,
      },
    },
  );

  if (result.code !== 0) {
    process.exit(result.code ?? 1);
  }
}
