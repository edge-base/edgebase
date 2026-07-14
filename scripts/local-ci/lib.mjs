import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { filterMutationTargets } from '../../packages/server/mutation-targets.mjs';
import { ACT_DOWNLOADS, ACT_VERSION, RECEIPT_SCHEMA, receiptPath, stateDir } from './config.mjs';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const result = {
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (result.code === 0 || options.allowFailure) resolve(result);
      else {
        const message = result.stderr.toString().trim() || result.stdout.toString().trim();
        const error = new Error(`${command} ${args.join(' ')} failed (${result.code}): ${message}`);
        error.result = result;
        reject(error);
      }
    });
  });
}

export async function git(repoRoot, args, options = {}) {
  const result = await run('git', args, { cwd: repoRoot, ...options });
  return result.stdout.toString().trim();
}

export function mutationFileList(diffOutput) {
  const files = diffOutput
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter((file) => /^packages\/server\/src\/lib\/.*\.ts$/.test(file))
    .map((file) => file.slice('packages/server/'.length));
  if (files.some((file) => file.includes(','))) {
    throw new Error('Mutation file paths cannot contain commas.');
  }
  return filterMutationTargets(files).join(',');
}

export async function changedServerLibFiles(repoRoot, baseCommit, commit) {
  const diff = await git(repoRoot, [
    'diff',
    '--name-only',
    baseCommit,
    commit,
    '--',
    'packages/server/src/lib',
  ]);
  return mutationFileList(diff);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(absolute)));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

