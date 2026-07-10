import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HEX_PUBLISH_TARGET_IDS,
  RELEASE_TARGETS,
} from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_ENV_FILE = resolve(REPO_ROOT, 'dev/release/.env.hex');
const PUBLISH_ORDER = ['elixir-core', 'elixir-admin'];

function printUsage() {
  console.log(`Usage:
  node ./dev/release/publish-hex-release.mjs <version> [--dry-run] [--skip-validation] [--targets=elixir-core,elixir-admin]

Examples:
  pnpm release:hex 1.2.3
  pnpm release:hex 1.2.3 --dry-run
  pnpm release:hex 1.2.3 --skip-validation
  pnpm release:hex 1.2.3 --targets=elixir-core,elixir-admin
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    dryRun: false,
    skipValidation: false,
    targets: null,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--skip-validation') {
      options.skipValidation = true;
      continue;
    }
    if (arg.startsWith('--targets=')) {
      const raw = arg.slice('--targets='.length).trim();
      options.targets = raw.length > 0
        ? raw.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
      continue;
    }
    positionals.push(arg);
  }

  return {
    version: positionals[0] ?? null,
    ...options,
  };
}

function runCommand(command, args, label, options = {}) {
  const {
    cwd = REPO_ROOT,
    env = process.env,
    interactive = false,
  } = options;

  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: interactive ? 'inherit' : 'pipe',
  });

  const stdout = interactive ? '' : (result.stdout ?? '');
  const stderr = interactive ? '' : (result.stderr ?? '');
  const output = `${stdout}${stderr}`;

  if (!interactive && output.trim().length > 0) {
    process.stdout.write(output);
    if (!output.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const error = new Error(`${label} failed with exit code ${result.status ?? 1}`);
    error.output = output;
    throw error;
  }

  return output;
}

function parseEnvFile(contents) {
  const env = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }
  return env;
}

function createHexEnv() {
  const fileEnv = existsSync(DEFAULT_ENV_FILE)
    ? parseEnvFile(readFileSync(DEFAULT_ENV_FILE, 'utf8'))
    : {};

  const merged = {
    ...fileEnv,
    ...process.env,
  };

  if (!merged.HEX_API_KEY && merged.HEXPM_API_KEY) {
    merged.HEX_API_KEY = merged.HEXPM_API_KEY;
  }

  return merged;
}

async function getPublishedLatestVersion(packageName) {
  const response = await fetch(`https://hex.pm/api/packages/${encodeURIComponent(packageName)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'edgebase-release-script/1.0 (+https://github.com/edge-base/edgebase)',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to read Hex metadata for ${packageName}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const releases = Array.isArray(payload?.releases) ? payload.releases : [];
  const stableRelease = releases.find((release) => {
    const version = release?.version;
    return typeof version === 'string' && !version.includes('-');
  });
  return stableRelease?.version ?? null;
}

function getTargetMap() {
  return new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
}

function resolvePublishTargets({ explicitTargets }) {
  const targetMap = getTargetMap();
  const ids = explicitTargets && explicitTargets.length > 0
    ? explicitTargets
    : [...HEX_PUBLISH_TARGET_IDS];

  const invalidIds = ids.filter((id) => !HEX_PUBLISH_TARGET_IDS.includes(id));
  if (invalidIds.length > 0) {
    throw new Error(`Unsupported Hex publish target id(s): ${invalidIds.join(', ')}`);
  }

  const targets = ids.map((id) => {
    const target = targetMap.get(id);
    if (!target) {
      throw new Error(`Unknown Hex release target id: ${id}`);
    }
    if (target.ecosystem !== 'elixir') {
      throw new Error(`Target ${id} is not an Elixir release target.`);
    }
    return target;
  });

  return targets.sort(
    (a, b) => PUBLISH_ORDER.indexOf(a.id) - PUBLISH_ORDER.indexOf(b.id),
  );
}

function createStageDir(target) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  const stageDir = mkdtempSync(join(tmpdir(), `edgebase-hex-${target.id}-`));
  cpSync(packageDir, stageDir, { recursive: true });

  if (target.id === 'elixir-admin') {
    const mixPath = join(stageDir, basename(target.path));
    const current = readFileSync(mixPath, 'utf8');
    const next = current.replace(
      /(\{:edgebase_core,\s*"~>\s*[^"]+")(\s*,\s*path:\s*"\.\.\/core")(\})/m,
      '$1$3',
    );
    writeFileSync(mixPath, next, 'utf8');
  }

  return { packageDir, stageDir };
}

function validateTarget(target, env, options = {}) {
  const { skipRegistryPackageBuild = false } = options;
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  if (target.id === 'elixir-admin') {
    runCommand('mix', ['deps.clean', 'edgebase_core', '--all'], `mix deps.clean ${target.name}`, {
      cwd: packageDir,
      env,
    });
  }

  runCommand('mix', ['deps.get'], `mix deps.get ${target.name}`, {
    cwd: packageDir,
    env,
  });

  runCommand('mix', ['test'], `mix test ${target.name}`, {
    cwd: packageDir,
    env,
  });

  if (skipRegistryPackageBuild) {
    return;
  }

  const { stageDir } = createStageDir(target);
  try {
    runCommand('mix', ['deps.get'], `mix deps.get ${target.name}`, {
      cwd: stageDir,
      env,
    });
    runCommand('mix', ['hex.build'], `mix hex.build ${target.name}`, {
      cwd: stageDir,
      env,
    });
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

function publishTarget(target, {
  dryRun,
  skipValidation,
  skipRegistryPackageBuild = false,
  env,
}) {
  if (!skipValidation) {
    validateTarget(target, env, { skipRegistryPackageBuild });
  }

  if (dryRun) {
    return {
      status: skipRegistryPackageBuild ? 'validated-local-only' : 'validated',
      target,
    };
  }

  const { stageDir } = createStageDir(target);
  try {
    runCommand('mix', ['deps.get'], `mix deps.get ${target.name}`, {
      cwd: stageDir,
      env,
    });
    runCommand('mix', ['hex.publish', 'package', '--yes'], `mix hex.publish ${target.name}`, {
      cwd: stageDir,
      env,
    });
    return { status: 'published', target };
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

async function waitForPublishedVersion(packageName, version) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const latestVersion = await getPublishedLatestVersion(packageName);
    if (latestVersion === version) {
      console.log(`${packageName} is now visible on Hex at ${version}.`);
      return;
    }
    console.log(`Waiting for Hex to reflect ${packageName}@${version} (${attempt}/30)...`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }

  throw new Error(`Timed out waiting for Hex to reflect ${packageName}@${version}.`);
}

function ensureAuth(env) {
  if (env.HEX_API_KEY) {
    return;
  }

  runCommand('mix', ['hex.user', 'whoami'], 'mix hex.user whoami', {
    cwd: resolve(REPO_ROOT, 'packages/sdk/elixir/packages/core'),
    env,
  });
}

export async function publishHexRelease(version, options = {}) {
  const {
    dryRun = false,
    skipValidation = false,
    targets: explicitTargets = null,
  } = options;

  if (!version) {
    throw new Error('Missing version. Example: pnpm release:hex 1.2.3');
  }

  const env = createHexEnv();
  const targets = resolvePublishTargets({ explicitTargets });

  console.log(`Preparing Hex release ${version}${dryRun ? ' (dry run)' : ''}...`);
  console.log('');

  assertPreparedRelease(version, { dryRun });
  console.log('');

  if (!dryRun) {
    ensureAuth(env);
  }

  const results = [];
  let coreAvailableAtVersion = false;
  if (dryRun && !targets.some((target) => target.id === 'elixir-core')) {
    coreAvailableAtVersion = await getPublishedLatestVersion('edgebase_core') === version;
  }

  for (const target of targets) {
    console.log(`=== ${target.name} ===`);
    const latestVersion = await getPublishedLatestVersion(target.name);
    if (latestVersion === version && !dryRun) {
      console.log(`${target.name}@${version} is already published on Hex, skipping.`);
      results.push({ status: 'skipped', target });
      console.log('');
      continue;
    }

    if (target.id === 'elixir-core') {
      coreAvailableAtVersion = latestVersion === version;
    }
    const skipRegistryPackageBuild = dryRun
      && target.id === 'elixir-admin'
      && !coreAvailableAtVersion;
    if (skipRegistryPackageBuild) {
      console.log(
        `Dry run fallback: ${target.name} depends on edgebase_core@${version}, which is not yet visible on Hex.`,
      );
      console.log('Running local dependency and test validation; registry package validation follows the core publish.');
    }

    const result = publishTarget(target, {
      dryRun,
      skipValidation,
      skipRegistryPackageBuild,
      env,
    });
    results.push(result);

    if (!dryRun && result.status === 'published') {
      await waitForPublishedVersion(target.name, version);
    }

    console.log('');
  }

  console.log(`Hex release ${version} ${dryRun ? 'validation' : 'completed'}.`);
  console.log(`Processed ${results.length} package(s).`);
  return results;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  try {
    await publishHexRelease(parsed.version, {
      dryRun: parsed.dryRun,
      skipValidation: parsed.skipValidation,
      targets: parsed.targets,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
