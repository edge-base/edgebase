import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __packTestUtils, createArchiveFromPortableArtifact } from '../src/lib/pack.js';

const tempDirs: string[] = [];

function createFixtureRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `edgebase-pack-safety-${name}-`));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('pack output safety', () => {
  it('does not trust a prior-artifact marker that is itself a symbolic link', () => {
    const fixtureRoot = createFixtureRoot('marker-link');
    const outputPath = join(fixtureRoot, 'output');
    const outsideMarker = join(fixtureRoot, 'outside-marker.json');
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(join(outputPath, 'sentinel.txt'), 'preserve me\n', 'utf-8');
    writeFileSync(outsideMarker, JSON.stringify({ schemaVersion: 1, format: 'portable' }), 'utf-8');
    symlinkSync(outsideMarker, join(outputPath, 'edgebase-portable.json'), 'file');

    expect(__packTestUtils.isPriorPackArtifactDir(outputPath)).toBe(false);
    expect(() => __packTestUtils.assertSafePackOutputPath(outputPath)).toThrow(
      /not a prior EdgeBase pack artifact/,
    );
    expect(readFileSync(join(outputPath, 'sentinel.txt'), 'utf-8')).toBe('preserve me\n');
  });

  it('does not trust a nested marker reached through a symbolic-link directory', () => {
    const fixtureRoot = createFixtureRoot('marker-parent-link');
    const outputPath = join(fixtureRoot, 'output');
    const outsideContents = join(fixtureRoot, 'outside-contents');
    mkdirSync(outputPath, { recursive: true });
    mkdirSync(join(outsideContents, 'Resources'), { recursive: true });
    writeFileSync(join(outputPath, 'sentinel.txt'), 'preserve me\n', 'utf-8');
    writeFileSync(
      join(outsideContents, 'Resources', 'edgebase-portable.json'),
      JSON.stringify({ schemaVersion: 1, format: 'portable' }),
      'utf-8',
    );
    symlinkSync(outsideContents, join(outputPath, 'Contents'), 'dir');

    expect(__packTestUtils.isPriorPackArtifactDir(outputPath)).toBe(false);
    expect(() => __packTestUtils.assertSafePackOutputPath(outputPath)).toThrow(
      /not a prior EdgeBase pack artifact/,
    );
  });

  it('requires a regular marker with the matching schema version and format', () => {
    const fixtureRoot = createFixtureRoot('marker-schema');
    const outputPath = join(fixtureRoot, 'output');
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(join(outputPath, 'sentinel.txt'), 'preserve me\n', 'utf-8');
    writeFileSync(
      join(outputPath, 'edgebase-pack.json'),
      JSON.stringify({ schemaVersion: 1, format: 'portable' }),
      'utf-8',
    );

    expect(__packTestUtils.isPriorPackArtifactDir(outputPath)).toBe(false);
    expect(() => __packTestUtils.assertSafePackOutputPath(outputPath)).toThrow(
      /not a prior EdgeBase pack artifact/,
    );

    writeFileSync(
      join(outputPath, 'edgebase-pack.json'),
      JSON.stringify({ schemaVersion: 1, format: 'dir' }),
      'utf-8',
    );
    expect(__packTestUtils.isPriorPackArtifactDir(outputPath)).toBe(true);
    expect(() => __packTestUtils.assertSafePackOutputPath(outputPath)).not.toThrow();
  });

  it('rejects external artifact links before replacing an existing archive', () => {
    const fixtureRoot = createFixtureRoot('archive-link');
    const sourcePath = join(fixtureRoot, 'portable');
    const outsideFile = join(fixtureRoot, 'outside-secret.txt');
    const archivePath = join(fixtureRoot, 'existing.tar.gz');
    mkdirSync(sourcePath, { recursive: true });
    writeFileSync(outsideFile, 'must-not-be-archived\n', 'utf-8');
    writeFileSync(archivePath, 'preserve existing archive\n', 'utf-8');
    symlinkSync(outsideFile, join(sourcePath, 'leak.txt'), 'file');

    expect(() => createArchiveFromPortableArtifact(sourcePath, archivePath)).toThrow(
      /symbolic link outside its root/,
    );
    expect(readFileSync(archivePath, 'utf-8')).toBe('preserve existing archive\n');
  });

  it('accepts artifact links whose resolved targets remain inside the artifact', () => {
    const fixtureRoot = createFixtureRoot('internal-link');
    const sourcePath = join(fixtureRoot, 'portable');
    mkdirSync(join(sourcePath, 'files'), { recursive: true });
    writeFileSync(join(sourcePath, 'files', 'entry.txt'), 'safe\n', 'utf-8');
    symlinkSync(join('files', 'entry.txt'), join(sourcePath, 'entry-link.txt'), 'file');

    expect(() => __packTestUtils.assertArtifactSymlinksContained(sourcePath)).not.toThrow();
    expect(existsSync(join(sourcePath, 'entry-link.txt'))).toBe(true);
  });

  it('rejects absolute links even when they currently resolve inside the artifact', () => {
    const fixtureRoot = createFixtureRoot('absolute-internal-link');
    const sourcePath = join(fixtureRoot, 'portable');
    mkdirSync(join(sourcePath, 'files'), { recursive: true });
    const targetPath = join(sourcePath, 'files', 'entry.txt');
    writeFileSync(targetPath, 'safe only at this absolute path\n', 'utf-8');
    symlinkSync(targetPath, join(sourcePath, 'entry-link.txt'), 'file');

    expect(() => __packTestUtils.assertArtifactSymlinksContained(sourcePath)).toThrow(
      /non-portable symbolic link outside its root/,
    );
  });

  it('rejects links that leave the artifact before re-entering by its current name', () => {
    const fixtureRoot = createFixtureRoot('reentering-link');
    const sourcePath = join(fixtureRoot, 'portable');
    mkdirSync(join(sourcePath, 'files'), { recursive: true });
    writeFileSync(
      join(sourcePath, 'files', 'entry.txt'),
      'safe only under this root name\n',
      'utf-8',
    );
    symlinkSync(
      join('..', 'portable', 'files', 'entry.txt'),
      join(sourcePath, 'entry-link.txt'),
      'file',
    );

    expect(() => __packTestUtils.assertArtifactSymlinksContained(sourcePath)).toThrow(
      /non-portable symbolic link outside its root/,
    );
  });
});
