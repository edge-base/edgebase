import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NPM_PUBLISH_TARGET_IDS, RELEASE_TARGETS } from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_ENV_FILE = resolve(REPO_ROOT, 'dev/release/.env.npm');
const NPM_STAGE_PATHS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'LICENSE',
  'packages/admin',
  'packages/cli',
  'packages/create-edgebase',
  'packages/plugins/core',
  'packages/server',
  'packages/shared',
  'packages/sdk/js',
  'packages/sdk/react-native',
];
const GENERATED_STAGE_DIRS = new Set([
  '.svelte-kit',
  '.turbo',
  'admin-build',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

function printUsage() {
  console.log(`Usage:
  node ./dev/release/publish-npm-release.mjs <version> [--otp=123456] [--tag=latest] [--dry-run]

Examples:
  pnpm release:npm 1.2.3
  NPM_TOKEN=npm_xxx pnpm release:npm 1.2.3
  pnpm release:npm 1.2.3 --otp=123456
  pnpm release:npm 1.2.3 --dry-run
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    otp: null,
    tag: 'latest',
    dryRun: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith('--otp=')) {
      options.otp = arg.slice('--otp='.length);
      continue;
    }

    if (arg.startsWith('--tag=')) {
      options.tag = arg.slice('--tag='.length) || 'latest';
      continue;
    }

    positionals.push(arg);
  }

  return {
    version: positionals[0] ?? null,
    ...options,
  };
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

function shouldCopyToStage(sourcePath) {
  const relativePath = relative(REPO_ROOT, sourcePath);
  if (!relativePath || relativePath.startsWith('..')) return true;
  const parts = relativePath.split(sep);
  if (parts.some((part) => GENERATED_STAGE_DIRS.has(part))) return false;

  const name = basename(sourcePath);
  if (name === '.npmrc' || name === '.dev.vars' || name === '.env') return false;
  if (/^\.env\.(?!.*(?:example|tmpl)$)/.test(name)) return false;
  return true;
}

function linkInstalledDependencies(sourceDir, stagedDir) {
  const sourceNodeModules = join(sourceDir, 'node_modules');
  if (!existsSync(sourceNodeModules)) return;
  const stagedNodeModules = join(stagedDir, 'node_modules');
  mkdirSync(dirname(stagedNodeModules), { recursive: true });
  symlinkSync(sourceNodeModules, stagedNodeModules, 'dir');
}

export function createNpmReleaseWorkspace() {
  const stageRoot = mkdtempSync(join(tmpdir(), 'edgebase-npm-release-'));
  for (const relativePath of NPM_STAGE_PATHS) {
    const sourcePath = resolve(REPO_ROOT, relativePath);
    if (!existsSync(sourcePath)) continue;
    const destinationPath = resolve(stageRoot, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath, {
      recursive: lstatSync(sourcePath).isDirectory(),
      filter: shouldCopyToStage,
      preserveTimestamps: true,
    });
  }

  linkInstalledDependencies(REPO_ROOT, stageRoot);
  const packageDirs = new Set([
    'packages/admin',
    ...RELEASE_TARGETS
      .filter((target) => target.ecosystem === 'npm')
      .map((target) => dirname(target.path)),
  ]);
  for (const relativeDir of packageDirs) {
    linkInstalledDependencies(resolve(REPO_ROOT, relativeDir), resolve(stageRoot, relativeDir));
  }

  return {
    root: stageRoot,
    cleanup() {
      rmSync(stageRoot, { recursive: true, force: true });
    },
  };
}

function runCommand(command, args, label, env = process.env, options = {}) {
  const { cwd = REPO_ROOT, interactive = false } = options;
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
}

// Provenance defaults ON in CI (npm publish --provenance requires OIDC, which
// is only present in CI). Opt out with EDGEBASE_NPM_PROVENANCE=false; force on
// with EDGEBASE_NPM_PROVENANCE=true.
function shouldUseProvenance() {
  const flag = (process.env.EDGEBASE_NPM_PROVENANCE ?? '').trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return Boolean(process.env.CI);
}

async function getPublishedLatestVersion(packageName) {
  const encodedName = encodeURIComponent(packageName);
  const response = await fetch(`https://registry.npmjs.org/-/package/${encodedName}/dist-tags`);
  if (response.status === 404 || response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to read dist-tags for ${packageName}: ${response.status} ${response.statusText}`);
  }

  const tags = await response.json();
  return typeof tags.latest === 'string' ? tags.latest : null;
}

function createAuthEnv() {
  const fileEnv = existsSync(DEFAULT_ENV_FILE)
    ? parseEnvFile(readFileSync(DEFAULT_ENV_FILE, 'utf8'))
    : {};

  const merged = {
    ...fileEnv,
    ...process.env,
  };

  const token = merged.NPM_TOKEN || merged.NODE_AUTH_TOKEN || null;
  if (!token) {
    return {
      env: merged,
      mode: 'session',
      cleanup() {},
    };
  }

  const authDir = mkdtempSync(join(tmpdir(), 'edgebase-npm-auth-'));
  const userConfigPath = join(authDir, '.npmrc');
  writeFileSync(
    userConfigPath,
    `//registry.npmjs.org/:_authToken=${token}\nregistry=https://registry.npmjs.org/\n`,
    'utf8',
  );

  return {
    env: {
      ...merged,
      NPM_TOKEN: token,
      NODE_AUTH_TOKEN: token,
      npm_config_userconfig: userConfigPath,
    },
    mode: 'token',
    cleanup() {
      rmSync(authDir, { recursive: true, force: true });
    },
  };
}

function ensureNpmLogin(env, mode) {
  if (mode === 'token') {
    console.log('Using npm token authentication from environment.');
  }
  runCommand('npm', ['whoami'], 'npm whoami', env);
}

function getNpmPublishTargets() {
  const targetMap = new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
  return NPM_PUBLISH_TARGET_IDS.map((id) => {
    const target = targetMap.get(id);
    if (!target) {
      throw new Error(`Unknown npm publish target id: ${id}`);
    }
    return target;
  });
}

async function publishTarget(target, {
  otp,
  tag,
  dryRun,
  version,
  env,
  authMode,
  releaseRoot,
}) {
  const latestVersion = await getPublishedLatestVersion(target.name);
  if (latestVersion === version) {
    console.log(`Skipping ${target.name}; latest already points to ${version}.`);
    return { status: 'already-published', target };
  }

  // Use pnpm publish so workspace:* dependencies are rewritten to real
  // semver ranges inside the packed tarball before upload.
  const args = ['publish', '--tag', tag, '--no-git-checks'];
  if (target.name.startsWith('@')) {
    args.push('--access', 'public');
  }
  // npm provenance signs the published tarball with the CI OIDC identity.
  // Skip on dry runs (no registry interaction) and outside CI (no OIDC token).
  if (!dryRun && shouldUseProvenance()) {
    args.push('--provenance');
  }
  if (dryRun) {
    args.push('--dry-run');
  }
  if (otp) {
    args.push(`--otp=${otp}`);
  }

  const packageDir = resolve(releaseRoot, dirname(target.path));

  try {
    runCommand('pnpm', args, `publish ${target.name}`, env, {
      cwd: packageDir,
      interactive: authMode === 'session' && !otp && !dryRun,
    });
    return { status: 'published', target };
  } catch (error) {
    const output = error.output ?? '';
    if (output.includes('previously published versions') || output.includes('There are no new packages that should be published')) {
      console.log(`Skipping ${target.name}; version ${version} is already published.`);
      return { status: 'already-published', target };
    }
    throw error;
  }
}

export async function publishNpmRelease(version, options = {}) {
  const { otp = null, tag = 'latest', dryRun = false } = options;

  if (!version) {
    throw new Error('Missing version. Example: pnpm release:npm 1.2.3');
  }

  console.log(`Preparing npm release ${version}${dryRun ? ' (dry run)' : ''}...`);
  console.log();

  assertPreparedRelease(version, { dryRun });
  console.log();

  const auth = dryRun
    ? { env: process.env, mode: 'dry-run', cleanup() {} }
    : createAuthEnv();
  const releaseWorkspace = createNpmReleaseWorkspace();

  try {
    if (!dryRun) {
      ensureNpmLogin(auth.env, auth.mode);
    }

    const targets = getNpmPublishTargets();
    const results = [];

    for (const target of targets) {
      console.log(`=== ${target.name} ===`);
      const result = await publishTarget(target, {
        otp,
        tag,
        dryRun,
        version,
        env: auth.env,
        authMode: auth.mode,
        releaseRoot: releaseWorkspace.root,
      });
      results.push(result);
      console.log();
    }

    console.log(`npm release ${version} completed.`);
    console.log(`Published or confirmed ${results.length} package(s).`);
    return results;
  } finally {
    releaseWorkspace.cleanup();
    auth.cleanup();
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const { version, otp, tag, dryRun, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    process.exit(0);
  }

  try {
    await publishNpmRelease(version, { otp, tag, dryRun });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
