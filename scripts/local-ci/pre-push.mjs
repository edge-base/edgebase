#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { RUNNER_PATHS, WORKFLOW_PATHS } from './config.mjs';
import { FULL_GATE_JOB_IDS } from './jobs.mjs';
import { digestRef, git, parsePrePushInput, readReceipt, validateReceiptShape } from './lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ZERO_SHA = /^0+$/;

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function validate(localSha, label) {
  const commit = await git(repoRoot, ['rev-parse', `${localSha}^{commit}`]);
  const [tree, workflowDigest, runnerDigest, receipt] = await Promise.all([
    git(repoRoot, ['rev-parse', `${commit}^{tree}`]),
    digestRef(repoRoot, commit, WORKFLOW_PATHS),
    digestRef(repoRoot, commit, RUNNER_PATHS),
    readReceipt(repoRoot),
  ]);
  const errors = validateReceiptShape(receipt, {
    commit,
    tree,
    workflowDigest,
    runnerDigest,
    jobs: FULL_GATE_JOB_IDS,
  });
  if (errors.length > 0) {
    throw new Error(
      `${label} is not authorized by the local Linux CI receipt:\n- ${errors.join('\n- ')}`,
    );
  }
  console.log(`[pre-push] local Linux CI receipt matches ${label} (${commit}).`);
}

async function main() {
  const input = await readStdin();
  const updates = parsePrePushInput(input);
  if (updates.length === 0) {
    await validate('HEAD', 'HEAD');
    return;
  }
  for (const update of updates) {
    if (ZERO_SHA.test(update.localSha)) continue;
    await validate(update.localSha, update.localRef);
  }
}

main().catch((error) => {
  console.error(`[pre-push] blocked: ${error.message}`);
  console.error('[pre-push] Commit the exact tree, then run: node scripts/local-ci/run.mjs');
  process.exitCode = 1;
});
