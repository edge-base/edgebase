import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

export type PackArtifactPublicationPoint =
  | 'after-publication-journal-create'
  | 'after-staged-artifact-build'
  | 'after-staged-artifact-validation'
  | 'after-staged-artifact-sync'
  | 'after-previous-artifact-rename'
  | 'after-staged-artifact-rename'
  | 'after-previous-artifact-cleanup';

export interface PublishPackArtifactOptions<Result> {
  outputPath: string;
  kind: 'directory' | 'file';
  admitExisting?: (outputPath: string) => void;
  build: (stagingPath: string, publishedOutputPath: string) => Result;
  validate: (artifactPath: string) => void;
  faultInjector?: (point: PackArtifactPublicationPoint) => void;
}

interface DatabaseSyncLike {
  exec(sql: string): void;
  close(): void;
}

type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;

interface PathIdentity {
  kind: 'directory' | 'file' | 'symlink' | 'other';
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
}

interface PublicationJournal {
  schemaVersion: 1;
  ownerToken: string;
  ownerPid: number;
  outputPath: string;
  stagingPath: string;
  previousPath: string;
  kind: 'directory' | 'file';
  previousIdentity: PathIdentity | null;
}

interface PublicationPaths {
  outputPath: string;
  parentPath: string;
  journalPath: string;
  claimPath: string;
  stagingPath: string;
  previousPath: string;
}

interface PublicationClaim {
  ownerToken: string;
  release: () => void;
}

const OWNER_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const JOURNAL_FILE = 'journal.json';
const PHASE_PREPARED = 'phase-prepared';
const PHASE_PREVIOUS_MOVED = 'phase-previous-moved';
const PHASE_PUBLISHED = 'phase-published';
const JOURNAL_FILES = new Set([
  JOURNAL_FILE,
  PHASE_PREPARED,
  PHASE_PREVIOUS_MOVED,
  PHASE_PUBLISHED,
]);
const requireFromHere = createRequire(import.meta.url);
let databaseSyncConstructor: DatabaseSyncConstructor | null = null;

function loadDatabaseSync(): DatabaseSyncConstructor {
  if (databaseSyncConstructor) return databaseSyncConstructor;
  const previousNoWarnings = process.env.NODE_NO_WARNINGS;
  const previousEmitWarning = process.emitWarning;
  const filteredEmitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = warning instanceof Error ? warning.message : String(warning);
    if (message === 'SQLite is an experimental feature and might change at any time') return;
    Reflect.apply(previousEmitWarning, process, [warning, ...args]);
  }) as typeof process.emitWarning;
  process.env.NODE_NO_WARNINGS = '1';
  process.emitWarning = filteredEmitWarning;
  try {
    const sqlite = requireFromHere('node:sqlite') as {
      DatabaseSync?: DatabaseSyncConstructor;
    };
    if (typeof sqlite.DatabaseSync !== 'function') {
      throw new Error('The current Node.js runtime does not provide node:sqlite DatabaseSync.');
    }
    databaseSyncConstructor = sqlite.DatabaseSync;
    setImmediate(() => {
      if (process.emitWarning === filteredEmitWarning) process.emitWarning = previousEmitWarning;
      if (process.env.NODE_NO_WARNINGS !== '1') return;
      if (previousNoWarnings === undefined) delete process.env.NODE_NO_WARNINGS;
      else process.env.NODE_NO_WARNINGS = previousNoWarnings;
    });
    return databaseSyncConstructor;
  } catch (error) {
    process.emitWarning = previousEmitWarning;
    if (previousNoWarnings === undefined) delete process.env.NODE_NO_WARNINGS;
    else process.env.NODE_NO_WARNINGS = previousNoWarnings;
    throw error;
  }
}

function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = error as Error & {
    code?: unknown;
    errcode?: unknown;
  };
  return details.errcode === 5
    || details.code === 'SQLITE_BUSY'
    || details.code === 'ERR_SQLITE_ERROR' && /database is locked|SQLITE_BUSY/i.test(details.message);
}

