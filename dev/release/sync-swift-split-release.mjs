import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_TARGETS,
  SWIFT_SPLIT_TARGET_IDS,
} from '../../scripts/release-targets.mjs';
import {
  assertPreparedRelease,
  assertReleaseTagAtHead,
} from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TARGET_CONFIG = {
  'swift-core': {
    splitName: 'core',
    prefix: 'packages/sdk/swift/packages/core',
    defaultRepo: 'edge-base/edgebase-swift-core',
    repoEnv: 'SWIFT_CORE_SPLIT_REPO',
  },
  'swift-ios': {
    splitName: 'client',
    prefix: 'packages/sdk/swift/packages/ios',
    defaultRepo: 'edge-base/edgebase-swift',
    repoEnv: 'SWIFT_CLIENT_SPLIT_REPO',
  },
};

function printUsage() {
  console.log(`Usage:
  pnpm release:swift-sync <version> [--dry-run] [--sync-mode=tag|branch]
    [--tag=vX.Y.Z] [--targets=swift-core,swift-ios] [--source-ref=HEAD]
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    dryRun: false,
    syncMode: 'tag',
    tag: null,
    targets: null,
    sourceRef: 'HEAD',
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--sync-mode=')) options.syncMode = arg.slice('--sync-mode='.length);
    else if (arg.startsWith('--tag=')) options.tag = arg.slice('--tag='.length);
    else if (arg.startsWith('--targets=')) options.targets = arg.slice('--targets='.length).split(',').filter(Boolean);
    else if (arg.startsWith('--source-ref=')) options.sourceRef = arg.slice('--source-ref='.length);
    else positionals.push(arg);
  }
  return { version: positionals[0] ?? null, ...options };
}

function resolveTargets(explicitTargets) {
  const ids = explicitTargets ?? SWIFT_SPLIT_TARGET_IDS;
  const knownTargets = new Set(RELEASE_TARGETS.map((target) => target.id));
  for (const id of ids) {
    if (!SWIFT_SPLIT_TARGET_IDS.includes(id) || !knownTargets.has(id) || !TARGET_CONFIG[id]) {
      throw new Error(`Unsupported Swift split target: ${id}`);
    }
  }
  return ids;
}

function runSync(args, token) {
  const result = spawnSync('bash', ['scripts/sync-swift-split-repo.sh', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, EDGEBASE_SPLIT_PUSH_TOKEN: token },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Swift split sync failed with exit code ${result.status ?? 1}`);
  }
}

export function syncSwiftSplitRelease(version, options = {}) {
  const {
    dryRun = false,
    syncMode = 'tag',
    tag = null,
    targets: explicitTargets = null,
    sourceRef = 'HEAD',
    env = process.env,
  } = options;

  if (!version) throw new Error('Missing version. Example: pnpm release:swift-sync <version> --dry-run');
  if (!['tag', 'branch'].includes(syncMode)) throw new Error(`Unsupported sync mode: ${syncMode}`);

  const refName = syncMode === 'tag' ? (tag || `v${version}`) : 'main';
  if (syncMode === 'tag' && refName !== `v${version}`) {
    throw new Error(`Tag ${refName} does not match prepared release v${version}.`);
  }

  assertPreparedRelease(version, { dryRun });
  if (!dryRun && syncMode === 'tag') {
    assertReleaseTagAtHead(version);
  }
  const targetIds = resolveTargets(explicitTargets);
  const token = env.EDGEBASE_SPLIT_PUSH_TOKEN;
  if (!dryRun && !token) {
    throw new Error('Missing EDGEBASE_SPLIT_PUSH_TOKEN for Swift split synchronization.');
  }

  const coreRepo = env.SWIFT_CORE_SPLIT_REPO || TARGET_CONFIG['swift-core'].defaultRepo;
  const plans = targetIds.map((id) => {
    const config = TARGET_CONFIG[id];
    return {
      id,
      ...config,
      destinationRepo: env[config.repoEnv] || config.defaultRepo,
      coreRepo,
      syncMode,
      refName,
      sourceRef,
    };
  });

  for (const plan of plans) {
    if (dryRun) {
      console.log(`[dry run] ${plan.id}: ${plan.prefix} -> ${plan.destinationRepo} (${plan.syncMode} ${plan.refName})`);
      continue;
    }
    runSync([
      plan.splitName,
      plan.prefix,
      plan.destinationRepo,
      plan.coreRepo,
      plan.syncMode,
      plan.refName,
      plan.sourceRef,
    ], token);
  }

  return plans;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  try {
    syncSwiftSplitRelease(options.version, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
