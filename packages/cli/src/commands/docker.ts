import { Command } from 'commander';
import { spawn, execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import { raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { isJson, isQuiet } from '../lib/cli-context.js';

const EDGEBASE_CONFIG_FILES = ['edgebase.config.ts', 'edgebase.config.js'];
const SELF_HOSTING_GUIDE_URL = 'https://edgebase.fun/docs/getting-started/self-hosting';

interface DockerProcessResult {
  stdout: string;
  stderr: string;
}

function extractCommandFailure(error: unknown): { message: string; stdout?: string; stderr?: string } {
  if (!(error instanceof Error)) {
    return { message: 'Command failed for an unknown reason.' };
  }

  const execError = error as Error & { stderr?: string | Buffer; stdout?: string | Buffer };
  const stderr = typeof execError.stderr === 'string'
    ? execError.stderr.trim()
    : Buffer.isBuffer(execError.stderr)
      ? execError.stderr.toString('utf-8').trim()
      : undefined;
  const stdout = typeof execError.stdout === 'string'
    ? execError.stdout.trim()
    : Buffer.isBuffer(execError.stdout)
      ? execError.stdout.toString('utf-8').trim()
      : undefined;

  return {
    message: stderr || stdout || error.message,
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {}),
  };
}

async function runDockerProcess(
  args: string[],
  options: { cwd?: string; inheritOutput?: boolean },
): Promise<DockerProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, {
      cwd: options.cwd,
      stdio: options.inheritOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    if (!options.inheritOutput) {
      child.stdout?.on('data', (chunk: string | Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: string | Buffer) => {
        stderr += chunk.toString();
      });
    }

    const signalForwarders: Array<[NodeJS.Signals, () => void]> = [];
    if (options.inheritOutput) {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        const forward = () => child.kill(signal);
        signalForwarders.push([signal, forward]);
        process.on(signal, forward);
      }
    }

    const cleanup = () => {
      for (const [signal, forward] of signalForwarders) {
        process.off(signal, forward);
      }
    };

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    child.on('exit', (code) => {
      cleanup();
      if (code === 0) {
        resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      const error = new Error(stderr.trim() || stdout.trim() || `docker ${args[0]} failed.`);
      Object.assign(error, { stdout, stderr, code });
      reject(error);
    });
  });
}

function ensureDockerAvailable(): void {
  try {
    execSync('docker --version', { stdio: 'ignore' });
  } catch {
    raiseCliError({
      code: 'docker_unavailable',
      message: 'Docker is not installed or not running.',
      hint: 'Install Docker Desktop or start the Docker daemon before retrying.',
      details: {
        installUrl: 'https://docs.docker.com/get-docker/',
      },
    });
  }
}

function assertImageExists(tag: string): void {
  try {
    execFileSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' });
  } catch {
    raiseCliError({
      code: 'docker_image_not_found',
      message: `Docker image '${tag}' not found.`,
      hint: 'Run `npx edgebase docker build` first.',
      details: { tag },
    });
  }
}

function hasEdgeBaseConfig(dir: string): boolean {
  return EDGEBASE_CONFIG_FILES.some((name) => existsSync(resolve(dir, name)));
}

function hasEdgeBaseCliScript(script: string): boolean {
  return /(^|\s)(npx\s+)?edgebase\b/.test(script) || script.includes('packages/cli/dist/index.js');
}

function hasEdgeBasePackageMarker(dir: string): boolean {
  const packageJsonPath = resolve(dir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const scripts = pkg.scripts ?? {};
    const dependencies = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if (Object.values(scripts).some((value) => typeof value === 'string' && hasEdgeBaseCliScript(value))) {
      return true;
    }

    return ['edgebase', '@edgebase/cli', '@edgebase/shared'].some(
      (name) => typeof dependencies[name] === 'string',
    );
  } catch {
    return false;
  }
}