function acquirePublicationClaim(outputPath: string, claimPath: string): PublicationClaim {
  const DatabaseSync = loadDatabaseSync();
  const database = new DatabaseSync(claimPath);
  let transactionOpen = false;
  try {
    database.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;');
    transactionOpen = true;
  } catch (error) {
    try {
      database.close();
    } catch {
      // Preserve the admission error.
    }
    if (isSqliteBusyError(error)) {
      throw new Error(`Another EdgeBase pack build is already publishing this output path: ${outputPath}`);
    }
    throw error;
  }

  let released = false;
  return {
    ownerToken: randomBytes(32).toString('hex'),
    release() {
      if (released) return;
      released = true;
      try {
        if (transactionOpen) database.exec('ROLLBACK;');
      } finally {
        transactionOpen = false;
        database.close();
      }
    },
  };
}

function syncFileOrDirectory(path: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function syncArtifact(path: string): void {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) return;
  if (!info.isDirectory()) {
    syncFileOrDirectory(path);
    return;
  }

  for (const name of readdirSync(path)) {
    syncArtifact(join(path, name));
  }
  syncFileOrDirectory(path);
}

function capturePathIdentity(path: string): PathIdentity | null {
  if (!existsSync(path)) return null;
  const info = lstatSync(path, { bigint: true });
  return {
    kind: info.isDirectory()
      ? 'directory'
      : info.isFile()
        ? 'file'
        : info.isSymbolicLink()
          ? 'symlink'
          : 'other',
    dev: String(info.dev),
    ino: String(info.ino),
    size: String(info.size),
    mtimeNs: String(info.mtimeNs),
  };
}

function pathIdentityMatches(path: string, expected: PathIdentity | null): boolean {
  const current = capturePathIdentity(path);
  return JSON.stringify(current) === JSON.stringify(expected);
}

function insertOwnedSuffix(outputPath: string, label: string, ownerToken: string): string {
  const parentPath = dirname(outputPath);
  const outputName = basename(outputPath);
  const knownSuffix = ['.tar.gz', '.app', '.zip']
    .find((candidate) => outputName.toLowerCase().endsWith(candidate));
  const stem = knownSuffix ? outputName.slice(0, -knownSuffix.length) : outputName;
  return join(parentPath, `.${stem}.${label}-${ownerToken}${knownSuffix ?? ''}`);
}

function resolvePublicationPaths(outputPath: string, ownerToken?: string): PublicationPaths {
  const canonicalOutputPath = resolve(outputPath);
  const parentPath = dirname(canonicalOutputPath);
  const outputName = basename(canonicalOutputPath);
  if (!outputName || canonicalOutputPath === parentPath) {
    throw new Error(`Pack artifact output must name a file or directory below a parent path: ${outputPath}`);
  }
  const token = ownerToken ?? 'pending';
  return {
    outputPath: canonicalOutputPath,
    parentPath,
    journalPath: join(parentPath, `.${outputName}.edgebase-publication`),
    claimPath: join(parentPath, `.${outputName}.edgebase-publication.sqlite`),
    stagingPath: insertOwnedSuffix(canonicalOutputPath, 'stage', token),
    previousPath: insertOwnedSuffix(canonicalOutputPath, 'previous', token),
  };
}

function writeJournalFile(path: string, contents: string): void {
  writeFileSync(path, contents, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
  syncFileOrDirectory(path);
}

function createPublicationJournal(
  paths: PublicationPaths,
  journal: PublicationJournal,
): void {
  mkdirSync(paths.journalPath);
  writeJournalFile(
    join(paths.journalPath, JOURNAL_FILE),
    `${JSON.stringify(journal, null, 2)}\n`,
  );
  syncFileOrDirectory(paths.journalPath);
  syncFileOrDirectory(paths.parentPath);
}

function markPublicationPhase(journalPath: string, phase: string): void {
  const phasePath = join(journalPath, phase);
  writeJournalFile(phasePath, '');
  syncFileOrDirectory(journalPath);
}

function isPathIdentity(value: unknown): value is PathIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Partial<PathIdentity>;
  return ['directory', 'file', 'symlink', 'other'].includes(String(identity.kind))
    && typeof identity.dev === 'string'
    && typeof identity.ino === 'string'
    && typeof identity.size === 'string'
    && typeof identity.mtimeNs === 'string';
}

