import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES,
  MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST,
  computeSelfHostScheduleManifestDigest,
  createSelfHostScheduleSupervisor,
  dispatchSelfHostScheduleBatch,
  reconcileSelfHostScheduleState,
  runSelfHostSchedulePass,
  validateSelfHostAppManifest,
  validateSelfHostScheduleState,
  writeSelfHostScheduleStateAtomic,
  type SelfHostManagedScheduleEntry,
  type SelfHostManagedSchedulePayload,
  type SelfHostScheduleBoundary,
  type SelfHostScheduleState,
  type SelfHostScheduleStateStore,
  type ValidatedSelfHostAppManifest,
} from '../src/lib/self-host-schedule-supervisor.js';

const cleanupPaths: string[] = [];
const CONTROL_SECRET = 'a'.repeat(64);
const APP_GENERATION: `sha256:${string}` = `sha256:${'9'.repeat(64)}`;

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function selfHostRuntimeManifest() {
  const assets = {
    gateway: {
      path: '.edgebase/self-host/self-host-gateway.mjs',
      digest: `sha256:${'1'.repeat(64)}`,
      bytes: 1,
    },
    scheduleSupervisor: {
      path: '.edgebase/self-host/self-host-schedule-supervisor.mjs',
      digest: `sha256:${'2'.repeat(64)}`,
      bytes: 1,
    },
    dockerEntrypoint: {
      path: '.edgebase/self-host/self-host-docker-entrypoint.mjs',
      digest: `sha256:${'3'.repeat(64)}`,
      bytes: 1,
    },
  } as const;
  return {
    schemaVersion: 1,
    generation: sha256(JSON.stringify({ schemaVersion: 1, assets })),
    ...assets,
  } as const;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function appEntry(
  route: string,
  cron = '* * * * *',
  exportName = 'default',
): SelfHostManagedScheduleEntry {
  return {
    id: `app-function:${route || '/'}#${exportName}`,
    cron,
    source: {
      type: 'app-function',
      route: route || '/',
      file: `functions/${route || 'root'}.ts`,
      exportName,
    },
  };
}

function buildManifest(
  entries: SelfHostManagedScheduleEntry[],
  generation: `sha256:${string}` = APP_GENERATION,
): ValidatedSelfHostAppManifest {
  const sortedEntries = [...entries].sort((left, right) => {
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return left.cron < right.cron ? -1 : left.cron > right.cron ? 1 : 0;
  });
  const payload: SelfHostManagedSchedulePayload = {
    schemaVersion: 1,
    timezone: 'UTC',
    entries: sortedEntries,
    crons: [...new Set(sortedEntries.map((entry) => entry.cron))].sort(),
  };
  return validateSelfHostAppManifest({
    schemaVersion: 1,
    format: 'app-bundle',
    generation,
    schedules: {
      ...payload,
      digest: computeSelfHostScheduleManifestDigest(payload),
    },
    selfHost: selfHostRuntimeManifest(),
  });
}

function cloneState(state: SelfHostScheduleState | null): SelfHostScheduleState | null {
  return state === null ? null : structuredClone(state);
}

function createMemoryStateStore(initial: SelfHostScheduleState | null = null): {
  store: SelfHostScheduleStateStore;
  current(): SelfHostScheduleState | null;
  writes(): number;
} {
  let state = cloneState(initial);
  let writeCount = 0;
  return {
    store: {
      async read() {
        return cloneState(state);
      },
      async write(_path, nextState) {
        writeCount += 1;
        state = cloneState(nextState);
      },
    },
    current: () => cloneState(state),
    writes: () => writeCount,
  };
}

function wireOutcome(
  boundary: SelfHostScheduleBoundary,
  status: 'succeeded' | 'failed' | 'timed_out' | 'duplicate' | 'in_flight' | 'uncertain' = 'succeeded',
) {
  return {
    cron: boundary.cron,
    scheduledTime: boundary.scheduledTime,
    itemId: boundary.targetId,
    lane: 'app-function' as const,
    status,
    attempt: 1,
    executed: status === 'succeeded' || status === 'failed' || status === 'timed_out',
    retryable: status !== 'succeeded' && status !== 'duplicate',
    ...(status === 'failed' ? { error: 'synthetic failure' } : {}),
  };
}

function successResponse(
  manifest: ValidatedSelfHostAppManifest,
  boundaries: SelfHostScheduleBoundary[],
  outcomes = boundaries.map((boundary) => wireOutcome(boundary)),
): Response {
  return Response.json({
    schemaVersion: 2,
    outcome: 'ok',
    complete: true,
    generation: manifest.generation,
    scheduleDigest: manifest.schedules.digest,
    outcomes,
  });
}

function boundariesFromRequest(body: unknown): SelfHostScheduleBoundary[] {
  const request = body as {
    envelopes: Array<{
      cron: string;
      scheduledTime: number;
      targets: Array<{ id: string; mode: 'execute' | 'reconcile' }>;
    }>;
  };
  return request.envelopes.flatMap((envelope) => envelope.targets.map((target) => ({
    cron: envelope.cron,
    scheduledTime: envelope.scheduledTime,
    targetId: target.id,
    mode: target.mode,
  })));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (predicate()) return;
  throw new Error('Timed out waiting for held schedule work.');
}

describe('self-host schedule manifest and durable target authority', () => {
  it('requires generation and exact canonical target identities, digest, and cron set', () => {
    const manifest = buildManifest([
      appEntry('a', '*/15 * * * *'),
      appEntry('b', '*/15 * * * *'),
      appEntry('full', '0,30 1-5/2 1,15 1-12/2 1-7'),
    ]);
    expect(manifest.schedules.crons).toEqual([
      '*/15 * * * *',
      '0,30 1-5/2 1,15 1-12/2 1-7',
    ]);

    const missingGeneration = structuredClone(manifest) as Record<string, unknown>;
    delete missingGeneration.generation;
    expect(() => validateSelfHostAppManifest(missingGeneration)).toThrow(/generation/i);

    const identityTamper = structuredClone(manifest) as unknown as {
      schedules: { entries: Array<{ id: string }> };
    };
    identityTamper.schedules.entries[0]!.id = 'app-function:/wrong#default';
    expect(() => validateSelfHostAppManifest(identityTamper)).toThrow(/\.id must be/i);

    const digestTamper = structuredClone(manifest) as unknown as {
      schedules: { digest: string };
    };
    digestTamper.schedules.digest = `sha256:${'0'.repeat(64)}`;
    expect(() => validateSelfHostAppManifest(digestTamper)).toThrow(/digest mismatch/i);

    const cronSetTamper = structuredClone(manifest) as unknown as {
      schedules: { crons: string[] };
    };
    cronSetTamper.schedules.crons.push('15 * * * *');
    expect(() => validateSelfHostAppManifest(cronSetTamper)).toThrow(/exactly equal/i);
  });

  it('preserves only an exact target identity and cron across a new bundle generation', () => {
    const now = Date.parse('2026-07-16T12:30:00.000Z');
    const retained = appEntry('retained', '*/15 * * * *');
    const first = reconcileSelfHostScheduleState(buildManifest([retained]), null, now);
    first.targets[retained.id] = {
      cron: retained.cron,
      pendingBoundary: null,
      lastSuccessfulBoundary: now,
      latestObservedBoundary: now,
      attempt: 0,
      nextAttemptAt: 0,
      mode: 'execute',
    };
    const saved = validateSelfHostScheduleState(first);

    const changedGeneration: `sha256:${string}` = `sha256:${'8'.repeat(64)}`;
    const next = reconcileSelfHostScheduleState(
      buildManifest([retained, appEntry('new')], changedGeneration),
      saved,
      now,
    );
    expect(next.generation).toBe(changedGeneration);
    expect(next.targets[retained.id]).toEqual(saved.targets[retained.id]);
    expect(next.targets['app-function:new#default']?.pendingBoundary).toBe(now);

    const changedCron = reconcileSelfHostScheduleState(
      buildManifest([appEntry('retained', '0 * * * *')], changedGeneration),
      saved,
      now,
    );
    expect(changedCron.targets[retained.id]).not.toEqual(saved.targets[retained.id]);
  });
});

describe('bounded target execution and recovery', () => {
  it('dispatches duplicate-cron targets independently with a strict concurrency ceiling', async () => {
    const entries = Array.from({ length: 7 }, (_, index) => appEntry(`target-${index}`));
    const state = createMemoryStateStore();
    let active = 0;
    let maximumActive = 0;
    const seen = new Set<string>();

    const report = await runSelfHostSchedulePass({
      manifest: buildManifest(entries),
      statePath: '/memory/schedules.json',
      stateStore: state.store,
      now: () => Date.parse('2026-07-16T12:30:00.000Z'),
      concurrency: 2,
      dispatcher: async (boundary) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        seen.add(boundary.targetId);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active -= 1;
        return wireOutcome(boundary);
      },
    });

    expect(maximumActive).toBe(2);
    expect(seen).toEqual(new Set(entries.map((entry) => entry.id)));
    expect(report.outcomes).toHaveLength(entries.length);
    expect(report.itemFailureCount).toBe(0);
  });

  it('isolates one failed target while safe same-cron siblings reach later boundaries', async () => {
    const failed = appEntry('failed');
    const healthy = appEntry('healthy');
    const manifest = buildManifest([failed, healthy]);
    const state = createMemoryStateStore();
    const firstNow = Date.parse('2026-07-16T12:30:00.000Z');

    const first = await runSelfHostSchedulePass({
      manifest,
      statePath: '/memory/schedules.json',
      stateStore: state.store,
      now: () => firstNow,
      retryBaseMs: 120_000,
      retryMaxMs: 120_000,
      dispatcher: async (boundary) => wireOutcome(
        boundary,
        boundary.targetId === failed.id ? 'failed' : 'succeeded',
      ),
    });
    expect(first.itemFailureCount).toBe(1);
    expect(first.state.targets[failed.id]?.pendingBoundary).toBe(firstNow);
    expect(first.state.targets[healthy.id]?.pendingBoundary).toBeNull();

    const calls: SelfHostScheduleBoundary[] = [];
    const second = await runSelfHostSchedulePass({
      manifest,
      statePath: '/memory/schedules.json',
      stateStore: state.store,
      now: () => firstNow + 60_000,
      retryBaseMs: 120_000,
      retryMaxMs: 120_000,
      dispatcher: async (boundary) => {
        calls.push(boundary);
        return wireOutcome(boundary);
      },
    });
    expect(calls).toEqual([{
      cron: healthy.cron,
      scheduledTime: firstNow + 60_000,
      targetId: healthy.id,
      mode: 'execute',
    }]);
    expect(second.state.targets[failed.id]?.pendingBoundary).toBe(firstNow);
    expect(second.state.targets[healthy.id]?.lastSuccessfulBoundary).toBe(firstNow + 60_000);
  });

  it('changes ambiguous work to reconcile and advances only after duplicate proof', async () => {
    const entry = appEntry('ambiguous');
    const manifest = buildManifest([entry]);
    const state = createMemoryStateStore();
    const now = Date.parse('2026-07-16T12:30:00.000Z');

    const first = await runSelfHostSchedulePass({
      manifest,
      statePath: '/memory/schedules.json',
      stateStore: state.store,
      now: () => now,
      retryBaseMs: 1,
      retryMaxMs: 1,
      dispatcher: async (boundary) => wireOutcome(boundary, 'timed_out'),
    });
    expect(first.outcomes[0]).toMatchObject({ status: 'ambiguous', runtimeStatus: 'timed_out' });
    expect(first.state.targets[entry.id]).toMatchObject({
      pendingBoundary: now,
      mode: 'reconcile',
      attempt: 1,
    });

    const calls: SelfHostScheduleBoundary[] = [];
    const second = await runSelfHostSchedulePass({
      manifest,
      statePath: '/memory/schedules.json',
      stateStore: state.store,
      now: () => now + 1,
      retryBaseMs: 1,
      retryMaxMs: 1,
      dispatcher: async (boundary) => {
        calls.push(boundary);
        return wireOutcome(boundary, 'duplicate');
      },
    });
    expect(calls[0]?.mode).toBe('reconcile');
    expect(second.state.targets[entry.id]).toMatchObject({
      pendingBoundary: null,
      lastSuccessfulBoundary: now,
      mode: 'execute',
      attempt: 0,
    });
  });
});