function findProjectRoot(startDir = resolve('.')): string {
  let dir = startDir;
  while (true) {
    if (existsSync(resolve(dir, 'Dockerfile'))) {
      return dir;
    }
    if (hasEdgeBaseConfig(dir) || hasEdgeBasePackageMarker(dir)) {
      return dir;
    }

    const parent = resolve(dir, '..');
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return startDir;
}

function buildDockerBuildArgs(options: { tag: string; cache: boolean }): string[] {
  const args = ['build', '-t', options.tag];
  if (!options.cache) {
    args.push('--no-cache');
  }
  args.push('.');
  return args;
}

function buildDockerRunArgs(options: {
  tag: string;
  port: string;
  volume: string;
  detach: boolean;
  name: string;
  envFile?: string;
}): string[] {
  const args = [
    'run',
    '--name', options.name,
    '-p', `${options.port}:8787`,
    '-v', `${options.volume}:/data`,
    '--restart', 'unless-stopped',
  ];

  if (options.envFile) {
    args.push('--env-file', options.envFile);
  }

  if (options.detach) {
    args.push('-d');
  }

  args.push(options.tag);
  return args;
}

function ensureReleaseEnvFile(projectDir: string, envFile?: string): {
  envFile?: string;
  generatedEnvFile: boolean;
} {
  if (envFile) {
    return { envFile, generatedEnvFile: false };
  }

  const envReleasePath = resolve(projectDir, '.env.release');
  if (existsSync(envReleasePath)) {
    if (!isQuiet()) {
      console.log(chalk.dim(`  Using ${envReleasePath}`));
    }
    return { envFile: envReleasePath, generatedEnvFile: false };
  }

  const secrets = [
    '# EdgeBase Production Environment Variables',
    '# Auto-generated by `npx edgebase docker run`. Keep this file secret.',
    '',
    `JWT_USER_SECRET=${randomBytes(32).toString('hex')}`,
    `JWT_ADMIN_SECRET=${randomBytes(32).toString('hex')}`,
  ].join('\n');
  writeFileSync(envReleasePath, secrets + '\n');
  chmodSync(envReleasePath, 0o600);

  if (!isQuiet()) {
    console.log(chalk.green('✓'), '.env.release created with auto-generated JWT secrets');
    console.log(chalk.dim('  Add SERVICE_KEY if you need Admin SDK access.'));
  }

  return { envFile: envReleasePath, generatedEnvFile: true };
}

function printSelfHostingGuide(): void {
  console.log(chalk.yellow('📋 Self-hosting tips:'));
  console.log(chalk.dim('  • Backup:  docker volume inspect edgebase-data'));
  console.log(chalk.dim('  • Logs:    docker logs -f edgebase'));
  console.log(chalk.dim('  • Stop:    docker stop edgebase'));
  console.log(chalk.dim('  • HTTPS:   Use Caddy or Nginx as reverse proxy'));
  console.log(chalk.dim(`  • Guide:   ${SELF_HOSTING_GUIDE_URL}`));
}

export const _internals = {
  findProjectRoot,
  buildDockerBuildArgs,
  buildDockerRunArgs,
};

export const dockerCommand = new Command('docker')
  .description('Docker self-hosting commands');

dockerCommand
  .command('build')
  .description('Build EdgeBase Docker image')
  .option('-t, --tag <tag>', 'Image tag', 'edgebase:latest')
  .option('--no-cache', 'Build without cache')
  .action(async (options: { tag: string; cache: boolean }) => {
    const projectDir = findProjectRoot();
    const dockerfilePath = resolve(projectDir, 'Dockerfile');
    if (!existsSync(dockerfilePath)) {
      raiseCliError({
        code: 'dockerfile_not_found',
        message: 'Dockerfile not found.',
        hint: 'Run the command from an EdgeBase project directory with a Dockerfile.',
      });
    }

    ensureDockerAvailable();

    const args = buildDockerBuildArgs(options);

    if (!isQuiet()) {
      console.log(chalk.blue('🐳 Building EdgeBase Docker image...'));
      console.log(chalk.dim(`  Tag: ${options.tag}`));
      console.log();
    }

    try {
      await runDockerProcess(args, {
        cwd: projectDir,
        inheritOutput: !isJson(),
      });
    } catch (error) {
      const failure = extractCommandFailure(error);
      raiseCliError({
        code: 'docker_build_failed',
        message: failure.message,
        hint: 'Inspect the Docker build context and Docker daemon logs, then retry.',
        details: {
          tag: options.tag,
          ...(failure.stderr ? { stderr: failure.stderr } : {}),
          ...(failure.stdout ? { stdout: failure.stdout } : {}),
        },
      });
    }

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        operation: 'build',
        tag: options.tag,
        projectDir,
      }));
      return;
    }

    console.log();
    console.log(chalk.green('✓ Docker image built successfully!'));
    console.log();
    console.log(chalk.dim('  Run with:'));
    console.log(`  ${chalk.cyan('npx edgebase docker run')}`);
    console.log(`  ${chalk.dim('or')}`);
    console.log(`  ${chalk.cyan(`docker run -p 8787:8787 -v edgebase-data:/data ${options.tag}`)}`);
  });

