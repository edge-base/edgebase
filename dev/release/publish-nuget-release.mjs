import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NUGET_PUBLISH_TARGET_IDS,
  RELEASE_TARGETS,
} from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_ENV_FILE = resolve(REPO_ROOT, 'dev/release/.env.nuget');
const DEFAULT_SOURCE = 'https://api.nuget.org/v3/index.json';
const PUBLISH_ORDER = ['csharp-core', 'csharp-admin', 'csharp-unity'];

function printUsage() {
  console.log(`Usage:
  node ./dev/release/publish-nuget-release.mjs <version> [--dry-run] [--skip-validation] [--targets=csharp-core,csharp-admin,csharp-unity]

Examples:
  pnpm release:nuget 1.2.3
  pnpm release:nuget 1.2.3 --dry-run
  pnpm release:nuget 1.2.3 --skip-validation
  pnpm release:nuget 1.2.3 --targets=csharp-core,csharp-admin
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
  } = options;

  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: 'pipe',
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output.trim().length > 0) {
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

function createNuGetEnv() {
  const fileEnv = existsSync(DEFAULT_ENV_FILE)
    ? parseEnvFile(readFileSync(DEFAULT_ENV_FILE, 'utf8'))
    : {};

  const merged = {
    ...fileEnv,
    ...process.env,
  };

  if (!merged.NUGET_API_KEY && merged.NUGET_KEY) {
    merged.NUGET_API_KEY = merged.NUGET_KEY;
  }

  if (!merged.NUGET_SOURCE) {
    merged.NUGET_SOURCE = DEFAULT_SOURCE;
  }

  return merged;
}

async function getPublishedLatestVersion(packageId) {
  const packageKey = packageId.toLowerCase();
  const response = await fetch(`https://api.nuget.org/v3-flatcontainer/${packageKey}/index.json`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to read NuGet metadata for ${packageId}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const versions = Array.isArray(payload?.versions) ? payload.versions : [];
  const stableVersions = versions.filter((version) => typeof version === 'string' && !version.includes('-'));
  return stableVersions.at(-1) ?? null;
}

function getTargetMap() {
  return new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
}

function resolvePublishTargets({ explicitTargets }) {
  const targetMap = getTargetMap();
  const ids = explicitTargets && explicitTargets.length > 0
    ? explicitTargets
    : [...NUGET_PUBLISH_TARGET_IDS];

  const invalidIds = ids.filter((id) => !NUGET_PUBLISH_TARGET_IDS.includes(id));
  if (invalidIds.length > 0) {
    throw new Error(`Unsupported NuGet publish target id(s): ${invalidIds.join(', ')}`);
  }

  return ids
    .map((id) => {
      const target = targetMap.get(id);
      if (!target) {
        throw new Error(`Unknown NuGet release target id: ${id}`);
      }
      if (target.ecosystem !== 'csharp') {
        throw new Error(`Target ${id} is not a C# release target.`);
      }
      return target;
    })
    .sort((a, b) => PUBLISH_ORDER.indexOf(a.id) - PUBLISH_ORDER.indexOf(b.id));
}

function validateTarget(target, env) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  runCommand('dotnet', ['build', basename(target.path), '-c', 'Release', '--nologo'], `dotnet build ${target.name}`, {
    cwd: packageDir,
    env,
  });
}

function packTarget(target, version, env, skipValidation) {
  const packageDir = resolve(REPO_ROOT, dirname(target.path));
  const distDir = mkdtempSync(join(tmpdir(), `edgebase-nuget-${target.id}-`));

  try {
    if (!skipValidation) {
      validateTarget(target, env);
    }

    const args = [
      'pack',
      basename(target.path),
      '-c',
      'Release',
      '--nologo',
      '-o',
      distDir,
      `-p:PackageVersion=${version}`,
    ];
    if (!skipValidation) {
      args.push('--no-build');
    }

    runCommand('dotnet', args, `dotnet pack ${target.name}`, {
      cwd: packageDir,
      env,
    });

    const files = readdirSync(distDir)
      .filter((name) => name.endsWith('.nupkg') && !name.endsWith('.snupkg'))
      .sort();

    if (files.length === 0) {
      throw new Error(`No NuGet artifact found for ${target.name}`);
    }

    return {
      packageDir,
      distDir,
      artifactPath: join(distDir, files[0]),
    };
  } catch (error) {
    rmSync(distDir, { recursive: true, force: true });
    throw error;
  }
}

function escapeXmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Write the API key into a temporary, isolated NuGet config instead of passing
// it as `--api-key <key>` on argv (which is visible to any user via `ps`).
// `dotnet nuget push` resolves the key from the <apikeys> entry that matches
// the push source URL.
function writeTempNuGetApiKeyConfig(source, apiKey) {
  const authDir = mkdtempSync(join(tmpdir(), 'edgebase-nuget-auth-'));
  const configPath = join(authDir, 'nuget.config');
  writeFileSync(
    configPath,
    `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <apikeys>
    <add key="${escapeXmlAttribute(source)}" value="${escapeXmlAttribute(apiKey)}" />
  </apikeys>
</configuration>
`,
    'utf8',
  );
  return {
    configPath,
    cleanup() {
      rmSync(authDir, { recursive: true, force: true });
    },
  };
}

function pushArtifact(target, artifact, env, dryRun) {
  if (dryRun) {
    console.log(`Dry run: skipping NuGet push for ${target.name}.`);
    return;
  }

  if (!env.NUGET_API_KEY) {
    throw new Error('Missing NUGET_API_KEY or NUGET_KEY for NuGet publish.');
  }

  const auth = writeTempNuGetApiKeyConfig(env.NUGET_SOURCE, env.NUGET_API_KEY);
  try {
    runCommand(
      'dotnet',
      [
        'nuget',
        'push',
        artifact.artifactPath,
        '--source',
        env.NUGET_SOURCE,
        '--configfile',
        auth.configPath,
        '--skip-duplicate',
      ],
      `dotnet nuget push ${target.name}`,
      {
        cwd: artifact.packageDir,
        env,
      },
    );
  } finally {
    auth.cleanup();
  }
}

async function publishTarget(target, { version, dryRun, skipValidation, env }) {
  let latestVersion = null;
  try {
    latestVersion = await getPublishedLatestVersion(target.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: failed to check latest NuGet version for ${target.name}; continuing anyway. (${message})`);
  }
  if (latestVersion === version && !dryRun) {
    console.log(`Skipping ${target.name}; latest already points to ${version}.`);
    return { status: 'already-published', target };
  }

  const artifact = packTarget(target, version, env, skipValidation);

  try {
    pushArtifact(target, artifact, env, dryRun);
    return { status: dryRun ? 'validated' : 'published', target };
  } finally {
    rmSync(artifact.distDir, { recursive: true, force: true });
  }
}

export async function publishNuGetRelease(version, options = {}) {
  const {
    dryRun = false,
    skipValidation = false,
    targets: explicitTargets = null,
  } = options;

  if (!version) {
    throw new Error('Missing version. Example: pnpm release:nuget 1.2.3');
  }

  console.log(`Preparing NuGet release ${version}${dryRun ? ' (dry run)' : ''}...`);
  console.log();

  const env = createNuGetEnv();

  assertPreparedRelease(version, { dryRun });
  console.log();

  const targets = resolvePublishTargets({ explicitTargets });
  const results = [];

  for (const target of targets) {
    console.log(`=== ${target.name} ===`);
    const result = await publishTarget(target, { version, dryRun, skipValidation, env });
    results.push(result);
    console.log();
  }

  console.log(`NuGet release ${version} completed.`);
  console.log(`Processed ${results.length} package(s).`);
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
    await publishNuGetRelease(version, {
      dryRun,
      skipValidation,
      targets,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
