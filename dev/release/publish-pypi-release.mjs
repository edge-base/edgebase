import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PYTHON_OPTIONAL_PUBLISH_TARGET_IDS,
  PYTHON_PUBLISH_TARGET_IDS,
  RELEASE_TARGETS,
} from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_ENV_FILE = join(REPO_ROOT, 'dev/release/.env.pypi');

function printUsage() {
  console.log(`Usage:
  node ./dev/release/publish-pypi-release.mjs <version> [--dry-run] [--skip-validation] [--include-umbrella] [--targets=python-core,python-admin]

Examples:
  pnpm release:pypi 1.2.3
  pnpm release:pypi 1.2.3 --dry-run
  pnpm release:pypi 1.2.3 --skip-validation
  pnpm release:pypi 1.2.3 --include-umbrella
  pnpm release:pypi 1.2.3 --targets=python-core,python-admin
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

function createPyPiEnv() {
  const fileEnv = existsSync(DEFAULT_ENV_FILE)
    ? parseEnvFile(readFileSync(DEFAULT_ENV_FILE, 'utf8'))
    : {};

  const merged = {
    ...fileEnv,
    ...process.env,
  };

  if (!merged.TWINE_PASSWORD && merged.PYPI_TOKEN) {
    merged.TWINE_PASSWORD = merged.PYPI_TOKEN;
  }
  if (!merged.TWINE_USERNAME && merged.TWINE_PASSWORD) {
    merged.TWINE_USERNAME = '__token__';
  }

  return merged;
}

async function getPublishedLatestVersion(packageName) {
  const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to read PyPI metadata for ${packageName}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const version = payload?.info?.version;
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
        ...PYTHON_PUBLISH_TARGET_IDS,
        ...(includeUmbrella ? PYTHON_OPTIONAL_PUBLISH_TARGET_IDS : []),
      ];

  return ids.map((id) => {
    const target = targetMap.get(id);
    if (!target) {
      throw new Error(`Unknown Python release target id: ${id}`);
    }
    if (target.ecosystem !== 'python') {
      throw new Error(`Target ${id} is not a Python release target.`);
    }
    return target;
  });
}

const pythonToolCache = new Map();

function resolvePythonTool(moduleName, uvPackage, uvCommand) {
  const cached = pythonToolCache.get(moduleName);
  if (cached) return cached;

  const moduleProbe = spawnSync('python3', ['-c', `import ${moduleName}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (!moduleProbe.error && moduleProbe.status === 0) {
    const tool = { command: 'python3', prefix: ['-m', moduleName] };
    pythonToolCache.set(moduleName, tool);
    return tool;
  }

  const uvProbe = spawnSync('uv', ['--version'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (!uvProbe.error && uvProbe.status === 0) {
    const tool = {
      command: 'uv',
      prefix: ['tool', 'run', '--from', uvPackage, uvCommand],
    };
    pythonToolCache.set(moduleName, tool);
    return tool;
  }

  throw new Error(
    `Python release requires the ${moduleName} module or uv. `
      + `Install it with \`python3 -m pip install ${uvPackage}\` or install uv.`,
  );
}

function runPythonTool(moduleName, uvPackage, uvCommand, args, label, options) {
  const tool = resolvePythonTool(moduleName, uvPackage, uvCommand);
  runCommand(tool.command, [...tool.prefix, ...args], label, options);
}

function buildTarget(target, env) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  const distDir = mkdtempSync(join(tmpdir(), `edgebase-pypi-${target.id}-`));

  try {
    runPythonTool('build', 'build', 'pyproject-build', ['--sdist', '--wheel', '--outdir', distDir], `build ${target.name}`, {
      cwd: packageDir,
      env,
    });

    const files = readdirSync(distDir)
      .filter((name) => name.endsWith('.whl') || name.endsWith('.tar.gz'))
      .sort();

    if (files.length === 0) {
      throw new Error(`No build artifacts found for ${target.name}`);
    }

    return {
      packageDir,
      distDir,
      files: files.map((name) => join(distDir, name)),
    };
  } catch (error) {
    rmSync(distDir, { recursive: true, force: true });
    throw error;
  }
}

function validateArtifacts(target, artifacts, env) {
  runPythonTool('twine', 'twine', 'twine', ['check', ...artifacts.files], `twine check ${target.name}`, {
    cwd: artifacts.packageDir,
    env,
  });
}

function uploadArtifacts(target, artifacts, env, dryRun) {
  if (dryRun) {
    console.log(`Dry run: skipping upload for ${target.name}.`);
    return;
  }

  const hasPassword = Boolean(env.TWINE_PASSWORD);
  runPythonTool('twine', 'twine', 'twine', ['upload', ...artifacts.files], `upload ${target.name}`, {
    cwd: artifacts.packageDir,
    env,
    interactive: !hasPassword,
  });
}

async function publishTarget(target, { version, dryRun, skipValidation, env }) {
  const latestVersion = await getPublishedLatestVersion(target.name);
  if (latestVersion === version && !dryRun) {
    console.log(`Skipping ${target.name}; latest already points to ${version}.`);
    return { status: 'already-published', target };
  }

  const artifacts = buildTarget(target, env);

  try {
    if (!skipValidation) {
      validateArtifacts(target, artifacts, env);
    }
    uploadArtifacts(target, artifacts, env, dryRun);
    return { status: dryRun ? 'validated' : 'published', target };
  } catch (error) {
    const output = error.output ?? '';
    if (output.includes('File already exists') || output.includes('Cannot overwrite a file')) {
      console.log(`Skipping ${target.name}; version ${version} is already published.`);
      return { status: 'already-published', target };
    }
    throw error;
  } finally {
    rmSync(artifacts.distDir, { recursive: true, force: true });
  }
}

export async function publishPyPiRelease(version, options = {}) {
  const {
    dryRun = false,
    skipValidation = false,
    includeUmbrella = false,
    targets: explicitTargets = null,
  } = options;

  if (!version) {
    throw new Error('Missing version. Example: pnpm release:pypi 1.2.3');
  }

  const env = createPyPiEnv();

  if (!dryRun && !env.TWINE_PASSWORD) {
    throw new Error(
      'Missing PyPI credentials. Set TWINE_PASSWORD/PYPI_TOKEN or create dev/release/.env.pypi.',
    );
  }

  console.log(`Preparing PyPI release ${version}${dryRun ? ' (dry run)' : ''}...`);
  console.log();

  assertPreparedRelease(version, { dryRun });
  console.log();

  const targets = resolvePublishTargets({ includeUmbrella, explicitTargets });
  const results = [];

  for (const target of targets) {
    console.log(`=== ${target.name} ===`);
    const result = await publishTarget(target, { version, dryRun, skipValidation, env });
    results.push(result);
    console.log();
  }

  console.log(`PyPI release ${version} completed.`);
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
    await publishPyPiRelease(version, {
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