function readPublicationJournal(
  basePaths: PublicationPaths,
): { journal: PublicationJournal; paths: PublicationPaths; phases: Set<string> } | null {
  if (!existsSync(basePaths.journalPath)) return null;
  const journalInfo = lstatSync(basePaths.journalPath);
  if (journalInfo.isSymbolicLink() || !journalInfo.isDirectory()) {
    throw new Error(`Pack artifact publication journal is not a real directory: ${basePaths.journalPath}`);
  }
  const entries = readdirSync(basePaths.journalPath);
  if (entries.length === 0) {
    rmSync(basePaths.journalPath, { recursive: true, force: true });
    syncFileOrDirectory(basePaths.parentPath);
    return null;
  }
  if (entries.some((entry) => !JOURNAL_FILES.has(entry))) {
    throw new Error(`Pack artifact publication journal contains unknown entries: ${basePaths.journalPath}`);
  }

  const metadataPath = join(basePaths.journalPath, JOURNAL_FILE);
  if (!existsSync(metadataPath)) {
    throw new Error(`Pack artifact publication journal is missing ${JOURNAL_FILE}: ${basePaths.journalPath}`);
  }
  const metadataInfo = lstatSync(metadataPath);
  if (metadataInfo.isSymbolicLink() || !metadataInfo.isFile() || metadataInfo.size > 64 * 1024) {
    throw new Error(`Pack artifact publication journal metadata is invalid: ${metadataPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(metadataPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Pack artifact publication journal metadata is malformed: ${metadataPath}`, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Pack artifact publication journal metadata is not an object: ${metadataPath}`);
  }
  const journal = parsed as Partial<PublicationJournal>;
  if (
    journal.schemaVersion !== 1
    || typeof journal.ownerToken !== 'string'
    || !OWNER_TOKEN_PATTERN.test(journal.ownerToken)
    || !Number.isInteger(journal.ownerPid)
    || Number(journal.ownerPid) <= 0
    || journal.kind !== 'directory' && journal.kind !== 'file'
    || journal.previousIdentity !== null && !isPathIdentity(journal.previousIdentity)
  ) {
    throw new Error(`Pack artifact publication journal metadata has an invalid shape: ${metadataPath}`);
  }
  const ownedPaths = resolvePublicationPaths(basePaths.outputPath, journal.ownerToken);
  if (
    journal.outputPath !== ownedPaths.outputPath
    || journal.stagingPath !== ownedPaths.stagingPath
    || journal.previousPath !== ownedPaths.previousPath
  ) {
    throw new Error(`Pack artifact publication journal paths do not match their owner token: ${metadataPath}`);
  }

  return {
    journal: journal as PublicationJournal,
    paths: ownedPaths,
    phases: new Set(entries.filter((entry) => entry !== JOURNAL_FILE)),
  };
}

function recoverInterruptedPublication(
  basePaths: PublicationPaths,
  validate: (artifactPath: string) => void,
): void {
  const record = readPublicationJournal(basePaths);
  if (!record) return;
  const { paths, phases } = record;
  let outputExists = existsSync(paths.outputPath);
  let stagingExists = existsSync(paths.stagingPath);
  let previousExists = existsSync(paths.previousPath);

  if (previousExists) {
    if (!outputExists) {
      renameSync(paths.previousPath, paths.outputPath);
      syncFileOrDirectory(paths.parentPath);
      outputExists = true;
      previousExists = false;
    } else if (!stagingExists && phases.has(PHASE_PREPARED)) {
      validate(paths.outputPath);
      rmSync(paths.previousPath, { recursive: true, force: true });
      syncFileOrDirectory(paths.parentPath);
      previousExists = false;
    } else {
      throw new Error(`Pack artifact publication recovery found ambiguous old and new outputs: ${paths.outputPath}`);
    }
  }

  if (stagingExists) {
    if (!outputExists && phases.has(PHASE_PREPARED)) {
      validate(paths.stagingPath);
      renameSync(paths.stagingPath, paths.outputPath);
      syncFileOrDirectory(paths.parentPath);
      outputExists = true;
      stagingExists = false;
    } else {
      rmSync(paths.stagingPath, { recursive: true, force: true });
      syncFileOrDirectory(paths.parentPath);
      stagingExists = false;
    }
  }

  if (previousExists || stagingExists) {
    throw new Error(`Pack artifact publication recovery did not settle owned paths: ${paths.outputPath}`);
  }
  rmSync(paths.journalPath, { recursive: true, force: true });
  syncFileOrDirectory(paths.parentPath);
}

export function publishPackArtifact<Result>(
  options: PublishPackArtifactOptions<Result>,
): Result {
  const basePaths = resolvePublicationPaths(options.outputPath);
  mkdirSync(basePaths.parentPath, { recursive: true });
  const claim = acquirePublicationClaim(basePaths.outputPath, basePaths.claimPath);
  try {
    recoverInterruptedPublication(basePaths, options.validate);
    options.admitExisting?.(basePaths.outputPath);

    const paths = resolvePublicationPaths(basePaths.outputPath, claim.ownerToken);
    const previousIdentity = capturePathIdentity(paths.outputPath);
    const journal: PublicationJournal = {
      schemaVersion: 1,
      ownerToken: claim.ownerToken,
      ownerPid: process.pid,
      outputPath: paths.outputPath,
      stagingPath: paths.stagingPath,
      previousPath: paths.previousPath,
      kind: options.kind,
      previousIdentity,
    };
    try {
      createPublicationJournal(paths, journal);
      options.faultInjector?.('after-publication-journal-create');
      const result = options.build(paths.stagingPath, paths.outputPath);
      options.faultInjector?.('after-staged-artifact-build');
      options.validate(paths.stagingPath);
      options.faultInjector?.('after-staged-artifact-validation');
      syncArtifact(paths.stagingPath);
      syncFileOrDirectory(paths.parentPath);
      markPublicationPhase(paths.journalPath, PHASE_PREPARED);
      options.faultInjector?.('after-staged-artifact-sync');

      if (!pathIdentityMatches(paths.outputPath, previousIdentity)) {
        throw new Error(`Pack artifact output changed while its replacement was being staged: ${paths.outputPath}`);
      }
      if (previousIdentity) {
        renameSync(paths.outputPath, paths.previousPath);
        syncFileOrDirectory(paths.parentPath);
        markPublicationPhase(paths.journalPath, PHASE_PREVIOUS_MOVED);
        options.faultInjector?.('after-previous-artifact-rename');
      }

      renameSync(paths.stagingPath, paths.outputPath);
      syncFileOrDirectory(paths.parentPath);
      markPublicationPhase(paths.journalPath, PHASE_PUBLISHED);
      options.faultInjector?.('after-staged-artifact-rename');

      if (existsSync(paths.previousPath)) {
        rmSync(paths.previousPath, { recursive: true, force: true });
        syncFileOrDirectory(paths.parentPath);
      }
      options.faultInjector?.('after-previous-artifact-cleanup');
      rmSync(paths.journalPath, { recursive: true, force: true });
      syncFileOrDirectory(paths.parentPath);
      return result;
    } catch (error) {
      try {
        recoverInterruptedPublication(basePaths, options.validate);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `Pack artifact publication failed and recovery could not settle ${basePaths.outputPath}.`,
        );
      }
      throw error;
    }
  } finally {
    claim.release();
  }
}

export const __packArtifactPublicationTestUtils = {
  resolvePublicationPaths,
};
