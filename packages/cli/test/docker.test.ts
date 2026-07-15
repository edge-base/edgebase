/**
 * Tests for CLI docker command — findProjectRoot, argument construction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { _internals, dockerCommand } from '../src/commands/docker.js';
import { buildManagedD1DatabaseName } from '../src/lib/managed-resource-names.js';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

let tmpDir: string;
const cliPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dockerfilePath = resolve(cliPackageDir, '..', '..', 'Dockerfile');
const tsxCommand = resolveTsxCommand();
const tsxExecOptions = /\.cmd$/i.test(tsxCommand.command) ? { shell: true as const } : {};

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-docker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. Docker build argument construction
// ======================================================================

describe('Docker build argument construction', () => {
  it('forwards arbitrary container environment variables to Wrangler', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf-8');

    expect(dockerfile).toContain('ENV CLOUDFLARE_INCLUDE_PROCESS_ENV=true');
    expect(dockerfile).toContain('ENV EDGEBASE_RUNTIME_MODE=self-hosted');
    expect(dockerfile).toContain('export EDGEBASE_RUNTIME_MODE=self-hosted');
    expect(dockerfile).toContain('rm -f /app/.dev.vars');
    expect(dockerfile).not.toContain('echo "JWT_USER_SECRET=${JWT_USER_SECRET}"');
  });

  it('builds basic docker build command', () => {
    const tag = 'edgebase:latest';
    const args = ['build', '-t', tag];
    args.push('.');

    expect(args).toEqual(['build', '-t', 'edgebase:latest', '.']);
  });

  it('includes --no-cache when cache disabled', () => {
    const tag = 'edgebase:latest';
    const cache = false;
    const args = ['build', '-t', tag];
    if (!cache) {
      args.push('--no-cache');
    }
    args.push('.');

    expect(args).toContain('--no-cache');
  });

  it('excludes --no-cache when cache enabled', () => {
    const tag = 'edgebase:latest';
    const cache = true;
    const args = ['build', '-t', tag];
    if (!cache) {
      args.push('--no-cache');
    }
    args.push('.');

    expect(args).not.toContain('--no-cache');
  });

  it('uses custom tag', () => {
    const tag = 'myorg/edgebase:v1.0';
    const args = ['build', '-t', tag, '.'];
    expect(args[2]).toBe('myorg/edgebase:v1.0');
  });

  it('exposes context-only preparation on the docker build command', () => {
    const buildCommand = dockerCommand.commands.find((command) => command.name() === 'build');

    expect(buildCommand?.options.some((option) => option.long === '--context-only')).toBe(true);
  });

  it('prepares a portable build context without invoking a Docker executable', { timeout: 60_000 }, () => {
    mkdirSync(join(tmpDir, 'functions'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'edgebase.config.ts'),
      'export default { databases: { shared: { tables: {} } } };\n',
    );
    writeFileSync(
      join(tmpDir, 'functions', 'health.ts'),
      "export async function GET() { return new Response('ok'); }\n",
    );
    writeFileSync(
      join(tmpDir, 'Dockerfile'),
      'FROM node:22\nCOPY .edgebase/targets/docker-app/ /app/\n',
    );

    const fakeBinDir = join(tmpDir, 'fake-bin');
    const dockerMarker = join(tmpDir, 'docker-was-invoked');
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      join(fakeBinDir, 'docker'),
      '#!/bin/sh\ntouch "$DOCKER_CALLED_MARKER"\nexit 97\n',
    );
    chmodSync(join(fakeBinDir, 'docker'), 0o755);

    const result = spawnSync(
      tsxCommand.command,
      [
        ...tsxCommand.argsPrefix,
        resolve(cliPackageDir, 'src', 'index.ts'),
        '--json',
        'docker',
        'build',
        '--context-only',
        '--tag',
        'example/edgebase:test',
      ],
      {
        cwd: tmpDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          PATH: `${fakeBinDir}:${process.env.PATH ?? ''}`,
          DOCKER_CALLED_MARKER: dockerMarker,
          NO_COLOR: '1',
        },
        stdio: 'pipe',
        ...tsxExecOptions,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      operation: string;
      tag: string;
      projectDir: string;
      contextDir: string;
    };
    expect(payload).toMatchObject({
      operation: 'build-context',
      tag: 'example/edgebase:test',
      contextDir: join(payload.projectDir, '.edgebase', 'targets', 'docker-context'),
    });
    expect(existsSync(dockerMarker)).toBe(false);
    expect(existsSync(join(payload.contextDir, 'Dockerfile'))).toBe(true);
    expect(existsSync(join(
      payload.contextDir,
      '.edgebase',
      'targets',
      'docker-app',
      'edgebase-app.json',
    ))).toBe(true);
  });

  it('creates a minimal docker build context with the bundled app payload', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22\nCOPY .edgebase/targets/docker-app/ ./\n');
    writeFileSync(join(tmpDir, '.dockerignore'), 'node_modules\n.edgebase\n');
    const bundleDir = join(tmpDir, '.edgebase', 'targets', 'docker-app');
    mkdirSync(join(bundleDir, '.edgebase', 'runtime', 'server', 'node_modules', '.pnpm', 'hono@1.0.0', 'node_modules'), {
      recursive: true,
    });
    writeFileSync(join(bundleDir, 'edgebase-app.json'), '{}\n');
    writeFileSync(join(bundleDir, '.edgebase', 'runtime', 'server', 'node_modules', '.pnpm', 'hono@1.0.0', 'node_modules', 'index.js'), 'export {};\n');
    symlinkSync('./.pnpm/hono@1.0.0/node_modules', join(bundleDir, '.edgebase', 'runtime', 'server', 'node_modules', 'hono'));
    mkdirSync(join(tmpDir, 'node_modules'), { recursive: true });
    writeFileSync(join(tmpDir, 'node_modules', 'ignored.txt'), 'ignore me\n');

    const contextDir = _internals.prepareDockerBuildContext(tmpDir, bundleDir);

    expect(existsSync(join(contextDir, 'Dockerfile'))).toBe(true);
    expect(readFileSync(join(contextDir, 'Dockerfile'), 'utf-8')).toContain('COPY .edgebase/targets/docker-app/ ./');
    const dockerignore = readFileSync(join(contextDir, '.dockerignore'), 'utf-8');
    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('.edgebase');
    expect(dockerignore).toContain('!.edgebase/targets/docker-app/**');
    expect(existsSync(join(contextDir, '.edgebase', 'targets', 'docker-app', 'edgebase-app.json'))).toBe(true);
    expect(existsSync(join(contextDir, '.edgebase', 'targets', 'docker-app', '.edgebase', 'runtime', 'server', 'node_modules', 'hono'))).toBe(true);
    expect(existsSync(join(contextDir, 'node_modules'))).toBe(false);
  });

  it('copies optional project docker-context support files into the synthetic context', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22\nCOPY entrypoint.mjs /app/entrypoint.mjs\n');
    const bundleDir = join(tmpDir, '.edgebase', 'targets', 'docker-app');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'edgebase-app.json'), '{}\n');
    mkdirSync(join(tmpDir, 'docker-context', 'scripts'), { recursive: true });
    writeFileSync(join(tmpDir, 'docker-context', 'entrypoint.mjs'), 'export {};\n');
    writeFileSync(join(tmpDir, 'docker-context', 'scripts', 'healthcheck.sh'), '#!/bin/sh\nexit 0\n');

    const contextDir = _internals.prepareDockerBuildContext(tmpDir, bundleDir);

    expect(readFileSync(join(contextDir, 'entrypoint.mjs'), 'utf-8')).toBe('export {};\n');
    expect(readFileSync(join(contextDir, 'scripts', 'healthcheck.sh'), 'utf-8')).toContain('exit 0');
  });

  it('keeps generated Docker context entries protected from docker-context overrides', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(join(tmpDir, '.dockerignore'), 'node_modules\n');
    const bundleDir = join(tmpDir, '.edgebase', 'targets', 'docker-app');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'edgebase-app.json'), '{"generated":true}\n');

    const projectContextDir = join(tmpDir, 'docker-context');
    mkdirSync(join(projectContextDir, '.edgebase', 'targets', 'docker-app'), { recursive: true });
    writeFileSync(join(projectContextDir, 'Dockerfile'), 'FROM malicious\n');
    writeFileSync(join(projectContextDir, '.dockerignore'), 'Dockerfile\n');
    writeFileSync(
      join(projectContextDir, '.edgebase', 'targets', 'docker-app', 'edgebase-app.json'),
      '{"generated":false}\n',
    );

    const contextDir = _internals.prepareDockerBuildContext(tmpDir, bundleDir);

    expect(readFileSync(join(contextDir, 'Dockerfile'), 'utf-8')).toBe('FROM node:22\n');
    expect(readFileSync(join(contextDir, '.dockerignore'), 'utf-8')).toContain('node_modules');
    expect(readFileSync(
      join(contextDir, '.edgebase', 'targets', 'docker-app', 'edgebase-app.json'),
      'utf-8',
    )).toBe('{"generated":true}\n');
  });

  it('adds managed D1 bindings to the Docker bundle wrangler config', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default { databases: { app: { tables: {} } } };\n');
    writeFileSync(
      join(tmpDir, 'wrangler.toml'),
      [
        'name = "docker-worker"',
        'main = ".edgebase/runtime/server/src/index.ts"',
        'compatibility_date = "2025-02-10"',
        '',
        '[[d1_databases]]',
        'binding = "AUTH_DB"',
        'database_name = "docker-worker-auth"',
        'database_id = "local"',
      ].join('\n'),
    );
    const bundleDir = join(tmpDir, '.edgebase', 'targets', 'docker-app');
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(bundleDir, 'wrangler.toml'), readFileSync(join(tmpDir, 'wrangler.toml'), 'utf-8'));

    _internals.finalizeDockerWrangler(tmpDir, bundleDir);

    const wranglerToml = readFileSync(join(bundleDir, 'wrangler.toml'), 'utf-8');
    expect(wranglerToml).toContain('binding = "AUTH_DB"');
    expect(wranglerToml).toContain('binding = "CONTROL_DB"');
    expect(wranglerToml).toContain('binding = "DB_D1_APP"');
    expect(wranglerToml).toContain(
      `database_name = "${buildManagedD1DatabaseName('docker-worker', 'db-app')}"`,
    );
    expect(wranglerToml).toContain('EDGEBASE_RUNTIME_MODE = "self-hosted"');
    expect(wranglerToml).toContain(
      'compatibility_flags = ["nodejs_compat", "nodejs_compat_populate_process_env"]',
    );
  });

  it('detects a responsive docker daemon via docker info', () => {
    const result = _internals.isDockerDaemonResponsive(() => Buffer.from('"27.0.0"\n'));
    expect(result).toBe(true);
  });

  it('treats docker daemon probe failures as unavailable', () => {
    const result = _internals.isDockerDaemonResponsive(() => {
      throw new Error('daemon not responding');
    });
    expect(result).toBe(false);
  });
});

// ======================================================================
// 2. Docker run argument construction
// ======================================================================

describe('Docker run argument construction', () => {
  it('allows slow NAS and emulated runtimes to complete bounded first startup', () => {
    expect(_internals.DOCKER_RUNTIME_HEALTH_TIMEOUT_MS).toBe(90_000);
    expect(_internals.DOCKER_RUNTIME_HEALTH_PROBE_TIMEOUT_MS).toBe(20_000);
  });

  it('builds basic docker run command', () => {
    const options = { tag: 'edgebase:latest', port: '8787', volume: 'edgebase-data', detach: false, name: 'edgebase' };
    const args = [
      'run',
      '--name', options.name,
      '-p', `${options.port}:8787`,
      '-v', `${options.volume}:/data`,
      '--restart', 'unless-stopped',
    ];
    args.push(options.tag);

    expect(args).toContain('--name');
    expect(args).toContain('edgebase');
    expect(args).toContain('-p');
    expect(args).toContain('8787:8787');
    expect(args).toContain('-v');
    expect(args).toContain('edgebase-data:/data');
    expect(args).toContain('--restart');
    expect(args).toContain('unless-stopped');
    expect(args[args.length - 1]).toBe('edgebase:latest');
  });

  it('includes --env-file when provided', () => {
    const args = [
      'run',
      '--name', 'edgebase',
      '-p', '8787:8787',
      '-v', 'edgebase-data:/data',
      '--restart', 'unless-stopped',
    ];

    const envFile = '.env';
    if (envFile) {
      args.push('--env-file', envFile);
    }

    expect(args).toContain('--env-file');
    expect(args).toContain('.env');
  });

  it('excludes --env-file when not provided', () => {
    const args = [
      'run',
      '--name', 'edgebase',
      '-p', '8787:8787',
      '-v', 'edgebase-data:/data',
      '--restart', 'unless-stopped',
    ];

    const envFile: string | undefined = undefined;
    if (envFile) {
      args.push('--env-file', envFile);
    }

    expect(args).not.toContain('--env-file');
  });

  it('includes -d flag when detach is true', () => {
    const args: string[] = ['run'];
    const detach = true;
    if (detach) {
      args.push('-d');
    }

    expect(args).toContain('-d');
  });

  it('custom port mapping', () => {
    const port = '3000';
    const portMapping = `${port}:8787`;
    expect(portMapping).toBe('3000:8787');
  });

  it('custom volume name', () => {
    const volume = 'my-custom-data';
    const volumeMapping = `${volume}:/data`;
    expect(volumeMapping).toBe('my-custom-data:/data');
  });
});

// ======================================================================
// 3. Dockerfile detection
// ======================================================================

describe('Dockerfile detection', () => {
  it('detects Dockerfile in project directory', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22');
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(true);
  });

  it('detects missing Dockerfile', () => {
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(false);
  });

  it('bootstraps writable persistence before dropping to the edgebase user', () => {
    const dockerfile = readFileSync(dockerfilePath, 'utf-8');

    expect(dockerfile).toContain('edgebase-entrypoint.sh');
    expect(dockerfile).toContain('chown -R edgebase:edgebase "${PERSIST_DIR}" /home/edgebase/.config');
    expect(dockerfile).toContain('exec su -s /bin/sh edgebase -c');
    expect(dockerfile).toContain('exec wrangler dev --config "$WRANGLER_CONFIG"');
    expect(dockerfile).toContain('--show-interactive-dev-session=false');
    expect(dockerfile).toContain('> /usr/local/bin/edgebase-entrypoint.sh && chmod +x');
    expect(dockerfile).toContain('USER root');
  });

  it('detects edgebase.config.ts as a project root marker', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');
    expect(existsSync(join(tmpDir, 'edgebase.config.ts'))).toBe(true);
  });
});

// ======================================================================
// 4. findProjectRoot traversal logic
// ======================================================================

describe('findProjectRoot traversal logic', () => {
  it('finds Dockerfile in current directory', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22');
    expect(_internals.findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds edgebase.config.ts in current directory', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');
    expect(_internals.findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds Dockerfile in parent directory', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22');
    const childDir = join(tmpDir, 'src', 'commands');
    mkdirSync(childDir, { recursive: true });

    expect(_internals.findProjectRoot(childDir)).toBe(tmpDir);
  });

  it('skips unrelated package.json files and keeps searching for an EdgeBase root', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');
    const childDir = join(tmpDir, 'packages', 'feature');
    mkdirSync(childDir, { recursive: true });
    writeFileSync(join(childDir, 'package.json'), '{"name":"feature"}');

    expect(_internals.findProjectRoot(childDir)).toBe(tmpDir);
  });

  it('accepts edgebase CLI scripts as a fallback root marker', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'npx edgebase dev' } }, null, 2),
    );

    expect(_internals.findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('Dockerfile takes precedence over other EdgeBase project markers at same level', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:22');
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');

    const result = _internals.findProjectRoot(tmpDir);
    expect(result).toBe(tmpDir);
  });
});
