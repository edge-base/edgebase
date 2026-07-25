import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createDockerContextGenerationManager,
  type DockerContextGeneration,
  type DockerContextGenerationManager,
  type DockerContextLease,
} from '../src/lib/docker-context-generation.js';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

let projectDir: string;
const cliPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};

function createGeneration(
  manager: DockerContextGenerationManager,
  id: string,
  payload = id,
): { lease: DockerContextLease; generation: DockerContextGeneration } {
  let lease = manager.createLease();
  lease = manager.setPlannedGeneration(lease, id);
  const generation = manager.publishGeneration(lease, (stagingDir) => {
    writeFileSync(join(stagingDir, 'Dockerfile'), 'FROM node:22\n');
    mkdirSync(join(stagingDir, 'payload'), { recursive: true });
    writeFileSync(join(stagingDir, 'payload', 'marker.txt'), `${payload}\n`);
  });
  return { lease, generation };
}

async function waitFor(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for filesystem state.');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

type LeaseTransitionAction = 'plan' | 'consume' | 'release' | 'current' | 'export';

function writeHeldTransitionChildScript(root: string): string {
  const childScript = join(root, 'held-lease-transition.mts');
  const moduleUrl = pathToFileURL(
    resolve(cliPackageDir, 'src', 'lib', 'docker-context-generation.ts'),
  ).href;
  writeFileSync(childScript, [
    "import { existsSync, writeFileSync } from 'node:fs';",
    `import { createDockerContextGenerationManager } from ${JSON.stringify(moduleUrl)};`,
    'const [root, action, leaseJson, generationJson, plannedId, readyPath, goPath, pidText] = process.argv.slice(2);',
    'const lease = JSON.parse(leaseJson);',
    "const generation = generationJson === 'null' ? undefined : JSON.parse(generationJson);",
    'const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));',
    'const manager = createDockerContextGenerationManager(root, {',
    '  pid: Number(pidText),',
    '  faultInjector(point) {',
    "    if (point !== 'after-lease-transition-lock') return;",
    "    writeFileSync(readyPath, 'ready\\n');",
    '    const deadline = Date.now() + 20_000;',
    '    while (!existsSync(goPath)) {',
    "      if (Date.now() >= deadline) throw new Error('transition barrier timeout');",
    '      Atomics.wait(signal, 0, 0, 10);',
    '    }',
    '  },',
    '});',
    'let result;',
    "if (action === 'plan') result = manager.setPlannedGeneration(lease, plannedId);",
    "else if (action === 'consume') result = manager.markConsuming(lease);",
    "else if (action === 'release') result = manager.markReleased(lease);",
    "else if (action === 'current') result = manager.publishCurrent(lease, generation);",
    "else if (action === 'export') result = manager.publishExport(lease, generation);",
    "else throw new Error(`unknown transition action: ${action}`);",
    'process.stdout.write(JSON.stringify(result));',
  ].join('\n'));
  return childScript;
}

function spawnHeldTransition(options: {
  childScript: string;
  root: string;
  action: LeaseTransitionAction;
  lease: DockerContextLease;
  generation?: DockerContextGeneration;
  plannedId: string;
  readyPath: string;
  goPath: string;
  pid: number;
}): Promise<DockerContextLease> {
  const child = spawn(
    tsxCommand.command,
    [
      ...tsxCommand.argsPrefix,
      options.childScript,
      options.root,
      options.action,
      JSON.stringify(options.lease),
      JSON.stringify(options.generation ?? null),
      options.plannedId,
      options.readyPath,
      options.goPath,
      String(options.pid),
    ],
    { cwd: options.root, stdio: ['ignore', 'pipe', 'pipe'], ...tsxExecOptions },
  );
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  return new Promise<DockerContextLease>((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(
          `held transition failed code=${String(code)} signal=${String(signal)}: ${stderr}`,
        ));
        return;
      }
      resolvePromise(JSON.parse(stdout) as DockerContextLease);
    });
  });
}

