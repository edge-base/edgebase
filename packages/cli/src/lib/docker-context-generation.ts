import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  type Dirent,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

const STATE_SCHEMA_VERSION = 1;
const DEFAULT_ORPHAN_CAP = 32;
const COMPLETE_MARKER = '.edgebase-docker-context-complete.json';
const LEGACY_GENERATION_ID = 'legacy-v0';
const LEGACY_MIGRATION_ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_STATE_INVENTORY_ENTRIES = 262_144;
const DEFAULT_DELETION_CHUNK_SIZE = 64;
const MAX_PROCESS_ID = 2_147_483_647;
const MAX_POINTER_SNAPSHOT_ATTEMPTS = 32;

export type DockerContextGenerationFaultPoint =
  | 'after-staging-populated'
  | 'after-complete-marker'
  | 'before-generation-commit'
  | 'after-generation-rename'
  | 'after-lease-transition-lock'
  | 'after-gc-owner'
  | 'after-gc-generation-snapshot'
  | 'after-gc-lease-snapshot'
  | 'after-gc-pointer-snapshot'
  | 'after-atomic-preparation-owner'
  | 'after-atomic-preparation-operation'
  | 'after-atomic-preparation-record'
  | 'after-atomic-owner-publication'
  | 'after-atomic-temporary-pointer-created'
  | 'after-atomic-temporary-pointer'
  | 'after-atomic-cleanup-first-removal'
  | 'before-json-temporary-delete'
  | 'before-legacy-journal-clear'
  | 'after-legacy-marker'
  | 'after-legacy-record'
  | 'after-legacy-rename'
  | 'after-legacy-pointer';

export type DockerContextLeaseState = 'preconsumer' | 'consuming' | 'released';

export interface DockerContextGenerationPaths {
  targetsDir: string;
  stateDir: string;
  leasesDir: string;
  transitionsDir: string;
  atomicDir: string;
  stagingDir: string;
  bundleWorkDir: string;
  generationsDir: string;
  currentPath: string;
  exportPath: string;
  legacyRecoveryPath: string;
  legacyMigrationPath: string;
  gcOwnerPath: string;
}

interface FilesystemIdentity {
  device: number;
  inode: number;
}

interface ExactFileEvidence extends FilesystemIdentity {
  contents: string;
}

interface ExactSymlinkEvidence extends FilesystemIdentity {
  target: string;
}

interface ExactOwnedLeafEvidence extends FilesystemIdentity {
  path: string;
  parentPath: string;
  kind: 'file' | 'symlink';
  target?: string;
}

interface ExactOwnedDirectoryTreeEvidence extends FilesystemIdentity {
  path: string;
  parentPath: string;
  kind: 'directory';
  entries: ExactOwnedTreeEvidence[];
}

type ExactOwnedTreeEvidence = ExactOwnedLeafEvidence | ExactOwnedDirectoryTreeEvidence;

const managedRootIdentities = new WeakMap<
  DockerContextGenerationPaths,
  Map<string, FilesystemIdentity>
>();

export interface DockerContextLease {
  id: string;
  ownerPath: string;
  state: DockerContextLeaseState;
  generationId?: string;
}

export interface DockerContextGeneration {
  id: string;
  path: string;
}

export interface DockerContextPathApi {
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
  readonly sep: string;
}

const HOST_PATH_API: DockerContextPathApi = {
  relative,
  resolve,
  sep,
};

export function isDockerContextExactDirectChild(
  root: string,
  candidate: string,
  pathApi: DockerContextPathApi = HOST_PATH_API,
): boolean {
  const resolvedRoot = pathApi.resolve(root);
  const resolvedCandidate = pathApi.resolve(candidate);
  const relativePath = pathApi.relative(resolvedRoot, resolvedCandidate);
  return (
    relativePath.length > 0
    && relativePath !== '..'
    && !relativePath.startsWith(`..${pathApi.sep}`)
    && !relativePath.includes(pathApi.sep)
    && pathApi.resolve(resolvedRoot, relativePath) === resolvedCandidate
  );
}

export interface DockerContextGenerationManagerOptions {
  orphanCap?: number;
  pid?: number;
  processIsAlive?: (pid: number) => boolean;
  nonce?: () => string;
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void;
  maxInventoryEntries?: number;
  deletionChunkSize?: number;
  maintenanceObserver?: (event: DockerContextMaintenanceEvent) => void;
}

export type DockerContextMaintenanceEvent =
  | { phase: 'inventory'; scanned: number; retained: number }
  | { phase: 'delete-chunk'; chunkIndex: number; chunkSize: number; remaining: number };

export interface DockerContextGenerationManager {
  paths: DockerContextGenerationPaths;
  createLease(): DockerContextLease;
  setPlannedGeneration(lease: DockerContextLease, generationId: string): DockerContextLease;
  markConsuming(lease: DockerContextLease): DockerContextLease;
  markReleased(lease: DockerContextLease): DockerContextLease;
  publishGeneration(
    lease: DockerContextLease,
    populate: (stagingDir: string) => void,
  ): DockerContextGeneration;
  allocateBundleWork(lease: DockerContextLease): string;
  publishCurrent(lease: DockerContextLease, generation: DockerContextGeneration): DockerContextLease;
  publishExport(lease: DockerContextLease, generation: DockerContextGeneration): DockerContextLease;
  recoverLegacyCurrent(): DockerContextGeneration | null;
  collectGarbage(): void;
}

interface LeaseRecord {
  schemaVersion: number;
  id: string;
  pid: number;
  state: DockerContextLeaseState;
  generationId?: string;
  createdAt: string;
}

interface CompleteRecord {
  schemaVersion: number;
  generationId: string;
  leaseId: string;
  createdAt: string;
  migrationId?: string;
}

interface LegacyMigrationRecord {
  schemaVersion: number;
  generationId: string;
  source: string;
  destination: string;
  pid: number;
  migrationId: string;
}

interface LegacyMigrationEvidence {
  migration: LegacyMigrationRecord;
  generationPath: string;
  generationIdentity: FilesystemIdentity;
  marker: ExactFileEvidence;
  journal: ExactFileEvidence;
}

interface TransitionOwnerRecord {
  schemaVersion: number;
  leaseId: string;
  pid: number;
}

interface AtomicOperationRecord {
  schemaVersion: number;
  ownerId: string;
  pid: number;
  kind: 'current' | 'export' | 'legacy';
  migrationId?: string;
}

interface AtomicOperationHandle {
  ownerPath: string;
  ownerFile: ExactFileEvidence;
  owner: AtomicOperationRecord;
  preparationPath: string;
  preparationIdentity: FilesystemIdentity;
  operationPath: string;
  operationIdentity: FilesystemIdentity;
  preparationOwnerFile: ExactFileEvidence;
  temporaryPointerPath: string;
  temporaryPointer?: AtomicPointerEvidence;
}

interface AtomicPointerEvidence {
  path: string;
  file: ExactSymlinkEvidence;
  generationId: string;
  generationPath: string;
}

interface AtomicPreparationEvidence {
  path: string;
  identity: FilesystemIdentity;
  ownerId: string;
  pid: number;
  stage: 'owner' | 'operation' | 'record' | 'pointer';
  operationPath?: string;
  operationIdentity?: FilesystemIdentity;
  ownerFile?: ExactFileEvidence;
  owner?: AtomicOperationRecord;
  pointer?: AtomicPointerEvidence;
}

interface AtomicOwnerClaimEvidence {
  path: string;
  file: ExactFileEvidence;
  owner: AtomicOperationRecord;
  preparation: AtomicPreparationEvidence;
}

interface LegacyAtomicOperationEvidence {
  ownerPath: string;
  ownerIdentity: FilesystemIdentity;
  operationPath: string;
  operationIdentity: FilesystemIdentity;
  ownerFile: ExactFileEvidence;
  owner: AtomicOperationRecord;
}

interface GcOwnerRecord {
  schemaVersion: number;
  id: string;
  pid: number;
}

interface ActiveGcOwner {
  record: GcOwnerRecord;
  identity: FilesystemIdentity;
  ownerFile: ExactFileEvidence;
}

interface ExactFileDeletionEvidence {
  path: string;
  parentPath: string;
  file: ExactFileEvidence;
}

interface RuntimeOptions {
  orphanCap: number;
  processIsAlive: (pid: number) => boolean;
  maxInventoryEntries: number;
  deletionChunkSize: number;
  maintenanceObserver?: (event: DockerContextMaintenanceEvent) => void;
}

class StateInventoryBudget {
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly observer?: (event: DockerContextMaintenanceEvent) => void,
  ) {}

  read(directoryPath: string): Dirent[] {
    const directory = opendirSync(directoryPath);
    const entries: Dirent[] = [];
    try {
      let entry: Dirent | null;
      while ((entry = directory.readSync()) !== null) {
        if (this.count >= this.limit) {
          throw new DockerContextStateError(
            `Docker context state inventory exceeds the bounded safety limit of ${this.limit} entries.`,
          );
        }
        this.count += 1;
        this.observer?.({ phase: 'inventory', scanned: this.count, retained: this.count });
        entries.push(entry);
      }
    } finally {
      directory.closeSync();
    }
    return entries;
  }
}

export class DockerContextStateError extends Error {
  readonly code = 'EDGEBASE_DOCKER_CONTEXT_STATE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'DockerContextStateError';
  }
}

export class DockerContextOrphanLimitError extends Error {
  readonly code = 'EDGEBASE_DOCKER_CONTEXT_ORPHAN_LIMIT';

  constructor(count: number, cap: number) {
    super(
      `Docker context state contains ${count} unrecoverable owner or work artifact(s); `
      + `the safety cap is ${cap}. Inspect ${COMPLETE_MARKER} and lease records before retrying.`,
    );
    this.name = 'DockerContextOrphanLimitError';
  }
}

export function createDockerContextGenerationManager(
  projectDir: string,
  options: DockerContextGenerationManagerOptions = {},
): DockerContextGenerationManager {
  const targetsDir = resolve(projectDir, '.edgebase', 'targets');
  const stateDir = join(targetsDir, '.docker-context-state');
  const paths: DockerContextGenerationPaths = {
    targetsDir,
    stateDir,
    leasesDir: join(stateDir, 'leases'),
    transitionsDir: join(stateDir, 'transitions'),
    atomicDir: join(stateDir, 'atomic'),
    stagingDir: join(stateDir, 'staging'),
    bundleWorkDir: join(stateDir, 'bundle-work'),
    generationsDir: join(stateDir, 'generations'),
    currentPath: join(targetsDir, 'docker-context'),
    exportPath: join(stateDir, 'export'),
    legacyRecoveryPath: join(stateDir, 'generations', LEGACY_GENERATION_ID),
    legacyMigrationPath: join(stateDir, 'legacy-migration.json'),
    gcOwnerPath: join(stateDir, 'gc-owner'),
  };
  const ensureExactDirectory = (
    path: string,
    expectedParent?: string,
    create = true,
  ): string => {
    let info;
    try {
      info = lstatSync(path);
    } catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let created = false;
      try {
        mkdirSync(path);
        created = true;
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
      }
      if (created && expectedParent) syncPath(expectedParent);
      info = lstatSync(path);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new DockerContextStateError(`Docker context managed root is not a real directory: ${path}`);
    }
    const canonical = realpathSync(path);
    if (expectedParent && dirname(canonical) !== expectedParent) {
      throw new DockerContextStateError(`Docker context managed root escapes its exact parent: ${path}`);
    }
    return canonical;
  };
  const canonicalProject = ensureExactDirectory(resolve(projectDir), undefined, false);
  const canonicalEdgebase = ensureExactDirectory(dirname(paths.targetsDir), canonicalProject);
  const canonicalTargets = ensureExactDirectory(paths.targetsDir, canonicalEdgebase);
  const canonicalState = ensureExactDirectory(paths.stateDir, canonicalTargets);
  for (const path of [
    paths.leasesDir,
    paths.transitionsDir,
    paths.atomicDir,
    paths.stagingDir,
    paths.bundleWorkDir,
    paths.generationsDir,
  ]) {
    ensureExactDirectory(path, canonicalState);
  }
  rememberManagedRootIdentities(paths);

  const pid = options.pid ?? process.pid;
  const nonce = options.nonce ?? (() => randomBytes(8).toString('hex'));
  const orphanCap = options.orphanCap ?? DEFAULT_ORPHAN_CAP;
  const maxInventoryEntries = options.maxInventoryEntries ?? MAX_STATE_INVENTORY_ENTRIES;
  const deletionChunkSize = options.deletionChunkSize ?? DEFAULT_DELETION_CHUNK_SIZE;
  const processIsAlive = options.processIsAlive ?? defaultProcessIsAlive;
  if (!Number.isInteger(orphanCap) || orphanCap <= 0) {
    throw new DockerContextStateError('Docker context orphan cap must be a positive integer.');
  }
  if (!Number.isInteger(maxInventoryEntries) || maxInventoryEntries <= 0) {
    throw new DockerContextStateError('Docker context inventory limit must be a positive integer.');
  }
  if (
    !Number.isInteger(deletionChunkSize)
    || deletionChunkSize <= 0
    || deletionChunkSize > DEFAULT_DELETION_CHUNK_SIZE
  ) {
    throw new DockerContextStateError(
      `Docker context deletion chunk size must be an integer from 1 to ${DEFAULT_DELETION_CHUNK_SIZE}.`,
    );
  }

  return {
    paths,
    createLease: () => {
      assertFreshManagedRoots(paths);
      return createLease(paths, {
        pid,
        nonce,
        orphanCap,
        processIsAlive,
        maxInventoryEntries,
        deletionChunkSize,
        maintenanceObserver: options.maintenanceObserver,
        faultInjector: options.faultInjector,
      });
    },
    setPlannedGeneration: (lease, generationId) => {
      assertFreshManagedRoots(paths);
      return updateLease(paths, lease, { generationId }, pid, options.faultInjector);
    },
    markConsuming: (lease) => {
      assertFreshManagedRoots(paths);
      return updateLease(paths, lease, { state: 'consuming' }, pid, options.faultInjector);
    },
    markReleased: (lease) => {
      assertFreshManagedRoots(paths);
      return updateLease(paths, lease, { state: 'released' }, pid, options.faultInjector);
    },
    publishGeneration: (lease, populate) => {
      assertFreshManagedRoots(paths);
      return publishGeneration(
        paths,
        lease,
        populate,
        pid,
        {
          maxInventoryEntries,
          maintenanceObserver: options.maintenanceObserver,
        },
        options.faultInjector,
      );
    },
    allocateBundleWork: (lease) => {
      assertFreshManagedRoots(paths);
      return allocateBundleWork(paths, lease, pid, options.faultInjector);
    },
    publishCurrent: (lease, generation) => {
      assertFreshManagedRoots(paths);
      return publishOwnedPointer(
        paths,
        lease,
        generation,
        'current',
        pid,
        options.faultInjector,
      );
    },
    publishExport: (lease, generation) => {
      assertFreshManagedRoots(paths);
      return publishOwnedPointer(
        paths,
        lease,
        generation,
        'export',
        pid,
        options.faultInjector,
      );
    },
    recoverLegacyCurrent: () => {
      assertFreshManagedRoots(paths);
      return recoverLegacyCurrent(
        paths,
        pid,
        {
          orphanCap,
          processIsAlive,
          maxInventoryEntries,
          deletionChunkSize,
          maintenanceObserver: options.maintenanceObserver,
        },
        options.faultInjector,
      );
    },
    collectGarbage: () => {
      assertFreshManagedRoots(paths);
      return collectGarbage(
        paths,
        {
          orphanCap,
          processIsAlive,
          maxInventoryEntries,
          deletionChunkSize,
          maintenanceObserver: options.maintenanceObserver,
        },
        pid,
        options.faultInjector,
      );
    },
  };
}