describe('authenticated protocol-v2 batching', () => {
  it('sends exact generation, digest, target ids and modes, then restores request order', async () => {
    const entries = [appEntry('a'), appEntry('b')];
    const manifest = buildManifest(entries);
    const boundaries: SelfHostScheduleBoundary[] = entries.map((entry, index) => ({
      cron: entry.cron,
      scheduledTime: Date.parse('2026-07-16T12:30:00.000Z'),
      targetId: entry.id,
      mode: index === 0 ? 'execute' : 'reconcile',
    }));
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        'x-edgebase-self-host-control': CONTROL_SECRET,
      });
      const body = JSON.parse(String(init?.body)) as {
        schemaVersion: number;
        generation: string;
        scheduleDigest: string;
        envelopes: unknown[];
      };
      expect(body).toMatchObject({
        schemaVersion: 2,
        generation: manifest.generation,
        scheduleDigest: manifest.schedules.digest,
      });
      expect(body.envelopes).toEqual([{
        cron: entries[0]!.cron,
        scheduledTime: boundaries[0]!.scheduledTime,
        targets: [
          { id: entries[0]!.id, mode: 'execute' },
          { id: entries[1]!.id, mode: 'reconcile' },
        ],
      }]);
      return successResponse(manifest, boundaries, [
        wireOutcome(boundaries[1]!),
        wireOutcome(boundaries[0]!),
      ]);
    });

    const outcomes = await dispatchSelfHostScheduleBatch({
      manifest,
      boundaries,
      runtimeOrigin: 'http://127.0.0.1:8788',
      controlSecret: CONTROL_SECRET,
      fetch: fetchMock as typeof fetch,
    });
    expect(outcomes.map(({ itemId }) => itemId)).toEqual(entries.map(({ id }) => id));
  });

  it.each([
    ['missing', (items: ReturnType<typeof wireOutcome>[]) => items.slice(0, 1), /omitted outcome/i],
    ['duplicate', (items: ReturnType<typeof wireOutcome>[]) => [items[0]!, items[0]!], /duplicated outcome/i],
    ['extra', (items: ReturnType<typeof wireOutcome>[], boundary: SelfHostScheduleBoundary) => [
      ...items,
      { ...wireOutcome(boundary), itemId: 'app-function:unknown#default' },
    ], /unknown outcomes/i],
  ])('rejects %s response outcomes as ambiguous', async (_name, mutate, expected) => {
    const entries = [appEntry('a'), appEntry('b')];
    const manifest = buildManifest(entries);
    const boundaries = entries.map((entry) => ({
      cron: entry.cron,
      scheduledTime: Date.parse('2026-07-16T12:30:00.000Z'),
      targetId: entry.id,
      mode: 'execute' as const,
    }));
    const items = boundaries.map((boundary) => wireOutcome(boundary));
    const outcomes = mutate(items, boundaries[0]!);
    await expect(dispatchSelfHostScheduleBatch({
      manifest,
      boundaries,
      runtimeOrigin: 'http://127.0.0.1:8788',
      controlSecret: CONTROL_SECRET,
      fetch: (async () => successResponse(manifest, boundaries, outcomes)) as typeof fetch,
    })).rejects.toThrow(expected);
  });

  it('classifies an authenticated stale generation as structural and definite', async () => {
    const manifest = buildManifest([appEntry('stale')]);
    const boundary = {
      cron: manifest.schedules.entries[0]!.cron,
      scheduledTime: Date.parse('2026-07-16T12:30:00.000Z'),
      targetId: manifest.schedules.entries[0]!.id,
      mode: 'execute' as const,
    };
    await expect(dispatchSelfHostScheduleBatch({
      manifest,
      boundaries: [boundary],
      runtimeOrigin: 'http://127.0.0.1:8788',
      controlSecret: CONTROL_SECRET,
      fetch: (async () => Response.json({ outcome: 'stale' }, { status: 409 })) as typeof fetch,
    })).rejects.toMatchObject({ structural: true, ambiguous: false });
  });

  it('rejects generation mismatch and bounded-response overflow', async () => {
    const manifest = buildManifest([appEntry('bounded')]);
    const boundary = {
      cron: manifest.schedules.entries[0]!.cron,
      scheduledTime: Date.parse('2026-07-16T12:30:00.000Z'),
      targetId: manifest.schedules.entries[0]!.id,
      mode: 'execute' as const,
    };
    const wrongGeneration = successResponse(manifest, [boundary]);
    const wrongBody = await wrongGeneration.json() as Record<string, unknown>;
    wrongBody.generation = `sha256:${'7'.repeat(64)}`;
    await expect(dispatchSelfHostScheduleBatch({
      manifest,
      boundaries: [boundary],
      runtimeOrigin: 'http://127.0.0.1:8788',
      controlSecret: CONTROL_SECRET,
      fetch: (async () => Response.json(wrongBody)) as typeof fetch,
    })).rejects.toThrow(/authority\/shape/i);

    await expect(dispatchSelfHostScheduleBatch({
      manifest,
      boundaries: [boundary],
      runtimeOrigin: 'http://127.0.0.1:8788',
      controlSecret: CONTROL_SECRET,
      fetch: (async () => new Response('{}', {
        headers: { 'content-length': String(MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES + 1) },
      })) as typeof fetch,
    })).rejects.toThrow(/unreadable bounded response/i);
  });

  it.each([1, 64, 65, 130])('drains %i targets in bounded chunks without loss', async (count) => {
    const entries = Array.from({ length: count }, (_, index) => appEntry(`chunk-${index}`));
    const manifest = buildManifest(entries);
    const requestSizes: number[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as unknown;
      const boundaries = boundariesFromRequest(request);
      requestSizes.push(boundaries.length);
      return successResponse(manifest, boundaries);
    });

    const report = await runSelfHostSchedulePass({
      manifest,
      statePath: '/memory/schedules.json',
      stateStore: createMemoryStateStore().store,
      now: () => Date.parse('2026-07-16T12:30:00.000Z'),
      runtimeOrigin: 'http://127.0.0.1:8788',
      controlSecret: CONTROL_SECRET,
      fetch: fetchMock as typeof fetch,
    });
    expect(requestSizes).toEqual(
      Array.from({ length: Math.ceil(count / MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST) },
        (_, index) => Math.min(
          MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST,
          count - index * MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST,
        )),
    );
    expect(report.outcomes).toHaveLength(count);
    expect(Object.values(report.state.targets).every(({ pendingBoundary }) => pendingBoundary === null))
      .toBe(true);
  });

  it('does not start a later chunk after abort and records every unlaunched target', async () => {
    const count = MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST + 1;
    const manifest = buildManifest(
      Array.from({ length: count }, (_, index) => appEntry(`abort-${index}`)),
    );
    const controller = new AbortController();
    let calls = 0;
    const report = await runSelfHostSchedulePass({
      manifest,
      statePath: '/memory/schedules.json',
      stateStore: createMemoryStateStore().store,
      now: () => Date.parse('2026-07-16T12:30:00.000Z'),
      runtimeOrigin: 'http://127.0.0.1:8788',
      controlSecret: CONTROL_SECRET,
      signal: controller.signal,
      fetch: (async (_input, init) => {
        calls += 1;
        const boundaries = boundariesFromRequest(JSON.parse(String(init?.body)) as unknown);
        controller.abort(new Error('stop before second chunk'));
        return successResponse(manifest, boundaries);
      }) as typeof fetch,
    });
    expect(calls).toBe(1);
    expect(report.outcomes).toHaveLength(count);
    expect(report.outcomes.filter(({ status }) => status === 'succeeded')).toHaveLength(64);
    expect(report.outcomes.filter(({ status }) => status === 'ambiguous')).toHaveLength(1);
  });
});