function runLeaseTransition(
  manager: DockerContextGenerationManager,
  action: LeaseTransitionAction,
  lease: DockerContextLease,
  generation: DockerContextGeneration | undefined,
  plannedId: string,
): DockerContextLease {
  if (action === 'plan') return manager.setPlannedGeneration(lease, plannedId);
  if (action === 'consume') return manager.markConsuming(lease);
  if (action === 'release') return manager.markReleased(lease);
  if (action === 'current') return manager.publishCurrent(lease, generation!);
  return manager.publishExport(lease, generation!);
}

beforeEach(() => {
  projectDir = join(
    tmpdir(),
    `edgebase-docker-context-generation-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('Docker context generation manager', () => {
  it('atomically publishes one complete immutable generation and records its lease lifecycle', () => {
    const manager = createDockerContextGenerationManager(projectDir, {
      nonce: () => 'aaaaaaaaaaaaaaaa',
    });
    let lease = manager.createLease();
    lease = manager.setPlannedGeneration(lease, 'generation-a');
    const generation = manager.publishGeneration(lease, (stagingDir) => {
      writeFileSync(join(stagingDir, 'Dockerfile'), 'FROM node:22\n');
      mkdirSync(join(stagingDir, 'payload'), { recursive: true });
      writeFileSync(join(stagingDir, 'payload', 'marker.txt'), 'generation-a\n');
    });

    lease = manager.publishCurrent(lease, generation);

    expect(lease).toMatchObject({ state: 'consuming', generationId: 'generation-a' });
    expect(lstatSync(manager.paths.currentPath).isSymbolicLink()).toBe(true);
    expect(realpathSync(manager.paths.currentPath)).toBe(realpathSync(generation.path));
    expect(readFileSync(join(generation.path, 'payload', 'marker.txt'), 'utf-8'))
      .toBe('generation-a\n');
    expect(existsSync(join(
      generation.path,
      '.edgebase-docker-context-complete.json',
    ))).toBe(true);

    lease = manager.markReleased(lease);
    expect(lease.state).toBe('released');
    manager.collectGarbage();
    expect(existsSync(generation.path)).toBe(true);
  });

  it('allows planning only while preconsumer and requires a plan before consuming', () => {
    let nonceIndex = 0;
    const manager = createDockerContextGenerationManager(projectDir, {
      nonce: () => `state${String(nonceIndex += 1).padStart(11, '0')}`,
    });
    let lease = manager.createLease();
    expect(() => manager.markConsuming(lease)).toThrow(/must plan a generation/i);
    lease = manager.setPlannedGeneration(lease, 'planned-generation');
    lease = manager.markConsuming(lease);
    expect(() => manager.setPlannedGeneration(lease, 'different-generation'))
      .toThrow(/only a preconsumer lease can plan/i);
  });

  it('keeps generation assignment immutable across the one-way lease lifecycle', () => {
    const manager = createDockerContextGenerationManager(projectDir, {
      nonce: () => 'immutable-state',
    });
    const stalePreconsumer = manager.createLease();
    const unplannedBytes = readFileSync(stalePreconsumer.ownerPath);

    expect(() => manager.markConsuming(stalePreconsumer))
      .toThrow(/must plan a generation before consuming/i);
    expect(readFileSync(stalePreconsumer.ownerPath)).toEqual(unplannedBytes);

    let lease = manager.setPlannedGeneration(stalePreconsumer, 'immutable-generation');
    const plannedBytes = readFileSync(lease.ownerPath);
    for (const generationId of ['immutable-generation', 'changed-generation']) {
      expect(() => manager.setPlannedGeneration(stalePreconsumer, generationId), generationId)
        .toThrow(/generation is already planned and cannot be repeated/i);
      expect(readFileSync(lease.ownerPath), generationId).toEqual(plannedBytes);
    }

    lease = manager.markConsuming(stalePreconsumer);
    const consumingBytes = readFileSync(lease.ownerPath);
    for (const generationId of ['immutable-generation', 'post-consume-generation']) {
      expect(() => manager.setPlannedGeneration(stalePreconsumer, generationId), generationId)
        .toThrow(/only a preconsumer lease can plan/i);
      expect(readFileSync(lease.ownerPath), generationId).toEqual(consumingBytes);
    }
    expect(() => manager.markConsuming(stalePreconsumer))
      .toThrow(/only a preconsumer lease can begin consuming/i);
    expect(readFileSync(lease.ownerPath)).toEqual(consumingBytes);

    lease = manager.markReleased(stalePreconsumer);
    const releasedBytes = readFileSync(lease.ownerPath);
    for (const transition of [
      () => manager.setPlannedGeneration(stalePreconsumer, 'reversed-generation'),
      () => manager.markConsuming(stalePreconsumer),
      () => manager.markReleased(stalePreconsumer),
    ]) {
      expect(transition).toThrow(/lease is already released/i);
      expect(readFileSync(lease.ownerPath)).toEqual(releasedBytes);
    }
  });

  it('publishes sixteen concurrent invocation generations without sharing or hybridizing payloads', { timeout: 60_000 }, async () => {
    const readyDir = join(projectDir, 'ready');
    const goPath = join(projectDir, 'go');
    const childScript = join(projectDir, 'publish-generation.mts');
    mkdirSync(readyDir, { recursive: true });
    const moduleUrl = pathToFileURL(
      resolve(cliPackageDir, 'src', 'lib', 'docker-context-generation.ts'),
    ).href;
    writeFileSync(childScript, [
      "import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      `import { createDockerContextGenerationManager } from ${JSON.stringify(moduleUrl)};`,
      'const [projectDir, index, readyDir, goPath] = process.argv.slice(2);',
      "writeFileSync(join(readyDir, index), 'ready\\n');",
      'const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));',
      'const deadline = Date.now() + 20_000;',
      'while (!existsSync(goPath)) {',
      "  if (Date.now() >= deadline) throw new Error('barrier timeout');",
      '  Atomics.wait(signal, 0, 0, 10);',
      '}',
      'const manager = createDockerContextGenerationManager(projectDir);',
      'let lease = manager.createLease();',
      "const generationId = `generation-${index}`;",
      'lease = manager.setPlannedGeneration(lease, generationId);',
      'const generation = manager.publishGeneration(lease, (stagingDir) => {',
      "  writeFileSync(join(stagingDir, 'Dockerfile'), 'FROM node:22\\n');",
      "  const payloadDir = join(stagingDir, 'payload');",
      '  mkdirSync(payloadDir, { recursive: true });',
      '  for (let item = 0; item < 32; item += 1) {',
      "    writeFileSync(join(payloadDir, `file-${item}.txt`), `${generationId}:${item}\\n`);",
      '  }',
      '});',
      'lease = manager.publishCurrent(lease, generation);',
      "for (const entry of readdirSync(join(generation.path, 'payload'))) {",
      "  const content = readFileSync(join(generation.path, 'payload', entry), 'utf-8');",
      "  if (!content.startsWith(`${generationId}:`)) throw new Error('hybrid payload');",
      '}',
      'manager.markReleased(lease);',
      'process.stdout.write(`${generation.id}\\n`);',
    ].join('\n'));

    const children = Array.from({ length: 16 }, (_, index) => {
      const child = spawn(
        tsxCommand.command,
        [...tsxCommand.argsPrefix, childScript, projectDir, String(index), readyDir, goPath],
        { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'], ...tsxExecOptions },
      );
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
      return new Promise<string>((resolvePromise, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
          if (code !== 0) {
            reject(new Error(`child ${index} failed code=${String(code)} signal=${String(signal)}: ${stderr}`));
            return;
          }
          resolvePromise(stdout.trim());
        });
      });
    });
    await waitFor(() => readdirSync(readyDir).length === 16);
    writeFileSync(goPath, 'go\n');
    const ids = await Promise.all(children);

    expect(new Set(ids).size).toBe(16);
    const manager = createDockerContextGenerationManager(projectDir);
    const generationEntries = readdirSync(manager.paths.generationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(generationEntries).toEqual(
      Array.from({ length: 16 }, (_, index) => `generation-${index}`).sort(),
    );
    for (const generationId of generationEntries) {
      const payloadDir = join(manager.paths.generationsDir, generationId, 'payload');
      expect(
        readdirSync(payloadDir).every((entry) => (
          readFileSync(join(payloadDir, entry), 'utf-8').startsWith(`${generationId}:`)
        )),
      ).toBe(true);
    }
    expect(lstatSync(manager.paths.currentPath).isSymbolicLink()).toBe(true);
    expect(generationEntries).toContain(
      readFileSync(
        join(realpathSync(manager.paths.currentPath), '.edgebase-docker-context-complete.json'),
        'utf-8',
      ).match(/"generationId":"([^"]+)"/)?.[1],
    );
    expect(readdirSync(manager.paths.stagingDir)).toEqual([]);
  });

  it('serializes every same-lease transition collision across real processes', { timeout: 60_000 }, async () => {
    const childScript = writeHeldTransitionChildScript(projectDir);
    const ownerPid = 424_242;
    const scenarios: Array<{
      label: string;
      holder: LeaseTransitionAction;
      contender: LeaseTransitionAction;
      setup: 'planned' | 'unplanned';
      expectedState: 'preconsumer' | 'consuming' | 'released';
      expectedPointer?: 'current' | 'export';
    }> = [
      { label: 'consume-before-release', holder: 'consume', contender: 'release', setup: 'planned', expectedState: 'consuming' },
      { label: 'release-before-consume', holder: 'release', contender: 'consume', setup: 'planned', expectedState: 'released' },
      { label: 'current-before-release', holder: 'current', contender: 'release', setup: 'planned', expectedState: 'consuming', expectedPointer: 'current' },
      { label: 'release-before-current', holder: 'release', contender: 'current', setup: 'planned', expectedState: 'released' },
      { label: 'export-before-release', holder: 'export', contender: 'release', setup: 'planned', expectedState: 'consuming', expectedPointer: 'export' },
      { label: 'release-before-export', holder: 'release', contender: 'export', setup: 'planned', expectedState: 'released' },
      { label: 'plan-before-release', holder: 'plan', contender: 'release', setup: 'unplanned', expectedState: 'preconsumer' },
      { label: 'release-before-plan', holder: 'release', contender: 'plan', setup: 'unplanned', expectedState: 'released' },
    ];

    for (const scenario of scenarios) {
      const root = join(projectDir, scenario.label);
      mkdirSync(root, { recursive: true });
      const manager = createDockerContextGenerationManager(root, {
        pid: ownerPid,
        nonce: () => 'transition-owner',
      });
      const generationId = `${scenario.label}-generation`;
      const plannedId = `${scenario.label}-planned`;
      let lease: DockerContextLease;
      let generation: DockerContextGeneration | undefined;
      if (scenario.setup === 'planned') {
        const item = createGeneration(manager, generationId);
        lease = item.lease;
        generation = item.generation;
      } else {
        lease = manager.createLease();
      }
      const readyPath = join(root, 'holder-ready');
      const goPath = join(root, 'holder-go');
      const held = spawnHeldTransition({
        childScript,
        root,
        action: scenario.holder,
        lease,
        generation,
        plannedId,
        readyPath,
        goPath,
        pid: ownerPid,
      });
      await waitFor(() => existsSync(readyPath));

      let collision: unknown;
      try {
        runLeaseTransition(manager, scenario.contender, lease, generation, plannedId);
      } catch (error) {
        collision = error;
      }
      writeFileSync(goPath, 'go\n');
      const winner = await held;

      expect(collision, scenario.label).toBeInstanceOf(Error);
      expect(String(collision), scenario.label).toMatch(/transition.*active/i);
      const record = JSON.parse(readFileSync(lease.ownerPath, 'utf-8')) as {
        state: string;
        generationId?: string;
      };
      expect(record.state, scenario.label).toBe(scenario.expectedState);
      expect(winner.state, scenario.label).toBe(scenario.expectedState);
      const expectedGenerationId = scenario.setup === 'planned'
        ? generationId
        : scenario.holder === 'plan' ? plannedId : undefined;
      expect(record.generationId, scenario.label).toBe(expectedGenerationId);
      expect(winner.generationId, scenario.label).toBe(expectedGenerationId);

      for (const kind of ['current', 'export'] as const) {
        const pointerPath = kind === 'current' ? manager.paths.currentPath : manager.paths.exportPath;
        if (scenario.expectedPointer === kind) {
          expect(realpathSync(pointerPath), scenario.label).toBe(realpathSync(generation!.path));
          const marker = JSON.parse(readFileSync(
            join(realpathSync(pointerPath), '.edgebase-docker-context-complete.json'),
            'utf-8',
          )) as { leaseId: string; generationId: string };
          expect(marker, scenario.label).toMatchObject({
            leaseId: lease.id,
            generationId,
          });
        } else {
          expect(existsSync(pointerPath), scenario.label).toBe(false);
        }
      }
      expect(readdirSync(manager.paths.transitionsDir), scenario.label).toEqual([]);

      if (scenario.expectedState === 'released') {
        expect(() => manager.markConsuming(lease), scenario.label).toThrow(/released/i);
        expect(() => manager.markReleased(lease), scenario.label).toThrow(/released/i);
      } else if (scenario.expectedState === 'consuming') {
        expect(() => manager.markConsuming(lease), scenario.label).toThrow(/preconsumer/i);
      } else {
        expect(() => manager.setPlannedGeneration(lease, `${plannedId}-repeat`), scenario.label)
          .toThrow(/already planned|repeated/i);
      }
    }
  });

  it('keeps different lease transitions concurrent while one process holds another key', { timeout: 30_000 }, async () => {
    const childScript = writeHeldTransitionChildScript(projectDir);
    const root = join(projectDir, 'different-lease-keys');
    mkdirSync(root, { recursive: true });
    const ownerPid = 424_243;
    let nonceIndex = 0;
    const manager = createDockerContextGenerationManager(root, {
      pid: ownerPid,
      nonce: () => `key${String(nonceIndex += 1).padStart(13, '0')}`,
    });
    const heldItem = createGeneration(manager, 'held-key-generation');
    const independentItem = createGeneration(manager, 'independent-key-generation');
    const readyPath = join(root, 'holder-ready');
    const goPath = join(root, 'holder-go');
    const held = spawnHeldTransition({
      childScript,
      root,
      action: 'release',
      lease: heldItem.lease,
      generation: heldItem.generation,
      plannedId: 'unused-plan',
      readyPath,
      goPath,
      pid: ownerPid,
    });
    await waitFor(() => existsSync(readyPath));

    const independent = manager.markConsuming(independentItem.lease);
    expect(independent).toMatchObject({
      state: 'consuming',
      generationId: independentItem.generation.id,
    });
    expect(existsSync(goPath)).toBe(false);
    writeFileSync(goPath, 'go\n');
    const released = await held;

    expect(released.state).toBe('released');
    expect(JSON.parse(readFileSync(heldItem.lease.ownerPath, 'utf-8'))).toMatchObject({
      state: 'released',
      generationId: heldItem.generation.id,
    });
    expect(JSON.parse(readFileSync(independentItem.lease.ownerPath, 'utf-8'))).toMatchObject({
      state: 'consuming',
      generationId: independentItem.generation.id,
    });
    expect(readdirSync(manager.paths.transitionsDir)).toEqual([]);
  });

  it.each([
    { state: 'preconsumer', ageHours: 24 },
    { state: 'preconsumer', ageHours: 25 },
    { state: 'consuming', ageHours: 24 },
    { state: 'consuming', ageHours: 25 },
  ] as const)(
    'preserves a live $state lease at $ageHours-hour age without age revocation',
    ({ state, ageHours }) => {
      const ownerPid = 424_240;
      const collectorPid = 424_241;
      let ownerNonceIndex = 0;
      const owner = createDockerContextGenerationManager(projectDir, {
        pid: ownerPid,
        processIsAlive: () => true,
        nonce: () => `held${String(ownerNonceIndex += 1).padStart(11, '0')}`,
      });
      const held = createGeneration(owner, `held-${state}-${ageHours}`);
      const lease = state === 'consuming'
        ? owner.markConsuming(held.lease)
        : held.lease;
      const old = new Date(Date.now() - ageHours * 60 * 60 * 1_000);
      utimesSync(lease.ownerPath, old, old);
      const heldBytes = readFileSync(lease.ownerPath);

      const probes: number[] = [];
      const collector = createDockerContextGenerationManager(projectDir, {
        pid: collectorPid,
        processIsAlive(pid) {
          probes.push(pid);
          return pid === ownerPid || pid === collectorPid;
        },
        nonce: () => `collector-${state}-${ageHours}`,
      });
      const competingLease = collector.createLease();
      expect(readFileSync(lease.ownerPath)).toEqual(heldBytes);

      collector.collectGarbage();

      expect(probes).toContain(ownerPid);
      expect(existsSync(held.generation.path)).toBe(true);
      expect(readFileSync(lease.ownerPath)).toEqual(heldBytes);
      expect(existsSync(competingLease.ownerPath)).toBe(true);
    },
  );

  it('reclaims a dead preconsumer generation but never an aged dead consuming generation', () => {
    let nonceIndex = 0;
    const deadManager = createDockerContextGenerationManager(projectDir, {
      pid: 2_147_483_647,
      processIsAlive: () => false,
      nonce: () => `dead${String(nonceIndex += 1).padStart(12, '0')}`,
    });
    const preconsumer = createGeneration(deadManager, 'dead-preconsumer');
    const consuming = createGeneration(deadManager, 'dead-consuming');
    const consumingLease = deadManager.markConsuming(consuming.lease);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    utimesSync(consumingLease.ownerPath, old, old);

    deadManager.collectGarbage();

    expect(existsSync(preconsumer.generation.path)).toBe(false);
    expect(existsSync(preconsumer.lease.ownerPath)).toBe(false);
    expect(existsSync(consuming.generation.path)).toBe(true);
    expect(existsSync(consumingLease.ownerPath)).toBe(true);
  });

  it('fails closed at the malformed and dead-consuming orphan cap', () => {
    const malformedManager = createDockerContextGenerationManager(projectDir, {
      orphanCap: 1,
      nonce: () => 'malformed0000001',
    });
    writeFileSync(join(malformedManager.paths.leasesDir, 'malformed.json'), '{');
    expect(() => malformedManager.createLease()).toThrow(/safety cap is 1/i);

    rmSync(join(malformedManager.paths.leasesDir, 'malformed.json'), { force: true });
    const deadManager = createDockerContextGenerationManager(projectDir, {
      orphanCap: 1,
      pid: 2_147_483_647,
      processIsAlive: () => false,
      nonce: () => 'deadconsuming001',
    });
    let lease = deadManager.createLease();
    lease = deadManager.setPlannedGeneration(lease, 'orphan-generation');
    const workPath = deadManager.allocateBundleWork(lease);
    writeFileSync(join(workPath, 'payload.txt'), 'preserve\n');
    deadManager.markConsuming(lease);
    expect(() => deadManager.createLease()).toThrow(/safety cap is 1/i);
    expect(readFileSync(join(workPath, 'payload.txt'), 'utf-8')).toBe('preserve\n');
  });

  it('atomically replaces the single export pin and collects only the released unpinned generation', () => {
    let nonceIndex = 0;
    const manager = createDockerContextGenerationManager(projectDir, {
      nonce: () => `export${String(nonceIndex += 1).padStart(10, '0')}`,
    });
    const first = createGeneration(manager, 'export-first');
    first.lease = manager.publishExport(first.lease, first.generation);
    manager.markReleased(first.lease);
    const second = createGeneration(manager, 'export-second');
    second.lease = manager.publishExport(second.lease, second.generation);
    manager.markReleased(second.lease);

    manager.collectGarbage();

    expect(existsSync(first.generation.path)).toBe(false);
    expect(existsSync(second.generation.path)).toBe(true);
    expect(realpathSync(manager.paths.exportPath)).toBe(realpathSync(second.generation.path));
  });

  it('keeps the prior current generation through invalid population and publication faults', () => {
    let nonceIndex = 0;
    const manager = createDockerContextGenerationManager(projectDir, {
      nonce: () => `prior${String(nonceIndex += 1).padStart(11, '0')}`,
    });
    const prior = createGeneration(manager, 'prior-generation', 'prior');
    prior.lease = manager.publishCurrent(prior.lease, prior.generation);

    let invalidLease = manager.createLease();
    invalidLease = manager.setPlannedGeneration(invalidLease, 'invalid-generation');
    expect(() => manager.publishGeneration(invalidLease, () => {
      throw new Error('invalid source');
    })).toThrow('invalid source');
    expect(realpathSync(manager.paths.currentPath)).toBe(realpathSync(prior.generation.path));

    const faulting = createDockerContextGenerationManager(projectDir, {
      nonce: () => 'fault00000000001',
      faultInjector(point) {
        if (point === 'after-generation-rename') throw new Error('synthetic publish fault');
      },
    });
    let faultLease = faulting.createLease();
    faultLease = faulting.setPlannedGeneration(faultLease, 'fault-generation');
    expect(() => faulting.publishGeneration(faultLease, (stagingDir) => {
      writeFileSync(join(stagingDir, 'Dockerfile'), 'FROM node:22\n');
    })).toThrow('synthetic publish fault');
    expect(realpathSync(manager.paths.currentPath)).toBe(realpathSync(prior.generation.path));
    expect(readFileSync(join(prior.generation.path, 'payload', 'marker.txt'), 'utf-8'))
      .toBe('prior\n');
  });

  it.each(
    (['current', 'export'] as const).flatMap((pointerKind) => [
      ['population', 'callback-error'] as const,
      ...([
        'after-staging-populated',
        'after-complete-marker',
        'before-generation-commit',
        'after-generation-rename',
      ] as const).map((point) => ['generation', point] as const),
      ...([
        'after-atomic-preparation-owner',
        'after-atomic-preparation-operation',
        'after-atomic-preparation-record',
        'after-atomic-owner-publication',
        'after-atomic-temporary-pointer-created',
        'after-atomic-temporary-pointer',
        'after-atomic-cleanup-first-removal',
      ] as const).map((point) => ['pointer', point] as const),
    ].map(([phase, point]) => [pointerKind, phase, point] as const)),
  )(
    'keeps one complete %s pointer through %s crash at %s',
    (pointerKind, phase, faultPoint) => {
      const isolatedProject = join(projectDir, `${pointerKind}-${phase}-${faultPoint}`);
      mkdirSync(isolatedProject, { recursive: true });
      const seed = createDockerContextGenerationManager(isolatedProject);
      const prior = createGeneration(seed, `${pointerKind}-${phase}-${faultPoint}-prior`, 'prior');
      prior.lease = pointerKind === 'current'
        ? seed.publishCurrent(prior.lease, prior.generation)
        : seed.publishExport(prior.lease, prior.generation);
      const pointerPath = pointerKind === 'current'
        ? seed.paths.currentPath
        : seed.paths.exportPath;
      let replacement: ReturnType<typeof createGeneration> | undefined;

      if (phase === 'population') {
        let lease = seed.createLease();
        lease = seed.setPlannedGeneration(
          lease,
          `${pointerKind}-${phase}-${faultPoint}-replacement`,
        );
        expect(() => seed.publishGeneration(lease, () => {
          throw new Error('synthetic invalid population');
        })).toThrow('synthetic invalid population');
      } else if (phase === 'generation') {
        const faulting = createDockerContextGenerationManager(isolatedProject, {
          faultInjector(point) {
            if (point === faultPoint) throw new Error(`synthetic ${faultPoint}`);
          },
        });
        let lease = faulting.createLease();
        lease = faulting.setPlannedGeneration(
          lease,
          `${pointerKind}-${phase}-${faultPoint}-replacement`,
        );
        expect(() => faulting.publishGeneration(lease, (stagingDir) => {
          writeFileSync(join(stagingDir, 'Dockerfile'), 'FROM replacement\n');
        })).toThrow();
      } else {
        replacement = createGeneration(
          seed,
          `${pointerKind}-${phase}-${faultPoint}-replacement`,
          'replacement',
        );
        const faulting = createDockerContextGenerationManager(isolatedProject, {
          faultInjector(point) {
            if (point === faultPoint) throw new Error(`synthetic ${faultPoint}`);
          },
        });
        expect(() => (
          pointerKind === 'current'
            ? faulting.publishCurrent(replacement!.lease, replacement!.generation)
            : faulting.publishExport(replacement!.lease, replacement!.generation)
        )).toThrow();
      }

      const pointedGeneration = realpathSync(pointerPath);
      const pointerAdvanced = phase === 'pointer'
        && faultPoint === 'after-atomic-cleanup-first-removal';
      expect(pointedGeneration).toBe(realpathSync(
        pointerAdvanced ? replacement!.generation.path : prior.generation.path,
      ));
      expect(readFileSync(
        join(pointedGeneration, 'payload', 'marker.txt'),
        'utf-8',
      )).toBe(pointerAdvanced ? 'replacement\n' : 'prior\n');
      expect(existsSync(join(
        pointedGeneration,
        '.edgebase-docker-context-complete.json',
      ))).toBe(true);
      expect(existsSync(prior.generation.path)).toBe(true);
      expect(realpathSync(pointerPath).startsWith(realpathSync(seed.paths.stagingDir)))
        .toBe(false);
    },
  );

  it.each([
    'after-legacy-marker',
    'after-legacy-record',
    'after-legacy-rename',
    'after-legacy-pointer',
  ] as const)('recovers the complete legacy real-directory current after %s', (faultPoint) => {
    const isolatedProject = join(projectDir, faultPoint);
    const legacyCurrent = join(isolatedProject, '.edgebase', 'targets', 'docker-context');
    mkdirSync(join(legacyCurrent, 'payload'), { recursive: true });
    writeFileSync(join(legacyCurrent, 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(join(legacyCurrent, 'payload', 'marker.txt'), 'legacy-prior\n');
    const faulting = createDockerContextGenerationManager(isolatedProject, {
      faultInjector(point) {
        if (point === faultPoint) throw new Error(`synthetic ${faultPoint}`);
      },
    });
    expect(() => faulting.recoverLegacyCurrent()).toThrow(`synthetic ${faultPoint}`);

    const recoveredManager = createDockerContextGenerationManager(isolatedProject);
    const recovered = recoveredManager.recoverLegacyCurrent();

    expect(recovered?.id).toBe('legacy-v0');
    expect(lstatSync(recoveredManager.paths.currentPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(
      join(realpathSync(recoveredManager.paths.currentPath), 'payload', 'marker.txt'),
      'utf-8',
    )).toBe('legacy-prior\n');
    expect(existsSync(recoveredManager.paths.legacyMigrationPath)).toBe(false);
    expect(readdirSync(recoveredManager.paths.atomicDir)).toEqual([]);
  });

  it('preserves nested metadata added after legacy rename while recovering it', () => {
    const isolatedProject = join(projectDir, 'legacy-active-metadata');
    const legacyCurrent = join(isolatedProject, '.edgebase', 'targets', 'docker-context');
    const metadataPaths = [
      '.DS_Store',
      join('.edgebase', '.DS_Store'),
      join('.edgebase', 'runtime', '.DS_Store'),
      join('.edgebase', 'runtime', 'server', '.DS_Store'),
      join('.edgebase', 'targets', '.DS_Store'),
      join('.edgebase', 'targets', 'docker-app', '.DS_Store'),
    ];
    for (const relativePath of metadataPaths) {
      mkdirSync(dirname(join(legacyCurrent, relativePath)), { recursive: true });
    }
    for (const relativePath of metadataPaths.slice(0, -1)) {
      writeFileSync(join(legacyCurrent, relativePath), 'legacy metadata\n');
    }
    writeFileSync(join(legacyCurrent, 'Dockerfile'), 'FROM node:22\n');

    let injected = false;
    const faulting = createDockerContextGenerationManager(isolatedProject, {
      faultInjector(point) {
        if (point !== 'after-legacy-rename' || injected) return;
        injected = true;
        writeFileSync(
          join(faulting.paths.legacyRecoveryPath, metadataPaths.at(-1) as string),
          'late metadata\n',
        );
      },
    });
    const recovered = faulting.recoverLegacyCurrent();

    expect(injected).toBe(true);
    expect(recovered?.id).toBe('legacy-v0');
    expect(lstatSync(faulting.paths.currentPath).isSymbolicLink()).toBe(true);
    for (const [index, relativePath] of metadataPaths.entries()) {
      expect(readFileSync(
        join(realpathSync(faulting.paths.currentPath), relativePath),
        'utf-8',
      )).toBe(index === metadataPaths.length - 1 ? 'late metadata\n' : 'legacy metadata\n');
    }
    expect(existsSync(faulting.paths.legacyMigrationPath)).toBe(false);
    expect(readdirSync(faulting.paths.atomicDir)).toEqual([]);
  });
});
