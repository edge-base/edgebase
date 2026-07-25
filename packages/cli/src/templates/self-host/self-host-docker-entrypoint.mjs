/* global AbortController, AbortSignal, clearTimeout, console, fetch, process, setTimeout */

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_ROOT = '/app';
const MANIFEST_PATH = join(APP_ROOT, 'edgebase-app.json');
const CONTROL_ROOT = '/__edgebase/internal/self-host';
const STARTUP_TIMEOUT_MS = 90_000;
const RUNTIME_PREBUILD_TIMEOUT_MS = 180_000;
const RUNTIME_PREBUILD_MAX_BYTES = 64 * 1024 * 1024;
const RUNTIME_PREBUILD_GROUP_SHUTDOWN_TIMEOUT_MS = 2_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const GATEWAY_DRAIN_TIMEOUT_MS = 5_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function positivePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function verifySelfHostAssets() {
  const source = readFileSync(MANIFEST_PATH);
  if (source.byteLength > 4 * 1024 * 1024) throw new Error('edgebase-app manifest is too large.');
  const manifest = JSON.parse(source.toString('utf8'));
  if (!SHA256_PATTERN.test(manifest?.generation)) {
    throw new Error('Invalid immutable app generation.');
  }
  if (!SHA256_PATTERN.test(manifest?.schedules?.digest)) {
    throw new Error('Invalid managed schedule digest.');
  }
  const selfHost = manifest?.selfHost;
  if (!selfHost || selfHost.schemaVersion !== 1) throw new Error('Invalid self-host manifest.');
  const expected = {
    gateway: '.edgebase/self-host/self-host-gateway.mjs',
    scheduleSupervisor: '.edgebase/self-host/self-host-schedule-supervisor.mjs',
    dockerEntrypoint: '.edgebase/self-host/self-host-docker-entrypoint.mjs',
    wranglerRuntime: '.edgebase/self-host/self-host-wrangler-runtime.mjs',
    proxyWorker: '.edgebase/self-host/self-host-proxy-worker.js',
  };
  const assets = {};
  for (const [name, expectedPath] of Object.entries(expected)) {
    const asset = selfHost[name];
    if (
      !asset
      || asset.path !== expectedPath
      || !SHA256_PATTERN.test(asset.digest)
      || !Number.isSafeInteger(asset.bytes)
      || asset.bytes < 1
      || asset.bytes > 2 * 1024 * 1024
    ) {
      throw new Error(`Invalid self-host ${name} asset manifest.`);
    }
    const path = join(APP_ROOT, asset.path);
    const fileStat = lstatSync(path);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== asset.bytes) {
      throw new Error(`Self-host ${name} asset does not match its file contract.`);
    }
    const content = readFileSync(path);
    const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    if (digest !== asset.digest) throw new Error(`Self-host ${name} asset digest mismatch.`);
    assets[name] = { path: asset.path, digest: asset.digest, bytes: asset.bytes };
  }
  const generation = `sha256:${createHash('sha256').update(JSON.stringify({
    schemaVersion: 1,
    assets,
  })).digest('hex')}`;
  if (generation !== selfHost.generation) throw new Error('Self-host generation digest mismatch.');
  return { manifest, assets };
}

function childTerminalError(outcome, context) {
  if (outcome.kind === 'error') {
    return new Error(`Wrangler failed during ${context}.`, { cause: outcome.error });
  }
  return new Error(
    `Wrangler exited during ${context} (code=${String(outcome.code)}, signal=${String(outcome.signal)}).`,
  );
}

function signalOwnedProcessGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const args = ['/pid', String(child.pid), '/t'];
    if (signal === 'SIGKILL') args.push('/f');
    spawnSync('taskkill', args, {
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function ownedProcessGroupAlive(child) {
  if (!child.pid) return false;
  if (process.platform === 'win32') {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForOwnedProcessGroupExit(child, deadline) {
  while (ownedProcessGroupAlive(child) && remainingMs(deadline) > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, remainingMs(deadline))));
  }
  return !ownedProcessGroupAlive(child);
}

function remainingMs(deadline) {
  return Math.max(0, deadline - Date.now());
}

async function waitUntil(promise, timeoutMs) {
  if (timeoutMs <= 0) return false;
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForOwnedRuntime(origin, secret, authority, raceChild, signal) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason ?? new Error('Runtime readiness wait aborted.');
    try {
      const response = await raceChild(fetch(`${origin}${CONTROL_ROOT}/ready`, {
        headers: { 'x-edgebase-self-host-control': secret },
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(Math.max(1, remainingMs(deadline))),
        ]),
      }), 'authenticated readiness');
      if (response.ok) {
        const payload = await raceChild(response.json(), 'authenticated readiness body');
        if (
          payload?.outcome === 'ok'
          && payload?.runtime === 'edgebase-self-host'
          && payload?.generation === authority.generation
          && payload?.scheduleDigest === authority.scheduleDigest
        ) {
          return;
        }
      }
    } catch (error) {
      if (signal.aborted || error?.message?.startsWith('Wrangler ')) throw error;
      // The owned runtime may still be compiling or opening persisted state.
    }
    await raceChild(new Promise((resolve) => setTimeout(resolve, 100)), 'readiness retry');
  }
  throw new Error('Timed out waiting for authenticated internal Wrangler readiness.');
}

