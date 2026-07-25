import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import {
  createDockerContextGenerationManager,
  syncDockerContextPath,
  type DockerContextGeneration,
  type DockerContextGenerationManager,
  type DockerContextGenerationManagerOptions,
  type DockerContextLease,
  type DockerContextMaintenanceEvent,
} from '../src/lib/docker-context-generation.js';

const COMPLETE_MARKER = '.edgebase-docker-context-complete.json';
const DEAD_PID = 2_147_483_647;
const LEGACY_MIGRATION_ID = 'a'.repeat(32);
const OTHER_LEGACY_MIGRATION_ID = 'b'.repeat(32);

let projectDir: string;
let cleanupPaths: string[];

function createManager(
  prefix: string,
  options: DockerContextGenerationManagerOptions = {},
  root = projectDir,
): DockerContextGenerationManager {
  mkdirSync(root, { recursive: true });
  let nonceIndex = 0;
  return createDockerContextGenerationManager(root, {
    nonce: () => `${prefix}-${String(nonceIndex += 1).padStart(4, '0')}`,
    ...options,
  });
}

function createGeneration(
  manager: DockerContextGenerationManager,
  id: string,
  payload = id,
): { lease: DockerContextLease; generation: DockerContextGeneration } {
  let lease = manager.createLease();
  lease = manager.setPlannedGeneration(lease, id);
  const generation = manager.publishGeneration(lease, (stagingDir) => {
    writeFileSync(join(stagingDir, 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(join(stagingDir, 'payload.txt'), `${payload}\n`);
  });
  return { lease, generation };
}

function writeCompleteMarker(
  path: string,
  generationId: string,
  leaseId: string,
  migrationId = LEGACY_MIGRATION_ID,
): void {
  writeFileSync(join(path, COMPLETE_MARKER), `${JSON.stringify({
    schemaVersion: 1,
    generationId,
    leaseId,
    createdAt: new Date().toISOString(),
    ...(generationId === 'legacy-v0' ? { migrationId } : {}),
  })}\n`);
}

function readLeaseState(lease: DockerContextLease): string {
  return String(JSON.parse(readFileSync(lease.ownerPath, 'utf-8')).state);
}

function pathEntryNames(path: string): string[] {
  return readdirSync(path).sort();
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function seedDeadConsumers(root: string, count: number): void {
  mkdirSync(root, { recursive: true });
  const manager = createManager('dead-seed', {
    orphanCap: Math.max(16, count + 2),
    pid: DEAD_PID,
    processIsAlive: () => false,
  }, root);
  for (let index = 0; index < count; index += 1) {
    const item = createGeneration(manager, `dead-consumer-${index}`);
    manager.markConsuming(item.lease);
  }
}

function seedAtomicPointerPreparation(
  manager: DockerContextGenerationManager,
  lease: DockerContextLease,
  generation: DockerContextGeneration,
  kind: 'current' | 'export',
): {
  preparationPath: string;
  operationPath: string;
  pointerPath: string;
  expectedTarget: string;
} {
  const leaseRecord = JSON.parse(readFileSync(lease.ownerPath, 'utf-8')) as {
    id: string;
    pid: number;
  };
  const preparationPath = join(
    manager.paths.atomicDir,
    `.prepare-${leaseRecord.pid}-${'d'.repeat(16)}-${leaseRecord.id}`,
  );
  const operationPath = join(preparationPath, 'e'.repeat(16));
  mkdirSync(operationPath, { recursive: true });
  writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
    schemaVersion: 1,
    ownerId: leaseRecord.id,
    pid: leaseRecord.pid,
    kind,
  })}\n`);
  const finalPointerPath = kind === 'current'
    ? manager.paths.currentPath
    : manager.paths.exportPath;
  const expectedTarget = relative(
    realpathSync(dirname(finalPointerPath)),
    realpathSync(generation.path),
  );
  const pointerPath = join(operationPath, 'pointer');
  symlinkSync(expectedTarget, pointerPath, 'dir');
  return { preparationPath, operationPath, pointerPath, expectedTarget };
}

function singleAtomicPreparation(manager: DockerContextGenerationManager): {
  preparationPath: string;
  operationPath: string;
} {
  const preparationNames = pathEntryNames(manager.paths.atomicDir)
    .filter((name) => name.startsWith('.prepare-'));
  expect(preparationNames).toHaveLength(1);
  const preparationPath = join(manager.paths.atomicDir, preparationNames[0]);
  const operationNames = pathEntryNames(preparationPath);
  expect(operationNames).toHaveLength(1);
  return {
    preparationPath,
    operationPath: join(preparationPath, operationNames[0]),
  };
}

function addForeignAtomicCleanupEntry(
  manager: DockerContextGenerationManager,
): {
  preparationPath: string;
  operationPath: string;
  ownerPath: string;
  foreignPath: string;
} {
  const exact = singleAtomicPreparation(manager);
  const ownerPath = join(exact.operationPath, 'owner.json');
  const foreignPath = join(exact.operationPath, 'foreign.txt');
  writeFileSync(foreignPath, 'preserve\n');
  return { ...exact, ownerPath, foreignPath };
}

beforeEach(() => {
  projectDir = join(
    tmpdir(),
    `edgebase-context-adversarial-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  cleanupPaths = [];
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  for (const path of cleanupPaths) rmSync(path, { recursive: true, force: true });
});

