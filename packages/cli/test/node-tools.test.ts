import { describe, expect, it } from 'vitest';
import { resolveTsxCommand } from '../src/lib/node-tools.js';

describe('node-tools', () => {
  it('resolves the local tsx cli entry instead of falling back to npx', () => {
    const resolved = resolveTsxCommand();

    expect(resolved.command).toBe(process.execPath);
    expect(resolved.argsPrefix).toHaveLength(1);
    expect(resolved.argsPrefix[0]).toMatch(/tsx[\\/].*dist[\\/]cli\.mjs$/);
  });
});