function prebuildSelfHostRuntime({
  appRoot = APP_ROOT,
  configPath = wranglerConfig,
  temporaryRoot = process.env.TMPDIR || '/tmp',
  wranglerCommand = 'wrangler',
  wranglerArgsPrefix = [],
} = {}) {
  const linuxProcessGroupHasRunnableMember = (pid) => {
    if (process.platform !== 'linux') return null;
    let entries;
    try {
      entries = readdirSync('/proc', { withFileTypes: true });
    } catch {
      return null;
    }
    let foundMember = false;
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      try {
        const stat = readFileSync(`/proc/${entry.name}/stat`, 'utf8');
        const commandEnd = stat.lastIndexOf(')');
        if (commandEnd < 0) continue;
        const fields = stat.slice(commandEnd + 2).split(' ');
        if (Number(fields[2]) !== pid) continue;
        foundMember = true;
        if (fields[0] !== 'Z' && fields[0] !== 'X') return true;
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ESRCH') return null;
      }
    }
    return foundMember ? false : null;
  };
  const processGroupAlive = (pid) => {
    try {
      process.kill(-pid, 0);
      return linuxProcessGroupHasRunnableMember(pid) ?? true;
    } catch (error) {
      if (error?.code === 'ESRCH' || error?.code === 'EPERM') return false;
      throw error;
    }
  };
  const reapProcessGroup = (pid) => {
    if (process.platform === 'win32' || !Number.isInteger(pid) || pid < 1) return;
    if (!processGroupAlive(pid)) return;
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    const waitUntilGone = () => {
      const deadline = Date.now() + RUNTIME_PREBUILD_GROUP_SHUTDOWN_TIMEOUT_MS;
      while (processGroupAlive(pid) && Date.now() < deadline) {
        Atomics.wait(sleeper, 0, 0, 20);
      }
      return !processGroupAlive(pid);
    };
    process.kill(-pid, 'SIGTERM');
    if (waitUntilGone()) return;
    process.kill(-pid, 'SIGKILL');
    if (!waitUntilGone()) {
      throw new Error('Wrangler self-host runtime prebuild process group did not exit.');
    }
  };
  const outputDir = mkdtempSync(join(temporaryRoot, 'edgebase-self-host-worker-'));
  const cleanup = () => rmSync(outputDir, { recursive: true, force: true });
  try {
    const result = spawnSync(
      wranglerCommand,
      [...wranglerArgsPrefix, 'deploy', '--dry-run', '--outdir', outputDir, '--config', configPath],
      {
        cwd: appRoot,
        env: {
          ...process.env,
          CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
          WRANGLER_SEND_METRICS: 'false',
        },
        stdio: 'inherit',
        detached: process.platform !== 'win32',
        timeout: RUNTIME_PREBUILD_TIMEOUT_MS,
      },
    );
    reapProcessGroup(result.pid);
    if (result.error) {
      throw new Error('Wrangler self-host runtime prebuild failed.', { cause: result.error });
    }
    if (result.status !== 0 || result.signal) {
      throw new Error(
        `Wrangler self-host runtime prebuild exited with code=${String(result.status)} `
          + `signal=${String(result.signal)}.`,
      );
    }
    const entryPath = join(outputDir, 'index.js');
    const entry = lstatSync(entryPath);
    if (
      !entry.isFile()
      || entry.isSymbolicLink()
      || entry.size < 1
      || entry.size > RUNTIME_PREBUILD_MAX_BYTES
    ) {
      throw new Error('Wrangler self-host runtime prebuild produced an invalid worker entry.');
    }
    return { entryPath, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

const { manifest, assets } = verifySelfHostAssets();
const gatewayModule = await import(pathToFileURL(join(APP_ROOT, assets.gateway.path)).href);
const supervisorModule = await import(
  pathToFileURL(join(APP_ROOT, assets.scheduleSupervisor.path)).href
);
const wranglerRuntimeModule = await import(
  pathToFileURL(join(APP_ROOT, assets.wranglerRuntime.path)).href
);
const validatedManifest = await supervisorModule.readSelfHostAppManifest(MANIFEST_PATH);
if (
  validatedManifest.generation !== manifest.generation
  || validatedManifest.schedules.digest !== manifest.schedules.digest
) {
  throw new Error('Self-host manifest authority changed during startup validation.');
}

const externalHost = process.env.HOST || '0.0.0.0';
const externalPort = positivePort(process.env.PORT || '8787', 'PORT');
const internalPort = positivePort(process.env.EDGEBASE_INTERNAL_PORT || '8788', 'EDGEBASE_INTERNAL_PORT');
if (externalPort === internalPort) throw new Error('PORT and EDGEBASE_INTERNAL_PORT must differ.');
const persistDir = process.env.PERSIST_DIR || '/data';
const filesystemAdmissionController = gatewayModule.createFilesystemCapacityAdmissionController({
  path: persistDir,
  minimumFreeBytes: process.env.EDGEBASE_GATEWAY_MIN_FREE_BYTES,
  recoveryFreeBytes: process.env.EDGEBASE_GATEWAY_RECOVERY_FREE_BYTES,
});
const wranglerConfig = process.env.WRANGLER_CONFIG || 'wrangler.toml';
const protocol = process.env.LOCAL_PROTOCOL || 'http';
if (protocol !== 'http' && protocol !== 'https') throw new Error('LOCAL_PROTOCOL must be http or https.');
const controlSecret = randomBytes(32).toString('hex');
const gatewaySecret = randomBytes(32).toString('hex');
const runtimeAuthority = {
  generation: validatedManifest.generation,
  scheduleDigest: validatedManifest.schedules.digest,
};
process.env.EDGEBASE_RUNTIME_MODE = 'self-hosted';
process.env.EDGEBASE_SELF_HOST_CONTROL_SECRET = controlSecret;
process.env.EDGEBASE_SELF_HOST_GATEWAY_SECRET = gatewaySecret;
process.env.EDGEBASE_SELF_HOST_APP_GENERATION = runtimeAuthority.generation;
process.env.EDGEBASE_SELF_HOST_SCHEDULE_DIGEST = runtimeAuthority.scheduleDigest;

const wranglerTool = wranglerRuntimeModule.prepareSelfHostWranglerTool({
  baseDir: APP_ROOT,
  cacheRoot: join(tmpdir(), 'edgebase-self-host-wrangler-runtime'),
  proxyWorkerPath: join(APP_ROOT, assets.proxyWorker.path),
});
const runtimeBundle = prebuildSelfHostRuntime({
  wranglerCommand: wranglerTool.command,
  wranglerArgsPrefix: wranglerTool.argsPrefix,
});
process.once('exit', runtimeBundle.cleanup);
const wranglerArgs = [
  'dev',
  runtimeBundle.entryPath,
  '--no-bundle',
  '--config', wranglerConfig,
  '--port', String(internalPort),
  '--ip', '127.0.0.1',
  '--persist-to', persistDir,
  '--show-interactive-dev-session=false',
  '--var', 'EDGEBASE_RUNTIME_MODE:self-hosted',
  '--var', `EDGEBASE_SELF_HOST_CONTROL_SECRET:${controlSecret}`,
  '--var', `EDGEBASE_SELF_HOST_GATEWAY_SECRET:${gatewaySecret}`,
  '--var', `EDGEBASE_SELF_HOST_APP_GENERATION:${runtimeAuthority.generation}`,
  '--var', `EDGEBASE_SELF_HOST_SCHEDULE_DIGEST:${runtimeAuthority.scheduleDigest}`,
];
const child = spawn(wranglerTool.command, [...wranglerTool.argsPrefix, ...wranglerArgs], {
  cwd: APP_ROOT,
  env: process.env,
  stdio: 'inherit',
  detached: process.platform !== 'win32',
});

// Install the terminal observer and process-group ownership immediately after
// spawn. Every startup await below is raced against this one immutable result.
const childTerminal = new Promise((resolve) => {
  child.once('error', (error) => resolve({ kind: 'error', error }));
  child.once('exit', (code, signal) => resolve({ kind: 'exit', code, signal }));
});
const raceChild = (operation, context) => Promise.race([
  operation,
  childTerminal.then((outcome) => { throw childTerminalError(outcome, context); }),
]);

let gateway = null;
let supervisor = null;
let runtimeAdmitted = false;
let shutdownPromise = null;
const lifecycleAbort = new AbortController();
const runtimeOrigin = `http://127.0.0.1:${internalPort}`;
const scheduleStatePath = join(persistDir, '.edgebase', 'self-host-schedule-state.json');

async function shutdown(signal = 'SIGTERM', requestedExitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    runtimeAdmitted = false;
    void gateway?.stopAdmission();
    lifecycleAbort.abort(new Error('Self-host runtime is shutting down.'));

    const surfaceStops = Promise.allSettled([
      supervisor?.stop({ timeoutMs: Math.max(1, remainingMs(deadline)) }) ?? Promise.resolve(),
      gateway?.stop({
        drainTimeoutMs: Math.min(GATEWAY_DRAIN_TIMEOUT_MS, remainingMs(deadline)),
      }) ?? Promise.resolve(),
    ]);
    await waitUntil(surfaceStops, remainingMs(deadline));

    signalOwnedProcessGroup(child, signal);
    await waitUntil(childTerminal, remainingMs(deadline));
    const exited = await waitForOwnedProcessGroupExit(child, deadline);
    if (!exited) {
      signalOwnedProcessGroup(child, 'SIGKILL');
      await waitForOwnedProcessGroupExit(child, deadline);
    }
    runtimeBundle.cleanup();
    process.exitCode = Math.max(process.exitCode || 0, requestedExitCode);
  })();
  return shutdownPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void shutdown(signal, signal === 'SIGINT' ? 130 : 143);
  });
}
void childTerminal.then((outcome) => {
  if (shutdownPromise) return;
  const exitCode = outcome.kind === 'exit' && outcome.code === 0 && !outcome.signal ? 0 : 1;
  void shutdown('SIGTERM', exitCode);
});

