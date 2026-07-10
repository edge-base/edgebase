import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_TARGETS,
  RUST_PUBLISH_TARGET_IDS,
} from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_ENV_FILE = resolve(REPO_ROOT, 'dev/release/.env.crates');
const PUBLISH_ORDER = ['rust-core', 'rust-admin'];

function printUsage() {
  console.log(`Usage:
  node ./dev/release/publish-rust-release.mjs <version> [--dry-run] [--skip-validation] [--targets=rust-core,rust-admin]

Examples:
  pnpm release:crates 1.2.3
  pnpm release:crates 1.2.3 --dry-run
  pnpm release:crates 1.2.3 --skip-validation
  pnpm release:crates 1.2.3 --targets=rust-core,rust-admin
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
  const { cwd = REPO_ROOT, env = process.env, interactive = false } = options;
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

function createCratesEnv() {
  const fileEnv = existsSync(DEFAULT_ENV_FILE)
    ? parseEnvFile(readFileSync(DEFAULT_ENV_FILE, 'utf8'))
    : {};

  const merged = {
    ...fileEnv,
    ...process.env,
  };

  if (!merged.CARGO_REGISTRY_TOKEN && merged.CRATES_IO_TOKEN) {
    merged.CARGO_REGISTRY_TOKEN = merged.CRATES_IO_TOKEN;
  }

  return merged;
}

async function getPublishedLatestVersion(crateName) {
  const response = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'edgebase-release-script/1.0 (+https://github.com/edge-base/edgebase)',
    },
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to read crates.io metadata for ${crateName}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const version = payload?.crate?.max_version;
  return typeof version === 'string' ? version : null;
}

function getTargetMap() {
  return new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
}

function resolvePublishTargets({ explicitTargets }) {
  const targetMap = getTargetMap();
  const ids = explicitTargets && explicitTargets.length > 0
    ? explicitTargets
    : [...RUST_PUBLISH_TARGET_IDS];

  const invalidIds = ids.filter((id) => !RUST_PUBLISH_TARGET_IDS.includes(id));
  if (invalidIds.length > 0) {
    throw new Error(`Unsupported Rust publish target id(s): ${invalidIds.join(', ')}`);
  }

  const targets = ids.map((id) => {
    const target = targetMap.get(id);
    if (!target) {
      throw new Error(`Unknown Rust release target id: ${id}`);
    }
    if (target.ecosystem !== 'rust') {
      throw new Error(`Target ${id} is not a Rust release target.`);
    }
    return target;
  });

  return targets.sort(
    (a, b) => PUBLISH_ORDER.indexOf(a.id) - PUBLISH_ORDER.indexOf(b.id),
  );
}

function validateTarget(target, env) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  runCommand('cargo', ['package', '--allow-dirty', '--list'], `cargo package ${target.name}`, {
    cwd: packageDir,
    env,
  });
}

function buildTarget(target, env) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  runCommand('cargo', ['check', '--locked'], `cargo check ${target.name}`, {
    cwd: packageDir,
    env,
  });
}

function publishTarget(target, { dryRun, skipValidation, env }) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));

  if (!skipValidation) {
    validateTarget(target, env);
  }

  const args = ['publish', '--allow-dirty', '--locked'];
  if (dryRun) {
    args.push('--dry-run');
  }
  if (skipValidation) {
    args.push('--no-verify');
  }

  runCommand('cargo', args, `cargo publish ${target.name}`, {
    cwd: packageDir,
    env,
  });

  return { status: dryRun ? 'validated' : 'published', target };
}

function requiresRegistryDependencyFallback(target, { dryRun, version, latestVersions, selectedTargetIds }) {
  if (!dryRun) return false;
  if (target.id !== 'rust-admin') return false;
  if (!selectedTargetIds.includes('rust-core')) return false;
  return latestVersions.get('rust-core') !== version;
}

async function waitForPublishedVersion(crateName, version) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const latestVersion = await getPublishedLatestVersion(crateName);
    if (latestVersion === version) {
      console.log(`${crateName} is now visible on crates.io at ${version}.`);
      return;
    }
    console.log(`Waiting for crates.io index to reflect ${crateName}@${version} (${attempt}/30)...`);
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 2000);
    });
  }

  throw new Error(`Timed out waiting for crates.io to reflect ${crateName}@${version}.`);
}

export async function publishRustRelease(version, options = {}) {
  const {
    dryRun = false,
    skipValidation = false,
    targets: explicitTargets = null,
  } = options;

  if (!version) {
    throw new Error('Missing version. Example: pnpm release:crates 1.2.3');
  }

  const env = createCratesEnv();

  console.log(`Preparing crates.io release ${version}${dryRun ? ' (dry run)' : ''}...`);
  console.log();

  assertPreparedRelease(version, { dryRun });
  console.log();

  const targets = resolvePublishTargets({ explicitTargets });
  const selectedTargetIds = targets.map((target) => target.id);
  const latestVersions = new Map();
  const results = [];

  for (const target of targets) {
    console.log(`=== ${target.name} ===`);
    const latestVersion = await getPublishedLatestVersion(target.name);
    latestVersions.set(target.id, latestVersion);
    if (latestVersion === version && !dryRun) {
      console.log(`Skipping ${target.name}; latest already points to ${version}.`);
      results.push({ status: 'already-published', target });
      console.log();
      continue;
    }

    if (requiresRegistryDependencyFallback(target, {
      dryRun,
      version,
      latestVersions,
      selectedTargetIds,
    })) {
      console.log(
        `Dry run fallback: ${target.name} depends on edgebase-core@${version}, which is not yet visible on crates.io.`,
      );
      console.log('Running local package and build validation instead.');
      if (!skipValidation) {
        validateTarget(target, env);
      }
      buildTarget(target, env);
      results.push({ status: 'validated-local-only', target });
      console.log();
      continue;
    }

    const result = publishTarget(target, { dryRun, skipValidation, env });
    results.push(result);
    console.log();

    if (!dryRun && target.id === 'rust-core' && targets.some((entry) => entry.id === 'rust-admin')) {
      await waitForPublishedVersion(target.name, version);
      console.log();
    }
  }

  console.log(`crates.io release ${version} completed.`);
  console.log(`Processed ${results.length} crate(s).`);
  return results;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const {
    version,
    dryRun,
    skipValidation,
    targets,
    help,
  } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    process.exit(0);
  }

  try {
    await publishRustRelease(version, {
      dryRun,
      skipValidation,
      targets,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
