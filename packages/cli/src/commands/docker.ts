import { Command } from 'commander';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import { raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { isJson, isNonInteractive, isQuiet } from '../lib/cli-context.js';
import { parseEnvFile } from '../lib/dev-sidecar.js';
import {
  ensureBootstrapAdmin,
  normalizeAdminEmail,
  promptValue,
  validateAdminEmail,
  type EnsureBootstrapAdminResult,
} from '../lib/admin-bootstrap.js';
import { createAppBundle } from '../lib/app-bundle.js';

const EDGEBASE_CONFIG_FILES = ['edgebase.config.ts', 'edgebase.config.js'];
const SELF_HOSTING_GUIDE_URL = 'https://edgebase.fun/docs/getting-started/self-hosting';
const RELEASE_ENV_HEADER = '# EdgeBase Production Environment Variables';
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
    execFileSync('docker', ['--version'], { stdio: 'ignore', timeout: 5_000 });
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

  if (!isDockerDaemonResponsive()) {
    raiseCliError({
      code: 'docker_daemon_unavailable',
      message: 'Docker is installed, but the Docker daemon is not responding.',
      hint: 'Start Docker Desktop and wait for the engine to become ready before retrying.',
    });
  }
}

function isDockerDaemonResponsive(
  runner: typeof execFileSync = execFileSync,
): boolean {
  try {
    runner('docker', ['info', '--format', '{{json .ServerVersion}}'], {
      stdio: 'ignore',
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
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

    return ['edgebase', '@edge-base/cli', '@edge-base/shared'].some(
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

function prepareDockerBuildContext(projectDir: string, dockerBundleDir: string): string {
  const contextDir = resolve(projectDir, '.edgebase', 'targets', 'docker-context');
  const contextBundleDir = join(contextDir, '.edgebase', 'targets', 'docker-app');
  const sourceDockerfile = resolve(projectDir, 'Dockerfile');
  const sourceDockerignore = resolve(projectDir, '.dockerignore');

  rmSync(contextDir, { recursive: true, force: true });
  mkdirSync(join(contextDir, '.edgebase', 'targets'), { recursive: true });
  copyFileSync(sourceDockerfile, join(contextDir, 'Dockerfile'));
  if (existsSync(sourceDockerignore)) {
    copyFileSync(sourceDockerignore, join(contextDir, '.dockerignore'));
  }
  cpSync(dockerBundleDir, contextBundleDir, {
    recursive: true,
    force: true,
    dereference: false,
    verbatimSymlinks: true,
  });

  return contextDir;
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

function ensureEnvFileSecrets(filePath: string): {
  created: boolean;
  addedKeys: string[];
} {
  const created = !existsSync(filePath);
  const vars = created ? {} : parseEnvFile(filePath);
  const additions: string[] = [];
  const addedKeys: string[] = [];

  if (created) {
    additions.push(
      RELEASE_ENV_HEADER,
      '# Auto-generated by `npx edgebase docker run`. Keep this file secret.',
      '',
    );
  }

  const managedSecrets: Array<[string, string]> = [
    ['JWT_USER_SECRET', randomBytes(32).toString('hex')],
    ['JWT_ADMIN_SECRET', randomBytes(32).toString('hex')],
    ['SERVICE_KEY', randomBytes(32).toString('hex')],
  ];

  for (const [key, generatedValue] of managedSecrets) {
    if (vars[key]) continue;
    additions.push(`${key}=${generatedValue}`);
    vars[key] = generatedValue;
    addedKeys.push(key);
  }

  if (created) {
    writeFileSync(filePath, additions.join('\n') + '\n');
    chmodSync(filePath, 0o600);
    return { created: true, addedKeys };
  }

  if (additions.length > 0) {
    const existing = readFileSync(filePath, 'utf-8');
    const separator = existing.endsWith('\n') ? '' : '\n';
    writeFileSync(filePath, `${existing}${separator}${additions.join('\n')}\n`);
    chmodSync(filePath, 0o600);
  }

  return { created: false, addedKeys };
}

function ensureReleaseEnvFile(projectDir: string, envFile?: string): {
  envFile?: string;
  generatedEnvFile: boolean;
  generatedKeys: string[];
} {
  if (envFile) {
    const ensured = ensureEnvFileSecrets(envFile);
    return {
      envFile,
      generatedEnvFile: ensured.created,
      generatedKeys: ensured.addedKeys,
    };
  }

  const envReleasePath = resolve(projectDir, '.env.release');
  const ensured = ensureEnvFileSecrets(envReleasePath);
  if (!isQuiet()) {
    console.log(chalk.dim(`  Using ${envReleasePath}`));
  }
  return {
    envFile: envReleasePath,
    generatedEnvFile: ensured.created,
    generatedKeys: ensured.addedKeys,
  };
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
  prepareDockerBuildContext,
  isDockerDaemonResponsive,
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

    let dockerBundle: ReturnType<typeof createAppBundle>;
    try {
      dockerBundle = createAppBundle(projectDir, {
        outputDir: join('.edgebase', 'targets', 'docker-app'),
        overwrite: true,
        portableDependencies: true,
        dependencyProfile: 'docker',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      raiseCliError({
        code: 'docker_bundle_failed',
        message,
        hint: 'Run the command from an EdgeBase app project with edgebase.config.ts, then retry `npx edgebase docker build`.',
      });
    }

    const args = buildDockerBuildArgs(options);
    const contextDir = prepareDockerBuildContext(projectDir, dockerBundle.outputDir);

    if (!isQuiet()) {
      console.log(chalk.blue('🐳 Building EdgeBase Docker image...'));
      console.log(chalk.dim(`  Tag: ${options.tag}`));
      console.log(chalk.dim(`  Bundle: ${dockerBundle.outputDir}`));
      console.log(chalk.dim(`  Context: ${contextDir}`));
      console.log();
    }

    try {
      await runDockerProcess(args, {
        cwd: contextDir,
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
        bundleDir: dockerBundle.outputDir,
        contextDir,
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
  .option('--bootstrap-admin-email <email>', 'Bootstrap admin email to ensure for this container')
  .option('--bootstrap-admin-password-file <path>', 'Read the bootstrap admin password from a file')
  .option('--bootstrap-admin-password-stdin', 'Read the bootstrap admin password from stdin')
  .action(async (options: {
    tag: string;
    port: string;
    volume: string;
    detach: boolean;
    name: string;
    envFile?: string;
    bootstrapAdminEmail?: string;
    bootstrapAdminPasswordFile?: string;
    bootstrapAdminPasswordStdin?: boolean;
  }) => {
    const projectDir = findProjectRoot();
    const envInfo = ensureReleaseEnvFile(projectDir, options.envFile);
    options.envFile = envInfo.envFile;
    let bootstrapAdminEmail = options.bootstrapAdminEmail
      ? normalizeAdminEmail(options.bootstrapAdminEmail)
      : '';

    if (!bootstrapAdminEmail) {
      if (process.stdin.isTTY && !isNonInteractive() && !isJson()) {
        bootstrapAdminEmail = normalizeAdminEmail(await promptValue('Bootstrap admin email: ', false, {
          field: 'bootstrapAdminEmail',
          hint: 'Rerun with --bootstrap-admin-email <email>.',
          message: 'A bootstrap admin email is required for Docker production runs.',
        }));
      } else {
        raiseNeedsInput({
          code: 'bootstrap_admin_email_required',
          field: 'bootstrapAdminEmail',
          message: 'A bootstrap admin email is required for Docker production runs.',
          hint: 'Provide --bootstrap-admin-email <email> when running non-interactively.',
        });
      }
    }
    validateAdminEmail(bootstrapAdminEmail);

    ensureDockerAvailable();
    assertImageExists(options.tag);

    try {
      execFileSync('docker', ['rm', '-f', options.name], { stdio: 'ignore' });
    } catch {
      // container missing is fine
    }

    const envVars = options.envFile ? parseEnvFile(options.envFile) : {};
    const serviceKey = envVars.SERVICE_KEY;
    if (!serviceKey) {
      raiseCliError({
        code: 'docker_service_key_missing',
        message: 'Docker runtime environment did not contain a SERVICE_KEY after secret setup.',
        hint: 'Check the env file and rerun `npx edgebase docker run`.',
      });
    }

    if (!isQuiet()) {
      console.log(chalk.blue('🐳 Starting EdgeBase container...'));
      console.log(chalk.dim(`  Image: ${options.tag}`));
      console.log(chalk.dim(`  Port:  ${options.port}:8787`));
      console.log(chalk.dim(`  Data:  ${options.volume}:/data`));
      if (options.envFile) {
        console.log(chalk.dim(`  Env:   ${options.envFile}`));
      }
      if (envInfo.generatedEnvFile || envInfo.generatedKeys.length > 0) {
        const label = envInfo.generatedEnvFile ? 'Created env file with' : 'Added';
        console.log(chalk.dim(`  ${label} managed secrets: ${envInfo.generatedKeys.join(', ')}`));
      }
      console.log();
    }

    const args = buildDockerRunArgs({
      tag: options.tag,
      port: options.port,
      volume: options.volume,
      detach: true,
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
    const baseUrl = `http://localhost:${options.port}`;

    const waitForHealthy = async (): Promise<void> => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(2_000),
          });
          if (response.ok) return;
        } catch {
          // Container still starting.
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      }
      raiseCliError({
        code: 'docker_health_timeout',
        message: 'Docker container started, but the EdgeBase runtime did not become healthy in time.',
        hint: `Check the container logs with \`docker logs ${options.name}\` and retry.`,
      });
    };

    await waitForHealthy();

    const bootstrapAdminResult: EnsureBootstrapAdminResult = await ensureBootstrapAdmin({
      url: baseUrl,
      serviceKey,
      email: bootstrapAdminEmail,
      passwordFile: options.bootstrapAdminPasswordFile,
      passwordStdin: options.bootstrapAdminPasswordStdin,
      emailPromptHint: 'Rerun with --bootstrap-admin-email <email>.',
      emailRequiredMessage: 'A bootstrap admin email is required for Docker production runs.',
      passwordPromptHint: 'Use --bootstrap-admin-password-file <path> or pipe the password with --bootstrap-admin-password-stdin in CI/CD.',
      passwordRequiredMessage: 'A bootstrap admin password is required to create the first admin account.',
    });

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
        bootstrapAdmin: bootstrapAdminResult.status,
      }));
      return;
    }

    console.log(chalk.green('✓ EdgeBase container started!'));
    if (bootstrapAdminResult.status === 'created') {
      console.log(chalk.green('✓'), `Bootstrap admin created for ${bootstrapAdminResult.admin.email}`);
    } else if (bootstrapAdminResult.status === 'already-configured') {
      console.log(chalk.green('✓'), `Bootstrap admin already configured for ${bootstrapAdminResult.admin.email}`);
    } else {
      const knownAdmins = bootstrapAdminResult.admins.map((admin) => admin.email).join(', ');
      console.log(chalk.yellow('⚠'), 'Admin bootstrap skipped because admin accounts already exist.');
      console.log(chalk.dim(`  Existing admins: ${knownAdmins}`));
      if (bootstrapAdminResult.requestedEmail) {
        console.log(chalk.dim(`  Requested bootstrap email: ${bootstrapAdminResult.requestedEmail}`));
      }
    }
    console.log();
    console.log(chalk.dim('  Admin:    '), chalk.cyan(dashboardUrl));
    console.log(chalk.dim('  Health:   '), chalk.cyan(healthUrl));
    console.log();
    printSelfHostingGuide();

    if (!options.detach) {
      console.log();
      console.log(chalk.dim('  Streaming container logs. Press Ctrl+C to stop viewing logs; the container will keep running.'));
      try {
        await runDockerProcess(['logs', '-f', options.name], {
          inheritOutput: true,
        });
      } catch {
        // Stopping log streaming should not be treated as a failed startup.
      }
    }
  });