dockerCommand
  .command('run')
  .description('Run EdgeBase in a Docker container')
  .option('-t, --tag <tag>', 'Image tag', 'edgebase:latest')
  .option('-p, --port <port>', 'Host port', '8787')
  .option('-v, --volume <name>', 'Data volume name', 'edgebase-data')
  .option('-d, --detach', 'Run in background')
  .option('--name <name>', 'Container name', 'edgebase')
  .option('--env-file <path>', 'Path to environment variables file (e.g. .env)')
  .action(async (options: { tag: string; port: string; volume: string; detach: boolean; name: string; envFile?: string }) => {
    if (isJson() && !options.detach) {
      raiseNeedsInput({
        code: 'docker_detach_required',
        field: 'detach',
        message: 'Structured docker run output requires --detach so the CLI can return a stable JSON result.',
        hint: 'Rerun with --detach or omit --json to stream container output interactively.',
        choices: [
          {
            label: 'Run detached',
            value: 'detach',
            args: ['--detach'],
          },
        ],
      });
    }

    const projectDir = findProjectRoot();
    const envInfo = ensureReleaseEnvFile(projectDir, options.envFile);
    options.envFile = envInfo.envFile;

    ensureDockerAvailable();
    assertImageExists(options.tag);

    try {
      execFileSync('docker', ['rm', '-f', options.name], { stdio: 'ignore' });
    } catch {
      // container missing is fine
    }

    if (!isQuiet()) {
      console.log(chalk.blue('🐳 Starting EdgeBase container...'));
      console.log(chalk.dim(`  Image: ${options.tag}`));
      console.log(chalk.dim(`  Port:  ${options.port}:8787`));
      console.log(chalk.dim(`  Data:  ${options.volume}:/data`));
      if (options.envFile) {
        console.log(chalk.dim(`  Env:   ${options.envFile}`));
      }
      console.log();
    }

    const args = buildDockerRunArgs({
      tag: options.tag,
      port: options.port,
      volume: options.volume,
      detach: options.detach,
      name: options.name,
      envFile: options.envFile,
    });

    try {
      await runDockerProcess(args, {
        inheritOutput: !isJson(),
      });
    } catch (error) {
      const failure = extractCommandFailure(error);
      raiseCliError({
        code: 'docker_run_failed',
        message: failure.message,
        hint: 'Check the image tag, port/volume settings, and Docker logs, then retry.',
        details: {
          name: options.name,
          tag: options.tag,
          ...(failure.stderr ? { stderr: failure.stderr } : {}),
          ...(failure.stdout ? { stdout: failure.stdout } : {}),
        },
      });
    }

    const dashboardUrl = `http://localhost:${options.port}/admin`;
    const healthUrl = `http://localhost:${options.port}/api/health`;

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        operation: 'run',
        detached: true,
        name: options.name,
        tag: options.tag,
        port: options.port,
        volume: options.volume,
        envFile: options.envFile,
        generatedEnvFile: envInfo.generatedEnvFile,
        dashboardUrl,
        healthUrl,
      }));
      return;
    }

    if (options.detach) {
      console.log(chalk.green('✓ EdgeBase container started!'));
      console.log();
      console.log(chalk.dim('  Dashboard:'), chalk.cyan(dashboardUrl));
      console.log(chalk.dim('  Health:   '), chalk.cyan(healthUrl));
      console.log();
      printSelfHostingGuide();
    }
  });
