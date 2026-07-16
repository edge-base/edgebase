import { Command } from 'commander';
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
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
import {
  generateTempWranglerToml,
  RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS,
} from '../lib/deploy-shared.js';
import { loadConfigSafe } from '../lib/load-config.js';
import { resolveLocalDevBindings } from '../lib/project-runtime.js';

const EDGEBASE_CONFIG_FILES = ['edgebase.config.ts', 'edgebase.config.js'];
const SELF_HOSTING_GUIDE_URL = 'https://edgebase.fun/docs/getting-started/self-hosting';
const RELEASE_ENV_HEADER = '# EdgeBase Production Environment Variables';
const DOCKER_RUNTIME_HEALTH_TIMEOUT_MS = 90_000;
const DOCKER_RUNTIME_HEALTH_PROBE_TIMEOUT_MS = 20_000;
const PROTECTED_ENTRYPOINT_PATH = '/usr/local/bin/edgebase-entrypoint.sh';
const PROTECTED_ENTRYPOINT_MODULE = '/app/.edgebase/self-host/self-host-docker-entrypoint.mjs';
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

function dockerContainerExists(name: string): boolean {
  try {
    // `docker container inspect` matches by exact name or id and exits
    // non-zero when the container does not exist.
    execFileSync('docker', ['container', 'inspect', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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

interface DockerExecutionConfig {
  Entrypoint?: unknown;
  Cmd?: unknown;
}

function normalizeExecVector(value: unknown, context: string): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${context} must use JSON exec form.`);
  }
  return value as string[];
}

function consumesProtectedEntrypoint(config: DockerExecutionConfig): boolean {
  const entrypoint = normalizeExecVector(config.Entrypoint, 'Docker ENTRYPOINT');
  const command = normalizeExecVector(config.Cmd, 'Docker CMD');
  const vector = entrypoint && entrypoint.length > 0 ? entrypoint : command;
  if (!vector) return false;
  return (vector.length === 1 && vector[0] === PROTECTED_ENTRYPOINT_PATH)
    || (vector.length === 2 && vector[0] === 'node' && vector[1] === PROTECTED_ENTRYPOINT_MODULE);
}

function dockerfileLogicalLines(source: string): string[] {
  const lines: string[] = [];
  let pending = '';
  for (const rawLine of source.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!pending && (!trimmed || trimmed.startsWith('#'))) continue;
    const continued = /\\\s*$/.test(trimmed);
    const part = trimmed.replace(/\\\s*$/, '').trim();
    pending = pending ? `${pending} ${part}` : part;
    if (!continued) {
      if (pending) lines.push(pending);
      pending = '';
    }
  }
  if (pending) throw new Error('Dockerfile ends with an unterminated continuation.');
  return lines;
}

function readDockerfileExecInstruction(
  value: string,
  context: 'ENTRYPOINT' | 'CMD',
): string[] {
  if (!value.startsWith('[')) {
    throw new Error(`Final-stage ${context} must use JSON exec form.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Final-stage ${context} is not valid JSON exec form.`, { cause: error });
  }
  return normalizeExecVector(parsed, `Final-stage ${context}`) ?? [];
}

function assertProtectedDockerfile(source: string): void {
  const lines = dockerfileLogicalLines(source);
  let sawFrom = false;
  let entrypoint: string[] | null = null;
  let command: string[] | null = null;
  for (const line of lines) {
    const instruction = /^([A-Za-z]+)\s+([\s\S]+)$/.exec(line);
    if (!instruction) continue;
    const name = instruction[1]?.toUpperCase();
    const value = instruction[2]?.trim() ?? '';
    if (name === 'FROM') {
      sawFrom = true;
      entrypoint = null;
      command = null;
      continue;
    }
    if (!sawFrom) continue;
    if (name === 'ENTRYPOINT') entrypoint = readDockerfileExecInstruction(value, 'ENTRYPOINT');
    if (name === 'CMD') command = readDockerfileExecInstruction(value, 'CMD');
  }
  if (!sawFrom) throw new Error('Dockerfile has no build stage.');
  if (!/\.edgebase\/targets\/docker-app(?:\/|\s)/.test(source)) {
    throw new Error('Dockerfile must consume the generated .edgebase/targets/docker-app bundle.');
  }
  if (!consumesProtectedEntrypoint({ Entrypoint: entrypoint, Cmd: command })) {
    throw new Error(
      `Final image execution must consume ${PROTECTED_ENTRYPOINT_PATH} `
        + `or node ${PROTECTED_ENTRYPOINT_MODULE} in JSON exec form.`,
    );
  }
}

function assertProtectedDockerImage(
  tag: string,
  runner: typeof execFileSync = execFileSync,
): void {
  const raw = runner(
    'docker',
    ['image', 'inspect', tag, '--format', '{{json .Config}}'],
    { encoding: 'utf-8', stdio: 'pipe' },
  );
  const config = JSON.parse(String(raw)) as DockerExecutionConfig;
  if (!consumesProtectedEntrypoint(config)) {
    throw new Error(`Docker image '${tag}' does not consume the protected self-host entrypoint.`);
  }
  runner('docker', [
    'run', '--rm', '--network', 'none', '--read-only',
    '--entrypoint', '/bin/sh', tag, '-c',
    `test -x ${PROTECTED_ENTRYPOINT_PATH} && test -f ${PROTECTED_ENTRYPOINT_MODULE}`,
  ], { stdio: 'ignore', timeout: 30_000 });
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

function buildSyntheticDockerignore(sourceDockerignore: string): string {
  const preservedRules = existsSync(sourceDockerignore)
    ? readFileSync(sourceDockerignore, 'utf-8').replace(/\s+$/, '')
    : '';

  const requiredIncludes = [
    '# Preserve the generated bundle in the synthetic Docker context.',
    '!Dockerfile',
    '!.dockerignore',
    '!.edgebase',
    '!.edgebase/targets',
    '!.edgebase/targets/docker-app',
    '!.edgebase/targets/docker-app/**',
  ].join('\n');

  return preservedRules.length > 0
    ? `${preservedRules}\n\n${requiredIncludes}\n`
    : `${requiredIncludes}\n`;
}

function copyProjectDockerContextFiles(projectDir: string, contextDir: string): void {
  const sourceDir = resolve(projectDir, 'docker-context');
  if (!existsSync(sourceDir)) return;

  const reservedEntries = new Set(['dockerfile', '.dockerignore', '.edgebase']);
  for (const entry of readdirSync(sourceDir)) {
    if (reservedEntries.has(entry.toLowerCase())) continue;

    cpSync(join(sourceDir, entry), join(contextDir, entry), {
      recursive: true,
      force: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
}

function prepareDockerBuildContext(projectDir: string, dockerBundleDir: string): string {
  const contextDir = resolve(projectDir, '.edgebase', 'targets', 'docker-context');
  const contextBundleDir = join(contextDir, '.edgebase', 'targets', 'docker-app');
  const sourceDockerfile = resolve(projectDir, 'Dockerfile');
  const sourceDockerignore = resolve(projectDir, '.dockerignore');

  rmSync(contextDir, { recursive: true, force: true });
  mkdirSync(join(contextDir, '.edgebase', 'targets'), { recursive: true });
  copyFileSync(sourceDockerfile, join(contextDir, 'Dockerfile'));
  writeFileSync(join(contextDir, '.dockerignore'), buildSyntheticDockerignore(sourceDockerignore));
  cpSync(dockerBundleDir, contextBundleDir, {
    recursive: true,
    force: true,
    dereference: true,
  });
  copyProjectDockerContextFiles(projectDir, contextDir);

  return contextDir;
}

function finalizeDockerWrangler(projectDir: string, outputDir: string): void {
  const configFile = EDGEBASE_CONFIG_FILES
    .map((name) => join(projectDir, name))
    .find((path) => existsSync(path));
  if (!configFile) {
    throw new Error(`No EdgeBase config file found in ${projectDir}.`);
  }

  const config = loadConfigSafe(configFile, projectDir, {
    allowRegexFallback: false,
  }) as Record<string, unknown>;
  const wranglerPath = join(outputDir, 'wrangler.toml');
  const generatedPath = generateTempWranglerToml(wranglerPath, {
    bindings: resolveLocalDevBindings(config),
    triggerMode: 'preserve',
    runtimeMode: 'self-hosted',
    requiredCompatibilityFlags: RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS,
  });

  if (!generatedPath) return;

  writeFileSync(wranglerPath, readFileSync(generatedPath, 'utf-8'), 'utf-8');
  rmSync(generatedPath, { force: true });
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
  DOCKER_RUNTIME_HEALTH_TIMEOUT_MS,
  DOCKER_RUNTIME_HEALTH_PROBE_TIMEOUT_MS,
  findProjectRoot,
  buildDockerBuildArgs,
  buildDockerRunArgs,
  assertProtectedDockerfile,
  assertProtectedDockerImage,
  consumesProtectedEntrypoint,
  finalizeDockerWrangler,
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
  .option('--context-only', 'Prepare the portable Docker build context without invoking Docker')
  .action(async (options: { tag: string; cache: boolean; contextOnly?: boolean }) => {
    const projectDir = findProjectRoot();
    const dockerfilePath = resolve(projectDir, 'Dockerfile');
    if (!existsSync(dockerfilePath)) {
      raiseCliError({
        code: 'dockerfile_not_found',
        message: 'Dockerfile not found.',
        hint: 'Run the command from an EdgeBase project directory with a Dockerfile.',
      });
    }
    try {
      assertProtectedDockerfile(readFileSync(dockerfilePath, 'utf-8'));
    } catch (error) {
      raiseCliError({
        code: 'docker_entrypoint_unprotected',
        message: error instanceof Error ? error.message : String(error),
        hint: 'Use the protected EdgeBase Dockerfile contract; raw Wrangler/custom command images are unsupported by `edgebase docker build`.',
      });
    }

    if (!options.contextOnly) {
      ensureDockerAvailable();
    }

    let dockerBundle: ReturnType<typeof createAppBundle>;
    try {
      dockerBundle = createAppBundle(projectDir, {
        outputDir: join('.edgebase', 'targets', 'docker-app'),
        overwrite: true,
        portableDependencies: true,
        dependencyProfile: 'docker',
        stagedGenerationFinalizer(stagingDir) {
          finalizeDockerWrangler(projectDir, stagingDir);
        },
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

    if (options.contextOnly) {
      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          operation: 'build-context',
          tag: options.tag,
          projectDir,
          bundleDir: dockerBundle.outputDir,
          contextDir,
        }));
        return;
      }

      console.log(chalk.green('✓ Docker build context prepared successfully!'));
      console.log(chalk.dim(`  Bundle: ${dockerBundle.outputDir}`));
      console.log(chalk.dim(`  Context: ${contextDir}`));
      console.log();
      console.log(chalk.dim('  Build with:'));
      console.log(`  ${chalk.cyan(`docker build -t ${options.tag} ${contextDir}`)}`);
      return;
    }

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
      assertProtectedDockerImage(options.tag);
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
  .option('--replace', 'Replace an existing container with the same name (removes it first)')
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
    replace?: boolean;
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
      assertProtectedDockerImage(options.tag);
    } catch (error) {
      raiseCliError({
        code: 'docker_entrypoint_unprotected',
        message: error instanceof Error ? error.message : String(error),
        hint: 'Rebuild the image with `npx edgebase docker build`; raw/custom commands are not a protected EdgeBase runtime.',
      });
    }

    if (dockerContainerExists(options.name)) {
      if (options.replace) {
        try {
          execFileSync('docker', ['rm', '-f', options.name], { stdio: 'ignore' });
        } catch (error) {
          const failure = extractCommandFailure(error);
          raiseCliError({
            code: 'docker_container_replace_failed',
            message: `Failed to remove existing container "${options.name}": ${failure.message}`,
            hint: 'Remove it manually with `docker rm -f` and retry.',
          });
        }
      } else {
        raiseCliError({
          code: 'docker_container_exists',
          message: `A container named "${options.name}" already exists.`,
          hint: 'Stop and remove it, choose a different --name, or pass --replace to recreate it (this deletes the existing container).',
        });
      }
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

    const loopbackHost = '127.0.0.1';
    const dashboardUrl = `http://${loopbackHost}:${options.port}/admin`;
    const healthProtocol = envVars.LOCAL_PROTOCOL === 'https' ? 'https' : 'http';
    const healthUrl = `${healthProtocol}://${loopbackHost}:${options.port}/__edgebase/health`;
    const baseUrl = `http://${loopbackHost}:${options.port}`;

    const waitForHealthy = async (): Promise<void> => {
      // Large application bundles and emulated/NAS architectures can spend
      // well over 20 seconds in Wrangler startup before workerd is ready.
      // Keep the probe bounded, but do not report a healthy slow container as
      // failed while its first schema initialization is still progressing.
      const deadline = Date.now() + DOCKER_RUNTIME_HEALTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        try {
          const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(DOCKER_RUNTIME_HEALTH_PROBE_TIMEOUT_MS),
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
        // The container is always started with `docker run -d`, but the CLI
        // only returns immediately (vs. streaming logs) when the user passed
        // -d, so report that user-facing choice.
        detached: !!options.detach,
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