function assertFreshManagedRoots(paths: DockerContextGenerationPaths): void {
  const expectedIdentities = managedRootIdentities.get(paths);
  if (!expectedIdentities) {
    throw new DockerContextStateError('Docker context managed root identity is not registered.');
  }
  const assertDirectory = (path: string, expectedParent?: string): string => {
    let info;
    try {
      info = lstatSync(path);
    } catch (error) {
      throw new DockerContextStateError(
        `Docker context managed root is missing or unreadable: ${path}. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new DockerContextStateError(`Docker context managed root is not a real directory: ${path}`);
    }
    const expectedIdentity = expectedIdentities.get(path);
    if (
      !expectedIdentity
      || info.dev !== expectedIdentity.device
      || info.ino !== expectedIdentity.inode
    ) {
      throw new DockerContextStateError(`Docker context managed root identity changed: ${path}`);
    }
    const canonical = realpathSync(path);
    if (expectedParent && dirname(canonical) !== expectedParent) {
      throw new DockerContextStateError(`Docker context managed root escapes its exact parent: ${path}`);
    }
    return canonical;
  };
  const edgebaseDir = dirname(paths.targetsDir);
  const projectDir = dirname(edgebaseDir);
  const canonicalProject = assertDirectory(projectDir);
  const canonicalEdgebase = assertDirectory(edgebaseDir, canonicalProject);
  const canonicalTargets = assertDirectory(paths.targetsDir, canonicalEdgebase);
  const canonicalState = assertDirectory(paths.stateDir, canonicalTargets);
  for (const path of [
    paths.leasesDir,
    paths.transitionsDir,
    paths.atomicDir,
    paths.stagingDir,
    paths.bundleWorkDir,
    paths.generationsDir,
  ]) {
    assertDirectory(path, canonicalState);
  }
}

function managedRootPaths(paths: DockerContextGenerationPaths): string[] {
  const edgebaseDir = dirname(paths.targetsDir);
  return [
    dirname(edgebaseDir),
    edgebaseDir,
    paths.targetsDir,
    paths.stateDir,
    paths.leasesDir,
    paths.transitionsDir,
    paths.atomicDir,
    paths.stagingDir,
    paths.bundleWorkDir,
    paths.generationsDir,
  ];
}

function rememberManagedRootIdentities(paths: DockerContextGenerationPaths): void {
  const identities = new Map<string, FilesystemIdentity>();
  for (const path of managedRootPaths(paths)) {
    const info = lstatSync(path);
    identities.set(path, { device: info.dev, inode: info.ino });
  }
  managedRootIdentities.set(paths, identities);
}

function defaultProcessIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface SyncDockerContextPathOptions {
  platform?: NodeJS.Platform;
  isDirectory?: (path: string) => boolean;
  open?: (path: string) => number;
  fsync?: (descriptor: number) => void;
  close?: (descriptor: number) => void;
}

export function syncDockerContextPath(
  path: string,
  options: SyncDockerContextPathOptions = {},
): void {
  const platform = options.platform ?? process.platform;
  const isDirectory = options.isDirectory ?? ((target: string) => lstatSync(target).isDirectory());
  const open = options.open ?? ((target: string) => openSync(target, 'r'));
  const fsync = options.fsync ?? fsyncSync;
  const close = options.close ?? closeSync;
  const directory = isDirectory(path);
  let descriptor: number | null = null;
  try {
    descriptor = open(path);
    fsync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const unsupportedWindowsDirectorySync = platform === 'win32'
      && directory
      && descriptor !== null
      && code === 'EINVAL';
    if (!unsupportedWindowsDirectorySync) throw error;
  } finally {
    if (descriptor !== null) close(descriptor);
  }
}

function syncPath(path: string): void {
  syncDockerContextPath(path);
}

function syncTree(root: string): void {
  const directories: string[] = [];
  const visit = (directory: string): void => {
    directories.push(directory);
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const info = lstatSync(path);
      if (info.isDirectory()) visit(path);
      else if (info.isFile()) syncPath(path);
      else if (!info.isSymbolicLink()) {
        throw new DockerContextStateError(`Unsupported Docker context filesystem entry: ${path}`);
      }
    }
  };
  visit(root);
  for (const directory of directories.reverse()) syncPath(directory);
}

function writeJsonAtomic(
  path: string,
  value: unknown,
  createOnly = false,
  temporaryOwnerPid = process.pid,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): void {
  if (
    !Number.isSafeInteger(temporaryOwnerPid)
    || temporaryOwnerPid <= 0
    || temporaryOwnerPid > MAX_PROCESS_ID
  ) {
    throw new DockerContextStateError(`Docker context temporary owner PID is invalid: ${temporaryOwnerPid}`);
  }
  const temporaryPath = `${path}.sync-${temporaryOwnerPid}-${randomBytes(8).toString('hex')}`;
  let temporaryEvidence: ExactFileEvidence | undefined;
  let temporarySettled = false;
  let temporaryDeleteAttempted = false;
  let primaryError: unknown;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });
    temporaryEvidence = captureExactFileEvidence(temporaryPath, dirname(path));
    syncPath(temporaryPath);
    if (createOnly) {
      linkSync(temporaryPath, path);
      faultInjector?.('before-json-temporary-delete');
      temporaryDeleteAttempted = true;
      removeExactFileEvidence({
        path: temporaryPath,
        parentPath: dirname(path),
        file: temporaryEvidence,
      });
      temporarySettled = true;
    } else {
      renameSync(temporaryPath, path);
      temporarySettled = true;
    }
    syncPath(dirname(path));
  } catch (error) {
    primaryError = error;
  }

  let cleanupError: unknown;
  if (!temporarySettled && !temporaryDeleteAttempted && temporaryEvidence) {
    try {
      faultInjector?.('before-json-temporary-delete');
      temporaryDeleteAttempted = true;
      removeExactFileEvidence({
        path: temporaryPath,
        parentPath: dirname(path),
        file: temporaryEvidence,
      });
    } catch (error) {
      cleanupError = error;
    }
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `Docker context JSON write failed: ${
        primaryError instanceof Error ? primaryError.message : String(primaryError)
      }; exact temporary cleanup also failed: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`,
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
}

function parseJsonObject(path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new DockerContextStateError(
      `Docker context state is not valid JSON: ${path}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DockerContextStateError(`Docker context state must be a JSON object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

function validateIdentifier(value: string, label: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new DockerContextStateError(`${label} is not a safe filesystem identifier.`);
  }
  return value;
}

function validateGenerationIdentifier(value: string, allowLegacy = false): string {
  validateIdentifier(value, 'Docker context generation id');
  if (!allowLegacy && value.startsWith('legacy-')) {
    throw new DockerContextStateError(
      `Docker context generation id uses the reserved legacy migration namespace: ${value}`,
    );
  }
  return value;
}

function validateLegacyMigrationId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !LEGACY_MIGRATION_ID_PATTERN.test(value)) {
    throw new DockerContextStateError(`${label} is not a 128-bit lowercase hexadecimal identity.`);
  }
  return value;
}

function hasExactObjectKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isValidProcessId(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_PROCESS_ID;
}

function parseLeaseRecord(path: string): LeaseRecord {
  const value = parseJsonObject(path);
  if (
    value.schemaVersion !== STATE_SCHEMA_VERSION
    || typeof value.id !== 'string'
    || !isValidProcessId(value.pid)
    || !['preconsumer', 'consuming', 'released'].includes(String(value.state))
    || typeof value.createdAt !== 'string'
    || (value.generationId !== undefined && typeof value.generationId !== 'string')
    || (value.state === 'consuming' && typeof value.generationId !== 'string')
  ) {
    throw new DockerContextStateError(`Malformed Docker context lease record: ${path}`);
  }
  validateIdentifier(value.id, 'Docker context lease id');
  if (value.id === 'legacy-migration') {
    throw new DockerContextStateError(`Reserved legacy owner cannot be a normal lease: ${path}`);
  }
  if (typeof value.generationId === 'string') {
    validateGenerationIdentifier(value.generationId);
  }
  return value as unknown as LeaseRecord;
}

function parseTransitionOwner(path: string): TransitionOwnerRecord {
  const value = parseJsonObject(path);
  if (
    value.schemaVersion !== STATE_SCHEMA_VERSION
    || typeof value.leaseId !== 'string'
    || !isValidProcessId(value.pid)
  ) {
    throw new DockerContextStateError(`Malformed Docker context transition owner: ${path}`);
  }
  validateIdentifier(value.leaseId, 'Docker context lease id');
  return value as unknown as TransitionOwnerRecord;
}

function parseAtomicOperation(path: string): AtomicOperationRecord {
  const value = parseJsonObject(path);
  const legacy = value.kind === 'legacy';
  if (
    value.schemaVersion !== STATE_SCHEMA_VERSION
    || typeof value.ownerId !== 'string'
    || !isValidProcessId(value.pid)
    || !['current', 'export', 'legacy'].includes(String(value.kind))
    || (legacy
      ? !hasExactObjectKeys(value, ['schemaVersion', 'ownerId', 'pid', 'kind', 'migrationId'])
      : !hasExactObjectKeys(value, ['schemaVersion', 'ownerId', 'pid', 'kind']))
  ) {
    throw new DockerContextStateError(`Malformed Docker context atomic operation owner: ${path}`);
  }
  if (legacy) {
    validateLegacyMigrationId(value.migrationId, 'Docker context legacy atomic migration id');
  }
  validateIdentifier(value.ownerId, 'Docker context atomic operation owner');
  return value as unknown as AtomicOperationRecord;
}

function parseLegacyMigrationAt(
  paths: DockerContextGenerationPaths,
  journalPath: string,
): LegacyMigrationRecord {
  const value = parseJsonObject(journalPath);
  if (
    !hasExactObjectKeys(value, [
      'schemaVersion',
      'generationId',
      'source',
      'destination',
      'pid',
      'migrationId',
    ])
    || value.schemaVersion !== STATE_SCHEMA_VERSION
    || value.generationId !== LEGACY_GENERATION_ID
    || value.source !== paths.currentPath
    || value.destination !== paths.legacyRecoveryPath
    || !isValidProcessId(value.pid)
  ) {
    throw new DockerContextStateError(
      `Malformed Docker context legacy migration record: ${journalPath}`,
    );
  }
  validateLegacyMigrationId(value.migrationId, 'Docker context legacy migration id');
  return value as unknown as LegacyMigrationRecord;
}

function parseLegacyMigration(paths: DockerContextGenerationPaths): LegacyMigrationRecord {
  return parseLegacyMigrationAt(paths, paths.legacyMigrationPath);
}

function isLeaseJsonTemporaryName(name: string, record: LeaseRecord): boolean {
  const prefix = `${record.id}.json.sync-`;
  return parseTemporaryOwnerPid(name, prefix) === record.pid;
}

function isLegacyJsonTemporaryName(
  paths: DockerContextGenerationPaths,
  name: string,
  record?: LegacyMigrationRecord,
): boolean {
  const prefix = `${basename(paths.legacyMigrationPath)}.sync-`;
  const ownerPid = parseTemporaryOwnerPid(name, prefix);
  return ownerPid !== null && (record === undefined || ownerPid === record.pid);
}

function parseTemporaryOwnerPid(name: string, prefix: string): number | null {
  if (!name.startsWith(prefix)) return null;
  const match = /^([1-9][0-9]*)-([a-f0-9]{16})$/.exec(name.slice(prefix.length));
  if (!match) return null;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PROCESS_ID) return null;
  return pid;
}

function parseAtomicPreparationName(
  name: string,
): { ownerId: string; pid: number } | null {
  const match = /^\.prepare-([1-9][0-9]*)-([a-f0-9]{16})-(.+)$/.exec(name);
  if (!match) return null;
  const pid = Number(match[1]);
  if (!isValidProcessId(pid)) return null;
  try {
    validateIdentifier(match[3], 'Docker context atomic preparation owner');
  } catch {
    return null;
  }
  return { ownerId: match[3], pid };
}

function captureAtomicPreparationEvidence(
  paths: DockerContextGenerationPaths,
  entry: Dirent,
  preparation: { ownerId: string; pid: number },
  inventory: StateInventoryBudget,
): AtomicPreparationEvidence {
  const preparationPath = join(paths.atomicDir, entry.name);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new DockerContextStateError(
      `Malformed Docker context atomic preparation: ${preparationPath}`,
    );
  }
  const identity = captureExactOwnedDirectory(preparationPath, paths.atomicDir);
  const operationEntries = inventory.read(preparationPath);
  if (operationEntries.length === 0) {
    return {
      path: preparationPath,
      identity,
      ownerId: preparation.ownerId,
      pid: preparation.pid,
      stage: 'owner',
    };
  }
  if (
    operationEntries.length !== 1
    || !operationEntries[0].isDirectory()
    || operationEntries[0].isSymbolicLink()
    || !/^[a-f0-9]{16}$/.test(operationEntries[0].name)
  ) {
    throw new DockerContextStateError(
      `Malformed Docker context atomic preparation operation: ${preparationPath}`,
    );
  }
  const operationPath = join(preparationPath, operationEntries[0].name);
  const operationIdentity = captureExactOwnedDirectory(operationPath, preparationPath);
  const contents = inventory.read(operationPath);
  if (contents.length === 0) {
    return {
      path: preparationPath,
      identity,
      ownerId: preparation.ownerId,
      pid: preparation.pid,
      stage: 'operation',
      operationPath,
      operationIdentity,
    };
  }
  const ownerEntry = contents.find((item) => item.name === 'owner.json');
  const pointerEntry = contents.find((item) => item.name === 'pointer');
  if (
    (contents.length !== 1 && contents.length !== 2)
    || !ownerEntry
    || !ownerEntry.isFile()
    || ownerEntry.isSymbolicLink()
    || (contents.length === 2 && (
      !pointerEntry
      || !pointerEntry.isSymbolicLink()
    ))
  ) {
    throw new DockerContextStateError(
      `Malformed Docker context atomic preparation record: ${operationPath}`,
    );
  }
  const ownerPath = join(operationPath, 'owner.json');
  const ownerFile = captureExactFileEvidence(ownerPath, operationPath);
  const owner = parseAtomicOperation(ownerPath);
  if (
    owner.ownerId !== preparation.ownerId
    || owner.pid !== preparation.pid
    || (preparation.ownerId === 'legacy-migration') !== (owner.kind === 'legacy')
  ) {
    throw new DockerContextStateError(
      `Docker context atomic preparation owner does not match its filename authority: ${preparationPath}`,
    );
  }
  assertExactFileEvidence(ownerPath, operationPath, ownerFile);
  const pointer = pointerEntry
    ? captureAtomicPointerEvidence(paths, operationPath, owner)
    : undefined;
  assertOwnedDirectoryIdentity(preparationPath, identity);
  assertOwnedDirectoryIdentity(operationPath, operationIdentity);
  return {
    path: preparationPath,
    identity,
    ownerId: preparation.ownerId,
    pid: preparation.pid,
    stage: pointer ? 'pointer' : 'record',
    operationPath,
    operationIdentity,
    ownerFile,
    owner,
    ...(pointer ? { pointer } : {}),
  };
}

function captureAtomicOwnerClaimEvidence(
  paths: DockerContextGenerationPaths,
  ownerId: string,
  preparations: AtomicPreparationEvidence[],
): AtomicOwnerClaimEvidence {
  const ownerPath = join(paths.atomicDir, ownerId);
  const file = captureExactFileEvidence(ownerPath, paths.atomicDir);
  const owner = parseAtomicOperation(ownerPath);
  if (owner.ownerId !== ownerId) {
    throw new DockerContextStateError(
      `Docker context atomic owner claim does not match its filename: ${ownerPath}`,
    );
  }
  const matches = preparations.filter((preparation) => (
    (preparation.stage === 'record' || preparation.stage === 'pointer')
    && preparation.ownerId === owner.ownerId
    && preparation.pid === owner.pid
    && preparation.ownerFile !== undefined
    && sameFilesystemIdentity(preparation.ownerFile, file)
    && preparation.ownerFile.contents === file.contents
  ));
  if (matches.length !== 1) {
    throw new DockerContextStateError(
      `Docker context atomic owner claim has no exact prepared operation: ${ownerPath}`,
    );
  }
  const preparation = matches[0];
  if (
    preparation.owner?.kind !== owner.kind
    || preparation.owner?.migrationId !== owner.migrationId
  ) {
    throw new DockerContextStateError(
      `Docker context atomic owner claim changed its prepared authority: ${ownerPath}`,
    );
  }
  assertExactFileEvidence(ownerPath, paths.atomicDir, file);
  return { path: ownerPath, file, owner, preparation };
}

function readLegacyMigrationIfPresent(
  paths: DockerContextGenerationPaths,
): LegacyMigrationRecord | null {
  let info;
  try {
    info = lstatSync(paths.legacyMigrationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile()) {
    throw new DockerContextStateError(
      `Docker context legacy migration journal is not a regular file: ${paths.legacyMigrationPath}`,
    );
  }
  return parseLegacyMigration(paths);
}

function assertNoLegacyMigrationTemporaryEvidence(
  paths: DockerContextGenerationPaths,
  inventory: StateInventoryBudget,
): void {
  const prefix = `${basename(paths.legacyMigrationPath)}.sync-`;
  const temporary = inventory.read(paths.stateDir).find((entry) => entry.name.startsWith(prefix));
  if (temporary) {
    throw new DockerContextStateError(
      `Legacy Docker context migration has unresolved temporary evidence: ${join(paths.stateDir, temporary.name)}`,
    );
  }
}

function parseGcOwner(path: string): GcOwnerRecord {
  const value = parseJsonObject(path);
  if (
    value.schemaVersion !== STATE_SCHEMA_VERSION
    || typeof value.id !== 'string'
    || !isValidProcessId(value.pid)
  ) {
    throw new DockerContextStateError(`Malformed Docker context garbage collector owner: ${path}`);
  }
  validateIdentifier(value.id, 'Docker context garbage collector owner id');
  return value as unknown as GcOwnerRecord;
}

function readLease(paths: DockerContextGenerationPaths, id: string): LeaseRecord {
  validateIdentifier(id, 'Docker context lease id');
  const path = join(paths.leasesDir, `${id}.json`);
  if (!existsSync(path)) {
    throw new DockerContextStateError(`Docker context lease no longer exists: ${id}`);
  }
  const record = parseLeaseRecord(path);
  if (record.id !== id) {
    throw new DockerContextStateError(`Docker context lease filename/id mismatch: ${path}`);
  }
  return record;
}

function toLease(paths: DockerContextGenerationPaths, record: LeaseRecord): DockerContextLease {
  return {
    id: record.id,
    ownerPath: join(paths.leasesDir, `${record.id}.json`),
    state: record.state,
    ...(record.generationId ? { generationId: record.generationId } : {}),
  };
}

function assertLeaseProcessOwner(record: LeaseRecord, pid: number): void {
  if (record.pid !== pid) {
    throw new DockerContextStateError(
      `Docker context lease belongs to a different invocation owner: ${record.id}`,
    );
  }
}

function countBlockingOrphans(
  paths: DockerContextGenerationPaths,
  options: RuntimeOptions,
): { count: number; gcOwnerBlocked: boolean } {
  const inventory = new StateInventoryBudget(
    options.maxInventoryEntries,
    options.maintenanceObserver,
  );
  const orphanKeys = new Set<string>();
  let gcOwnerBlocked = false;
  const leaseRecords = new Map<string, { record: LeaseRecord; alive: boolean }>();
  const liveness = new Map<number, boolean>();
  const isAlive = (pid: number): boolean => {
    const observed = liveness.get(pid);
    if (observed !== undefined) return observed;
    const alive = options.processIsAlive(pid);
    liveness.set(pid, alive);
    return alive;
  };
  const stateDirectories = new Set([
    basename(paths.leasesDir),
    basename(paths.transitionsDir),
    basename(paths.atomicDir),
    basename(paths.stagingDir),
    basename(paths.bundleWorkDir),
    basename(paths.generationsDir),
    basename(paths.gcOwnerPath),
  ]);
  for (const entry of inventory.read(paths.stateDir)) {
    const path = join(paths.stateDir, entry.name);
    if (stateDirectories.has(entry.name)) {
      if (!entry.isDirectory()) orphanKeys.add(`path:${path}`);
      continue;
    }
    if (entry.name === basename(paths.exportPath)) {
      if (!entry.isSymbolicLink()) orphanKeys.add(`path:${path}`);
      continue;
    }
    if (entry.name === basename(paths.legacyMigrationPath)) {
      if (!entry.isFile()) orphanKeys.add(`path:${path}`);
      continue;
    }
    if (entry.isFile() && isLegacyJsonTemporaryName(paths, entry.name)) {
      try {
        const record = parseLegacyMigrationAt(paths, path);
        if (!isLegacyJsonTemporaryName(paths, entry.name, record)) {
          throw new DockerContextStateError(`Legacy Docker context temporary owner mismatch: ${path}`);
        }
        if (!isAlive(record.pid)) orphanKeys.add(`legacy-temp:${path}`);
      } catch {
        orphanKeys.add(`path:${path}`);
      }
      continue;
    }
    orphanKeys.add(`path:${path}`);
  }
  for (const entry of inventory.read(paths.leasesDir)) {
    const path = join(paths.leasesDir, entry.name);
    if (
      entry.name === 'legacy-migration.json'
      || entry.name.startsWith('legacy-migration.json.sync-')
    ) {
      throw new DockerContextStateError(`Reserved legacy owner cannot occupy lease storage: ${path}`);
    }
    if (entry.isFile() && entry.name.includes('.json.sync-')) {
      try {
        const record = parseLeaseRecord(path);
        if (!isLeaseJsonTemporaryName(entry.name, record)) {
          throw new DockerContextStateError(`Malformed Docker context lease temporary: ${path}`);
        }
        if (record.state === 'consuming' && !isAlive(record.pid)) {
          orphanKeys.add(`lease:${record.id}`);
        }
      } catch {
        orphanKeys.add(`path:${path}`);
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      orphanKeys.add(`path:${path}`);
      continue;
    }
    try {
      const record = parseLeaseRecord(path);
      if (entry.name !== `${record.id}.json` || leaseRecords.has(record.id)) {
        orphanKeys.add(`path:${path}`);
        continue;
      }
      const alive = isAlive(record.pid);
      leaseRecords.set(record.id, { record, alive });
      if (record.state === 'consuming' && !alive) orphanKeys.add(`lease:${record.id}`);
    } catch {
      orphanKeys.add(`path:${path}`);
    }
  }

  for (const root of [paths.stagingDir, paths.bundleWorkDir]) {
    for (const entry of inventory.read(root)) {
      const path = join(root, entry.name);
      if (!entry.isDirectory() || !leaseRecords.has(entry.name)) {
        orphanKeys.add(`path:${path}`);
      }
    }
  }

  for (const entry of inventory.read(paths.generationsDir)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      orphanKeys.add(`path:${join(paths.generationsDir, entry.name)}`);
    }
  }

  for (const entry of inventory.read(paths.transitionsDir)) {
    const transitionPath = join(paths.transitionsDir, entry.name);
    const lease = leaseRecords.get(entry.name);
    if (!entry.isDirectory() || !lease) {
      orphanKeys.add(`path:${transitionPath}`);
      continue;
    }
    try {
      const contents = inventory.read(transitionPath);
      if (contents.some((item) => !item.isFile() || item.name !== 'owner.json')) {
        throw new DockerContextStateError(`Malformed Docker context transition: ${transitionPath}`);
      }
      const ownerEntry = contents.find((item) => item.name === 'owner.json');
      if (ownerEntry) {
        const owner = parseTransitionOwner(join(transitionPath, ownerEntry.name));
        if (owner.leaseId !== entry.name || owner.pid !== lease.record.pid) {
          throw new DockerContextStateError(`Docker context transition owner mismatch: ${transitionPath}`);
        }
      }
      if (!lease.alive || lease.record.state === 'released') {
        orphanKeys.add(`lease:${entry.name}`);
      }
    } catch {
      orphanKeys.add(`path:${transitionPath}`);
    }
  }

  const atomicEntries = inventory.read(paths.atomicDir);
  const atomicPreparations: AtomicPreparationEvidence[] = [];
  for (const entry of atomicEntries) {
    const ownerPath = join(paths.atomicDir, entry.name);
    const preparation = parseAtomicPreparationName(entry.name);
    if (preparation) {
      const evidence = captureAtomicPreparationEvidence(
        paths,
        entry,
        preparation,
        inventory,
      );
      atomicPreparations.push(evidence);
      continue;
    }
    if (entry.name.startsWith('.prepare-')) {
      throw new DockerContextStateError(
        `Malformed Docker context atomic preparation name: ${ownerPath}`,
      );
    }
  }

  const claimedPreparationPaths = new Set<string>();
  for (const entry of atomicEntries) {
    if (parseAtomicPreparationName(entry.name)) continue;
    const ownerPath = join(paths.atomicDir, entry.name);
    const lease = leaseRecords.get(entry.name);
    const legacyMigration = entry.name === 'legacy-migration'
      ? tryReadBoundLegacyMigration(paths)
      : null;
    const legacyOwner = legacyMigration !== null;
    if (!lease && !legacyOwner) {
      orphanKeys.add(`path:${ownerPath}`);
      continue;
    }
    if (entry.isFile() && !entry.isSymbolicLink()) {
      try {
        const claim = captureAtomicOwnerClaimEvidence(
          paths,
          entry.name,
          atomicPreparations,
        );
        if (
          (lease && (
            claim.owner.pid !== lease.record.pid
            || claim.owner.kind === 'legacy'
          ))
          || (legacyMigration && (
            claim.owner.kind !== 'legacy'
            || claim.owner.migrationId !== legacyMigration.migrationId
          ))
        ) {
          throw new DockerContextStateError(
            `Docker context atomic owner claim mismatch: ${ownerPath}`,
          );
        }
        claimedPreparationPaths.add(claim.preparation.path);
        if (!isAlive(claim.owner.pid)) {
          orphanKeys.add(`atomic-preparation:${claim.preparation.path}`);
        }
      } catch {
        orphanKeys.add(`path:${ownerPath}`);
      }
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      orphanKeys.add(`path:${ownerPath}`);
      continue;
    }
    const operationEntries = inventory.read(ownerPath);
    if (operationEntries.length !== 1) {
      orphanKeys.add(`path:${ownerPath}`);
      continue;
    }
    for (const operationEntry of operationEntries) {
      const operationPath = join(ownerPath, operationEntry.name);
      if (!operationEntry.isDirectory()) {
        orphanKeys.add(`path:${operationPath}`);
        continue;
      }
      try {
        const contents = inventory.read(operationPath);
        if (contents.some((item) => (
          (item.name !== 'owner.json' && item.name !== 'pointer')
          || (item.name === 'owner.json' && !item.isFile())
          || (item.name === 'pointer' && !item.isSymbolicLink())
        ))) {
          throw new DockerContextStateError(`Malformed Docker context atomic operation: ${operationPath}`);
        }
        const ownerEntry = contents.find((item) => item.name === 'owner.json');
        if (!ownerEntry) {
          throw new DockerContextStateError(`Docker context atomic operation has no owner: ${operationPath}`);
        }
        const owner = parseAtomicOperation(join(operationPath, ownerEntry.name));
        if (
          owner.ownerId !== entry.name
          || (lease && (owner.pid !== lease.record.pid || owner.kind === 'legacy'))
          || (legacyMigration && (
            owner.kind !== 'legacy'
            || owner.migrationId !== legacyMigration.migrationId
          ))
        ) {
          throw new DockerContextStateError(`Docker context atomic operation owner mismatch: ${operationPath}`);
        }
        if (legacyMigration && !isAlive(owner.pid)) {
          orphanKeys.add(`legacy:${operationPath}`);
        }
      } catch {
        orphanKeys.add(`path:${operationPath}`);
      }
    }
    if (lease && lease.record.state === 'consuming' && !lease.alive) {
      orphanKeys.add(`lease:${entry.name}`);
    }
  }
  for (const preparation of atomicPreparations) {
    if (!claimedPreparationPaths.has(preparation.path) && !isAlive(preparation.pid)) {
      orphanKeys.add(`atomic-preparation:${preparation.path}`);
    }
  }

  try {
    const info = lstatSync(paths.gcOwnerPath);
    if (!info.isDirectory()) throw new DockerContextStateError('Docker context GC owner is not a directory.');
    const entries = inventory.read(paths.gcOwnerPath);
    if (entries.length !== 1 || entries[0]?.name !== 'owner.json' || !entries[0].isFile()) {
      throw new DockerContextStateError('Malformed Docker context GC owner directory.');
    }
    const owner = parseGcOwner(join(paths.gcOwnerPath, 'owner.json'));
    if (!isAlive(owner.pid)) {
      orphanKeys.add('gc-owner');
      gcOwnerBlocked = true;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      orphanKeys.add(`path:${paths.gcOwnerPath}`);
      gcOwnerBlocked = true;
    }
  }
  return { count: orphanKeys.size, gcOwnerBlocked };
}

function tryReadBoundLegacyMigration(
  paths: DockerContextGenerationPaths,
): LegacyMigrationRecord | null {
  try {
    const migration = readLegacyMigrationIfPresent(paths);
    if (!migration) return null;
    const generationPath = pathEntryExists(migration.destination)
      ? migration.destination
      : migration.source;
    const info = lstatSync(generationPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new DockerContextStateError(
        `Legacy Docker context migration generation has the wrong type: ${generationPath}`,
      );
    }
    assertLegacyMigrationBinding(generationPath, migration);
    return migration;
  } catch {
    return null;
  }
}

function createLease(
  paths: DockerContextGenerationPaths,
  options: RuntimeOptions & {
    pid: number;
    nonce: () => string;
    faultInjector?: (point: DockerContextGenerationFaultPoint) => void;
  },
): DockerContextLease {
  const blockingOrphans = countBlockingOrphans(paths, options);
  if (blockingOrphans.gcOwnerBlocked) {
    throw new DockerContextStateError(
      'Docker context garbage collector ownership is abandoned or malformed; refusing to create a lease.',
    );
  }
  if (blockingOrphans.count >= options.orphanCap) {
    throw new DockerContextOrphanLimitError(blockingOrphans.count, options.orphanCap);
  }
  const id = validateIdentifier(`${options.pid}-${options.nonce()}`, 'Docker context lease id');
  const record: LeaseRecord = {
    schemaVersion: STATE_SCHEMA_VERSION,
    id,
    pid: options.pid,
    state: 'preconsumer',
    createdAt: new Date().toISOString(),
  };
  const ownerPath = join(paths.leasesDir, `${id}.json`);
  try {
    assertFreshManagedRoots(paths);
    writeJsonAtomic(ownerPath, record, true, record.pid, options.faultInjector);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DockerContextStateError(`Docker context lease id collision: ${id}`);
    }
    throw error;
  }
  return toLease(paths, record);
}

function updateLease(
  paths: DockerContextGenerationPaths,
  lease: DockerContextLease,
  patch: Partial<Pick<LeaseRecord, 'generationId' | 'state'>>,
  pid: number,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): DockerContextLease {
  return withLeaseTransition(paths, lease.id, pid, faultInjector, () => {
    const current = readLease(paths, lease.id);
    assertLeaseProcessOwner(current, pid);
    if (current.state === 'released') {
      throw new DockerContextStateError(`Docker context lease is already released: ${lease.id}`);
    }
    if (patch.generationId !== undefined) {
      if (current.state !== 'preconsumer') {
        throw new DockerContextStateError(
          `Only a preconsumer lease can plan a Docker context generation: ${lease.id}`,
        );
      }
      validateGenerationIdentifier(patch.generationId);
      if (current.generationId) {
        throw new DockerContextStateError(
          `Docker context lease generation is already planned and cannot be repeated: ${lease.id}`,
        );
      }
    }
    if (patch.state === 'consuming' && current.state !== 'preconsumer') {
      throw new DockerContextStateError(`Only a preconsumer lease can begin consuming: ${lease.id}`);
    }
    if (patch.state === 'consuming' && !current.generationId) {
      throw new DockerContextStateError(
        `Docker context lease must plan a generation before consuming: ${lease.id}`,
      );
    }
    const updated: LeaseRecord = { ...current, ...patch };
    assertFreshManagedRoots(paths);
    writeJsonAtomic(join(paths.leasesDir, `${lease.id}.json`), updated, false, updated.pid);
    return toLease(paths, updated);
  });
}

function withLeaseTransition<T>(
  paths: DockerContextGenerationPaths,
  leaseId: string,
  pid: number,
  faultInjector: ((point: DockerContextGenerationFaultPoint) => void) | undefined,
  action: () => T,
): T {
  assertFreshManagedRoots(paths);
  validateIdentifier(leaseId, 'Docker context lease id');
  const transitionPath = join(paths.transitionsDir, leaseId);
  try {
    mkdirSync(transitionPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DockerContextStateError(
        `Docker context lease transition is already active and will not be reclaimed automatically: ${leaseId}`,
      );
    }
    throw error;
  }
  const transitionIdentity = captureExactOwnedDirectory(transitionPath, paths.transitionsDir);
  let ownerFile: ExactFileEvidence | undefined;
  let result: T | undefined;
  let primaryError: unknown;
  let failed = false;
  try {
    const owner: TransitionOwnerRecord = {
      schemaVersion: STATE_SCHEMA_VERSION,
      leaseId,
      pid,
    };
    const ownerPath = join(transitionPath, 'owner.json');
    writeJsonAtomic(ownerPath, owner, true, owner.pid);
    ownerFile = captureExactFileEvidence(ownerPath, transitionPath);
    faultInjector?.('after-lease-transition-lock');
    assertFreshManagedRoots(paths);
    assertOwnedDirectoryIdentity(transitionPath, transitionIdentity);
    result = action();
  } catch (error) {
    failed = true;
    primaryError = error;
  }

  let cleanupError: unknown;
  try {
    assertFreshManagedRoots(paths);
    assertOwnedDirectoryIdentity(transitionPath, transitionIdentity);
    assertExactDirectoryShape(
      transitionPath,
      new Map(ownerFile ? [['owner.json', 'file' as const] as const] : []),
    );
    if (ownerFile) {
      removeExactFileEvidence({
        path: join(transitionPath, 'owner.json'),
        parentPath: transitionPath,
        file: ownerFile,
      });
      assertExactDirectoryShape(transitionPath, new Map());
    }
    assertOwnedDirectoryIdentity(transitionPath, transitionIdentity);
    rmdirSync(transitionPath);
    syncPath(paths.transitionsDir);
  } catch (error) {
    cleanupError = error;
  }

  if (failed && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `Docker context lease transition ${leaseId} failed: ${
        primaryError instanceof Error ? primaryError.message : String(primaryError)
      }; exact cleanup also failed: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`,
    );
  }
  if (failed) throw primaryError;
  if (cleanupError) throw cleanupError;
  return result as T;
}

function markerPath(generationPath: string): string {
  return join(generationPath, COMPLETE_MARKER);
}

function parseCompleteRecord(path: string, expectedGenerationId = basename(path)): CompleteRecord {
  const marker = parseJsonObject(markerPath(path));
  const legacy = marker.generationId === LEGACY_GENERATION_ID;
  if (
    marker.schemaVersion !== STATE_SCHEMA_VERSION
    || typeof marker.generationId !== 'string'
    || typeof marker.leaseId !== 'string'
    || typeof marker.createdAt !== 'string'
    || (legacy
      ? !hasExactObjectKeys(marker, [
        'schemaVersion',
        'generationId',
        'leaseId',
        'createdAt',
        'migrationId',
      ])
      : !hasExactObjectKeys(marker, ['schemaVersion', 'generationId', 'leaseId', 'createdAt']))
  ) {
    throw new DockerContextStateError(`Malformed Docker context complete marker: ${markerPath(path)}`);
  }
  if (legacy) {
    validateLegacyMigrationId(marker.migrationId, 'Docker context legacy marker migration id');
  }
  validateGenerationIdentifier(
    marker.generationId,
    marker.generationId === LEGACY_GENERATION_ID,
  );
  validateIdentifier(marker.leaseId, 'Docker context lease id');
  if (marker.generationId !== expectedGenerationId) {
    throw new DockerContextStateError(`Docker context generation marker/path mismatch: ${path}`);
  }
  return marker as unknown as CompleteRecord;
}

function generationPublicationCollision(generationId: string): DockerContextStateError {
  return new DockerContextStateError(
    `Docker context generation path already exists or collided during publication: ${generationId}`,
  );
}

function createExactOwnedTreeEntry(
  source: ExactOwnedTreeEvidence,
  destinationParent: string,
  generationId: string,
): ExactOwnedTreeEvidence {
  const destinationPath = join(destinationParent, basename(source.path));
  try {
    if (source.kind === 'file') {
      linkSync(source.path, destinationPath);
      return captureExactOwnedLeafEvidence(destinationPath, destinationParent, 'file');
    }
    if (source.kind === 'symlink') {
      if (source.target === undefined) {
        throw new DockerContextStateError(
          `Docker context generation symlink has no exact target: ${source.path}`,
        );
      }
      symlinkSync(source.target, destinationPath);
      return captureExactOwnedLeafEvidence(destinationPath, destinationParent, 'symlink');
    }
    if (source.kind !== 'directory') {
      throw new DockerContextStateError(
        `Unsupported Docker context generation entry: ${source.path}`,
      );
    }

    assertOwnedDirectoryIdentity(source.path, source);
    const sourceInfo = lstatSync(source.path);
    mkdirSync(destinationPath, { mode: sourceInfo.mode & 0o7777 });
    const destinationIdentity = captureExactOwnedDirectory(
      destinationPath,
      destinationParent,
    );
    const destinationEntries = source.entries.map((entry) => (
      createExactOwnedTreeEntry(entry, destinationPath, generationId)
    ));
    assertOwnedDirectoryIdentity(source.path, source);
    assertOwnedDirectoryIdentity(destinationPath, destinationIdentity);
    chmodSync(destinationPath, sourceInfo.mode & 0o7777);
    utimesSync(destinationPath, sourceInfo.atime, sourceInfo.mtime);
    return {
      ...destinationIdentity,
      path: destinationPath,
      parentPath: destinationParent,
      kind: 'directory',
      entries: destinationEntries,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw generationPublicationCollision(generationId);
    }
    throw error;
  }
}

function publishGenerationDirectoryCreateOnly(
  paths: DockerContextGenerationPaths,
  stagingPath: string,
  generationPath: string,
  generationId: string,
  options: Pick<RuntimeOptions, 'maxInventoryEntries' | 'maintenanceObserver'>,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): void {
  const inventory = (): StateInventoryBudget => new StateInventoryBudget(
    options.maxInventoryEntries,
    options.maintenanceObserver,
  );
  const stagingEvidence = captureExactOwnedDirectoryTreeSnapshot(
    stagingPath,
    paths.stagingDir,
    inventory(),
  );
  assertExactOwnedDirectoryTreeEvidence(stagingEvidence, inventory());
  const marker = stagingEvidence.entries.find(
    (entry) => basename(entry.path) === COMPLETE_MARKER,
  );
  if (!marker || marker.kind !== 'file') {
    throw new DockerContextStateError(
      `Docker context staged generation has no exact complete marker: ${stagingPath}`,
    );
  }
  const payloadEntries = stagingEvidence.entries.filter((entry) => entry !== marker);
  const stagingInfo = lstatSync(stagingPath);

  try {
    mkdirSync(generationPath, { mode: stagingInfo.mode & 0o7777 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw generationPublicationCollision(generationId);
    }
    throw error;
  }
  const generationIdentity = captureExactOwnedDirectory(
    generationPath,
    paths.generationsDir,
  );
  const publishedEntries: ExactOwnedTreeEvidence[] = [];
  const generationEvidence: ExactOwnedDirectoryTreeEvidence = {
    ...generationIdentity,
    path: generationPath,
    parentPath: paths.generationsDir,
    kind: 'directory',
    entries: publishedEntries,
  };
  let committed = false;
  try {
    for (const entry of payloadEntries) {
      publishedEntries.push(createExactOwnedTreeEntry(
        entry,
        generationPath,
        generationId,
      ));
    }
    assertExactOwnedDirectoryTreeEvidence(stagingEvidence, inventory());
    assertExactOwnedDirectoryTreeEvidence(generationEvidence, inventory());
    syncTree(generationPath);
    faultInjector?.('before-generation-commit');
    assertFreshManagedRoots(paths);
    assertExactOwnedDirectoryTreeEvidence(stagingEvidence, inventory());
    assertExactOwnedDirectoryTreeEvidence(generationEvidence, inventory());

    const generationMarkerPath = markerPath(generationPath);
    try {
      linkSync(marker.path, generationMarkerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw generationPublicationCollision(generationId);
      }
      throw error;
    }
    publishedEntries.push(captureExactOwnedLeafEvidence(
      generationMarkerPath,
      generationPath,
      'file',
    ));
    chmodSync(generationPath, stagingInfo.mode & 0o7777);
    utimesSync(generationPath, stagingInfo.atime, stagingInfo.mtime);
    assertExactOwnedDirectoryTreeEvidence(generationEvidence, inventory());
    syncPath(generationMarkerPath);
    syncPath(generationPath);
    syncPath(paths.generationsDir);
    committed = true;

    removeExactOwnedDirectoryTree(stagingEvidence, inventory());
    syncPath(paths.stagingDir);
  } catch (error) {
    if (committed) throw error;
    let cleanupError: unknown;
    try {
      removeExactOwnedDirectoryTree(generationEvidence, inventory());
      syncPath(paths.generationsDir);
    } catch (cleanupFailure) {
      cleanupError = cleanupFailure;
    }
    if (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Docker context generation publication failed without replacing its collision; `
        + `exact partial-publication cleanup also failed: ${generationId}`,
      );
    }
    throw error;
  }
}

function publishGeneration(
  paths: DockerContextGenerationPaths,
  lease: DockerContextLease,
  populate: (stagingDir: string) => void,
  pid: number,
  options: Pick<RuntimeOptions, 'maxInventoryEntries' | 'maintenanceObserver'>,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): DockerContextGeneration {
  return withLeaseTransition(paths, lease.id, pid, faultInjector, () => {
    const owner = readLease(paths, lease.id);
    assertLeaseProcessOwner(owner, pid);
    if (owner.state !== 'preconsumer' || !owner.generationId) {
      throw new DockerContextStateError(
        `Docker context generation requires a planned preconsumer lease: ${lease.id}`,
      );
    }
    const generationId = validateGenerationIdentifier(owner.generationId);
    const stagingPath = join(paths.stagingDir, lease.id);
    const generationPath = join(paths.generationsDir, generationId);
    if (pathEntryExists(stagingPath) || pathEntryExists(generationPath)) {
      throw new DockerContextStateError(`Docker context generation path already exists: ${generationId}`);
    }
    mkdirSync(stagingPath, { recursive: false });
    const stagingIdentity = captureExactOwnedDirectory(stagingPath, paths.stagingDir);
    populate(stagingPath);
    assertFreshManagedRoots(paths);
    assertOwnedDirectoryIdentity(stagingPath, stagingIdentity);
    syncTree(stagingPath);
    faultInjector?.('after-staging-populated');
    assertFreshManagedRoots(paths);
    assertOwnedDirectoryIdentity(stagingPath, stagingIdentity);
    const complete: CompleteRecord = {
      schemaVersion: STATE_SCHEMA_VERSION,
      generationId,
      leaseId: lease.id,
      createdAt: new Date().toISOString(),
    };
    writeJsonAtomic(markerPath(stagingPath), complete, true);
    syncPath(stagingPath);
    faultInjector?.('after-complete-marker');
    assertFreshManagedRoots(paths);
    assertOwnedDirectoryIdentity(stagingPath, stagingIdentity);
    publishGenerationDirectoryCreateOnly(
      paths,
      stagingPath,
      generationPath,
      generationId,
      options,
      faultInjector,
    );
    faultInjector?.('after-generation-rename');
    assertFreshManagedRoots(paths);
    return { id: generationId, path: generationPath };
  });
}

function allocateBundleWork(
  paths: DockerContextGenerationPaths,
  lease: DockerContextLease,
  pid: number,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): string {
  return withLeaseTransition(paths, lease.id, pid, faultInjector, () => {
    const owner = readLease(paths, lease.id);
    assertLeaseProcessOwner(owner, pid);
    if (owner.state !== 'preconsumer') {
      throw new DockerContextStateError(
        `Docker bundle work requires a preconsumer lease: ${lease.id}`,
      );
    }
    const workPath = join(paths.bundleWorkDir, lease.id);
    assertFreshManagedRoots(paths);
    try {
      mkdirSync(workPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new DockerContextStateError(
          `Docker bundle work is already allocated for lease: ${lease.id}`,
        );
      }
      throw error;
    }
    captureExactOwnedDirectory(workPath, paths.bundleWorkDir);
    syncPath(paths.bundleWorkDir);
    return workPath;
  });
}

function assertGeneration(
  paths: DockerContextGenerationPaths,
  generation: DockerContextGeneration,
  allowCanonicalInternalPath = false,
): string {
  const submittedPath = resolve(generation.path);
  const submittedRoot = resolve(paths.generationsDir);
  const submittedRelative = relative(submittedRoot, submittedPath);
  const submittedInfo = lstatSync(generation.path);
  if (
    !allowCanonicalInternalPath
    && (
      !submittedInfo.isDirectory()
      || submittedInfo.isSymbolicLink()
      || !isDockerContextExactDirectChild(submittedRoot, submittedPath)
      || submittedRelative !== generation.id
    )
  ) {
    throw new DockerContextStateError(
      `Docker context generation must be submitted as its exact non-symlink direct child: ${generation.path}`,
    );
  }
  const candidate = realpathSync(generation.path);
  const generationsRoot = realpathSync(paths.generationsDir);
  const relativePath = relative(generationsRoot, candidate);
  if (
    !isDockerContextExactDirectChild(generationsRoot, candidate)
    || relativePath !== generation.id
  ) {
    throw new DockerContextStateError(
      `Docker context generation must be an exact direct child of its state root: ${generation.path}`,
    );
  }
  const marker = parseCompleteRecord(candidate);
  if (marker.generationId !== generation.id) {
    throw new DockerContextStateError(`Docker context generation id does not match its marker: ${generation.id}`);
  }
  return candidate;
}

function beginAtomicOperation(
  paths: DockerContextGenerationPaths,
  ownerId: string,
  pid: number,
  kind: AtomicOperationRecord['kind'],
  migrationId?: string,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): AtomicOperationHandle {
  assertFreshManagedRoots(paths);
  validateIdentifier(ownerId, 'Docker context atomic operation owner');
  if (kind === 'legacy') {
    validateLegacyMigrationId(migrationId, 'Docker context legacy atomic migration id');
  } else if (migrationId !== undefined) {
    throw new DockerContextStateError('Only a legacy Docker context operation may carry a migration id.');
  }
  const ownerPath = join(paths.atomicDir, ownerId);
  if (pathEntryExists(ownerPath)) {
    throw new DockerContextStateError(
      `Docker context atomic owner namespace already exists and cannot be reused: ${ownerId}`,
    );
  }
  const preparationPath = join(
    paths.atomicDir,
    `.prepare-${pid}-${randomBytes(8).toString('hex')}-${ownerId}`,
  );
  mkdirSync(preparationPath);
  const preparationIdentity = captureExactOwnedDirectory(preparationPath, paths.atomicDir);
  faultInjector?.('after-atomic-preparation-owner');
  const operationName = randomBytes(8).toString('hex');
  const preparationOperationPath = join(preparationPath, operationName);
  mkdirSync(preparationOperationPath);
  const operationIdentity = captureExactOwnedDirectory(
    preparationOperationPath,
    preparationPath,
  );
  faultInjector?.('after-atomic-preparation-operation');
  const owner: AtomicOperationRecord = {
    schemaVersion: STATE_SCHEMA_VERSION,
    ownerId,
    pid,
    kind,
    ...(migrationId ? { migrationId } : {}),
  };
  const ownerRecordPath = join(preparationOperationPath, 'owner.json');
  writeJsonAtomic(ownerRecordPath, owner, true, owner.pid);
  faultInjector?.('after-atomic-preparation-record');
  assertFreshManagedRoots(paths);
  assertOwnedDirectoryIdentity(preparationPath, preparationIdentity);
  assertOwnedDirectoryIdentity(preparationOperationPath, operationIdentity);
  const preparedOwnerFile = captureExactFileEvidence(
    ownerRecordPath,
    preparationOperationPath,
  );
  try {
    linkSync(ownerRecordPath, ownerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DockerContextStateError(
        `Docker context atomic owner namespace already exists and cannot be reused: ${ownerId}`,
      );
    }
    throw error;
  }
  syncPath(paths.atomicDir);
  const ownerFile = captureExactFileEvidence(ownerPath, paths.atomicDir);
  if (
    !sameFilesystemIdentity(ownerFile, preparedOwnerFile)
    || ownerFile.contents !== preparedOwnerFile.contents
  ) {
    throw new DockerContextStateError(
      `Docker context atomic owner claim does not match its prepared operation: ${ownerId}`,
    );
  }
  faultInjector?.('after-atomic-owner-publication');
  assertFreshManagedRoots(paths);
  assertOwnedDirectoryIdentity(preparationPath, preparationIdentity);
  assertOwnedDirectoryIdentity(preparationOperationPath, operationIdentity);
  assertExactFileEvidence(ownerPath, paths.atomicDir, ownerFile);
  return {
    ownerPath,
    ownerFile,
    owner,
    preparationPath,
    preparationIdentity,
    operationPath: preparationOperationPath,
    operationIdentity,
    preparationOwnerFile: preparedOwnerFile,
    temporaryPointerPath: join(preparationOperationPath, 'pointer'),
  };
}

function captureExactOwnedDirectory(path: string, parentPath: string): FilesystemIdentity {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new DockerContextStateError(`Docker context owned namespace is not a real directory: ${path}`);
  }
  const canonicalParent = realpathSync(parentPath);
  if (dirname(realpathSync(path)) !== canonicalParent) {
    throw new DockerContextStateError(`Docker context owned namespace escapes its exact parent: ${path}`);
  }
  return { device: info.dev, inode: info.ino };
}

