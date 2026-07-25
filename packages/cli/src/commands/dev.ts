import { Command, CommanderError } from 'commander';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import {
  chmodSync,
  existsSync,
  watch,
  readFileSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  promises as fsPromises,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, join } from 'node:path';
import chalk from 'chalk';
import { loadConfigSafe } from '../lib/load-config.js';
import { resolveRateLimitBindings } from '../lib/rate-limit-bindings.js';
import { checkWranglerAuth } from '../lib/cf-auth.js';
import { parseDevVars } from '../lib/dev-sidecar.js';
import { upsertEnvFile, writeLocalSecrets } from '../lib/local-secrets.js';
import {
  prepareWranglerDevTool,
} from '../lib/runtime-scaffold.js';
import { resolveLocalDevBindings } from '../lib/project-runtime.js';
import {
  generateFunctionRegistry,
  scanFunctions,
  validateRouteNames,
} from '../lib/function-registry.js';
import {
  extractDatabases,
  generateTempWranglerToml,
  RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS,
} from '../lib/deploy-shared.js';
import {
  buildSnapshot,
  loadSnapshot,
  detectDestructiveChanges,
  filterAutoPassChanges,
  handleDestructiveChanges,
  resetLocalDoState,
  saveSnapshot,
  detectProviderChanges,
  detectAuthProviderChange,
} from '../lib/schema-check.js';
import {
  dumpCurrentData,
  restoreToNewProvider,
  promptMigration,
  type DumpedData,
  type MigrationOptions,
} from '../lib/migrator.js';
import { isCliStructuredError, raiseCliError } from '../lib/agent-contract.js';
import { isNonInteractive } from '../lib/cli-context.js';
import { createAppBundle, syncAppBundle, syncAppBundleFunctions } from '../lib/app-bundle.js';

const FULL_CONFIG_EVAL = { allowRegexFallback: false } as const;
const DEFAULT_DEV_PORT = 8787;
const DEFAULT_WRANGLER_INSPECTOR_PORT = 9231;
const MANAGED_AUTH_ENV_KEYS = ['EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS'];
const MANAGED_AUTH_ENV_PREFIXES = ['EDGEBASE_OAUTH_', 'EDGEBASE_OIDC_'];
const DEV_CONFIG_ENV_ALLOWLIST_KEY = 'EDGEBASE_CONFIG_ENV_ALLOWLIST';
const DEV_CONFIG_ENV_DEFAULT_KEYS = new Set(['NODE_ENV']);
const DEV_CONFIG_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RATE_LIMIT_PROFILE_ENV_PATTERN = /(?:^|_)RATE_LIMIT_PROFILE$/;
const PORT_SEARCH_LIMIT = 50;
const PORT_RESERVATION_STALE_GRACE_MS = 10_000;
const MAX_RECENT_WRANGLER_STDERR_LINES = 12;
const WRANGLER_EXIT_GRACE_MS = 2_500;
const WRANGLER_FORCE_KILL_GRACE_MS = 1_000;
const DEV_BUNDLE_VARS_FILENAME = '.dev.vars';
const DEV_REQUIRED_COMPATIBILITY_FLAGS = RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS;
const LOCAL_DEV_BUILD_MARKER = 'EDGEBASE_LOCAL_DEV_BUILD';
const LOCAL_DEV_BUILD_DEFINE = `${LOCAL_DEV_BUILD_MARKER}:true`;
const PORT_RESERVATION_DIR = process.env.EDGEBASE_DEV_PORT_RESERVATION_DIR
  ? resolve(process.env.EDGEBASE_DEV_PORT_RESERVATION_DIR)
  : join(tmpdir(), 'edgebase-dev-port-reservations');

export { resolveLocalDevBindings };

type PreservedDevState = {
  backupDir: string;
  stateDir: string;
};

async function preserveDevBundleState(bundleDir: string): Promise<PreservedDevState | null> {
  const stateDir = join(bundleDir, '.wrangler', 'state');
  if (!existsSync(stateDir)) return null;

  const backupDir = await fsPromises.mkdtemp(join(tmpdir(), 'edgebase-dev-state-'));
  await fsPromises.cp(stateDir, join(backupDir, 'state'), {
    recursive: true,
    force: true,
    errorOnExist: false,
  });

  return { backupDir, stateDir };
}

async function discardPreservedDevBundleState(preserved: PreservedDevState | null): Promise<void> {
  if (!preserved) return;
  await fsPromises.rm(preserved.backupDir, { recursive: true, force: true });
}

async function restoreDevBundleState(preserved: PreservedDevState | null): Promise<void> {
  if (!preserved) return;

  try {
    const backupStateDir = join(preserved.backupDir, 'state');
    await fsPromises.mkdir(dirname(preserved.stateDir), { recursive: true });
    await fsPromises.rm(preserved.stateDir, { recursive: true, force: true });
    await fsPromises.cp(backupStateDir, preserved.stateDir, {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
    console.log(chalk.dim(`  State: preserved ${relative(process.cwd(), preserved.stateDir)}`));
  } finally {
    await discardPreservedDevBundleState(preserved);
  }
}

function resolveDevRateLimitBindings(): ReturnType<typeof resolveRateLimitBindings> {
  // Wrangler currently prints a noisy experimental "unsafe.bindings" warning for
  // CLI-generated rate limit bindings. Local dev already enforces the in-process
  // software counter layer, so we skip the ceiling bindings here to keep startup
  // output focused on actionable problems.
  return [];
}

const activePortReservations = new Set<string>();
const activeDevEnvOverrides = new Map<string, string | undefined>();
let portReservationCleanupRegistered = false;
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'g');

type DevIsolationOption = string | boolean | undefined;

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}

function appendRecentOutputChunk(
  recentLines: string[],
  chunk: string,
  remainder = '',
): string {
  const combined = `${remainder}${stripAnsi(chunk)}`;
  const parts = combined.split(/\r?\n/);
  const nextRemainder = parts.pop() ?? '';

  for (const part of parts) {
    const line = part.trim();
    if (!line) continue;
    recentLines.push(line);
  }

  if (recentLines.length > MAX_RECENT_WRANGLER_STDERR_LINES) {
    recentLines.splice(0, recentLines.length - MAX_RECENT_WRANGLER_STDERR_LINES);
  }

  return nextRemainder;
}

function flushRecentOutputRemainder(recentLines: string[], remainder: string): void {
  const line = stripAnsi(remainder).trim();
  if (!line) return;
  recentLines.push(line);
  if (recentLines.length > MAX_RECENT_WRANGLER_STDERR_LINES) {
    recentLines.splice(0, recentLines.length - MAX_RECENT_WRANGLER_STDERR_LINES);
  }
}

function inferWranglerDevExitHint(diagnostics: string[]): string {
  const haystack = diagnostics.join('\n').toLowerCase();

  if (
    haystack.includes('eaddrinuse')
    || haystack.includes('address already in use')
    || haystack.includes('port is already in use')
  ) {
    return 'Another process is already using the selected dev or inspector port. Stop the other process, choose a different port, or rerun with --auto-port.';
  }

  if (
    haystack.includes('cannot find module')
    || haystack.includes('could not resolve')
    || haystack.includes('module not found')
    || haystack.includes('no such file or directory')
    || haystack.includes('enoent')
  ) {
    return 'A file or import referenced by the dev runtime could not be found. Check recent changes in edgebase.config.ts, config/, functions/, and wrangler.toml.';
  }

  if (
    haystack.includes('syntaxerror')
    || haystack.includes('unexpected token')
    || haystack.includes('parse error')
    || haystack.includes('failed to parse')
    || haystack.includes('toml')
  ) {
    return 'Wrangler could not parse your runtime config or source files. Check the reported file and line in edgebase.config.ts, wrangler.toml, or the generated runtime scaffold.';
  }

  if (
    haystack.includes('d1')
    && (haystack.includes('binding') || haystack.includes('database'))
  ) {
    return 'A D1 binding referenced by the local runtime is missing or mismatched. Check your database namespaces in edgebase.config.ts and the generated wrangler dev bindings.';
  }

  return 'Check the recent Wrangler stderr lines below. Common causes are config syntax errors, missing imports, or local binding mismatches.';
}

