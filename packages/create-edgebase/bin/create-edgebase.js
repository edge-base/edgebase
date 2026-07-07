#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

function printUsage() {
  console.log(`Usage:
  npm create edgebase@latest <project-dir>
  npm create edgebase@latest <project-dir> -- --no-dev
  npm create edgebase@latest <project-dir> -- --open

What it does:
  1. Scaffolds a new EdgeBase project
  2. Installs local project dependencies
  3. Starts the dev server unless you pass --no-dev
`);
}

function detectPackageManager() {
  const userAgent = process.env.npm_config_user_agent ?? '';

  if (userAgent.startsWith('pnpm/')) {
    return {
      name: 'pnpm',
      command: 'pnpm',
      installArgs: ['install'],
      runScriptArgs(scriptName, extraArgs = []) {
        return ['run', scriptName, ...extraArgs];
      },
    };
  }

  if (userAgent.startsWith('yarn/')) {
    return {
      name: 'yarn',
      command: 'yarn',
      installArgs: ['install'],
      runScriptArgs(scriptName, extraArgs = []) {
        return ['run', scriptName, ...extraArgs];
      },
    };
  }

  if (userAgent.startsWith('bun/')) {
    return {
      name: 'bun',
      command: 'bun',
      installArgs: ['install'],
      runScriptArgs(scriptName, extraArgs = []) {
        return ['run', scriptName, ...extraArgs];
      },
    };
  }

  return {
    name: 'npm',
    command: 'npm',
    installArgs: ['install'],
    runScriptArgs(scriptName, extraArgs = []) {
      return ['run', scriptName, ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])];
    },
  };
}

function runOrExit(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  printUsage();
  process.exit(0);
}

const forwardedArgs = [...rawArgs];
const wantsNoDev = forwardedArgs.includes('--no-dev');
const wantsOpen = forwardedArgs.includes('--open');
const scaffoldArgs = wantsNoDev ? forwardedArgs : [...forwardedArgs, '--no-dev'];
const targetDirArg = forwardedArgs.find((arg) => !arg.startsWith('-')) ?? '.';
const projectDir = resolve(process.cwd(), targetDirArg);
const packageManager = detectPackageManager();
const skipInstall = process.env.EDGEBASE_CREATE_SKIP_INSTALL === '1';
const cliPackageJsonPath = require.resolve('@edge-base/cli/package.json');
const cliEntryPath = join(dirname(cliPackageJsonPath), 'dist', 'index.js');

runOrExit(process.execPath, [cliEntryPath, 'init', ...scaffoldArgs], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    EDGEBASE_BOOTSTRAP_WRAPPER: '1',
  },
});

if (!skipInstall) {
  console.log();
  console.log(`Installing project dependencies with ${packageManager.name}...`);
  runOrExit(packageManager.command, packageManager.installArgs, {
    cwd: projectDir,
    env: process.env,
  });
}

if (!wantsNoDev) {
  console.log();
  console.log('Starting the EdgeBase dev server...');
  runOrExit(packageManager.command, packageManager.runScriptArgs('dev', wantsOpen ? ['--open'] : []), {
    cwd: projectDir,
    env: process.env,
  });
}