function sameFilesystemIdentity(
  left: FilesystemIdentity,
  right: FilesystemIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function captureExactFileEvidence(path: string, parentPath: string): ExactFileEvidence {
  if (
    dirname(resolve(path)) !== resolve(parentPath)
    || realpathSync(dirname(path)) !== realpathSync(parentPath)
  ) {
    throw new DockerContextStateError(`Docker context evidence file escapes its exact parent: ${path}`);
  }
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new DockerContextStateError(`Docker context evidence is not a regular file: ${path}`);
  }
  const contents = readFileSync(path, 'utf-8');
  const after = lstatSync(path);
  const identity = { device: before.dev, inode: before.ino };
  if (
    !after.isFile()
    || after.isSymbolicLink()
    || !sameFilesystemIdentity(identity, { device: after.dev, inode: after.ino })
  ) {
    throw new DockerContextStateError(`Docker context evidence identity changed while reading: ${path}`);
  }
  return { ...identity, contents };
}

function assertExactFileEvidence(
  path: string,
  parentPath: string,
  expected: ExactFileEvidence,
): void {
  const actual = captureExactFileEvidence(path, parentPath);
  if (!sameFilesystemIdentity(actual, expected) || actual.contents !== expected.contents) {
    throw new DockerContextStateError(`Docker context durable evidence changed unexpectedly: ${path}`);
  }
}