export async function expandWorktreePaths(repoRoot, pathSpecs) {
  const result = [];
  for (const spec of pathSpecs) {
    const absolute = path.join(repoRoot, spec);
    try {
      const details = await stat(absolute);
      if (details.isDirectory()) result.push(...(await listFiles(absolute)));
      else if (details.isFile()) result.push(absolute);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return result.map((file) => path.relative(repoRoot, file)).sort();
}

export async function digestWorktree(repoRoot, pathSpecs) {
  const hash = createHash('sha256');
  for (const file of await expandWorktreePaths(repoRoot, pathSpecs)) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(path.join(repoRoot, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function digestRef(repoRoot, ref, pathSpecs) {
  const listing = await run(
    'git',
    ['ls-tree', '-r', '--name-only', '-z', ref, '--', ...pathSpecs],
    {
      cwd: repoRoot,
    },
  );
  const files = listing.stdout.toString().split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const contents = await run('git', ['show', `${ref}:${file}`], { cwd: repoRoot });
    hash.update(file);
    hash.update('\0');
    hash.update(contents.stdout);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function repositoryState(repoRoot) {
  const [commit, tree, branch, status] = await Promise.all([
    git(repoRoot, ['rev-parse', 'HEAD']),
    git(repoRoot, ['rev-parse', 'HEAD^{tree}']),
    git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
  ]);
  return { commit, tree, branch, clean: status === '', status };
}

export async function writeReceiptAtomic(repoRoot, receipt) {
  const destination = receiptPath(repoRoot);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
}

export async function removeReceipt(repoRoot) {
  try {
    await unlink(receiptPath(repoRoot));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function readReceipt(repoRoot) {
  return JSON.parse(await readFile(receiptPath(repoRoot), 'utf8'));
}

export function validateReceiptShape(receipt, expected) {
  const errors = [];
  if (receipt.schema !== RECEIPT_SCHEMA) errors.push(`receipt schema must be ${RECEIPT_SCHEMA}`);
  if (receipt.status !== 'success') errors.push('receipt status is not success');
  if (receipt.commit !== expected.commit)
    errors.push('receipt commit does not match pushed commit');
  if (receipt.tree !== expected.tree) errors.push('receipt tree does not match pushed commit');
  if (receipt.platform !== 'linux/amd64') errors.push('receipt platform is not linux/amd64');
  if (receipt.engine !== `act/${ACT_VERSION}`)
    errors.push(`receipt engine is not act/${ACT_VERSION}`);
  if (receipt.workflowDigest !== expected.workflowDigest)
    errors.push('public workflow digest changed');
  if (receipt.runnerDigest !== expected.runnerDigest) errors.push('local runner digest changed');
  const actualJobs = Array.isArray(receipt.jobs) ? receipt.jobs : [];
  if (JSON.stringify(actualJobs) !== JSON.stringify(expected.jobs)) {
    errors.push('receipt job set does not match the required full gate');
  }
  return errors;
}

export function parsePrePushInput(input) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(/\s+/);
      if (fields.length !== 4) throw new Error(`Invalid pre-push input: ${line}`);
      const [localRef, localSha, remoteRef, remoteSha] = fields;
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

export async function installAct(repoRoot) {
  const key = `${process.platform}-${process.arch}`;
  const download = ACT_DOWNLOADS[key];
  if (!download) throw new Error(`act ${ACT_VERSION} is not configured for ${key}.`);

  const root = stateDir(repoRoot);
  const binDir = path.join(root, 'bin');
  const downloadsDir = path.join(root, 'downloads');
  const binary = path.join(binDir, 'act');
  await mkdir(binDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const existing = await run(binary, ['--version'], { allowFailure: true }).catch(() => null);
  if (existing?.code === 0 && existing.stdout.toString().includes(ACT_VERSION)) return binary;

  const archive = path.join(downloadsDir, download.archive);
  await run('curl', [
    '--proto',
    '=https',
    '--tlsv1.2',
    '--fail',
    '--location',
    '--retry',
    '3',
    '--output',
    archive,
    `https://github.com/nektos/act/releases/download/v${ACT_VERSION}/${download.archive}`,
  ]);
  const actual = sha256(await readFile(archive));
  if (actual !== download.sha256) {
    await unlink(archive);
    throw new Error(
      `act archive checksum mismatch: expected ${download.sha256}, received ${actual}`,
    );
  }
  await run('tar', ['-xzf', archive, '-C', binDir, 'act']);
  await chmod(binary, 0o755);
  const verified = await run(binary, ['--version']);
  if (!verified.stdout.toString().includes(ACT_VERSION)) {
    throw new Error(`Installed act version did not match ${ACT_VERSION}.`);
  }
  return binary;
}

export function schedulerCapacity(cpus, memoryGiB) {
  // Docker reports slightly less than its configured whole-GiB allocation.
  // One scheduling point represents roughly two GiB. Resource weights still
  // size each isolated job, but the authoritative gate deliberately starts
  // only one public CI job at a time.
  const maxWeight = Math.max(
    1,
    Math.min(8, Math.floor(Number(cpus)), Math.round(Number(memoryGiB) / 2)),
  );
  return {
    maxWeight,
    maxJobs: 1,
  };
}

export async function dockerCapacity(repoRoot) {
  const [result, endpoint] = await Promise.all([
    run('docker', ['info', '--format', '{{json .}}'], { cwd: repoRoot }),
    run('docker', ['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}'], {
      cwd: repoRoot,
    }),
  ]);
  const info = JSON.parse(result.stdout.toString());
  if (info.OSType !== 'linux')
    throw new Error(`Docker server must be Linux, received ${info.OSType}.`);
  const memoryGiB = Number(info.MemTotal) / 1024 ** 3;
  const { maxJobs, maxWeight } = schedulerCapacity(info.NCPU, memoryGiB);
  return {
    architecture: info.Architecture,
    containerDaemonSocket:
      process.platform === 'linux' ? endpoint.stdout.toString().trim() : '/var/run/docker.sock',
    dockerHost: endpoint.stdout.toString().trim(),
    cpus: Number(info.NCPU),
    memoryGiB,
    maxWeight,
    maxJobs,
  };
}

export async function ensureDockerImages(repoRoot, images) {
  for (const image of images) {
    const present = await run('docker', ['image', 'inspect', image], {
      cwd: repoRoot,
      allowFailure: true,
    });
    if (present.code === 0) continue;
    await run('docker', ['pull', '--platform', 'linux/amd64', image], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }
}
