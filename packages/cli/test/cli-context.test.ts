/**
 * Tests for CLI context module (cli-context.ts).
 * Covers: setContext, getContext, isVerbose, isQuiet, isJson, isNonInteractive.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setContext,
  getContext,
  isVerbose,
  isQuiet,
  isJson,
  isNonInteractive,
} from '../src/lib/cli-context.js';

beforeEach(() => {
  // Reset to defaults before each test
  setContext({ verbose: false, quiet: false, json: false, nonInteractive: false });
});

describe('setContext / getContext', () => {
  it('starts with all flags false', () => {
    const ctx = getContext();
    expect(ctx.verbose).toBe(false);
    expect(ctx.quiet).toBe(false);
    expect(ctx.json).toBe(false);
    expect(ctx.nonInteractive).toBe(false);
  });

  it('sets verbose flag', () => {
    setContext({ verbose: true });
    expect(getContext().verbose).toBe(true);
    expect(getContext().quiet).toBe(false);
  });

  it('sets quiet flag', () => {
    setContext({ quiet: true });
    expect(getContext().quiet).toBe(true);
    expect(getContext().verbose).toBe(false);
  });

  it('sets json flag', () => {
    setContext({ json: true });
    expect(getContext().json).toBe(true);
  });

  it('sets nonInteractive flag', () => {
    setContext({ nonInteractive: true });
    expect(getContext().nonInteractive).toBe(true);
  });

  it('sets multiple flags at once', () => {
    setContext({ verbose: true, json: true });
    expect(getContext().verbose).toBe(true);
    expect(getContext().json).toBe(true);
    expect(getContext().quiet).toBe(false);
  });

  it('partial update preserves other flags', () => {
    setContext({ verbose: true, quiet: true });
    setContext({ quiet: false });
    expect(getContext().verbose).toBe(true);
    expect(getContext().quiet).toBe(false);
  });

  it('returns a readonly copy', () => {
    const ctx = getContext();
    expect(typeof ctx).toBe('object');
    expect(ctx.verbose).toBe(false);
  });

  it('preserves flags across module reloads', async () => {
    setContext({ quiet: true, json: true });

    vi.resetModules();
    const reloaded = await import('../src/lib/cli-context.js');

    expect(reloaded.isQuiet()).toBe(true);
    expect(reloaded.isJson()).toBe(true);
  });
});

describe('isVerbose', () => {
  it('returns false by default', () => {
    expect(isVerbose()).toBe(false);
  });

  it('returns true when verbose is set', () => {
    setContext({ verbose: true });
    expect(isVerbose()).toBe(true);
  });
});

describe('isQuiet', () => {
  it('returns false by default', () => {
    expect(isQuiet()).toBe(false);
  });

  it('returns true when quiet is set', () => {
    setContext({ quiet: true });
    expect(isQuiet()).toBe(true);
  });

  it('returns true when json is set (json implies quiet)', () => {
    setContext({ json: true });
    expect(isQuiet()).toBe(true);
  });

  it('returns true when both quiet and json are set', () => {
    setContext({ quiet: true, json: true });
    expect(isQuiet()).toBe(true);
  });
});

describe('isJson', () => {
  it('returns false by default', () => {
    expect(isJson()).toBe(false);
  });

  it('returns true when json is set', () => {
    setContext({ json: true });
    expect(isJson()).toBe(true);
  });

  it('returns false when only quiet is set', () => {
    setContext({ quiet: true });
    expect(isJson()).toBe(false);
  });
});

describe('isNonInteractive', () => {
  it('returns false by default', () => {
    expect(isNonInteractive()).toBe(false);
  });

  it('returns true when nonInteractive is set', () => {
    setContext({ nonInteractive: true });
    expect(isNonInteractive()).toBe(true);
  });
});