function removeExactFileEvidence(evidence: ExactFileDeletionEvidence): void {
  assertExactFileEvidence(evidence.path, evidence.parentPath, evidence.file);
  unlinkSync(evidence.path);
}

function captureExactSymlinkEvidence(
  path: string,
  parentPath: string,
): ExactSymlinkEvidence {
  if (
    dirname(resolve(path)) !== resolve(parentPath)
    || realpathSync(dirname(path)) !== realpathSync(parentPath)
  ) {
    throw new DockerContextStateError(`Docker context evidence symlink escapes its exact parent: ${path}`);
  }
  const before = lstatSync(path);
  if (!before.isSymbolicLink()) {
    throw new DockerContextStateError(`Docker context evidence is not a symbolic link: ${path}`);
  }
  const target = readlinkSync(path);
  const after = lstatSync(path);
  const identity = { device: before.dev, inode: before.ino };
  if (
    !after.isSymbolicLink()
    || !sameFilesystemIdentity(identity, { device: after.dev, inode: after.ino })
  ) {
    throw new DockerContextStateError(`Docker context symlink evidence identity changed while reading: ${path}`);
  }
  return { ...identity, target };
}

function assertExactSymlinkEvidence(
  path: string,
  parentPath: string,
  expected: ExactSymlinkEvidence,
): void {
  const actual = captureExactSymlinkEvidence(path, parentPath);
  if (!sameFilesystemIdentity(actual, expected) || actual.target !== expected.target) {
    throw new DockerContextStateError(`Docker context durable symlink evidence changed unexpectedly: ${path}`);
  }
}

