import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GO_SPLIT_TARGET_IDS } from '../../scripts/release-targets.mjs';
import { assertPreparedRelease } from '../../scripts/release-publish-guard.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEFAULT_REPO = 'edge-base/sdk-go';
const GO_PREFIX = 'packages/sdk/go';

function printUsage() {
  console.log(`Usage:
  pnpm release:go-verify <version> [--dry-run] [--repo=edge-base/sdk-go]
`);
}

function parseArgs(argv) {
  const positionals = [];
  const options = { dryRun: false, repository: null, help: false };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg.startsWith('--repo=')) options.repository = arg.slice('--repo='.length);
    else positionals.push(arg);
  }
  return { version: positionals[0] ?? null, ...options };
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : '.'}`);
  }
  return (result.stdout ?? '').trim();
}

function parseRemoteTag(output, tag) {
  const directRef = `refs/tags/${tag}`;
  const dereferencedRef = `${directRef}^{}`;
  let direct = '';
  let dereferenced = '';
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === directRef) direct = sha;
    if (ref === dereferencedRef) dereferenced = sha;
  }
  return dereferenced || direct;
}

export function verifyGoSplitRelease(version, options = {}) {
  const {
    dryRun = false,
    repository = null,
    env = process.env,
    runGitImpl = runGit,
  } = options;

  if (!version) throw new Error('Missing version. Example: pnpm release:go-verify 0.3.6 --dry-run');
  if (GO_SPLIT_TARGET_IDS.length !== 1 || GO_SPLIT_TARGET_IDS[0] !== 'go-sdk') {
    throw new Error('Go split target contract is invalid.');
  }

  assertPreparedRelease(version, { dryRun });
  const destinationRepo = repository || env.GO_SPLIT_REPO || DEFAULT_REPO;
  const tag = `v${version}`;
  const remoteUrl = `https://github.com/${destinationRepo}.git`;
  const plan = { id: 'go-sdk', prefix: GO_PREFIX, destinationRepo, tag, remoteUrl };

  if (dryRun) {
    console.log(`[dry run] verify go-sdk: ${remoteUrl} ${tag}`);
    return { ...plan, status: 'planned' };
  }

  const expectedSha = runGitImpl(['subtree', 'split', `--prefix=${GO_PREFIX}`, tag], { env });
  const askpass = resolve(REPO_ROOT, 'scripts/release-github-askpass.sh');
  const gitEnv = {
    ...env,
    GIT_ASKPASS: askpass,
    GIT_TERMINAL_PROMPT: '0',
  };
  const remoteTags = runGitImpl(
    ['ls-remote', '--tags', remoteUrl, `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    { env: gitEnv },
  );
  const observedSha = parseRemoteTag(remoteTags, tag);
  if (!observedSha) {
    throw new Error(`Go split tag ${destinationRepo}@${tag} is unavailable.`);
  }
  if (observedSha !== expectedSha) {
    throw new Error(
      `Go split tag ${destinationRepo}@${tag} points to ${observedSha}, expected ${expectedSha}.`,
    );
  }

  console.log(`Verified ${destinationRepo}@${tag} (${observedSha})`);
  return { ...plan, expectedSha, observedSha, status: 'verified' };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    process.exit(0);
  }
  try {
    verifyGoSplitRelease(options.version, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
