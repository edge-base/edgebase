import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock devCommand to prevent init from actually starting the dev server
const mockParseAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/commands/dev.js', () => ({
  devCommand: { parseAsync: mockParseAsync },
}));

describe('CLI: init command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `edgebase-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore CWD since init does process.chdir()
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should scaffold full project structure via initCommand', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir], { from: 'user' });

    // Verify all expected files were created by the actual init logic
    expect(existsSync(join(testDir, 'edgebase.config.ts'))).toBe(true);
    expect(existsSync(join(testDir, 'config', 'rate-limits.ts'))).toBe(true);
    expect(existsSync(join(testDir, 'functions'))).toBe(true);
    expect(existsSync(join(testDir, 'functions', 'health.ts'))).toBe(true);
    //: .dev.vars → .env.development
    expect(existsSync(join(testDir, '.env.development'))).toBe(true);
    expect(existsSync(join(testDir, '.env.development.example'))).toBe(true);
    expect(existsSync(join(testDir, '.env.release.example'))).toBe(true);
    expect(existsSync(join(testDir, '.gitignore'))).toBe(true);
    expect(existsSync(join(testDir, 'package.json'))).toBe(true);
    expect(existsSync(join(testDir, 'wrangler.toml'))).toBe(true);
    expect(existsSync(join(testDir, 'node_modules', '@edgebase', 'shared', 'package.json'))).toBe(true);
    expect(existsSync(join(testDir, '.edgebase', 'runtime', 'server', 'src', 'index.ts'))).toBe(true);
    expect(existsSync(join(testDir, '.edgebase', 'runtime', 'server', 'src', 'generated-config.ts'))).toBe(true);
    expect(existsSync(join(testDir, '.edgebase', 'runtime', 'server', 'edgebase.test.config.ts'))).toBe(true);
    expect(existsSync(join(testDir, '.edgebase', 'runtime', 'server', 'admin-build', 'index.html'))).toBe(true);
    expect(existsSync(join(testDir, '.edgebase', 'runtime', 'server', 'admin-build', '_app', 'version.json'))).toBe(true);
  });

  it('should generate .env.development with 64-char hex secrets', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    const freshDir = join(tmpdir(), `edgebase-test-secrets-${Date.now()}`);
    mkdirSync(freshDir, { recursive: true });

    try {
      await initCommand.parseAsync([freshDir], { from: 'user' });

      //: secrets are now in .env.development
      const content = readFileSync(join(freshDir, '.env.development'), 'utf-8');
      const userMatch = content.match(/JWT_USER_SECRET=([a-f0-9]+)/);
      const adminMatch = content.match(/JWT_ADMIN_SECRET=([a-f0-9]+)/);

      expect(userMatch).toBeTruthy();
      expect(userMatch![1]).toHaveLength(64);
      expect(adminMatch).toBeTruthy();
      expect(adminMatch![1]).toHaveLength(64);

      // Secrets should be different
      expect(userMatch![1]).not.toBe(adminMatch![1]);
    } finally {
      process.chdir(originalCwd);
      rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it('should chdir to project dir and call devCommand (dashboard opens by default)', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir], { from: 'user' });

    // devCommand opens dashboard by default (--no-open to disable)
    expect(mockParseAsync).toHaveBeenCalledWith([], { from: 'user' });

    // Verify process.chdir was called (CWD should now be testDir)
    // Note: we can't check this after mock since we restore CWD in afterEach,
    // but we can verify the mock was called which means chdir happened before it
    expect(mockParseAsync).toHaveBeenCalledTimes(1);
  });

  it('should allow init scaffolding without starting dev via --no-dev', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir, '--no-dev'], { from: 'user' });

    expect(existsSync(join(testDir, 'edgebase.config.ts'))).toBe(true);
    expect(mockParseAsync).not.toHaveBeenCalled();
    expect(process.cwd()).toBe(originalCwd);
  });

  it('should merge EdgeBase scripts and dependencies into an existing package.json', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({
        name: 'existing-app',
        private: true,
        type: 'module',
        scripts: {
          test: 'vitest',
        },
      }, null, 2),
    );

    await initCommand.parseAsync([testDir, '--no-dev'], { from: 'user' });

    const packageJson = JSON.parse(readFileSync(join(testDir, 'package.json'), 'utf-8')) as {
      name: string;
      scripts: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.name).toBe('existing-app');
    expect(packageJson.scripts.test).toBe('vitest');
    expect(packageJson.scripts.dev).toBe('edgebase dev');
    expect(packageJson.scripts.deploy).toBe('edgebase deploy');
    expect(packageJson.scripts.typegen).toBe('edgebase typegen');
    expect(packageJson.devDependencies).toMatchObject({
      '@edgebase/cli': '^0.1.0',
      '@edgebase/shared': '^0.1.0',
    });
  });

  it('should forward --no-open to dev when auto-starting', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir, '--no-open'], { from: 'user' });

    expect(mockParseAsync).toHaveBeenCalledWith(['--no-open'], { from: 'user' });
  });

  it('should import the generated rate limit defaults from config/rate-limits.ts', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir], { from: 'user' });

    const configContent = readFileSync(join(testDir, 'edgebase.config.ts'), 'utf-8');
    const rateLimitsContent = readFileSync(join(testDir, 'config', 'rate-limits.ts'), 'utf-8');

    expect(configContent).toContain("import { rateLimiting } from './config/rate-limits'");
    expect(configContent).toContain('databases: {');
    expect(configContent).toContain('Add your first DB block here');
    expect(configContent).toContain('storage: {');
    expect(configContent).toContain('buckets: {');
    expect(configContent).toContain('uploads: {');
    expect(configContent).toContain('Uses the generated STORAGE R2 binding by default');
    expect(configContent).toContain('rateLimiting,');
    expect(configContent).toContain('access: {');
    expect(configContent).not.toContain('rules: {');
    expect(configContent).not.toContain('shared: {');
    expect(configContent).toContain('//     posts: {');
    expect(configContent).toContain('access policies are bypassed during development');
    expect(configContent).toContain('enable deny-by-default access');
    expect(configContent).toContain('Add access policies here when ready for production');
    expect(configContent).toContain('write: (auth) => auth !== null');
    expect(configContent).toContain('handlers.lifecycle / handlers.actions / handlers.timers');
    expect(configContent).toContain("PING: (_payload, room) => {");

    expect(rateLimitsContent).toContain('global:');
    expect(rateLimitsContent).toContain('db:');
    expect(rateLimitsContent).toContain('storage:');
    expect(rateLimitsContent).toContain('functions:');
    expect(rateLimitsContent).toContain('auth:');
    expect(rateLimitsContent).toContain('authSignin:');
    expect(rateLimitsContent).toContain('authSignup:');
    expect(rateLimitsContent).toContain('events:');
    expect(rateLimitsContent).toContain("namespaceId: '1008'");
  });

  it('should create runnable project metadata for dev and deploy flows', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir], { from: 'user' });

    const packageJson = readFileSync(join(testDir, 'package.json'), 'utf-8');
    const wranglerToml = readFileSync(join(testDir, 'wrangler.toml'), 'utf-8');
    const functionTemplate = readFileSync(join(testDir, 'functions', 'health.ts'), 'utf-8');
    const runtimeConfigShim = readFileSync(join(testDir, '.edgebase', 'runtime', 'server', 'src', 'generated-config.ts'), 'utf-8');
    const runtimeTestConfigShim = readFileSync(join(testDir, '.edgebase', 'runtime', 'server', 'edgebase.test.config.ts'), 'utf-8');
    const runtimeAdminIndex = readFileSync(join(testDir, '.edgebase', 'runtime', 'server', 'admin-build', 'index.html'), 'utf-8');

    expect(packageJson).toContain(`"name": "${basename(testDir)}"`);
    expect(packageJson).toContain('"dev": "edgebase dev"');
    expect(packageJson).toContain('"deploy": "edgebase deploy"');
    expect(packageJson).toContain('"@edgebase/cli": "^0.1.0"');
    expect(packageJson).toContain('"@edgebase/shared": "^0.1.0"');
    expect(wranglerToml).toContain(`name = "${basename(testDir)}"`);
    expect(wranglerToml).toContain('main = ".edgebase/runtime/server/src/index.ts"');
    expect(wranglerToml).toContain('directory = ".edgebase/runtime/server/admin-build"');
    expect(wranglerToml).toContain('{ name = "ROOMS", class_name = "RoomsDO" }');
    expect(wranglerToml).toContain('{ name = "LOGS", class_name = "LogsDO" }');
    expect(wranglerToml).toContain('new_classes = ["DatabaseLiveDO", "RoomsDO"]');
    expect(wranglerToml).toContain('new_sqlite_classes = ["LogsDO"]');
    expect(runtimeConfigShim).toContain("import config from '../../../../edgebase.config.ts'");
    expect(runtimeTestConfigShim).toContain("import config from './src/generated-config.ts'");
    expect(runtimeAdminIndex).toContain('href="/admin/_app/');
    expect(runtimeAdminIndex).toContain('base: "/admin"');
    expect(functionTemplate).toContain('export const GET');
    expect(functionTemplate).toContain('ok: true');
  });

  it('should derive unique package and worker names for generic edgebase folders', async () => {
    const { initCommand } = await import('../src/commands/init.js');
    const nestedDir = join(testDir, 'collab-board', 'edgebase');

    mkdirSync(join(testDir, 'collab-board'), { recursive: true });
    await initCommand.parseAsync([nestedDir], { from: 'user' });

    const packageJson = readFileSync(join(nestedDir, 'package.json'), 'utf-8');
    const wranglerToml = readFileSync(join(nestedDir, 'wrangler.toml'), 'utf-8');

    expect(packageJson).toContain('"name": "collab-board-edgebase"');
    expect(wranglerToml).toContain('name = "collab-board-edgebase"');
  });

  it('should point scripts at the local CLI when scaffolded inside the EdgeBase monorepo', async () => {
    const { initCommand } = await import('../src/commands/init.js');
    const monorepoRoot = join(testDir, 'repo');
    const nestedDir = join(monorepoRoot, 'example-app', 'web', 'story-cam', 'edgebase');

    mkdirSync(join(monorepoRoot, 'packages', 'cli', 'dist'), { recursive: true });
    mkdirSync(join(monorepoRoot, 'example-app', 'web', 'story-cam'), { recursive: true });
    writeFileSync(join(monorepoRoot, 'package.json'), JSON.stringify({ name: 'edgebase', private: true }, null, 2));
    writeFileSync(join(monorepoRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    writeFileSync(join(monorepoRoot, 'packages', 'cli', 'dist', 'index.js'), '');

    await initCommand.parseAsync([nestedDir, '--no-dev'], { from: 'user' });

    const packageJson = readFileSync(join(nestedDir, 'package.json'), 'utf-8');

    expect(packageJson).toContain('"dev": "node ../../../../packages/cli/dist/index.js dev"');
    expect(packageJson).toContain('"deploy": "node ../../../../packages/cli/dist/index.js deploy"');
    expect(packageJson).toContain('"typegen": "node ../../../../packages/cli/dist/index.js typegen"');
    expect(packageJson).not.toContain('"devDependencies"');
  });
});
