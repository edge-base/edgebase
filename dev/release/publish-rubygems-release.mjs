import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_TARGETS,
  RUBY_PUBLISH_TARGET_IDS,
} from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_ENV_FILE = resolve(REPO_ROOT, 'dev/release/.env.rubygems');
const PUBLISH_ORDER = ['ruby-core', 'ruby-admin'];
const DEFAULT_HOST = 'https://rubygems.org';

function printUsage() {
  console.log(`Usage:
  node ./dev/release/publish-rubygems-release.mjs <version> [--dry-run] [--skip-validation] [--targets=ruby-core,ruby-admin] [--otp=123456] [--key=release]

Examples:
  pnpm release:rubygems 1.2.3
  pnpm release:rubygems 1.2.3 --dry-run
  pnpm release:rubygems 1.2.3 --skip-validation
  pnpm release:rubygems 1.2.3 --targets=ruby-core,ruby-admin
  pnpm release:rubygems 1.2.3 --otp=123456
  pnpm release:rubygems 1.2.3 --key=release
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    dryRun: false,
    skipValidation: false,
    targets: null,
    otp: null,
    keyName: null,
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
    if (arg.startsWith('--otp=')) {
      options.otp = arg.slice('--otp='.length).trim() || null;
      continue;
    }
    if (arg.startsWith('--key=')) {
      options.keyName = arg.slice('--key='.length).trim() || null;
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

function createRubyGemsEnv() {
  const fileEnv = existsSync(DEFAULT_ENV_FILE)
    ? parseEnvFile(readFileSync(DEFAULT_ENV_FILE, 'utf8'))
    : {};

  const merged = {
    ...fileEnv,
    ...process.env,
  };

  if (!merged.GEM_HOST_API_KEY && merged.RUBYGEMS_API_KEY) {
    merged.GEM_HOST_API_KEY = merged.RUBYGEMS_API_KEY;
  }

  if (!merged.RUBYGEMS_HOST) {
    merged.RUBYGEMS_HOST = DEFAULT_HOST;
  }

  return merged;
}

async function getPublishedLatestVersion(gemName) {
  const response = await fetch(`https://rubygems.org/api/v1/gems/${encodeURIComponent(gemName)}.json`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'edgebase-release-script/1.0 (+https://github.com/edge-base/edgebase)',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to read RubyGems metadata for ${gemName}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const version = payload?.version;
  return typeof version === 'string' ? version : null;
}

function getTargetMap() {
  return new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
}

function resolvePublishTargets({ explicitTargets }) {
  const targetMap = getTargetMap();
  const ids = explicitTargets && explicitTargets.length > 0
    ? explicitTargets
    : [...RUBY_PUBLISH_TARGET_IDS];

  const invalidIds = ids.filter((id) => !RUBY_PUBLISH_TARGET_IDS.includes(id));
  if (invalidIds.length > 0) {
    throw new Error(`Unsupported Ruby publish target id(s): ${invalidIds.join(', ')}`);
  }

  const targets = ids.map((id) => {
    const target = targetMap.get(id);
    if (!target) {
      throw new Error(`Unknown Ruby release target id: ${id}`);
    }
    if (target.ecosystem !== 'ruby') {
      throw new Error(`Target ${id} is not a Ruby release target.`);
    }
    return target;
  });

  return targets.sort(
    (a, b) => PUBLISH_ORDER.indexOf(a.id) - PUBLISH_ORDER.indexOf(b.id),
  );
}

function buildTarget(target, version, env) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  const gemspecName = basename(target.path);
  const artifactName = `${target.name}-${version}.gem`;
  const sourceArtifactPath = join(packageDir, artifactName);
  const distDir = mkdtempSync(join(tmpdir(), `edgebase-rubygems-${target.id}-`));
  const artifactPath = join(distDir, artifactName);

  rmSync(sourceArtifactPath, { force: true });

  try {
    runCommand('gem', ['build', gemspecName], `gem build ${target.name}`, {
      cwd: packageDir,
      env,
    });

    if (!existsSync(sourceArtifactPath)) {
      throw new Error(`Expected built gem not found for ${target.name}: ${sourceArtifactPath}`);
    }

    copyFileSync(sourceArtifactPath, artifactPath);
    return { packageDir, distDir, artifactPath };
  } catch (error) {
    rmSync(distDir, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(sourceArtifactPath, { force: true });
  }
}

function createValidationEnv(target, env) {
  if (target.id !== 'ruby-admin') {
    return env;
  }

  const parts = ['lib', '../core/lib'];
  if (env.RUBYLIB) {
    parts.push(env.RUBYLIB);
  }

  return {
    ...env,
    RUBYLIB: parts.join(':'),
  };
}

function validateTarget(target, env) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  const validationEnv = createValidationEnv(target, env);

  if (target.id === 'ruby-core') {
    runCommand('ruby', ['-Ilib', 'test/test_core_unit.rb'], `ruby unit ${target.name}`, {
      cwd: packageDir,
      env: validationEnv,
    });
    return;
  }

  if (target.id === 'ruby-admin') {
    runCommand('ruby', ['-Ilib:test', 'test/test_admin_unit.rb'], `ruby unit ${target.name}`, {
      cwd: packageDir,
      env: validationEnv,
    });
  }
}

