import { createHash, randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  SYSTEM_MAINTENANCE_CRON,
  SYSTEM_MAINTENANCE_SCHEDULE_ID,
  MAX_MANAGED_SCHEDULE_ENTRIES,
  MAX_SELF_HOST_SCHEDULE_ENVELOPES_PER_REQUEST,
  MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES,
  MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES,
  MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST,
  SELF_HOST_SCHEDULE_PROTOCOL_VERSION,
  assertManagedCronWireBound,
  assertManagedScheduleTargetIdWireBound,
  appFunctionScheduleIdentity,
  extraCronScheduleIdentity,
  getPreviousFireTime,
  matchesCron,
  normalizeCronExpression,
  parseCron,
  pluginFunctionScheduleIdentity,
  utf8ByteLength,
  type SelfHostScheduleControlRequest,
  type SelfHostScheduleRequestEnvelope,
  type SelfHostScheduleRequestMode,
  type SelfHostScheduleWireOutcome,
} from '@edge-base/shared';

export const DEFAULT_SELF_HOST_SCHEDULE_CONCURRENCY = 2;
export const MAX_SELF_HOST_SCHEDULE_CONCURRENCY = 8;
export const DEFAULT_SELF_HOST_SCHEDULE_INTERVAL_MS = 15_000;
export const DEFAULT_SELF_HOST_SCHEDULE_RETRY_BASE_MS = 5_000;
export const DEFAULT_SELF_HOST_SCHEDULE_RETRY_MAX_MS = 5 * 60_000;
export const DEFAULT_SELF_HOST_SCHEDULE_REQUEST_TIMEOUT_MS = 30_000;
export {
  MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES,
  MAX_SELF_HOST_SCHEDULE_ENVELOPES_PER_REQUEST,
  MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST,
};
export const SELF_HOST_CONTROL_ROOT = '/__edgebase/internal/self-host';

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_SELF_HOST_ASSET_BYTES = 2 * 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_RECORDED_ATTEMPT = 1_000_000;
const SELF_HOST_ASSET_PATHS = Object.freeze({
  gateway: '.edgebase/self-host/self-host-gateway.mjs',
  scheduleSupervisor: '.edgebase/self-host/self-host-schedule-supervisor.mjs',
  dockerEntrypoint: '.edgebase/self-host/self-host-docker-entrypoint.mjs',
  wranglerRuntime: '.edgebase/self-host/self-host-wrangler-runtime.mjs',
  proxyWorker: '.edgebase/self-host/self-host-proxy-worker.js',
});

export type SelfHostManagedScheduleSource =
  | {
    type: 'app-function';
    route: string;
    file: string;
    exportName: string;
  }
  | {
    type: 'plugin-function';
    pluginName: string;
    functionName: string;
  }
  | {
    type: 'extra-cron';
  }
  | {
    type: 'system';
    name: 'maintenance';
  };

export interface SelfHostManagedScheduleEntry {
  id: string;
  cron: string;
  source: SelfHostManagedScheduleSource;
}

export interface SelfHostManagedSchedulePayload {
  schemaVersion: 1;
  timezone: 'UTC';
  entries: SelfHostManagedScheduleEntry[];
  crons: string[];
}

export interface SelfHostManagedScheduleManifest extends SelfHostManagedSchedulePayload {
  digest: `sha256:${string}`;
}

export interface ValidatedSelfHostAppManifest {
  schemaVersion: 1;
  format: 'app-bundle';
  generation: `sha256:${string}`;
  schedules: SelfHostManagedScheduleManifest;
  selfHost: ValidatedSelfHostRuntimeManifest;
}

export interface ValidatedSelfHostAssetManifest {
  path: string;
  digest: `sha256:${string}`;
  bytes: number;
}

export interface ValidatedSelfHostRuntimeManifest {
  schemaVersion: 1;
  generation: `sha256:${string}`;
  gateway: ValidatedSelfHostAssetManifest;
  scheduleSupervisor: ValidatedSelfHostAssetManifest;
  dockerEntrypoint: ValidatedSelfHostAssetManifest;
  wranglerRuntime: ValidatedSelfHostAssetManifest;
  proxyWorker: ValidatedSelfHostAssetManifest;
}

export interface SelfHostScheduleTargetState {
  cron: string;
  pendingBoundary: number | null;
  lastSuccessfulBoundary: number | null;
  latestObservedBoundary: number | null;
  attempt: number;
  nextAttemptAt: number;
  mode: SelfHostScheduleRequestMode;
}

export interface SelfHostScheduleState {
  schemaVersion: 2;
  generation: `sha256:${string}`;
  manifestDigest: `sha256:${string}`;
  targets: Record<string, SelfHostScheduleTargetState>;
}

export interface SelfHostScheduleBoundary {
  cron: string;
  scheduledTime: number;
  targetId: string;
  mode: SelfHostScheduleRequestMode;
}

export type SelfHostScheduleDispatcher = (
  boundary: SelfHostScheduleBoundary,
) => Promise<SelfHostScheduleWireOutcome>;

export interface SelfHostScheduleStateStore {
  read(path: string): Promise<SelfHostScheduleState | null>;
  write(path: string, state: SelfHostScheduleState): Promise<void>;
}

export interface SelfHostScheduleStateQuarantineEvent {
  path: string;
  quarantinePath: string;
  reason: string;
}

export interface ReadSelfHostScheduleStateOptions {
  onQuarantine?: (event: SelfHostScheduleStateQuarantineEvent) => void;
}

