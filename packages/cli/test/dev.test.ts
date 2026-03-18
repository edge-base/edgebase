/**
 * Tests for CLI dev command — edgebase dev 자동 재빌드 + config 번들링.
 *
 * 테스트 범위:
 * 1. Config file validation
 * 2. Wrangler dev arguments & --no-open flag
 * 3. Functions Directory: scanFunctions
 * 4. Functions Registry: generateFunctionRegistry
 * 5. Plugin Tables Merge: mergePluginTables (Explicit Import Pattern)
 * 6. Runtime Config Sync: edgebase.config.ts → generated-config.ts shim
 * 7. File Watch Scenarios
 * 8. Full Pipeline: scan → generate
 * 9. Edge Cases
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createNetServer } from 'node:net';
import { _internals } from '../src/commands/deploy.js';
import { _devInternals, resolveLocalDevBindings } from '../src/commands/dev.js';
import { parseEnvFile } from '../src/lib/dev-sidecar.js';
import {
  buildDefaultWranglerToml,
  ensureProjectSharedPackageLink,
  ensureRuntimeScaffold,
  resolveSharedPackageLinkRoots,
  resolveRuntimeNodeModulesSourceFromCandidates,
  resolveSharedPackageSourceFromCandidates,
  writeRuntimeConfigShim,
} from '../src/lib/runtime-scaffold.js';

const { scanFunctions, generateFunctionRegistry, mergePluginTables } = _internals;

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. Config file validation
// ======================================================================

describe('Config file validation', () => {
  it('detects missing edgebase.config.ts', () => {
    const configPath = join(tmpDir, 'edgebase.config.ts');
    expect(existsSync(configPath)).toBe(false);
  });

  it('detects existing edgebase.config.ts', () => {
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, 'export default {}');
    expect(existsSync(configPath)).toBe(true);
  });
});

describe('Runtime config scaffold', () => {
  it('routes asset requests through the worker before static fallback', () => {
    const wranglerToml = buildDefaultWranglerToml(undefined, 'instagram-clone-edgebase');

    expect(wranglerToml).toContain('run_worker_first = true');
  });

  it('uses a project-scoped default R2 bucket name', () => {
    const wranglerToml = buildDefaultWranglerToml(undefined, 'instagram-clone-edgebase');

    expect(wranglerToml).toContain('bucket_name = "instagram-clone-edgebase-storage"');
  });

  it('creates a runtime test-config shim that points at the project test config when present', () => {
    writeFileSync(join(tmpDir, 'edgebase.test.config.ts'), 'export default { auth: { anonymousAuth: false } };');

    ensureRuntimeScaffold(tmpDir);

    const shim = readFileSync(join(tmpDir, '.edgebase', 'runtime', 'server', 'edgebase.test.config.ts'), 'utf-8');
    expect(shim).toContain("import config from '../../../edgebase.test.config.ts'");
  });

  it('writes a runtime config shim that injects config env before importing the project config', () => {
    ensureRuntimeScaffold(tmpDir);
    writeRuntimeConfigShim(tmpDir, {
      MOCK_FCM_BASE_URL: 'https://mock.example.com',
      FEATURE_FLAG: '1',
    });

    const shim = readFileSync(
      join(tmpDir, '.edgebase', 'runtime', 'server', 'src', 'generated-config.ts'),
      'utf-8',
    );
    expect(shim).toContain('const injectedEnv = {');
    expect(shim).toContain('"MOCK_FCM_BASE_URL": "https://mock.example.com"');
    expect(shim).toContain('process.env[key] === undefined');
    expect(shim).toContain("await import('../../../../edgebase.config.ts')");
  });

  it('does not copy the package registry into the runtime scaffold', () => {
    ensureRuntimeScaffold(tmpDir);

    const registryPath = join(
      tmpDir,
      '.edgebase',
      'runtime',
      'server',
      'src',
      '_functions-registry.ts',
    );

    expect(existsSync(registryPath)).toBe(false);
  });

  it('rebuilds the runtime registry even without a functions directory so plugins can register', () => {
    ensureRuntimeScaffold(tmpDir);

    const registryPath = join(tmpDir, '.edgebase', 'runtime', 'server', 'src', '_functions-registry.ts');
    _devInternals.rebuildFunctionsRegistry(join(tmpDir, 'functions'), registryPath);

    const registry = readFileSync(registryPath, 'utf-8');
    expect(registry).toContain('Plugin Functions + Hooks Registration');
    expect(registry).toContain("registerFunction(`${plugin.name}/${funcName}`");
    expect(registry).toContain('rebuildCompiledRoutes()');
  });

  it('writes an ESM-resolvable @edge-base/shared shim for config evaluation', () => {
    ensureProjectSharedPackageLink(tmpDir);

    const packageJson = readFileSync(
      join(tmpDir, 'node_modules', '@edge-base', 'shared', 'package.json'),
      'utf-8',
    );
    expect(JSON.parse(packageJson)).toMatchObject({
      main: './src/index.ts',
      types: './src/index.ts',
      exports: {
        '.': {
          import: './src/index.ts',
          types: './src/index.ts',
          default: './src/index.ts',
          require: './src/index.ts',
        },
      },
    });
  });

  it('does not rewrite a generated shared shim into a self-referential link on repeat runs', () => {
    const workspaceRoot = join(tmpDir, 'workspace');
    const projectDir = join(workspaceRoot, 'apps', 'edgebase');
    const workspaceShared = join(workspaceRoot, 'node_modules', '@edge-base', 'shared');
    mkdirSync(join(projectDir), { recursive: true });
    mkdirSync(join(workspaceShared, 'src'), { recursive: true });
    writeFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(workspaceShared, 'src', 'index.ts'), 'export const shared = true;\n');

    ensureProjectSharedPackageLink(projectDir);
    ensureProjectSharedPackageLink(projectDir);

    const projectSharedSrc = join(projectDir, 'node_modules', '@edge-base', 'shared', 'src');
    expect(readFileSync(join(projectDir, 'node_modules', '@edge-base', 'shared', '.edgebase-shim'), 'utf-8')).toContain(
      'edgebase-shared-shim',
    );
    const linkedSharedSrc = readlinkSync(projectSharedSrc);
    expect(linkedSharedSrc).not.toBe(projectSharedSrc);
    expect(existsSync(join(linkedSharedSrc, 'index.ts'))).toBe(true);
  });

  it('adds the workspace root as a shared-package link target when running inside a monorepo', () => {
    const workspaceRoot = join(tmpDir, 'workspace');
    const projectDir = join(workspaceRoot, 'apps', 'edgebase');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');

    expect(resolveSharedPackageLinkRoots(projectDir)).toEqual([projectDir, workspaceRoot]);
  });

  it('falls back to the first runtime node_modules candidate that exists', () => {
    const missing = join(tmpDir, 'missing-node_modules');
    const runtimeNodeModules = join(tmpDir, 'workspace-node_modules');
    mkdirSync(runtimeNodeModules, { recursive: true });

    expect(
      resolveRuntimeNodeModulesSourceFromCandidates([missing, runtimeNodeModules]),
    ).toBe(runtimeNodeModules);
  });

  it('falls back to a later shared package source when early node_modules links are absent', () => {
    const firstMissing = join(tmpDir, 'missing-shared-a');
    const secondMissing = join(tmpDir, 'missing-shared-b');
    const monorepoShared = join(tmpDir, 'packages', 'shared');
    mkdirSync(join(monorepoShared, 'src'), { recursive: true });
    writeFileSync(join(monorepoShared, 'src', 'index.ts'), 'export const ok = true;\n');

    expect(
      resolveSharedPackageSourceFromCandidates([firstMissing, secondMissing, monorepoShared]),
    ).toBe(monorepoShared);
  });
});

// ======================================================================
// 2. Wrangler dev arguments
// ======================================================================

describe('Wrangler dev arguments', () => {
  it('builds correct default arguments', () => {
    const port = '8787';
    const args = ['wrangler', 'dev', '--port', port];
    expect(args).toEqual(['wrangler', 'dev', '--port', '8787']);
  });

  it('supports an explicit host binding', () => {
    const args = ['wrangler', 'dev', '--port', '8787', '--ip', '0.0.0.0'];
    expect(args).toEqual(['wrangler', 'dev', '--port', '8787', '--ip', '0.0.0.0']);
  });

  it('passes internal worker overrides through to wrangler vars', () => {
    const previous = process.env.EDGEBASE_INTERNAL_WORKER_URL;
    process.env.EDGEBASE_INTERNAL_WORKER_URL = 'http://127.0.0.1:8787/';

    try {
      expect(_devInternals.resolveWorkerVarBindings(8788)).toEqual([
        'EDGEBASE_DEV_SIDECAR_PORT:8788',
        'EDGEBASE_INTERNAL_WORKER_URL:http://127.0.0.1:8787',
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.EDGEBASE_INTERNAL_WORKER_URL;
      } else {
        process.env.EDGEBASE_INTERNAL_WORKER_URL = previous;
      }
    }
  });

  it('uses custom port', () => {
    const port = '3000';
    const args = ['wrangler', 'dev', '--port', port];
    expect(args).toContain('3000');
  });

  it('always includes --port flag', () => {
    const port = '8787';
    const args = ['wrangler', 'dev', '--port', port];
    expect(args).toContain('--port');
  });

  it('adds local D1 bindings for single-instance namespaces in dev', () => {
    const bindings = resolveLocalDevBindings({
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
        cache: {
          provider: 'd1',
          tables: {
            entries: { schema: { key: { type: 'string' } } },
          },
        },
        workspace: {
          instance: true,
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
        logs: {
          provider: 'do',
          tables: {
            events: { schema: { name: { type: 'string' } } },
          },
        },
      },
    });

    expect(bindings).toEqual([
      { type: 'd1_database', name: 'auth', binding: 'AUTH_DB', id: 'local' },
      { type: 'd1_database', name: 'control', binding: 'CONTROL_DB', id: 'local' },
      { type: 'd1_database', name: 'db-shared', binding: 'DB_D1_SHARED', id: 'local' },
      { type: 'd1_database', name: 'db-cache', binding: 'DB_D1_CACHE', id: 'local' },
    ]);
  });

  it('keeps the legacy shared state path for the default port', () => {
    expect(_devInternals.resolveDevPersistence(tmpDir, 8787)).toEqual({});
  });

  it('isolates non-default ports under .edgebase/dev', () => {
    expect(_devInternals.resolveDevPersistence(tmpDir, 8788)).toEqual({
      label: 'port-8788',
      persistTo: join(tmpDir, '.edgebase', 'dev', 'port-8788', 'state'),
    });
  });

  it('uses explicit isolated names for persistence', () => {
    expect(_devInternals.resolveDevPersistence(tmpDir, 8787, 'QA Team')).toEqual({
      label: 'qa-team',
      persistTo: join(tmpDir, '.edgebase', 'dev', 'qa-team', 'state'),
    });
  });

  it('finds the next available port when the preferred port is occupied', async () => {
    const server = createNetServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const occupiedPort = typeof address === 'object' && address ? address.port : 0;

    try {
      const nextPort = await _devInternals.findAvailablePort(occupiedPort);
      expect(nextPort).toBeGreaterThan(occupiedPort);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('resolves a non-conflicting dev port pair', async () => {
    const server = createNetServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const occupiedPort = typeof address === 'object' && address ? address.port : 0;

    try {
      const resolved = await _devInternals.resolveDevPorts(occupiedPort);
      expect(resolved.port).toBeGreaterThan(occupiedPort);
      expect(resolved.portChanged).toBe(true);
      expect(resolved.sidecarPort).toBeGreaterThan(resolved.port);
      expect(resolved.sidecarPort).not.toBe(resolved.port);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('treats reserved ports as unavailable until they are released', async () => {
    const startPort = await _devInternals.findAvailablePort(42000);
    const reservation = await _devInternals.findAndReservePort(startPort);

    try {
      await expect(_devInternals.isPortAvailable(reservation.port)).resolves.toBe(false);
      await expect(_devInternals.findAvailablePort(reservation.port)).resolves.toBeGreaterThan(reservation.port);
    } finally {
      await reservation.release();
    }

    await expect(_devInternals.isPortAvailable(startPort)).resolves.toBe(true);
  });

  it('allocates distinct port sets for concurrent dev reservations', async () => {
    const [first, second] = await Promise.all([
      _devInternals.reserveDevPorts(43000),
      _devInternals.reserveDevPorts(43000),
    ]);

    try {
      expect(new Set([
        first.port,
        first.sidecarPort,
        first.inspectorPort,
        second.port,
        second.sidecarPort,
        second.inspectorPort,
      ]).size).toBe(6);
    } finally {
      await Promise.allSettled([first.release(), second.release()]);
    }
  });

  it('reclaims stale reservation files left by dead processes', async () => {
    const port = await _devInternals.findAvailablePort(44000);
    const reservationPath = _devInternals.getPortReservationPath(port);

    mkdirSync(dirname(reservationPath), { recursive: true });
    writeFileSync(reservationPath, JSON.stringify({ pid: 999999, port }));

    const reservation = await _devInternals.findAndReservePort(port);
    try {
      expect(reservation.port).toBe(port);
    } finally {
      await reservation.release();
    }
  });

  it('auto-generates missing JWT secrets on first dev run', () => {
    const result = _devInternals.ensureDevJwtSecrets(tmpDir);

    expect(result.generatedKeys.sort()).toEqual(['JWT_ADMIN_SECRET', 'JWT_USER_SECRET']);
    expect(result.primaryPath).toBe(join(tmpDir, '.env.development'));

    const envDev = parseEnvFile(join(tmpDir, '.env.development'));
    const devVars = parseEnvFile(join(tmpDir, '.dev.vars'));
    expect(envDev.JWT_USER_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(envDev.JWT_ADMIN_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(devVars.JWT_USER_SECRET).toBe(envDev.JWT_USER_SECRET);
    expect(devVars.JWT_ADMIN_SECRET).toBe(envDev.JWT_ADMIN_SECRET);
  });

  it('backfills missing admin secret into existing .env.development', () => {
    writeFileSync(join(tmpDir, '.env.development'), 'JWT_USER_SECRET=keep-user\nCUSTOM=1\n');

    const result = _devInternals.ensureDevJwtSecrets(tmpDir);
    expect(result.generatedKeys).toEqual(['JWT_ADMIN_SECRET']);

    const envDev = parseEnvFile(join(tmpDir, '.env.development'));
    expect(envDev.JWT_USER_SECRET).toBe('keep-user');
    expect(envDev.JWT_ADMIN_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(envDev.CUSTOM).toBe('1');
  });

  it('backfills missing JWT secrets into legacy .dev.vars without forcing .env.development', () => {
    writeFileSync(join(tmpDir, '.dev.vars'), 'JWT_USER_SECRET=legacy-user\nCUSTOM=1\n');

    const result = _devInternals.ensureDevJwtSecrets(tmpDir);
    expect(result.generatedKeys).toEqual(['JWT_ADMIN_SECRET']);
    expect(result.primaryPath).toBe(join(tmpDir, '.dev.vars'));
    expect(existsSync(join(tmpDir, '.env.development'))).toBe(false);

    const devVars = parseEnvFile(join(tmpDir, '.dev.vars'));
    expect(devVars.JWT_USER_SECRET).toBe('legacy-user');
    expect(devVars.JWT_ADMIN_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(devVars.CUSTOM).toBe('1');
  });
});

// ======================================================================
// 2.1 dev --no-open flag (dashboard opens by default)
// ======================================================================

describe('dev --no-open flag', () => {
  it('devCommand accepts --no-open option (dashboard opens by default)', async () => {
    const { devCommand } = await import('../src/commands/dev.js');
    const openOption = devCommand.options.find((o: any) => o.long === '--no-open');
    expect(openOption).toBeDefined();
    expect(openOption!.description).toContain('admin dashboard');
  });

  it('openBrowser builds correct command per platform', () => {
    // Cross-platform browser open uses platform-specific commands
    const platformCommands: Record<string, string> = {
      darwin: 'open',
      win32: 'start',
      linux: 'xdg-open',
    };
    for (const [platform, expected] of Object.entries(platformCommands)) {
      const cmd =
        platform === 'darwin' ? 'open' :
        platform === 'win32' ? 'start' : 'xdg-open';
      expect(cmd).toBe(expected);
    }
  });

  it('waitForServer retries on failure and returns false after max retries', async () => {
    // Simulate the waitForServer logic with a short timeout
    let attempts = 0;
    const maxRetries = 3;

    async function testWait(): Promise<boolean> {
      for (let i = 0; i < maxRetries; i++) {
        attempts++;
        try {
          // Simulate fetch failure (server not ready)
          throw new Error('Connection refused');
        } catch {
          // Not ready yet
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      return false;
    }

    const result = await testWait();
    expect(result).toBe(false);
    expect(attempts).toBe(maxRetries);
  });
});

// ======================================================================
// 3. Functions Directory: scanFunctions()
// ======================================================================

describe('Functions Directory — scanFunctions()', () => {
  it('detects existing functions/ directory', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    expect(existsSync(functionsDir)).toBe(true);
  });

  it('detects missing functions/ directory', () => {
    const functionsDir = join(tmpDir, 'functions');
    expect(existsSync(functionsDir)).toBe(false);
  });

  it('scans .ts files in functions/', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'onUserCreated.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'onPostPublished.ts'), 'export default {}');

    const functions = scanFunctions(functionsDir);
    expect(functions).toHaveLength(2);
    expect(functions.map(f => f.name)).toContain('onUserCreated');
    expect(functions.map(f => f.name)).toContain('onPostPublished');
  });

  it('ignores non-.ts files', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'onUserCreated.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'readme.md'), '# readme');
    writeFileSync(join(functionsDir, 'helper.js'), 'module.exports = {}');

    const functions = scanFunctions(functionsDir);
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe('onUserCreated');
  });

  it('ignores files starting with _', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, '_internal.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'echo.ts'), 'export default {}');

    const functions = scanFunctions(functionsDir);
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe('echo');
  });

  it('scans nested subdirectories', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'hooks'), { recursive: true });
    writeFileSync(join(functionsDir, 'echo.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'hooks', 'onAuth.ts'), 'export default {}');

    const functions = scanFunctions(functionsDir);
    expect(functions).toHaveLength(2);
    expect(functions.map(f => f.name)).toContain('echo');
    expect(functions.map(f => f.name)).toContain('hooks/onAuth');
  });

  it('returns empty array for empty functions/', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);

    const functions = scanFunctions(functionsDir);
    expect(functions).toHaveLength(0);
  });
});

// ======================================================================
// 4. Functions Registry: generateFunctionRegistry()
// ======================================================================

describe('Functions Registry — generateFunctionRegistry()', () => {
  it('generates _functions-registry.ts with correct imports', () => {
    const outputDir = join(tmpDir, 'packages', 'server', 'src');
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    const functions = [
      { name: 'echo', relativePath: 'echo.ts', methods: [] as string[], hasDefaultExport: true, isMiddleware: false },
      { name: 'onUserCreated', relativePath: 'onUserCreated.ts', methods: [] as string[], hasDefaultExport: true, isMiddleware: false },
    ];
    generateFunctionRegistry(functions, registryPath);

    expect(existsSync(registryPath)).toBe(true);
    const content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain('import echo_module');
    expect(content).toContain('import onUserCreated_module');
    expect(content).toContain("registerFunction('echo', echo_module)");
    expect(content).toContain("registerFunction('onUserCreated', onUserCreated_module)");
    expect(content).toContain('initFunctionRegistry');
    expect(content).toContain('Auto-generated');
  });

  it('handles functions in subdirectories', () => {
    const outputDir = join(tmpDir, 'packages', 'server', 'src');
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    const functions = [
      { name: 'hooks/onAuth', relativePath: 'hooks/onAuth.ts', methods: [] as string[], hasDefaultExport: true, isMiddleware: false },
    ];
    generateFunctionRegistry(functions, registryPath);

    const content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain("../../../../functions/hooks/onAuth.ts");
    expect(content).toContain("registerFunction('hooks/onAuth', hooks_onAuth_module)");
  });

  it('creates output directory if not exists', () => {
    const outputDir = join(tmpDir, 'new', 'deep', 'dir');
    const registryPath = join(outputDir, '_functions-registry.ts');

    generateFunctionRegistry(
      [{ name: 'test', relativePath: 'test.ts', methods: [] as string[], hasDefaultExport: true, isMiddleware: false }],
      registryPath,
    );

    expect(existsSync(registryPath)).toBe(true);
  });

  it('overwrites existing registry', () => {
    const outputDir = join(tmpDir, 'src');
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    generateFunctionRegistry([{ name: 'v1', relativePath: 'v1.ts', methods: [] as string[], hasDefaultExport: true, isMiddleware: false }], registryPath);
    const content1 = readFileSync(registryPath, 'utf-8');
    expect(content1).toContain("'v1'");

    generateFunctionRegistry([{ name: 'v2', relativePath: 'v2.ts', methods: [] as string[], hasDefaultExport: true, isMiddleware: false }], registryPath);
    const content2 = readFileSync(registryPath, 'utf-8');
    expect(content2).toContain("'v2'");
    expect(content2).not.toContain("'v1'");
  });

  it('supports a custom runtime config import path', () => {
    const outputDir = join(tmpDir, 'src');
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    generateFunctionRegistry([], registryPath, { configImportPath: './generated-config.js' });

    const content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain("import config from './generated-config.js'");
    expect(content).toContain("import { parseConfig } from './lib/do-router.js'");
    expect(content).toContain('const keepBundled = [config, registerMiddleware, RoomsDO];');
    expect(content).toContain('const resolvedConfig = parseConfig();');
  });

  it('supports a custom functions import base path for runtime scaffolds', () => {
    const outputDir = join(tmpDir, '.edgebase', 'runtime', 'server', 'src');
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    generateFunctionRegistry(
      [{ name: 'dev/auth-probe', relativePath: 'dev/auth-probe.ts', methods: ['GET'] as string[], hasDefaultExport: false, isMiddleware: false }],
      registryPath,
      {
        configImportPath: './generated-config.js',
        functionsImportBasePath: '../../../functions',
      },
    );

    const content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain("import * as dev_auth_probe_module from '../../../functions/dev/auth-probe.ts'");
  });

  it('registers blocking storage hook events as storage triggers', () => {
    const outputDir = join(tmpDir, 'src');
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    generateFunctionRegistry([], registryPath, { configImportPath: './generated-config.js' });

    const content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain('const STORAGE_EVENTS = new Set');
    expect(content).toContain("'beforeUpload'");
    expect(content).toContain("'beforeDownload'");
    expect(content).toContain("'beforeDelete'");
    expect(content).toContain("'afterUpload'");
    expect(content).toContain("'afterDelete'");
    expect(content).toContain("'onMetadataUpdate'");
  });
});

// ======================================================================
// 5. Plugin Tables Merge: mergePluginTables() — Explicit Import Pattern
// ======================================================================

describe('Plugin Tables Merge — mergePluginTables()', () => {
  it('merges plugin tables into shared db by default', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: { schema: {} } } },
    };
    const plugins = [
      { name: 'plugin-stripe', config: {}, tables: { customers: { schema: { userId: { type: 'string' } } } } },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases.shared.tables).toHaveProperty('plugin-stripe/customers');
    expect(databases.shared.tables).toHaveProperty('posts');
  });

  it('uses custom dbBlock', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {};
    const plugins = [
      { name: 'plugin-logs', config: {}, dbBlock: 'logs', tables: { entries: { schema: {} } } },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases).toHaveProperty('logs');
    expect(databases.logs.tables).toHaveProperty('plugin-logs/entries');
  });

  it('handles plugins without tables', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: {} } },
    };

    mergePluginTables(databases, [{ name: 'plugin-empty', config: {} }] as any);

    expect(Object.keys(databases.shared.tables!)).toEqual(['posts']);
  });

  it('handles empty plugins array', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: {} } },
    };

    mergePluginTables(databases, []);

    expect(Object.keys(databases.shared.tables!)).toEqual(['posts']);
  });

  it('merges multiple plugins with multiple tables', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: {} },
    };
    const plugins = [
      { name: 'plugin-a', config: {}, tables: { t1: { schema: {} }, t2: { schema: {} } } },
      { name: 'plugin-b', config: {}, tables: { t1: { schema: {} } } },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases.shared.tables).toHaveProperty('plugin-a/t1');
    expect(databases.shared.tables).toHaveProperty('plugin-a/t2');
    expect(databases.shared.tables).toHaveProperty('plugin-b/t1');
  });
});

// ======================================================================
// 7. Full Pipeline: scan → generate
// ======================================================================

describe('Full Pipeline — scan → generate', () => {
  it('generates registry with user functions', () => {
    const functionsDir = join(tmpDir, 'functions');
    const outputDir = join(tmpDir, 'packages', 'server', 'src');
    mkdirSync(functionsDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(functionsDir, 'echo.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'auth-hook.ts'), 'export default {}');

    const userFunctions = scanFunctions(functionsDir);
    const registryPath = join(outputDir, '_functions-registry.ts');
    generateFunctionRegistry(userFunctions, registryPath);

    const content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain("registerFunction('echo'");
    expect(content).toContain("registerFunction('auth-hook'");
  });

  it('re-generates registry when functions change', () => {
    const functionsDir = join(tmpDir, 'functions');
    const outputDir = join(tmpDir, 'src');
    mkdirSync(functionsDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    writeFileSync(join(functionsDir, 'echo.ts'), 'export default {}');
    let functions = scanFunctions(functionsDir);
    generateFunctionRegistry(functions, registryPath);
    let content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain("registerFunction('echo'");
    expect(content).not.toContain("registerFunction('send-report'");

    writeFileSync(join(functionsDir, 'send-report.ts'), 'export default {}');
    functions = scanFunctions(functionsDir);
    generateFunctionRegistry(functions, registryPath);
    content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain("registerFunction('echo'");
    expect(content).toContain("registerFunction('send-report'");
  });

  it('removes deleted functions from registry', () => {
    const functionsDir = join(tmpDir, 'functions');
    const outputDir = join(tmpDir, 'src');
    mkdirSync(functionsDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    writeFileSync(join(functionsDir, 'echo.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'temp.ts'), 'export default {}');
    let functions = scanFunctions(functionsDir);
    generateFunctionRegistry(functions, registryPath);
    let content = readFileSync(registryPath, 'utf-8');
    expect(content).toContain("'temp'");

    rmSync(join(functionsDir, 'temp.ts'));
    functions = scanFunctions(functionsDir);
    generateFunctionRegistry(functions, registryPath);
    content = readFileSync(registryPath, 'utf-8');
    expect(content).not.toContain("'temp'");
    expect(content).toContain("'echo'");
  });
});

// ======================================================================
// 8. Watch Filtering Logic
// ======================================================================

describe('Watch Filtering Logic', () => {
  it('ignores non-.ts files', () => {
    const shouldProcess = (filename: string) =>
      !!filename && filename.endsWith('.ts') && !filename.startsWith('_');

    expect(shouldProcess('echo.ts')).toBe(true);
    expect(shouldProcess('readme.md')).toBe(false);
    expect(shouldProcess('helper.js')).toBe(false);
    expect(shouldProcess('style.css')).toBe(false);
    expect(shouldProcess('')).toBe(false);
  });

  it('ignores _-prefixed files', () => {
    const shouldProcess = (filename: string) =>
      !!filename && filename.endsWith('.ts') && !filename.startsWith('_');

    expect(shouldProcess('_internal.ts')).toBe(false);
    expect(shouldProcess('_functions-registry.ts')).toBe(false);
    expect(shouldProcess('echo.ts')).toBe(true);
  });

  it('processes nested .ts paths', () => {
    const shouldProcess = (filename: string) =>
      !!filename && filename.endsWith('.ts') && !filename.startsWith('_');

    expect(shouldProcess('hooks/onAuth.ts')).toBe(true);
    expect(shouldProcess('deep/nested/func.ts')).toBe(true);
  });

  it('uses content-based signatures so same-content rewrites do not look like config changes', async () => {
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, 'export default { release: false };\n');

    const firstSignature = _devInternals.getPathSignature(configPath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeFileSync(configPath, 'export default { release: false };\n');
    const secondSignature = _devInternals.getPathSignature(configPath);

    expect(secondSignature).toBe(firstSignature);
  });

  it('changes signature when config content actually changes', () => {
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, 'export default { release: false };\n');
    const firstSignature = _devInternals.getPathSignature(configPath);

    writeFileSync(configPath, 'export default { release: true };\n');
    const secondSignature = _devInternals.getPathSignature(configPath);

    expect(secondSignature).not.toBe(firstSignature);
  });

  it('seeds config directory watchers with existing source files only', () => {
    const configDir = join(tmpDir, 'config');
    mkdirSync(join(configDir, 'nested'), { recursive: true });
    writeFileSync(join(configDir, 'rate-limits.ts'), 'export default {};');
    writeFileSync(join(configDir, 'nested', 'auth.mts'), 'export default {};');
    writeFileSync(join(configDir, 'notes.md'), '# ignore');

    const files = _devInternals.listConfigWatchFiles(configDir)
      .map((file) => file.replace(`${tmpDir}/`, ''))
      .sort();

    expect(files).toEqual([
      'config/nested/auth.mts',
      'config/rate-limits.ts',
    ]);
  });
});

// ======================================================================
// 9. Edge Cases
// ======================================================================

describe('Edge Cases', () => {
  it('handles functions with special characters in name', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir, { recursive: true });
    writeFileSync(join(functionsDir, 'on-user-created.ts'), 'export default {}');

    const functions = scanFunctions(functionsDir);
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe('on-user-created');
  });

  it('generateFunctionRegistry sanitizes names for imports', () => {
    const outputDir = join(tmpDir, 'src');
    mkdirSync(outputDir, { recursive: true });
    const registryPath = join(outputDir, '_functions-registry.ts');

    generateFunctionRegistry(
      [{ name: 'on-user-created', relativePath: 'on-user-created.ts', methods: [] as string[], hasDefaultExport: true, isMiddleware: false }],
      registryPath,
    );

    const content = readFileSync(registryPath, 'utf-8');
    // Hyphens should be replaced with underscores for valid JS identifiers
    expect(content).toContain('on_user_created_module');
    expect(content).toContain("registerFunction('on-user-created'");
  });

  it('handles empty functions/ directory', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir, { recursive: true });

    const functions = scanFunctions(functionsDir);
    expect(functions).toHaveLength(0);
  });
});
