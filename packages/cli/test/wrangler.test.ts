import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveWranglerTool, wranglerArgs, wranglerCommand, wranglerHint } from '../src/lib/wrangler.js';

describe('wrangler helper', () => {
  it('builds args that invoke the resolved wrangler bin directly', () => {
    const args = wranglerArgs(['wrangler', 'whoami']);
    expect(args[0]).toContain('wrangler');
    expect(args.at(-1)).toBe('whoami');
  });

  it('renders a runnable hint command', () => {
    expect(wranglerCommand()).toBe(process.execPath);
    expect(wranglerHint(['wrangler', 'login'])).toContain('wrangler');
    expect(wranglerHint(['wrangler', 'login'])).toContain('login');
  });

  it('prefers a project-local wrangler installation when one exists', () => {
    const cwd = process.cwd();
    const tempDir = mkdtempSync(join(tmpdir(), 'eb-wrangler-test-'));
    const packageDir = join(tempDir, 'node_modules', 'wrangler');
    const binDir = join(packageDir, 'bin');

    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: 'wrangler',
        version: '0.0.0-test',
        bin: {
          wrangler: 'bin/wrangler.js',
        },
      }),
    );
    writeFileSync(join(binDir, 'wrangler.js'), '#!/usr/bin/env node\n');

    try {
      process.chdir(tempDir);
      const args = wranglerArgs(['wrangler', 'whoami']);
      const tool = resolveWranglerTool();
      expect(args[0].replace('/private', '')).toBe(join(binDir, 'wrangler.js').replace('/private', ''));
      expect(args[1]).toBe('whoami');
      expect(tool.command).toBe(process.execPath);
      expect(tool.argsPrefix[0].replace('/private', '')).toBe(join(binDir, 'wrangler.js').replace('/private', ''));
    } finally {
      process.chdir(cwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
