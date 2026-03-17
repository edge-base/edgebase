/**
 * Tests for update-check module (update-check.ts).
 * Tests the update banner display logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setContext } from '../src/lib/cli-context.js';

const execFileSyncMock = vi.fn(() => '0.2.0\n');

// Mock child_process to avoid real npm calls
vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    homedir: () => (
      (globalThis as Record<string, unknown>).__testHomeDir as string | undefined
    ) ?? original.homedir(),
  };
});

let tmpDir: string;

beforeEach(async () => {
  const { mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  tmpDir = join(tmpdir(), `eb-update-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  (globalThis as Record<string, unknown>).__testHomeDir = tmpDir;
  execFileSyncMock.mockReset();
  execFileSyncMock.mockReturnValue('0.2.0\n');
  vi.resetModules();

  // Reset context
  setContext({ verbose: false, quiet: false, json: false });
});

afterEach(async () => {
  const { rmSync } = await import('node:fs');
  rmSync(tmpDir, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>).__testHomeDir;
  vi.restoreAllMocks();
});

describe('update-check', () => {
  it('does not crash when called', async () => {
    const { checkForUpdates } = await import('../src/lib/update-check.js');
    // Should not throw
    expect(() => checkForUpdates('0.1.0')).not.toThrow();
  });

  it('is silent in quiet mode', async () => {
    setContext({ quiet: true });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { checkForUpdates } = await import('../src/lib/update-check.js');
    checkForUpdates('0.1.0');
    // Should not log anything in quiet mode
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('is silent in json mode', async () => {
    setContext({ json: true });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { checkForUpdates } = await import('../src/lib/update-check.js');
    checkForUpdates('0.1.0');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('does not announce a lower registry version as an update', async () => {
    execFileSyncMock.mockReturnValue('0.0.0\n');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { checkForUpdates } = await import('../src/lib/update-check.js');
    checkForUpdates('0.1.0');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
