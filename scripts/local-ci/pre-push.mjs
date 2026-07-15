#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { RUNNER_PATHS, WORKFLOW_PATHS } from './config.mjs';
import { FULL_GATE_JOB_IDS, NPM_RELEASE_JOB_IDS } from './jobs.mjs';
import {
  digestRef,
  findStableNpmReleasePush,
  git,
  parsePrePushInput,
  readReceipt,
  validateReceiptShape,
} from './lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ZERO_SHA = /^0+$/;

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function validate(localSha, label, receipt, profile, jobs) {
  const commit = await git(repoRoot, ['rev-parse', `${localSha}^{commit}`]);
  const [tree, workflowDigest, runnerDigest] = await Promise.all([
    git(repoRoot, ['rev-parse', `${commit}^{tree}`]),
    digestRef(repoRoot, commit, WORKFLOW_PATHS),
    digestRef(repoRoot, commit, RUNNER_PATHS),
  ]);
  const errors = validateReceiptShape(receipt, {
    profile,
    commit,
    tree,
    workflowDigest,
    runnerDigest,
    jobs,
  });
  if (errors.length > 0) {
    throw new Error(
      `${label} is not authorized by the local Linux CI receipt:\n- ${errors.join('\n- ')}`,
    );
  }
  console.log(`[pre-push] local Linux CI receipt matches ${label} (${commit}).`);
}

async function authorizeNpmRelease(updates) {
  const release = findStableNpmReleasePush(updates);
  if (!release) {
    throw new Error(
      'An npm-release receipt requires main and one stable vMAJOR.MINOR.PATCH tag in the same push.',
    );
  }
  const [mainCommit, tagCommit] = await Promise.all([
    git(repoRoot, ['rev-parse', `${release.main.localSha}^{commit}`]),
    git(repoRoot, ['rev-parse', `${release.tag.localSha}^{commit}`]),
  ]);
  if (mainCommit !== tagCommit) {
    throw new Error('The stable npm release tag and main must point to the same commit.');
  }
  const packageJson = JSON.parse(await git(repoRoot, ['show', `${tagCommit}:package.json`]));
  if (packageJson.version !== release.version) {
    throw new Error(
      `Release tag v${release.version} does not match package version ${packageJson.version}.`,
    );
  }
  return tagCommit;
}

async function main() {
  const input = await readStdin();
  const updates = parsePrePushInput(input);
  const receipt = await readReceipt(repoRoot);
  const profile = receipt.profile;
  let jobs;
  if (profile === 'full') jobs = FULL_GATE_JOB_IDS;
  else if (profile === 'npm-release') {
    await authorizeNpmRelease(updates);
    jobs = NPM_RELEASE_JOB_IDS;
  } else throw new Error(`Unknown receipt profile: ${profile}`);
  if (updates.length === 0) {
    if (profile !== 'full') {
      throw new Error('An npm-release receipt cannot authorize a push without explicit refs.');
    }
    await validate('HEAD', 'HEAD', receipt, profile, jobs);
    return;
  }
  for (const update of updates) {
    if (ZERO_SHA.test(update.localSha)) continue;
    await validate(update.localSha, update.localRef, receipt, profile, jobs);
  }
}

main().catch((error) => {
  console.error(`[pre-push] blocked: ${error.message}`);
  console.error(
    '[pre-push] Commit the exact tree, then run the full gate or: ' +
      'node scripts/local-ci/run.mjs --profile npm-release',
  );
  process.exitCode = 1;
});
