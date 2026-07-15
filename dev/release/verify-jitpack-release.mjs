import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JITPACK_VERIFY_TARGET_IDS,
  RELEASE_TARGETS,
} from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const JITPACK_BASE_URL = 'https://jitpack.io';

function printUsage() {
  console.log(`Usage:
  pnpm release:jitpack <version> [--dry-run]
    [--targets=java-core,java-android,java-admin,kotlin-core,kotlin-client,kotlin-admin,scala-core,scala-admin]
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = { dryRun: false, targets: null, help: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--targets=')) options.targets = arg.slice('--targets='.length).split(',').filter(Boolean);
    else positionals.push(arg);
  }
  return { version: positionals[0] ?? null, ...options };
}

function resolveTargets(explicitTargets) {
  const targetMap = new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
  const ids = explicitTargets ?? JITPACK_VERIFY_TARGET_IDS;
  return ids.map((id) => {
    if (!JITPACK_VERIFY_TARGET_IDS.includes(id)) {
      throw new Error(`Unsupported JitPack verification target: ${id}`);
    }
    const target = targetMap.get(id);
    if (!target) throw new Error(`Unknown JitPack release target: ${id}`);
    return target;
  });
}

export function buildJitpackArtifactUrl(artifactName, version) {
  if (!/^edgebase-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artifactName)) {
    throw new Error(`Invalid JitPack artifact name: ${artifactName}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid JitPack release version: ${version}`);
  }
  const tag = `v${version}`;
  const groupPath = 'com/github/edge-base/edgebase';
  const url = new URL(`${groupPath}/${artifactName}/${tag}/${artifactName}-${tag}.pom`, `${JITPACK_BASE_URL}/`);
  if (url.origin !== JITPACK_BASE_URL) {
    throw new Error('JitPack artifact URL escaped the trusted origin.');
  }
  return url.href;
}

export async function verifyJitpackRelease(version, options = {}) {
  const {
    dryRun = false,
    targets: explicitTargets = null,
    fetchImpl = globalThis.fetch,
  } = options;

  if (!version) throw new Error('Missing version. Example: pnpm release:jitpack <version> --dry-run');
  assertPreparedRelease(version, { dryRun });

  const targets = resolveTargets(explicitTargets);
  const results = [];
  for (const target of targets) {
    const url = buildJitpackArtifactUrl(target.name, version);
    if (dryRun) {
      console.log(`[dry run] verify ${target.id}: ${url}`);
      results.push({ target, url, status: 'planned' });
      continue;
    }

    if (typeof fetchImpl !== 'function') {
      throw new Error('JitPack verification requires a fetch implementation.');
    }
    // Only an allowlisted artifact name and validated semantic version derived
    // from release metadata reach this fixed public JitPack origin; no file
    // contents or credentials are transmitted.
    const response = await fetchImpl(url, { // lgtm[js/file-access-to-http]
      headers: { 'User-Agent': 'edgebase-release-verifier/1.0' },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(
        `JitPack artifact ${target.name}@v${version} is unavailable: ${response.status} ${response.statusText}`,
      );
    }
    await response.body?.cancel();
    console.log(`Verified ${target.name}@v${version}`);
    results.push({ target, url, status: 'verified' });
  }
  return results;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  try {
    await verifyJitpackRelease(options.version, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
