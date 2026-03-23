#!/usr/bin/env node

import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  ciTempDir,
  defaultTempEnv,
  ensureDir,
  formatFailureLog,
  killProcessTree,
  repoRootDir,
  runCommand,
  spawnLogged,
  waitForHttp,
} from './ci-utils.mjs';

function parseArgs(argv) {
  const separatorIndex = argv.indexOf('--');
  const optionArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const commandArgs = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);

  const options = {
    cwd: repoRootDir,
    server: false,
    mockFcm: false,
  };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];

    if (arg === '--server') {
      options.server = true;
      continue;
    }

    if (arg === '--mock-fcm') {
      options.mockFcm = true;
      continue;
    }

    if (arg === '--cwd') {
      const cwd = optionArgs[index + 1];
      if (!cwd) throw new Error('--cwd requires a value');
      options.cwd = path.resolve(repoRootDir, cwd);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (commandArgs.length === 0) {
    throw new Error('A command is required after "--"');
  }

  return { options, commandArgs };
}

async function ensureSharedBuild() {
  const sharedDir = path.join(repoRootDir, 'packages', 'shared');
  const sharedDistPath = path.join(sharedDir, 'dist', 'index.js');
  if (existsSync(sharedDistPath)) return;

  const buildResult = await runCommand('pnpm', ['build'], { cwd: sharedDir });
  if (buildResult.code !== 0) {
    throw new Error(`Failed to build packages/shared (exit ${buildResult.code ?? 'unknown'})`);
  }
}

async function ensureCoreBuild() {
  const coreDir = path.join(repoRootDir, 'packages', 'sdk', 'js', 'packages', 'core');
  const coreDistPath = path.join(coreDir, 'dist', 'index.js');
  if (existsSync(coreDistPath)) return;

  const buildResult = await runCommand('pnpm', ['build'], { cwd: coreDir });
  if (buildResult.code !== 0) {
    throw new Error(`Failed to build packages/sdk/js/packages/core (exit ${buildResult.code ?? 'unknown'})`);
  }
}

async function startServer() {
  await ensureSharedBuild();
  await ensureCoreBuild();

  const port = process.env['EDGEBASE_TEST_PORT'] ?? '8688';
  const logPath =
    process.env['EDGEBASE_TEST_LOG_PATH'] ?? path.join(ciTempDir, 'edgebase-test-server.log');
  const env = {
    ...defaultTempEnv('edgebase-test-server'),
  };

  const { child, logStream } = spawnLogged(
    'pnpm',
    ['exec', 'wrangler', 'dev', '--config', 'wrangler.test.toml', '--port', port],
    {
      cwd: path.join(repoRootDir, 'packages', 'server'),
      env,
      logPath,
    },
  );

  try {
    await waitForHttp(`http://localhost:${port}/api/health`, {
      child,
      logPath,
      name: 'EdgeBase test server',
    });
  } catch (error) {
    await killProcessTree(child.pid);
    logStream.end();
    throw error;
  }

  return { child, logPath, logStream, label: 'EdgeBase test server' };
}

async function startMockFcm() {
  const port = process.env['MOCK_FCM_PORT'] ?? '9099';
  const baseUrl = process.env['MOCK_FCM_BASE_URL'] ?? `http://localhost:${port}`;
  const logPath = process.env['MOCK_FCM_LOG_PATH'] ?? path.join(ciTempDir, 'mock-fcm.log');

  const { child, logStream } = spawnLogged(
    'pnpm',
    ['exec', 'tsx', path.join(repoRootDir, 'scripts', 'mock-fcm-server.ts')],
    {
      cwd: path.join(repoRootDir, 'packages', 'cli'),
      env: {
        MOCK_FCM_PORT: port,
        ...defaultTempEnv('mock-fcm-server'),
      },
      logPath,
    },
  );

  try {
    await waitForHttp(`${baseUrl}/health`, {
      child,
      logPath,
      name: 'mock FCM server',
      timeoutMs: Number(process.env['MOCK_FCM_STARTUP_TIMEOUT_SECONDS'] ?? '30') * 1_000,
      validate(body) {
        return body.includes('"service":"sdk-mock-fcm-server"');
      },
    });
  } catch (error) {
    await killProcessTree(child.pid);
    logStream.end();
    throw error;
  }

  return { child, logPath, logStream, label: 'mock FCM server' };
}

async function main() {
  const { options, commandArgs } = parseArgs(process.argv.slice(2));
  ensureDir(ciTempDir);
  const edgebaseTestPort = process.env['EDGEBASE_TEST_PORT'] ?? '8688';

  const services = [];
  let exitCode = 0;

  try {
    if (options.server) {
      services.push(await startServer());
    }

    if (options.mockFcm) {
      services.push(await startMockFcm());
    }

    const [command, ...args] = commandArgs;
    const result = await runCommand(command, args, {
      cwd: options.cwd,
      env: {
        BASE_URL: process.env['BASE_URL'] ?? `http://localhost:${edgebaseTestPort}`,
        EDGEBASE_SERVICE_KEY:
          process.env['EDGEBASE_SERVICE_KEY'] ??
          process.env['SERVICE_KEY'] ??
          'test-service-key-for-admin',
        SERVICE_KEY:
          process.env['SERVICE_KEY'] ??
          process.env['EDGEBASE_SERVICE_KEY'] ??
          'test-service-key-for-admin',
      },
    });

    if (result.code !== 0) {
      for (const service of services) {
        process.stderr.write(formatFailureLog(service.label, service.logPath));
      }
      exitCode = result.code ?? 1;
    }
  } finally {
    for (const service of services.reverse()) {
      await killProcessTree(service.child.pid);
      service.logStream.end();
    }
  }

  return exitCode;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
