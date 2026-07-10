import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DART_OPTIONAL_PUBLISH_TARGET_IDS,
  DART_PUBLISH_TARGET_IDS,
  RELEASE_TARGETS,
} from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function printUsage() {
  console.log(`Usage:
  node ./dev/release/publish-pub-release.mjs <version> [--dry-run] [--skip-validation] [--include-umbrella] [--targets=dart-core,dart-admin]

Examples:
  pnpm release:pub 1.2.3
  pnpm release:pub 1.2.3 --dry-run
  pnpm release:pub 1.2.3 --skip-validation
  pnpm release:pub 1.2.3 --include-umbrella
  pnpm release:pub 1.2.3 --targets=dart-core,dart-admin
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    dryRun: false,
    skipValidation: false,
    includeUmbrella: false,
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

    if (arg === '--include-umbrella') {
      options.includeUmbrella = true;
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
  const { cwd = REPO_ROOT, interactive = false } = options;
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
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
}

async function getPublishedLatestVersion(packageName) {
  const response = await fetch(`https://pub.dev/api/packages/${encodeURIComponent(packageName)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to read pub.dev metadata for ${packageName}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const version = payload?.latest?.version;
  return typeof version === 'string' ? version : null;
}

function getTargetMap() {
  return new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
}

function resolvePublishTargets({ includeUmbrella, explicitTargets }) {
  const targetMap = getTargetMap();
  const ids = explicitTargets && explicitTargets.length > 0
    ? explicitTargets
    : [
        ...DART_PUBLISH_TARGET_IDS,
        ...(includeUmbrella ? DART_OPTIONAL_PUBLISH_TARGET_IDS : []),
      ];

  const targets = ids.map((id) => {
    const target = targetMap.get(id);
    if (!target) {
      throw new Error(`Unknown Dart release target id: ${id}`);
    }
    if (target.ecosystem !== 'dart') {
      throw new Error(`Target ${id} is not a Dart release target.`);
    }
    return target;
  });

  return targets;
}

function getPublishCommand(target) {
  return target.publishTool === 'flutter' ? 'flutter' : 'dart';
}

async function publishTarget(target, { version, dryRun, skipValidation }) {
  const latestVersion = await getPublishedLatestVersion(target.name);
  if (latestVersion === version && !dryRun) {
    console.log(`Skipping ${target.name}; latest already points to ${version}.`);
    return { status: 'already-published', target };
  }

  const command = getPublishCommand(target);
  const args = ['pub', 'publish'];
  if (dryRun) {
    // Release candidates are intentionally validated before the version bump
    // is committed. Ignore the resulting dirty-tree warning while keeping all
    // actual package validation errors fatal.
    args.push('--dry-run', '--ignore-warnings');
  } else {
    args.push('--force');
  }
  if (skipValidation) {
    args.push('--skip-validation');
  }

  const packageDir = resolve(REPO_ROOT, dirname(target.path));

  try {
    runCommand(command, args, `publish ${target.name}`, {
      cwd: packageDir,
      interactive: !dryRun,
    });
    return { status: dryRun ? 'validated' : 'published', target };
  } catch (error) {
    const output = error.output ?? '';
    if (output.includes('Version') && output.includes('has already been uploaded')) {
      console.log(`Skipping ${target.name}; version ${version} is already published.`);
      return { status: 'already-published', target };
    }
    throw error;
  }
}

export async function publishPubRelease(version, options = {}) {
  const {
    dryRun = false,
    skipValidation = false,
    includeUmbrella = false,
    targets: explicitTargets = null,
  } = options;

  if (!version) {
    throw new Error('Missing version. Example: pnpm release:pub 1.2.3');
  }

  console.log(`Preparing pub.dev release ${version}${dryRun ? ' (dry run)' : ''}...`);
  console.log();

  assertPreparedRelease(version, { dryRun });
  console.log();

  const targets = resolvePublishTargets({ includeUmbrella, explicitTargets });
  const results = [];

  for (const target of targets) {
    console.log(`=== ${target.name} ===`);
    console.log(`Tool: ${getPublishCommand(target)} pub publish`);
    const result = await publishTarget(target, { version, dryRun, skipValidation });
    results.push(result);
    console.log();
  }

  console.log(`pub.dev release ${version} completed.`);
  console.log(`Processed ${results.length} package(s).`);
  return results;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const {
    version,
    dryRun,
    skipValidation,
    includeUmbrella,
    targets,
    help,
  } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    process.exit(0);
  }

  try {
    await publishPubRelease(version, {
      dryRun,
      skipValidation,
      includeUmbrella,
      targets,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
