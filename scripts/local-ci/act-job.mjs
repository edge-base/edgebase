import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ACT_RUNNER_IMAGE, POSTGRES_IMAGE, SEMGREP_IMAGE } from './config.mjs';
import { run, sha256 } from './lib.mjs';
import { renderStandaloneWorkflow } from './workflow.mjs';

function memoryLimit(weight) {
  return { 1: '2g', 2: '3g', 3: '5g', 4: '7g' }[weight] ?? '2g';
}

export function needsAmd64EmulationLimit(architecture) {
  return !['amd64', 'x86_64'].includes(architecture);
}

function eventPayload(job, context) {
  return {
    ref: `refs/heads/${context.branch}`,
    before: context.baseCommit,
    after: context.commit,
    repository: {
      full_name: 'edge-base/edgebase',
      default_branch: 'main',
    },
    pull_request: {
      number: 0,
      head: {
        ref: context.branch,
        sha: context.commit,
        repo: { full_name: 'edge-base/edgebase', fork: false },
      },
      base: {
        ref: 'main',
        sha: context.baseCommit,
        repo: { full_name: 'edge-base/edgebase', fork: false },
      },
    },
  };
}

async function streamProcess(command, args, options) {
  await mkdir(path.dirname(options.logPath), { recursive: true });
  const log = await open(options.logPath, 'w');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutCarry = '';
    let stderrCarry = '';
    const consume = (chunk, streamName) => {
      log.write(chunk);
      let text = (streamName === 'stdout' ? stdoutCarry : stderrCarry) + chunk.toString();
      const lines = text.split('\n');
      const carry = lines.pop();
      if (streamName === 'stdout') stdoutCarry = carry;
      else stderrCarry = carry;
      for (const line of lines) process.stdout.write(`[${options.jobId}] ${line}\n`);
    };
    child.stdout.on('data', (chunk) => consume(chunk, 'stdout'));
    child.stderr.on('data', (chunk) => consume(chunk, 'stderr'));
    child.on('error', reject);
    child.on('close', async (code, signal) => {
      if (stdoutCarry) process.stdout.write(`[${options.jobId}] ${stdoutCarry}\n`);
      if (stderrCarry) process.stdout.write(`[${options.jobId}] ${stderrCarry}\n`);
      await log.close();
      if (code === 0) resolve();
      else reject(new Error(`${options.jobId} failed with ${signal ?? `exit ${code}`}`));
    });
  });
}

export async function runActJob(job, context) {
  const jobRoot = path.join(context.runRoot, 'jobs', job.id);
  const workflowPath = path.join(jobRoot, 'workflow.yml');
  const eventPath = path.join(jobRoot, 'event.json');
  const home = path.join(jobRoot, 'home');
  const cache = path.join(context.stateRoot, 'cache', context.workflowDigest, job.id);
  const pnpmStore = path.join(cache, 'pnpm-store');
  const network = `edgebase-lci-${sha256(`${context.runId}:${job.id}`).slice(0, 20)}`;
  const source = await readFile(path.join(context.repoRoot, job.workflow), 'utf8');
  await mkdir(home, { recursive: true });
  await mkdir(cache, { recursive: true });
  await mkdir(pnpmStore, { recursive: true });
  await writeFile(
    workflowPath,
    renderStandaloneWorkflow(source, job.sourceJob, job.id, {
      dryRun: context.dryRun,
      jobContainerImage: ACT_RUNNER_IMAGE,
      postgresImage: POSTGRES_IMAGE,
      semgrepImage: SEMGREP_IMAGE,
    }),
  );
  await writeFile(eventPath, `${JSON.stringify(eventPayload(job, context), null, 2)}\n`);

  await run('docker', ['network', 'create', '--driver', 'bridge', network], {
    cwd: context.repoRoot,
  });

  const args = [
    job.event,
    '--workflows',
    workflowPath,
    '--job',
    job.sourceJob,
    '--directory',
    context.repoRoot,
    '--eventpath',
    eventPath,
    '--defaultbranch',
    'main',
    '--container-architecture',
    'linux/amd64',
    '--container-daemon-socket',
    context.containerDaemonSocket,
    '--platform',
    `ubuntu-latest=${ACT_RUNNER_IMAGE}`,
    '--network',
    network,
    '--action-cache-path',
    path.join(cache, 'actions'),
    '--cache-server-path',
    path.join(cache, 'packages'),
    '--env-file',
    '/dev/null',
    '--secret-file',
    '/dev/null',
    '--var-file',
    '/dev/null',
    '--input-file',
    '/dev/null',
    '--env',
    'LOCAL_CI=1',
    '--env',
    'CI=true',
    ...(job.id === 'mutation-test'
      ? ['--env', `EDGEBASE_LOCAL_CI_MUTATE_FILES=${context.mutationFiles}`]
      : []),
    ...(job.id === 'docker-smoke-linux'
      ? ['--env', `EDGEBASE_DOCKER_SMOKE_NETWORK=${network}`]
      : []),
    '--env',
    'npm_config_store_dir=/root/.local/share/pnpm/store',
    ...(needsAmd64EmulationLimit(context.hostDockerArchitecture)
      ? ['--env', 'GOMAXPROCS=1', '--env', 'EDGEBASE_LOCAL_CI_EMULATED_AMD64=1']
      : []),
    '--container-options',
    [
      `--cpus=${job.weight}`,
      `--memory=${memoryLimit(job.weight)}`,
      '--pids-limit=4096',
      `--mount=type=bind,source=${pnpmStore},target=/root/.local/share/pnpm/store`,
      job.id === 'docker-smoke-linux' ? '--privileged' : '',
    ]
      .filter(Boolean)
      .join(' '),
    '--concurrent-jobs',
    '1',
    '--pull=false',
    '--rm',
    '--use-new-action-cache',
  ];
  for (const [key, value] of Object.entries(job.matrix)) args.push('--matrix', `${key}:${value}`);
  if (context.dryRun) args.push('--dryrun');

  const startedAt = Date.now();
  try {
    await streamProcess(context.actPath, args, {
      cwd: context.repoRoot,
      env: {
        ...process.env,
        DOCKER_HOST: context.dockerHost,
        HOME: home,
        XDG_CACHE_HOME: path.join(home, '.cache'),
      },
      jobId: job.id,
      logPath: path.join(context.runRoot, 'logs', `${job.id}.log`),
    });
    return { durationMs: Date.now() - startedAt };
  } finally {
    await run('docker', ['network', 'rm', network], {
      cwd: context.repoRoot,
      allowFailure: true,
    });
    await rm(path.join(home, '.cache', 'act'), { recursive: true, force: true });
  }
}
