/* global AbortController, AbortSignal, clearTimeout, console, fetch, process, setTimeout */

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_ROOT = '/app';
const MANIFEST_PATH = join(APP_ROOT, 'edgebase-app.json');
const CONTROL_ROOT = '/__edgebase/internal/self-host';
const STARTUP_TIMEOUT_MS = 90_000;
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
        signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
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

const { manifest, assets } = verifySelfHostAssets();
const gatewayModule = await import(pathToFileURL(join(APP_ROOT, assets.gateway.path)).href);
const supervisorModule = await import(
  pathToFileURL(join(APP_ROOT, assets.scheduleSupervisor.path)).href
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

const wranglerArgs = [
  'dev',
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
const child = spawn('wrangler', wranglerArgs, {
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
  supervisor = supervisorModule.createSelfHostScheduleSupervisor({
    manifestPath: MANIFEST_PATH,
    statePath: scheduleStatePath,
    runtimeOrigin,
    controlSecret,
    signal: lifecycleAbort.signal,
    onReport(report) {
      for (const outcome of report.outcomes) {
        console.log('[EdgeBase] schedule outcome', JSON.stringify(outcome));
      }
    },
    onError(error) {
      console.error('[EdgeBase] schedule supervisor blocked', error);
    },
  });
  const initialReport = await raceChild(supervisor.runOnce(), 'initial schedule pass');
  if (initialReport.structuralReady !== true || !supervisor.getStatus().structuralReady) {
    throw new Error('Initial schedule pass did not establish structural readiness.');
  }
  for (const outcome of initialReport.outcomes) {
    console.log('[EdgeBase] initial schedule outcome', JSON.stringify(outcome));
  }
  gateway = await raceChild(gatewayModule.startSelfHostGateway({
    host: externalHost,
    port: externalPort,
    upstreamPort: internalPort,
    protocol,
    ...(tls ? { tls } : {}),
    trustedProxyCidrs,
    workerTrustSecret: gatewaySecret,
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