function captureAtomicPointerEvidence(
  paths: DockerContextGenerationPaths,
  operationPath: string,
  owner: AtomicOperationRecord,
): AtomicPointerEvidence {
  if (owner.kind === 'legacy') {
    throw new DockerContextStateError(
      `Legacy Docker context atomic preparation cannot contain a temporary pointer: ${operationPath}`,
    );
  }
  const path = join(operationPath, 'pointer');
  const file = captureExactSymlinkEvidence(path, operationPath);
  const finalPointerPath = owner.kind === 'current' ? paths.currentPath : paths.exportPath;
  const pointerParent = realpathSync(dirname(finalPointerPath));
  const generationsRoot = realpathSync(paths.generationsDir);
  const generationPath = resolve(pointerParent, file.target);
  const generationId = relative(generationsRoot, generationPath);
  if (
    !generationId
    || generationId === '..'
    || generationId.startsWith(`..${sep}`)
    || generationId.includes(sep)
    || resolve(generationsRoot, generationId) !== generationPath
  ) {
    throw new DockerContextStateError(
      `Docker context atomic temporary pointer does not name a direct generation: ${path}`,
    );
  }
  validateGenerationIdentifier(generationId);
  const expectedTarget = relative(pointerParent, resolve(generationsRoot, generationId));
  if (file.target !== expectedTarget) {
    throw new DockerContextStateError(
      `Docker context atomic temporary pointer uses the wrong parent convention: ${path}`,
    );
  }
  assertExactSymlinkEvidence(path, operationPath, file);
  return { path, file, generationId, generationPath };
}

function assertAtomicPointerEvidence(
  operationPath: string,
  pointer: AtomicPointerEvidence,
): void {
  if (pointer.path !== join(operationPath, 'pointer')) {
    throw new DockerContextStateError(
      `Docker context atomic temporary pointer changed its exact path: ${pointer.path}`,
    );
  }
  assertExactSymlinkEvidence(pointer.path, operationPath, pointer.file);
}

function assertOwnedDirectoryIdentity(path: string, expected: FilesystemIdentity): void {
  const info = lstatSync(path);
  if (
    !info.isDirectory()
    || info.isSymbolicLink()
    || info.dev !== expected.device
    || info.ino !== expected.inode
  ) {
    throw new DockerContextStateError(`Docker context owned namespace identity changed: ${path}`);
  }
}

type ExactDirectoryEntryKind = 'directory' | 'file' | 'symlink';

function assertExactDirectoryShape(
  path: string,
  expected: ReadonlyMap<string, ExactDirectoryEntryKind>,
  sharedInventory?: StateInventoryBudget,
): void {
  const inventory = sharedInventory
    ?? new StateInventoryBudget(Math.max(1, expected.size + 1));
  const entries = inventory.read(path);
  if (entries.length !== expected.size) {
    throw new DockerContextStateError(
      `Docker context owned namespace changed its exact shape: ${path}`,
    );
  }
  for (const entry of entries) {
    const expectedKind = expected.get(entry.name);
    const matches = expectedKind === 'directory'
      ? entry.isDirectory() && !entry.isSymbolicLink()
      : expectedKind === 'file'
        ? entry.isFile() && !entry.isSymbolicLink()
        : expectedKind === 'symlink'
          ? entry.isSymbolicLink()
          : false;
    if (!matches) {
      throw new DockerContextStateError(
        `Docker context owned namespace changed its exact shape: ${path}`,
      );
    }
  }
}

function exactOwnedTreeKind(evidence: ExactOwnedTreeEvidence): ExactDirectoryEntryKind {
  return evidence.kind === 'directory' ? 'directory' : evidence.kind;
}

function expectedExactOwnedTreeShape(
  entries: readonly ExactOwnedTreeEvidence[],
): ReadonlyMap<string, ExactDirectoryEntryKind> {
  return new Map(entries.map((entry) => [basename(entry.path), exactOwnedTreeKind(entry)]));
}

function captureExactOwnedLeafEvidence(
  path: string,
  parentPath: string,
  kind: ExactOwnedLeafEvidence['kind'],
): ExactOwnedLeafEvidence {
  if (
    dirname(resolve(path)) !== resolve(parentPath)
    || realpathSync(dirname(path)) !== realpathSync(parentPath)
  ) {
    throw new DockerContextStateError(
      `Docker context owned artifact leaf escapes its exact parent: ${path}`,
    );
  }
  const before = lstatSync(path);
  const matchesKind = kind === 'file'
    ? before.isFile() && !before.isSymbolicLink()
    : before.isSymbolicLink();
  if (!matchesKind) {
    throw new DockerContextStateError(
      `Docker context owned artifact leaf changed type: ${path}`,
    );
  }
  const target = kind === 'symlink' ? readlinkSync(path) : undefined;
  const after = lstatSync(path);
  const identity = { device: before.dev, inode: before.ino };
  const stillMatchesKind = kind === 'file'
    ? after.isFile() && !after.isSymbolicLink()
    : after.isSymbolicLink();
  if (
    !stillMatchesKind
    || !sameFilesystemIdentity(identity, { device: after.dev, inode: after.ino })
  ) {
    throw new DockerContextStateError(
      `Docker context owned artifact leaf identity changed while reading: ${path}`,
    );
  }
  return {
    ...identity,
    path,
    parentPath,
    kind,
    ...(target === undefined ? {} : { target }),
  };
}

function captureExactOwnedDirectoryTreeSnapshot(
  path: string,
  parentPath: string,
  inventory: StateInventoryBudget,
): ExactOwnedDirectoryTreeEvidence {
  const identity = captureExactOwnedDirectory(path, parentPath);
  const entries = inventory.read(path).map((entry): ExactOwnedTreeEvidence => {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      return captureExactOwnedLeafEvidence(entryPath, path, 'symlink');
    }
    if (entry.isFile()) {
      return captureExactOwnedLeafEvidence(entryPath, path, 'file');
    }
    if (entry.isDirectory()) {
      return captureExactOwnedDirectoryTreeSnapshot(entryPath, path, inventory);
    }
    throw new DockerContextStateError(
      `Unsupported Docker context owned artifact entry: ${entryPath}`,
    );
  });
  return {
    ...identity,
    path,
    parentPath,
    kind: 'directory',
    entries,
  };
}

function captureExactOwnedDirectoryTree(
  path: string,
  parentPath: string,
  inventory: StateInventoryBudget,
): ExactOwnedDirectoryTreeEvidence {
  const evidence = captureExactOwnedDirectoryTreeSnapshot(path, parentPath, inventory);
  assertExactOwnedDirectoryTreeEvidence(evidence, inventory);
  return evidence;
}

function assertExactOwnedLeafEvidence(evidence: ExactOwnedLeafEvidence): void {
  const actual = captureExactOwnedLeafEvidence(
    evidence.path,
    evidence.parentPath,
    evidence.kind,
  );
  if (
    !sameFilesystemIdentity(actual, evidence)
    || actual.target !== evidence.target
  ) {
    throw new DockerContextStateError(
      `Docker context owned artifact leaf changed unexpectedly: ${evidence.path}`,
    );
  }
}

function assertExactOwnedTreeEvidence(
  evidence: ExactOwnedTreeEvidence,
  sharedInventory?: StateInventoryBudget,
): void {
  if (evidence.kind === 'directory') {
    assertExactOwnedDirectoryTreeEvidence(evidence, sharedInventory);
  } else {
    assertExactOwnedLeafEvidence(evidence);
  }
}

function assertExactOwnedDirectoryTreeEvidence(
  evidence: ExactOwnedDirectoryTreeEvidence,
  sharedInventory?: StateInventoryBudget,
): void {
  const actual = captureExactOwnedDirectory(evidence.path, evidence.parentPath);
  if (!sameFilesystemIdentity(actual, evidence)) {
    throw new DockerContextStateError(
      `Docker context owned artifact directory changed unexpectedly: ${evidence.path}`,
    );
  }
  assertExactDirectoryShape(
    evidence.path,
    expectedExactOwnedTreeShape(evidence.entries),
    sharedInventory,
  );
  for (const entry of evidence.entries) {
    assertExactOwnedTreeEvidence(entry, sharedInventory);
  }
  assertOwnedDirectoryIdentity(evidence.path, evidence);
}

function removeExactOwnedDirectoryTree(
  evidence: ExactOwnedDirectoryTreeEvidence,
  sharedInventory?: StateInventoryBudget,
): void {
  removeValidatedExactOwnedDirectoryTree(evidence, sharedInventory);
}

function removeValidatedExactOwnedDirectoryTree(
  evidence: ExactOwnedDirectoryTreeEvidence,
  sharedInventory?: StateInventoryBudget,
): void {
  assertOwnedDirectoryIdentity(evidence.path, evidence);
  assertExactDirectoryShape(
    evidence.path,
    expectedExactOwnedTreeShape(evidence.entries),
    sharedInventory,
  );
  for (const entry of evidence.entries) {
    assertOwnedDirectoryIdentity(evidence.path, evidence);
    if (entry.kind === 'directory') {
      const actual = captureExactOwnedDirectory(entry.path, entry.parentPath);
      if (!sameFilesystemIdentity(actual, entry)) {
        throw new DockerContextStateError(
          `Docker context owned artifact directory changed unexpectedly: ${entry.path}`,
        );
      }
      removeValidatedExactOwnedDirectoryTree(entry, sharedInventory);
    } else {
      assertExactOwnedLeafEvidence(entry);
      unlinkSync(entry.path);
    }
  }
  assertOwnedDirectoryIdentity(evidence.path, evidence);
  assertExactDirectoryShape(evidence.path, new Map(), sharedInventory);
  rmdirSync(evidence.path);
}

function assertAtomicPreparationEvidence(
  preparation: AtomicPreparationEvidence,
  sharedInventory?: StateInventoryBudget,
): void {
  assertOwnedDirectoryIdentity(preparation.path, preparation.identity);
  const operationName = preparation.operationPath
    ? basename(preparation.operationPath)
    : undefined;
  assertExactDirectoryShape(
    preparation.path,
    new Map(operationName ? [[operationName, 'directory' as const]] : []),
    sharedInventory,
  );
  if (preparation.operationPath && preparation.operationIdentity) {
    assertOwnedDirectoryIdentity(
      preparation.operationPath,
      preparation.operationIdentity,
    );
    assertExactDirectoryShape(
      preparation.operationPath,
      new Map([
        ...(preparation.ownerFile ? [['owner.json', 'file' as const] as const] : []),
        ...(preparation.pointer ? [['pointer', 'symlink' as const] as const] : []),
      ]),
      sharedInventory,
    );
  }
  if (preparation.ownerFile && preparation.operationPath) {
    assertExactFileEvidence(
      join(preparation.operationPath, 'owner.json'),
      preparation.operationPath,
      preparation.ownerFile,
    );
  }
  if (preparation.pointer && preparation.operationPath) {
    assertAtomicPointerEvidence(preparation.operationPath, preparation.pointer);
  }
}

function removeExactAtomicPreparation(
  preparation: AtomicPreparationEvidence,
  sharedInventory?: StateInventoryBudget,
): void {
  assertAtomicPreparationEvidence(preparation, sharedInventory);
  if (preparation.pointer && preparation.operationPath) {
    unlinkSync(preparation.pointer.path);
    assertExactDirectoryShape(
      preparation.operationPath,
      new Map(preparation.ownerFile ? [['owner.json', 'file' as const]] : []),
      sharedInventory,
    );
  }
  if (preparation.ownerFile && preparation.operationPath) {
    assertExactFileEvidence(
      join(preparation.operationPath, 'owner.json'),
      preparation.operationPath,
      preparation.ownerFile,
    );
    unlinkSync(join(preparation.operationPath, 'owner.json'));
    assertExactDirectoryShape(preparation.operationPath, new Map(), sharedInventory);
  }
  if (preparation.operationPath) {
    assertOwnedDirectoryIdentity(
      preparation.operationPath,
      preparation.operationIdentity!,
    );
    rmdirSync(preparation.operationPath);
    assertExactDirectoryShape(preparation.path, new Map(), sharedInventory);
  }
  assertOwnedDirectoryIdentity(preparation.path, preparation.identity);
  rmdirSync(preparation.path);
}

function removeExactAtomicClaim(
  paths: DockerContextGenerationPaths,
  claim: AtomicOwnerClaimEvidence,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
  sharedInventory?: StateInventoryBudget,
): void {
  assertFreshManagedRoots(paths);
  assertExactFileEvidence(claim.path, paths.atomicDir, claim.file);
  assertAtomicPreparationEvidence(claim.preparation, sharedInventory);
  unlinkSync(claim.path);
  syncPath(paths.atomicDir);
  faultInjector?.('after-atomic-cleanup-first-removal');
  assertFreshManagedRoots(paths);
  removeExactAtomicPreparation(claim.preparation, sharedInventory);
  syncPath(paths.atomicDir);
}

function finishAtomicOperation(
  paths: DockerContextGenerationPaths,
  operation: AtomicOperationHandle,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): void {
  const preparation: AtomicPreparationEvidence = {
    path: operation.preparationPath,
    identity: operation.preparationIdentity,
    ownerId: operation.owner.ownerId,
    pid: operation.owner.pid,
    stage: operation.temporaryPointer ? 'pointer' : 'record',
    operationPath: operation.operationPath,
    operationIdentity: operation.operationIdentity,
    ownerFile: operation.preparationOwnerFile,
    owner: operation.owner,
    ...(operation.temporaryPointer ? { pointer: operation.temporaryPointer } : {}),
  };
  removeExactAtomicClaim(paths, {
    path: operation.ownerPath,
    file: operation.ownerFile,
    owner: operation.owner,
    preparation,
  }, faultInjector);
}