describe('state durability and supervisor health', () => {
  it('atomically commits owner-only state without leaving temporary files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edgebase-schedule-state-'));
    cleanupPaths.push(directory);
    const path = join(directory, 'nested', 'state.json');
    const state = reconcileSelfHostScheduleState(
      buildManifest([appEntry('durable')]),
      null,
      Date.parse('2026-07-16T12:30:00.000Z'),
    );
    await writeSelfHostScheduleStateAtomic(path, state);

    expect(validateSelfHostScheduleState(JSON.parse(await readFile(path, 'utf8')))).toEqual(state);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(directory, 'nested'))).toEqual(['state.json']);
  });

  it('reports blocked manifest authority, recovers to ready, and then stops terminally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edgebase-schedule-supervisor-'));
    cleanupPaths.push(directory);
    const manifestPath = join(directory, 'edgebase-app.json');
    await writeFile(manifestPath, '{}');

    const supervisor = createSelfHostScheduleSupervisor({
      manifestPath,
      statePath: join(directory, 'state.json'),
      dispatcher: async (boundary) => wireOutcome(boundary),
    });
    await expect(supervisor.runOnce()).rejects.toThrow();
    expect(supervisor.getStatus()).toMatchObject({
      state: 'blocked',
      structuralReady: false,
      lastError: expect.any(String),
    });

    await writeManifestFixture(directory, [appEntry('healthy')]);
    await supervisor.runOnce();
    expect(supervisor.getStatus()).toMatchObject({
      state: 'ready',
      structuralReady: true,
      itemFailureCount: 0,
      lastError: null,
    });

    await supervisor.stop({ timeoutMs: 1_000 });
    expect(supervisor.getStatus()).toMatchObject({ state: 'stopped', structuralReady: false });
    await expect(supervisor.runOnce()).rejects.toThrow(/stopped/i);
  });

  it('aborts an in-flight authenticated pass during bounded stop', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edgebase-schedule-stop-'));
    cleanupPaths.push(directory);
    const manifest = await writeManifestFixture(directory, [appEntry('held')]);
    let entered = false;
    let observedAbort = false;
    const supervisor = createSelfHostScheduleSupervisor({
      manifestPath: join(directory, 'edgebase-app.json'),
      statePath: join(directory, 'state.json'),
      runtimeOrigin: 'http://127.0.0.1:8788',
      controlSecret: CONTROL_SECRET,
      fetch: (async (_input, init) => {
        entered = true;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            observedAbort = true;
            reject(init.signal?.reason);
          }, { once: true });
        });
      }) as typeof fetch,
    });

    const pass = supervisor.runOnce();
    try {
      await waitFor(() => entered);
      await supervisor.stop({ timeoutMs: 1_000 });
      await pass;
      expect(observedAbort).toBe(true);
      expect(supervisor.getStatus()).toMatchObject({ state: 'stopped', structuralReady: false });
      expect(manifest.schedules.entries).toHaveLength(1);
    } finally {
      await supervisor.stop({ timeoutMs: 1_000 }).catch(() => undefined);
      await pass.catch(() => undefined);
    }
  });

  it('keeps stopped status terminal when non-cooperative work settles after stop timeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'edgebase-schedule-terminal-stop-'));
    cleanupPaths.push(directory);
    await writeManifestFixture(directory, [appEntry('non-cooperative')]);
    let entered = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const supervisor = createSelfHostScheduleSupervisor({
      manifestPath: join(directory, 'edgebase-app.json'),
      statePath: join(directory, 'state.json'),
      dispatcher: async (boundary) => {
        entered = true;
        await held;
        return wireOutcome(boundary);
      },
    });

    const pass = supervisor.runOnce();
    let released = false;
    try {
      await waitFor(() => entered);
      await expect(supervisor.stop({ timeoutMs: 5 })).rejects.toThrow(/did not stop/i);
      expect(supervisor.getStatus()).toMatchObject({ state: 'stopped', structuralReady: false });
      release();
      released = true;
      await pass;
      expect(supervisor.getStatus()).toMatchObject({ state: 'stopped', structuralReady: false });
      await expect(supervisor.runOnce()).rejects.toThrow(/stopped/i);
    } finally {
      if (!released) release();
      await pass.catch(() => undefined);
      await supervisor.stop({ timeoutMs: 1_000 }).catch(() => undefined);
    }
  });
});

