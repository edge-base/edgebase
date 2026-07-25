import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  __packArtifactPublicationTestUtils,
  publishPackArtifact,
  type PackArtifactPublicationPoint,
} from '../src/lib/pack-artifact-publication.js';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicationModuleUrl = pathToFileURL(
  join(packageDir, 'src', 'lib', 'pack-artifact-publication.ts'),
).href;
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};
const tempDirs: string[] = [];

function createTempDir(name: string): string {
  const path = join(
    tmpdir(),
    `edgebase-pack-publication-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(path, { recursive: true });
  tempDirs.push(path);
  return path;
}

function writeDirectoryArtifact(path: string, generation: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'generation.txt'), generation);
}

function readDirectoryArtifact(path: string): string {
  return readFileSync(join(path, 'generation.txt'), 'utf-8');
}

function validateDirectoryArtifact(path: string): void {
  const generation = readDirectoryArtifact(path);
  if (!generation) throw new Error(`Artifact generation is empty: ${path}`);
}

function assertNoOwnedPublicationResidue(outputPath: string): void {
  const parentPath = dirname(outputPath);
  const outputName = outputPath.slice(parentPath.length + 1);
  const residue = readdirSync(parentPath).filter((entry) => (
    entry.startsWith(`.${outputName}.stage-`)
    || entry.startsWith(`.${outputName}.previous-`)
    || entry === `.${outputName}.edgebase-publication`
  ));
  expect(residue).toEqual([]);
}

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for child ${child.pid ?? 'unknown'} to exit.`));
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveExit();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe('pack artifact publication', () => {
  it('preserves a complete old or new artifact at every catchable publication boundary', () => {
    const parentPath = createTempDir('catchable-boundaries');
    const outputPath = join(parentPath, 'portable-output');
    const points: PackArtifactPublicationPoint[] = [
      'after-publication-journal-create',
      'after-staged-artifact-build',
      'after-staged-artifact-validation',
      'after-staged-artifact-sync',
      'after-previous-artifact-rename',
      'after-staged-artifact-rename',
      'after-previous-artifact-cleanup',
    ];

    for (const point of points) {
      rmSync(outputPath, { recursive: true, force: true });
      writeDirectoryArtifact(outputPath, `old:${point}`);

      expect(() => publishPackArtifact({
        outputPath,
        kind: 'directory',
        build(stagingPath) {
          writeDirectoryArtifact(stagingPath, `new:${point}`);
          return undefined;
        },
        validate: validateDirectoryArtifact,
        faultInjector(currentPoint) {
          if (currentPoint === point) throw new Error(`fault:${point}`);
        },
      })).toThrow(`fault:${point}`);

      expect(readDirectoryArtifact(outputPath)).toBe(
        point === 'after-staged-artifact-rename'
          || point === 'after-previous-artifact-cleanup'
          ? `new:${point}`
          : `old:${point}`,
      );
      assertNoOwnedPublicationResidue(outputPath);
    }
  });

  it.skipIf(process.platform === 'win32')(
    'recovers the exact old or new artifact after process death at replacement boundaries',
    { timeout: 30_000 },
    () => {
      const parentPath = createTempDir('process-death');
      const outputPath = join(parentPath, 'portable-output');
      const scriptPath = join(parentPath, 'kill-publisher.ts');
      writeFileSync(
        scriptPath,
        `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publishPackArtifact } from ${JSON.stringify(publicationModuleUrl)};

const outputPath = process.argv.at(-2);
const killPoint = process.argv.at(-1);
if (!outputPath || !killPoint) throw new Error('missing child arguments');

publishPackArtifact({
  outputPath,
  kind: 'directory',
  build(stagingPath) {
    mkdirSync(stagingPath, { recursive: true });
    writeFileSync(join(stagingPath, 'generation.txt'), 'new:' + killPoint);
  },
  validate(artifactPath) {
    if (!artifactPath) throw new Error('missing artifact');
  },
  faultInjector(point) {
    if (point === killPoint) process.kill(process.pid, 'SIGKILL');
  },
});
`,
      );

      for (const point of [
        'after-staged-artifact-sync',
        'after-previous-artifact-rename',
        'after-staged-artifact-rename',
      ] satisfies PackArtifactPublicationPoint[]) {
        rmSync(outputPath, { recursive: true, force: true });
        writeDirectoryArtifact(outputPath, `old:${point}`);
        const result = spawnSync(
          tsxCommand.command,
          [...tsxCommand.argsPrefix, scriptPath, outputPath, point],
          {
            cwd: packageDir,
            encoding: 'utf-8',
            stdio: 'pipe',
            ...tsxExecOptions,
          },
        );
        expect(result.signal === 'SIGKILL' || result.status === 137, JSON.stringify({
          status: result.status,
          signal: result.signal,
          error: result.error?.message,
          stdout: result.stdout,
          stderr: result.stderr,
        }, null, 2)).toBe(true);

        let recoveredGeneration = '';
        expect(() => publishPackArtifact({
          outputPath,
          kind: 'directory',
          admitExisting(recoveredPath) {
            recoveredGeneration = readDirectoryArtifact(recoveredPath);
            throw new Error('stop-after-recovery');
          },
          build() {
            throw new Error('build must not run');
          },
          validate: validateDirectoryArtifact,
        })).toThrow('stop-after-recovery');
        expect(recoveredGeneration).toBe(
          point === 'after-staged-artifact-rename'
            ? `new:${point}`
            : `old:${point}`,
        );
        assertNoOwnedPublicationResidue(outputPath);
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a same-output contender before mutation while different outputs proceed',
    { timeout: 30_000 },
    async () => {
      const parentPath = createTempDir('concurrency');
      const outputPath = join(parentPath, 'portable-output');
      const independentOutputPath = join(parentPath, 'independent-output');
      const readyPath = join(parentPath, 'holder-ready');
      const scriptPath = join(parentPath, 'hold-publisher.ts');
      writeDirectoryArtifact(outputPath, 'old');
      writeFileSync(
        scriptPath,
        `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { publishPackArtifact } from ${JSON.stringify(publicationModuleUrl)};

const outputPath = process.argv.at(-2);
const readyPath = process.argv.at(-1);
if (!outputPath || !readyPath) throw new Error('missing child arguments');

publishPackArtifact({
  outputPath,
  kind: 'directory',
  build(stagingPath) {
    mkdirSync(stagingPath, { recursive: true });
    writeFileSync(join(stagingPath, 'generation.txt'), 'holder-new');
  },
  validate() {},
  faultInjector(point) {
    if (point !== 'after-publication-journal-create') return;
    writeFileSync(readyPath, String(process.pid));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);
  },
});
`,
      );
      const holder = spawn(
        tsxCommand.command,
        [...tsxCommand.argsPrefix, scriptPath, outputPath, readyPath],
        {
          cwd: packageDir,
          stdio: 'pipe',
          ...tsxExecOptions,
        },
      );
      let builderPid: number | null = null;
      try {
        await waitForFile(readyPath);
        builderPid = Number(readFileSync(readyPath, 'utf-8'));
        expect(Number.isInteger(builderPid) && builderPid > 0).toBe(true);
        expect(() => publishPackArtifact({
          outputPath,
          kind: 'directory',
          build() {
            throw new Error('same-output loser mutated');
          },
          validate: validateDirectoryArtifact,
        })).toThrow('Another EdgeBase pack build is already publishing this output path');
        expect(readDirectoryArtifact(outputPath)).toBe('old');

        publishPackArtifact({
          outputPath: independentOutputPath,
          kind: 'directory',
          build(stagingPath) {
            writeDirectoryArtifact(stagingPath, 'independent-new');
          },
          validate: validateDirectoryArtifact,
        });
        expect(readDirectoryArtifact(independentOutputPath)).toBe('independent-new');
      } finally {
        if (builderPid) {
          try {
            process.kill(builderPid, 'SIGKILL');
          } catch {
            // The wrapper may share the same PID and already be exiting.
          }
        }
        holder.kill('SIGKILL');
        await waitForExit(holder);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }

      let recoveredGeneration = '';
      expect(() => publishPackArtifact({
        outputPath,
        kind: 'directory',
        admitExisting(recoveredPath) {
          recoveredGeneration = readDirectoryArtifact(recoveredPath);
          throw new Error('stop-after-recovery');
        },
        build() {
          throw new Error('build must not run');
        },
        validate: validateDirectoryArtifact,
      })).toThrow('stop-after-recovery');
      expect(recoveredGeneration).toBe('old');
      assertNoOwnedPublicationResidue(outputPath);
    },
  );

  it('fails closed on malformed persistent publication evidence', () => {
    const parentPath = createTempDir('malformed-journal');
    const outputPath = join(parentPath, 'portable-output');
    writeDirectoryArtifact(outputPath, 'old');
    const paths = __packArtifactPublicationTestUtils.resolvePublicationPaths(outputPath);
    mkdirSync(paths.journalPath);
    writeFileSync(join(paths.journalPath, 'journal.json'), '{ malformed');

    expect(() => publishPackArtifact({
      outputPath,
      kind: 'directory',
      build() {
        throw new Error('build must not run');
      },
      validate: validateDirectoryArtifact,
    })).toThrow('publication journal metadata is malformed');
    expect(readDirectoryArtifact(outputPath)).toBe('old');
    expect(readdirSync(paths.journalPath)).toEqual(['journal.json']);
  });
});
