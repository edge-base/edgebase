#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runActJob } from './act-job.mjs';
import {
  ACT_VERSION,
  ACT_RUNNER_IMAGE,
  POSTGRES_IMAGE,
  RECEIPT_SCHEMA,
  RUNNER_PATHS,
  SEMGREP_IMAGE,
  WORKFLOW_PATHS,
  stateDir,
} from './config.mjs';
import { FULL_GATE_JOB_IDS, LOCAL_CI_JOBS, findLocalCiJob } from './jobs.mjs';
import {
  digestRef,
  digestWorktree,
  dockerCapacity,
  ensureDockerImages,
  git,
  installAct,
  removeReceipt,
  repositoryState,
  run,
  writeReceiptAtomic,
} from './lib.mjs';
import { runWeightedJobs } from './scheduler.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function usage() {
  console.log(`Usage:
  node scripts/local-ci/run.mjs                 # authoritative full gate
  node scripts/local-ci/run.mjs --job <id>      # diagnostic job + dependencies
  node scripts/local-ci/run.mjs --diagnostic    # full gate, never writes receipt
  node scripts/local-ci/run.mjs --dry-run       # validate act workflow plans only
  node scripts/local-ci/run.mjs --doctor        # verify local prerequisites
  node scripts/local-ci/run.mjs --list          # list required Linux jobs`);
}

function parseArgs(argv) {
  const options = { diagnostic: false, doctor: false, dryRun: false, list: false, job: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--diagnostic') options.diagnostic = true;
    else if (argument === '--doctor') options.doctor = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--list') options.list = true;
    else if (argument === '--job') options.job = argv[++index];
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.job && !findLocalCiJob(options.job))
    throw new Error(`Unknown local CI job: ${options.job}`);
  return options;
}

function dependencyClosure(jobId) {
  if (!jobId) return LOCAL_CI_JOBS;
  const selected = new Set();
  const visit = (id) => {
    if (selected.has(id)) return;
    const job = findLocalCiJob(id);
    for (const dependency of job.needs) visit(dependency);
    selected.add(id);
  };
  visit(jobId);
  return LOCAL_CI_JOBS.filter((job) => selected.has(job.id));
}

function imagesForJobs(jobs) {
  const images = [ACT_RUNNER_IMAGE];
  if (jobs.some((job) => job.id === 'server-unit')) images.push(POSTGRES_IMAGE);
  if (jobs.some((job) => job.id === 'semgrep-high-severity')) images.push(SEMGREP_IMAGE);
  return images;
}

function formatDuration(durationMs) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

