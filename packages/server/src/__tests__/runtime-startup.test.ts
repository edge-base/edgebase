import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

afterEach(() => {
  vi.resetModules();
  if (typeof globalThis === 'object' && globalThis !== null) {
    delete (globalThis as Record<string, unknown>).__EDGEBASE_RUNTIME_CONFIG__;
  }
});

describe('runtime startup bootstrap', () => {
  it('initializes runtime config idempotently for lazy server and DO entrypoints', async () => {
    const { ensureServerStartup } = await import('../lib/runtime-startup.js');
    const { parseConfig } = await import('../lib/do-router.js');

    await expect(ensureServerStartup()).resolves.toBeUndefined();
    const firstConfig = parseConfig();

    await expect(ensureServerStartup()).resolves.toBeUndefined();
    const secondConfig = parseConfig();

    expect(firstConfig).toEqual(secondConfig);
    expect(secondConfig).toBeTypeOf('object');
  });
});