function shouldSuppressWranglerStderrLine(line: string): boolean {
  const normalized = stripAnsi(line).trim();
  if (!normalized) return false;

  return (
    /processing .*wrangler.* configuration:/i.test(normalized)
    || /"unsafe" fields are experimental and may change or break at any time\./i.test(normalized)
  );
}

function filterWranglerStderrChunkForDisplay(
  chunk: string,
  remainder = '',
): { display: string; remainder: string } {
  const combined = `${remainder}${chunk}`;
  const parts = combined.split(/\r?\n/);
  const nextRemainder = parts.pop() ?? '';
  const visibleLines = parts.filter((line) => !shouldSuppressWranglerStderrLine(line));

  return {
    display: visibleLines.length > 0 ? `${visibleLines.join('\n')}\n` : '',
    remainder: nextRemainder,
  };
}

function flushWranglerStderrDisplayRemainder(remainder: string): string {
  if (!remainder || shouldSuppressWranglerStderrLine(remainder)) return '';
  return `${remainder}\n`;
}

function isManagedAuthEnvKey(key: string): boolean {
  return MANAGED_AUTH_ENV_KEYS.includes(key)
    || MANAGED_AUTH_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function assertNoLocalDevBuildMarker(
  fileEnv: Record<string, string>,
  shellEnv: Record<string, string | undefined>,
): void {
  if (
    Object.prototype.hasOwnProperty.call(fileEnv, LOCAL_DEV_BUILD_MARKER)
    || typeof shellEnv[LOCAL_DEV_BUILD_MARKER] === 'string'
  ) {
    throw new Error(
      `${LOCAL_DEV_BUILD_MARKER} is a CLI-owned compile-time selector and cannot be set `
      + 'through .env.development, .dev.vars, or the ambient shell environment.',
    );
  }
}

/**
 * Build the exact environment used by config evaluation and the local Worker.
 * Values from .env.development/.dev.vars keep their existing precedence. Shell
 * values are added only when they are safe, non-secret defaults used by config
 * (`NODE_ENV`, `*_RATE_LIMIT_PROFILE`) or explicitly named in
 * EDGEBASE_CONFIG_ENV_ALLOWLIST.
 */
function collectDevRuntimeConfigEnv(
  fileEnv: Record<string, string>,
  shellEnv: Record<string, string | undefined>,
): Record<string, string> {
  assertNoLocalDevBuildMarker(fileEnv, shellEnv);
  const runtimeEnv = { ...fileEnv };
  const explicitAllowlist = new Set(
    (fileEnv[DEV_CONFIG_ENV_ALLOWLIST_KEY] ?? shellEnv[DEV_CONFIG_ENV_ALLOWLIST_KEY] ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => DEV_CONFIG_ENV_KEY_PATTERN.test(key)),
  );

  for (const [key, value] of Object.entries(shellEnv)) {
    if (typeof value !== 'string' || Object.prototype.hasOwnProperty.call(runtimeEnv, key)) {
      continue;
    }
    if (
      DEV_CONFIG_ENV_DEFAULT_KEYS.has(key)
      || RATE_LIMIT_PROFILE_ENV_PATTERN.test(key)
      || explicitAllowlist.has(key)
    ) {
      runtimeEnv[key] = value;
    }
  }

  return runtimeEnv;
}

function serializeDevBundleVars(values: Record<string, string>): string {
  const lines = [
    '# Auto-generated by edgebase dev. Local-only; do not package or commit.',
  ];

  for (const key of Object.keys(values).sort()) {
    if (!DEV_CONFIG_ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid development environment variable name: ${key}`);
    }
    const encoded = JSON.stringify(values[key])
      // dotenv-expand treats unescaped dollar signs as interpolation. Keep the
      // project value byte-for-byte when Wrangler reads the generated file.
      .replace(/\$/g, '\\$');
    lines.push(`${key}=${encoded}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Materialize the exact Worker bindings for local Wrangler. The file lives
 * only inside the ignored dev target, is replaced atomically on every sync so
 * removed keys cannot linger, and is never passed through command-line args.
 */
function writeDevBundleVars(
  bundleDir: string,
  values: Record<string, string>,
): string {
  assertNoLocalDevBuildMarker(values, {});
  mkdirSync(bundleDir, { recursive: true });
  const targetPath = join(bundleDir, DEV_BUNDLE_VARS_FILENAME);
  const tempPath = join(
    bundleDir,
    `${DEV_BUNDLE_VARS_FILENAME}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );

  try {
    writeFileSync(tempPath, serializeDevBundleVars(values), {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, targetPath);
    // Preserve the contract even on platforms/filesystems that ignore the
    // create mode during rename.
    chmodSync(targetPath, 0o600);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      /* rename succeeded or temp cleanup is non-fatal */
    }
  }

  return targetPath;
}

function resolveWranglerDevProcessEnv(
  shellEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  assertNoLocalDevBuildMarker({}, shellEnv);
  return {
    ...shellEnv,
    // A bundle-local .dev.vars is the sole Worker env source. Force this off
    // even when the caller's shell opted into Wrangler's broad process-env
    // compatibility switch.
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  };
}

interface ResolvedDevPorts {
  port: number;
  sidecarPort: number;
  inspectorPort: number;
  portChanged: boolean;
  sidecarChanged: boolean;
  inspectorChanged: boolean;
}

interface PortReservation {
  port: number;
  release: () => Promise<void>;
}

interface ReservedDevPorts extends ResolvedDevPorts {
  release: () => Promise<void>;
}

interface DevPersistence {
  persistTo?: string;
  label?: string;
}

interface GeneratedDevSecretsResult {
  generatedKeys: string[];
  primaryPath: string | null;
}

interface ReserveDevPortOptions {
  strictPort?: boolean;
}

function parsePort(value: string, flagName: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ${flagName}: '${value}'. Expected a port between 1 and 65535.`);
  }
  return port;
}

function wasFlagProvided(rawArgs: readonly string[], longFlag: string, shortFlag?: string): boolean {
  return rawArgs.some((arg) => {
    if (arg === longFlag || arg.startsWith(`${longFlag}=`)) return true;
    if (!shortFlag) return false;
    if (arg === shortFlag) return true;
    return arg.startsWith(shortFlag) && arg.length > shortFlag.length;
  });
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null || !isProcessAlive(child.pid ?? null)) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(child.exitCode !== null || child.signalCode !== null || !isProcessAlive(child.pid ?? null));
    }, timeoutMs);

    child.once('exit', onExit);
  });
}

async function terminateChildProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
) : Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !isProcessAlive(child.pid ?? null)) {
    return;
  }

  if (process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Fall back to the direct child when the group is already gone.
    }
  }

  child.kill(signal);
  const exited = await waitForChildExit(child, WRANGLER_EXIT_GRACE_MS);
  if (exited || signal === 'SIGKILL') return;

  if (process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Fall back to the direct child when the group is already gone.
    }
  }

  child.kill('SIGKILL');
  await waitForChildExit(child, WRANGLER_FORCE_KILL_GRACE_MS);
}

async function closeHttpServer(
  server: ReturnType<typeof import('node:http').createServer> | null,
): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function probePortHost(
  port: number,
  host: '127.0.0.1' | '::1',
): Promise<'available' | 'busy' | 'unsupported'> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL') {
        resolve('unsupported');
        return;
      }
      resolve('busy');
    });

    server.once('listening', () => {
      server.close((err) => {
        if (err) {
          resolve('busy');
          return;
        }
        resolve('available');
      });
    });

    server.listen({ port, host, exclusive: true });
  });
}