describe('Docker context generation adversarial lifecycle', () => {
  it('does not collect a generation published after the generation snapshot', () => {
    const writer = createManager('snapshot-writer');
    const prior = createGeneration(writer, 'snapshot-prior');
    let priorLease = writer.publishCurrent(prior.lease, prior.generation);
    priorLease = writer.markReleased(priorLease);
    expect(priorLease.state).toBe('released');

    let newer: { lease: DockerContextLease; generation: DockerContextGeneration } | undefined;
    const collector = createManager('snapshot-gc', {
      faultInjector(point) {
        if (point !== 'after-gc-generation-snapshot' || newer) return;
        newer = createGeneration(writer, 'snapshot-newer');
        newer.lease = writer.publishCurrent(newer.lease, newer.generation);
        newer.lease = writer.markReleased(newer.lease);
      },
    });

    collector.collectGarbage();

    expect(newer).toBeDefined();
    expect(existsSync(newer!.generation.path)).toBe(true);
    expect(existsSync(newer!.lease.ownerPath)).toBe(true);
    expect(realpathSync(collector.paths.currentPath)).toBe(realpathSync(newer!.generation.path));
  });

  it('preserves a foreign lease-owned path replacement after the GC snapshot', () => {
    const movedOwnedPath = `${projectDir}-moved-owned-artifact`;
    cleanupPaths.push(movedOwnedPath);
    let workPath = '';
    let foreignPath = '';
    let replaced = false;
    const manager = createManager('gc-foreign-replacement', {
      pid: 101,
      processIsAlive: () => false,
      faultInjector(point) {
        if (point !== 'after-gc-pointer-snapshot' || replaced) return;
        replaced = true;
        renameSync(workPath, movedOwnedPath);
        foreignPath = join(workPath, 'foreign', 'keep.txt');
        mkdirSync(dirname(foreignPath), { recursive: true });
        writeFileSync(foreignPath, 'preserve\n');
      },
    });
    let lease = manager.createLease();
    workPath = manager.allocateBundleWork(lease);
    writeFileSync(join(workPath, 'owned.txt'), 'owned\n');
    lease = manager.markReleased(lease);
    let observedError: unknown;

    try {
      manager.collectGarbage();
    } catch (error) {
      observedError = error;
    }

    expect(replaced).toBe(true);
    expect.soft(observedError).toBeInstanceOf(Error);
    expect.soft(existsSync(foreignPath)).toBe(true);
    expect(readFileSync(join(movedOwnedPath, 'owned.txt'), 'utf-8')).toBe('owned\n');
  });

  it('preserves a foreign child added to an unchanged lease-owned path after the GC snapshot', () => {
    let workPath = '';
    let foreignPath = '';
    let inserted = false;
    const manager = createManager('gc-foreign-child', {
      pid: 102,
      processIsAlive: () => false,
      faultInjector(point) {
        if (point !== 'after-gc-pointer-snapshot' || inserted) return;
        inserted = true;
        foreignPath = join(workPath, 'foreign', 'keep.txt');
        mkdirSync(dirname(foreignPath), { recursive: true });
        writeFileSync(foreignPath, 'preserve\n');
      },
    });
    let lease = manager.createLease();
    workPath = manager.allocateBundleWork(lease);
    const ownedPath = join(workPath, 'owned.txt');
    writeFileSync(ownedPath, 'owned\n');
    lease = manager.markReleased(lease);
    let observedError: unknown;

    try {
      manager.collectGarbage();
    } catch (error) {
      observedError = error;
    }

    expect(inserted).toBe(true);
    expect.soft(observedError).toBeInstanceOf(Error);
    expect.soft(existsSync(ownedPath)).toBe(true);
    expect.soft(existsSync(lease.ownerPath)).toBe(true);
    expect(readFileSync(foreignPath, 'utf-8')).toBe('preserve\n');
  });

  it('preserves a foreign child added to the active GC owner before release', () => {
    let foreignPath = '';
    let inserted = false;
    const manager = createManager('gc-owner-foreign-child', {
      faultInjector(point) {
        if (point !== 'after-gc-pointer-snapshot' || inserted) return;
        inserted = true;
        foreignPath = join(manager.paths.gcOwnerPath, 'foreign', 'keep.txt');
        mkdirSync(dirname(foreignPath), { recursive: true });
        writeFileSync(foreignPath, 'preserve\n');
      },
    });
    let observedError: unknown;

    try {
      manager.collectGarbage();
    } catch (error) {
      observedError = error;
    }

    expect(inserted).toBe(true);
    expect.soft(observedError).toBeInstanceOf(Error);
    expect.soft(existsSync(manager.paths.gcOwnerPath)).toBe(true);
    expect(readFileSync(foreignPath, 'utf-8')).toBe('preserve\n');
  });

  it('preserves a same-path foreign normal atomic-owner replacement after the GC snapshot', () => {
    let ownerPath = '';
    let movedOwnerPath = '';
    let foreignPath = '';
    let replaced = false;
    const manager = createManager('normal-atomic-owner-replacement', {
      faultInjector(point) {
        if (point !== 'after-gc-pointer-snapshot' || replaced) return;
        replaced = true;
        movedOwnerPath = `${ownerPath}-owned`;
        renameSync(ownerPath, movedOwnerPath);
        foreignPath = join(ownerPath, 'foreign', 'keep.txt');
        mkdirSync(dirname(foreignPath), { recursive: true });
        writeFileSync(foreignPath, 'preserve\n');
      },
    });
    let lease = manager.createLease();
    ownerPath = join(manager.paths.atomicDir, lease.id);
    const operationPath = join(ownerPath, 'operation');
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: lease.id,
      pid: process.pid,
      kind: 'current',
    })}\n`);
    lease = manager.markReleased(lease);
    let observedError: unknown;

    try {
      manager.collectGarbage();
    } catch (error) {
      observedError = error;
    }

    expect(replaced).toBe(true);
    expect.soft(observedError).toBeInstanceOf(AggregateError);
    expect.soft(existsSync(lease.ownerPath)).toBe(true);
    expect.soft(existsSync(movedOwnerPath)).toBe(true);
    expect(readFileSync(foreignPath, 'utf-8')).toBe('preserve\n');
  });

  it('preserves a same-path foreign generation replacement after the GC snapshot', () => {
    let generationPath = '';
    let movedGenerationPath = '';
    let foreignPath = '';
    let replaced = false;
    const manager = createManager('generation-replacement', {
      faultInjector(point) {
        if (point !== 'after-gc-pointer-snapshot' || replaced) return;
        replaced = true;
        movedGenerationPath = `${generationPath}-owned`;
        renameSync(generationPath, movedGenerationPath);
        mkdirSync(generationPath);
        foreignPath = join(generationPath, 'keep.txt');
        writeFileSync(foreignPath, 'preserve\n');
      },
    });
    const item = createGeneration(manager, 'generation-replacement-generation');
    generationPath = item.generation.path;
    item.lease = manager.markReleased(item.lease);
    let observedError: unknown;

    try {
      manager.collectGarbage();
    } catch (error) {
      observedError = error;
    }

    expect(replaced).toBe(true);
    expect.soft(observedError).toBeInstanceOf(AggregateError);
    expect.soft(existsSync(item.lease.ownerPath)).toBe(true);
    expect.soft(existsSync(movedGenerationPath)).toBe(true);
    expect(readFileSync(foreignPath, 'utf-8')).toBe('preserve\n');
  });

  it('isolates one drifted deletion lane and full-drains independent exact lanes', () => {
    let driftedWorkPath = '';
    let foreignPath = '';
    let inserted = false;
    const deleteEvents: DockerContextMaintenanceEvent[] = [];
    const manager = createManager('deletion-failure-isolation', {
      deletionChunkSize: 2,
      faultInjector(point) {
        if (point !== 'after-gc-pointer-snapshot' || inserted) return;
        inserted = true;
        foreignPath = join(driftedWorkPath, 'foreign', 'keep.txt');
        mkdirSync(dirname(foreignPath), { recursive: true });
        writeFileSync(foreignPath, 'preserve\n');
      },
      maintenanceObserver(event) {
        if (event.phase === 'delete-chunk') deleteEvents.push(event);
      },
    });
    const items = Array.from({ length: 3 }, (_, index) => {
      let lease = manager.createLease();
      const workPath = manager.allocateBundleWork(lease);
      writeFileSync(join(workPath, 'owned.txt'), `${index}\n`);
      lease = manager.markReleased(lease);
      return { lease, workPath };
    });
    const drifted = items[1];
    driftedWorkPath = drifted.workPath;
    let observedError: unknown;

    try {
      manager.collectGarbage();
    } catch (error) {
      observedError = error;
    }

    expect(inserted).toBe(true);
    expect.soft(observedError).toBeInstanceOf(AggregateError);
    expect.soft((observedError as AggregateError).errors).toHaveLength(1);
    expect.soft(existsSync(drifted.workPath)).toBe(true);
    expect.soft(existsSync(drifted.lease.ownerPath)).toBe(true);
    expect(readFileSync(foreignPath, 'utf-8')).toBe('preserve\n');
    for (const item of items.filter((candidate) => candidate !== drifted)) {
      expect.soft(existsSync(item.workPath)).toBe(false);
      expect.soft(existsSync(item.lease.ownerPath)).toBe(false);
    }
    expect(deleteEvents).toEqual([
      { phase: 'delete-chunk', chunkIndex: 0, chunkSize: 2, remaining: 4 },
      { phase: 'delete-chunk', chunkIndex: 1, chunkSize: 2, remaining: 2 },
      { phase: 'delete-chunk', chunkIndex: 2, chunkSize: 2, remaining: 0 },
    ]);
  });

  it.each([65, 1_000])(
    'rejects deletion chunk size %i above the hard 64-item bound',
    (deletionChunkSize) => {
      expect(() => createManager(`oversized-delete-chunk-${deletionChunkSize}`, {
        deletionChunkSize,
      })).toThrow(/deletion chunk.*(?:64|maximum|bound)/i);
    },
  );

  it('uses one configured inventory for legacy discovery before any migration mutation', () => {
    const events: DockerContextMaintenanceEvent[] = [];
    const manager = createManager('legacy-shared-inventory', {
      maxInventoryEntries: 6,
      maintenanceObserver: (event) => events.push(event),
    });
    mkdirSync(manager.paths.currentPath);
    writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM legacy\n');
    mkdirSync(join(manager.paths.atomicDir, 'unrelated-normal-owner'));

    expect(() => manager.recoverLegacyCurrent()).toThrow(/inventory.*6|exceeds.*6/i);

    expect(pathEntryNames(manager.paths.currentPath)).toEqual(['Dockerfile']);
    expect(existsSync(join(manager.paths.currentPath, COMPLETE_MARKER))).toBe(false);
    expect(existsSync(manager.paths.legacyMigrationPath)).toBe(false);
    expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(false);
    const inventories = events.filter((event): event is Extract<
      DockerContextMaintenanceEvent,
      { phase: 'inventory' }
    > => event.phase === 'inventory');
    expect(inventories.map((event) => event.scanned)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('charges exact maintenance revalidation to the configured inventory before deletion', () => {
    const events: DockerContextMaintenanceEvent[] = [];
    const manager = createManager('revalidation-shared-inventory', {
      pid: DEAD_PID,
      processIsAlive: () => false,
      maxInventoryEntries: 10,
      maintenanceObserver: (event) => events.push(event),
    });
    let lease = manager.createLease();
    const workPath = manager.allocateBundleWork(lease);
    const ownedPath = join(workPath, 'owned.txt');
    writeFileSync(ownedPath, 'owned\n');
    lease = manager.markReleased(lease);
    events.length = 0;

    expect(() => manager.collectGarbage()).toThrow(/inventory.*10|exceeds.*10/i);

    expect(existsSync(ownedPath)).toBe(true);
    expect(existsSync(workPath)).toBe(true);
    expect(existsSync(lease.ownerPath)).toBe(true);
    const inventories = events.filter((event): event is Extract<
      DockerContextMaintenanceEvent,
      { phase: 'inventory' }
    > => event.phase === 'inventory');
    expect(inventories.map((event) => event.scanned))
      .toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
  });

  it('reclaims multiple complete owned generations when snapshot and deletion each fit the bound', () => {
    const seed = createManager('generation-phase-seed', {
      processIsAlive: () => true,
    });
    const createWideGeneration = (id: string) => {
      let lease = seed.createLease();
      lease = seed.setPlannedGeneration(lease, id);
      const generation = seed.publishGeneration(lease, (stagingDir) => {
        writeFileSync(join(stagingDir, 'Dockerfile'), 'FROM node:22\n');
        const payloadDir = join(stagingDir, 'payload');
        mkdirSync(payloadDir);
        for (let index = 0; index < 12; index += 1) {
          writeFileSync(join(payloadDir, `${index}.txt`), `${id}-${index}\n`);
        }
      });
      return { lease, generation };
    };
    const staleA = createWideGeneration('phase-stale-a');
    const staleB = createWideGeneration('phase-stale-b');
    const current = createWideGeneration('phase-current');
    current.lease = seed.publishCurrent(current.lease, current.generation);
    staleA.lease = seed.markReleased(staleA.lease);
    staleB.lease = seed.markReleased(staleB.lease);
    current.lease = seed.markReleased(current.lease);

    const collector = createManager('generation-phase-collector', {
      processIsAlive: () => false,
      maxInventoryEntries: 180,
    });

    expect(() => collector.collectGarbage()).not.toThrow();
    expect(existsSync(staleA.generation.path)).toBe(false);
    expect(existsSync(staleB.generation.path)).toBe(false);
    expect(existsSync(current.generation.path)).toBe(true);
    expect(realpathSync(collector.paths.currentPath)).toBe(realpathSync(current.generation.path));
  });

  it.each(['inode-replacement', 'content-drift'] as const)(
    'preserves legacy journal %s detected immediately before exact clear',
    (drift) => {
      let injected = false;
      let journal = '';
      let preservedOwnedPath = '';
      let expectedJournal = '';
      let originalInode = 0;
      const manager = createManager(`legacy-clear-${drift}`, {
        faultInjector(point) {
          if ((point as string) !== 'before-legacy-journal-clear' || injected) return;
          injected = true;
          if (drift === 'inode-replacement') {
            preservedOwnedPath = `${manager.paths.legacyMigrationPath}.owned`;
            renameSync(manager.paths.legacyMigrationPath, preservedOwnedPath);
            expectedJournal = 'foreign replacement\n';
            writeFileSync(manager.paths.legacyMigrationPath, expectedJournal);
          } else {
            expectedJournal = `${journal.trimEnd()} \n`;
            writeFileSync(manager.paths.legacyMigrationPath, expectedJournal);
          }
        },
      });
      mkdirSync(manager.paths.legacyRecoveryPath);
      writeFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'FROM legacy\n');
      writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'legacy-migration');
      journal = `${JSON.stringify({
        schemaVersion: 1,
        generationId: 'legacy-v0',
        source: manager.paths.currentPath,
        destination: manager.paths.legacyRecoveryPath,
        pid: DEAD_PID,
        migrationId: LEGACY_MIGRATION_ID,
      })}\n`;
      writeFileSync(manager.paths.legacyMigrationPath, journal);
      originalInode = lstatSync(manager.paths.legacyMigrationPath).ino;
      symlinkSync(
        relative(dirname(manager.paths.currentPath), manager.paths.legacyRecoveryPath),
        manager.paths.currentPath,
        'dir',
      );

      expect(() => manager.recoverLegacyCurrent()).toThrow(/journal|evidence|changed|identity/i);

      expect(injected).toBe(true);
      expect(readFileSync(manager.paths.legacyMigrationPath, 'utf-8')).toBe(expectedJournal);
      if (drift === 'inode-replacement') {
        expect(readFileSync(preservedOwnedPath, 'utf-8')).toBe(journal);
        expect(lstatSync(manager.paths.legacyMigrationPath).ino).not.toBe(originalInode);
      } else {
        expect(lstatSync(manager.paths.legacyMigrationPath).ino).toBe(originalInode);
      }
      expect(realpathSync(manager.paths.currentPath))
        .toBe(realpathSync(manager.paths.legacyRecoveryPath));
    },
  );

  it('preserves a same-path foreign replacement of a live writeJsonAtomic temporary', () => {
    let injected = false;
    let foreignPath = '';
    let preservedOwnedPath = '';
    const manager = createManager('live-json-temp-replacement', {
      faultInjector(point) {
        if ((point as string) !== 'before-json-temporary-delete' || injected) return;
        const temporaryName = pathEntryNames(manager.paths.leasesDir)
          .find((name) => name.includes('.json.sync-'));
        expect(temporaryName).toBeDefined();
        foreignPath = join(manager.paths.leasesDir, temporaryName!);
        preservedOwnedPath = `${foreignPath}.owned`;
        renameSync(foreignPath, preservedOwnedPath);
        writeFileSync(foreignPath, 'foreign replacement\n');
        injected = true;
      },
    });
    let observedError: unknown;

    try {
      manager.createLease();
    } catch (error) {
      observedError = error;
    }

    expect.soft(injected).toBe(true);
    expect.soft(observedError).toBeInstanceOf(Error);
    if (!injected) return;
    expect(readFileSync(foreignPath, 'utf-8')).toBe('foreign replacement\n');
    expect(readFileSync(preservedOwnedPath, 'utf-8')).toMatch(/"state":"preconsumer"/);
  });

  it('blocks every later same-owner deletion while independent owners and chunks drain', () => {
    const events: DockerContextMaintenanceEvent[] = [];
    let firstStagingPath = '';
    let firstForeignPath = '';
    let injected = false;
    const manager = createManager('same-owner-dependency-block', {
      pid: DEAD_PID,
      processIsAlive: () => false,
      deletionChunkSize: 2,
      maintenanceObserver: (event) => events.push(event),
      faultInjector(point) {
        if (point !== 'after-gc-pointer-snapshot' || injected) return;
        injected = true;
        firstForeignPath = join(firstStagingPath, 'foreign', 'keep.txt');
        mkdirSync(dirname(firstForeignPath), { recursive: true });
        writeFileSync(firstForeignPath, 'preserve\n');
      },
    });
    let firstLease = manager.createLease();
    firstStagingPath = join(manager.paths.stagingDir, firstLease.id);
    mkdirSync(firstStagingPath);
    writeFileSync(join(firstStagingPath, 'owned.txt'), 'owned\n');
    const firstWorkPath = manager.allocateBundleWork(firstLease);
    const firstWorkFile = join(firstWorkPath, 'owned.txt');
    writeFileSync(firstWorkFile, 'owned\n');
    firstLease = manager.markReleased(firstLease);
    let independentLease = manager.createLease();
    const independentWorkPath = manager.allocateBundleWork(independentLease);
    independentLease = manager.markReleased(independentLease);
    events.length = 0;
    let observedError: unknown;

    try {
      manager.collectGarbage();
    } catch (error) {
      observedError = error;
    }

    expect(injected).toBe(true);
    expect.soft(observedError).toBeInstanceOf(AggregateError);
    const aggregate = observedError as AggregateError;
    expect.soft(aggregate.errors).toHaveLength(1);
    expect.soft(String(aggregate.errors[0])).toContain(firstStagingPath);
    expect(readFileSync(firstForeignPath, 'utf-8')).toBe('preserve\n');
    expect(existsSync(firstWorkFile)).toBe(true);
    expect(existsSync(firstLease.ownerPath)).toBe(true);
    expect(existsSync(independentWorkPath)).toBe(false);
    expect(existsSync(independentLease.ownerPath)).toBe(false);
    expect(events.filter((event) => event.phase === 'delete-chunk')).toEqual([
      { phase: 'delete-chunk', chunkIndex: 0, chunkSize: 2, remaining: 3 },
      { phase: 'delete-chunk', chunkIndex: 1, chunkSize: 2, remaining: 1 },
      { phase: 'delete-chunk', chunkIndex: 2, chunkSize: 1, remaining: 0 },
    ]);
  });

  it('uses explicit win32 semantics for exact direct-child containment', async () => {
    const module = await import('../src/lib/docker-context-generation.js') as unknown as {
      isDockerContextExactDirectChild?: (
        root: string,
        candidate: string,
        pathApi: Pick<typeof win32, 'relative' | 'resolve' | 'sep'>,
      ) => boolean;
    };
    const helper = module.isDockerContextExactDirectChild;
    expect(helper).toBeTypeOf('function');
    if (!helper) return;
    const root = String.raw`C:\repo\state\generations`;
    for (const testCase of [
      { label: 'valid direct child', candidate: String.raw`C:\repo\state\generations\generation-a`, accepted: true },
      { label: 'parent traversal', candidate: win32.resolve(root, '..', 'generation-a'), accepted: false },
      { label: 'absolute escape', candidate: String.raw`C:\outside\generation-a`, accepted: false },
      { label: 'sibling prefix', candidate: String.raw`C:\repo\state\generations-foreign\generation-a`, accepted: false },
      { label: 'cross drive', candidate: String.raw`D:\repo\state\generations\generation-a`, accepted: false },
    ]) {
      expect(helper(root, testCase.candidate, win32), testCase.label).toBe(testCase.accepted);
    }
  });

  it('performs zero mutation for a duplicate lease id stored under the wrong filename', () => {
    const events: DockerContextMaintenanceEvent[] = [];
    const manager = createManager('filename-id', {
      maintenanceObserver: (event) => events.push(event),
    });
    const victim = createGeneration(manager, 'filename-id-victim');
    victim.lease = manager.markReleased(victim.lease);
    const duplicatePath = join(manager.paths.leasesDir, 'alias.json');
    writeFileSync(duplicatePath, readFileSync(victim.lease.ownerPath));
    events.length = 0;

    expect(() => manager.collectGarbage()).toThrow(/filename\/id mismatch/i);
    expect(events.filter((event) => event.phase === 'delete-chunk')).toHaveLength(0);
    expect(existsSync(victim.lease.ownerPath)).toBe(true);
    expect(existsSync(victim.generation.path)).toBe(true);
    expect(existsSync(duplicatePath)).toBe(true);
    expect(existsSync(manager.paths.gcOwnerPath)).toBe(false);
  });

  it.each([
    'mismatched-id',
    'lease-symlink',
    'unexpected-lease-entry',
    'staging-file',
    'generation-file',
    'generation-symlink',
  ] as const)('performs zero GC deletion for malformed inventory: %s', (kind) => {
    const events: DockerContextMaintenanceEvent[] = [];
    const manager = createManager(`zero-mutation-${kind}`, {
      maintenanceObserver: (event) => events.push(event),
    });
    const reclaimable = createGeneration(manager, `${kind}-reclaimable`);
    reclaimable.lease = manager.markReleased(reclaimable.lease);
    let workLease = manager.createLease();
    const workPath = manager.allocateBundleWork(workLease);
    workLease = manager.markReleased(workLease);
    const rooted = createGeneration(manager, `${kind}-rooted`);
    rooted.lease = manager.publishCurrent(rooted.lease, rooted.generation);
    const currentTarget = realpathSync(manager.paths.currentPath);
    let malformedPath: string;

    if (kind === 'mismatched-id') {
      malformedPath = join(manager.paths.leasesDir, 'alias.json');
      const record = JSON.parse(readFileSync(rooted.lease.ownerPath, 'utf-8')) as Record<string, unknown>;
      writeFileSync(malformedPath, `${JSON.stringify({ ...record, id: 'forged-owner' })}\n`);
    } else if (kind === 'lease-symlink') {
      malformedPath = join(manager.paths.leasesDir, 'alias.json');
      symlinkSync(reclaimable.lease.ownerPath, malformedPath, 'file');
    } else if (kind === 'unexpected-lease-entry') {
      malformedPath = join(manager.paths.leasesDir, 'unexpected');
      writeFileSync(malformedPath, 'unexpected\n');
    } else if (kind === 'staging-file') {
      malformedPath = join(manager.paths.stagingDir, 'unexpected');
      writeFileSync(malformedPath, 'unexpected\n');
    } else if (kind === 'generation-file') {
      malformedPath = join(manager.paths.generationsDir, 'unexpected');
      writeFileSync(malformedPath, 'unexpected\n');
    } else {
      const externalPath = join(projectDir, 'external-generation-target');
      mkdirSync(externalPath);
      malformedPath = join(manager.paths.generationsDir, 'unexpected');
      symlinkSync(externalPath, malformedPath, 'dir');
    }
    events.length = 0;

    expect(() => manager.collectGarbage()).toThrow();
    expect(events.filter((event) => event.phase === 'delete-chunk')).toHaveLength(0);
    expect(existsSync(malformedPath)).toBe(true);
    expect(existsSync(reclaimable.lease.ownerPath)).toBe(true);
    expect(existsSync(reclaimable.generation.path)).toBe(true);
    expect(existsSync(workLease.ownerPath)).toBe(true);
    expect(existsSync(workPath)).toBe(true);
    expect(existsSync(rooted.lease.ownerPath)).toBe(true);
    expect(existsSync(rooted.generation.path)).toBe(true);
    expect(realpathSync(manager.paths.currentPath)).toBe(currentTarget);
    expect(existsSync(manager.paths.gcOwnerPath)).toBe(false);
  });

  it('validates every generation before deleting any earlier valid candidate', () => {
    const manager = createManager('late-malformed');
    const victim = createGeneration(manager, 'a-valid-victim');
    victim.lease = manager.markReleased(victim.lease);
    const malformedPath = join(manager.paths.generationsDir, 'z-malformed');
    mkdirSync(malformedPath);
    writeFileSync(join(malformedPath, COMPLETE_MARKER), '{');

    expect(() => manager.collectGarbage()).toThrow();
    expect(existsSync(victim.lease.ownerPath)).toBe(true);
    expect(existsSync(victim.generation.path)).toBe(true);
    expect(existsSync(malformedPath)).toBe(true);
    expect(existsSync(manager.paths.gcOwnerPath)).toBe(false);
  });

  it('rejects root, nested, sibling, external, and canonical-alias paths before pointer mutation', () => {
    const manager = createManager('path-shape');
    const parent = createGeneration(manager, 'direct-parent');

    const nestedPath = join(parent.generation.path, 'nested');
    mkdirSync(nestedPath);
    writeCompleteMarker(nestedPath, 'nested', parent.lease.id);

    writeCompleteMarker(manager.paths.generationsDir, 'generations', parent.lease.id);

    const siblingPath = join(dirname(manager.paths.generationsDir), 'generations-sibling');
    mkdirSync(siblingPath);
    writeCompleteMarker(siblingPath, 'generations-sibling', parent.lease.id);

    const externalPath = `${projectDir}-generation-external`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    writeCompleteMarker(externalPath, 'generation-external', parent.lease.id);

    const aliasPath = join(manager.paths.generationsDir, 'direct-parent-alias');
    symlinkSync(parent.generation.path, aliasPath, 'dir');

    for (const { label, generation } of [
      { label: 'nested', generation: { id: 'nested', path: nestedPath } },
      {
        label: 'state root',
        generation: { id: 'generations', path: manager.paths.generationsDir },
      },
      {
        label: 'sibling',
        generation: { id: 'generations-sibling', path: siblingPath },
      },
      {
        label: 'external',
        generation: { id: 'generation-external', path: externalPath },
      },
      {
        label: 'canonical symlink alias',
        generation: { id: parent.generation.id, path: aliasPath },
      },
    ]) {
      expect(() => manager.publishCurrent(parent.lease, generation), label)
        .toThrow(/exact .*direct child/i);
    }
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(readLeaseState(parent.lease)).toBe('preconsumer');

    parent.lease = manager.publishCurrent(parent.lease, parent.generation);
    expect(realpathSync(manager.paths.currentPath)).toBe(realpathSync(parent.generation.path));
    expect(readLeaseState(parent.lease)).toBe('consuming');
  });

  it.each(['legacy-v0', 'legacy-forged', 'legacy-migration', 'legacy-'] as const)(
    'rejects reserved generation id %s from normal lease planning without mutation',
    (generationId) => {
      const manager = createManager(`reserved-plan-${generationId}`);
      const lease = manager.createLease();
      const leaseBefore = readFileSync(lease.ownerPath);

      expect(() => manager.setPlannedGeneration(lease, generationId))
        .toThrow(/reserved legacy/i);
      expect(readFileSync(lease.ownerPath)).toEqual(leaseBefore);
      expect(readLeaseState(lease)).toBe('preconsumer');
      expect(pathEntryNames(manager.paths.transitionsDir)).toEqual([]);
      expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
      expect(pathEntryNames(manager.paths.generationsDir)).toEqual([]);
      expect(existsSync(manager.paths.currentPath)).toBe(false);
      expect(existsSync(manager.paths.exportPath)).toBe(false);
    },
  );

  it('rejects a forged legacy recovery marker owner without pointer mutation', () => {
    const manager = createManager('reserved-forged-recovery');
    mkdirSync(manager.paths.legacyRecoveryPath);
    writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'forged-owner');
    const markerBefore = readFileSync(join(manager.paths.legacyRecoveryPath, COMPLETE_MARKER));
    writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: process.pid,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);
    expect(() => manager.recoverLegacyCurrent()).toThrow(/conflicting|wrong.*owner|identity/i);
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(true);
    expect(readFileSync(join(manager.paths.legacyRecoveryPath, COMPLETE_MARKER)))
      .toEqual(markerBefore);
    expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
  });

  it.each(['legacy-v0', 'legacy-forged', 'legacy-migration', 'legacy-'] as const)(
    'rejects injected reserved generation id %s across every normal publication path',
    (generationId) => {
      const manager = createManager(`reserved-record-${generationId}`);
      const victim = createGeneration(manager, `reserved-victim-${generationId}`);
      victim.lease = manager.markReleased(victim.lease);
      const lease = manager.createLease();
      const record = JSON.parse(readFileSync(lease.ownerPath, 'utf-8')) as Record<string, unknown>;
      writeFileSync(lease.ownerPath, `${JSON.stringify({ ...record, generationId })}\n`);
      const leaseBefore = readFileSync(lease.ownerPath);
      const invalidGeneration = {
        id: generationId,
        path: join(manager.paths.generationsDir, generationId),
      };
      const inventoryBefore = {
        leases: pathEntryNames(manager.paths.leasesDir),
        transitions: pathEntryNames(manager.paths.transitionsDir),
        atomic: pathEntryNames(manager.paths.atomicDir),
        staging: pathEntryNames(manager.paths.stagingDir),
        generations: pathEntryNames(manager.paths.generationsDir),
      };
      let populateCalls = 0;

      for (const action of [
        () => manager.publishGeneration(lease, () => { populateCalls += 1; }),
        () => manager.publishCurrent(lease, invalidGeneration),
        () => manager.publishExport(lease, invalidGeneration),
        () => manager.collectGarbage(),
      ]) {
        expect(action).toThrow(/reserved legacy/i);
      }

      expect(populateCalls).toBe(0);
      expect(readFileSync(lease.ownerPath)).toEqual(leaseBefore);
      expect(existsSync(victim.lease.ownerPath)).toBe(true);
      expect(existsSync(victim.generation.path)).toBe(true);
      expect(existsSync(invalidGeneration.path)).toBe(false);
      expect(existsSync(manager.paths.currentPath)).toBe(false);
      expect(existsSync(manager.paths.exportPath)).toBe(false);
      expect(existsSync(manager.paths.gcOwnerPath)).toBe(false);
      expect({
        leases: pathEntryNames(manager.paths.leasesDir),
        transitions: pathEntryNames(manager.paths.transitionsDir),
        atomic: pathEntryNames(manager.paths.atomicDir),
        staging: pathEntryNames(manager.paths.stagingDir),
        generations: pathEntryNames(manager.paths.generationsDir),
      }).toEqual(inventoryBefore);
    },
  );

  it.each([
    { label: 'final', entryName: 'legacy-migration.json' },
    {
      label: 'temporary',
      entryName: `legacy-migration.json.sync-${process.pid}-0000000000000000`,
    },
  ])('rejects the reserved legacy-migration id as a $label lease owner', ({ entryName }) => {
    const manager = createManager(`reserved-lease-owner-${entryName}`);
    const victim = createGeneration(manager, 'reserved-owner-victim');
    victim.lease = manager.markReleased(victim.lease);
    const ownerPath = join(manager.paths.leasesDir, entryName);
    writeFileSync(ownerPath, `${JSON.stringify({
      schemaVersion: 1,
      id: 'legacy-migration',
      pid: process.pid,
      state: 'preconsumer',
      createdAt: new Date().toISOString(),
    })}\n`);
    const leasesBefore = pathEntryNames(manager.paths.leasesDir);

    expect(() => manager.createLease()).toThrow(/reserved legacy owner/i);
    expect(() => manager.collectGarbage())
      .toThrow(/reserved legacy owner|malformed.*lease temporary/i);
    expect(pathEntryNames(manager.paths.leasesDir)).toEqual(leasesBefore);
    expect(existsSync(ownerPath)).toBe(true);
    expect(existsSync(victim.lease.ownerPath)).toBe(true);
    expect(existsSync(victim.generation.path)).toBe(true);
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(existsSync(manager.paths.exportPath)).toBe(false);
    expect(existsSync(manager.paths.gcOwnerPath)).toBe(false);
  });

  it('serializes same-lease state transitions without losing a terminal update', () => {
    const contender = createManager('transition-contender');
    const item = createGeneration(contender, 'transition-generation');
    let collisionObserved = false;
    const holder = createManager('transition-holder', {
      faultInjector(point) {
        if (point !== 'after-lease-transition-lock' || collisionObserved) return;
        collisionObserved = true;
        expect(() => contender.markReleased(item.lease)).toThrow(/transition.*active/i);
      },
    });

    const consuming = holder.markConsuming(item.lease);

    expect(collisionObserved).toBe(true);
    expect(consuming.state).toBe('consuming');
    expect(readLeaseState(item.lease)).toBe('consuming');
    expect(() => contender.markReleased(consuming)).not.toThrow();
  });

  it.each(['current', 'export'] as const)(
    'shares %s publication lease exclusion with release in both orderings',
    (kind) => {
      const publishFirstRoot = join(projectDir, `publish-first-${kind}`);
      const publishContender = createManager('publish-contender', {}, publishFirstRoot);
      const publishItem = createGeneration(publishContender, 'publish-first-generation');
      let releaseBlocked = false;
      const publisher = createManager('publisher', {
        faultInjector(point) {
          if (point !== 'after-lease-transition-lock' || releaseBlocked) return;
          releaseBlocked = true;
          expect(() => publishContender.markReleased(publishItem.lease))
            .toThrow(/transition.*active/i);
        },
      }, publishFirstRoot);

      const consuming = kind === 'current'
        ? publisher.publishCurrent(publishItem.lease, publishItem.generation)
        : publisher.publishExport(publishItem.lease, publishItem.generation);
      expect(releaseBlocked).toBe(true);
      expect(consuming.state).toBe('consuming');
      const publishedPath = kind === 'current'
        ? publisher.paths.currentPath
        : publisher.paths.exportPath;
      expect(realpathSync(publishedPath)).toBe(realpathSync(publishItem.generation.path));

      const releaseFirstRoot = join(projectDir, `release-first-${kind}`);
      const releaseContender = createManager('release-contender', {}, releaseFirstRoot);
      const releaseItem = createGeneration(releaseContender, 'release-first-generation');
      let publishBlocked = false;
      const releaser = createManager('releaser', {
        faultInjector(point) {
          if (point !== 'after-lease-transition-lock' || publishBlocked) return;
          publishBlocked = true;
          const publish = kind === 'current'
            ? () => releaseContender.publishCurrent(releaseItem.lease, releaseItem.generation)
            : () => releaseContender.publishExport(releaseItem.lease, releaseItem.generation);
          expect(publish)
            .toThrow(/transition.*active/i);
        },
      }, releaseFirstRoot);

      const released = releaser.markReleased(releaseItem.lease);
      expect(publishBlocked).toBe(true);
      expect(released.state).toBe('released');
      const releasedPointerPath = kind === 'current'
        ? releaser.paths.currentPath
        : releaser.paths.exportPath;
      expect(existsSync(releasedPointerPath)).toBe(false);
      const publishReleased = kind === 'current'
        ? () => releaseContender.publishCurrent(released, releaseItem.generation)
        : () => releaseContender.publishExport(released, releaseItem.generation);
      expect(publishReleased)
        .toThrow(/released/i);
    },
  );

  it.each(['current', 'export'] as const)(
    'rejects a stale process owner before %s publication without consuming its lease',
    (kind) => {
      const root = join(projectDir, `stale-owner-${kind}`);
      const owner = createManager('stale-owner', { pid: 101 }, root);
      const item = createGeneration(owner, `stale-owner-${kind}-generation`);
      const leaseBefore = readFileSync(item.lease.ownerPath);
      const contender = createManager('stale-contender', { pid: 202 }, root);
      const publish = kind === 'current'
        ? () => contender.publishCurrent(item.lease, item.generation)
        : () => contender.publishExport(item.lease, item.generation);

      expect(publish).toThrow(/owned by process|owner|pid/i);
      expect(readFileSync(item.lease.ownerPath)).toEqual(leaseBefore);
      expect(readLeaseState(item.lease)).toBe('preconsumer');
      expect(existsSync(contender.paths.currentPath)).toBe(false);
      expect(existsSync(contender.paths.exportPath)).toBe(false);
      expect(pathEntryNames(contender.paths.atomicDir)).toEqual([]);

      const consuming = kind === 'current'
        ? owner.publishCurrent(item.lease, item.generation)
        : owner.publishExport(item.lease, item.generation);
      expect(consuming.state).toBe('consuming');
    },
  );

  it.each([
    'after-legacy-rename',
    'after-atomic-preparation-owner',
    'after-atomic-preparation-operation',
    'after-atomic-preparation-record',
    'after-atomic-owner-publication',
    'after-legacy-pointer',
  ] as const)('does not let delayed legacy recovery replace a newer current pointer after %s', (competitionPoint) => {
    const legacyCurrent = join(projectDir, '.edgebase', 'targets', 'docker-context');
    mkdirSync(legacyCurrent, { recursive: true });
    writeFileSync(join(legacyCurrent, 'Dockerfile'), 'FROM node:22\n');

    let modern: { lease: DockerContextLease; generation: DockerContextGeneration } | undefined;
    const recovering = createManager('legacy-recovery', {
      faultInjector(point) {
        if (point !== competitionPoint || modern) return;
        const writer = createManager('modern-writer');
        modern = createGeneration(writer, `modern-current-${competitionPoint}`);
        modern.lease = writer.publishCurrent(modern.lease, modern.generation);
      },
    });

    const recovered = recovering.recoverLegacyCurrent();

    expect(modern).toBeDefined();
    expect(recovered?.id).toBe(
      competitionPoint === 'after-legacy-pointer' ? 'legacy-v0' : modern!.generation.id,
    );
    expect(realpathSync(recovering.paths.currentPath)).toBe(realpathSync(modern!.generation.path));
    expect(existsSync(recovering.paths.legacyRecoveryPath)).toBe(true);
    expect(existsSync(modern!.generation.path)).toBe(true);
    if (competitionPoint === 'after-legacy-pointer') {
      expect(existsSync(recovering.paths.legacyMigrationPath)).toBe(false);
      expect(recovering.recoverLegacyCurrent()?.id).toBe(modern!.generation.id);
    } else {
      const journalBefore = readFileSync(recovering.paths.legacyMigrationPath, 'utf-8');
      expect(() => recovering.recoverLegacyCurrent())
        .toThrow(/current pointer does not match its pending legacy migration/i);
      expect(readFileSync(recovering.paths.legacyMigrationPath, 'utf-8')).toBe(journalBefore);
    }
    expect(realpathSync(recovering.paths.currentPath)).toBe(realpathSync(modern!.generation.path));
    expect(existsSync(recovering.paths.legacyRecoveryPath)).toBe(true);
  });

  it('roots a valid journaled legacy generation while GC runs after the rename', () => {
    const legacyCurrent = join(projectDir, '.edgebase', 'targets', 'docker-context');
    mkdirSync(legacyCurrent, { recursive: true });
    writeFileSync(join(legacyCurrent, 'Dockerfile'), 'FROM node:22\n');
    let gcRan = false;
    const recovering = createManager('journal-root', {
      faultInjector(point) {
        if (point !== 'after-legacy-rename' || gcRan) return;
        gcRan = true;
        const collector = createManager('journal-gc');
        collector.collectGarbage();
      },
    });

    const recovered = recovering.recoverLegacyCurrent();

    expect(gcRan).toBe(true);
    expect(recovered?.id).toBe('legacy-v0');
    expect(existsSync(recovering.paths.legacyRecoveryPath)).toBe(true);
    expect(realpathSync(recovering.paths.currentPath))
      .toBe(realpathSync(recovering.paths.legacyRecoveryPath));
  });

  it.each(['malformed', 'dangling', 'wrong', 'valid-unreconciled'] as const)(
    'retains %s legacy journal evidence beside a newer current pointer',
    (journalKind) => {
      const manager = createManager(`journal-${journalKind}`);
      const modern = createGeneration(manager, `journal-modern-${journalKind}`);
      modern.lease = manager.publishCurrent(modern.lease, modern.generation);
      const exported = createGeneration(manager, `journal-export-${journalKind}`);
      exported.lease = manager.publishExport(exported.lease, exported.generation);
      const currentBefore = realpathSync(manager.paths.currentPath);
      const exportBefore = realpathSync(manager.paths.exportPath);

      if (journalKind === 'malformed') {
        writeFileSync(manager.paths.legacyMigrationPath, '{');
      } else if (journalKind === 'dangling') {
        symlinkSync(join(manager.paths.stateDir, 'missing-journal'), manager.paths.legacyMigrationPath);
      } else {
        writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
          schemaVersion: 1,
          generationId: 'legacy-v0',
          source: journalKind === 'wrong' ? join(projectDir, 'wrong-source') : manager.paths.currentPath,
          destination: manager.paths.legacyRecoveryPath,
          pid: process.pid,
          migrationId: LEGACY_MIGRATION_ID,
        })}\n`);
      }

      expect(() => manager.recoverLegacyCurrent()).toThrow(/legacy|migration|state/i);
      expect(realpathSync(manager.paths.currentPath)).toBe(currentBefore);
      expect(realpathSync(manager.paths.exportPath)).toBe(exportBefore);
      expect(lstatSync(manager.paths.legacyMigrationPath)).toBeDefined();
      expect(existsSync(modern.generation.path)).toBe(true);
      expect(existsSync(exported.generation.path)).toBe(true);
    },
  );

  it.each([
    { kind: 'current', shape: 'dangling-symlink' },
    { kind: 'current', shape: 'file' },
    { kind: 'current', shape: 'directory' },
    { kind: 'current', shape: 'outside-root' },
    { kind: 'export', shape: 'dangling-symlink' },
    { kind: 'export', shape: 'file' },
    { kind: 'export', shape: 'directory' },
    { kind: 'export', shape: 'outside-root' },
  ] as const)(
    'preserves a retryable lease after rejecting a $shape $kind pointer',
    ({ kind, shape }) => {
      const manager = createManager(`invalid-${kind}-${shape}`);
      const item = createGeneration(manager, `invalid-${kind}-${shape}-generation`);
      const pointerPath = kind === 'current' ? manager.paths.currentPath : manager.paths.exportPath;
      const otherPointerPath = kind === 'current'
        ? manager.paths.exportPath
        : manager.paths.currentPath;
      let outsidePath: string | undefined;

      if (shape === 'dangling-symlink') {
        symlinkSync(join(manager.paths.generationsDir, 'missing-generation'), pointerPath, 'dir');
      } else if (shape === 'file') {
        writeFileSync(pointerPath, 'foreign pointer\n');
      } else if (shape === 'directory') {
        mkdirSync(pointerPath);
        writeFileSync(join(pointerPath, 'keep.txt'), 'preserve\n');
      } else {
        outsidePath = `${projectDir}-outside-pointer-${kind}`;
        cleanupPaths.push(outsidePath);
        mkdirSync(outsidePath);
        writeFileSync(join(outsidePath, 'payload.txt'), 'outside\n');
        writeCompleteMarker(outsidePath, `outside-pointer-${kind}`, item.lease.id);
        symlinkSync(outsidePath, pointerPath, 'dir');
      }

      const leaseBefore = readFileSync(item.lease.ownerPath);
      const markerBefore = readFileSync(join(item.generation.path, COMPLETE_MARKER));
      const payloadBefore = readFileSync(join(item.generation.path, 'payload.txt'));
      const pointerBefore = lstatSync(pointerPath);
      const pointerIdentityBefore = { dev: pointerBefore.dev, ino: pointerBefore.ino };
      const pointerTargetBefore = pointerBefore.isSymbolicLink()
        ? readlinkSync(pointerPath)
        : undefined;
      const pointerFileBefore = pointerBefore.isFile() ? readFileSync(pointerPath) : undefined;
      const pointerDirectoryBefore = pointerBefore.isDirectory()
        ? pathEntryNames(pointerPath)
        : undefined;
      const inventoryBefore = {
        leases: pathEntryNames(manager.paths.leasesDir),
        transitions: pathEntryNames(manager.paths.transitionsDir),
        atomic: pathEntryNames(manager.paths.atomicDir),
        staging: pathEntryNames(manager.paths.stagingDir),
        bundleWork: pathEntryNames(manager.paths.bundleWorkDir),
        generations: pathEntryNames(manager.paths.generationsDir),
      };

      const publish = kind === 'current'
        ? () => manager.publishCurrent(item.lease, item.generation)
        : () => manager.publishExport(item.lease, item.generation);
      expect(publish).toThrow(/dangling|pointer|symbolic|direct child|state/i);

      expect(readFileSync(item.lease.ownerPath)).toEqual(leaseBefore);
      expect(readLeaseState(item.lease)).toBe('preconsumer');
      expect(readFileSync(join(item.generation.path, COMPLETE_MARKER))).toEqual(markerBefore);
      expect(readFileSync(join(item.generation.path, 'payload.txt'))).toEqual(payloadBefore);
      expect(existsSync(otherPointerPath)).toBe(false);
      const pointerAfter = lstatSync(pointerPath);
      expect({ dev: pointerAfter.dev, ino: pointerAfter.ino }).toEqual(pointerIdentityBefore);
      expect(pointerAfter.isSymbolicLink() ? readlinkSync(pointerPath) : undefined)
        .toBe(pointerTargetBefore);
      expect(pointerAfter.isFile() ? readFileSync(pointerPath) : undefined)
        .toEqual(pointerFileBefore);
      expect(pointerAfter.isDirectory() ? pathEntryNames(pointerPath) : undefined)
        .toEqual(pointerDirectoryBefore);
      expect({
        leases: pathEntryNames(manager.paths.leasesDir),
        transitions: pathEntryNames(manager.paths.transitionsDir),
        atomic: pathEntryNames(manager.paths.atomicDir),
        staging: pathEntryNames(manager.paths.stagingDir),
        bundleWork: pathEntryNames(manager.paths.bundleWorkDir),
        generations: pathEntryNames(manager.paths.generationsDir),
      }).toEqual(inventoryBefore);

      rmSync(pointerPath, { recursive: true, force: true });
      const consuming = publish();
      expect(consuming.state).toBe('consuming');
      expect(readLeaseState(item.lease)).toBe('consuming');
      expect(realpathSync(pointerPath)).toBe(realpathSync(item.generation.path));
      expect(readFileSync(join(item.generation.path, COMPLETE_MARKER))).toEqual(markerBefore);
      expect(readFileSync(join(item.generation.path, 'payload.txt'))).toEqual(payloadBefore);
      expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
      expect(pathEntryNames(manager.paths.transitionsDir)).toEqual([]);
      if (outsidePath) {
        expect(readFileSync(join(outsidePath, 'payload.txt'), 'utf-8')).toBe('outside\n');
      }
    },
  );

  it.each(['current', 'export'] as const)(
    'performs zero GC deletion after observing a dangling %s pointer',
    (kind) => {
      const events: DockerContextMaintenanceEvent[] = [];
      const manager = createManager(`dangling-gc-${kind}`, {
        maintenanceObserver: (event) => events.push(event),
      });
      const victim = createGeneration(manager, `dangling-gc-${kind}-victim`);
      victim.lease = manager.markReleased(victim.lease);
      const pointerPath = kind === 'current' ? manager.paths.currentPath : manager.paths.exportPath;
      symlinkSync(join(manager.paths.generationsDir, 'missing-generation'), pointerPath, 'dir');
      events.length = 0;

      expect(() => manager.collectGarbage()).toThrow(/dangling|pointer|state/i);
      expect(events.filter((event) => event.phase === 'delete-chunk')).toHaveLength(0);
      expect(lstatSync(pointerPath).isSymbolicLink()).toBe(true);
      expect(existsSync(victim.lease.ownerPath)).toBe(true);
      expect(existsSync(victim.generation.path)).toBe(true);
      expect(existsSync(manager.paths.gcOwnerPath)).toBe(false);
    },
  );

  it('retains a dangling current pointer and complete state during legacy recovery', () => {
    const manager = createManager('dangling-recovery');
    const protectedItem = createGeneration(manager, 'dangling-recovery-protected');
    const missingTarget = join(manager.paths.generationsDir, 'missing-generation');
    symlinkSync(missingTarget, manager.paths.currentPath, 'dir');

    expect(() => manager.recoverLegacyCurrent()).toThrow(/dangling|pointer|state/i);
    expect(lstatSync(manager.paths.currentPath).isSymbolicLink()).toBe(true);
    expect(() => realpathSync(manager.paths.currentPath)).toThrow();
    expect(existsSync(protectedItem.lease.ownerPath)).toBe(true);
    expect(existsSync(protectedItem.generation.path)).toBe(true);
    expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
  });

  it.each([
    'dangling-symlink',
    'file',
    'empty-directory',
    'directory-alias',
  ] as const)('treats a preexisting %s generation pathname as a collision before populate', (kind) => {
    const manager = createManager(`preexisting-${kind}`);
    let lease = manager.createLease();
    const generationId = `preexisting-${kind}-generation`;
    lease = manager.setPlannedGeneration(lease, generationId);
    const generationPath = join(manager.paths.generationsDir, generationId);
    if (kind === 'dangling-symlink') {
      symlinkSync(join(manager.paths.generationsDir, 'missing-target'), generationPath, 'dir');
    } else if (kind === 'file') {
      writeFileSync(generationPath, 'foreign-file\n');
    } else if (kind === 'empty-directory') {
      mkdirSync(generationPath);
    } else {
      const foreignPath = join(projectDir, 'preexisting-foreign-directory');
      mkdirSync(foreignPath);
      writeFileSync(join(foreignPath, 'keep.txt'), 'foreign-alias\n');
      symlinkSync(foreignPath, generationPath, 'dir');
    }
    const before = lstatSync(generationPath);
    let populateCalls = 0;

    expect(() => manager.publishGeneration(lease, () => {
      populateCalls += 1;
    })).toThrow(/already exists|collision|filesystem/i);
    expect(populateCalls).toBe(0);
    const after = lstatSync(generationPath);
    expect({ device: after.dev, inode: after.ino }).toEqual({
      device: before.dev,
      inode: before.ino,
    });
    if (kind === 'file') expect(readFileSync(generationPath, 'utf-8')).toBe('foreign-file\n');
    if (kind === 'directory-alias') {
      expect(readFileSync(join(generationPath, 'keep.txt'), 'utf-8')).toBe('foreign-alias\n');
    }
    expect(readLeaseState(lease)).toBe('preconsumer');
    expect(existsSync(manager.paths.currentPath)).toBe(false);
  });

  it.runIf(process.platform !== 'win32')(
    'treats a preexisting Unix socket generation pathname as a collision before populate',
    async () => {
      const socketRoot = join('/tmp', `e344-${process.pid}-${Date.now().toString(36)}`);
      cleanupPaths.push(socketRoot);
      const manager = createManager('preexisting-socket', {}, socketRoot);
      let lease = manager.createLease();
      lease = manager.setPlannedGeneration(lease, 's');
      const generationPath = join(manager.paths.generationsDir, 's');
      const server = createServer();
      server.listen(generationPath);
      await once(server, 'listening');
      const before = lstatSync(generationPath);
      let populateCalls = 0;
      try {
        expect(() => manager.publishGeneration(lease, () => {
          populateCalls += 1;
        })).toThrow(/already exists|collision|filesystem/i);
        const after = lstatSync(generationPath);
        expect({ device: after.dev, inode: after.ino }).toEqual({
          device: before.dev,
          inode: before.ino,
        });
        expect(populateCalls).toBe(0);
        expect(readLeaseState(lease)).toBe('preconsumer');
      } finally {
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error);
            else resolveClose();
          });
        });
      }
    },
  );

  it.each([
    'dangling-symlink',
    'file',
    'empty-directory',
    'directory-alias',
    'nonempty-directory',
  ] as const)('preserves a post-populate %s generation collision without committing', (kind) => {
    const generationId = `post-populate-${kind}`;
    let collisionPath = '';
    let collisionIdentity: { device: number; inode: number } | undefined;
    const manager = createManager(`post-populate-${kind}`, {
      faultInjector(point) {
        if (point !== 'after-staging-populated' || collisionIdentity) return;
        collisionPath = join(manager.paths.generationsDir, generationId);
        if (kind === 'dangling-symlink') {
          symlinkSync(join(manager.paths.generationsDir, 'missing-target'), collisionPath, 'dir');
        } else if (kind === 'file') {
          writeFileSync(collisionPath, 'foreign-file\n');
        } else if (kind === 'empty-directory') {
          mkdirSync(collisionPath);
        } else if (kind === 'directory-alias') {
          const foreignPath = join(projectDir, 'post-populate-foreign-directory');
          mkdirSync(foreignPath);
          writeFileSync(join(foreignPath, 'keep.txt'), 'foreign-alias\n');
          symlinkSync(foreignPath, collisionPath, 'dir');
        } else {
          mkdirSync(collisionPath);
          writeFileSync(join(collisionPath, 'keep.txt'), 'foreign-directory\n');
        }
        const info = lstatSync(collisionPath);
        collisionIdentity = { device: info.dev, inode: info.ino };
      },
    });
    let lease = manager.createLease();
    lease = manager.setPlannedGeneration(lease, generationId);
    let populateCalls = 0;

    expect(() => manager.publishGeneration(lease, (stagingPath) => {
      populateCalls += 1;
      writeFileSync(join(stagingPath, 'Dockerfile'), 'FROM node:22\n');
    })).toThrow(/already exists|collision|filesystem/i);
    expect(populateCalls).toBe(1);
    expect(collisionIdentity).toBeDefined();
    const after = lstatSync(collisionPath);
    expect({ device: after.dev, inode: after.ino }).toEqual(collisionIdentity);
    if (kind === 'file') expect(readFileSync(collisionPath, 'utf-8')).toBe('foreign-file\n');
    if (kind === 'directory-alias') {
      expect(readFileSync(join(collisionPath, 'keep.txt'), 'utf-8')).toBe('foreign-alias\n');
    }
    if (kind === 'nonempty-directory') {
      expect(readFileSync(join(collisionPath, 'keep.txt'), 'utf-8')).toBe('foreign-directory\n');
    }
    expect(readLeaseState(lease)).toBe('preconsumer');
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(existsSync(join(manager.paths.stagingDir, lease.id))).toBe(true);
  });

  it('keeps the first complete same-id generation when a second publisher resumes', () => {
    const winner = createManager('same-id-winner');
    let winnerLease = winner.createLease();
    winnerLease = winner.setPlannedGeneration(winnerLease, 'same-id-generation');
    let winnerGeneration: DockerContextGeneration | undefined;
    let winnerCalls = 0;
    const contender = createManager('same-id-contender', {
      faultInjector(point) {
        if (point !== 'after-staging-populated' || winnerGeneration) return;
        winnerGeneration = winner.publishGeneration(winnerLease, (stagingPath) => {
          winnerCalls += 1;
          writeFileSync(join(stagingPath, 'payload.txt'), 'winner\n');
        });
      },
    });
    let contenderLease = contender.createLease();
    contenderLease = contender.setPlannedGeneration(contenderLease, 'same-id-generation');
    let contenderCalls = 0;

    expect(() => contender.publishGeneration(contenderLease, (stagingPath) => {
      contenderCalls += 1;
      writeFileSync(join(stagingPath, 'payload.txt'), 'contender\n');
    })).toThrow(/already exists|collision|filesystem/i);
    expect(winnerCalls).toBe(1);
    expect(contenderCalls).toBe(1);
    expect(winnerGeneration).toBeDefined();
    expect(readFileSync(join(winnerGeneration!.path, 'payload.txt'), 'utf-8')).toBe('winner\n');
    expect(readLeaseState(contenderLease)).toBe('preconsumer');
  });

  it('links the complete marker only after the exact final payload is present', () => {
    const generationId = 'marker-last-generation';
    let observedPrecommit = false;
    const manager = createManager('marker-last', {
      faultInjector(point) {
        if (point !== 'before-generation-commit') return;
        observedPrecommit = true;
        const generationPath = join(manager.paths.generationsDir, generationId);
        expect(lstatSync(generationPath).isDirectory()).toBe(true);
        expect(readFileSync(join(generationPath, 'payload', 'value.txt'), 'utf-8'))
          .toBe('complete\n');
        expect(readlinkSync(join(generationPath, 'payload-link'))).toBe('payload/value.txt');
        expect(existsSync(join(generationPath, COMPLETE_MARKER))).toBe(false);
      },
    });
    let lease = manager.createLease();
    lease = manager.setPlannedGeneration(lease, generationId);

    const generation = manager.publishGeneration(lease, (stagingPath) => {
      mkdirSync(join(stagingPath, 'payload'));
      writeFileSync(join(stagingPath, 'payload', 'value.txt'), 'complete\n');
      symlinkSync('payload/value.txt', join(stagingPath, 'payload-link'));
    });

    expect(observedPrecommit).toBe(true);
    expect(existsSync(join(generation.path, COMPLETE_MARKER))).toBe(true);
    expect(existsSync(join(manager.paths.stagingDir, lease.id))).toBe(false);
  });

  it('removes its exact partial final tree when publication fails before the marker commit', () => {
    const generationId = 'precommit-failure-generation';
    const manager = createManager('precommit-failure', {
      faultInjector(point) {
        if (point === 'before-generation-commit') throw new Error('synthetic precommit failure');
      },
    });
    let lease = manager.createLease();
    lease = manager.setPlannedGeneration(lease, generationId);

    expect(() => manager.publishGeneration(lease, (stagingPath) => {
      writeFileSync(join(stagingPath, 'payload.txt'), 'staged\n');
    })).toThrow('synthetic precommit failure');
    expect(existsSync(join(manager.paths.generationsDir, generationId))).toBe(false);
    expect(existsSync(join(manager.paths.stagingDir, lease.id, COMPLETE_MARKER))).toBe(true);
    expect(readLeaseState(lease)).toBe('preconsumer');
  });

  it('preserves a foreign child that appears before partial-publication cleanup', () => {
    const generationId = 'precommit-foreign-generation';
    let foreignPath = '';
    const manager = createManager('precommit-foreign', {
      faultInjector(point) {
        if (point !== 'before-generation-commit' || foreignPath) return;
        foreignPath = join(
          manager.paths.generationsDir,
          generationId,
          'foreign',
          'keep.txt',
        );
        mkdirSync(dirname(foreignPath), { recursive: true });
        writeFileSync(foreignPath, 'preserve\n');
      },
    });
    let lease = manager.createLease();
    lease = manager.setPlannedGeneration(lease, generationId);

    expect(() => manager.publishGeneration(lease, (stagingPath) => {
      writeFileSync(join(stagingPath, 'payload.txt'), 'staged\n');
    })).toThrow(AggregateError);
    expect(readFileSync(foreignPath, 'utf-8')).toBe('preserve\n');
    expect(existsSync(join(manager.paths.generationsDir, generationId, COMPLETE_MARKER)))
      .toBe(false);
    expect(existsSync(join(manager.paths.stagingDir, lease.id, COMPLETE_MARKER))).toBe(true);
    expect(readLeaseState(lease)).toBe('preconsumer');
  });

  it('bounds exact generation publication inventory before final-path admission', () => {
    const generationId = 'bounded-publication-generation';
    const seeding = createManager('bounded-publication-seed');
    let lease = seeding.createLease();
    lease = seeding.setPlannedGeneration(lease, generationId);
    const manager = createManager('bounded-publication', { maxInventoryEntries: 2 });

    expect(() => manager.publishGeneration(lease, (stagingPath) => {
      writeFileSync(join(stagingPath, 'one.txt'), 'one\n');
      writeFileSync(join(stagingPath, 'two.txt'), 'two\n');
    })).toThrow(/inventory.*2|bounded safety limit of 2/i);
    expect(existsSync(join(manager.paths.generationsDir, generationId))).toBe(false);
    expect(existsSync(join(manager.paths.stagingDir, lease.id, COMPLETE_MARKER))).toBe(true);
    expect(readLeaseState(lease)).toBe('preconsumer');
  });

  it('ignores only Windows directory fsync EINVAL and propagates every other sync failure', () => {
    for (const platform of ['linux', 'win32'] as const) {
      for (const directory of [false, true]) {
        for (const stage of ['open', 'fsync'] as const) {
          for (const code of ['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM', 'EACCES', 'EIO']) {
            const label = `${platform} ${directory ? 'directory' : 'file'} ${stage} ${code}`;
            let openCalls = 0;
            let fsyncCalls = 0;
            let closeCalls = 0;
            const action = (): void => syncDockerContextPath('virtual-path', {
              platform,
              isDirectory: () => directory,
              open: () => {
                openCalls += 1;
                if (stage === 'open') throw errno(code);
                return 10;
              },
              fsync: () => {
                fsyncCalls += 1;
                if (stage === 'fsync') throw errno(code);
              },
              close: () => { closeCalls += 1; },
            });
            const ignored = platform === 'win32'
              && directory
              && stage === 'fsync'
              && code === 'EINVAL';

            if (ignored) expect.soft(action, label).not.toThrow();
            else expect.soft(action, label).toThrow(code);
            expect.soft(openCalls, `${label} open count`).toBe(1);
            expect.soft(fsyncCalls, `${label} fsync count`).toBe(stage === 'open' ? 0 : 1);
            expect.soft(closeCalls, `${label} close count`).toBe(stage === 'open' ? 0 : 1);
          }
        }
      }
    }

    for (const platform of ['linux', 'win32'] as const) {
      for (const directory of [false, true]) {
        let closeCalls = 0;
        expect(() => syncDockerContextPath('virtual-path', {
          platform,
          isDirectory: () => directory,
          open: () => 10,
          fsync: () => undefined,
          close: () => {
            closeCalls += 1;
            throw errno('EIO');
          },
        }), `${platform} ${directory ? 'directory' : 'file'} close EIO`).toThrow(/EIO/);
        expect(closeCalls).toBe(1);
      }
    }
  });

  it.each([
    { state: 'preconsumer', firstProbe: false, preserved: false },
    { state: 'preconsumer', firstProbe: true, preserved: true },
    { state: 'consuming', firstProbe: false, preserved: true },
    { state: 'consuming', firstProbe: true, preserved: true },
  ] as const)(
    'uses one liveness result for a $state lease when first probe is $firstProbe',
    ({ state, firstProbe, preserved }) => {
      let probes = 0;
      const manager = createManager(`liveness-${state}-${String(firstProbe)}`, {
        pid: DEAD_PID,
        processIsAlive: () => {
          probes += 1;
          return probes === 1 ? firstProbe : !firstProbe;
        },
      });
      const item = createGeneration(manager, `liveness-${state}-${String(firstProbe)}`);
      if (state === 'consuming') item.lease = manager.markConsuming(item.lease);
      probes = 0;

      manager.collectGarbage();

      expect(probes).toBe(1);
      expect(existsSync(item.lease.ownerPath)).toBe(preserved);
      expect(existsSync(item.generation.path)).toBe(preserved);
    },
  );

  it.each([false, true])(
    'shares the first %s liveness result across mixed-state leases with the same pid',
    (firstProbe) => {
      let probes = 0;
      const manager = createManager(`shared-liveness-${String(firstProbe)}`, {
        processIsAlive: () => {
          probes += 1;
          return probes === 1 ? firstProbe : !firstProbe;
        },
      });
      const first = createGeneration(manager, 'shared-liveness-first');
      const second = createGeneration(manager, 'shared-liveness-second');
      second.lease = manager.markConsuming(second.lease);
      probes = 0;

      manager.collectGarbage();

      expect(probes).toBe(1);
      expect(existsSync(first.lease.ownerPath)).toBe(firstProbe);
      expect(existsSync(first.generation.path)).toBe(firstProbe);
      expect(existsSync(second.lease.ownerPath)).toBe(true);
      expect(existsSync(second.generation.path)).toBe(true);
    },
  );

  it('preserves lease and generation state when the liveness probe is unknown', () => {
    let probes = 0;
    const manager = createManager('unknown-liveness', {
      processIsAlive: () => {
        probes += 1;
        throw new Error('synthetic unknown liveness');
      },
    });
    const item = createGeneration(manager, 'unknown-liveness-generation');
    const workPath = manager.allocateBundleWork(item.lease);
    writeFileSync(join(workPath, 'payload.txt'), 'preserve\n');

    expect(() => manager.collectGarbage()).toThrow('synthetic unknown liveness');
    expect(probes).toBe(1);
    expect(existsSync(item.lease.ownerPath)).toBe(true);
    expect(existsSync(item.generation.path)).toBe(true);
    expect(readFileSync(join(workPath, 'payload.txt'), 'utf-8')).toBe('preserve\n');
    expect(existsSync(manager.paths.gcOwnerPath)).toBe(false);
  });

  it('allows only one GC owner and has no delayed pass after same-id recreation', () => {
    const writer = createManager('aba-writer');
    const original = createGeneration(writer, 'aba-generation', 'old');
    original.lease = writer.markReleased(original.lease);
    const contender = createManager('aba-contender');
    let contenderBlocked = false;
    const collector = createManager('aba-collector', {
      faultInjector(point) {
        if (point !== 'after-gc-owner' || contenderBlocked) return;
        contenderBlocked = true;
        expect(() => contender.collectGarbage()).toThrow(/already has an owner/i);
      },
    });

    collector.collectGarbage();
    expect(contenderBlocked).toBe(true);
    expect(existsSync(original.generation.path)).toBe(false);

    const replacement = createGeneration(writer, 'aba-generation', 'new');
    replacement.lease = writer.publishCurrent(replacement.lease, replacement.generation);
    expect(readFileSync(join(replacement.generation.path, 'payload.txt'), 'utf-8')).toBe('new\n');
    expect(realpathSync(writer.paths.currentPath)).toBe(realpathSync(replacement.generation.path));
  });

  it.each([
    { count: 1, rejects: false },
    { count: 2, rejects: true },
    { count: 3, rejects: true },
  ])('uses the same orphan-cap outcome for $count orphan(s)', ({ count, rejects }) => {
    const createRoot = join(projectDir, `cap-create-${count}`);
    seedDeadConsumers(createRoot, count);
    const creator = createManager(`cap-creator-${count}`, {
      orphanCap: 2,
      processIsAlive: () => false,
    }, createRoot);

    if (rejects) expect(() => creator.createLease()).toThrow(/safety cap is 2/i);
    else expect(() => creator.createLease()).not.toThrow();

    const gcRoot = join(projectDir, `cap-gc-${count}`);
    seedDeadConsumers(gcRoot, count);
    const collector = createManager(`cap-collector-${count}`, {
      orphanCap: 2,
      processIsAlive: () => false,
    }, gcRoot);
    if (rejects) expect(() => collector.collectGarbage()).toThrow(/safety cap is 2/i);
    else expect(() => collector.collectGarbage()).not.toThrow();
  });

  it.each([
    'staging-file',
    'generation-file',
    'generation-symlink',
  ] as const)('counts a malformed $s entry toward the lease-admission orphan cap', (kind) => {
    const manager = createManager(`malformed-${kind}`, { orphanCap: 1 });
    let malformedPath: string;
    if (kind === 'staging-file') {
      malformedPath = join(manager.paths.stagingDir, 'unexpected');
      writeFileSync(malformedPath, 'unexpected\n');
    } else if (kind === 'generation-file') {
      malformedPath = join(manager.paths.generationsDir, 'unexpected');
      writeFileSync(malformedPath, 'unexpected\n');
    } else {
      const externalPath = join(projectDir, 'external-generation');
      mkdirSync(externalPath);
      malformedPath = join(manager.paths.generationsDir, 'unexpected');
      symlinkSync(externalPath, malformedPath, 'dir');
    }

    expect(() => manager.createLease()).toThrow(/safety cap is 1/i);
    expect(existsSync(malformedPath)).toBe(true);
    expect(readdirSync(manager.paths.leasesDir)).toEqual([]);
  });

  it('does not charge a live lease JSON temp to the orphan budget', () => {
    const owner = createManager('live-json-temp', { orphanCap: 1 });
    const lease = owner.createLease();
    const temporaryPath = `${lease.ownerPath}.sync-${process.pid}-0000000000000000`;
    writeFileSync(temporaryPath, readFileSync(lease.ownerPath));
    const second = createManager('live-json-second', { orphanCap: 1 });

    expect(() => second.createLease()).not.toThrow();
    expect(existsSync(temporaryPath)).toBe(true);
  });

  it('counts an abandoned state-root JSON temp toward the orphan cap', () => {
    const manager = createManager('abandoned-state-temp', {
      orphanCap: 1,
      processIsAlive: () => false,
    });
    const temporaryPath = `${manager.paths.legacyMigrationPath}.sync-${DEAD_PID}-0000000000000000`;
    writeFileSync(temporaryPath, '{}\n');

    expect(() => manager.createLease()).toThrow(/safety cap is 1|temporary/i);
    expect(existsSync(temporaryPath)).toBe(true);
  });

  it('blocks lease admission immediately when an abandoned GC owner exists', () => {
    const manager = createManager('abandoned-gc', {
      processIsAlive: () => false,
    });
    mkdirSync(manager.paths.gcOwnerPath);
    writeFileSync(join(manager.paths.gcOwnerPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'abandoned-gc-owner',
      pid: DEAD_PID,
    })}\n`);

    expect(() => manager.createLease()).toThrow(/garbage collector|gc owner|orphan/i);
    expect(existsSync(manager.paths.gcOwnerPath)).toBe(true);
  });

  it('attributes a live atomic temp to its lease and reclaims it after release', () => {
    const manager = createManager('atomic-temp', { orphanCap: 1 });
    const lease = manager.createLease();
    const operationPath = join(manager.paths.atomicDir, lease.id, 'operation');
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: lease.id,
      pid: process.pid,
      kind: 'current',
    })}\n`);

    const second = createManager('atomic-second', { orphanCap: 1 });
    expect(() => second.createLease()).not.toThrow();
    manager.markReleased(lease);
    manager.collectGarbage();
    expect(existsSync(join(manager.paths.atomicDir, lease.id))).toBe(false);
  });

  it('preserves and reclaims bundle work according to the exact lease lifecycle', () => {
    const liveRoot = join(projectDir, 'bundle-live');
    const live = createManager('bundle-live', {}, liveRoot);
    const liveLease = live.createLease();
    const liveWork = live.allocateBundleWork(liveLease);
    writeFileSync(join(liveWork, 'payload.txt'), 'live\n');
    live.collectGarbage();
    expect(existsSync(liveWork)).toBe(true);

    const releasedRoot = join(projectDir, 'bundle-released');
    const released = createManager('bundle-released', {}, releasedRoot);
    const releasedLease = released.createLease();
    const releasedWork = released.allocateBundleWork(releasedLease);
    released.markReleased(releasedLease);
    released.collectGarbage();
    expect(existsSync(releasedWork)).toBe(false);
    expect(existsSync(releasedLease.ownerPath)).toBe(false);

    const deadRoot = join(projectDir, 'bundle-dead');
    const dead = createManager('bundle-dead', {
      pid: DEAD_PID,
      processIsAlive: () => false,
    }, deadRoot);
    const deadLease = dead.createLease();
    const deadWork = dead.allocateBundleWork(deadLease);
    dead.collectGarbage();
    expect(existsSync(deadWork)).toBe(false);
    expect(existsSync(deadLease.ownerPath)).toBe(false);

    const consumingRoot = join(projectDir, 'bundle-consuming');
    const consuming = createManager('bundle-consuming', {
      pid: DEAD_PID,
      processIsAlive: () => false,
    }, consumingRoot);
    const consumingItem = createGeneration(consuming, 'bundle-consuming-generation');
    const consumingWork = consuming.allocateBundleWork(consumingItem.lease);
    consumingItem.lease = consuming.markConsuming(consumingItem.lease);
    consuming.collectGarbage();
    expect(existsSync(consumingWork)).toBe(true);
    expect(existsSync(consumingItem.lease.ownerPath)).toBe(true);
    expect(existsSync(consumingItem.generation.path)).toBe(true);
  });

  it('drains repeated crashed preconsumer bundle work in bounded direct-child chunks', () => {
    const root = join(projectDir, 'bundle-crash-drain');
    const seed = createManager('bundle-crash-seed', {
      pid: DEAD_PID,
      processIsAlive: () => false,
    }, root);
    const items = Array.from({ length: 5 }, (_, index) => {
      const lease = seed.createLease();
      const workPath = seed.allocateBundleWork(lease);
      const nestedPath = join(workPath, 'nested', 'payload.txt');
      mkdirSync(dirname(nestedPath), { recursive: true });
      writeFileSync(nestedPath, `${index}\n`);
      return { lease, workPath };
    });
    const events: DockerContextMaintenanceEvent[] = [];
    const collector = createManager('bundle-crash-collector', {
      processIsAlive: () => false,
      deletionChunkSize: 2,
      maintenanceObserver: (event) => events.push(event),
    }, root);

    collector.collectGarbage();

    expect(items.every((item) => !existsSync(item.workPath))).toBe(true);
    expect(items.every((item) => !existsSync(item.lease.ownerPath))).toBe(true);
    expect(pathEntryNames(collector.paths.bundleWorkDir)).toEqual([]);
    expect(pathEntryNames(collector.paths.leasesDir)).toEqual([]);
    const chunks = events.filter((event): event is Extract<
      DockerContextMaintenanceEvent,
      { phase: 'delete-chunk' }
    > => event.phase === 'delete-chunk');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((event) => event.chunkSize > 0 && event.chunkSize <= 2)).toBe(true);
    expect(chunks.at(-1)?.remaining).toBe(0);
  });

  it('does not mutate valid bundle work when an unknown bundle entry is present', () => {
    const manager = createManager('bundle-malformed');
    const lease = manager.createLease();
    const work = manager.allocateBundleWork(lease);
    const unknown = join(manager.paths.bundleWorkDir, 'unknown-entry');
    writeFileSync(unknown, 'unexpected\n');

    expect(() => manager.collectGarbage()).toThrow(/lease-owned artifact/i);
    expect(existsSync(work)).toBe(true);
    expect(existsSync(lease.ownerPath)).toBe(true);
    expect(existsSync(unknown)).toBe(true);
  });

  it('fails before mutation when the total state inventory exceeds its declared bound', () => {
    const seed = createManager('inventory-seed');
    const leases = Array.from({ length: 3 }, () => seed.createLease());
    const events: DockerContextMaintenanceEvent[] = [];
    const bounded = createManager('inventory-bounded', {
      maxInventoryEntries: 2,
      maintenanceObserver: (event) => events.push(event),
    });

    expect(() => bounded.createLease()).toThrow(/inventory.*limit.*2|exceeds.*2/i);
    expect(() => bounded.collectGarbage()).toThrow(/inventory.*limit.*2|exceeds.*2/i);
    expect(leases.every((lease) => existsSync(lease.ownerPath))).toBe(true);
    expect(existsSync(bounded.paths.gcOwnerPath)).toBe(false);
    expect(events.some((event) => event.phase === 'inventory')).toBe(true);
  });

  it('drains all eligible mutations in declared bounded deletion chunks', () => {
    const seed = createManager('chunk-seed');
    const items = Array.from({ length: 5 }, () => {
      const lease = seed.createLease();
      const workPath = seed.allocateBundleWork(lease);
      seed.markReleased(lease);
      return { lease, workPath };
    });
    const events: DockerContextMaintenanceEvent[] = [];
    const collector = createManager('chunk-collector', {
      maxInventoryEntries: 64,
      deletionChunkSize: 2,
      maintenanceObserver: (event) => events.push(event),
    });

    collector.collectGarbage();

    const chunks = events.filter((event): event is Extract<
      DockerContextMaintenanceEvent,
      { phase: 'delete-chunk' }
    > => event.phase === 'delete-chunk');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((event) => event.chunkSize > 0 && event.chunkSize <= 2)).toBe(true);
    expect(chunks.map((event) => event.chunkIndex))
      .toEqual(chunks.map((_, index) => index));
    expect(chunks.at(-1)?.remaining).toBe(0);
    expect(items.every((item) => !existsSync(item.workPath))).toBe(true);
    expect(items.every((item) => !existsSync(item.lease.ownerPath))).toBe(true);
  });

  it.each([
    'leases',
    'transitions',
    'atomic',
    'staging',
    'bundle-work',
    'generations',
  ])('rejects a symlinked managed %s root without touching its external target', (rootName) => {
    const stateDir = join(projectDir, '.edgebase', 'targets', '.docker-context-state');
    mkdirSync(stateDir, { recursive: true });
    const externalPath = `${projectDir}-external-${rootName}`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    const markerPath = join(externalPath, 'external-marker.txt');
    writeFileSync(markerPath, 'external-before\n');
    symlinkSync(externalPath, join(stateDir, rootName), 'dir');

    expect(() => createManager(`root-${rootName}`)).toThrow(/state root|symbolic|symlink|directory/i);
    expect(readFileSync(markerPath, 'utf-8')).toBe('external-before\n');
    expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
  });

  it('rejects a symlinked targets ancestor before creating state outside the project', () => {
    const edgebaseDir = join(projectDir, '.edgebase');
    mkdirSync(edgebaseDir);
    const externalPath = `${projectDir}-external-targets`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    const markerPath = join(externalPath, 'external-marker.txt');
    writeFileSync(markerPath, 'external-before\n');
    symlinkSync(externalPath, join(edgebaseDir, 'targets'), 'dir');

    expect(() => createManager('ancestor-root'))
      .toThrow(/state root|symbolic|symlink|escape|real directory/i);
    expect(readFileSync(markerPath, 'utf-8')).toBe('external-before\n');
    expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
  });

  it('rejects a live lease that aliases another lease owner\'s generation', () => {
    const manager = createManager('reverse-owner');
    const owner = createGeneration(manager, 'reverse-owner-generation');
    owner.lease = manager.markReleased(owner.lease);
    const alias = manager.createLease();
    const aliasRecord = JSON.parse(readFileSync(alias.ownerPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(alias.ownerPath, `${JSON.stringify({
      ...aliasRecord,
      generationId: owner.generation.id,
    })}\n`);

    expect(() => manager.collectGarbage()).toThrow(/owner|lease|generation/i);
    expect(existsSync(owner.generation.path)).toBe(true);
    expect(existsSync(owner.lease.ownerPath)).toBe(true);
    expect(existsSync(alias.ownerPath)).toBe(true);
  });

  it('rejects a consuming lease whose exact generation is missing', () => {
    const manager = createManager('missing-generation');
    const lease = manager.createLease();
    const record = JSON.parse(readFileSync(lease.ownerPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(lease.ownerPath, `${JSON.stringify({
      ...record,
      state: 'consuming',
      generationId: 'missing-owned-generation',
    })}\n`);

    expect(() => manager.collectGarbage()).toThrow(/missing|owner|generation/i);
    expect(existsSync(lease.ownerPath)).toBe(true);
  });

  it('fails GC closed before deletion for a consuming lease with no generation assignment', () => {
    const events: DockerContextMaintenanceEvent[] = [];
    const manager = createManager('consuming-without-generation', {
      maintenanceObserver: (event) => events.push(event),
    });
    const reclaimable = createGeneration(manager, 'consuming-without-generation-reclaimable');
    reclaimable.lease = manager.markReleased(reclaimable.lease);
    const malformed = manager.createLease();
    const record = JSON.parse(readFileSync(malformed.ownerPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(malformed.ownerPath, `${JSON.stringify({
      ...record,
      state: 'consuming',
    })}\n`);
    events.length = 0;

    expect(() => manager.collectGarbage()).toThrow(/malformed Docker context lease record/i);
    expect(events.filter((event) => event.phase === 'delete-chunk')).toHaveLength(0);
    expect(existsSync(malformed.ownerPath)).toBe(true);
    expect(existsSync(reclaimable.lease.ownerPath)).toBe(true);
    expect(existsSync(reclaimable.generation.path)).toBe(true);
    expect(existsSync(manager.paths.gcOwnerPath)).toBe(false);
  });

  it.each([
    { name: 'missing-journal', journalMigrationId: undefined, operationMigrationId: LEGACY_MIGRATION_ID },
    {
      name: 'wrong-migration-id',
      journalMigrationId: LEGACY_MIGRATION_ID,
      operationMigrationId: OTHER_LEGACY_MIGRATION_ID,
    },
  ])('rejects legacy atomic work with $name authority', ({ journalMigrationId, operationMigrationId }) => {
    const probes: number[] = [];
    const manager = createManager(`legacy-atomic-${String(journalMigrationId)}`, {
      processIsAlive(pid) {
        probes.push(pid);
        return pid === process.pid;
      },
    });
    mkdirSync(manager.paths.legacyRecoveryPath);
    writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'legacy-migration');
    if (journalMigrationId !== undefined) {
      writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
        schemaVersion: 1,
        generationId: 'legacy-v0',
        source: manager.paths.currentPath,
        destination: manager.paths.legacyRecoveryPath,
        pid: DEAD_PID,
        migrationId: journalMigrationId,
      })}\n`);
    }
    const operationPath = join(manager.paths.atomicDir, 'legacy-migration', 'operation');
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: 'legacy-migration',
      pid: process.pid,
      kind: 'legacy',
      migrationId: operationMigrationId,
    })}\n`);

    expect(() => manager.collectGarbage()).toThrow(/legacy|journal|owner/i);
    expect(probes).toEqual([]);
    expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(true);
    expect(existsSync(operationPath)).toBe(true);
  });

  it('accepts cross-process legacy atomic work with the exact stable migration identity', () => {
    const manager = createManager('legacy-atomic-exact');
    mkdirSync(manager.paths.legacyRecoveryPath);
    writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'legacy-migration');
    writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: DEAD_PID,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);
    const operationPath = join(manager.paths.atomicDir, 'legacy-migration', 'operation');
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: 'legacy-migration',
      pid: process.pid,
      kind: 'legacy',
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);

    expect(() => manager.collectGarbage()).not.toThrow();
    expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(true);
    expect(existsSync(operationPath)).toBe(true);
  });

  it('uses only the bound atomic operation pid for legacy liveness and orphan accounting', () => {
    const probes: number[] = [];
    const manager = createManager('legacy-atomic-liveness', {
      orphanCap: 1,
      processIsAlive(pid) {
        probes.push(pid);
        return false;
      },
    });
    mkdirSync(manager.paths.legacyRecoveryPath);
    writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'legacy-migration');
    writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: 101,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);
    const operationPath = join(manager.paths.atomicDir, 'legacy-migration', 'operation');
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: 'legacy-migration',
      pid: 202,
      kind: 'legacy',
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(() => manager.createLease(), `attempt ${attempt + 1}`)
        .toThrow(/safety cap is 1|orphan/i);
      expect(existsSync(operationPath), `attempt ${attempt + 1}`).toBe(true);
      expect(pathEntryNames(manager.paths.leasesDir), `attempt ${attempt + 1}`).toEqual([]);
    }
    expect(probes).toEqual([202, 202]);
    expect(existsSync(operationPath)).toBe(true);
  });

  it.each([
    ['targets', (manager: DockerContextGenerationManager) => manager.paths.targetsDir],
    ['state', (manager: DockerContextGenerationManager) => manager.paths.stateDir],
    ['leases', (manager: DockerContextGenerationManager) => manager.paths.leasesDir],
    ['transitions', (manager: DockerContextGenerationManager) => manager.paths.transitionsDir],
    ['atomic', (manager: DockerContextGenerationManager) => manager.paths.atomicDir],
    ['staging', (manager: DockerContextGenerationManager) => manager.paths.stagingDir],
    ['bundle-work', (manager: DockerContextGenerationManager) => manager.paths.bundleWorkDir],
    ['generations', (manager: DockerContextGenerationManager) => manager.paths.generationsDir],
  ] as const)('freshly rejects a post-init replaced %s root before admission', (_, selectRoot) => {
    const manager = createManager('fresh-root');
    const rootPath = selectRoot(manager);
    const backupPath = `${rootPath}.issue181-backup`;
    const externalPath = `${projectDir}-issue181-external`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    writeFileSync(join(externalPath, 'external-marker.txt'), 'external-before\n');
    renameSync(rootPath, backupPath);
    symlinkSync(externalPath, rootPath, 'dir');

    expect(() => manager.createLease()).toThrow(/managed root|escape|real directory|state/i);
    expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
  });

  it('freshly validates managed roots before every public writer and destructor', () => {
    const manager = createManager('fresh-api');
    const item = createGeneration(manager, 'fresh-api-generation');
    let planned = manager.createLease();
    planned = manager.setPlannedGeneration(planned, 'fresh-api-planned');
    const mutable = manager.createLease();
    const leaseBytes = new Map([
      [item.lease.ownerPath, readFileSync(item.lease.ownerPath)],
      [planned.ownerPath, readFileSync(planned.ownerPath)],
      [mutable.ownerPath, readFileSync(mutable.ownerPath)],
    ]);
    const externalPath = `${projectDir}-fresh-api-external`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    writeFileSync(join(externalPath, 'external-marker.txt'), 'external-before\n');
    renameSync(manager.paths.bundleWorkDir, `${manager.paths.bundleWorkDir}.issue181-backup`);
    symlinkSync(externalPath, manager.paths.bundleWorkDir, 'dir');
    let populateCalls = 0;
    const actions: Array<() => unknown> = [
      () => manager.createLease(),
      () => manager.setPlannedGeneration(mutable, 'fresh-api-mutable'),
      () => manager.markConsuming(planned),
      () => manager.markReleased(mutable),
      () => manager.publishGeneration(planned, () => { populateCalls += 1; }),
      () => manager.allocateBundleWork(mutable),
      () => manager.publishCurrent(item.lease, item.generation),
      () => manager.publishExport(item.lease, item.generation),
      () => manager.recoverLegacyCurrent(),
      () => manager.collectGarbage(),
    ];

    for (const action of actions) expect(action).toThrow(/managed root|escape|real directory|state/i);
    expect(populateCalls).toBe(0);
    for (const [path, bytes] of leaseBytes) expect(readFileSync(path)).toEqual(bytes);
    expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
  });

  it('revalidates roots after acquiring a lease transition and before cleanup', () => {
    const externalPath = `${projectDir}-transition-swap-external`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    writeFileSync(join(externalPath, 'external-marker.txt'), 'external-before\n');
    let swapped = false;
    const manager = createManager('transition-swap', {
      faultInjector(point) {
        if (point !== 'after-lease-transition-lock' || swapped) return;
        swapped = true;
        renameSync(manager.paths.bundleWorkDir, `${manager.paths.bundleWorkDir}.issue181-backup`);
        symlinkSync(externalPath, manager.paths.bundleWorkDir, 'dir');
      },
    });
    const lease = manager.createLease();
    const leaseBefore = readFileSync(lease.ownerPath);

    expect(() => manager.markReleased(lease)).toThrow(/managed root|identity|directory/i);
    expect(readFileSync(lease.ownerPath)).toEqual(leaseBefore);
    expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
  });

  it('revalidates roots after generation population before marker or rename mutation', () => {
    const manager = createManager('populate-swap');
    let lease = manager.createLease();
    lease = manager.setPlannedGeneration(lease, 'populate-swap-generation');
    const leaseBefore = readFileSync(lease.ownerPath);
    const externalPath = `${projectDir}-populate-swap-external`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    writeFileSync(join(externalPath, 'external-marker.txt'), 'external-before\n');

    expect(() => manager.publishGeneration(lease, () => {
      renameSync(manager.paths.generationsDir, `${manager.paths.generationsDir}.issue181-backup`);
      symlinkSync(externalPath, manager.paths.generationsDir, 'dir');
    })).toThrow(/managed root|identity|directory/i);
    expect(readFileSync(lease.ownerPath)).toEqual(leaseBefore);
    expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
  });

  it('revalidates roots after the final GC snapshot before deleting or releasing its owner', () => {
    const seed = createManager('gc-swap-seed');
    const lease = seed.createLease();
    const workPath = seed.allocateBundleWork(lease);
    seed.markReleased(lease);
    const bundleBackup = `${seed.paths.bundleWorkDir}.issue181-backup`;
    const externalPath = `${projectDir}-gc-swap-external`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    writeFileSync(join(externalPath, 'external-marker.txt'), 'external-before\n');
    let swapped = false;
    const collector = createManager('gc-swap-collector', {
      faultInjector(point) {
        if (point !== 'after-gc-pointer-snapshot' || swapped) return;
        swapped = true;
        renameSync(collector.paths.bundleWorkDir, bundleBackup);
        symlinkSync(externalPath, collector.paths.bundleWorkDir, 'dir');
      },
    });

    expect(() => collector.collectGarbage()).toThrow(/managed root|identity|directory/i);
    expect(existsSync(join(bundleBackup, lease.id))).toBe(true);
    expect(existsSync(lease.ownerPath)).toBe(true);
    expect(existsSync(workPath)).toBe(false);
    expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
  });

  it.each([
    { pointerKind: 'current', ownerKind: 'symlink' },
    { pointerKind: 'current', ownerKind: 'file' },
    { pointerKind: 'current', ownerKind: 'directory' },
    { pointerKind: 'export', ownerKind: 'symlink' },
    { pointerKind: 'export', ownerKind: 'file' },
    { pointerKind: 'export', ownerKind: 'directory' },
  ] as const)(
    'rejects a preseeded $ownerKind atomic owner before retryable $pointerKind publication',
    ({ pointerKind, ownerKind }) => {
      const manager = createManager(`atomic-collision-${pointerKind}-${ownerKind}`);
      const item = createGeneration(
        manager,
        `atomic-collision-${pointerKind}-${ownerKind}-generation`,
      );
      const ownerPath = join(manager.paths.atomicDir, item.lease.id);
      const externalPath = `${projectDir}-atomic-collision-${pointerKind}-${ownerKind}`;
      cleanupPaths.push(externalPath);
      mkdirSync(externalPath);
      writeFileSync(join(externalPath, 'external-marker.txt'), 'external-before\n');
      if (ownerKind === 'symlink') symlinkSync(externalPath, ownerPath, 'dir');
      else if (ownerKind === 'file') writeFileSync(ownerPath, 'preseeded\n');
      else mkdirSync(ownerPath);
      const leaseBefore = readFileSync(item.lease.ownerPath);
      const publish = pointerKind === 'current'
        ? () => manager.publishCurrent(item.lease, item.generation)
        : () => manager.publishExport(item.lease, item.generation);

      expect(publish)
        .toThrow(/atomic|owner|collision|exists|state/i);
      expect(readFileSync(item.lease.ownerPath)).toEqual(leaseBefore);
      expect(existsSync(manager.paths.currentPath)).toBe(false);
      expect(existsSync(manager.paths.exportPath)).toBe(false);
      expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
      expect(pathEntryNames(manager.paths.atomicDir)).toEqual([item.lease.id]);

      rmSync(ownerPath, { recursive: true, force: true });
      const consuming = publish();
      const pointerPath = pointerKind === 'current'
        ? manager.paths.currentPath
        : manager.paths.exportPath;
      expect(consuming.state).toBe('consuming');
      expect(readLeaseState(item.lease)).toBe('consuming');
      expect(realpathSync(pointerPath)).toBe(realpathSync(item.generation.path));
      expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
      expect(readdirSync(externalPath)).toEqual(['external-marker.txt']);
    },
  );

  it.each([
    `${DEAD_PID}-0000000000000000`,
    '0-0000000000000000',
    '9007199254740992-0000000000000000',
    `${process.pid}-short`,
  ])('rejects a lease JSON temp with malformed or mismatched suffix %s', (suffix) => {
    const manager = createManager('lease-temp-binding', { orphanCap: 1 });
    const lease = manager.createLease();
    const temporaryPath = `${lease.ownerPath}.sync-${suffix}`;
    writeFileSync(temporaryPath, readFileSync(lease.ownerPath));

    expect(() => manager.createLease()).toThrow(/safety cap is 1|temporary|orphan/i);
    expect(existsSync(temporaryPath)).toBe(true);
  });

  it('rejects a legacy JSON temp whose filename pid disagrees with its record', () => {
    const manager = createManager('legacy-temp-binding', { orphanCap: 1 });
    const temporaryPath = `${manager.paths.legacyMigrationPath}.sync-${DEAD_PID}-0000000000000000`;
    writeFileSync(temporaryPath, `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: process.pid,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);

    expect(() => manager.createLease()).toThrow(/safety cap is 1|temporary|orphan/i);
    expect(existsSync(temporaryPath)).toBe(true);
  });

  it.each([
    'malformed',
    'conflicting',
    'missing-marker',
    'missing-identity',
    'invalid-identity',
    'forged-source',
    'forged-destination',
    'forged-generation',
    'invalid-pid',
    'extra-field',
  ] as const)(
    'does not mutate a real legacy current when its preexisting journal is %s',
    (journalKind) => {
      const manager = createManager(`legacy-journal-${journalKind}`);
      mkdirSync(manager.paths.currentPath);
      writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM node:22\n');
      const record: Record<string, unknown> = {
        schemaVersion: 1,
        generationId: 'legacy-v0',
        source: manager.paths.currentPath,
        destination: manager.paths.legacyRecoveryPath,
        pid: DEAD_PID,
        migrationId: LEGACY_MIGRATION_ID,
      };
      if (journalKind !== 'malformed' && journalKind !== 'missing-marker') {
        writeCompleteMarker(
          manager.paths.currentPath,
          'legacy-v0',
          'legacy-migration',
        );
      }
      if (journalKind === 'conflicting') record.migrationId = OTHER_LEGACY_MIGRATION_ID;
      if (journalKind === 'missing-identity') delete record.migrationId;
      if (journalKind === 'invalid-identity') record.migrationId = 'A'.repeat(32);
      if (journalKind === 'forged-source') record.source = join(projectDir, 'forged-source');
      if (journalKind === 'forged-destination') {
        record.destination = join(projectDir, 'forged-destination');
      }
      if (journalKind === 'forged-generation') record.generationId = 'legacy-v1';
      if (journalKind === 'invalid-pid') record.pid = 0;
      if (journalKind === 'extra-field') record.forged = true;
      const journal = journalKind === 'malformed'
        ? '{\n'
        : `${JSON.stringify(record)}\n`;
      writeFileSync(manager.paths.legacyMigrationPath, journal);
      const currentEntriesBefore = pathEntryNames(manager.paths.currentPath);
      const markerBefore = existsSync(join(manager.paths.currentPath, COMPLETE_MARKER))
        ? readFileSync(join(manager.paths.currentPath, COMPLETE_MARKER), 'utf-8')
        : null;

      expect(() => manager.recoverLegacyCurrent()).toThrow(/legacy|journal|migration|owner/i);
      expect(readFileSync(manager.paths.legacyMigrationPath, 'utf-8')).toBe(journal);
      expect(pathEntryNames(manager.paths.currentPath)).toEqual(currentEntriesBefore);
      if (markerBefore === null) {
        expect(existsSync(join(manager.paths.currentPath, COMPLETE_MARKER))).toBe(false);
      } else {
        expect(readFileSync(join(manager.paths.currentPath, COMPLETE_MARKER), 'utf-8'))
          .toBe(markerBefore);
      }
      expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(false);
    },
  );

  it.each(['symlink', 'directory'] as const)(
    'does not mutate a real legacy current when its journal path is a %s',
    (journalKind) => {
      const manager = createManager(`legacy-journal-${journalKind}`);
      mkdirSync(manager.paths.currentPath);
      writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM node:22\n');
      const externalJournalPath = `${projectDir}-${journalKind}-external-journal`;
      if (journalKind === 'symlink') {
        cleanupPaths.push(externalJournalPath);
        writeFileSync(externalJournalPath, 'external-before\n');
        symlinkSync(externalJournalPath, manager.paths.legacyMigrationPath);
      } else {
        mkdirSync(manager.paths.legacyMigrationPath);
      }
      const currentEntriesBefore = pathEntryNames(manager.paths.currentPath);

      expect(() => manager.recoverLegacyCurrent()).toThrow(/journal|regular file|migration/i);
      expect(pathEntryNames(manager.paths.currentPath)).toEqual(currentEntriesBefore);
      expect(lstatSync(manager.paths.legacyMigrationPath).isSymbolicLink())
        .toBe(journalKind === 'symlink');
      if (journalKind === 'symlink') {
        expect(readFileSync(externalJournalPath, 'utf-8')).toBe('external-before\n');
      }
      expect(existsSync(join(manager.paths.currentPath, COMPLETE_MARKER))).toBe(false);
      expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(false);
    },
  );

  it('does not mutate a real legacy current with unresolved journal temporary evidence', () => {
    const manager = createManager('legacy-journal-temporary');
    mkdirSync(manager.paths.currentPath);
    writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM node:22\n');
    const temporaryPath = `${manager.paths.legacyMigrationPath}.sync-${DEAD_PID}-0000000000000000`;
    const temporary = `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: DEAD_PID,
      migrationId: OTHER_LEGACY_MIGRATION_ID,
    })}\n`;
    writeFileSync(temporaryPath, temporary);

    expect(() => manager.recoverLegacyCurrent()).toThrow(/temporary|migration|journal/i);
    expect(readFileSync(temporaryPath, 'utf-8')).toBe(temporary);
    expect(pathEntryNames(manager.paths.currentPath)).toEqual(['Dockerfile']);
    expect(existsSync(join(manager.paths.currentPath, COMPLETE_MARKER))).toBe(false);
    expect(existsSync(manager.paths.legacyMigrationPath)).toBe(false);
    expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(false);
  });

  it('rejects a symlinked legacy recovery destination before pointer or atomic mutation', () => {
    const manager = createManager('legacy-recovery-symlink');
    const externalPath = `${projectDir}-legacy-recovery-external`;
    cleanupPaths.push(externalPath);
    mkdirSync(externalPath);
    writeFileSync(join(externalPath, 'Dockerfile'), 'FROM external\n');
    writeCompleteMarker(externalPath, 'legacy-v0', 'legacy-migration');
    symlinkSync(externalPath, manager.paths.legacyRecoveryPath, 'dir');
    const journal = `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: DEAD_PID,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`;
    writeFileSync(manager.paths.legacyMigrationPath, journal);
    const externalBefore = pathEntryNames(externalPath);
    const markerBefore = readFileSync(join(externalPath, COMPLETE_MARKER), 'utf-8');

    expect(() => manager.recoverLegacyCurrent()).toThrow(/generation|recovery|direct child|identity/i);
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(lstatSync(manager.paths.legacyRecoveryPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(manager.paths.legacyMigrationPath, 'utf-8')).toBe(journal);
    expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
    expect(pathEntryNames(externalPath)).toEqual(externalBefore);
    expect(readFileSync(join(externalPath, COMPLETE_MARKER), 'utf-8')).toBe(markerBefore);
  });

  it('rejects source, marker, and journal replacement after the legacy record hook', () => {
    const originalSourcePath = join(projectDir, 'original-after-record');
    const manager = createManager('legacy-after-record-swap', {
      faultInjector(point) {
        if (point !== 'after-legacy-record') return;
        renameSync(manager.paths.currentPath, originalSourcePath);
        mkdirSync(manager.paths.currentPath);
        writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM replacement\n');
        writeCompleteMarker(
          manager.paths.currentPath,
          'legacy-v0',
          'legacy-migration',
          OTHER_LEGACY_MIGRATION_ID,
        );
        writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
          schemaVersion: 1,
          generationId: 'legacy-v0',
          source: manager.paths.currentPath,
          destination: manager.paths.legacyRecoveryPath,
          pid: DEAD_PID,
          migrationId: OTHER_LEGACY_MIGRATION_ID,
        })}\n`);
      },
    });
    mkdirSync(manager.paths.currentPath);
    writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM original\n');

    expect(() => manager.recoverLegacyCurrent()).toThrow(/identity|changed|migration|evidence/i);
    expect(lstatSync(manager.paths.currentPath).isDirectory()).toBe(true);
    expect(lstatSync(manager.paths.currentPath).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'utf-8'))
      .toBe('FROM replacement\n');
    expect(readFileSync(join(originalSourcePath, 'Dockerfile'), 'utf-8')).toBe('FROM original\n');
    expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(false);
    expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
  });

  it('rejects destination, marker, and journal replacement after the legacy rename hook', () => {
    const originalRecoveryPath = join(projectDir, 'original-after-rename');
    const manager = createManager('legacy-after-rename-swap', {
      faultInjector(point) {
        if (point !== 'after-legacy-rename') return;
        renameSync(manager.paths.legacyRecoveryPath, originalRecoveryPath);
        mkdirSync(manager.paths.legacyRecoveryPath);
        writeFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'FROM replacement\n');
        writeCompleteMarker(
          manager.paths.legacyRecoveryPath,
          'legacy-v0',
          'legacy-migration',
          OTHER_LEGACY_MIGRATION_ID,
        );
        writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
          schemaVersion: 1,
          generationId: 'legacy-v0',
          source: manager.paths.currentPath,
          destination: manager.paths.legacyRecoveryPath,
          pid: DEAD_PID,
          migrationId: OTHER_LEGACY_MIGRATION_ID,
        })}\n`);
      },
    });
    mkdirSync(manager.paths.currentPath);
    writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM original\n');

    expect(() => manager.recoverLegacyCurrent()).toThrow(/identity|changed|migration|evidence/i);
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(readFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'utf-8'))
      .toBe('FROM replacement\n');
    expect(readFileSync(join(originalRecoveryPath, 'Dockerfile'), 'utf-8')).toBe('FROM original\n');
    expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
  });

  it('revalidates destination evidence after atomic setup and immediately before pointer publication', () => {
    const originalRecoveryPath = join(projectDir, 'original-before-pointer');
    const manager = createManager('legacy-before-pointer-swap', {
      faultInjector(point) {
        if (point !== 'after-atomic-preparation-record') return;
        renameSync(manager.paths.legacyRecoveryPath, originalRecoveryPath);
        mkdirSync(manager.paths.legacyRecoveryPath);
        writeFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'FROM replacement\n');
        writeCompleteMarker(
          manager.paths.legacyRecoveryPath,
          'legacy-v0',
          'legacy-migration',
          OTHER_LEGACY_MIGRATION_ID,
        );
        writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
          schemaVersion: 1,
          generationId: 'legacy-v0',
          source: manager.paths.currentPath,
          destination: manager.paths.legacyRecoveryPath,
          pid: DEAD_PID,
          migrationId: OTHER_LEGACY_MIGRATION_ID,
        })}\n`);
      },
    });
    mkdirSync(manager.paths.currentPath);
    writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM original\n');

    expect(() => manager.recoverLegacyCurrent()).toThrow(/identity|changed|migration|evidence/i);
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(readFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'utf-8'))
      .toBe('FROM replacement\n');
    expect(readFileSync(join(originalRecoveryPath, 'Dockerfile'), 'utf-8')).toBe('FROM original\n');
    expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
  });

  it('classifies a preseeded legacy atomic namespace before the first migration mutation', () => {
    const manager = createManager('legacy-preseeded-atomic');
    mkdirSync(manager.paths.currentPath);
    writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM original\n');
    const ownerPath = join(manager.paths.atomicDir, 'legacy-migration');
    mkdirSync(ownerPath);

    expect(() => manager.recoverLegacyCurrent()).toThrow(/atomic|owner|namespace|state/i);
    expect(pathEntryNames(manager.paths.currentPath)).toEqual(['Dockerfile']);
    expect(pathEntryNames(ownerPath)).toEqual([]);
    expect(existsSync(join(manager.paths.currentPath, COMPLETE_MARKER))).toBe(false);
    expect(existsSync(manager.paths.legacyMigrationPath)).toBe(false);
    expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(false);
  });

  it.each(['empty-owner', 'ownerless-operation'] as const)(
    'strict GC rejects a legacy atomic %s namespace instead of treating it as healthy',
    (kind) => {
      const manager = createManager(`legacy-atomic-${kind}`);
      mkdirSync(manager.paths.legacyRecoveryPath);
      writeFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'FROM legacy\n');
      writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'legacy-migration');
      writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
        schemaVersion: 1,
        generationId: 'legacy-v0',
        source: manager.paths.currentPath,
        destination: manager.paths.legacyRecoveryPath,
        pid: DEAD_PID,
        migrationId: LEGACY_MIGRATION_ID,
      })}\n`);
      const ownerPath = join(manager.paths.atomicDir, 'legacy-migration');
      mkdirSync(ownerPath);
      if (kind === 'ownerless-operation') mkdirSync(join(ownerPath, 'operation'));

      expect(() => manager.collectGarbage()).toThrow(/atomic|owner|malformed|state/i);
      expect(pathEntryNames(ownerPath)).toEqual(
        kind === 'empty-owner' ? [] : ['operation'],
      );
      expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(true);
      expect(existsSync(manager.paths.legacyMigrationPath)).toBe(true);
    },
  );

  it('safely removes one dead exact legacy atomic operation and resumes by stable identity', () => {
    const manager = createManager('legacy-dead-atomic-resume', {
      processIsAlive: () => false,
    });
    mkdirSync(manager.paths.legacyRecoveryPath);
    writeFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'FROM legacy\n');
    writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'legacy-migration');
    writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: 101,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);
    const ownerPath = join(manager.paths.atomicDir, 'legacy-migration');
    const operationPath = join(ownerPath, 'operation');
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: 'legacy-migration',
      pid: 202,
      kind: 'legacy',
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);

    const recovered = manager.recoverLegacyCurrent();

    expect(recovered?.id).toBe('legacy-v0');
    expect(realpathSync(manager.paths.currentPath)).toBe(realpathSync(manager.paths.legacyRecoveryPath));
    expect(existsSync(ownerPath)).toBe(false);
    expect(existsSync(manager.paths.legacyMigrationPath)).toBe(false);
  });

  it('preserves a foreign child added after legacy owner classification', () => {
    let operationPath = '';
    let foreignPath = '';
    let injected = false;
    const manager = createManager('legacy-post-classification-child', {
      processIsAlive(pid) {
        if (pid === 202 && !injected) {
          injected = true;
          foreignPath = join(operationPath, 'foreign', 'keep.txt');
          mkdirSync(dirname(foreignPath), { recursive: true });
          writeFileSync(foreignPath, 'preserve\n');
        }
        return false;
      },
    });
    mkdirSync(manager.paths.legacyRecoveryPath);
    writeFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'FROM legacy\n');
    writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'legacy-migration');
    writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: 101,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);
    const ownerPath = join(manager.paths.atomicDir, 'legacy-migration');
    operationPath = join(ownerPath, 'operation');
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: 'legacy-migration',
      pid: 202,
      kind: 'legacy',
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);
    let observedError: unknown;

    try {
      manager.recoverLegacyCurrent();
    } catch (error) {
      observedError = error;
    }

    expect(injected).toBe(true);
    expect.soft(observedError).toBeInstanceOf(Error);
    expect.soft(existsSync(foreignPath)).toBe(true);
    expect.soft(existsSync(join(operationPath, 'owner.json'))).toBe(true);
    expect.soft(existsSync(ownerPath)).toBe(true);
    expect(existsSync(manager.paths.legacyMigrationPath)).toBe(true);
  });

  it('fails closed on one live exact legacy atomic operation without using journal pid authority', () => {
    const manager = createManager('legacy-live-atomic-block', {
      processIsAlive: (pid) => pid === 202,
    });
    mkdirSync(manager.paths.legacyRecoveryPath);
    writeFileSync(join(manager.paths.legacyRecoveryPath, 'Dockerfile'), 'FROM legacy\n');
    writeCompleteMarker(manager.paths.legacyRecoveryPath, 'legacy-v0', 'legacy-migration');
    writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: 101,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);
    const ownerPath = join(manager.paths.atomicDir, 'legacy-migration');
    const operationPath = join(ownerPath, 'operation');
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: 'legacy-migration',
      pid: 202,
      kind: 'legacy',
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);

    expect(() => manager.recoverLegacyCurrent()).toThrow(/live|atomic|recovery/i);
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(existsSync(ownerPath)).toBe(true);
    expect(existsSync(manager.paths.legacyMigrationPath)).toBe(true);
  });

  it.each(['current', 'export'] as const)(
    'recovers a normal %s finish interrupted after its first cleanup removal',
    (kind) => {
      const ownerPid = 101;
      const manager = createManager(`normal-${kind}-cleanup-crash`, {
        pid: ownerPid,
        faultInjector(point) {
          if (point === 'after-atomic-cleanup-first-removal') {
            throw new Error(`synthetic normal ${kind} cleanup crash`);
          }
        },
      });
      const item = createGeneration(manager, `normal-${kind}-cleanup-generation`);
      const ownerPath = join(manager.paths.atomicDir, item.lease.id);

      expect(() => (
        kind === 'current'
          ? manager.publishCurrent(item.lease, item.generation)
          : manager.publishExport(item.lease, item.generation)
      )).toThrow(`synthetic normal ${kind} cleanup crash`);

      const preparations = pathEntryNames(manager.paths.atomicDir)
        .filter((name) => name.startsWith('.prepare-'));
      expect(existsSync(ownerPath)).toBe(false);
      expect(preparations).toHaveLength(1);
      const preparationPath = join(manager.paths.atomicDir, preparations[0]);
      const operationNames = pathEntryNames(preparationPath);
      expect(operationNames).toHaveLength(1);
      const ownerRecord = JSON.parse(readFileSync(
        join(preparationPath, operationNames[0], 'owner.json'),
        'utf-8',
      ));
      expect(ownerRecord).toMatchObject({
        ownerId: item.lease.id,
        pid: ownerPid,
        kind,
      });

      const liveWriterGuard = createManager(`normal-${kind}-cleanup-live`, {
        pid: 202,
        processIsAlive: (pid) => pid === ownerPid,
      });
      expect(() => liveWriterGuard.collectGarbage()).toThrow(/live.*atomic preparation/i);
      expect(existsSync(preparationPath)).toBe(true);

      mkdirSync(ownerPath);
      const foreignIdentity = lstatSync(ownerPath);
      const blockedCollector = createManager(`normal-${kind}-cleanup-foreign`, {
        pid: 303,
        processIsAlive: () => false,
      });
      expect(() => blockedCollector.collectGarbage()).toThrow(/atomic|owner|namespace|malformed/i);
      const retainedForeignIdentity = lstatSync(ownerPath);
      expect({ dev: retainedForeignIdentity.dev, ino: retainedForeignIdentity.ino }).toEqual({
        dev: foreignIdentity.dev,
        ino: foreignIdentity.ino,
      });
      expect(existsSync(preparationPath)).toBe(true);
      rmSync(ownerPath, { recursive: true, force: true });

      const restarted = createManager(`normal-${kind}-cleanup-restart`, {
        pid: 404,
        processIsAlive: () => false,
      });
      restarted.collectGarbage();
      expect(existsSync(preparationPath)).toBe(false);

      const retrying = createManager(`normal-${kind}-cleanup-retry`, { pid: ownerPid });
      const retriedLease = kind === 'current'
        ? retrying.publishCurrent(item.lease, item.generation)
        : retrying.publishExport(item.lease, item.generation);
      expect(retriedLease.state).toBe('consuming');
      const pointerPath = kind === 'current' ? retrying.paths.currentPath : retrying.paths.exportPath;
      expect(realpathSync(pointerPath)).toBe(realpathSync(item.generation.path));
      expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
    },
  );

  it.each(['current', 'export'] as const)(
    'recovers an exact %s pointer-stage preparation after publication and cleanup interruption',
    (kind) => {
      const ownerPid = 101;
      let pointerStageReached = false;
      const manager = createManager(`pointer-stage-${kind}-crash`, {
        pid: ownerPid,
        faultInjector(point) {
          if (point === 'after-atomic-temporary-pointer') {
            pointerStageReached = true;
            throw new Error(`synthetic ${kind} pointer publication crash`);
          }
          if (point === 'after-atomic-cleanup-first-removal' && pointerStageReached) {
            throw new Error(`synthetic ${kind} pointer cleanup crash`);
          }
        },
      });
      const item = createGeneration(manager, `pointer-stage-${kind}-generation`);
      const ownerPath = join(manager.paths.atomicDir, item.lease.id);
      const finalPointerPath = kind === 'current'
        ? manager.paths.currentPath
        : manager.paths.exportPath;

      expect(() => (
        kind === 'current'
          ? manager.publishCurrent(item.lease, item.generation)
          : manager.publishExport(item.lease, item.generation)
      )).toThrow(`synthetic ${kind} pointer cleanup crash`);

      expect(pointerStageReached).toBe(true);
      expect(existsSync(finalPointerPath)).toBe(false);
      expect(existsSync(ownerPath)).toBe(false);
      const preparationNames = pathEntryNames(manager.paths.atomicDir)
        .filter((name) => name.startsWith('.prepare-'));
      expect(preparationNames).toHaveLength(1);
      const preparationPath = join(manager.paths.atomicDir, preparationNames[0]);
      const operationNames = pathEntryNames(preparationPath);
      expect(operationNames).toHaveLength(1);
      const operationPath = join(preparationPath, operationNames[0]);
      expect(pathEntryNames(operationPath)).toEqual(['owner.json', 'pointer']);
      expect(readlinkSync(join(operationPath, 'pointer'))).toBe(relative(
        realpathSync(dirname(finalPointerPath)),
        realpathSync(item.generation.path),
      ));

      const liveWriterGuard = createManager(`pointer-stage-${kind}-live`, {
        pid: 202,
        processIsAlive: (pid) => pid === ownerPid,
      });
      expect(() => liveWriterGuard.collectGarbage()).toThrow(/live.*atomic preparation/i);
      expect(existsSync(preparationPath)).toBe(true);

      mkdirSync(ownerPath);
      const foreignIdentity = lstatSync(ownerPath);
      const blockedCollector = createManager(`pointer-stage-${kind}-foreign`, {
        pid: 303,
        processIsAlive: () => false,
      });
      expect(() => blockedCollector.collectGarbage()).toThrow(/atomic|owner|namespace|malformed/i);
      const retainedForeignIdentity = lstatSync(ownerPath);
      expect({ dev: retainedForeignIdentity.dev, ino: retainedForeignIdentity.ino }).toEqual({
        dev: foreignIdentity.dev,
        ino: foreignIdentity.ino,
      });
      expect(existsSync(preparationPath)).toBe(true);
      rmSync(ownerPath, { recursive: true, force: true });

      const restarted = createManager(`pointer-stage-${kind}-restart`, {
        pid: 404,
        processIsAlive: () => false,
      });
      restarted.collectGarbage();
      expect(existsSync(preparationPath)).toBe(false);

      const retrying = createManager(`pointer-stage-${kind}-retry`, { pid: ownerPid });
      const retryLease = kind === 'current'
        ? retrying.publishCurrent(item.lease, item.generation)
        : retrying.publishExport(item.lease, item.generation);
      expect(retryLease.state).toBe('consuming');
      expect(realpathSync(finalPointerPath)).toBe(realpathSync(item.generation.path));
      expect(pathEntryNames(retrying.paths.atomicDir)).toEqual([]);
    },
  );

  it.each(['current', 'export'] as const)(
    'classifies and restart-drains a %s pointer created before handle assignment',
    (kind) => {
      const ownerPid = 101;
      let reachedCreatedBoundary = false;
      const manager = createManager(`preassignment-${kind}`, {
        pid: ownerPid,
        faultInjector(point) {
          if (point === 'after-atomic-temporary-pointer-created') {
            reachedCreatedBoundary = true;
            throw new Error(`synthetic ${kind} preassignment failure`);
          }
        },
      });
      const item = createGeneration(manager, `preassignment-${kind}-generation`);
      const finalPointerPath = kind === 'current'
        ? manager.paths.currentPath
        : manager.paths.exportPath;
      let publicationError: unknown;

      try {
        if (kind === 'current') manager.publishCurrent(item.lease, item.generation);
        else manager.publishExport(item.lease, item.generation);
      } catch (error) {
        publicationError = error;
      }

      expect(reachedCreatedBoundary).toBe(true);
      expect(publicationError).toBeInstanceOf(Error);
      expect(existsSync(finalPointerPath)).toBe(false);
      const preparationNames = pathEntryNames(manager.paths.atomicDir)
        .filter((name) => name.startsWith('.prepare-'));
      let exactOrClean = preparationNames.length === 0;
      if (preparationNames.length === 1) {
        const preparationPath = join(manager.paths.atomicDir, preparationNames[0]);
        const operationNames = pathEntryNames(preparationPath);
        exactOrClean = operationNames.length === 1
          && pathEntryNames(join(preparationPath, operationNames[0])).join(',') === 'owner.json,pointer';
      }
      expect.soft(exactOrClean).toBe(true);

      const restarted = createManager(`preassignment-${kind}-restart`, {
        pid: 202,
        processIsAlive: () => false,
      });
      let restartError: unknown;
      try {
        restarted.collectGarbage();
      } catch (error) {
        restartError = error;
      }
      expect.soft(restartError).toBeUndefined();

      const retrying = createManager(`preassignment-${kind}-retry`, { pid: ownerPid });
      let retryLease: DockerContextLease | undefined;
      let retryError: unknown;
      try {
        retryLease = kind === 'current'
          ? retrying.publishCurrent(item.lease, item.generation)
          : retrying.publishExport(item.lease, item.generation);
      } catch (error) {
        retryError = error;
      }
      expect.soft(retryError).toBeUndefined();
      expect.soft(retryLease?.state).toBe('consuming');
      if (retryLease) {
        expect.soft(realpathSync(finalPointerPath)).toBe(realpathSync(item.generation.path));
      }
      expect.soft(pathEntryNames(retrying.paths.atomicDir)).toEqual([]);
    },
  );

  it.each(['current', 'export'] as const)(
    'drains one dead exact unclaimed %s pointer-stage preparation',
    (kind) => {
      const manager = createManager(`pointer-stage-${kind}-exact`, {
        pid: DEAD_PID,
        processIsAlive: () => false,
      });
      const item = createGeneration(manager, `pointer-stage-${kind}-exact-generation`);
      item.lease = manager.markConsuming(item.lease);
      const seeded = seedAtomicPointerPreparation(
        manager,
        item.lease,
        item.generation,
        kind,
      );

      expect(readlinkSync(seeded.pointerPath)).toBe(seeded.expectedTarget);
      expect(() => manager.collectGarbage()).not.toThrow();
      expect(existsSync(seeded.preparationPath)).toBe(false);
      expect(existsSync(item.lease.ownerPath)).toBe(true);
      expect(existsSync(item.generation.path)).toBe(true);
    },
  );

  it.each([
    ['current', 'escaping target'],
    ['current', 'wrong generation target'],
    ['export', 'wrong pointer-parent convention'],
    ['current', 'renamed pointer'],
    ['current', 'multiple pointers'],
    ['current', 'non-symlink pointer'],
    ['current', 'arbitrary extra entry'],
  ] as const)(
    'retains a malformed %s pointer-stage preparation with %s',
    (kind, variant) => {
      const manager = createManager(`pointer-stage-${kind}-malformed`, {
        pid: DEAD_PID,
        processIsAlive: () => false,
      });
      const item = createGeneration(manager, `pointer-stage-${kind}-malformed-generation`);
      item.lease = manager.markConsuming(item.lease);
      const seeded = seedAtomicPointerPreparation(
        manager,
        item.lease,
        item.generation,
        kind,
      );
      let externalPath: string | undefined;

      if (variant === 'escaping target') {
        externalPath = `${projectDir}-pointer-stage-external`;
        cleanupPaths.push(externalPath);
        mkdirSync(externalPath);
        writeFileSync(join(externalPath, 'foreign.txt'), 'preserve\n');
        rmSync(seeded.pointerPath, { force: true });
        symlinkSync(externalPath, seeded.pointerPath, 'dir');
      } else if (variant === 'wrong generation target') {
        const other = createGeneration(manager, 'pointer-stage-other-generation');
        rmSync(seeded.pointerPath, { force: true });
        symlinkSync(relative(
          realpathSync(dirname(manager.paths.currentPath)),
          realpathSync(other.generation.path),
        ), seeded.pointerPath, 'dir');
      } else if (variant === 'wrong pointer-parent convention') {
        rmSync(seeded.pointerPath, { force: true });
        symlinkSync(relative(
          realpathSync(dirname(manager.paths.currentPath)),
          realpathSync(item.generation.path),
        ), seeded.pointerPath, 'dir');
      } else if (variant === 'renamed pointer') {
        renameSync(seeded.pointerPath, join(seeded.operationPath, 'renamed-pointer'));
      } else if (variant === 'multiple pointers') {
        symlinkSync(seeded.expectedTarget, join(seeded.operationPath, 'second-pointer'), 'dir');
      } else if (variant === 'non-symlink pointer') {
        rmSync(seeded.pointerPath, { force: true });
        writeFileSync(seeded.pointerPath, `${seeded.expectedTarget}\n`);
      } else {
        writeFileSync(join(seeded.operationPath, 'foreign.txt'), 'preserve\n');
      }

      expect(() => manager.collectGarbage())
        .toThrow(/atomic|preparation|pointer|malformed|authority|generation/i);
      expect(existsSync(seeded.preparationPath)).toBe(true);
      if (externalPath) {
        expect(readFileSync(join(externalPath, 'foreign.txt'), 'utf-8')).toBe('preserve\n');
      }
    },
  );

  it.each(['current', 'export'] as const)(
    'recovers a dead %s claim when GC crashes after its first cleanup removal',
    (kind) => {
      const deadOwnerPid = 101;
      const seeding = createManager(`dead-${kind}-claim-seed`, {
        pid: deadOwnerPid,
        faultInjector(point) {
          if (point === 'after-atomic-owner-publication') {
            throw new Error(`synthetic dead ${kind} owner crash`);
          }
        },
      });
      const item = createGeneration(seeding, `dead-${kind}-claim-generation`);
      const ownerPath = join(seeding.paths.atomicDir, item.lease.id);
      expect(() => (
        kind === 'current'
          ? seeding.publishCurrent(item.lease, item.generation)
          : seeding.publishExport(item.lease, item.generation)
      )).toThrow(`synthetic dead ${kind} owner crash`);
      const preparationName = pathEntryNames(seeding.paths.atomicDir)
        .find((name) => name.startsWith('.prepare-'));
      expect(preparationName).toBeDefined();
      const preparationPath = join(seeding.paths.atomicDir, preparationName!);

      const crashingCollector = createManager(`dead-${kind}-claim-cleanup-crash`, {
        pid: 202,
        processIsAlive: () => false,
        faultInjector(point) {
          if (point === 'after-atomic-cleanup-first-removal') {
            throw new Error(`synthetic dead ${kind} cleanup crash`);
          }
        },
      });
      expect(() => crashingCollector.collectGarbage())
        .toThrow(`synthetic dead ${kind} cleanup crash`);

      expect(existsSync(ownerPath)).toBe(false);
      expect(existsSync(preparationPath)).toBe(true);
      const operationNames = pathEntryNames(preparationPath);
      expect(operationNames).toHaveLength(1);
      expect(JSON.parse(readFileSync(
        join(preparationPath, operationNames[0], 'owner.json'),
        'utf-8',
      ))).toMatchObject({
        ownerId: item.lease.id,
        pid: deadOwnerPid,
        kind,
      });

      const liveWriterGuard = createManager(`dead-${kind}-claim-live`, {
        pid: 303,
        processIsAlive: (pid) => pid === deadOwnerPid,
      });
      expect(() => liveWriterGuard.collectGarbage()).toThrow(/live.*atomic preparation/i);
      expect(existsSync(preparationPath)).toBe(true);

      mkdirSync(ownerPath);
      const foreignIdentity = lstatSync(ownerPath);
      const blockedCollector = createManager(`dead-${kind}-claim-foreign`, {
        pid: 404,
        processIsAlive: () => false,
      });
      expect(() => blockedCollector.collectGarbage()).toThrow(/atomic|owner|namespace|malformed/i);
      const retainedForeignIdentity = lstatSync(ownerPath);
      expect({ dev: retainedForeignIdentity.dev, ino: retainedForeignIdentity.ino }).toEqual({
        dev: foreignIdentity.dev,
        ino: foreignIdentity.ino,
      });
      expect(existsSync(preparationPath)).toBe(true);
      rmSync(ownerPath, { recursive: true, force: true });

      const restarted = createManager(`dead-${kind}-claim-restart`, {
        pid: 505,
        processIsAlive: () => false,
      });
      restarted.collectGarbage();
      expect(existsSync(preparationPath)).toBe(false);
      expect(existsSync(item.lease.ownerPath)).toBe(false);
      expect(existsSync(item.generation.path)).toBe(false);

      const retry = createGeneration(restarted, `dead-${kind}-claim-retry-generation`);
      const retryLease = kind === 'current'
        ? restarted.publishCurrent(retry.lease, retry.generation)
        : restarted.publishExport(retry.lease, retry.generation);
      expect(retryLease.state).toBe('consuming');
      const pointerPath = kind === 'current' ? restarted.paths.currentPath : restarted.paths.exportPath;
      expect(realpathSync(pointerPath)).toBe(realpathSync(retry.generation.path));
      expect(pathEntryNames(restarted.paths.atomicDir)).toEqual([]);
    },
  );

  it('recovers a stable legacy claim when recovery crashes after its first cleanup removal', () => {
    const deadOwnerPid = 101;
    const seeding = createManager('legacy-claim-cleanup-seed', {
      pid: deadOwnerPid,
      faultInjector(point) {
        if (point === 'after-atomic-owner-publication') {
          throw new Error('synthetic legacy owner crash');
        }
      },
    });
    mkdirSync(seeding.paths.currentPath);
    writeFileSync(join(seeding.paths.currentPath, 'Dockerfile'), 'FROM legacy\n');
    const ownerPath = join(seeding.paths.atomicDir, 'legacy-migration');
    expect(() => seeding.recoverLegacyCurrent()).toThrow('synthetic legacy owner crash');
    const migration = JSON.parse(readFileSync(seeding.paths.legacyMigrationPath, 'utf-8'));
    const preparationName = pathEntryNames(seeding.paths.atomicDir)
      .find((name) => name.startsWith('.prepare-'));
    expect(preparationName).toBeDefined();
    const preparationPath = join(seeding.paths.atomicDir, preparationName!);

    const crashingRecovery = createManager('legacy-claim-cleanup-crash', {
      pid: 202,
      processIsAlive: () => false,
      faultInjector(point) {
        if (point === 'after-atomic-cleanup-first-removal') {
          throw new Error('synthetic legacy cleanup crash');
        }
      },
    });
    expect(() => crashingRecovery.recoverLegacyCurrent())
      .toThrow('synthetic legacy cleanup crash');

    expect(existsSync(ownerPath)).toBe(false);
    expect(existsSync(preparationPath)).toBe(true);
    const operationNames = pathEntryNames(preparationPath);
    expect(operationNames).toHaveLength(1);
    expect(JSON.parse(readFileSync(
      join(preparationPath, operationNames[0], 'owner.json'),
      'utf-8',
    ))).toMatchObject({
      ownerId: 'legacy-migration',
      pid: deadOwnerPid,
      kind: 'legacy',
      migrationId: migration.migrationId,
    });

    const liveWriterGuard = createManager('legacy-claim-cleanup-live', {
      pid: 303,
      processIsAlive: (pid) => pid === deadOwnerPid,
    });
    expect(() => liveWriterGuard.recoverLegacyCurrent()).toThrow(/live.*atomic preparation/i);
    expect(existsSync(preparationPath)).toBe(true);

    mkdirSync(ownerPath);
    const foreignIdentity = lstatSync(ownerPath);
    const blockedRecovery = createManager('legacy-claim-cleanup-foreign', {
      pid: 404,
      processIsAlive: () => false,
    });
    expect(() => blockedRecovery.recoverLegacyCurrent())
      .toThrow(/atomic|owner|namespace|malformed/i);
    const retainedForeignIdentity = lstatSync(ownerPath);
    expect({ dev: retainedForeignIdentity.dev, ino: retainedForeignIdentity.ino }).toEqual({
      dev: foreignIdentity.dev,
      ino: foreignIdentity.ino,
    });
    expect(existsSync(preparationPath)).toBe(true);
    rmSync(ownerPath, { recursive: true, force: true });

    const restarted = createManager('legacy-claim-cleanup-restart', {
      pid: 505,
      processIsAlive: () => false,
    });
    const recovered = restarted.recoverLegacyCurrent();
    expect(recovered?.id).toBe('legacy-v0');
    expect(realpathSync(restarted.paths.currentPath))
      .toBe(realpathSync(restarted.paths.legacyRecoveryPath));
    expect(existsSync(preparationPath)).toBe(false);
    expect(existsSync(restarted.paths.legacyMigrationPath)).toBe(false);
    expect(pathEntryNames(restarted.paths.atomicDir)).toEqual([]);
  });

  it.each([
    ['normal-current', 'current'],
    ['normal-export', 'export'],
    ['pointer-current', 'current'],
    ['pointer-export', 'export'],
    ['dead-claim-current', 'current'],
    ['dead-claim-export', 'export'],
    ['legacy-claim', 'legacy'],
  ] as const)(
    'preserves exact owner evidence when %s cleanup sees a fresh foreign child',
    (variant, kind) => {
      let evidence: ReturnType<typeof addForeignAtomicCleanupEntry> | undefined;
      let observedError: unknown;

      if (variant === 'normal-current' || variant === 'normal-export') {
        const manager = createManager(`fresh-shape-${variant}`, {
          pid: 101,
          faultInjector(point) {
            if (point === 'after-atomic-cleanup-first-removal') {
              evidence = addForeignAtomicCleanupEntry(manager);
            }
          },
        });
        const item = createGeneration(manager, `fresh-shape-${variant}-generation`);
        try {
          if (kind === 'current') manager.publishCurrent(item.lease, item.generation);
          else manager.publishExport(item.lease, item.generation);
        } catch (error) {
          observedError = error;
        }
      } else if (variant === 'pointer-current' || variant === 'pointer-export') {
        const manager = createManager(`fresh-shape-${variant}`, {
          pid: 101,
          faultInjector(point) {
            if (point === 'after-atomic-temporary-pointer') {
              throw new Error(`synthetic ${variant} publication failure`);
            }
            if (point === 'after-atomic-cleanup-first-removal') {
              evidence = addForeignAtomicCleanupEntry(manager);
            }
          },
        });
        const item = createGeneration(manager, `fresh-shape-${variant}-generation`);
        try {
          if (kind === 'current') manager.publishCurrent(item.lease, item.generation);
          else manager.publishExport(item.lease, item.generation);
        } catch (error) {
          observedError = error;
        }
      } else if (variant === 'dead-claim-current' || variant === 'dead-claim-export') {
        const seeding = createManager(`fresh-shape-${variant}-seed`, {
          pid: 101,
          faultInjector(point) {
            if (point === 'after-atomic-owner-publication') {
              throw new Error(`synthetic ${variant} owner crash`);
            }
          },
        });
        const item = createGeneration(seeding, `fresh-shape-${variant}-generation`);
        expect(() => (
          kind === 'current'
            ? seeding.publishCurrent(item.lease, item.generation)
            : seeding.publishExport(item.lease, item.generation)
        )).toThrow(`synthetic ${variant} owner crash`);

        const collector = createManager(`fresh-shape-${variant}-collector`, {
          pid: 202,
          processIsAlive: () => false,
          faultInjector(point) {
            if (point === 'after-atomic-cleanup-first-removal') {
              evidence = addForeignAtomicCleanupEntry(collector);
            }
          },
        });
        try {
          collector.collectGarbage();
        } catch (error) {
          observedError = error;
        }
      } else {
        const seeding = createManager('fresh-shape-legacy-claim-seed', {
          pid: 101,
          faultInjector(point) {
            if (point === 'after-atomic-owner-publication') {
              throw new Error('synthetic legacy owner crash');
            }
          },
        });
        mkdirSync(seeding.paths.currentPath);
        writeFileSync(join(seeding.paths.currentPath, 'Dockerfile'), 'FROM legacy\n');
        expect(() => seeding.recoverLegacyCurrent()).toThrow('synthetic legacy owner crash');

        const recovering = createManager('fresh-shape-legacy-claim-recover', {
          pid: 202,
          processIsAlive: () => false,
          faultInjector(point) {
            if (point === 'after-atomic-cleanup-first-removal') {
              evidence = addForeignAtomicCleanupEntry(recovering);
            }
          },
        });
        try {
          recovering.recoverLegacyCurrent();
        } catch (error) {
          observedError = error;
        }
      }

      expect(observedError).toBeInstanceOf(Error);
      expect(evidence).toBeDefined();
      expect(readFileSync(evidence!.foreignPath, 'utf-8')).toBe('preserve\n');
      expect(existsSync(evidence!.preparationPath)).toBe(true);
      expect(existsSync(evidence!.ownerPath)).toBe(true);
    },
  );

  it('never replaces a foreign empty final owner while publishing a normal pointer', () => {
    let ownerPath = '';
    let foreignIdentity: { dev: number; ino: number } | undefined;
    const manager = createManager('normal-foreign-final-owner', {
      pid: 101,
      faultInjector(point) {
        if (point !== 'after-atomic-preparation-record') return;
        mkdirSync(ownerPath);
        const info = lstatSync(ownerPath);
        foreignIdentity = { dev: info.dev, ino: info.ino };
      },
    });
    const item = createGeneration(manager, 'normal-foreign-final-owner-generation');
    ownerPath = join(manager.paths.atomicDir, item.lease.id);

    expect(() => manager.publishCurrent(item.lease, item.generation))
      .toThrow(/atomic owner|already exists|cannot be reused/i);

    const finalInfo = lstatSync(ownerPath);
    expect({ dev: finalInfo.dev, ino: finalInfo.ino }).toEqual(foreignIdentity);
    expect(pathEntryNames(ownerPath)).toEqual([]);
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(readLeaseState(item.lease)).toBe('preconsumer');
    const preparations = pathEntryNames(manager.paths.atomicDir)
      .filter((name) => name.startsWith('.prepare-'));
    expect(preparations).toHaveLength(1);
    const operationNames = pathEntryNames(join(manager.paths.atomicDir, preparations[0]));
    expect(operationNames).toHaveLength(1);
    expect(pathEntryNames(join(manager.paths.atomicDir, preparations[0], operationNames[0])))
      .toEqual(['owner.json']);

    const collector = createManager('normal-foreign-final-owner-collector', {
      pid: 202,
      processIsAlive: () => false,
    });
    expect(() => collector.collectGarbage()).toThrow(/atomic|owner|namespace|malformed/i);
    const retainedInfo = lstatSync(ownerPath);
    expect({ dev: retainedInfo.dev, ino: retainedInfo.ino }).toEqual(foreignIdentity);
    expect(existsSync(join(manager.paths.atomicDir, preparations[0]))).toBe(true);
  });

  it('never replaces a foreign empty final owner while publishing a legacy pointer', () => {
    let ownerPath = '';
    let foreignIdentity: { dev: number; ino: number } | undefined;
    const manager = createManager('legacy-foreign-final-owner', {
      pid: 101,
      faultInjector(point) {
        if (point !== 'after-atomic-preparation-record') return;
        mkdirSync(ownerPath);
        const info = lstatSync(ownerPath);
        foreignIdentity = { dev: info.dev, ino: info.ino };
      },
    });
    ownerPath = join(manager.paths.atomicDir, 'legacy-migration');
    mkdirSync(manager.paths.currentPath);
    writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM legacy\n');

    expect(() => manager.recoverLegacyCurrent())
      .toThrow(/atomic owner|already exists|cannot be reused/i);

    const finalInfo = lstatSync(ownerPath);
    expect({ dev: finalInfo.dev, ino: finalInfo.ino }).toEqual(foreignIdentity);
    expect(pathEntryNames(ownerPath)).toEqual([]);
    expect(existsSync(manager.paths.currentPath)).toBe(false);
    expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(true);
    expect(existsSync(manager.paths.legacyMigrationPath)).toBe(true);
    const preparations = pathEntryNames(manager.paths.atomicDir)
      .filter((name) => name.startsWith('.prepare-'));
    expect(preparations).toHaveLength(1);
    const operationNames = pathEntryNames(join(manager.paths.atomicDir, preparations[0]));
    expect(operationNames).toHaveLength(1);
    expect(pathEntryNames(join(manager.paths.atomicDir, preparations[0], operationNames[0])))
      .toEqual(['owner.json']);

    const recovering = createManager('legacy-foreign-final-owner-recovering', {
      pid: 202,
      processIsAlive: () => false,
    });
    expect(() => recovering.recoverLegacyCurrent())
      .toThrow(/atomic|owner|namespace|malformed/i);
    const retainedInfo = lstatSync(ownerPath);
    expect({ dev: retainedInfo.dev, ino: retainedInfo.ino }).toEqual(foreignIdentity);
    expect(existsSync(join(manager.paths.atomicDir, preparations[0]))).toBe(true);
  });

  it.each([
    ['arbitrary root file', (preparationPath: string) => {
      writeFileSync(join(preparationPath, 'foreign.txt'), 'preserve\n');
    }],
    ['multiple operation entries', (preparationPath: string) => {
      mkdirSync(join(preparationPath, '0'.repeat(16)));
      mkdirSync(join(preparationPath, '1'.repeat(16)));
    }],
    ['symlinked operation entry', (preparationPath: string) => {
      const externalPath = `${projectDir}-preparation-symlink-target`;
      cleanupPaths.push(externalPath);
      mkdirSync(externalPath);
      writeFileSync(join(externalPath, 'foreign.txt'), 'preserve\n');
      symlinkSync(externalPath, join(preparationPath, '2'.repeat(16)), 'dir');
    }],
    ['arbitrary nested entry', (preparationPath: string) => {
      const operationPath = join(preparationPath, '3'.repeat(16));
      mkdirSync(operationPath);
      mkdirSync(join(operationPath, 'nested'));
      writeFileSync(join(operationPath, 'nested', 'foreign.txt'), 'preserve\n');
    }],
    ['filename and record owner mismatch', (preparationPath: string) => {
      const operationPath = join(preparationPath, '4'.repeat(16));
      mkdirSync(operationPath);
      writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
        schemaVersion: 1,
        ownerId: 'different-owner',
        pid: DEAD_PID,
        kind: 'legacy',
        migrationId: LEGACY_MIGRATION_ID,
      })}\n`);
    }],
    ['filename and live record pid mismatch', (preparationPath: string) => {
      const operationPath = join(preparationPath, '5'.repeat(16));
      mkdirSync(operationPath);
      writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
        schemaVersion: 1,
        ownerId: 'legacy-migration',
        pid: 202,
        kind: 'legacy',
        migrationId: LEGACY_MIGRATION_ID,
      })}\n`);
    }],
    ['legacy owner and normal kind mismatch', (preparationPath: string) => {
      const operationPath = join(preparationPath, '6'.repeat(16));
      mkdirSync(operationPath);
      writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
        schemaVersion: 1,
        ownerId: 'legacy-migration',
        pid: DEAD_PID,
        kind: 'current',
      })}\n`);
    }],
    ['stable migration identity mismatch', (preparationPath: string) => {
      const operationPath = join(preparationPath, '7'.repeat(16));
      mkdirSync(operationPath);
      writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
        schemaVersion: 1,
        ownerId: 'legacy-migration',
        pid: DEAD_PID,
        kind: 'legacy',
        migrationId: OTHER_LEGACY_MIGRATION_ID,
      })}\n`);
    }],
  ] as const)(
    'retains a malformed or unbound dead legacy preparation with %s',
    (_label, mutatePreparation) => {
      const manager = createManager('legacy-malformed-preparation', {
        processIsAlive: (pid) => pid === 202,
      });
      mkdirSync(manager.paths.currentPath);
      writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM original\n');
      writeCompleteMarker(manager.paths.currentPath, 'legacy-v0', 'legacy-migration');
      const journal = `${JSON.stringify({
        schemaVersion: 1,
        generationId: 'legacy-v0',
        source: manager.paths.currentPath,
        destination: manager.paths.legacyRecoveryPath,
        pid: DEAD_PID,
        migrationId: LEGACY_MIGRATION_ID,
      })}\n`;
      writeFileSync(manager.paths.legacyMigrationPath, journal);
      const preparationPath = join(
        manager.paths.atomicDir,
        `.prepare-${DEAD_PID}-${'8'.repeat(16)}-legacy-migration`,
      );
      mkdirSync(preparationPath);
      mutatePreparation(preparationPath);

      expect(() => manager.recoverLegacyCurrent())
        .toThrow(/atomic|preparation|owner|inventory|malformed|migration|authority/i);
      expect(existsSync(preparationPath)).toBe(true);
      expect(readFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'utf-8'))
        .toBe('FROM original\n');
      expect(readFileSync(manager.paths.legacyMigrationPath, 'utf-8')).toBe(journal);
      expect(existsSync(manager.paths.legacyRecoveryPath)).toBe(false);
    },
  );

  it('counts the complete nested preparation inventory against one recovery budget', () => {
    const manager = createManager('legacy-preparation-inventory', {
      maxInventoryEntries: 3,
      processIsAlive: () => false,
    });
    const preparationPath = join(
      manager.paths.atomicDir,
      `.prepare-${DEAD_PID}-${'9'.repeat(16)}-legacy-migration`,
    );
    const operationPath = join(preparationPath, 'a'.repeat(16));
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: 'legacy-migration',
      pid: DEAD_PID,
      kind: 'legacy',
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);
    writeFileSync(join(operationPath, 'foreign.txt'), 'preserve\n');

    expect(() => manager.recoverLegacyCurrent()).toThrow(/inventory|bounded safety limit/i);
    expect(readFileSync(join(operationPath, 'foreign.txt'), 'utf-8')).toBe('preserve\n');
    expect(existsSync(preparationPath)).toBe(true);
  });

  it('rejects a normal preparation whose dead filename hides a live owner record', () => {
    const manager = createManager('normal-preparation-live-record', {
      pid: 202,
      processIsAlive: (pid) => pid === 202,
    });
    const lease = manager.createLease();
    const preparationPath = join(
      manager.paths.atomicDir,
      `.prepare-${DEAD_PID}-${'b'.repeat(16)}-${lease.id}`,
    );
    const operationPath = join(preparationPath, 'c'.repeat(16));
    mkdirSync(operationPath, { recursive: true });
    writeFileSync(join(operationPath, 'owner.json'), `${JSON.stringify({
      schemaVersion: 1,
      ownerId: lease.id,
      pid: 202,
      kind: 'current',
    })}\n`);

    expect(() => manager.collectGarbage()).toThrow(/preparation|owner|mismatch|atomic/i);
    expect(existsSync(preparationPath)).toBe(true);
    expect(existsSync(lease.ownerPath)).toBe(true);
  });

  it('drains sixty-five dead exact preparations in declared bounded chunks', () => {
    const deleteEvents: DockerContextMaintenanceEvent[] = [];
    const manager = createManager('legacy-preparation-full-drain', {
      processIsAlive: () => false,
      maxInventoryEntries: 256,
      deletionChunkSize: 64,
      maintenanceObserver(event) {
        if (event.phase === 'delete-chunk') deleteEvents.push(event);
      },
    });
    for (let index = 0; index < 65; index += 1) {
      mkdirSync(join(
        manager.paths.atomicDir,
        `.prepare-${DEAD_PID}-${index.toString(16).padStart(16, '0')}-legacy-migration`,
      ));
    }

    expect(manager.recoverLegacyCurrent()).toBeNull();
    expect(pathEntryNames(manager.paths.atomicDir)).toEqual([]);
    expect(deleteEvents).toEqual([
      { phase: 'delete-chunk', chunkIndex: 0, chunkSize: 64, remaining: 1 },
      { phase: 'delete-chunk', chunkIndex: 1, chunkSize: 1, remaining: 0 },
    ]);
  });

  it.each([
    'after-atomic-preparation-owner',
    'after-atomic-preparation-operation',
    'after-atomic-preparation-record',
    'after-atomic-owner-publication',
  ] as const)('reclaims a dead bounded legacy atomic crash namespace after %s', (faultPoint) => {
    const isolatedProject = join(projectDir, faultPoint);
    const faulting = createManager('legacy-atomic-crash', {
      pid: 101,
      faultInjector(point) {
        if (point === faultPoint) throw new Error(`synthetic ${faultPoint}`);
      },
    }, isolatedProject);
    mkdirSync(faulting.paths.currentPath);
    writeFileSync(join(faulting.paths.currentPath, 'Dockerfile'), 'FROM legacy\n');

    expect(() => faulting.recoverLegacyCurrent()).toThrow(`synthetic ${faultPoint}`);
    const preparationNames = pathEntryNames(faulting.paths.atomicDir)
      .filter((name) => name.startsWith('.prepare-'));
    expect(preparationNames).toHaveLength(1);
    expect(preparationNames[0]).toMatch(/^\.prepare-101-[a-f0-9]{16}-legacy-migration$/);
    const preparationPath = join(faulting.paths.atomicDir, preparationNames[0]);
    if (faultPoint === 'after-atomic-preparation-owner') {
      expect(pathEntryNames(preparationPath)).toEqual([]);
    } else {
      const operationNames = pathEntryNames(preparationPath);
      expect(operationNames).toHaveLength(1);
      expect(pathEntryNames(join(preparationPath, operationNames[0]))).toEqual(
        faultPoint === 'after-atomic-preparation-operation' ? [] : ['owner.json'],
      );
    }
    if (faultPoint === 'after-atomic-owner-publication') {
      const claimInfo = lstatSync(join(faulting.paths.atomicDir, 'legacy-migration'));
      expect(claimInfo.isFile()).toBe(true);
      expect(claimInfo.isSymbolicLink()).toBe(false);
    }
    expect(existsSync(faulting.paths.currentPath)).toBe(false);
    expect(existsSync(faulting.paths.legacyRecoveryPath)).toBe(true);
    expect(existsSync(faulting.paths.legacyMigrationPath)).toBe(true);

    const recovering = createManager('legacy-atomic-crash-resume', {
      pid: 202,
      processIsAlive: () => false,
    }, isolatedProject);
    const recovered = recovering.recoverLegacyCurrent();

    expect(recovered?.id).toBe('legacy-v0');
    expect(realpathSync(recovering.paths.currentPath))
      .toBe(realpathSync(recovering.paths.legacyRecoveryPath));
    expect(pathEntryNames(recovering.paths.atomicDir)).toEqual([]);
    expect(existsSync(recovering.paths.legacyMigrationPath)).toBe(false);
  });

  it('retains a live bounded legacy atomic preparation and fails closed', () => {
    const isolatedProject = join(projectDir, 'live-atomic-preparation');
    const faulting = createManager('legacy-live-preparation', {
      pid: 303,
      faultInjector(point) {
        if (point === 'after-atomic-preparation-operation') {
          throw new Error('synthetic live preparation crash');
        }
      },
    }, isolatedProject);
    mkdirSync(faulting.paths.currentPath);
    writeFileSync(join(faulting.paths.currentPath, 'Dockerfile'), 'FROM legacy\n');
    expect(() => faulting.recoverLegacyCurrent()).toThrow('synthetic live preparation crash');
    const preparationNames = pathEntryNames(faulting.paths.atomicDir);

    const blocked = createManager('legacy-live-preparation-blocked', {
      pid: 404,
      processIsAlive: (pid) => pid === 303,
    }, isolatedProject);
    expect(() => blocked.recoverLegacyCurrent()).toThrow(/live|preparation|atomic/i);
    expect(pathEntryNames(blocked.paths.atomicDir)).toEqual(preparationNames);
    expect(existsSync(blocked.paths.currentPath)).toBe(false);
    expect(existsSync(blocked.paths.legacyMigrationPath)).toBe(true);
  });

  it('reuses a durable random migration identity after a pre-journal crash', () => {
    const faulting = createManager('legacy-marker-crash', {
      pid: 101,
      faultInjector(point) {
        if (point === 'after-legacy-marker') throw new Error('synthetic marker crash');
      },
    });
    mkdirSync(faulting.paths.currentPath);
    writeFileSync(join(faulting.paths.currentPath, 'Dockerfile'), 'FROM node:22\n');

    expect(() => faulting.recoverLegacyCurrent()).toThrow('synthetic marker crash');
    const markerBefore = JSON.parse(readFileSync(
      join(faulting.paths.currentPath, COMPLETE_MARKER),
      'utf-8',
    )) as Record<string, unknown>;
    expect(markerBefore.migrationId).toMatch(/^[a-f0-9]{32}$/);
    expect(existsSync(faulting.paths.legacyMigrationPath)).toBe(false);
    expect(existsSync(faulting.paths.legacyRecoveryPath)).toBe(false);

    const recovering = createManager('legacy-marker-resume', { pid: 202 });
    const recovered = recovering.recoverLegacyCurrent();
    const markerAfter = JSON.parse(readFileSync(
      join(recovering.paths.legacyRecoveryPath, COMPLETE_MARKER),
      'utf-8',
    )) as Record<string, unknown>;

    expect(recovered?.id).toBe('legacy-v0');
    expect(markerAfter.migrationId).toBe(markerBefore.migrationId);
    expect(existsSync(recovering.paths.legacyMigrationPath)).toBe(false);
  });

  it('idempotently resumes a real legacy current across processes with its stable identity', () => {
    const manager = createManager('legacy-journal-resume');
    mkdirSync(manager.paths.currentPath);
    writeFileSync(join(manager.paths.currentPath, 'Dockerfile'), 'FROM node:22\n');
    writeCompleteMarker(manager.paths.currentPath, 'legacy-v0', 'legacy-migration');
    writeFileSync(manager.paths.legacyMigrationPath, `${JSON.stringify({
      schemaVersion: 1,
      generationId: 'legacy-v0',
      source: manager.paths.currentPath,
      destination: manager.paths.legacyRecoveryPath,
      pid: DEAD_PID,
      migrationId: LEGACY_MIGRATION_ID,
    })}\n`);

    const recovered = manager.recoverLegacyCurrent();

    expect(recovered?.id).toBe('legacy-v0');
    expect(realpathSync(manager.paths.currentPath)).toBe(realpathSync(manager.paths.legacyRecoveryPath));
    expect(JSON.parse(readFileSync(
      join(manager.paths.legacyRecoveryPath, COMPLETE_MARKER),
      'utf-8',
    )).migrationId).toBe(LEGACY_MIGRATION_ID);
    expect(existsSync(manager.paths.legacyMigrationPath)).toBe(false);
  });
});
