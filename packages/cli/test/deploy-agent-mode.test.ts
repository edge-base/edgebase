import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setContext } from '../src/lib/cli-context.js';

const ensureCloudflareAuth = vi.fn();
const ensureWranglerToml = vi.fn();
const ensureRuntimeScaffold = vi.fn();
const loadConfigSafe = vi.fn(() => ({
  release: true,
  databases: {
    shared: {
      tables: {
        posts: {
          schema: {
            id: { type: 'string' },
          },
        },
      },
    },
  },
}));
const buildSnapshot = vi.fn(() => ({ version: 'test-snapshot' }));
const saveSnapshot = vi.fn();
const loadSnapshot = vi.fn(() => ({ version: 'saved-snapshot' }));
const detectDestructiveChanges = vi.fn(() => [{
  namespace: 'shared',
  table: 'posts',
  action: 'drop_table',
}]);
const filterAutoPassChanges = vi.fn((changes) => changes);
const handleDestructiveChanges = vi.fn(async () => {
  const { CliStructuredError } = await import('../src/lib/agent-contract.js');
  throw new CliStructuredError({
    status: 'needs_input',
    code: 'destructive_confirmation_required',
    field: 'ifDestructive',
    message: 'Choose how deploy should handle destructive schema changes.',
    choices: [
      { label: 'Reject deploy', value: 'reject', args: ['--if-destructive', 'reject'] },
      { label: 'Reset data', value: 'reset', args: ['--if-destructive', 'reset'] },
    ],
  });
});

vi.mock('../src/lib/cf-auth.js', () => ({
  ensureCloudflareAuth,
  ensureWranglerToml,
}));

vi.mock('../src/lib/runtime-scaffold.js', () => ({
  ensureRuntimeScaffold,
  getRuntimeServerSrcDir: vi.fn(() => '/tmp/runtime'),
  INTERNAL_D1_BINDINGS: [],
  writeRuntimeConfigShim: vi.fn(),
}));

vi.mock('../src/lib/load-config.js', () => ({
  loadConfigSafe,
}));

vi.mock('../src/lib/schema-check.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/schema-check.js')>();
  return {
    ...actual,
    buildSnapshot,
    saveSnapshot,
    loadSnapshot,
    detectDestructiveChanges,
    filterAutoPassChanges,
    handleDestructiveChanges,
  };
});

describe('deploy command agent mode', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    setContext({ json: false, quiet: false, verbose: false, nonInteractive: true });
    testDir = join(tmpdir(), `eb-deploy-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'edgebase.config.ts'), 'export default {};');
    originalCwd = process.cwd();
    process.chdir(testDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    setContext({ json: false, quiet: false, verbose: false, nonInteractive: false });
    vi.restoreAllMocks();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('rethrows structured destructive-change prompts instead of converting them into generic failures', async () => {
    const { deployCommand } = await import('../src/commands/deploy.js');

    await expect(deployCommand.parseAsync([], { from: 'user' })).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'needs_input',
        code: 'destructive_confirmation_required',
        field: 'ifDestructive',
      }),
    });

    expect(handleDestructiveChanges).toHaveBeenCalledTimes(1);
    expect(ensureCloudflareAuth).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });
});