export async function isPortAvailable(
  port: number,
  exclude: ReadonlySet<number> = new Set(),
): Promise<boolean> {
  if (exclude.has(port)) return false;
  if (await isPortReserved(port)) return false;

  return isPortBindable(port, exclude);
}

async function isPortBindable(
  port: number,
  exclude: ReadonlySet<number> = new Set(),
): Promise<boolean> {
  if (exclude.has(port)) return false;

  const results = await Promise.all([
    probePortHost(port, '127.0.0.1'),
    probePortHost(port, '::1'),
  ]);

  return results.every((result) => result !== 'busy') && results.some((result) => result === 'available');
}

export async function findAvailablePort(
  startPort: number,
  exclude: ReadonlySet<number> = new Set(),
  maxAttempts = PORT_SEARCH_LIMIT,
): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = startPort + offset;
    if (candidate > 65535) break;
    if (await isPortAvailable(candidate, exclude)) return candidate;
  }

  throw new Error(
    `Could not find an available port in the range ${startPort}-${Math.min(65535, startPort + maxAttempts - 1)}.`,
  );
}

function getPortReservationPath(port: number): string {
  return join(PORT_RESERVATION_DIR, `${port}.lock`);
}

function ensurePortReservationCleanup(): void {
  if (portReservationCleanupRegistered) return;
  portReservationCleanupRegistered = true;

  process.on('exit', () => {
    for (const reservationPath of activePortReservations) {
      try {
        unlinkSync(reservationPath);
      } catch {
        // Best-effort cleanup only.
      }
    }
    activePortReservations.clear();
  });
}