export interface DispatchSelfHostScheduleBoundaryOptions extends SelfHostScheduleBoundary {
  manifest: ValidatedSelfHostAppManifest;
  runtimeOrigin: string;
  controlSecret: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface DispatchSelfHostScheduleBatchOptions {
  manifest: ValidatedSelfHostAppManifest;
  boundaries: SelfHostScheduleBoundary[];
  runtimeOrigin: string;
  controlSecret: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface RunSelfHostSchedulePassOptions {
  manifest: unknown;
  statePath: string;
  runtimeOrigin?: string;
  controlSecret?: string;
  fetch?: typeof fetch;
  dispatcher?: SelfHostScheduleDispatcher;
  stateStore?: SelfHostScheduleStateStore;
  now?: () => number;
  concurrency?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface SelfHostScheduleDispatchOutcome extends SelfHostScheduleBoundary {
  status: 'succeeded' | 'failed' | 'ambiguous';
  runtimeStatus: SelfHostScheduleWireOutcome['status'];
  attempt: number;
  nextAttemptAt: number;
  error?: string;
}

export interface SelfHostSchedulePassReport {
  generation: `sha256:${string}`;
  manifestDigest: `sha256:${string}`;
  observedAt: number;
  structuralReady: true;
  itemFailureCount: number;
  outcomes: SelfHostScheduleDispatchOutcome[];
  state: SelfHostScheduleState;
}

export interface CreateSelfHostScheduleSupervisorOptions
  extends Omit<RunSelfHostSchedulePassOptions, 'manifest'> {
  manifestPath: string;
  intervalMs?: number;
  onReport?: (report: SelfHostSchedulePassReport) => void;
  onError?: (error: unknown) => void;
}

export interface SelfHostScheduleSupervisor {
  runOnce(): Promise<SelfHostSchedulePassReport>;
  start(): void;
  getStatus(): SelfHostScheduleSupervisorStatus;
  stop(options?: { timeoutMs?: number }): Promise<void>;
  isRunning(): boolean;
}

export interface SelfHostScheduleSupervisorStatus {
  state: 'idle' | 'running' | 'ready' | 'degraded' | 'blocked' | 'stopped';
  structuralReady: boolean;
  itemFailureCount: number;
  lastAttemptAt: number | null;
  lastSuccessfulPassAt: number | null;
  lastError: string | null;
}

export interface CreateSelfHostScheduleOutcomeLoggerOptions {
  prefix?: string;
  writeInfo?: (line: string) => void;
  writeError?: (line: string) => void;
}

export interface SelfHostScheduleOutcomeLogger {
  report(report: SelfHostSchedulePassReport, options?: { initial?: boolean }): void;
}

export function createSelfHostScheduleOutcomeLogger(
  options: CreateSelfHostScheduleOutcomeLoggerOptions = {},
): SelfHostScheduleOutcomeLogger {
  const prefix = options.prefix?.trim() || '[EdgeBase]';
  const writeInfo = options.writeInfo ?? ((line: string) => process.stdout.write(`${line}\n`));
  const writeError = options.writeError ?? ((line: string) => process.stderr.write(`${line}\n`));
  const failedTargets = new Set<string>();
  let generation: string | null = null;

  return {
    report(report, { initial = false } = {}) {
      if (report.generation !== generation) {
        failedTargets.clear();
        generation = report.generation;
      }
      for (const outcome of report.outcomes) {
        const serialized = JSON.stringify(outcome);
        if (outcome.status === 'succeeded') {
          const recovered = failedTargets.delete(outcome.targetId);
          if (initial) {
            writeInfo(`${prefix} initial schedule outcome ${serialized}`);
          } else if (recovered) {
            writeInfo(`${prefix} schedule outcome recovered ${serialized}`);
          }
          continue;
        }
        failedTargets.add(outcome.targetId);
        writeError(`${prefix} schedule outcome ${outcome.status} ${serialized}`);
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`);
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${context} must contain exactly: ${expected.join(', ')}.`);
  }
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function readNonEmptyString(
  value: unknown,
  context: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty string.`);
  }
  return value;
}

function readSha256(value: unknown, context: string): `sha256:${string}` {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${context} must be a lowercase SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function readBoundary(value: unknown, context: string): number | null {
  if (value === null) return null;
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 0
    || (value as number) % 60_000 !== 0
  ) {
    throw new Error(`${context} must be null or a non-negative UTC minute boundary.`);
  }
  return value as number;
}

function readNonNegativeSafeInteger(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${context} must be a non-negative safe integer.`);
  }
  return value as number;
}

function normalizeSelfHostAsset(
  value: unknown,
  expectedPath: string,
  context: string,
): ValidatedSelfHostAssetManifest {
  const asset = assertRecord(value, context);
  assertExactKeys(asset, ['path', 'digest', 'bytes'], context);
  if (asset.path !== expectedPath) {
    throw new Error(`${context}.path must be '${expectedPath}'.`);
  }
  const bytes = readNonNegativeSafeInteger(asset.bytes, `${context}.bytes`);
  if (bytes === 0 || bytes > MAX_SELF_HOST_ASSET_BYTES) {
    throw new Error(`${context}.bytes must be between 1 and ${MAX_SELF_HOST_ASSET_BYTES}.`);
  }
  return {
    path: expectedPath,
    digest: readSha256(asset.digest, `${context}.digest`),
    bytes,
  };
}

function normalizeSelfHostRuntimeManifest(value: unknown): ValidatedSelfHostRuntimeManifest {
  const selfHost = assertRecord(value, 'edgebase-app selfHost');
  assertExactKeys(
    selfHost,
    [
      'schemaVersion',
      'generation',
      'gateway',
      'scheduleSupervisor',
      'dockerEntrypoint',
      'wranglerRuntime',
      'proxyWorker',
    ],
    'edgebase-app selfHost',
  );
  if (selfHost.schemaVersion !== 1) {
    throw new Error('edgebase-app selfHost.schemaVersion must be 1.');
  }
  const assets = {
    gateway: normalizeSelfHostAsset(
      selfHost.gateway,
      SELF_HOST_ASSET_PATHS.gateway,
      'edgebase-app selfHost.gateway',
    ),
    scheduleSupervisor: normalizeSelfHostAsset(
      selfHost.scheduleSupervisor,
      SELF_HOST_ASSET_PATHS.scheduleSupervisor,
      'edgebase-app selfHost.scheduleSupervisor',
    ),
    dockerEntrypoint: normalizeSelfHostAsset(
      selfHost.dockerEntrypoint,
      SELF_HOST_ASSET_PATHS.dockerEntrypoint,
      'edgebase-app selfHost.dockerEntrypoint',
    ),
    wranglerRuntime: normalizeSelfHostAsset(
      selfHost.wranglerRuntime,
      SELF_HOST_ASSET_PATHS.wranglerRuntime,
      'edgebase-app selfHost.wranglerRuntime',
    ),
    proxyWorker: normalizeSelfHostAsset(
      selfHost.proxyWorker,
      SELF_HOST_ASSET_PATHS.proxyWorker,
      'edgebase-app selfHost.proxyWorker',
    ),
  };
  const generation = readSha256(selfHost.generation, 'edgebase-app selfHost.generation');
  const expectedGeneration = `sha256:${createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    assets,
  })).digest('hex')}`;
  if (generation !== expectedGeneration) {
    throw new Error(
      `edgebase-app selfHost.generation mismatch: expected '${expectedGeneration}', received '${generation}'.`,
    );
  }
  return { schemaVersion: 1, generation, ...assets };
}

function cloneTargetState(state: SelfHostScheduleTargetState): SelfHostScheduleTargetState {
  return { ...state };
}

function cloneState(state: SelfHostScheduleState): SelfHostScheduleState {
  return {
    schemaVersion: 2,
    generation: state.generation,
    manifestDigest: state.manifestDigest,
    targets: Object.fromEntries(
      Object.entries(state.targets).map(([id, targetState]) => [id, cloneTargetState(targetState)]),
    ),
  };
}

function normalizeScheduleSource(
  value: unknown,
  context: string,
): SelfHostManagedScheduleSource {
  const source = assertRecord(value, context);
  const type = readNonEmptyString(source.type, `${context}.type`);

  if (type === 'app-function') {
    assertExactKeys(source, ['type', 'route', 'file', 'exportName'], context);
    return {
      type,
      route: readNonEmptyString(source.route, `${context}.route`),
      file: readNonEmptyString(source.file, `${context}.file`),
      exportName: readNonEmptyString(source.exportName, `${context}.exportName`),
    };
  }
  if (type === 'plugin-function') {
    assertExactKeys(source, ['type', 'pluginName', 'functionName'], context);
    return {
      type,
      pluginName: readNonEmptyString(source.pluginName, `${context}.pluginName`),
      functionName: readNonEmptyString(source.functionName, `${context}.functionName`),
    };
  }
  if (type === 'extra-cron') {
    assertExactKeys(source, ['type'], context);
    return { type };
  }
  if (type === 'system') {
    assertExactKeys(source, ['type', 'name'], context);
    if (source.name !== 'maintenance') {
      throw new Error(`${context}.name must be 'maintenance'.`);
    }
    return { type, name: 'maintenance' };
  }

  throw new Error(`${context}.type '${type}' is not supported by manifest schema version 1.`);
}

function expectedEntryIdentity(
  source: SelfHostManagedScheduleSource,
  cron: string,
): string {
  switch (source.type) {
    case 'app-function':
      return appFunctionScheduleIdentity(source.route, source.exportName);
    case 'plugin-function':
      return pluginFunctionScheduleIdentity(source.pluginName, source.functionName);
    case 'extra-cron':
      return extraCronScheduleIdentity(cron);
    case 'system':
      if (cron !== SYSTEM_MAINTENANCE_CRON) {
        throw new Error(
          `System maintenance must use '${SYSTEM_MAINTENANCE_CRON}', received '${cron}'.`,
        );
      }
      return SYSTEM_MAINTENANCE_SCHEDULE_ID;
  }
}

function normalizeScheduleEntry(
  value: unknown,
  index: number,
): SelfHostManagedScheduleEntry {
  const context = `edgebase-app schedules.entries[${index}]`;
  const entry = assertRecord(value, context);
  assertExactKeys(entry, ['id', 'cron', 'source'], context);
  const cronValue = readNonEmptyString(entry.cron, `${context}.cron`);
  assertManagedCronWireBound(cronValue, `${context}.cron`);
  const cron = normalizeCronExpression(cronValue);
  if (cron !== cronValue) {
    throw new Error(`${context}.cron must already be normalized as '${cron}'.`);
  }
  // Parse separately and deliberately: this is the scheduler's executable
  // grammar gate, while normalizeCronExpression also guards canonical text.
  parseCron(cron);
  const source = normalizeScheduleSource(entry.source, `${context}.source`);
  const id = readNonEmptyString(entry.id, `${context}.id`);
  assertManagedScheduleTargetIdWireBound(id, `${context}.id`);
  const expectedId = expectedEntryIdentity(source, cron);
  if (id !== expectedId) {
    throw new Error(`${context}.id must be '${expectedId}', received '${id}'.`);
  }
  return { id, cron, source };
}

function compareEntries(
  left: SelfHostManagedScheduleEntry,
  right: SelfHostManagedScheduleEntry,
): number {
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  if (left.cron !== right.cron) return left.cron < right.cron ? -1 : 1;
  return 0;
}

export function computeSelfHostScheduleManifestDigest(
  payload: SelfHostManagedSchedulePayload,
): `sha256:${string}` {
  const canonicalPayload: SelfHostManagedSchedulePayload = {
    schemaVersion: 1,
    timezone: 'UTC',
    entries: payload.entries.map((entry) => ({
      id: entry.id,
      cron: entry.cron,
      source: { ...entry.source },
    })),
    crons: [...payload.crons],
  };
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex')}`;
}

/**
 * Validate the build-owned schedule authority and reconstruct its canonical
 * payload before checking the digest. No schedule is accepted from a fallback
 * file or inferred at runtime.
 */
export function validateSelfHostAppManifest(
  value: unknown,
): ValidatedSelfHostAppManifest {
  const app = assertRecord(value, 'edgebase-app manifest');
  if (app.schemaVersion !== 1) {
    throw new Error('edgebase-app manifest schemaVersion must be 1.');
  }
  if (app.format !== 'app-bundle') {
    throw new Error("edgebase-app manifest format must be 'app-bundle'.");
  }
  const generation = readSha256(app.generation, 'edgebase-app generation');

  const schedules = assertRecord(app.schedules, 'edgebase-app schedules');
  assertExactKeys(
    schedules,
    ['schemaVersion', 'timezone', 'entries', 'crons', 'digest'],
    'edgebase-app schedules',
  );
  if (schedules.schemaVersion !== 1) {
    throw new Error('edgebase-app schedules.schemaVersion must be 1.');
  }
  if (schedules.timezone !== 'UTC') {
    throw new Error("edgebase-app schedules.timezone must be 'UTC'.");
  }
  if (!Array.isArray(schedules.entries)) {
    throw new Error('edgebase-app schedules.entries must be an array.');
  }
  if (schedules.entries.length > MAX_MANAGED_SCHEDULE_ENTRIES) {
    throw new Error(
      `edgebase-app schedules.entries exceeds ${MAX_MANAGED_SCHEDULE_ENTRIES}.`,
    );
  }
  if (!Array.isArray(schedules.crons)) {
    throw new Error('edgebase-app schedules.crons must be an array.');
  }

  const entries = schedules.entries.map(normalizeScheduleEntry);
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new Error(`edgebase-app schedules repeats identity '${entry.id}'.`);
    }
    seenIds.add(entry.id);
  }
  const sortedEntries = [...entries].sort(compareEntries);
  if (entries.some((entry, index) => entry !== sortedEntries[index])) {
    throw new Error('edgebase-app schedules.entries must use canonical identity order.');
  }

  const crons = schedules.crons.map((valueAtIndex, index) => {
    const cronValue = readNonEmptyString(
      valueAtIndex,
      `edgebase-app schedules.crons[${index}]`,
    );
    const cron = normalizeCronExpression(cronValue);
    if (cron !== cronValue) {
      throw new Error(
        `edgebase-app schedules.crons[${index}] must already be normalized as '${cron}'.`,
      );
    }
    parseCron(cron);
    return cron;
  });
  const expectedCrons = [...new Set(entries.map((entry) => entry.cron))].sort();
  if (
    crons.length !== expectedCrons.length
    || crons.some((cron, index) => cron !== expectedCrons[index])
  ) {
    throw new Error(
      'edgebase-app schedules.crons must exactly equal the sorted, deduplicated entry cron set.',
    );
  }

  const payload: SelfHostManagedSchedulePayload = {
    schemaVersion: 1,
    timezone: 'UTC',
    entries,
    crons,
  };
  const digest = readSha256(schedules.digest, 'edgebase-app schedules.digest');
  const expectedDigest = computeSelfHostScheduleManifestDigest(payload);
  if (digest !== expectedDigest) {
    throw new Error(
      `edgebase-app schedules.digest mismatch: expected '${expectedDigest}', received '${digest}'.`,
    );
  }

  const selfHost = normalizeSelfHostRuntimeManifest(app.selfHost);
  return {
    schemaVersion: 1,
    format: 'app-bundle',
    generation,
    schedules: { ...payload, digest },
    selfHost,
  };
}

class InvalidBoundedJsonFileError extends Error {}

async function readJsonFileBounded(path: string, maxBytes: number, context: string): Promise<unknown> {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) throw new Error(`${context} is not a regular file: ${path}`);
  if (fileStat.size > maxBytes) {
    throw new InvalidBoundedJsonFileError(
      `${context} exceeds the ${maxBytes}-byte limit: ${path}`,
    );
  }
  const source = await readFile(path, 'utf8');
  if (Buffer.byteLength(source) > maxBytes) {
    throw new InvalidBoundedJsonFileError(
      `${context} exceeds the ${maxBytes}-byte limit: ${path}`,
    );
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new InvalidBoundedJsonFileError(
      `${context} is not valid JSON: ${path}`,
      { cause: error },
    );
  }
}

