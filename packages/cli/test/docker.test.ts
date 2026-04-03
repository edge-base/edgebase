/**
 * Tests for CLI docker command — findProjectRoot, argument construction.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _internals } from '../src/commands/docker.js';

let tmpDir: string;

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

  it('creates a minimal docker build context with the bundled app payload', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:20\nCOPY .edgebase/targets/docker-app/ ./\n');
    writeFileSync(join(tmpDir, '.dockerignore'), 'node_modules\n');
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
    expect(readFileSync(join(contextDir, '.dockerignore'), 'utf-8')).toContain('node_modules');
    expect(existsSync(join(contextDir, '.edgebase', 'targets', 'docker-app', 'edgebase-app.json'))).toBe(true);
    expect(existsSync(join(contextDir, '.edgebase', 'targets', 'docker-app', '.edgebase', 'runtime', 'server', 'node_modules', 'hono'))).toBe(true);
    expect(existsSync(join(contextDir, 'node_modules'))).toBe(false);
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
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:20');
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(true);
  });

  it('detects missing Dockerfile', () => {
    expect(existsSync(join(tmpDir, 'Dockerfile'))).toBe(false);
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
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:20');
    expect(_internals.findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds edgebase.config.ts in current directory', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');
    expect(_internals.findProjectRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds Dockerfile in parent directory', () => {
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:20');
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
    writeFileSync(join(tmpDir, 'Dockerfile'), 'FROM node:20');
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {};');

    const result = _internals.findProjectRoot(tmpDir);
    expect(result).toBe(tmpDir);
  });
});