function pushArtifact(target, artifactPath, env, { dryRun, otp, keyName }) {
  if (dryRun) {
    console.log(`Dry run: skipping upload for ${target.name}.`);
    return;
  }

  const args = ['push', artifactPath, '--host', env.RUBYGEMS_HOST || DEFAULT_HOST];
  if (keyName) {
    args.push('--key', keyName);
  }
  if (otp) {
    args.push('--otp', otp);
  }

  runCommand('gem', args, `gem push ${target.name}`, {
    cwd: REPO_ROOT,
    env,
    interactive: !env.GEM_HOST_API_KEY,
  });
}

async function publishTarget(target, { version, dryRun, skipValidation, env, otp, keyName }) {
  const latestVersion = await getPublishedLatestVersion(target.name);
  if (latestVersion === version && !dryRun) {
    console.log(`Skipping ${target.name}; latest already points to ${version}.`);
    return { status: 'already-published', target };
  }

  if (!skipValidation) {
    validateTarget(target, env);
  }

  const artifact = buildTarget(target, version, env);

  try {
    pushArtifact(target, artifact.artifactPath, env, { dryRun, otp, keyName });
    return { status: dryRun ? 'validated' : 'published', target };
  } catch (error) {
    const output = error.output ?? '';
    if (output.includes('Repushing of gem versions is not allowed')) {
      console.log(`Skipping ${target.name}; version ${version} is already published.`);
      return { status: 'already-published', target };
    }
    throw error;
  } finally {
    rmSync(artifact.distDir, { recursive: true, force: true });
  }
}

export async function publishRubyGemsRelease(version, options = {}) {
  const {
    dryRun = false,
    skipValidation = false,
    targets: explicitTargets = null,
    otp = null,
    keyName = null,
  } = options;

  if (!version) {
    throw new Error('Missing version. Example: pnpm release:rubygems 1.2.3');
  }

  const env = createRubyGemsEnv();

  console.log(`Preparing RubyGems release ${version}${dryRun ? ' (dry run)' : ''}...`);
  console.log();

  assertPreparedRelease(version, { dryRun });
  console.log();

  const targets = resolvePublishTargets({ explicitTargets });
  const results = [];

  for (const target of targets) {
    console.log(`=== ${target.name} ===`);
    const result = await publishTarget(target, {
      version,
      dryRun,
      skipValidation,
      env,
      otp,
      keyName,
    });
    results.push(result);
    console.log();
  }

  console.log(`RubyGems release ${version} completed.`);
  console.log(`Processed ${results.length} gem(s).`);
  return results;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const {
    version,
    dryRun,
    skipValidation,
    targets,
    otp,
    keyName,
    help,
  } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    process.exit(0);
  }

  try {
    await publishRubyGemsRelease(version, {
      dryRun,
      skipValidation,
      targets,
      otp,
      keyName,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