export async function readSelfHostAppManifest(
  path: string,
): Promise<ValidatedSelfHostAppManifest> {
  const resolvedManifestPath = await realpath(path);
  const manifest = validateSelfHostAppManifest(
    await readJsonFileBounded(resolvedManifestPath, MAX_MANIFEST_BYTES, 'edgebase-app manifest'),
  );
  for (const [name, asset] of Object.entries({
    gateway: manifest.selfHost.gateway,
    scheduleSupervisor: manifest.selfHost.scheduleSupervisor,
    dockerEntrypoint: manifest.selfHost.dockerEntrypoint,
    wranglerRuntime: manifest.selfHost.wranglerRuntime,
    proxyWorker: manifest.selfHost.proxyWorker,
  })) {
    const assetPath = join(dirname(resolvedManifestPath), asset.path);
    const assetStat = await lstat(assetPath);
    if (!assetStat.isFile() || assetStat.isSymbolicLink()) {
      throw new Error(`Self-host ${name} asset is not a regular non-symlink file: ${assetPath}`);
    }
    if (assetStat.size !== asset.bytes || assetStat.size > MAX_SELF_HOST_ASSET_BYTES) {
      throw new Error(`Self-host ${name} asset byte length does not match its manifest.`);
    }
    const content = await readFile(assetPath);
    const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    if (digest !== asset.digest) {
      throw new Error(`Self-host ${name} asset digest does not match its manifest.`);
    }
  }
  return manifest;
}