function publishPointer(
  paths: DockerContextGenerationPaths,
  pointerPath: string,
  generationPath: string,
  operation: AtomicOperationHandle,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): void {
  assertFreshManagedRoots(paths);
  const pointerParent = dirname(pointerPath);
  const canonicalPointerParent = realpathSync(pointerParent);
  assertPointerReplaceable(paths, pointerPath);
  assertExactFileEvidence(operation.ownerPath, paths.atomicDir, operation.ownerFile);
  assertOwnedDirectoryIdentity(operation.preparationPath, operation.preparationIdentity);
  assertOwnedDirectoryIdentity(operation.operationPath, operation.operationIdentity);
  symlinkSync(
    relative(canonicalPointerParent, generationPath),
    operation.temporaryPointerPath,
    'dir',
  );
  faultInjector?.('after-atomic-temporary-pointer-created');
  syncPath(operation.operationPath);
  const temporaryPointer = captureAtomicPointerEvidence(
    paths,
    operation.operationPath,
    operation.owner,
  );
  operation.temporaryPointer = temporaryPointer;
  if (temporaryPointer.generationPath !== resolve(generationPath)) {
    throw new DockerContextStateError(
      `Docker context atomic temporary pointer changed its generation: ${operation.temporaryPointerPath}`,
    );
  }
  faultInjector?.('after-atomic-temporary-pointer');
  assertFreshManagedRoots(paths);
  assertExactFileEvidence(operation.ownerPath, paths.atomicDir, operation.ownerFile);
  assertOwnedDirectoryIdentity(operation.preparationPath, operation.preparationIdentity);
  assertOwnedDirectoryIdentity(operation.operationPath, operation.operationIdentity);
  assertAtomicPointerEvidence(operation.operationPath, temporaryPointer);
  assertPointerReplaceable(paths, pointerPath);
  renameSync(operation.temporaryPointerPath, pointerPath);
  delete operation.temporaryPointer;
  syncPath(pointerParent);
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertPointerReplaceable(
  paths: DockerContextGenerationPaths,
  pointerPath: string,
): void {
  if (pathEntryExists(pointerPath)) parsePointerGeneration(paths, pointerPath);
}

function publishOwnedPointer(
  paths: DockerContextGenerationPaths,
  lease: DockerContextLease,
  generation: DockerContextGeneration,
  kind: 'current' | 'export',
  pid: number,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): DockerContextLease {
  return withLeaseTransition(paths, lease.id, pid, faultInjector, () => {
    let owner = readLease(paths, lease.id);
    assertLeaseProcessOwner(owner, pid);
    if (owner.state === 'released') {
      throw new DockerContextStateError(
        `A released Docker context lease cannot publish or repin a generation: ${lease.id}`,
      );
    }
    const generationPath = assertGeneration(paths, generation);
    const marker = parseCompleteRecord(generationPath);
    if (
      !owner.generationId
      || owner.generationId !== generation.id
      || marker.leaseId !== owner.id
    ) {
      throw new DockerContextStateError(
        `Docker context pointer publication requires its generation's matching owner lease: ${lease.id}`,
      );
    }
    const pointerPath = kind === 'current' ? paths.currentPath : paths.exportPath;
    assertPointerReplaceable(paths, pointerPath);
    const operation = beginAtomicOperation(paths, owner.id, pid, kind, undefined, faultInjector);
    try {
      if (owner.state === 'preconsumer') {
        owner = { ...owner, state: 'consuming' };
        assertFreshManagedRoots(paths);
        writeJsonAtomic(join(paths.leasesDir, `${lease.id}.json`), owner, false, owner.pid);
      }
      if (owner.state !== 'consuming') {
        throw new DockerContextStateError(`Docker context pointer owner is not consuming: ${lease.id}`);
      }
      publishPointer(paths, pointerPath, generationPath, operation, faultInjector);
      return toLease(paths, owner);
    } finally {
      finishAtomicOperation(paths, operation, faultInjector);
    }
  });
}

function publishLegacyPointerIfAbsent(
  paths: DockerContextGenerationPaths,
  generationPath: string,
  evidence: LegacyMigrationEvidence,
  pid: number,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): DockerContextGeneration {
  const pointerParent = dirname(paths.currentPath);
  const canonicalPointerParent = realpathSync(pointerParent);
  const operation = beginAtomicOperation(
    paths,
    'legacy-migration',
    pid,
    'legacy',
    evidence.migration.migrationId,
    faultInjector,
  );
  try {
    try {
      assertLegacyMigrationEvidenceAt(paths, evidence, generationPath);
      assertFreshManagedRoots(paths);
      assertExactFileEvidence(operation.ownerPath, paths.atomicDir, operation.ownerFile);
      assertOwnedDirectoryIdentity(
        operation.preparationPath,
        operation.preparationIdentity,
      );
      assertOwnedDirectoryIdentity(operation.operationPath, operation.operationIdentity);
      symlinkSync(relative(canonicalPointerParent, generationPath), paths.currentPath, 'dir');
      syncPath(pointerParent);
      return { id: LEGACY_GENERATION_ID, path: generationPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = parsePointerGeneration(paths, paths.currentPath);
      if (!current) {
        throw new DockerContextStateError('Docker context current pointer disappeared during legacy recovery.');
      }
      return current;
    }
  } finally {
    finishAtomicOperation(paths, operation, faultInjector);
  }
}

function parsePointerGeneration(
  paths: DockerContextGenerationPaths,
  pointerPath: string,
): DockerContextGeneration | null {
  for (let attempt = 0; attempt < MAX_POINTER_SNAPSHOT_ATTEMPTS; attempt += 1) {
    let before;
    try {
      before = lstatSync(pointerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (!before.isSymbolicLink()) {
      throw new DockerContextStateError(`Docker context pointer is not a symbolic link: ${pointerPath}`);
    }
    const beforeIdentity = { device: before.dev, inode: before.ino };
    try {
      const generationPath = realpathSync(pointerPath);
      const marker = parseCompleteRecord(generationPath);
      assertGeneration(paths, { id: marker.generationId, path: generationPath }, true);
      const after = lstatSync(pointerPath);
      if (
        after.isSymbolicLink()
        && sameFilesystemIdentity(beforeIdentity, { device: after.dev, inode: after.ino })
      ) {
        return { id: marker.generationId, path: generationPath };
      }
      continue;
    } catch (error) {
      let after;
      try {
        after = lstatSync(pointerPath);
      } catch (afterError) {
        if ((afterError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw afterError;
      }
      if (
        after.isSymbolicLink()
        && !sameFilesystemIdentity(beforeIdentity, { device: after.dev, inode: after.ino })
      ) {
        continue;
      }
      if (error instanceof DockerContextStateError) throw error;
      throw new DockerContextStateError(
        `Docker context pointer is dangling or unreadable: ${pointerPath}. `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new DockerContextStateError(
    `Docker context pointer changed during ${MAX_POINTER_SNAPSHOT_ATTEMPTS} bounded validation attempts: ${pointerPath}`,
  );
}

function readLegacyCompleteMarkerIfPresent(path: string): CompleteRecord | null {
  const completeMarkerPath = markerPath(path);
  let info;
  try {
    info = lstatSync(completeMarkerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new DockerContextStateError(
      `Legacy Docker context complete marker is not a regular file: ${completeMarkerPath}`,
    );
  }
  const existing = parseCompleteRecord(path, LEGACY_GENERATION_ID);
  if (
    existing.generationId !== LEGACY_GENERATION_ID
    || existing.leaseId !== 'legacy-migration'
  ) {
    throw new DockerContextStateError(`Legacy Docker context has a conflicting complete marker: ${path}`);
  }
  return existing;
}

function assertLegacyMigrationBinding(
  generationPath: string,
  migration: LegacyMigrationRecord,
): CompleteRecord {
  const marker = readLegacyCompleteMarkerIfPresent(generationPath);
  if (!marker || marker.migrationId !== migration.migrationId) {
    throw new DockerContextStateError(
      `Legacy Docker context migration identity does not match its complete marker: ${generationPath}`,
    );
  }
  return marker;
}

function assertSameLegacyMigration(
  actual: LegacyMigrationRecord,
  expected: LegacyMigrationRecord,
): void {
  for (const key of [
    'schemaVersion',
    'generationId',
    'source',
    'destination',
    'pid',
    'migrationId',
  ] as const) {
    if (actual[key] !== expected[key]) {
      throw new DockerContextStateError(
        `Docker context legacy migration evidence changed at ${key}.`,
      );
    }
  }
}

function captureLegacyMigrationEvidence(
  paths: DockerContextGenerationPaths,
  generationPath: string,
  migration: LegacyMigrationRecord,
): LegacyMigrationEvidence {
  assertFreshManagedRoots(paths);
  let generationIdentity: FilesystemIdentity;
  if (generationPath === migration.destination) {
    assertGeneration(paths, {
      id: LEGACY_GENERATION_ID,
      path: generationPath,
    });
    generationIdentity = captureExactOwnedDirectory(generationPath, paths.generationsDir);
  } else if (generationPath === migration.source) {
    generationIdentity = captureExactOwnedDirectory(generationPath, paths.targetsDir);
  } else {
    throw new DockerContextStateError(
      `Legacy Docker context evidence uses an unrelated generation path: ${generationPath}`,
    );
  }
  assertLegacyMigrationBinding(generationPath, migration);
  const marker = captureExactFileEvidence(markerPath(generationPath), generationPath);
  const journal = captureExactFileEvidence(paths.legacyMigrationPath, paths.stateDir);
  const durableMigration = parseLegacyMigration(paths);
  assertSameLegacyMigration(durableMigration, migration);
  assertLegacyMigrationBinding(generationPath, durableMigration);
  assertExactFileEvidence(markerPath(generationPath), generationPath, marker);
  assertExactFileEvidence(paths.legacyMigrationPath, paths.stateDir, journal);
  return {
    migration,
    generationPath,
    generationIdentity,
    marker,
    journal,
  };
}

function assertLegacyMigrationEvidenceAt(
  paths: DockerContextGenerationPaths,
  evidence: LegacyMigrationEvidence,
  generationPath: string,
): void {
  assertFreshManagedRoots(paths);
  if (generationPath === evidence.migration.destination) {
    assertGeneration(paths, {
      id: LEGACY_GENERATION_ID,
      path: generationPath,
    });
  } else if (generationPath !== evidence.migration.source) {
    throw new DockerContextStateError(
      `Legacy Docker context evidence moved to an unrelated path: ${generationPath}`,
    );
  }
  assertOwnedDirectoryIdentity(generationPath, evidence.generationIdentity);
  assertExactFileEvidence(markerPath(generationPath), generationPath, evidence.marker);
  assertExactFileEvidence(paths.legacyMigrationPath, paths.stateDir, evidence.journal);
  const durableMigration = parseLegacyMigration(paths);
  assertSameLegacyMigration(durableMigration, evidence.migration);
  assertLegacyMigrationBinding(generationPath, durableMigration);
  assertExactFileEvidence(markerPath(generationPath), generationPath, evidence.marker);
  assertExactFileEvidence(paths.legacyMigrationPath, paths.stateDir, evidence.journal);
  assertOwnedDirectoryIdentity(generationPath, evidence.generationIdentity);
}

function capturePresentLegacyMigrationEvidence(
  paths: DockerContextGenerationPaths,
  migration: LegacyMigrationRecord,
): LegacyMigrationEvidence {
  const destinationExists = pathEntryExists(migration.destination);
  let currentInfo: ReturnType<typeof lstatSync> | null = null;
  try {
    currentInfo = lstatSync(migration.source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (
    destinationExists
    && currentInfo?.isDirectory()
    && !currentInfo.isSymbolicLink()
  ) {
    throw new DockerContextStateError(
      'Both live and retired legacy Docker contexts exist; refusing ambiguous evidence.',
    );
  }
  if (destinationExists) {
    return captureLegacyMigrationEvidence(paths, migration.destination, migration);
  }
  if (currentInfo?.isDirectory() && !currentInfo.isSymbolicLink()) {
    return captureLegacyMigrationEvidence(paths, migration.source, migration);
  }
  throw new DockerContextStateError(
    'Legacy Docker context atomic work has no exact source or destination evidence.',
  );
}

function captureLegacyAtomicOperationEvidence(
  paths: DockerContextGenerationPaths,
  migrationEvidence: LegacyMigrationEvidence,
  inventory: StateInventoryBudget,
): LegacyAtomicOperationEvidence {
  const ownerPath = join(paths.atomicDir, 'legacy-migration');
  const ownerIdentity = captureExactOwnedDirectory(ownerPath, paths.atomicDir);
  const operations = inventory.read(ownerPath);
  if (operations.length !== 1 || !operations[0]?.isDirectory()) {
    throw new DockerContextStateError(
      `Malformed Docker context legacy atomic owner namespace: ${ownerPath}`,
    );
  }
  const operationPath = join(ownerPath, operations[0].name);
  const operationIdentity = captureExactOwnedDirectory(operationPath, ownerPath);
  const contents = inventory.read(operationPath);
  if (
    contents.length !== 1
    || contents[0].name !== 'owner.json'
    || !contents[0].isFile()
    || contents[0].isSymbolicLink()
  ) {
    throw new DockerContextStateError(
      `Malformed Docker context legacy atomic operation: ${operationPath}`,
    );
  }
  const ownerFile = captureExactFileEvidence(join(operationPath, 'owner.json'), operationPath);
  const owner = parseAtomicOperation(join(operationPath, 'owner.json'));
  if (
    owner.ownerId !== 'legacy-migration'
    || owner.kind !== 'legacy'
    || owner.migrationId !== migrationEvidence.migration.migrationId
  ) {
    throw new DockerContextStateError(
      `Docker context legacy atomic operation has conflicting authority: ${operationPath}`,
    );
  }
  assertExactFileEvidence(join(operationPath, 'owner.json'), operationPath, ownerFile);
  assertOwnedDirectoryIdentity(ownerPath, ownerIdentity);
  assertOwnedDirectoryIdentity(operationPath, operationIdentity);
  return {
    ownerPath,
    ownerIdentity,
    operationPath,
    operationIdentity,
    ownerFile,
    owner,
  };
}

function removeExactLegacyAtomicOperation(
  operation: LegacyAtomicOperationEvidence,
  sharedInventory?: StateInventoryBudget,
): void {
  assertOwnedDirectoryIdentity(operation.ownerPath, operation.ownerIdentity);
  assertExactDirectoryShape(
    operation.ownerPath,
    new Map([[basename(operation.operationPath), 'directory']]),
    sharedInventory,
  );
  assertOwnedDirectoryIdentity(operation.operationPath, operation.operationIdentity);
  assertExactDirectoryShape(
    operation.operationPath,
    new Map([['owner.json', 'file']]),
    sharedInventory,
  );
  assertExactFileEvidence(
    join(operation.operationPath, 'owner.json'),
    operation.operationPath,
    operation.ownerFile,
  );
  unlinkSync(join(operation.operationPath, 'owner.json'));
  assertExactDirectoryShape(operation.operationPath, new Map(), sharedInventory);
  assertOwnedDirectoryIdentity(operation.operationPath, operation.operationIdentity);
  rmdirSync(operation.operationPath);
  assertExactDirectoryShape(operation.ownerPath, new Map(), sharedInventory);
  assertOwnedDirectoryIdentity(operation.ownerPath, operation.ownerIdentity);
  rmdirSync(operation.ownerPath);
}

function reconcileLegacyAtomicNamespace(
  paths: DockerContextGenerationPaths,
  options: RuntimeOptions,
  inventory: StateInventoryBudget,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): void {
  const preparations: AtomicPreparationEvidence[] = [];
  let reclaimableClaim: AtomicOwnerClaimEvidence | null = null;
  let reclaimableOperation: {
    operation: LegacyAtomicOperationEvidence;
    migration: LegacyMigrationEvidence;
  } | null = null;
  const liveness = new Map<number, boolean>();
  const isAlive = (pid: number): boolean => {
    const prior = liveness.get(pid);
    if (prior !== undefined) return prior;
    const alive = options.processIsAlive(pid);
    liveness.set(pid, alive);
    return alive;
  };

  const atomicEntries = inventory.read(paths.atomicDir);
  for (const entry of atomicEntries) {
    const path = join(paths.atomicDir, entry.name);
    const preparation = parseAtomicPreparationName(entry.name);
    if (preparation?.ownerId === 'legacy-migration') {
      const evidence = captureAtomicPreparationEvidence(
        paths,
        entry,
        preparation,
        inventory,
      );
      if (
        evidence.owner
        && evidence.owner.migrationId
          !== readLegacyMigrationIfPresent(paths)?.migrationId
      ) {
        throw new DockerContextStateError(
          `Legacy atomic preparation has no matching durable migration authority: ${path}`,
        );
      }
      if (isAlive(evidence.pid)) {
        throw new DockerContextStateError(`Live legacy atomic preparation blocks recovery: ${path}`);
      }
      preparations.push(evidence);
      continue;
    }
    if (
      entry.name.startsWith('.prepare-')
      && entry.name.endsWith('-legacy-migration')
      && !preparation
    ) {
      throw new DockerContextStateError(`Malformed legacy atomic preparation name: ${path}`);
    }
  }

  for (const entry of atomicEntries) {
    if (entry.name !== 'legacy-migration') continue;
    const migration = readLegacyMigrationIfPresent(paths);
    if (!migration) {
      throw new DockerContextStateError(
        'Legacy atomic namespace has no exact durable migration journal.',
      );
    }
    const migrationEvidence = capturePresentLegacyMigrationEvidence(paths, migration);
    if (entry.isFile() && !entry.isSymbolicLink()) {
      const claim = captureAtomicOwnerClaimEvidence(
        paths,
        'legacy-migration',
        preparations,
      );
      if (
        claim.owner.kind !== 'legacy'
        || claim.owner.migrationId !== migration.migrationId
      ) {
        throw new DockerContextStateError(
          'Legacy atomic owner claim has conflicting durable migration authority.',
        );
      }
      if (isAlive(claim.owner.pid)) {
        throw new DockerContextStateError(
          'Live exact legacy atomic owner claim blocks cross-process recovery.',
        );
      }
      reclaimableClaim = claim;
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new DockerContextStateError(
        `Malformed Docker context legacy atomic owner namespace: ${join(paths.atomicDir, entry.name)}`,
      );
    }
    const operation = captureLegacyAtomicOperationEvidence(
      paths,
      migrationEvidence,
      inventory,
    );
    if (isAlive(operation.owner.pid)) {
      throw new DockerContextStateError(
        'Live exact legacy atomic operation blocks cross-process recovery.',
      );
    }
    reclaimableOperation = { operation, migration: migrationEvidence };
  }

  const unclaimedPreparations = preparations.filter(
    (preparation) => preparation.path !== reclaimableClaim?.preparation.path,
  );
  const reclaimableCount = unclaimedPreparations.length
    + (reclaimableClaim ? 1 : 0)
    + (reclaimableOperation ? 1 : 0);
  const deletionErrors: unknown[] = [];
  for (let offset = 0; offset < reclaimableCount; offset += options.deletionChunkSize) {
    const end = Math.min(reclaimableCount, offset + options.deletionChunkSize);
    for (let index = offset; index < end; index += 1) {
      assertFreshManagedRoots(paths);
      try {
        if (index < unclaimedPreparations.length) {
          removeExactAtomicPreparation(unclaimedPreparations[index], inventory);
        } else {
          const claimIndex = index - unclaimedPreparations.length;
          if (claimIndex === 0 && reclaimableClaim) {
            removeExactAtomicClaim(paths, reclaimableClaim, faultInjector, inventory);
          } else {
            const exact = reclaimableOperation!;
            assertLegacyMigrationEvidenceAt(
              paths,
              exact.migration,
              exact.migration.generationPath,
            );
            assertOwnedDirectoryIdentity(
              exact.operation.ownerPath,
              exact.operation.ownerIdentity,
            );
            assertOwnedDirectoryIdentity(
              exact.operation.operationPath,
              exact.operation.operationIdentity,
            );
            assertExactFileEvidence(
              join(exact.operation.operationPath, 'owner.json'),
              exact.operation.operationPath,
              exact.operation.ownerFile,
            );
            const owner = parseAtomicOperation(join(exact.operation.operationPath, 'owner.json'));
            if (
              owner.ownerId !== exact.operation.owner.ownerId
              || owner.pid !== exact.operation.owner.pid
              || owner.kind !== exact.operation.owner.kind
              || owner.migrationId !== exact.operation.owner.migrationId
            ) {
              throw new DockerContextStateError(
                'Legacy atomic operation authority changed before safe reclamation.',
              );
            }
            removeExactLegacyAtomicOperation(exact.operation, inventory);
          }
        }
      } catch (error) {
        deletionErrors.push(error);
      }
    }
    syncPath(paths.atomicDir);
    options.maintenanceObserver?.({
      phase: 'delete-chunk',
      chunkIndex: Math.floor(offset / options.deletionChunkSize),
      chunkSize: end - offset,
      remaining: Math.max(0, reclaimableCount - end),
    });
  }
  if (deletionErrors.length > 0) {
    throw new AggregateError(
      deletionErrors,
      `Legacy Docker context cleanup preserved one or more drifted items: ${
        deletionErrors.map((error) => (
          error instanceof Error ? error.message : String(error)
        )).join('; ')
      }`,
    );
  }
}

function writeLegacyCompleteMarker(path: string, migrationId: string): void {
  validateLegacyMigrationId(migrationId, 'Docker context legacy marker migration id');
  const existing = readLegacyCompleteMarkerIfPresent(path);
  if (existing) {
    if (existing.migrationId !== migrationId) {
      throw new DockerContextStateError(`Legacy Docker context has a conflicting migration identity: ${path}`);
    }
    return;
  }
  syncTree(path);
  const complete: CompleteRecord = {
    schemaVersion: STATE_SCHEMA_VERSION,
    generationId: LEGACY_GENERATION_ID,
    leaseId: 'legacy-migration',
    createdAt: new Date().toISOString(),
    migrationId,
  };
  writeJsonAtomic(markerPath(path), complete, true);
  syncPath(path);
}

function clearReconciledLegacyMigration(
  paths: DockerContextGenerationPaths,
  existingEvidence?: LegacyMigrationEvidence,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): void {
  assertFreshManagedRoots(paths);
  const presentMigration = readLegacyMigrationIfPresent(paths);
  if (!presentMigration) return;
  const migration = existingEvidence?.migration ?? presentMigration;
  assertSameLegacyMigration(presentMigration, migration);
  let recoveryInfo;
  try {
    recoveryInfo = lstatSync(migration.destination);
  } catch (error) {
    throw new DockerContextStateError(
      `Legacy Docker context migration journal has no recoverable destination. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!recoveryInfo.isDirectory() || recoveryInfo.isSymbolicLink()) {
    throw new DockerContextStateError('Legacy Docker context recovery destination has the wrong type.');
  }
  assertLegacyMigrationBinding(migration.destination, migration);
  if (pathEntryExists(join(paths.atomicDir, 'legacy-migration'))) return;
  const evidence = existingEvidence
    ?? captureLegacyMigrationEvidence(paths, migration.destination, migration);
  assertLegacyMigrationEvidenceAt(paths, evidence, migration.destination);
  assertFreshManagedRoots(paths);
  faultInjector?.('before-legacy-journal-clear');
  removeExactFileEvidence({
    path: paths.legacyMigrationPath,
    parentPath: paths.stateDir,
    file: evidence.journal,
  });
  syncPath(paths.stateDir);
}

function prepareLegacyMigration(
  paths: DockerContextGenerationPaths,
  pid: number,
  inventory: StateInventoryBudget,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): LegacyMigrationEvidence {
  // Existing journal evidence is always classified before the source marker or
  // any other recovery state can be created or changed.
  assertNoLegacyMigrationTemporaryEvidence(paths, inventory);
  const existingMigration = readLegacyMigrationIfPresent(paths);
  const existingMarker = readLegacyCompleteMarkerIfPresent(paths.currentPath);
  if (existingMigration) {
    assertLegacyMigrationBinding(paths.currentPath, existingMigration);
    return captureLegacyMigrationEvidence(paths, paths.currentPath, existingMigration);
  }

  const migrationId = existingMarker?.migrationId ?? randomBytes(16).toString('hex');
  validateLegacyMigrationId(migrationId, 'Docker context legacy migration id');
  if (!existingMarker) {
    assertFreshManagedRoots(paths);
    writeLegacyCompleteMarker(paths.currentPath, migrationId);
    faultInjector?.('after-legacy-marker');
  }

  const migration: LegacyMigrationRecord = {
    schemaVersion: STATE_SCHEMA_VERSION,
    generationId: LEGACY_GENERATION_ID,
    source: paths.currentPath,
    destination: paths.legacyRecoveryPath,
    pid,
    migrationId,
  };
  assertLegacyMigrationBinding(paths.currentPath, migration);
  assertFreshManagedRoots(paths);
  writeJsonAtomic(paths.legacyMigrationPath, migration, true, migration.pid);
  const durableMigration = parseLegacyMigration(paths);
  assertLegacyMigrationBinding(paths.currentPath, durableMigration);
  return captureLegacyMigrationEvidence(paths, paths.currentPath, durableMigration);
}

function recoverLegacyCurrent(
  paths: DockerContextGenerationPaths,
  pid: number,
  options: RuntimeOptions,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): DockerContextGeneration | null {
  const inventory = new StateInventoryBudget(
    options.maxInventoryEntries,
    options.maintenanceObserver,
  );
  reconcileLegacyAtomicNamespace(paths, options, inventory, faultInjector);
  let currentInfo: ReturnType<typeof lstatSync> | null = null;
  try {
    currentInfo = lstatSync(paths.currentPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (currentInfo?.isSymbolicLink()) {
    const current = parsePointerGeneration(paths, paths.currentPath);
    const migration = readLegacyMigrationIfPresent(paths);
    if (migration) {
      const evidence = captureLegacyMigrationEvidence(paths, migration.destination, migration);
      if (
        current?.id !== LEGACY_GENERATION_ID
        || current.path !== realpathSync(migration.destination)
      ) {
        throw new DockerContextStateError(
          'Docker context current pointer does not match its pending legacy migration.',
        );
      }
      assertLegacyMigrationEvidenceAt(paths, evidence, migration.destination);
    }
    clearReconciledLegacyMigration(paths, undefined, faultInjector);
    return current;
  }

  if (!currentInfo && pathEntryExists(paths.legacyRecoveryPath)) {
    const migration = readLegacyMigrationIfPresent(paths);
    if (!migration) {
      throw new DockerContextStateError(
        'Legacy Docker context recovery generation has no stable migration journal.',
      );
    }
    const evidence = captureLegacyMigrationEvidence(
      paths,
      paths.legacyRecoveryPath,
      migration,
    );
    const current = publishLegacyPointerIfAbsent(
      paths,
      paths.legacyRecoveryPath,
      evidence,
      pid,
      faultInjector,
    );
    faultInjector?.('after-legacy-pointer');
    if (
      current.id === LEGACY_GENERATION_ID
      && realpathSync(current.path) === realpathSync(paths.legacyRecoveryPath)
    ) {
      assertLegacyMigrationEvidenceAt(paths, evidence, paths.legacyRecoveryPath);
      clearReconciledLegacyMigration(paths, evidence, faultInjector);
    }
    return current;
  }

  if (!currentInfo) return null;
  if (!currentInfo.isDirectory()) {
    throw new DockerContextStateError(`Unsupported legacy Docker context pointer: ${paths.currentPath}`);
  }
  if (pathEntryExists(paths.legacyRecoveryPath)) {
    throw new DockerContextStateError('Both live and retired legacy Docker contexts exist; refusing to choose one.');
  }

  const evidence = prepareLegacyMigration(paths, pid, inventory, faultInjector);
  faultInjector?.('after-legacy-record');
  assertLegacyMigrationEvidenceAt(paths, evidence, paths.currentPath);
  renameSync(paths.currentPath, paths.legacyRecoveryPath);
  syncPath(paths.generationsDir);
  syncPath(paths.targetsDir);
  assertLegacyMigrationEvidenceAt(paths, evidence, paths.legacyRecoveryPath);
  faultInjector?.('after-legacy-rename');
  assertLegacyMigrationEvidenceAt(paths, evidence, paths.legacyRecoveryPath);
  const current = publishLegacyPointerIfAbsent(
    paths,
    paths.legacyRecoveryPath,
    evidence,
    pid,
    faultInjector,
  );
  faultInjector?.('after-legacy-pointer');
  if (
    current.id === LEGACY_GENERATION_ID
    && realpathSync(current.path) === realpathSync(paths.legacyRecoveryPath)
  ) {
    assertLegacyMigrationEvidenceAt(paths, evidence, paths.legacyRecoveryPath);
    clearReconciledLegacyMigration(paths, evidence, faultInjector);
  }
  return current;
}

function collectGarbage(
  paths: DockerContextGenerationPaths,
  options: RuntimeOptions,
  pid: number,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): void {
  const gcOwner = acquireGcOwner(paths, pid);
  let cleanupOwner = false;
  let primaryError: unknown;
  try {
    faultInjector?.('after-gc-owner');
    assertFreshManagedRoots(paths);
    assertOwnedDirectoryIdentity(paths.gcOwnerPath, gcOwner.identity);
    cleanupOwner = true;
    collectGarbageWithOwner(paths, options, faultInjector);
  } catch (error) {
    primaryError = error;
  }

  let cleanupError: unknown;
  if (cleanupOwner) {
    try {
      releaseGcOwner(paths, gcOwner);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `Docker context garbage collection failed: ${
        primaryError instanceof Error ? primaryError.message : String(primaryError)
      }; exact owner cleanup also failed: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`,
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
}

function acquireGcOwner(paths: DockerContextGenerationPaths, pid: number): ActiveGcOwner {
  assertFreshManagedRoots(paths);
  try {
    mkdirSync(paths.gcOwnerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DockerContextStateError(
        'Docker context garbage collection already has an owner and will not steal it automatically.',
      );
    }
    throw error;
  }
  const identity = captureExactOwnedDirectory(paths.gcOwnerPath, paths.stateDir);
  const owner: GcOwnerRecord = {
    schemaVersion: STATE_SCHEMA_VERSION,
    id: `${pid}-${randomBytes(8).toString('hex')}`,
    pid,
  };
  const ownerPath = join(paths.gcOwnerPath, 'owner.json');
  writeJsonAtomic(ownerPath, owner, true, owner.pid);
  const ownerFile = captureExactFileEvidence(ownerPath, paths.gcOwnerPath);
  syncPath(paths.stateDir);
  return { record: owner, identity, ownerFile };
}

function releaseGcOwner(paths: DockerContextGenerationPaths, expected: ActiveGcOwner): void {
  assertFreshManagedRoots(paths);
  assertOwnedDirectoryIdentity(paths.gcOwnerPath, expected.identity);
  assertExactDirectoryShape(
    paths.gcOwnerPath,
    new Map([['owner.json', 'file' as const] as const]),
  );
  const ownerPath = join(paths.gcOwnerPath, 'owner.json');
  assertExactFileEvidence(ownerPath, paths.gcOwnerPath, expected.ownerFile);
  const current = parseGcOwner(ownerPath);
  if (current.id !== expected.record.id || current.pid !== expected.record.pid) {
    throw new DockerContextStateError('Docker context garbage collector owner changed unexpectedly.');
  }
  removeExactFileEvidence({
    path: ownerPath,
    parentPath: paths.gcOwnerPath,
    file: expected.ownerFile,
  });
  assertExactDirectoryShape(paths.gcOwnerPath, new Map());
  assertOwnedDirectoryIdentity(paths.gcOwnerPath, expected.identity);
  rmdirSync(paths.gcOwnerPath);
  syncPath(paths.stateDir);
}

function collectGarbageWithOwner(
  paths: DockerContextGenerationPaths,
  options: RuntimeOptions,
  faultInjector?: (point: DockerContextGenerationFaultPoint) => void,
): void {
  const inventory = new StateInventoryBudget(
    options.maxInventoryEntries,
    options.maintenanceObserver,
  );
  const candidates = new Map<string, {
    path: string;
    marker: CompleteRecord;
    tree: ExactOwnedDirectoryTreeEvidence;
    markerFile: ExactFileEvidence;
  }>();
  for (const entry of inventory.read(paths.generationsDir)) {
    const generationPath = join(paths.generationsDir, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new DockerContextStateError(`Unexpected Docker context generation entry: ${generationPath}`);
    }
    validateGenerationIdentifier(entry.name, entry.name === LEGACY_GENERATION_ID);
    const tree = captureExactOwnedDirectoryTree(
      generationPath,
      paths.generationsDir,
      inventory,
    );
    const markerInfo = lstatSync(markerPath(generationPath));
    if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) {
      throw new DockerContextStateError(`Docker context complete marker is not a file: ${generationPath}`);
    }
    const markerFile = captureExactFileEvidence(markerPath(generationPath), generationPath);
    const marker = parseCompleteRecord(generationPath, entry.name);
    assertExactFileEvidence(markerPath(generationPath), generationPath, markerFile);
    if (
      entry.name === LEGACY_GENERATION_ID
      && marker.leaseId !== 'legacy-migration'
    ) {
      throw new DockerContextStateError('Legacy Docker context generation has the wrong owner identity.');
    }
    candidates.set(entry.name, {
      path: realpathSync(generationPath),
      marker,
      tree,
      markerFile,
    });
  }
  const legacyTemporaryRecords: Array<{
    path: string;
    record: LegacyMigrationRecord;
    file: ExactFileEvidence;
  }> = [];
  const stateDirectories = new Set([
    basename(paths.leasesDir),
    basename(paths.transitionsDir),
    basename(paths.atomicDir),
    basename(paths.stagingDir),
    basename(paths.bundleWorkDir),
    basename(paths.generationsDir),
    basename(paths.gcOwnerPath),
  ]);
  for (const entry of inventory.read(paths.stateDir)) {
    const path = join(paths.stateDir, entry.name);
    if (stateDirectories.has(entry.name)) {
      if (!entry.isDirectory()) {
        throw new DockerContextStateError(`Docker context state root has the wrong type: ${path}`);
      }
      continue;
    }
    if (entry.name === basename(paths.exportPath)) {
      if (!entry.isSymbolicLink()) {
        throw new DockerContextStateError(`Docker context export pointer has the wrong type: ${path}`);
      }
      continue;
    }
    if (entry.name === basename(paths.legacyMigrationPath)) {
      if (!entry.isFile()) {
        throw new DockerContextStateError(`Docker context legacy journal has the wrong type: ${path}`);
      }
      continue;
    }
    if (entry.isFile() && isLegacyJsonTemporaryName(paths, entry.name)) {
      const file = captureExactFileEvidence(path, paths.stateDir);
      const record = parseLegacyMigrationAt(paths, path);
      if (!isLegacyJsonTemporaryName(paths, entry.name, record)) {
        throw new DockerContextStateError(`Legacy Docker context temporary owner mismatch: ${path}`);
      }
      assertExactFileEvidence(path, paths.stateDir, file);
      legacyTemporaryRecords.push({ path, record, file });
      continue;
    }
    throw new DockerContextStateError(`Unknown Docker context state-root artifact: ${path}`);
  }
  const legacyMigration = readLegacyMigrationIfPresent(paths);
  if (legacyMigration) {
    const recovery = candidates.get(LEGACY_GENERATION_ID);
    if (recovery) {
      if (recovery.marker.migrationId !== legacyMigration.migrationId) {
        throw new DockerContextStateError(
          'Legacy Docker context recovery generation has the wrong migration identity.',
        );
      }
    } else {
      const sourceInfo = lstatSync(legacyMigration.source);
      if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
        throw new DockerContextStateError('Legacy Docker context migration journal has no valid source or destination.');
      }
      assertLegacyMigrationBinding(legacyMigration.source, legacyMigration);
    }
  }
  faultInjector?.('after-gc-generation-snapshot');
  assertFreshManagedRoots(paths);

  const roots = new Set<string>();
  if (legacyMigration) {
    const recovery = candidates.get(LEGACY_GENERATION_ID);
    if (recovery) {
      roots.add(recovery.path);
    }
  }
  const orphanKeys = new Set<string>();
  const liveness = new Map<number, boolean>();
  const isAlive = (ownerPid: number): boolean => {
    const prior = liveness.get(ownerPid);
    if (prior !== undefined) return prior;
    const alive = options.processIsAlive(ownerPid);
    liveness.set(ownerPid, alive);
    return alive;
  };
  const leases = new Map<string, {
    record: LeaseRecord;
    alive: boolean;
    file: ExactFileEvidence;
  }>();
  const reclaimableLegacyTemporaryFiles: ExactFileDeletionEvidence[] = [];
  for (const temporary of legacyTemporaryRecords) {
    if (!isAlive(temporary.record.pid)) {
      orphanKeys.add(`legacy-temp:${temporary.path}`);
      reclaimableLegacyTemporaryFiles.push({
        path: temporary.path,
        parentPath: paths.stateDir,
        file: temporary.file,
      });
    }
  }
  const leaseTemporaryRecords: Array<{
    path: string;
    record: LeaseRecord;
    alive: boolean;
    file: ExactFileEvidence;
  }> = [];
  for (const entry of inventory.read(paths.leasesDir)) {
    const path = join(paths.leasesDir, entry.name);
    if (entry.isFile() && entry.name.includes('.json.sync-')) {
      const file = captureExactFileEvidence(path, paths.leasesDir);
      const record = parseLeaseRecord(path);
      if (!isLeaseJsonTemporaryName(entry.name, record)) {
        throw new DockerContextStateError(`Malformed Docker context lease temporary: ${path}`);
      }
      assertExactFileEvidence(path, paths.leasesDir, file);
      const alive = isAlive(record.pid);
      leaseTemporaryRecords.push({ path, record, alive, file });
      if (record.state === 'consuming' && !alive) orphanKeys.add(`lease:${record.id}`);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      throw new DockerContextStateError(`Unexpected Docker context lease entry: ${path}`);
    }
    const file = captureExactFileEvidence(path, paths.leasesDir);
    const record = parseLeaseRecord(path);
    assertExactFileEvidence(path, paths.leasesDir, file);
    if (entry.name !== `${record.id}.json` || leases.has(record.id)) {
      throw new DockerContextStateError(`Docker context lease filename/id mismatch: ${path}`);
    }
    const alive = isAlive(record.pid);
    leases.set(record.id, { record, alive, file });
    if (record.state === 'consuming' && !alive) orphanKeys.add(`lease:${record.id}`);
    if (record.generationId) {
      const candidate = candidates.get(record.generationId);
      if (candidate && candidate.marker.leaseId !== record.id) {
        throw new DockerContextStateError(
          `Docker context lease aliases a generation owned by another lease: ${record.id}`,
        );
      }
      if (!candidate && pathEntryExists(join(paths.generationsDir, record.generationId))) {
        const newGenerationPath = assertGeneration(paths, {
          id: record.generationId,
          path: join(paths.generationsDir, record.generationId),
        });
        const newMarker = parseCompleteRecord(newGenerationPath, record.generationId);
        if (newMarker.leaseId !== record.id) {
          throw new DockerContextStateError(
            `Docker context lease aliases a newly published generation: ${record.id}`,
          );
        }
      } else if (!candidate && record.state === 'consuming') {
        throw new DockerContextStateError(
          `Consuming Docker context lease has no complete generation: ${record.id}`,
        );
      }
      if (candidate && (record.state === 'consuming' || (record.state === 'preconsumer' && alive))) {
        roots.add(candidate.path);
      }
    }
  }
  for (const temporary of leaseTemporaryRecords) {
    const finalLease = leases.get(temporary.record.id);
    if (
      finalLease
      && (
        finalLease.record.pid !== temporary.record.pid
        || finalLease.record.createdAt !== temporary.record.createdAt
      )
    ) {
      throw new DockerContextStateError(
        `Docker context lease temporary does not match its owner: ${temporary.path}`,
      );
    }
  }
  for (const candidate of candidates.values()) {
    if (candidate.marker.generationId === LEGACY_GENERATION_ID) continue;
    const lease = leases.get(candidate.marker.leaseId);
    if (!lease || lease.record.generationId !== candidate.marker.generationId) {
      throw new DockerContextStateError(
        `Docker context generation does not have its exact owner lease: ${candidate.path}`,
      );
    }
  }
  faultInjector?.('after-gc-lease-snapshot');
  assertFreshManagedRoots(paths);

  const ownedArtifacts = new Map<string, ExactOwnedDirectoryTreeEvidence[]>();
  for (const root of [paths.stagingDir, paths.bundleWorkDir]) {
    for (const entry of inventory.read(root)) {
      const artifactPath = join(root, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink() || !leases.has(entry.name)) {
        throw new DockerContextStateError(`Unknown Docker context lease-owned artifact: ${artifactPath}`);
      }
      const existing = ownedArtifacts.get(entry.name) ?? [];
      existing.push(captureExactOwnedDirectoryTree(artifactPath, root, inventory));
      ownedArtifacts.set(entry.name, existing);
    }
  }

  const transitioning = new Set<string>();
  for (const entry of inventory.read(paths.transitionsDir)) {
    const transitionPath = join(paths.transitionsDir, entry.name);
    const lease = leases.get(entry.name);
    if (!entry.isDirectory() || !lease) {
      throw new DockerContextStateError(`Unknown Docker context lease transition: ${transitionPath}`);
    }
    const contents = inventory.read(transitionPath);
    if (contents.some((item) => !item.isFile() || item.name !== 'owner.json')) {
      throw new DockerContextStateError(`Malformed Docker context lease transition: ${transitionPath}`);
    }
    const ownerEntry = contents.find((item) => item.name === 'owner.json');
    if (ownerEntry) {
      const owner = parseTransitionOwner(join(transitionPath, ownerEntry.name));
      if (owner.leaseId !== entry.name || owner.pid !== lease.record.pid) {
        throw new DockerContextStateError(`Docker context lease transition owner mismatch: ${transitionPath}`);
      }
    }
    transitioning.add(entry.name);
    if (!lease.alive || lease.record.state === 'released') orphanKeys.add(`lease:${entry.name}`);
  }

  const atomicOwners = new Map<string, {
    tree: ExactOwnedDirectoryTreeEvidence;
    ownerFile: ExactFileDeletionEvidence;
  }>();
  const atomicEntries = inventory.read(paths.atomicDir);
  const atomicPreparations: AtomicPreparationEvidence[] = [];
  for (const entry of atomicEntries) {
    const ownerPath = join(paths.atomicDir, entry.name);
    const preparation = parseAtomicPreparationName(entry.name);
    if (preparation) {
      atomicPreparations.push(captureAtomicPreparationEvidence(
        paths,
        entry,
        preparation,
        inventory,
      ));
      continue;
    }
    if (entry.name.startsWith('.prepare-')) {
      throw new DockerContextStateError(
        `Malformed Docker context atomic preparation name: ${ownerPath}`,
      );
    }
  }

  for (const preparation of atomicPreparations) {
    if (!preparation.owner) continue;
    if (preparation.ownerId === 'legacy-migration') {
      if (
        !legacyMigration
        || preparation.owner.migrationId !== legacyMigration.migrationId
      ) {
        throw new DockerContextStateError(
          `Legacy Docker context atomic preparation has conflicting migration authority: ${preparation.path}`,
        );
      }
      continue;
    }
    const lease = leases.get(preparation.ownerId);
    if (!lease || preparation.pid !== lease.record.pid) {
      throw new DockerContextStateError(
        `Docker context atomic preparation has conflicting lease authority: ${preparation.path}`,
      );
    }
    if (preparation.pointer) {
      const candidate = candidates.get(preparation.pointer.generationId);
      if (
        preparation.owner.kind === 'legacy'
        || lease.record.state !== 'consuming'
        || lease.record.generationId !== preparation.pointer.generationId
        || !candidate
        || candidate.marker.leaseId !== lease.record.id
        || candidate.path !== preparation.pointer.generationPath
      ) {
        throw new DockerContextStateError(
          `Docker context atomic temporary pointer has conflicting generation authority: ${preparation.path}`,
        );
      }
    }
  }

  const claimedPreparationPaths = new Set<string>();
  const reclaimableAtomicClaims: AtomicOwnerClaimEvidence[] = [];
  for (const entry of atomicEntries) {
    if (parseAtomicPreparationName(entry.name)) continue;
    const ownerPath = join(paths.atomicDir, entry.name);
    const lease = leases.get(entry.name);
    const legacy = entry.name === 'legacy-migration' && legacyMigration !== null;
    if (!lease && !legacy) {
      throw new DockerContextStateError(`Unknown Docker context atomic owner: ${ownerPath}`);
    }
    if (entry.isFile() && !entry.isSymbolicLink()) {
      const claim = captureAtomicOwnerClaimEvidence(
        paths,
        entry.name,
        atomicPreparations,
      );
      if (
        (lease && (
          claim.owner.pid !== lease.record.pid
          || claim.owner.kind === 'legacy'
        ))
        || (legacy && (
          claim.owner.kind !== 'legacy'
          || claim.owner.migrationId !== legacyMigration.migrationId
        ))
      ) {
        throw new DockerContextStateError(
          `Docker context atomic owner claim has conflicting authority: ${ownerPath}`,
        );
      }
      if (isAlive(claim.owner.pid)) {
        throw new DockerContextStateError(
          `Live Docker context atomic owner claim blocks GC: ${ownerPath}`,
        );
      }
      claimedPreparationPaths.add(claim.preparation.path);
      reclaimableAtomicClaims.push(claim);
      if (legacy) {
        const legacyCandidate = candidates.get(LEGACY_GENERATION_ID);
        if (legacyCandidate) roots.add(legacyCandidate.path);
      }
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new DockerContextStateError(`Unknown Docker context atomic owner: ${ownerPath}`);
    }
    const ownerTree = captureExactOwnedDirectoryTree(
      ownerPath,
      paths.atomicDir,
      inventory,
    );
    if (
      ownerTree.entries.length !== 1
      || ownerTree.entries[0].kind !== 'directory'
    ) {
      throw new DockerContextStateError(`Malformed Docker context atomic owner namespace: ${ownerPath}`);
    }
    const operationTree = ownerTree.entries[0];
    const operationPath = operationTree.path;
    if (operationTree.entries.some((item) => (
      (basename(item.path) !== 'owner.json' && basename(item.path) !== 'pointer')
      || (basename(item.path) === 'owner.json' && item.kind !== 'file')
      || (basename(item.path) === 'pointer' && item.kind !== 'symlink')
    ))) {
      throw new DockerContextStateError(`Malformed Docker context atomic operation: ${operationPath}`);
    }
    const ownerEntry = operationTree.entries.find(
      (item) => basename(item.path) === 'owner.json',
    );
    if (!ownerEntry || ownerEntry.kind !== 'file') {
      throw new DockerContextStateError(`Docker context atomic operation has no owner: ${operationPath}`);
    }
    const ownerFilePath = join(operationPath, 'owner.json');
    const ownerFile = captureExactFileEvidence(ownerFilePath, operationPath);
    const owner = parseAtomicOperation(ownerFilePath);
    assertExactFileEvidence(ownerFilePath, operationPath, ownerFile);
    if (
      owner.ownerId !== entry.name
      || (lease && (owner.pid !== lease.record.pid || owner.kind === 'legacy'))
      || (legacy && (
        owner.kind !== 'legacy'
        || owner.migrationId !== legacyMigration.migrationId
      ))
    ) {
      throw new DockerContextStateError(`Docker context atomic operation owner mismatch: ${operationPath}`);
    }
    if (legacy && !isAlive(owner.pid)) orphanKeys.add(`legacy:${operationPath}`);
    if (legacy) {
      const legacyCandidate = candidates.get(LEGACY_GENERATION_ID);
      if (legacyCandidate) roots.add(legacyCandidate.path);
    }
    else if (lease) {
      atomicOwners.set(entry.name, {
        tree: ownerTree,
        ownerFile: {
          path: ownerFilePath,
          parentPath: operationPath,
          file: ownerFile,
        },
      });
    }
  }

  const reclaimableAtomicPreparations = atomicPreparations.filter((preparation) => {
    if (isAlive(preparation.pid)) {
      throw new DockerContextStateError(
        `Live Docker context atomic preparation blocks GC: ${preparation.path}`,
      );
    }
    return !claimedPreparationPaths.has(preparation.path);
  });

  for (const pointerPath of [paths.currentPath, paths.exportPath]) {
    const generation = parsePointerGeneration(paths, pointerPath);
    if (generation) roots.add(generation.path);
  }
  faultInjector?.('after-gc-pointer-snapshot');
  assertFreshManagedRoots(paths);
  if (orphanKeys.size >= options.orphanCap) {
    throw new DockerContextOrphanLimitError(orphanKeys.size, options.orphanCap);
  }
  if (transitioning.size > 0) return;

  const reclaimableLeases = new Set<string>();
  const deletions: Array<{
    path: string;
    ownerKey: string;
    ownedTree?: ExactOwnedDirectoryTreeEvidence;
    authorityFiles?: ExactFileDeletionEvidence[];
    exactFile?: ExactFileDeletionEvidence;
    atomicPreparation?: AtomicPreparationEvidence;
    atomicClaim?: AtomicOwnerClaimEvidence;
  }> = [];
  for (const preparation of reclaimableAtomicPreparations) {
    deletions.push({
      path: preparation.path,
      ownerKey: preparation.ownerId,
      atomicPreparation: preparation,
    });
  }
  for (const claim of reclaimableAtomicClaims) {
    deletions.push({
      path: claim.path,
      ownerKey: claim.owner.ownerId,
      atomicClaim: claim,
    });
  }
  for (const file of reclaimableLegacyTemporaryFiles) {
    deletions.push({
      path: file.path,
      ownerKey: `legacy-temp:${file.path}`,
      exactFile: file,
    });
  }
  for (const temporary of leaseTemporaryRecords) {
    if (
      !leases.has(temporary.record.id)
      && (
        temporary.record.state === 'released'
        || (temporary.record.state === 'preconsumer' && !temporary.alive)
      )
    ) {
      deletions.push({
        path: temporary.path,
        ownerKey: `lease-temp:${temporary.path}`,
        exactFile: {
          path: temporary.path,
          parentPath: paths.leasesDir,
          file: temporary.file,
        },
      });
    }
  }
  for (const [id, lease] of leases) {
    const reclaimable = !transitioning.has(id) && (
      lease.record.state === 'released'
      || (lease.record.state === 'preconsumer' && !lease.alive)
    );
    if (!reclaimable) continue;
    reclaimableLeases.add(id);
    for (const artifact of ownedArtifacts.get(id) ?? []) {
      deletions.push({
        path: artifact.path,
        ownerKey: id,
        ownedTree: artifact,
      });
    }
    const atomicOwner = atomicOwners.get(id);
    if (atomicOwner) {
      deletions.push({
        path: atomicOwner.tree.path,
        ownerKey: id,
        ownedTree: atomicOwner.tree,
        authorityFiles: [atomicOwner.ownerFile],
      });
    }
  }

  const removedGenerations = new Set<string>();
  for (const [id, candidate] of candidates) {
    if (roots.has(candidate.path)) continue;
    if (id !== LEGACY_GENERATION_ID && !reclaimableLeases.has(candidate.marker.leaseId)) continue;
    deletions.push({
      path: candidate.path,
      ownerKey: candidate.marker.leaseId,
      ownedTree: candidate.tree,
      authorityFiles: [{
        path: markerPath(candidate.tree.path),
        parentPath: candidate.tree.path,
        file: candidate.markerFile,
      }],
    });
    removedGenerations.add(id);
  }

  for (const id of reclaimableLeases) {
    const lease = leases.get(id)!;
    const generationId = lease.record.generationId;
    const generationCanBeForgotten = !generationId
      || removedGenerations.has(generationId)
      || (!candidates.has(generationId) && !pathEntryExists(join(paths.generationsDir, generationId)));
    if (generationCanBeForgotten) {
      const path = join(paths.leasesDir, `${id}.json`);
      deletions.push({
        path,
        ownerKey: id,
        exactFile: {
          path,
          parentPath: paths.leasesDir,
          file: lease.file,
        },
      });
    }
  }
  assertFreshManagedRoots(paths);
  const deletionInventory = new StateInventoryBudget(
    options.maxInventoryEntries,
    options.maintenanceObserver,
  );
  const blockedOwners = new Set<string>();
  const deletionErrors: unknown[] = [];
  for (let offset = 0; offset < deletions.length; offset += options.deletionChunkSize) {
    const chunk = deletions.slice(offset, offset + options.deletionChunkSize);
    for (const deletion of chunk) {
      assertFreshManagedRoots(paths);
      if (blockedOwners.has(deletion.ownerKey)) continue;
      try {
        for (const evidence of deletion.authorityFiles ?? []) {
          assertExactFileEvidence(evidence.path, evidence.parentPath, evidence.file);
        }
        if (deletion.atomicClaim) {
          removeExactAtomicClaim(
            paths,
            deletion.atomicClaim,
            faultInjector,
            deletionInventory,
          );
        } else if (deletion.atomicPreparation) {
          removeExactAtomicPreparation(deletion.atomicPreparation, deletionInventory);
        } else if (deletion.ownedTree) {
          removeExactOwnedDirectoryTree(deletion.ownedTree, deletionInventory);
        } else if (deletion.exactFile) {
          removeExactFileEvidence(deletion.exactFile);
        } else {
          throw new DockerContextStateError(
            `Docker context deletion has no exact evidence: ${deletion.path}`,
          );
        }
      } catch (error) {
        blockedOwners.add(deletion.ownerKey);
        deletionErrors.push(error);
      }
    }
    options.maintenanceObserver?.({
      phase: 'delete-chunk',
      chunkIndex: Math.floor(offset / options.deletionChunkSize),
      chunkSize: chunk.length,
      remaining: Math.max(0, deletions.length - offset - chunk.length),
    });
  }
  try {
    assertFreshManagedRoots(paths);
    syncPath(paths.stagingDir);
    syncPath(paths.bundleWorkDir);
    syncPath(paths.atomicDir);
    syncPath(paths.generationsDir);
    syncPath(paths.leasesDir);
  } catch (error) {
    deletionErrors.push(error);
  }
  if (deletionErrors.length > 0) {
    throw new AggregateError(
      deletionErrors,
      `Docker context garbage collection preserved one or more drifted owner lanes: ${
        deletionErrors.map((error) => (
          error instanceof Error ? error.message : String(error)
        )).join('; ')
      }`,
    );
  }
}
