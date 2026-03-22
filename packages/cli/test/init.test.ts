import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock devCommand to prevent init from actually starting the dev server
const mockParseAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/commands/dev.js', () => ({
  devCommand: { parseAsync: mockParseAsync },
}));

const CLI_PACKAGE = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
) as { version: string };
const EXPECTED_PUBLIC_VERSION = `^${CLI_PACKAGE.version}`;

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
    expect(existsSync(join(testDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(testDir, '.github', 'copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(testDir, 'package.json'))).toBe(true);
    expect(existsSync(join(testDir, 'wrangler.toml'))).toBe(true);
    expect(existsSync(join(testDir, 'node_modules', '@edge-base', 'shared', 'package.json'))).toBe(true);
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

  it('should chdir to project dir and call devCommand without opening the dashboard by default', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir], { from: 'user' });

    // devCommand keeps the dashboard closed by default.
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
      '@edge-base/cli': EXPECTED_PUBLIC_VERSION,
      '@edge-base/shared': EXPECTED_PUBLIC_VERSION,
    });
  });

  it('should append missing EdgeBase ignore rules to an existing .gitignore', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    writeFileSync(
      join(testDir, '.gitignore'),
      ['dist/', 'coverage/', 'custom.env'].join('\n') + '\n',
    );

    await initCommand.parseAsync([testDir, '--no-dev'], { from: 'user' });

    const gitignore = readFileSync(join(testDir, '.gitignore'), 'utf-8');

    expect(gitignore).toContain('dist/\n');
    expect(gitignore).toContain('coverage/\n');
    expect(gitignore).toContain('custom.env\n');
    expect(gitignore).toContain('node_modules/\n');
    expect(gitignore).toContain('.env.development\n');
    expect(gitignore).toContain('.env.release\n');
    expect(gitignore).toContain('.edgebase/\n');
    expect(gitignore.match(/^dist\/$/gm)).toHaveLength(1);
  });

  it('should create EdgeBase AI hint files for generated projects', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir, '--no-dev'], { from: 'user' });

    const agents = readFileSync(join(testDir, 'AGENTS.md'), 'utf-8');
    const copilot = readFileSync(join(testDir, '.github', 'copilot-instructions.md'), 'utf-8');

    expect(agents).toContain('# EdgeBase AI Instructions');
    expect(agents).toContain('use the installed `edgebase` skill first');
    expect(agents).toContain('Never expose service keys');
    expect(copilot).toContain('# EdgeBase Copilot Instructions');
    expect(copilot).toContain('Choose the SDK by trust boundary');
    expect(copilot).toContain('node_modules/@edge-base/*/llms.txt');
  });

  it('should preserve existing guidance files while refreshing the managed EdgeBase block', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    writeFileSync(
      join(testDir, 'AGENTS.md'),
      [
        '# Team Notes',
        '',
        'Keep changelogs short.',
        '',
        '<!-- edgebase:ai-hints:start -->',
        'old block',
        '<!-- edgebase:ai-hints:end -->',
        '',
      ].join('\n'),
    );
    mkdirSync(join(testDir, '.github'), { recursive: true });
    writeFileSync(
      join(testDir, '.github', 'copilot-instructions.md'),
      ['# Existing Copilot Rules', '', 'Prefer small diffs.'].join('\n'),
    );

    await initCommand.parseAsync([testDir, '--no-dev'], { from: 'user' });

    const agents = readFileSync(join(testDir, 'AGENTS.md'), 'utf-8');
    const copilot = readFileSync(join(testDir, '.github', 'copilot-instructions.md'), 'utf-8');

    expect(agents).toContain('# Team Notes');
    expect(agents).toContain('Keep changelogs short.');
    expect(agents).not.toContain('old block');
    expect(agents).toContain('# EdgeBase AI Instructions');
    expect(copilot).toContain('# Existing Copilot Rules');
    expect(copilot).toContain('Prefer small diffs.');
    expect(copilot).toContain('# EdgeBase Copilot Instructions');
  });

  it('should forward --open to dev when auto-starting', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir, '--open'], { from: 'user' });

    expect(mockParseAsync).toHaveBeenCalledWith(['--open'], { from: 'user' });
  });

  it('should import the generated rate limit defaults from config/rate-limits.ts', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand.parseAsync([testDir], { from: 'user' });

    const configContent = readFileSync(join(testDir, 'edgebase.config.ts'), 'utf-8');
    const rateLimitsContent = readFileSync(join(testDir, 'config', 'rate-limits.ts'), 'utf-8');

    expect(configContent).toContain("import { rateLimiting } from './config/rate-limits'");
    expect(configContent).toContain('databases: {');
    expect(configContent).toContain('Add your first DB block here');
    expect(configContent).toContain('// storage: {');
    expect(configContent).toContain('//   buckets: {');
    expect(configContent).toContain('//     uploads: {');
    expect(configContent).toContain('Uncomment to enable R2 file storage');
    expect(configContent).toContain('rateLimiting,');
    expect(configContent).toContain('access: {');
    expect(configContent).not.toContain('rules: {');
    expect(configContent).not.toContain('shared: {');
    expect(configContent).toContain('//     posts: {');
    expect(configContent).toContain('access policies are bypassed during development');
    expect(configContent).toContain('enable deny-by-default access');
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
    const agents = readFileSync(join(testDir, 'AGENTS.md'), 'utf-8');
    const copilot = readFileSync(join(testDir, '.github', 'copilot-instructions.md'), 'utf-8');
    const runtimeConfigShim = readFileSync(join(testDir, '.edgebase', 'runtime', 'server', 'src', 'generated-config.ts'), 'utf-8');
    const runtimeTestConfigShim = readFileSync(join(testDir, '.edgebase', 'runtime', 'server', 'edgebase.test.config.ts'), 'utf-8');
    const runtimeAdminIndex = readFileSync(join(testDir, '.edgebase', 'runtime', 'server', 'admin-build', 'index.html'), 'utf-8');

    expect(packageJson).toContain(`"name": "${basename(testDir)}"`);
    expect(packageJson).toContain('"dev": "edgebase dev"');
    expect(packageJson).toContain('"deploy": "edgebase deploy"');
    expect(packageJson).toContain(`"@edge-base/cli": "${EXPECTED_PUBLIC_VERSION}"`);
    expect(packageJson).toContain(`"@edge-base/shared": "${EXPECTED_PUBLIC_VERSION}"`);
    expect(wranglerToml).toContain(`name = "${basename(testDir)}"`);
    expect(wranglerToml).toContain('main = ".edgebase/runtime/server/src/index.ts"');
    expect(wranglerToml).toContain('directory = ".edgebase/runtime/server/admin-build"');
    expect(wranglerToml).toContain('{ name = "ROOMS", class_name = "RoomsDO" }');
    expect(wranglerToml).toContain('{ name = "LOGS", class_name = "LogsDO" }');
    expect(wranglerToml).toContain('new_sqlite_classes = ["DatabaseDO", "AuthDO", "DatabaseLiveDO", "RoomsDO"]');
    expect(wranglerToml).toContain('new_sqlite_classes = ["LogsDO"]');
    expect(runtimeConfigShim).toContain("import config from '../../../../edgebase.config.ts'");
    expect(runtimeTestConfigShim).toContain("import config from './src/generated-config.ts'");
    expect(runtimeAdminIndex).toContain('href="/admin/_app/');
    expect(runtimeAdminIndex).toContain('base: "/admin"');
    expect(functionTemplate).toContain('export const GET');
    expect(functionTemplate).toContain('ok: true');
    expect(agents).toContain('This repository uses EdgeBase.');
    expect(copilot).toContain('Use the installed `edgebase` skill');
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
