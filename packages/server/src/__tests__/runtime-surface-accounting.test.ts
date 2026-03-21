/**
 * Runtime surface accounting.
 *
 * Guards against route / middleware / durable object files silently drifting
 * outside the test suite's field of view. A runtime file must either be
 * mentioned in unit/integration tests or be explicitly tracked here as
 * indirectly covered.
 */
import { readFileSync, readdirSync } from 'fs';
import { basename, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGE_ROOT = resolve(SRC_ROOT, '..');
const RUNTIME_DIRS = [
  resolve(SRC_ROOT, 'routes'),
  resolve(SRC_ROOT, 'durable-objects'),
  resolve(SRC_ROOT, 'middleware'),
];
const TEST_DIRS = [
  resolve(SRC_ROOT, '__tests__'),
  resolve(PACKAGE_ROOT, 'test/integration'),
];
const THIS_TEST_PATH = resolve(fileURLToPath(import.meta.url));

// Files below are exercised indirectly, but the test sources do not mention the
// exact filename/stem yet. Tracking them here keeps the gap reviewable.
const KNOWN_INDIRECT_RUNTIME_COVERAGE = new Map<string, string>([
  [
    'routes/schema-endpoint.ts',
    'Covered via /api/schema integration tests and OpenAPI/spec checks, but the file name is not referenced directly.',
  ],
  [
    'durable-objects/logs-do.ts',
    'Covered indirectly via analytics/logging flows; keep explicit until a direct file reference lands in tests.',
  ],
  [
    'durable-objects/room-runtime-base.ts',
    'Covered through RoomsDO and room protocol/state tests, but the shared runtime base is not referenced by filename.',
  ],
]);

function collectFiles(dir: string, predicate: (path: string) => boolean): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(entryPath, predicate));
      continue;
    }
    if (predicate(entryPath)) {
      results.push(entryPath);
    }
  }

  return results;
}

function toRuntimeKey(absPath: string): string {
  for (const dir of RUNTIME_DIRS) {
    if (absPath.startsWith(dir)) {
      return `${basename(dir)}/${relative(dir, absPath).replace(/\\/g, '/')}`;
    }
  }
  throw new Error(`Unexpected runtime path: ${absPath}`);
}

function fileMentionsRuntime(testSource: string, runtimeKey: string): boolean {
  const fileName = runtimeKey.split('/').at(-1) ?? runtimeKey;
  const stem = fileName.replace(/\.ts$/, '');
  return testSource.includes(fileName) || testSource.includes(stem);
}

describe('runtime surface accounting', () => {
  const runtimeFiles = RUNTIME_DIRS
    .flatMap((dir) => collectFiles(dir, (path) => path.endsWith('.ts')))
    .map(toRuntimeKey)
    .sort();

  const allTestSource = TEST_DIRS
    .flatMap((dir) => collectFiles(dir, (path) => path.endsWith('.test.ts')))
    .filter((path) => path !== THIS_TEST_PATH)
    .map((path) => readFileSync(path, 'utf-8'))
    .join('\n');

  it('every runtime file is referenced by tests or tracked as indirect coverage', () => {
    const unaccounted = runtimeFiles.filter((runtimeKey) => (
      !fileMentionsRuntime(allTestSource, runtimeKey)
      && !KNOWN_INDIRECT_RUNTIME_COVERAGE.has(runtimeKey)
    ));

    if (unaccounted.length > 0) {
      expect.fail(
        `Found runtime files that are not referenced by tests.\n` +
        `Mention them in a test (comment/import/assertion) or add them to KNOWN_INDIRECT_RUNTIME_COVERAGE with a reason.\n\n` +
        unaccounted.map((file) => `  - ${file}`).join('\n'),
      );
    }
  });

  it('indirect coverage entries still point to real runtime files', () => {
    for (const runtimeKey of KNOWN_INDIRECT_RUNTIME_COVERAGE.keys()) {
      expect(
        runtimeFiles.includes(runtimeKey),
        `KNOWN_INDIRECT_RUNTIME_COVERAGE contains '${runtimeKey}' but that runtime file no longer exists.`,
      ).toBe(true);
    }
  });

  it('indirect coverage entries are removed once tests mention the runtime file', () => {
    for (const [runtimeKey, reason] of KNOWN_INDIRECT_RUNTIME_COVERAGE.entries()) {
      expect(reason.trim().length, `Provide a reason for '${runtimeKey}'.`).toBeGreaterThan(0);
      expect(
        fileMentionsRuntime(allTestSource, runtimeKey),
        `Tests now mention '${runtimeKey}'. Remove it from KNOWN_INDIRECT_RUNTIME_COVERAGE.`,
      ).toBe(false);
    }
  });
});