try {
  await waitForOwnedRuntime(
    runtimeOrigin,
    controlSecret,
    runtimeAuthority,
    raceChild,
    lifecycleAbort.signal,
  );
  await raceChild(
    supervisorModule.readSelfHostScheduleState(scheduleStatePath),
    'schedule state validation',
  );
  const trustedProxyCidrs = String(process.env.EDGEBASE_TRUSTED_PROXY_CIDRS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (protocol === 'https' && (!process.env.HTTPS_CERT_PATH || !process.env.HTTPS_KEY_PATH)) {
    throw new Error('HTTPS_CERT_PATH and HTTPS_KEY_PATH are required for LOCAL_PROTOCOL=https.');
  }
  const tls = protocol === 'https'
    ? {
      cert: readFileSync(process.env.HTTPS_CERT_PATH),
      key: readFileSync(process.env.HTTPS_KEY_PATH),
    }
    : undefined;
  const scheduleOutcomeLogger = supervisorModule.createSelfHostScheduleOutcomeLogger({
    prefix: '[EdgeBase]',
    writeInfo: (line) => console.log(line),
    writeError: (line) => console.error(line),
  });
  supervisor = supervisorModule.createSelfHostScheduleSupervisor({
    manifestPath: MANIFEST_PATH,
    statePath: scheduleStatePath,
    runtimeOrigin,
    controlSecret,
    signal: lifecycleAbort.signal,
    onReport(report) {
      scheduleOutcomeLogger.report(report);
    },
    onError(error) {
      console.error('[EdgeBase] schedule supervisor blocked', error);
    },
  });
  const initialReport = await raceChild(supervisor.runOnce(), 'initial schedule pass');
  if (initialReport.structuralReady !== true || !supervisor.getStatus().structuralReady) {
    throw new Error('Initial schedule pass did not establish structural readiness.');
  }
  scheduleOutcomeLogger.report(initialReport, { initial: true });
  const reportGatewayEvent = (event) => {
    console.error('[EdgeBase] gateway ' + JSON.stringify(event));
  };
  gateway = await raceChild(gatewayModule.startSelfHostGateway({
    host: externalHost,
    port: externalPort,
    upstreamPort: internalPort,
    protocol,
    ...(tls ? { tls } : {}),
    trustedProxyCidrs,
    workerTrustSecret: gatewaySecret,
    maxConnections: process.env.EDGEBASE_GATEWAY_MAX_CONNECTIONS,
    maxRequestBodyBytes: process.env.EDGEBASE_GATEWAY_MAX_REQUEST_BODY_BYTES,
    headersTimeoutMs: process.env.EDGEBASE_GATEWAY_HEADERS_TIMEOUT_MS,
    requestTimeoutMs: process.env.EDGEBASE_GATEWAY_REQUEST_TIMEOUT_MS,
    idleTimeoutMs: process.env.EDGEBASE_GATEWAY_IDLE_TIMEOUT_MS,
    keepAliveTimeoutMs: process.env.EDGEBASE_GATEWAY_KEEP_ALIVE_TIMEOUT_MS,
    upstreamTimeoutMs: process.env.EDGEBASE_GATEWAY_UPSTREAM_TIMEOUT_MS,
    eventCoalesceWindowMs: process.env.EDGEBASE_GATEWAY_EVENT_COALESCE_WINDOW_MS,
    storageAdmissionController: filesystemAdmissionController,
    onEvent: reportGatewayEvent,
    healthProvider: () => supervisor?.getStatus() ?? {
      state: 'idle',
      structuralReady: false,
      itemFailureCount: 0,
      lastAttemptAt: null,
      lastSuccessfulPassAt: null,
      lastError: null,
    },
    admissionGuard: () => (
      runtimeAdmitted
      && child.exitCode === null
      && child.signalCode === null
      && supervisor?.getStatus().structuralReady === true
    ),
  }), 'gateway bind');
  await raceChild(Promise.resolve(), 'final admission check');
  if (child.exitCode !== null || child.signalCode !== null) {
    throw childTerminalError(
      { kind: 'exit', code: child.exitCode, signal: child.signalCode },
      'final admission check',
    );
  }
  runtimeAdmitted = true;
  supervisor.start();
  console.log(
    `[EdgeBase] self-host ready external=${protocol}://${externalHost}:${externalPort} `
      + `internal=${runtimeOrigin} generation=${runtimeAuthority.generation}`,
  );
} catch (error) {
  console.error('[EdgeBase] self-host startup failed', error);
  await shutdown('SIGTERM', 1);
}
