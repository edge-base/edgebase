import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GO_SPLIT_TARGET_IDS } from '../../scripts/release-targets.mjs';
import {
  assertPreparedRelease,
  assertReleaseTagAtHead,
} from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_REPO = 'edge-base/sdk-go';

function printUsage() {
  console.log(`Usage:
  pnpm release:go-sync <version> [--dry-run] [--sync-mode=tag|branch]
    [--tag=vX.Y.Z] [--source-ref=HEAD]
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = {
    dryRun: false,
    syncMode: 'tag',
    tag: null,
    sourceRef: 'HEAD',
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--sync-mode=')) options.syncMode = arg.slice('--sync-mode='.length);
    else if (arg.startsWith('--tag=')) options.tag = arg.slice('--tag='.length);
    else if (arg.startsWith('--source-ref=')) options.sourceRef = arg.slice('--source-ref='.length);
    else positionals.push(arg);
  }
  return { version: positionals[0] ?? null, ...options };
}

export function syncGoSplitRelease(version, options = {}) {
  const {
    dryRun = false,
    syncMode = 'tag',
    tag = null,
    sourceRef = 'HEAD',
    env = process.env,
  } = options;

  if (!version) throw new Error('Missing version. Example: pnpm release:go-sync 1.2.3 --dry-run');
  if (!['tag', 'branch'].includes(syncMode)) throw new Error(`Unsupported sync mode: ${syncMode}`);
  if (GO_SPLIT_TARGET_IDS.length !== 1 || GO_SPLIT_TARGET_IDS[0] !== 'go-sdk') {
    throw new Error('Go split target contract is invalid.');
  }

  const refName = syncMode === 'tag' ? (tag || `v${version}`) : 'main';
  if (syncMode === 'tag' && refName !== `v${version}`) {
    throw new Error(`Tag ${refName} does not match prepared release v${version}.`);
  }

  assertPreparedRelease(version, { dryRun });
  if (!dryRun && syncMode === 'tag') assertReleaseTagAtHead(version);

  const destinationRepo = env.GO_SPLIT_REPO || DEFAULT_REPO;
  const plan = {
    id: 'go-sdk',
    prefix: 'packages/sdk/go',
    destinationRepo,
    syncMode,
    refName,
    sourceRef,
  };
  if (dryRun) {
    console.log(`[dry run] go-sdk: ${plan.prefix} -> ${destinationRepo} (${syncMode} ${refName})`);
    return plan;
  }

  const token = env.EDGEBASE_SPLIT_PUSH_TOKEN;
  if (!token) throw new Error('Missing EDGEBASE_SPLIT_PUSH_TOKEN for Go split synchronization.');
  const result = spawnSync(
    'bash',
    ['scripts/sync-go-split-repo.sh', destinationRepo, syncMode, refName, sourceRef],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, EDGEBASE_SPLIT_PUSH_TOKEN: token },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Go split sync failed with exit code ${result.status ?? 1}`);
  return plan;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  try {
    syncGoSplitRelease(options.version, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
