import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ensureCloudflareAuth = vi.fn();
const ensureWranglerToml = vi.fn();
const ensureRuntimeScaffold = vi.fn();
const loadConfigSafe = vi.fn(() => ({
  release: true,
  databases: {
    shared: {
      tables: {
        posts: { schema: { title: { type: 'string' } } },
      },
    },
  },
}));
const saveSnapshot = vi.fn();
const loadSnapshot = vi.fn(() => null);

vi.mock('../src/lib/cf-auth.js', () => ({
  ensureCloudflareAuth,
  ensureWranglerToml,
}));

vi.mock('../src/lib/runtime-scaffold.js', () => ({
  ensureRuntimeScaffold,
  getRuntimeServerSrcDir: vi.fn(() => '/tmp/runtime'),
  INTERNAL_D1_BINDINGS: [],
}));

vi.mock('../src/lib/load-config.js', () => ({
  loadConfigSafe,
}));

vi.mock('../src/lib/schema-check.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/schema-check.js')>();
  return {
    ...actual,
    saveSnapshot,
    loadSnapshot,
  };
});

describe('deploy command dry-run', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    testDir = join(tmpdir(), `eb-deploy-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'edgebase.config.ts'), 'export default {};');
    originalCwd = process.cwd();
    process.chdir(testDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('skips remote auth and snapshot writes', async () => {
    const { deployCommand } = await import('../src/commands/deploy.js');

    await deployCommand.parseAsync(['--dry-run'], { from: 'user' });

    expect(loadConfigSafe).toHaveBeenCalled();
    expect(ensureCloudflareAuth).not.toHaveBeenCalled();
    expect(ensureWranglerToml).not.toHaveBeenCalled();
    expect(ensureRuntimeScaffold).not.toHaveBeenCalled();
    expect(saveSnapshot).not.toHaveBeenCalled();
  });
});