async function writeManifestFixture(
  directory: string,
  entries: SelfHostManagedScheduleEntry[],
): Promise<ValidatedSelfHostAppManifest> {
  const selfHostDirectory = join(directory, '.edgebase', 'self-host');
  await mkdir(selfHostDirectory, { recursive: true });
  const definitions = [
    ['gateway', 'self-host-gateway.mjs', 'export const gateway = true;\n'],
    ['scheduleSupervisor', 'self-host-schedule-supervisor.mjs', 'export const supervisor = true;\n'],
    ['dockerEntrypoint', 'self-host-docker-entrypoint.mjs', 'export const entrypoint = true;\n'],
  ] as const;
  const assets: Record<string, { path: string; digest: `sha256:${string}`; bytes: number }> = {};
  for (const [name, filename, content] of definitions) {
    await writeFile(join(selfHostDirectory, filename), content);
    assets[name] = {
      path: `.edgebase/self-host/${filename}`,
      digest: sha256(content),
      bytes: Buffer.byteLength(content),
    };
  }
  const selfHost = {
    schemaVersion: 1,
    generation: sha256(JSON.stringify({ schemaVersion: 1, assets })),
    ...assets,
  };
  const sortedEntries = [...entries].sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
  const payload: SelfHostManagedSchedulePayload = {
    schemaVersion: 1,
    timezone: 'UTC',
    entries: sortedEntries,
    crons: [...new Set(sortedEntries.map(({ cron }) => cron))].sort(),
  };
  const raw = {
    schemaVersion: 1,
    format: 'app-bundle',
    generation: APP_GENERATION,
    schedules: { ...payload, digest: computeSelfHostScheduleManifestDigest(payload) },
    selfHost,
  };
  await writeFile(join(directory, 'edgebase-app.json'), `${JSON.stringify(raw, null, 2)}\n`);
  return validateSelfHostAppManifest(raw);
}