function normalizeTargetState(
  value: unknown,
  context: string,
): SelfHostScheduleTargetState {
  const state = assertRecord(value, context);
  assertExactKeys(
    state,
    [
      'cron',
      'pendingBoundary',
      'lastSuccessfulBoundary',
      'latestObservedBoundary',
      'attempt',
      'nextAttemptAt',
      'mode',
    ],
    context,
  );
  const cronValue = readNonEmptyString(state.cron, `${context}.cron`);
  assertManagedCronWireBound(cronValue, `${context}.cron`);
  const cron = normalizeCronExpression(cronValue);
  if (cron !== cronValue) throw new Error(`${context}.cron must already be normalized.`);
  const pendingBoundary = readBoundary(state.pendingBoundary, `${context}.pendingBoundary`);
  const lastSuccessfulBoundary = readBoundary(
    state.lastSuccessfulBoundary,
    `${context}.lastSuccessfulBoundary`,
  );
  const latestObservedBoundary = readBoundary(
    state.latestObservedBoundary,
    `${context}.latestObservedBoundary`,
  );
  const attempt = readNonNegativeSafeInteger(state.attempt, `${context}.attempt`);
  const nextAttemptAt = readNonNegativeSafeInteger(
    state.nextAttemptAt,
    `${context}.nextAttemptAt`,
  );
  if (attempt > MAX_RECORDED_ATTEMPT) {
    throw new Error(`${context}.attempt exceeds ${MAX_RECORDED_ATTEMPT}.`);
  }
  if (state.mode !== 'execute' && state.mode !== 'reconcile') {
    throw new Error(`${context}.mode must be execute or reconcile.`);
  }
  if (pendingBoundary === null && (attempt !== 0 || nextAttemptAt !== 0)) {
    throw new Error(`${context} cannot retain retry metadata without a pending boundary.`);
  }
  if (
    pendingBoundary !== null
    && lastSuccessfulBoundary !== null
    && pendingBoundary <= lastSuccessfulBoundary
  ) {
    throw new Error(`${context}.pendingBoundary must be newer than its successful cursor.`);
  }
  if (
    pendingBoundary !== null
    && (latestObservedBoundary === null || latestObservedBoundary < pendingBoundary)
  ) {
    throw new Error(`${context}.latestObservedBoundary must cover its pending boundary.`);
  }
  if (
    latestObservedBoundary !== null
    && lastSuccessfulBoundary !== null
    && latestObservedBoundary < lastSuccessfulBoundary
  ) {
    throw new Error(`${context}.latestObservedBoundary cannot precede its successful cursor.`);
  }
  const schedule = parseCron(cron);
  for (const [name, boundary] of [
    ['pendingBoundary', pendingBoundary],
    ['lastSuccessfulBoundary', lastSuccessfulBoundary],
    ['latestObservedBoundary', latestObservedBoundary],
  ] as const) {
    if (boundary !== null && !matchesCron(new Date(boundary), schedule)) {
      throw new Error(`${context}.${name} is not a boundary of cron '${cron}'.`);
    }
  }

  return {
    cron,
    pendingBoundary,
    lastSuccessfulBoundary,
    latestObservedBoundary,
    attempt,
    nextAttemptAt,
    mode: state.mode,
  };
}

export function validateSelfHostScheduleState(value: unknown): SelfHostScheduleState {
  const state = assertRecord(value, 'self-host schedule state');
  assertExactKeys(
    state,
    ['schemaVersion', 'generation', 'manifestDigest', 'targets'],
    'self-host schedule state',
  );
  if (state.schemaVersion !== 2) {
    throw new Error('self-host schedule state schemaVersion must be 2.');
  }
  const generation = readSha256(state.generation, 'self-host schedule state generation');
  const manifestDigest = readSha256(
    state.manifestDigest,
    'self-host schedule state manifestDigest',
  );
  const targetsValue = assertRecord(state.targets, 'self-host schedule state targets');
  if (Object.keys(targetsValue).length > MAX_MANAGED_SCHEDULE_ENTRIES) {
    throw new Error(`self-host schedule state exceeds ${MAX_MANAGED_SCHEDULE_ENTRIES} targets.`);
  }
  const targets: Record<string, SelfHostScheduleTargetState> = {};
  for (const [targetId, targetState] of Object.entries(targetsValue)) {
    assertManagedScheduleTargetIdWireBound(targetId, 'self-host schedule state target id');
    targets[targetId] = normalizeTargetState(
      targetState,
      `self-host schedule state targets[${JSON.stringify(targetId)}]`,
    );
  }
  return { schemaVersion: 2, generation, manifestDigest, targets };
}

function quarantineReason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

async function quarantineInvalidSelfHostScheduleState(
  path: string,
  error: unknown,
  options: ReadSelfHostScheduleStateOptions,
): Promise<null> {
  const quarantinePath = `${path}.corrupt`;
  try {
    await unlink(quarantinePath);
  } catch (unlinkError) {
    if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `Invalid self-host schedule state could not quarantine '${path}' at '${quarantinePath}'.`,
        { cause: unlinkError },
      );
    }
  }
  try {
    await rename(path, quarantinePath);
  } catch (renameError) {
    if ((renameError as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `Invalid self-host schedule state could not quarantine '${path}' at '${quarantinePath}'.`,
      { cause: renameError },
    );
  }
  try {
    await syncParentDirectory(dirname(path));
  } catch (syncError) {
    throw new Error(
      `Invalid self-host schedule state quarantine was not durably committed at '${quarantinePath}'.`,
      { cause: syncError },
    );
  }

  const event: SelfHostScheduleStateQuarantineEvent = {
    path,
    quarantinePath,
    reason: quarantineReason(error),
  };
  const onQuarantine = options.onQuarantine ?? ((quarantine) => {
    process.stderr.write(
      `Self-host schedule state was invalid and moved to '${quarantine.quarantinePath}'; `
      + `rebuilding from durable delivery authority. Reason: ${quarantine.reason}\n`,
    );
  });
  try {
    onQuarantine(event);
  } catch {
    // A diagnostic sink cannot turn a completed quarantine back into a boot wedge.
  }
  return null;
}

