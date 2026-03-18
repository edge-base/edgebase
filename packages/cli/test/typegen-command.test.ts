import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setContext } from '../src/lib/cli-context.js';

const mockFail = vi.fn();
const mockSucceed = vi.fn();
const mockWarn = vi.fn();

vi.mock('../src/lib/spinner.js', () => ({
  spin: () => ({
    fail: mockFail,
    succeed: mockSucceed,
    warn: mockWarn,
  }),
}));

describe('typegen command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `edgebase-typegen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(testDir);
    setContext({ verbose: false, quiet: true, json: false });

    mockFail.mockReset();
    mockSucceed.mockReset();
    mockWarn.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rejects legacy config syntax instead of falling back to regex parsing', async () => {
    writeFileSync(
      join(testDir, 'edgebase.config.ts'),
      `
import { defineConfig } from '@edgebase-fun/shared';

export default defineConfig({
  databases: {
    shared: {
      tables: {
        posts: {
          schema: {
            title: { type: 'string', required: true },
          },
          rules: {
            read: () => true,
          },
        },
      },
    },
  },
});
`,
      'utf-8',
    );

    const { typegenCommand } = await import('../src/commands/typegen.js');

    await expect(typegenCommand.parseAsync(['-o', 'edgebase.d.ts'], { from: 'user' })).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'error',
        code: 'typegen_config_parse_failed',
        message: expect.stringContaining('Legacy config syntax is no longer supported at databases.shared.tables.posts.rules'),
        hint: 'Make sure edgebase.config.ts exports a valid config object.',
      }),
    });
    expect(existsSync(join(testDir, 'edgebase.d.ts'))).toBe(false);
    expect(mockFail).toHaveBeenCalledWith(expect.stringContaining(
      'Legacy config syntax is no longer supported at databases.shared.tables.posts.rules',
    ));
  });

  it('generates types for a valid config', async () => {
    writeFileSync(
      join(testDir, 'edgebase.config.ts'),
      `
import { defineConfig } from '@edgebase-fun/shared';

export default defineConfig({
  databases: {
    shared: {
      tables: {
        posts: {
          schema: {
            title: { type: 'string', required: true },
            authorId: { type: 'string', references: 'users' },
          },
        },
      },
    },
  },
});
`,
      'utf-8',
    );

    const { typegenCommand } = await import('../src/commands/typegen.js');

    await typegenCommand.parseAsync(['-o', 'edgebase.d.ts'], { from: 'user' });

    const generated = readFileSync(join(testDir, 'edgebase.d.ts'), 'utf-8');
    expect(mockSucceed).toHaveBeenCalledWith('Parsed 1 table(s) from config');
    expect(generated).toContain('export interface Post {');
    expect(generated).toContain('title: string;');
    expect(generated).toContain('authorId?: string; // references → users');
  });
});
