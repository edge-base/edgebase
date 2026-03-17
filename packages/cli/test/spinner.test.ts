/**
 * Tests for spinner utility (spinner.ts).
 * Covers: spin function returns real ora in normal mode, no-op in quiet mode.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setContext } from '../src/lib/cli-context.js';
import { spin } from '../src/lib/spinner.js';

beforeEach(() => {
  setContext({ verbose: false, quiet: false, json: false });
});

describe('spin', () => {
  it('returns an object with succeed, fail, stop methods', () => {
    const s = spin('test');
    expect(typeof s.succeed).toBe('function');
    expect(typeof s.fail).toBe('function');
    expect(typeof s.stop).toBe('function');
    expect(typeof s.warn).toBe('function');
    expect(typeof s.info).toBe('function');
    // Clean up
    s.stop();
  });

  it('returns a no-op spinner in quiet mode', () => {
    setContext({ quiet: true });
    const s = spin('test');
    // Should not throw
    s.succeed('done');
    s.fail('err');
    s.stop();
    expect(s.isSpinning).toBe(false);
  });

  it('returns a no-op spinner in json mode', () => {
    setContext({ json: true });
    const s = spin('test');
    // Should not throw
    s.succeed('done');
    s.fail('err');
    s.stop();
    expect(s.isSpinning).toBe(false);
  });

  it('allows setting text on no-op spinner without error', () => {
    setContext({ quiet: true });
    const s = spin('initial');
    s.text = 'updated';
    // No-op: text doesn't actually change
    expect(s.text).toBe('');
  });
});