function isProcessAlive(pid: number | null): boolean {
  if (!Number.isInteger(pid) || pid === null || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readReservedPid(reservationPath: string): Promise<number | null> {
  try {
    const raw = await fsPromises.readFile(reservationPath, 'utf8');
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === 'number' ? parsed.pid : null;
  } catch {
    return null;
  }
}

async function clearStalePortReservation(reservationPath: string): Promise<boolean> {
  let stats: Awaited<ReturnType<typeof fsPromises.stat>>;
  try {
    stats = await fsPromises.stat(reservationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }

  const reservedPid = await readReservedPid(reservationPath);
  if (isProcessAlive(reservedPid)) return false;
  if (reservedPid === null && Date.now() - stats.mtimeMs < PORT_RESERVATION_STALE_GRACE_MS) {
    return false;
  }

  try {
    await fsPromises.unlink(reservationPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

async function isPortReserved(port: number): Promise<boolean> {
  const reservationPath = getPortReservationPath(port);

  try {
    await fsPromises.access(reservationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }

  if (await clearStalePortReservation(reservationPath)) return false;
  return true;
}

async function tryReservePort(
  port: number,
  exclude: ReadonlySet<number> = new Set(),
): Promise<PortReservation | null> {
  if (exclude.has(port)) return null;

  await fsPromises.mkdir(PORT_RESERVATION_DIR, { recursive: true });
  ensurePortReservationCleanup();

  const reservationPath = getPortReservationPath(port);

  while (true) {
    try {
      const handle = await fsPromises.open(reservationPath, 'wx');
      try {
        await handle.writeFile(
          JSON.stringify({
            pid: process.pid,
            port,
            createdAt: new Date().toISOString(),
          }),
        );
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await clearStalePortReservation(reservationPath)) continue;
      return null;
    }
  }

  if (!(await isPortBindable(port, exclude))) {
    try {
      await fsPromises.unlink(reservationPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return null;
  }

  activePortReservations.add(reservationPath);
  let released = false;

  return {
    port,
    release: async () => {
      if (released) return;
      released = true;
      activePortReservations.delete(reservationPath);
      try {
        await fsPromises.unlink(reservationPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}

async function reservePort(
  port: number,
  exclude: ReadonlySet<number> = new Set(),
): Promise<PortReservation> {
  const reservation = await tryReservePort(port, exclude);
  if (reservation) return reservation;

  throw new Error(`Port ${port} is already in use or reserved by another EdgeBase dev server.`);
}

export async function findAndReservePort(
  startPort: number,
  exclude: ReadonlySet<number> = new Set(),
  maxAttempts = PORT_SEARCH_LIMIT,
): Promise<PortReservation> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = startPort + offset;
    if (candidate > 65535) break;
    const reservation = await tryReservePort(candidate, exclude);
    if (reservation) return reservation;
  }

  throw new Error(
    `Could not reserve an available port in the range ${startPort}-${Math.min(65535, startPort + maxAttempts - 1)}.`,
  );
}

function sanitizeIsolationName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function resolveDevPersistence(
  projectDir: string,
  port: number,
  isolated?: DevIsolationOption,
): DevPersistence {
  if (isolated) {
    const rawName = typeof isolated === 'string' ? isolated : `port-${port}`;
    const label = sanitizeIsolationName(rawName);
    if (!label) {
      throw new Error('Invalid --isolated value. Use letters, numbers, dashes, or omit the name.');
    }
    return {
      label,
      persistTo: join(projectDir, '.edgebase', 'dev', label, 'state'),
    };
  }

  if (port === DEFAULT_DEV_PORT) {
    return {};
  }

  return {
    label: `port-${port}`,
    persistTo: join(projectDir, '.edgebase', 'dev', `port-${port}`, 'state'),
  };
}

export async function resolveDevPorts(preferredPort: number): Promise<ResolvedDevPorts> {
  const port = await findAvailablePort(preferredPort);
  const sidecarPort = await findAvailablePort(port + 1, new Set([port]));
  const inspectorPort = await findAvailablePort(
    DEFAULT_WRANGLER_INSPECTOR_PORT,
    new Set([port, sidecarPort]),
  );

  return {
    port,
    sidecarPort,
    inspectorPort,
    portChanged: port !== preferredPort,
    sidecarChanged: sidecarPort !== port + 1,
    inspectorChanged: inspectorPort !== DEFAULT_WRANGLER_INSPECTOR_PORT,
  };
}

export async function reserveDevPorts(
  preferredPort: number,
  preferredInspectorPort?: number,
  options: ReserveDevPortOptions = {},
): Promise<ReservedDevPorts> {
  const reservations: PortReservation[] = [];

  try {
    const portReservation = options.strictPort
      ? await reservePort(preferredPort)
      : await findAndReservePort(preferredPort);
    reservations.push(portReservation);

    const sidecarReservation = await findAndReservePort(
      portReservation.port + 1,
      new Set([portReservation.port]),
    );
    reservations.push(sidecarReservation);

    const inspectorReservation = preferredInspectorPort !== undefined
      ? await reservePort(preferredInspectorPort, new Set([portReservation.port, sidecarReservation.port]))
      : await findAndReservePort(
        DEFAULT_WRANGLER_INSPECTOR_PORT,
        new Set([portReservation.port, sidecarReservation.port]),
      );
    reservations.push(inspectorReservation);

    return {
      port: portReservation.port,
      sidecarPort: sidecarReservation.port,
      inspectorPort: inspectorReservation.port,
      portChanged: portReservation.port !== preferredPort,
      sidecarChanged: sidecarReservation.port !== portReservation.port + 1,
      inspectorChanged: inspectorReservation.port !== DEFAULT_WRANGLER_INSPECTOR_PORT,
      release: async () => {
        await Promise.allSettled(
          [...reservations].reverse().map((reservation) => reservation.release()),
        );
      },
    };
  } catch (error) {
    await Promise.allSettled(
      [...reservations].reverse().map((reservation) => reservation.release()),
    );
    throw error;
  }
}

function generateDevSecret(): string {
  return randomBytes(32).toString('hex');
}

function resolveWorkerVarBindings(sidecarPort?: number): string[] {
  const vars: string[] = [
    'EDGEBASE_ALLOW_PUBLIC_ADMIN_SETUP:1',
    // `edgebase dev` owns the local Wrangler listener, which supplies the CF
    // client-IP compatibility header. Docker/pack use `self-hosted` instead.
    'EDGEBASE_RUNTIME_MODE:local-development',
  ];

  if (sidecarPort) {
    vars.push(`EDGEBASE_DEV_SIDECAR_PORT:${sidecarPort}`);
  }

  const internalWorkerUrl = process.env.EDGEBASE_INTERNAL_WORKER_URL?.trim();
  if (internalWorkerUrl) {
    vars.push(`EDGEBASE_INTERNAL_WORKER_URL:${internalWorkerUrl.replace(/\/+$/, '')}`);
  }

  return vars;
}

function resolveWorkerCompileDefinitions(): string[] {
  return [LOCAL_DEV_BUILD_DEFINE];
}

function parseEnvFileContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return result;
}

function syncEnvDevelopmentToDevVars(projectDir: string, log = false): boolean {
  const envDevPath = join(projectDir, '.env.development');
  const devVarsPath = join(projectDir, '.dev.vars');
  if (!existsSync(envDevPath)) return false;

  // No hand-maintained .dev.vars yet — safe to create a fresh copy.
  if (!existsSync(devVarsPath)) {
    copyFileSync(envDevPath, devVarsPath);
    if (log) {
      console.log(chalk.green('✓'), '.env.development → .dev.vars synced');
      console.log();
    }
    return true;
  }

  // .dev.vars exists: merge in .env.development values without clobbering the
  // user's file (preserve their comments, ordering, and extra keys).
  const envDevValues = parseEnvFileContent(readFileSync(envDevPath, 'utf-8'));
  const devVarsValues = parseEnvFileContent(readFileSync(devVarsPath, 'utf-8'));

  const changedKeys = Object.keys(envDevValues).filter(
    (key) => devVarsValues[key] !== envDevValues[key],
  );
  if (changedKeys.length === 0) {
    return true; // Already in sync.
  }

  upsertEnvFile(devVarsPath, envDevValues, '# EdgeBase local development secrets (synced)');
  if (log) {
    console.log(
      chalk.yellow('⚠'),
      `.dev.vars already existed — merged ${changedKeys.length} value(s) from .env.development instead of overwriting.`,
    );
    console.log(chalk.dim(`  Updated keys: ${changedKeys.join(', ')}`));
    console.log();
  }
  return true;
}

function syncDevEnvToProcess(projectDir: string): Record<string, string> {
  const envValues = parseDevVars(projectDir);

  for (const [key, originalValue] of activeDevEnvOverrides) {
    if (Object.prototype.hasOwnProperty.call(envValues, key)) continue;
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
    activeDevEnvOverrides.delete(key);
  }

  for (const key of Object.keys(process.env)) {
    if (!isManagedAuthEnvKey(key)) continue;
    if (!(key in envValues)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(envValues)) {
    if (!activeDevEnvOverrides.has(key)) {
      activeDevEnvOverrides.set(key, process.env[key]);
    }
    process.env[key] = value;
  }
  return collectDevRuntimeConfigEnv(envValues, process.env);
}

function evaluateDevConfig(
  configPath: string,
  projectDir: string,
  envValues: Record<string, string>,
): Record<string, unknown> {
  return loadConfigSafe(configPath, projectDir, {
    ...FULL_CONFIG_EVAL,
    env: envValues,
  });
}

export function ensureDevJwtSecrets(projectDir: string): GeneratedDevSecretsResult {
  const envDevPath = join(projectDir, '.env.development');
  const devVarsPath = join(projectDir, '.dev.vars');
  const primaryPath = (existsSync(envDevPath) || !existsSync(devVarsPath)) ? envDevPath : devVarsPath;
  const current = parseDevVars(projectDir);
  const updates: Record<string, string> = {};

  if (!current.JWT_USER_SECRET) {
    updates.JWT_USER_SECRET = generateDevSecret();
  }
  if (!current.JWT_ADMIN_SECRET) {
    updates.JWT_ADMIN_SECRET = generateDevSecret();
  }

  const generatedKeys = Object.keys(updates);
  if (generatedKeys.length > 0) {
    writeLocalSecrets(projectDir, updates);
  }

  return {
    generatedKeys,
    primaryPath: generatedKeys.length > 0 ? primaryPath : null,
  };
}

/**
 * `npx edgebase dev` — Local development server using Miniflare.
 *
 * Wraps `wrangler dev` with:
 * 1. Plugin detection
 * 2. functions/ watch → _functions-registry.ts 자동 재생성
 * 3. edgebase.config.ts watch → runtime config refresh + wrangler 재시작
 */
export const devCommand = new Command('dev')
  .alias('dv')
  .description('Start local development server')
  .option('-p, --port <port>', 'Preferred port number', String(DEFAULT_DEV_PORT))
  .option('--auto-port', 'When the preferred --port is busy, use the next available port')
  .option('--host <host>', 'Bind wrangler dev to a specific host or IP address')
  .option('--inspector-port <port>', 'Bind wrangler dev inspector to a specific port')
  .option('--isolated [name]', 'Use an isolated local state directory (defaults to the selected port)')
  .option('--open', 'Open admin dashboard in browser')
  .action(async (options: {
    port: string;
    autoPort?: boolean;
    host?: string;
    inspectorPort?: string;
    open: boolean;
    isolated?: DevIsolationOption;
  }) => {
    const projectDir = resolve('.');
    const configPath = join(projectDir, 'edgebase.config.ts');
    const configDir = join(projectDir, 'config');
    const devBundleOutput = join('.edgebase', 'targets', 'dev-app');
    let devBundleDir = resolve(projectDir, devBundleOutput);

    if (!existsSync(configPath)) {
      raiseCliError({
        code: 'dev_config_not_found',
        message: 'edgebase.config.ts not found.',
        hint: 'Run `npm create edgebase@latest my-app` first.',
      });
    }

    const preferredPort = parsePort(options.port, '--port');
    const preferredInspectorPort = options.inspectorPort
      ? parsePort(options.inspectorPort, '--inspector-port')
      : undefined;
    const explicitPortRequested = wasFlagProvided(process.argv.slice(2), '--port', '-p');
    const strictPort = explicitPortRequested && !options.autoPort;
    let resolvedPorts: ReservedDevPorts;
    try {
      resolvedPorts = await reserveDevPorts(preferredPort, preferredInspectorPort, {
        strictPort,
      });
    } catch (error) {
      raiseCliError({
        code: 'dev_port_unavailable',
        message: (error as Error).message,
        hint: strictPort
          ? 'Choose a different --port or rerun with --auto-port to allow fallback.'
          : 'Choose a different port, free the port, or retry once the other dev server stops.',
      });
    }
    const persistence = resolveDevPersistence(projectDir, resolvedPorts.port, options.isolated);
    const localApiUrl = `http://localhost:${resolvedPorts.port}`;
    const localAdminUrl = `${localApiUrl}/admin`;
    const generatedDevSecrets = ensureDevJwtSecrets(projectDir);
    if (persistence.persistTo) {
      mkdirSync(persistence.persistTo, { recursive: true });
    }

    console.log(chalk.blue('⚡ Starting EdgeBase dev server...'));
    if (resolvedPorts.portChanged) {
      console.log(chalk.yellow('↪'), `Port ${preferredPort} is in use — using ${resolvedPorts.port} instead`);
    } else {
      console.log(chalk.dim(`  Port: ${resolvedPorts.port}`));
    }
    console.log(chalk.dim(`  API: ${localApiUrl}`));
    console.log(chalk.dim(`  Admin: ${localAdminUrl}`));
    if (resolvedPorts.sidecarChanged) {
      console.log(
        chalk.yellow('↪'),
        `Sidecar port ${resolvedPorts.port + 1} is in use — using ${resolvedPorts.sidecarPort} instead`,
      );
    }
    if (!options.inspectorPort) {
      if (resolvedPorts.inspectorChanged) {
        console.log(
          chalk.yellow('↪'),
          `Inspector port ${DEFAULT_WRANGLER_INSPECTOR_PORT} is in use — using ${resolvedPorts.inspectorPort} instead`,
        );
      } else {
        console.log(chalk.dim(`  Inspector: ${resolvedPorts.inspectorPort}`));
      }
    }
    if (persistence.persistTo) {
      console.log(chalk.dim(`  State: ${persistence.persistTo}`));
    }
    if (generatedDevSecrets.generatedKeys.length > 0 && generatedDevSecrets.primaryPath) {
      const label = generatedDevSecrets.generatedKeys.length === 1 ? 'secret' : 'secrets';
      console.log(
        chalk.green('✓'),
        `Generated missing local JWT ${label} in ${generatedDevSecrets.primaryPath.replace(`${projectDir}/`, '')}`,
      );
    }

    // Display release mode
    try {
      const envValues = syncDevEnvToProcess(projectDir);
      const config = evaluateDevConfig(configPath, projectDir, envValues);
      const preservedDevState = await preserveDevBundleState(devBundleDir);
      let initialBundle: ReturnType<typeof createAppBundle>;
      try {
        initialBundle = createAppBundle(projectDir, {
          outputDir: devBundleOutput,
          overwrite: true,
          configEvaluationEnv: envValues,
        });
        writeDevBundleVars(initialBundle.outputDir, envValues);
        await restoreDevBundleState(preservedDevState);
      } catch (err) {
        await discardPreservedDevBundleState(preservedDevState);
        throw err;
      }
      devBundleDir = initialBundle.outputDir;
      if (config.release) {
        console.log(
          chalk.yellow('🔒'),
          'Release mode (release: true) — local dev enforces explicit access rules.',
        );
        console.log(
          chalk.dim(
            '  Add public.* and access.* rules to match production behavior and avoid unexpected access-denied errors.',
          ),
        );
      } else {
        console.log(
          chalk.green('🔓'),
          'Development mode (release: false) — missing access rules fall back to allow-by-default locally.',
        );
        console.log(
          chalk.dim(
            '  This is dev-only behavior. Add explicit public.* and access.* rules to preview production behavior and silence fallback warnings.',
          ),
        );
      }
      console.log(chalk.dim(`  Bundle: ${relative(projectDir, devBundleDir) || devBundleDir}`));

      checkWranglerAuth(projectDir);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      console.error(chalk.red('✗'), 'Failed to parse edgebase.config.ts:');
      // Show detailed error info (file location, syntax details) when available
      for (const line of message.split('\n').slice(0, 8)) {
        if (line.trim()) console.error(chalk.dim(`  ${line.trim()}`));
      }
      console.error(chalk.dim('  → Fix the config file; dev server will retry on save.'));
    }

    console.log();

    const functionsDir = join(projectDir, 'functions');
    const syncDevBundle = (): boolean => {
      const envValues = syncDevEnvToProcess(projectDir);

      try {
        const result = syncAppBundle(projectDir, devBundleDir, {
          configEvaluationEnv: envValues,
        });
        writeDevBundleVars(result.outputDir, envValues);
        devBundleDir = result.outputDir;
        return true;
      } catch (err) {
        console.error(
          chalk.red('✗'),
          'App bundle refresh failed:',
          (err as Error).message?.split('\n')[0] ?? 'Unknown app bundle error.',
        );
        console.log(chalk.dim(`  → Check ${configPath} and the frontend/functions inputs, then save again.`));
        return false;
      }
    };
    const syncDevFunctions = (): boolean => {
      try {
        syncAppBundleFunctions(projectDir, devBundleDir);
        return true;
      } catch (err) {
        console.error(
          chalk.red('✗'),
          'Function bundle refresh failed:',
          (err as Error).message?.split('\n')[0] ?? 'Unknown function bundle error.',
        );
        console.log(chalk.dim(`  → Check ${functionsDir}, then save again.`));
        return false;
      }
    };
    let configDebounce: ReturnType<typeof setTimeout> | null = null;
    let wranglerProcess: ChildProcess | null = null;
    let lastConfigSignature = getPathSignature(configPath);
    const configFileSignatures = new Map<string, string | null>();
    const cleanupHandles: Array<{ close: () => void }> = [];
    let tempWranglerPath: string | null = null;
    let sidecarServer: ReturnType<typeof import('node:http').createServer> | null = null;
    let keepRunning = true;
    let restartRequested = false;
    let pendingDevRestore: {
      dumped: DumpedData;
      scope: MigrationOptions['scope'];
      namespaces?: string[];
    } | null = null;
    let interruptionSignal: NodeJS.Signals | null = null;
    let sessionSettled = false;

    // ─── Watch: functions/ → 자동 재생성 ───
    if (existsSync(functionsDir)) {
      let functionsDebounce: ReturnType<typeof setTimeout> | null = null;

      try {
        const watcher = watch(functionsDir, { recursive: true }, (_eventType, filename) => {
          if (!filename || !filename.endsWith('.ts') || filename.startsWith('_')) return;

          // Debounce: 파일 저장 시 여러 이벤트 발생 → 300ms 후 1번만 실행
          if (functionsDebounce) clearTimeout(functionsDebounce);
          functionsDebounce = setTimeout(() => {
            console.log();
            console.log(chalk.blue('🔄'), `functions/${filename} changed — refreshing app bundle...`);
            if (syncDevFunctions()) {
              console.log(chalk.green('✓'), 'Dev app bundle refreshed');
            }
          }, 300);
        });
        cleanupHandles.push(watcher);
        console.log(chalk.dim('  👀 Watching functions/ for changes'));
      } catch {
        // watch may not support recursive on all platforms
      }
    }

    // ─── Watch: edgebase.config.ts → runtime reload ───
    function cleanupTempWrangler(): void {
      if (!tempWranglerPath) return;
      try {
        unlinkSync(tempWranglerPath);
      } catch {
        /* cleanup non-fatal */
      }
      tempWranglerPath = null;
    }

    async function releaseSessionResources(): Promise<void> {
      const activeWrangler = wranglerProcess;
      wranglerProcess = null;
      if (activeWrangler) {
        await terminateChildProcessTree(activeWrangler, keepRunning ? 'SIGTERM' : 'SIGKILL');
      }
      cleanupTempWrangler();
      for (const handle of cleanupHandles.splice(0)) {
        try {
          handle.close();
        } catch {
          /* ignore watcher close errors */
        }
      }
      const activeSidecar = sidecarServer;
      sidecarServer = null;
      await closeHttpServer(activeSidecar);
      await resolvedPorts.release();
    }

    let resolveSession!: () => void;
    let rejectSession!: (error: unknown) => void;
    const sessionDone = new Promise<void>((resolve, reject) => {
      resolveSession = resolve;
      rejectSession = reject;
    });

    async function settleSession(error?: unknown): Promise<void> {
      if (sessionSettled) return;
      sessionSettled = true;
      await releaseSessionResources();
      if (error) {
        rejectSession(error);
      } else {
        resolveSession();
      }
    }

    const onConfigChange = (label: string) => {
      if (configDebounce) clearTimeout(configDebounce);
      configDebounce = setTimeout(() => {
        console.log();
        console.log(chalk.blue('🔄'), `${label} changed — reloading config...`);
        if (!syncDevBundle()) {
          return;
        }
        void (async () => {
          // Schema destructive change detection + provider change migration
          // Returns true if wrangler was already restarted (reset/migration action)
          const handled = await checkSchemaChanges(
            projectDir,
            configPath,
            wranglerProcess,
            resolvedPorts.port,
            persistence.persistTo,
            (data) => {
              pendingDevRestore = data;
            },
            () => {
              restartRequested = true;
            },
          );

          // Restart wrangler to pick up new config (if not already restarted by reset)
          if (!handled && wranglerProcess) {
            console.log(chalk.yellow('♻️'), 'Restarting wrangler dev...');
            restartRequested = true;
            void terminateChildProcessTree(wranglerProcess, 'SIGTERM');
          }
        })();
      }, 500);
    };

    let configPathDebounce: ReturnType<typeof setTimeout> | null = null;
    try {
      const watcher = watch(configPath, () => {
        if (configPathDebounce) clearTimeout(configPathDebounce);
        configPathDebounce = setTimeout(() => {
          const nextSignature = getPathSignature(configPath);
          if (!nextSignature || nextSignature === lastConfigSignature) return;
          lastConfigSignature = nextSignature;
          onConfigChange('edgebase.config.ts');
        }, 150);
      });
      cleanupHandles.push(watcher);
      console.log(chalk.dim('  👀 Watching edgebase.config.ts for changes'));
    } catch {
      // file watch error — non-fatal
    }

    if (existsSync(configDir)) {
      for (const filePath of listConfigWatchFiles(configDir)) {
        configFileSignatures.set(filePath, getPathSignature(filePath));
      }
      const configDirDebounces = new Map<string, ReturnType<typeof setTimeout>>();
      try {
        const watcher = watch(configDir, { recursive: true }, (_eventType, filename) => {
          if (!filename || !/\.(ts|js|mts|cts|mjs|cjs)$/.test(filename)) return;
          const changedPath = join(configDir, filename);
          const existingDebounce = configDirDebounces.get(changedPath);
          if (existingDebounce) clearTimeout(existingDebounce);
          configDirDebounces.set(
            changedPath,
            setTimeout(() => {
              configDirDebounces.delete(changedPath);
              const nextSignature = getPathSignature(changedPath);
              const previousSignature = configFileSignatures.get(changedPath) ?? null;
              if (nextSignature === previousSignature) return;
              if (!nextSignature && previousSignature === null) return;
              configFileSignatures.set(changedPath, nextSignature);
              onConfigChange(`config/${filename}`);
            }, 150),
          );
        });
        cleanupHandles.push(watcher);
        console.log(chalk.dim('  👀 Watching config/ for changes'));
      } catch {
        // file watch error — non-fatal
      }
    }

    const localEnvWatchPath = existsSync(join(projectDir, '.env.development'))
      ? join(projectDir, '.env.development')
      : join(projectDir, '.dev.vars');
    let envPathDebounce: ReturnType<typeof setTimeout> | null = null;
    let lastEnvSignature = getPathSignature(localEnvWatchPath);
    try {
      const watcher = watch(localEnvWatchPath, () => {
        if (envPathDebounce) clearTimeout(envPathDebounce);
        envPathDebounce = setTimeout(() => {
          const nextSignature = getPathSignature(localEnvWatchPath);
          if (!nextSignature || nextSignature === lastEnvSignature) return;
          lastEnvSignature = nextSignature;
          if (localEnvWatchPath.endsWith('.env.development')) {
            syncEnvDevelopmentToDevVars(projectDir, false);
          }
          onConfigChange(localEnvWatchPath.endsWith('.env.development') ? '.env.development' : '.dev.vars');
        }, 150);
      });
      cleanupHandles.push(watcher);
      console.log(chalk.dim(`  👀 Watching ${relative(projectDir, localEnvWatchPath) || '.env.development'} for changes`));
    } catch {
      // file watch error — non-fatal
    }

    console.log();

    // ─── Sync .env.development → .dev.vars ───
    syncEnvDevelopmentToDevVars(projectDir, true);

    // ─── Start Schema Editor Sidecar ───
    const sidecarPort = resolvedPorts.sidecarPort;

    try {
      const { startSidecar, parseDevVars } = await import('../lib/dev-sidecar.js');
      const devVars = parseDevVars(projectDir);
      const adminSecret = devVars.JWT_ADMIN_SECRET;

      if (adminSecret) {
        sidecarServer = startSidecar({
          port: sidecarPort,
          workerPort: resolvedPorts.port,
          configPath,
          projectDir,
          adminSecret,
        });
      } else {
        console.log(
          chalk.dim(
            '  📐 Schema Editor sidecar skipped — API server will continue to run. Add JWT_ADMIN_SECRET to .env.development or .dev.vars to enable the local schema editor.',
          ),
        );
      }
    } catch (err) {
      console.log(
        chalk.dim('  📐 Schema Editor sidecar skipped — API server will continue to run:'),
        (err as Error).message,
      );
    }

    // ─── Start wrangler dev (with auto-restart) ───
    function refreshTempWrangler(): void {
      cleanupTempWrangler();

      let config: Record<string, unknown> | undefined;
      try {
        const envValues = syncDevEnvToProcess(projectDir);
        config = evaluateDevConfig(configPath, projectDir, envValues);
        const bundle = syncAppBundle(projectDir, devBundleDir, {
          configEvaluationEnv: envValues,
        });
        writeDevBundleVars(bundle.outputDir, envValues);
        devBundleDir = bundle.outputDir;
      } catch (err) {
        const detail = (err as Error).message ?? String(err);
        const firstLine = detail.split('\n')[0];
        throw new Error(
          `Failed to evaluate edgebase.config.ts for dev runtime:\n  ${firstLine}` +
          (detail.includes('\n') ? '\n  ' + detail.split('\n').slice(1, 5).map(l => l.trim()).filter(Boolean).join('\n  ') : ''),
        );
      }

      tempWranglerPath = generateTempWranglerToml(
        join(devBundleDir, 'wrangler.toml'),
        {
          bindings: resolveLocalDevBindings(config),
          triggerMode: 'preserve',
          rateLimitBindings: resolveDevRateLimitBindings(),
          requiredCompatibilityFlags: DEV_REQUIRED_COMPATIBILITY_FLAGS,
        },
      );
    }

    function startWrangler() {
      syncEnvDevelopmentToDevVars(projectDir, false);
      const recentWranglerStderr: string[] = [];
      let wranglerStderrDisplayRemainder = '';
      let wranglerStderrCaptureRemainder = '';

      try {
        refreshTempWrangler();
      } catch (err) {
        void settleSession(Object.assign(new Error((err as Error).message), {
          edgebaseCode: 'dev_runtime_config_failed',
        }));
        return;
      }
      const wranglerTool = prepareWranglerDevTool(projectDir);

      const wranglerArgs = [...wranglerTool.argsPrefix, 'dev', '--port', String(resolvedPorts.port)];
      if (options.host) {
        wranglerArgs.push('--ip', options.host);
      }
      if (options.inspectorPort) {
        wranglerArgs.push('--inspector-port', String(resolvedPorts.inspectorPort));
      } else {
        wranglerArgs.push('--inspector-port', String(resolvedPorts.inspectorPort));
      }

      // Pass internal-only runtime vars to the worker.
      for (const definition of resolveWorkerCompileDefinitions()) {
        wranglerArgs.push('--define', definition);
      }
      for (const binding of resolveWorkerVarBindings(sidecarServer ? sidecarPort : undefined)) {
        wranglerArgs.push('--var', binding);
      }

      if (persistence.persistTo) {
        wranglerArgs.push('--persist-to', persistence.persistTo);
      }

      if (tempWranglerPath) {
        wranglerArgs.push('--config', tempWranglerPath);
      }

      wranglerProcess = spawn(wranglerTool.command, wranglerArgs, {
        cwd: devBundleDir,
        stdio: ['inherit', 'inherit', 'pipe'],
        detached: process.platform !== 'win32',
        env: resolveWranglerDevProcessEnv(process.env),
      });

      wranglerProcess.stderr?.setEncoding('utf8');
      wranglerProcess.stderr?.on('data', (chunk) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const filtered = filterWranglerStderrChunkForDisplay(text, wranglerStderrDisplayRemainder);
        wranglerStderrDisplayRemainder = filtered.remainder;
        if (!filtered.display) return;

        process.stderr.write(filtered.display);
        wranglerStderrCaptureRemainder = appendRecentOutputChunk(
          recentWranglerStderr,
          filtered.display,
          wranglerStderrCaptureRemainder,
        );
      });

      // Wrap wrangler process errors with EdgeBase-specific guidance so users
      // don't have to decipher raw wrangler/Miniflare output on their own.
      wranglerProcess.on('error', (err) => {
        void settleSession(Object.assign(new Error(err.message), {
          edgebaseCode: 'wrangler_dev_start_failed',
        }));
      });

      wranglerProcess.on('exit', (code) => {
        const shouldRespawn = restartRequested;
        restartRequested = false;
        const finalDisplay = flushWranglerStderrDisplayRemainder(wranglerStderrDisplayRemainder);
        wranglerStderrDisplayRemainder = '';
        if (finalDisplay) {
          process.stderr.write(finalDisplay);
          wranglerStderrCaptureRemainder = appendRecentOutputChunk(
            recentWranglerStderr,
            finalDisplay,
            wranglerStderrCaptureRemainder,
          );
        }
        flushRecentOutputRemainder(recentWranglerStderr, wranglerStderrCaptureRemainder);
        wranglerStderrCaptureRemainder = '';
        cleanupTempWrangler();
        if (shouldRespawn) {
          // Config change triggered restart → respawn wrangler
          setTimeout(() => startWrangler(), 500);
        } else {
          if (keepRunning) {
            if (code && code !== 0) {
              void settleSession(Object.assign(new Error(`Wrangler exited with code ${code}.`), {
                edgebaseCode: 'wrangler_dev_exit',
                exitCode: code,
                diagnostics: [...recentWranglerStderr],
              }));
              return;
            }
            void settleSession();
          } else {
            void settleSession(
              interruptionSignal
                ? new CommanderError(130, interruptionSignal, '')
                : undefined,
            );
          }
        }
      });

      // Post-restart migration restore
      if (pendingDevRestore) {
        const restore = pendingDevRestore;
        pendingDevRestore = null;
        const port = resolvedPorts.port;

        // Wait for the new server, then restore
        void waitForServer(port, 30).then(async (ready) => {
          if (!ready) {
            console.error(chalk.red('✗ Server did not start in time. Migration restore skipped.'));
            console.error(chalk.dim('  You can retry with: npx edgebase migrate'));
            return;
          }

          console.log();
          console.log(chalk.blue('📦 Continuing database block migration after the worker restart...'));
          if (restore.scope === 'data' || restore.scope === 'all') {
            const namespaces = restore.namespaces ?? [];
            const blockLabel = namespaces.length > 0
              ? namespaces.join(', ')
              : 'all configured data blocks';
            console.log(chalk.dim(`  DB blocks: ${blockLabel}`));
            console.log(chalk.dim('  Every table in each migrated block will be restored to the new provider.'));
          }

          // Read service key from .dev.vars or .env.development
          let serviceKey = '';
          const devVarsPath = join(projectDir, '.dev.vars');
          const envDevPath = join(projectDir, '.env.development');
          for (const envPath of [devVarsPath, envDevPath]) {
            if (existsSync(envPath)) {
              const content = readFileSync(envPath, 'utf-8');
              const match = content.match(/^SERVICE_KEY\s*=\s*(.+)$/m);
              if (match) {
                serviceKey = match[1].trim().replace(/^["']|["']$/g, '');
                break;
              }
            }
          }

          if (!serviceKey) {
            console.error(chalk.red('✗ SERVICE_KEY not found in .dev.vars or .env.development'));
            console.error(chalk.dim('  Add SERVICE_KEY=<your-key> to continue migration.'));
            return;
          }

          try {
            await restoreToNewProvider(
              {
                scope: restore.scope,
                namespaces: restore.namespaces,
                serverUrl: `http://localhost:${port}`,
                serviceKey,
                dryRun: false,
              },
              restore.dumped,
            );
            console.log();
            console.log(chalk.green('✓ Database block migration complete!'));
          } catch (err) {
            console.error();
            console.error(chalk.red('✗ Migration restore failed:'), (err as Error).message);
            console.error(chalk.dim('  You can retry with: npx edgebase migrate'));
          }
        });
      }
    }

    startWrangler();

    // Auto-open admin dashboard when server is ready
    if (options.open) {
      waitForServer(resolvedPorts.port).then((ready) => {
        if (ready) {
          const url = localAdminUrl;
          console.log(chalk.green('✓'), `Opening ${chalk.cyan(url)}`);
          openBrowser(url);
        }
      });
    }

    // Forward signals → clean shutdown
    const handleSigint = () => {
      keepRunning = false;
      interruptionSignal = 'SIGINT';
      restartRequested = false;
      if (wranglerProcess) {
        void terminateChildProcessTree(wranglerProcess, 'SIGINT');
      } else {
        void settleSession(new CommanderError(130, 'SIGINT', ''));
      }
    };
    const handleSigterm = () => {
      keepRunning = false;
      interruptionSignal = 'SIGTERM';
      restartRequested = false;
      if (wranglerProcess) {
        void terminateChildProcessTree(wranglerProcess, 'SIGTERM');
      } else {
        void settleSession(new CommanderError(130, 'SIGTERM', ''));
      }
    };
    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigterm);

    try {
      await sessionDone;
    } catch (error) {
      process.off('SIGINT', handleSigint);
      process.off('SIGTERM', handleSigterm);
      if (error instanceof CommanderError || isCliStructuredError(error)) throw error;

      const devError = error as Error & { edgebaseCode?: string; exitCode?: number; diagnostics?: string[] };
      if (devError.edgebaseCode === 'dev_runtime_config_failed') {
        raiseCliError({
          code: 'dev_runtime_config_failed',
          message: devError.message,
          hint: 'Check edgebase.config.ts and the generated wrangler runtime config, then retry.',
        });
      }
      if (devError.edgebaseCode === 'wrangler_dev_start_failed') {
        raiseCliError({
          code: 'wrangler_dev_start_failed',
          message: `Failed to start wrangler dev: ${devError.message}`,
          hint: devError.message.includes('ENOENT')
            ? 'Wrangler binary not found. Run `npm install` and ensure wrangler is installed.'
            : 'Check your wrangler.toml and edgebase.config.ts, then retry `npx edgebase dev`.',
        });
      }
      if (devError.edgebaseCode === 'wrangler_dev_exit') {
        raiseCliError({
          code: 'wrangler_dev_exit',
          message: devError.message,
          hint: inferWranglerDevExitHint(devError.diagnostics ?? []),
          details: devError.diagnostics?.length ? devError.diagnostics : undefined,
        }, devError.exitCode ?? 1);
      }
      throw error;
    }

    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigterm);
  });

// ─── Helper: Functions Registry Rebuild ───

function rebuildFunctionsRegistry(functionsDir: string, registryPath: string): void {
  try {
    const functions = existsSync(functionsDir) ? scanFunctions(functionsDir) : [];
    // Plugin functions are registered at runtime from config.plugins[] (Explicit Import Pattern).
    validateRouteNames(functions);
    generateFunctionRegistry(functions, registryPath, {
      configImportPath: './generated-config.js',
      functionsImportBasePath: relative(dirname(registryPath), functionsDir).replace(/\\/g, '/'),
    });

    if (functions.length > 0) {
      console.log(
        chalk.green('✓'),
        `Registry rebuilt: ${functions.length} function(s) →`,
        functions.map((f) => chalk.cyan(f.name)).join(', '),
      );
    } else {
      console.log(
        chalk.green('✓'),
        'Registry rebuilt: 0 user function(s) — plugin functions remain available',
      );
    }
  } catch (err) {
    console.error(chalk.red('✗'), 'Failed to rebuild functions registry:', (err as Error).message);
  }
}

function getPathSignature(path: string): string | null {
  try {
    const content = readFileSync(path);
    return createHash('sha1').update(content).digest('hex');
  } catch {
    return null;
  }
}

function listConfigWatchFiles(configDir: string): string[] {
  const files: string[] = [];
  const queue = [configDir];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    if (!currentDir) continue;

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (/\.(ts|js|mts|cts|mjs|cjs)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export const _devInternals = {
  rebuildFunctionsRegistry,
  getPathSignature,
  listConfigWatchFiles,
  checkSchemaChanges,
  parsePort,
  getPortReservationPath,
  findAndReservePort,
  findAvailablePort,
  isPortAvailable,
  resolveDevPorts,
  reserveDevPorts,
  resolveDevPersistence,
  resolveWorkerVarBindings,
  resolveWorkerCompileDefinitions,
  assertNoLocalDevBuildMarker,
  sanitizeIsolationName,
  ensureDevJwtSecrets,
  collectDevRuntimeConfigEnv,
  serializeDevBundleVars,
  writeDevBundleVars,
  resolveWranglerDevProcessEnv,
  requiredDevCompatibilityFlags: DEV_REQUIRED_COMPATIBILITY_FLAGS,
  syncDevEnvToProcess,
  evaluateDevConfig,
  resolveDevRateLimitBindings,
  appendRecentOutputChunk,
  inferWranglerDevExitHint,
  shouldSuppressWranglerStderrLine,
  filterWranglerStderrChunkForDisplay,
};

/**
 * Check for destructive schema changes and provider changes after config rebundle.
 * In dev mode, snapshot is NOT updated (§5) — only reset action updates it.
 * Returns true if wrangler was restarted (reset/migration action), false otherwise.
 */
async function checkSchemaChanges(
  projectDir: string,
  configPath: string,
  wranglerProcess: ChildProcess | null,
  port: number,
  persistTo: string | undefined,
  setPendingRestore: (data: {
    dumped: DumpedData;
    scope: MigrationOptions['scope'];
    namespaces?: string[];
  }) => void,
  requestRestart: () => void,
): Promise<boolean> {
  try {
    const envValues = syncDevEnvToProcess(projectDir);
    const configJson = evaluateDevConfig(configPath, projectDir, envValues);
    const databases = extractDatabases(configJson);
    if (!databases || Object.keys(databases).length === 0) return false;

    const authProvider = (configJson.auth as { provider?: string } | undefined)?.provider;
    const currentSnapshot = buildSnapshot(
      databases as Record<string, import('@edge-base/shared').DbBlock>,
      authProvider,
    );
    const savedSnapshot = loadSnapshot(projectDir);
    if (!savedSnapshot) return false; // No saved snapshot — nothing to compare

    // ─── Destructive Change Detection ───
    let changes = detectDestructiveChanges(savedSnapshot, currentSnapshot);
    changes = filterAutoPassChanges(changes, savedSnapshot, currentSnapshot);
    if (changes.length > 0) {
      // Dev mode is always release: false
      const result = await handleDestructiveChanges(changes, false, !isNonInteractive());

      if (result.action === 'reset') {
        resetLocalDoState(projectDir, persistTo);
        saveSnapshot(projectDir, currentSnapshot);
        console.log(chalk.green('✓'), 'Schema snapshot updated after DB reset');

        // Restart wrangler to pick up clean state
        if (wranglerProcess) {
          console.log(chalk.yellow('♻️'), 'Restarting wrangler dev...');
          requestRestart();
          void terminateChildProcessTree(wranglerProcess, 'SIGTERM');
        }
        return true;
      }

      if (result.action === 'migration_guide') {
        return true;
      }
    }

    // ─── Provider Change Detection + Migration ───
    const providerChanges = detectProviderChanges(savedSnapshot, currentSnapshot);
    const authChange = detectAuthProviderChange(savedSnapshot, currentSnapshot);
    const allChanges = [...providerChanges];
    if (authChange) allChanges.push(authChange);

    if (allChanges.length > 0 && (process.stdin.isTTY || isNonInteractive())) {
      const answer = await promptMigration(allChanges);

      if (answer === 'migrate') {
        // Read service key from .dev.vars or .env.development
        let serviceKey = '';
        const devVarsPath = join(projectDir, '.dev.vars');
        const envDevPath = join(projectDir, '.env.development');
        for (const envPath of [devVarsPath, envDevPath]) {
          if (existsSync(envPath)) {
            const content = readFileSync(envPath, 'utf-8');
            const match = content.match(/^SERVICE_KEY\s*=\s*(.+)$/m);
            if (match) {
              serviceKey = match[1].trim().replace(/^["']|["']$/g, '');
              break;
            }
          }
        }

        if (!serviceKey) {
          console.error(chalk.red('✗ SERVICE_KEY not found in .dev.vars or .env.development'));
          console.error(chalk.dim('  Add SERVICE_KEY=<your-key> to enable migration.'));
        } else {
          const serverUrl = `http://localhost:${port}`;
          const dataNamespaces = providerChanges.map((pc) => pc.namespace);
          const scope: MigrationOptions['scope'] = authChange
            ? dataNamespaces.length > 0
              ? 'all'
              : 'auth'
            : 'data';

          console.log();
          console.log(chalk.blue('📦 Dumping data from current provider...'));
          try {
            const dumped = await dumpCurrentData({
              scope,
              namespaces: dataNamespaces.length > 0 ? dataNamespaces : undefined,
              serverUrl,
              serviceKey,
              dryRun: false,
            });

            // Schedule restore after wrangler restarts
            setPendingRestore({
              dumped,
              scope,
              namespaces: dataNamespaces.length > 0 ? dataNamespaces : undefined,
            });
            console.log(chalk.green('✓'), 'Data dumped. Restarting with new config...');
          } catch (err) {
            console.error(chalk.red('✗ Data dump failed:'), (err as Error).message);
            console.error(
              chalk.dim('  Migration skipped. You can retry with: npx edgebase migrate'),
            );
          }
        }

        // Save snapshot so provider change is recorded
        saveSnapshot(projectDir, currentSnapshot);

        // Restart wrangler to pick up new provider config
        if (wranglerProcess) {
          console.log(chalk.yellow('♻️'), 'Restarting wrangler dev...');
          requestRestart();
          void terminateChildProcessTree(wranglerProcess, 'SIGTERM');
        }
        return true;
      } else {
        // User chose to skip — save snapshot to not prompt again
        saveSnapshot(projectDir, currentSnapshot);
      }
    }
  } catch (err) {
    if (isCliStructuredError(err)) throw err;

    console.error(chalk.red('✗'), `Config reload failed: ${(err as Error).message}`);
    console.log(chalk.dim('  Fix edgebase.config.ts, then restart `npx edgebase dev`.'));
  }
  return false;
}

// ─── Helper: Auto-open browser ───

/** Poll the dev server health endpoint until it responds. */
async function waitForServer(port: number, maxRetries = 30): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Open a URL in the default browser (cross-platform). */
function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  } else if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
  } else {
    spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  }
}