export async function readSelfHostScheduleState(
  path: string,
  options: ReadSelfHostScheduleStateOptions = {},
): Promise<SelfHostScheduleState | null> {
  let value: unknown;
  try {
    value = await readJsonFileBounded(path, MAX_STATE_BYTES, 'self-host schedule state');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (!(error instanceof InvalidBoundedJsonFileError)) throw error;
    return quarantineInvalidSelfHostScheduleState(path, error, options);
  }
  try {
    return validateSelfHostScheduleState(value);
  } catch (error) {
    return quarantineInvalidSelfHostScheduleState(path, error, options);
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  let directoryHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    directoryHandle = await open(path, 'r');
    await directoryHandle.sync();
  } catch (error) {
    // Windows does not consistently permit opening/fsyncing directories. Unix
    // runtimes must complete the directory fsync before reporting persistence.
    if (process.platform !== 'win32') throw error;
  } finally {
    await directoryHandle?.close();
  }
}

/** Owner-only, same-directory, fsync-before-and-after atomic state commit. */
export async function writeSelfHostScheduleStateAtomic(
  path: string,
  value: SelfHostScheduleState,
): Promise<void> {
  const state = validateSelfHostScheduleState(value);
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let temporaryHandle: Awaited<ReturnType<typeof open>> | null = null;
  let renamed = false;
  try {
    temporaryHandle = await open(temporaryPath, 'wx', 0o600);
    await temporaryHandle.chmod(0o600);
    await temporaryHandle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = null;
    await rename(temporaryPath, path);
    renamed = true;
    await chmod(path, 0o600);
    await syncParentDirectory(parent);
  } finally {
    await temporaryHandle?.close().catch(() => undefined);
    if (!renamed) await unlink(temporaryPath).catch(() => undefined);
  }
}

export const fileSelfHostScheduleStateStore: SelfHostScheduleStateStore = {
  read: readSelfHostScheduleState,
  write: writeSelfHostScheduleStateAtomic,
};

function emptyTargetState(cron: string): SelfHostScheduleTargetState {
  return {
    cron,
    pendingBoundary: null,
    lastSuccessfulBoundary: null,
    latestObservedBoundary: null,
    attempt: 0,
    nextAttemptAt: 0,
    mode: 'execute',
  };
}

function readNow(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('Self-host schedule clock must return a non-negative safe integer.');
  }
  return now;
}

/**
 * Migrate by exact target identity and cron, then observe each target's latest
 * due minute independently. One ambiguous target therefore cannot block safe
 * siblings or their later boundaries.
 */
export function reconcileSelfHostScheduleState(
  manifest: ValidatedSelfHostAppManifest,
  previous: SelfHostScheduleState | null,
  now: number,
): SelfHostScheduleState {
  const observedAt = readNow(now);
  const targets: Record<string, SelfHostScheduleTargetState> = {};

  for (const entry of manifest.schedules.entries) {
    const prior = previous?.targets[entry.id];
    const state = prior?.cron === entry.cron
      ? cloneTargetState(prior)
      : emptyTargetState(entry.cron);
    const cron = entry.cron;
    const latestDue = getPreviousFireTime(parseCron(cron), new Date(observedAt));
    state.latestObservedBoundary = state.latestObservedBoundary === null
      ? latestDue
      : Math.max(state.latestObservedBoundary, latestDue);

    if (
      state.pendingBoundary === null
      && (
        state.lastSuccessfulBoundary === null
        || latestDue > state.lastSuccessfulBoundary
      )
    ) {
      state.pendingBoundary = latestDue;
      state.attempt = 0;
      state.nextAttemptAt = 0;
      state.mode = 'execute';
    }
    targets[entry.id] = state;
  }

  return validateSelfHostScheduleState({
    schemaVersion: 2,
    generation: manifest.generation,
    manifestDigest: manifest.schedules.digest,
    targets,
  });
}

function statesEqual(
  left: SelfHostScheduleState | null,
  right: SelfHostScheduleState,
): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