async function doctor() {
  const capacity = await dockerCapacity(repoRoot);
  const actPath = await installAct(repoRoot);
  const version = await run(actPath, ['--version']);
  console.log(
    `Docker: ${capacity.cpus} CPUs, ${capacity.memoryGiB.toFixed(1)} GiB, ${capacity.architecture}`,
  );
  console.log(
    `Scheduler: sequential jobs, weight budget ${capacity.maxWeight}`,
  );
  console.log(`Linux target: linux/amd64`);
  console.log(version.stdout.toString().trim());
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (options.list) {
    for (const job of LOCAL_CI_JOBS) {
      const matrix = Object.entries(job.matrix)
        .map(([key, value]) => `${key}=${value}`)
        .join(',');
      console.log(
        `${job.id}\tweight=${job.weight}\t${job.sourceJob}${matrix ? ` (${matrix})` : ''}`,
      );
    }
    return;
  }
  if (options.doctor) {
    await doctor();
    return;
  }

  const initial = await repositoryState(repoRoot);
  const authoritative = !options.job && !options.diagnostic && !options.dryRun;
  if (authoritative && !initial.clean) {
    throw new Error(
      `The authoritative gate only runs for an exact clean commit. Commit or stash these changes first:\n${initial.status}`,
    );
  }

  const stateRoot = stateDir(repoRoot);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${initial.commit.slice(0, 12)}`;
  const runRoot = path.join(stateRoot, 'runs', runId);
  await mkdir(runRoot, { recursive: true });
  if (authoritative) await removeReceipt(repoRoot);

  const selectedBase = dependencyClosure(options.job);
  const [workflowDigest, runnerDigest, capacity, actPath] = await Promise.all([
    digestWorktree(repoRoot, WORKFLOW_PATHS),
    digestWorktree(repoRoot, RUNNER_PATHS),
    dockerCapacity(repoRoot),
    installAct(repoRoot),
  ]);
  if (!options.dryRun) await ensureDockerImages(repoRoot, imagesForJobs(selectedBase));

  const baseCommit = await git(repoRoot, ['rev-parse', 'origin/main']);
  const selected = selectedBase;
  const mode = authoritative ? 'AUTHORITATIVE' : 'DIAGNOSTIC';
  console.log(
    `[local-ci] ${mode} ${initial.commit} | ${selected.length} jobs | ` +
      `sequential / weight ${capacity.maxWeight}`,
  );

  const results = await runWeightedJobs(selected, {
    maxJobs: capacity.maxJobs,
    maxWeight: capacity.maxWeight,
    execute: (job) =>
      runActJob(job, {
        actPath,
        baseCommit,
        branch: initial.branch,
        commit: initial.commit,
        containerDaemonSocket: capacity.containerDaemonSocket,
        dockerHost: capacity.dockerHost,
        dryRun: options.dryRun,
        hostDockerArchitecture: capacity.architecture,
        repoRoot,
        runId,
        runRoot,
        stateRoot,
        workflowDigest,
      }),
    onEvent(event) {
      if (event.type === 'start') console.log(`[local-ci] START ${event.job.id}`);
      else if (event.type === 'success') {
        console.log(`[local-ci] PASS  ${event.job.id} ${formatDuration(event.value.durationMs)}`);
      } else if (event.type === 'failed') {
        console.error(`[local-ci] FAIL  ${event.job.id}: ${event.error.message}`);
      } else if (event.type === 'blocked') {
        console.error(`[local-ci] BLOCK ${event.job.id}: dependency ${event.dependency} failed`);
      }
    },
  });

  const failed = [...results].filter(([, result]) => result.state !== 'success');
  if (failed.length > 0) {
    throw new Error(`Local Linux CI failed: ${failed.map(([id]) => id).join(', ')}`);
  }

  if (!authoritative) {
    console.log('[local-ci] Diagnostic run passed. No push-authorizing receipt was written.');
    return;
  }

  const final = await repositoryState(repoRoot);
  const [finalWorkflowDigest, finalRunnerDigest, committedWorkflowDigest, committedRunnerDigest] =
    await Promise.all([
      digestWorktree(repoRoot, WORKFLOW_PATHS),
      digestWorktree(repoRoot, RUNNER_PATHS),
      digestRef(repoRoot, initial.commit, WORKFLOW_PATHS),
      digestRef(repoRoot, initial.commit, RUNNER_PATHS),
    ]);
  if (!final.clean || final.commit !== initial.commit || final.tree !== initial.tree) {
    throw new Error('Repository state changed during the gate; refusing to write a receipt.');
  }
  if (
    workflowDigest !== finalWorkflowDigest ||
    workflowDigest !== committedWorkflowDigest ||
    runnerDigest !== finalRunnerDigest ||
    runnerDigest !== committedRunnerDigest
  ) {
    throw new Error(
      'Workflow or runner digest changed during the gate; refusing to write a receipt.',
    );
  }

  await writeReceiptAtomic(repoRoot, {
    schema: RECEIPT_SCHEMA,
    status: 'success',
    commit: initial.commit,
    tree: initial.tree,
    platform: 'linux/amd64',
    hostDockerArchitecture: capacity.architecture,
    engine: `act/${ACT_VERSION}`,
    workflowDigest,
    runnerDigest,
    jobs: FULL_GATE_JOB_IDS,
    completedAt: new Date().toISOString(),
    runId,
  });
  console.log(`[local-ci] PASS receipt written for ${initial.commit}`);
}

main().catch((error) => {
  console.error(`[local-ci] ${error.message}`);
  process.exitCode = 1;
});