function readPositiveOption(value: number | undefined, fallback: number, context: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${context} must be a positive safe integer.`);
  }
  return resolved;
}

function readConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_SELF_HOST_SCHEDULE_CONCURRENCY;
  if (
    !Number.isInteger(concurrency)
    || concurrency < 1
    || concurrency > MAX_SELF_HOST_SCHEDULE_CONCURRENCY
  ) {
    throw new Error(
      `Self-host schedule concurrency must be between 1 and ${MAX_SELF_HOST_SCHEDULE_CONCURRENCY}.`,
    );
  }
  return concurrency;
}

function describeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

async function mapSettledWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: unknown }>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        const value = values[index];
        if (value === undefined) continue;
        try {
          results[index] = { ok: true, value: await mapper(value) };
        } catch (error) {
          results[index] = { ok: false, error };
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function computeRetryDelay(attempt: number, baseMs: number, maxMs: number): number {
  const exponent = Math.min(Math.max(0, attempt - 1), 30);
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const rawLength = response.headers.get('content-length');
  if (rawLength !== null) {
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error('Scheduled dispatch response has an invalid Content-Length.');
    }
    if (contentLength > MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES) {
      throw new Error('Scheduled dispatch response exceeds the bounded JSON limit.');
    }
  }
  if (!response.body) throw new Error('Scheduled dispatch response body is empty.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Scheduled dispatch response exceeds the bounded JSON limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch (error) {
    throw new Error('Scheduled dispatch response is not valid UTF-8.', { cause: error });
  }
  if (text.trim().length === 0) {
    throw new Error('Scheduled dispatch response body is empty.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error('Scheduled dispatch response is not valid JSON.', { cause: error });
  }
}

function normalizeDispatchBoundary(
  boundary: SelfHostScheduleBoundary,
): SelfHostScheduleBoundary {
  assertManagedCronWireBound(boundary.cron, 'Scheduled dispatch cron');
  const cron = normalizeCronExpression(boundary.cron);
  const schedule = parseCron(cron);
  const scheduledTime = readBoundary(boundary.scheduledTime, 'Scheduled dispatch boundary');
  if (scheduledTime === null) throw new Error('Scheduled dispatch boundary is required.');
  if (!matchesCron(new Date(scheduledTime), schedule)) {
    throw new Error(`Scheduled dispatch time is not a boundary of cron '${cron}'.`);
  }
  assertManagedScheduleTargetIdWireBound(boundary.targetId, 'Scheduled dispatch targetId');
  if (boundary.mode !== 'execute' && boundary.mode !== 'reconcile') {
    throw new Error('Scheduled dispatch mode must be execute or reconcile.');
  }
  return { cron, scheduledTime, targetId: boundary.targetId, mode: boundary.mode };
}

function normalizeControlSecret(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('Self-host schedule control secret must be 32 random bytes encoded as lowercase hex.');
  }
  return value;
}

function normalizeRuntimeOrigin(runtimeOrigin: string): URL {
  const origin = new URL(runtimeOrigin);
  const loopbackHosts = new Set(['127.0.0.1', '::1', '[::1]']);
  if (
    origin.protocol !== 'http:'
    || !loopbackHosts.has(origin.hostname)
    || origin.username
    || origin.password
    || origin.pathname !== '/'
    || origin.search
    || origin.hash
  ) {
    throw new Error(
      'Self-host schedule runtime origin must be an exact loopback HTTP origin without credentials.',
    );
  }
  return origin;
}

export class SelfHostScheduleDispatchError extends Error {
  constructor(
    message: string,
    readonly structural: boolean,
    readonly ambiguous: boolean,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = 'SelfHostScheduleDispatchError';
  }
}

function buildControlEnvelopes(
  boundaries: SelfHostScheduleBoundary[],
): SelfHostScheduleRequestEnvelope[] {
  const byBoundary = new Map<string, SelfHostScheduleRequestEnvelope>();
  for (const boundary of boundaries) {
    const key = JSON.stringify([boundary.cron, boundary.scheduledTime]);
    let envelope = byBoundary.get(key);
    if (!envelope) {
      envelope = { cron: boundary.cron, scheduledTime: boundary.scheduledTime, targets: [] };
      byBoundary.set(key, envelope);
    }
    if (envelope.targets.some(({ id }) => id === boundary.targetId)) {
      throw new Error(`Self-host schedule batch repeats target '${boundary.targetId}' at one boundary.`);
    }
    envelope.targets.push({ id: boundary.targetId, mode: boundary.mode });
  }
  const envelopes = [...byBoundary.values()];
  if (envelopes.length > MAX_SELF_HOST_SCHEDULE_ENVELOPES_PER_REQUEST) {
    throw new Error(
      `Self-host schedule batch exceeds ${MAX_SELF_HOST_SCHEDULE_ENVELOPES_PER_REQUEST} envelopes.`,
    );
  }
  return envelopes;
}

function normalizeWireOutcome(value: unknown, context: string): SelfHostScheduleWireOutcome {
  const outcome = assertRecord(value, context);
  const allowedKeys = [
    'cron', 'scheduledTime', 'itemId', 'lane', 'status', 'attempt', 'executed', 'retryable',
    ...(outcome.error === undefined ? [] : ['error']),
  ];
  assertExactKeys(outcome, allowedKeys, context);
  const cronValue = readNonEmptyString(outcome.cron, `${context}.cron`);
  const cron = normalizeCronExpression(cronValue);
  if (cron !== cronValue) throw new Error(`${context}.cron must already be normalized.`);
  const scheduledTime = readBoundary(outcome.scheduledTime, `${context}.scheduledTime`);
  if (scheduledTime === null) throw new Error(`${context}.scheduledTime is required.`);
  const itemId = readNonEmptyString(outcome.itemId, `${context}.itemId`);
  assertManagedScheduleTargetIdWireBound(itemId, `${context}.itemId`);
  if (!['app-function', 'plugin-function', 'extra-cron', 'system'].includes(String(outcome.lane))) {
    throw new Error(`${context}.lane is invalid.`);
  }
  if (!['succeeded', 'failed', 'timed_out', 'duplicate', 'in_flight', 'uncertain'].includes(String(outcome.status))) {
    throw new Error(`${context}.status is invalid.`);
  }
  const attempt = readNonNegativeSafeInteger(outcome.attempt, `${context}.attempt`);
  if (typeof outcome.executed !== 'boolean' || typeof outcome.retryable !== 'boolean') {
    throw new Error(`${context} execution flags must be boolean.`);
  }
  if (outcome.error !== undefined && typeof outcome.error !== 'string') {
    throw new Error(`${context}.error must be a string when present.`);
  }
  return {
    cron,
    scheduledTime,
    itemId,
    lane: outcome.lane as SelfHostScheduleWireOutcome['lane'],
    status: outcome.status as SelfHostScheduleWireOutcome['status'],
    attempt,
    executed: outcome.executed,
    retryable: outcome.retryable,
    ...(typeof outcome.error === 'string' ? { error: outcome.error } : {}),
  };
}

/**
 * Send one bounded coalesced envelope to the authenticated loopback control
 * plane and preserve a terminal result for every constituent cron identity.
 */
export async function dispatchSelfHostScheduleBatch(
  options: DispatchSelfHostScheduleBatchOptions,
): Promise<SelfHostScheduleWireOutcome[]> {
  if (
    options.boundaries.length === 0
    || options.boundaries.length > MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST
  ) {
    throw new Error(
      `Self-host schedule batch must contain 1-${MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST} targets.`,
    );
  }
  const boundaries = options.boundaries.map(normalizeDispatchBoundary);
  const requestTimeoutMs = readPositiveOption(
    options.requestTimeoutMs,
    DEFAULT_SELF_HOST_SCHEDULE_REQUEST_TIMEOUT_MS,
    'Self-host schedule request timeout',
  );

  const origin = normalizeRuntimeOrigin(options.runtimeOrigin);
  const url = new URL(`${SELF_HOST_CONTROL_ROOT}/schedules`, origin);
  const controlSecret = normalizeControlSecret(options.controlSecret);
  const request: SelfHostScheduleControlRequest = {
    schemaVersion: SELF_HOST_SCHEDULE_PROTOCOL_VERSION,
    generation: options.manifest.generation,
    scheduleDigest: options.manifest.schedules.digest,
    envelopes: buildControlEnvelopes(boundaries),
  };
  const requestBody = JSON.stringify(request);
  if (utf8ByteLength(requestBody) > MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES) {
    throw new SelfHostScheduleDispatchError(
      'Scheduled dispatch request exceeds the bounded JSON limit.',
      true,
      false,
    );
  }

  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-edgebase-self-host-control': controlSecret,
      },
      body: requestBody,
      redirect: 'error',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(requestTimeoutMs)])
        : AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new SelfHostScheduleDispatchError(
      'Scheduled dispatch ended without an authenticated response.',
      false,
      true,
      { cause: error },
    );
  }
  let result: unknown;
  try {
    result = await readBoundedJson(response);
  } catch (error) {
    throw new SelfHostScheduleDispatchError(
      'Scheduled dispatch returned an unreadable bounded response.',
      false,
      true,
      { cause: error },
    );
  }
  if (response.status === 409 && isRecord(result) && result.outcome === 'stale') {
    throw new SelfHostScheduleDispatchError(
      'Scheduled dispatch manifest authority is stale at the active runtime.',
      true,
      false,
    );
  }
  if (
    !hasExactKeys(result, [
      'schemaVersion', 'outcome', 'complete', 'generation', 'scheduleDigest', 'outcomes',
    ])
    || result.schemaVersion !== SELF_HOST_SCHEDULE_PROTOCOL_VERSION
    || (result.outcome !== 'ok' && result.outcome !== 'incomplete')
    || typeof result.complete !== 'boolean'
    || result.generation !== options.manifest.generation
    || result.scheduleDigest !== options.manifest.schedules.digest
    || !Array.isArray(result.outcomes)
  ) {
    throw new SelfHostScheduleDispatchError(
      `Scheduled dispatch authority/shape failed at HTTP ${response.status}.`,
      response.status === 400 || response.status === 404 || response.status === 409,
      true,
    );
  }
  if (
    (response.status !== 200 && response.status !== 409)
    || (response.status === 200 && (result.outcome !== 'ok' || result.complete !== true))
    || (response.status === 409 && (result.outcome !== 'incomplete' || result.complete !== false))
  ) {
    throw new SelfHostScheduleDispatchError(
      `Scheduled dispatch returned HTTP ${response.status}.`,
      true,
      true,
    );
  }
  const responseOutcomes = result.outcomes.map((candidate, index) => (
    normalizeWireOutcome(candidate, `Scheduled dispatch outcomes[${index}]`)
  ));
  const byKey = new Map<string, SelfHostScheduleWireOutcome>();
  for (const outcome of responseOutcomes) {
    const key = JSON.stringify([outcome.cron, outcome.scheduledTime, outcome.itemId]);
    if (byKey.has(key)) {
      throw new SelfHostScheduleDispatchError(`Scheduled dispatch duplicated outcome ${key}.`, false, true);
    }
    byKey.set(key, outcome);
  }
  const ordered = boundaries.map((boundary) => {
    const key = JSON.stringify([boundary.cron, boundary.scheduledTime, boundary.targetId]);
    const outcome = byKey.get(key);
    if (!outcome) {
      throw new SelfHostScheduleDispatchError(`Scheduled dispatch omitted outcome ${key}.`, false, true);
    }
    byKey.delete(key);
    return outcome;
  });
  if (byKey.size > 0) {
    throw new SelfHostScheduleDispatchError(
      `Scheduled dispatch returned unknown outcomes: ${[...byKey.keys()].join(', ')}.`,
      false,
      true,
    );
  }
  return ordered;
}

/** Strict completion acknowledgement for one authenticated loopback envelope. */
export async function dispatchSelfHostScheduleBoundary(
  options: DispatchSelfHostScheduleBoundaryOptions,
): Promise<SelfHostScheduleWireOutcome> {
  const [result] = await dispatchSelfHostScheduleBatch({
    manifest: options.manifest,
    boundaries: [{
      cron: options.cron,
      scheduledTime: options.scheduledTime,
      targetId: options.targetId,
      mode: options.mode,
    }],
    runtimeOrigin: options.runtimeOrigin,
    controlSecret: options.controlSecret,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: options.requestTimeoutMs }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!result) throw new Error('Scheduled dispatch returned no result.');
  return result;
}

function resolveDispatcher(options: RunSelfHostSchedulePassOptions): SelfHostScheduleDispatcher {
  if (options.dispatcher) return options.dispatcher;
  if (!options.runtimeOrigin) {
    throw new Error('runtimeOrigin is required when no self-host schedule dispatcher is supplied.');
  }
  if (!options.controlSecret) {
    throw new Error('controlSecret is required when no self-host schedule dispatcher is supplied.');
  }
  return (boundary) => dispatchSelfHostScheduleBoundary({
    ...boundary,
    manifest: validateSelfHostAppManifest(options.manifest),
    runtimeOrigin: options.runtimeOrigin as string,
    controlSecret: options.controlSecret as string,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: options.requestTimeoutMs }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * Persist pending work before dispatch, drain every ready cron through bounded
 * concurrency, then commit all outcomes together. A crash after HTTP success
 * but before the final commit therefore replays the same `(cron, time)` key.
 */
export async function runSelfHostSchedulePass(
  options: RunSelfHostSchedulePassOptions,
): Promise<SelfHostSchedulePassReport> {
  const manifest = validateSelfHostAppManifest(options.manifest);
  const stateStore = options.stateStore ?? fileSelfHostScheduleStateStore;
  const observedAt = readNow((options.now ?? Date.now)());
  const concurrency = readConcurrency(options.concurrency);
  const retryBaseMs = readPositiveOption(
    options.retryBaseMs,
    DEFAULT_SELF_HOST_SCHEDULE_RETRY_BASE_MS,
    'Self-host schedule retry base',
  );
  const retryMaxMs = readPositiveOption(
    options.retryMaxMs,
    DEFAULT_SELF_HOST_SCHEDULE_RETRY_MAX_MS,
    'Self-host schedule retry maximum',
  );
  if (retryMaxMs < retryBaseMs) {
    throw new Error('Self-host schedule retry maximum must be at least its base.');
  }
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error('Self-host schedule pass aborted.');
  }

  const loaded = await stateStore.read(options.statePath);
  const previous = loaded === null ? null : validateSelfHostScheduleState(loaded);
  const beforeDispatch = reconcileSelfHostScheduleState(manifest, previous, observedAt);
  if (!statesEqual(previous, beforeDispatch)) {
    await stateStore.write(options.statePath, beforeDispatch);
  }

  const boundaries = Object.entries(beforeDispatch.targets)
    .filter(([, state]) => (
      state.pendingBoundary !== null
      && state.nextAttemptAt <= observedAt
    ))
    .map(([targetId, state]) => ({
      cron: state.cron,
      scheduledTime: state.pendingBoundary as number,
      targetId,
      mode: state.mode,
    }));
  if (boundaries.length === 0) {
    return {
      generation: manifest.generation,
      manifestDigest: manifest.schedules.digest,
      observedAt,
      structuralReady: true,
      itemFailureCount: Object.values(beforeDispatch.targets)
        .filter((state) => state.pendingBoundary !== null && (state.attempt > 0 || state.mode === 'reconcile'))
        .length,
      outcomes: [],
      state: beforeDispatch,
    };
  }

  let settled: Array<
    { ok: true; value: SelfHostScheduleWireOutcome }
    | { ok: false; error: unknown }
  >;
  const structuralErrors: unknown[] = [];
  if (options.dispatcher) {
    const dispatcher = resolveDispatcher(options);
    settled = await mapSettledWithConcurrency(boundaries, concurrency, dispatcher);
  } else {
    if (!options.runtimeOrigin) {
      throw new Error('runtimeOrigin is required when no self-host schedule dispatcher is supplied.');
    }
    if (!options.controlSecret) {
      throw new Error('controlSecret is required when no self-host schedule dispatcher is supplied.');
    }
    settled = [];
    for (
      let offset = 0;
      offset < boundaries.length;
      offset += MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST
    ) {
      if (options.signal?.aborted) {
        const error = new SelfHostScheduleDispatchError(
          'Scheduled dispatch was aborted before the next bounded chunk.',
          false,
          true,
          { cause: options.signal.reason },
        );
        settled.push(...boundaries.slice(offset).map(() => ({ ok: false as const, error })));
        break;
      }
      const chunk = boundaries.slice(
        offset,
        offset + MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST,
      );
      try {
        settled.push(...await dispatchSelfHostScheduleBatch({
          manifest,
          boundaries: chunk,
          runtimeOrigin: options.runtimeOrigin,
          controlSecret: options.controlSecret,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...(options.requestTimeoutMs !== undefined
            ? { requestTimeoutMs: options.requestTimeoutMs }
            : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        }).then((outcomes) => outcomes.map((value) => ({ ok: true as const, value }))));
      } catch (error) {
        if (error instanceof SelfHostScheduleDispatchError && error.structural) {
          structuralErrors.push(error);
        }
        settled.push(...chunk.map(() => ({ ok: false as const, error })));
      }
    }
  }
  const afterDispatch = cloneState(beforeDispatch);
  const outcomes: SelfHostScheduleDispatchOutcome[] = [];

  settled.forEach((result, index) => {
    const boundary = boundaries[index];
    if (!boundary || !result) return;
    const state = afterDispatch.targets[boundary.targetId];
    if (!state || state.pendingBoundary !== boundary.scheduledTime) {
      throw new Error(`Self-host schedule cursor changed during dispatch for '${boundary.targetId}'.`);
    }

    if (result.ok) {
      const wire = normalizeWireOutcome(result.value, 'Self-host dispatcher outcome');
      if (
        wire.cron !== boundary.cron
        || wire.scheduledTime !== boundary.scheduledTime
        || wire.itemId !== boundary.targetId
      ) {
        throw new Error(`Self-host dispatcher returned the wrong target outcome for '${boundary.targetId}'.`);
      }
      if (wire.status === 'succeeded' || wire.status === 'duplicate') {
        state.lastSuccessfulBoundary = boundary.scheduledTime;
        state.pendingBoundary = (
          state.latestObservedBoundary !== null
          && state.latestObservedBoundary > boundary.scheduledTime
        )
          ? state.latestObservedBoundary
          : null;
        state.attempt = 0;
        state.nextAttemptAt = 0;
        state.mode = 'execute';
        outcomes.push({
          ...boundary,
          status: 'succeeded',
          runtimeStatus: wire.status,
          attempt: 0,
          nextAttemptAt: 0,
        });
        return;
      }

      state.attempt = Math.min(MAX_RECORDED_ATTEMPT, state.attempt + 1);
      state.nextAttemptAt = Math.min(
        Number.MAX_SAFE_INTEGER,
        observedAt + computeRetryDelay(state.attempt, retryBaseMs, retryMaxMs),
      );
      const ambiguous = wire.status === 'timed_out'
        || wire.status === 'in_flight'
        || wire.status === 'uncertain';
      state.mode = ambiguous ? 'reconcile' : 'execute';
      outcomes.push({
        ...boundary,
        status: ambiguous ? 'ambiguous' : 'failed',
        runtimeStatus: wire.status,
        attempt: state.attempt,
        nextAttemptAt: state.nextAttemptAt,
        ...(wire.error ? { error: wire.error } : {}),
      });
      return;
    }

    state.attempt = Math.min(MAX_RECORDED_ATTEMPT, state.attempt + 1);
    const retryDelay = computeRetryDelay(state.attempt, retryBaseMs, retryMaxMs);
    state.nextAttemptAt = Math.min(Number.MAX_SAFE_INTEGER, observedAt + retryDelay);
    const ambiguous = !(result.error instanceof SelfHostScheduleDispatchError)
      || result.error.ambiguous;
    if (ambiguous) state.mode = 'reconcile';
    outcomes.push({
      ...boundary,
      status: ambiguous ? 'ambiguous' : 'failed',
      runtimeStatus: ambiguous ? 'uncertain' : 'failed',
      attempt: state.attempt,
      nextAttemptAt: state.nextAttemptAt,
      error: describeError(result.error),
    });
  });

  const validatedAfterDispatch = validateSelfHostScheduleState(afterDispatch);
  await stateStore.write(options.statePath, validatedAfterDispatch);
  if (structuralErrors.length > 0) {
    throw new AggregateError(
      structuralErrors,
      'Self-host schedule control authority is structurally blocked.',
    );
  }
  return {
    generation: manifest.generation,
    manifestDigest: manifest.schedules.digest,
    observedAt,
    structuralReady: true,
    itemFailureCount: Object.values(validatedAfterDispatch.targets)
      .filter((state) => state.pendingBoundary !== null && (state.attempt > 0 || state.mode === 'reconcile'))
      .length,
    outcomes,
    state: validatedAfterDispatch,
  };
}

/**
 * Long-lived, single-flight controller for Docker/pack entrypoint integration.
 * The timer is scheduled only after a pass settles, so a slow pass cannot
 * overlap its successor or create a second state writer.
 */
export function createSelfHostScheduleSupervisor(
  options: CreateSelfHostScheduleSupervisorOptions,
): SelfHostScheduleSupervisor {
  const intervalMs = readPositiveOption(
    options.intervalMs,
    DEFAULT_SELF_HOST_SCHEDULE_INTERVAL_MS,
    'Self-host schedule interval',
  );
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<SelfHostSchedulePassReport> | null = null;
  let completedPass = false;
  let stopped = false;
  const abortController = new AbortController();
  let status: SelfHostScheduleSupervisorStatus = {
    state: 'idle',
    structuralReady: false,
    itemFailureCount: 0,
    lastAttemptAt: null,
    lastSuccessfulPassAt: null,
    lastError: null,
  };

  const snapshotStatus = (): SelfHostScheduleSupervisorStatus => ({ ...status });

  const reportError = (error: unknown): void => {
    if (options.onError) {
      options.onError(error);
      return;
    }
    process.stderr.write(
      `[EdgeBase] Self-host schedule supervisor pass failed: ${describeError(error)}\n`,
    );
  };

  const runOnce = (): Promise<SelfHostSchedulePassReport> => {
    if (stopped) return Promise.reject(new Error('Self-host schedule supervisor is stopped.'));
    if (inFlight) return inFlight;
    const passStartedAt = Date.now();
    status = { ...status, state: 'running', lastAttemptAt: passStartedAt };
    const signal = options.signal
      ? AbortSignal.any([options.signal, abortController.signal])
      : abortController.signal;
    const operation = readSelfHostAppManifest(options.manifestPath)
      .then((manifest) => runSelfHostSchedulePass({
        ...options,
        manifest,
        signal,
      }))
      .then((report) => {
        completedPass = true;
        if (stopped) {
          status = { ...status, state: 'stopped', structuralReady: false };
          return report;
        }
        status = {
          state: report.itemFailureCount > 0 ? 'degraded' : 'ready',
          structuralReady: true,
          itemFailureCount: report.itemFailureCount,
          lastAttemptAt: passStartedAt,
          lastSuccessfulPassAt: Date.now(),
          lastError: null,
        };
        return report;
      })
      .catch((error) => {
        if (stopped && abortController.signal.aborted) {
          status = { ...status, state: 'stopped', structuralReady: false };
        } else {
          status = {
            ...status,
            state: 'blocked',
            structuralReady: false,
            lastAttemptAt: passStartedAt,
            lastError: describeError(error),
          };
        }
        throw error;
      });
    inFlight = operation.finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const scheduleNext = (): void => {
    if (!running) return;
    timer = setTimeout(() => {
      timer = null;
      void runOnce()
        .then((report) => options.onReport?.(report))
        .catch(reportError)
        .finally(scheduleNext);
    }, intervalMs);
  };

  return {
    runOnce,
    start() {
      if (running) return;
      if (stopped) throw new Error('Self-host schedule supervisor cannot restart after stop().');
      running = true;
      if (completedPass) {
        scheduleNext();
      } else {
        void runOnce()
          .then((report) => options.onReport?.(report))
          .catch(reportError)
          .finally(scheduleNext);
      }
    },
    getStatus() {
      return snapshotStatus();
    },
    async stop(stopOptions = {}) {
      const timeoutMs = readPositiveOption(
        stopOptions.timeoutMs,
        10_000,
        'Self-host schedule supervisor stop timeout',
      );
      running = false;
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      abortController.abort(new Error('Self-host schedule supervisor is stopping.'));
      const operation = inFlight?.catch(() => undefined) ?? Promise.resolve();
      let timeout: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          operation,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(new Error(
                `Self-host schedule supervisor did not stop within ${timeoutMs}ms.`,
              ));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        status = { ...status, state: 'stopped', structuralReady: false };
      }
    },
    isRunning() {
      return running;
    },
  };
}
