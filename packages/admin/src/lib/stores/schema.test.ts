import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  api: {
    fetch: mocks.apiFetch,
  },
}));

describe('schemaStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    mocks.apiFetch.mockReset();
  });

  it('loads schema data and exposes alphabetized namespace groups', async () => {
    mocks.apiFetch.mockResolvedValue({
      namespaces: {
        shared: { provider: 'd1', dynamic: false },
        workspace: { provider: 'do', dynamic: true },
      },
      schema: {
        posts: {
          namespace: 'shared',
          provider: 'd1',
          fields: { title: { type: 'string' } },
        },
        accounts: {
          namespace: 'shared',
          provider: 'd1',
          fields: { email: { type: 'string' } },
        },
        tasks: {
          namespace: 'workspace',
          dynamic: true,
          fields: { done: { type: 'boolean' } },
        },
      },
    });

    const { schemaStore, tablesByNamespace, tableNames, namespaceNames } = await import('./schema');

    await expect(schemaStore.loadSchema()).resolves.toEqual({
      posts: expect.any(Object),
      accounts: expect.any(Object),
      tasks: expect.any(Object),
    });

    let grouped: Record<string, Array<{ name: string }>> | undefined;
    let names: string[] | undefined;
    let namespaces: string[] | undefined;
    const stopGroups = tablesByNamespace.subscribe((value) => {
      grouped = value;
    });
    const stopNames = tableNames.subscribe((value) => {
      names = value;
    });
    const stopNamespaces = namespaceNames.subscribe((value) => {
      namespaces = value;
    });

    expect(grouped?.shared.map((entry) => entry.name)).toEqual(['accounts', 'posts']);
    expect(grouped?.workspace.map((entry) => entry.name)).toEqual(['tasks']);
    expect(names).toEqual(['accounts', 'posts', 'tasks']);
    expect(namespaces).toEqual(['shared', 'workspace']);

    stopGroups();
    stopNames();
    stopNamespaces();
  });

  it('waits for schema propagation and times out with the last meaningful error', async () => {
    vi.useFakeTimers();
    mocks.apiFetch
      .mockRejectedValueOnce(new Error('schema unavailable'))
      .mockResolvedValueOnce({ schema: { posts: { namespace: 'shared', fields: {} } }, namespaces: { shared: { provider: 'd1', dynamic: false } } });

    const { schemaStore } = await import('./schema');
    const promise = schemaStore.waitForSchema((schema) => Boolean(schema.posts), {
      timeoutMs: 1000,
      intervalMs: 100,
      timeoutMessage: 'timed out',
    });

    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toEqual({
      posts: { namespace: 'shared', fields: {} },
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith('data/schema');
  });

  it('waits for a table to become queryable before resolving', async () => {
    vi.useFakeTimers();
    mocks.apiFetch
      .mockResolvedValueOnce({ schema: { posts: { namespace: 'shared', fields: {} } }, namespaces: { shared: { provider: 'd1', dynamic: false } } })
      .mockRejectedValueOnce(new Error('table not ready'))
      .mockResolvedValueOnce({ rows: [], cursor: null });

    const { schemaStore } = await import('./schema');
    await schemaStore.loadSchema();

    const promise = schemaStore.waitForTableReady('posts', {
      timeoutMs: 1000,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(150);
    await expect(promise).resolves.toBeUndefined();
    expect(mocks.apiFetch).toHaveBeenLastCalledWith('data/tables/posts/records?limit=1');
  });

  it('waits for a namespace to appear before resolving', async () => {
    vi.useFakeTimers();
    mocks.apiFetch
      .mockResolvedValueOnce({ schema: {}, namespaces: {} })
      .mockResolvedValueOnce({
        schema: {},
        namespaces: {
          billing: { provider: 'postgres', dynamic: false },
        },
      });

    const { schemaStore } = await import('./schema');
    await schemaStore.loadSchema();

    const promise = schemaStore.waitForNamespaceReady('billing', {
      timeoutMs: 1000,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(150);
    await expect(promise).resolves.toBeUndefined();
    expect(mocks.apiFetch).toHaveBeenLastCalledWith('data/schema');
  });

  it('skips record probing for dynamic tables that need an instance id', async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      namespaces: {
        workspace: { provider: 'do', dynamic: true },
      },
      schema: {
        tasks: {
          namespace: 'workspace',
          dynamic: true,
          fields: {},
        },
      },
    });

    const { schemaStore } = await import('./schema');
    await schemaStore.loadSchema();

    await expect(
      schemaStore.waitForTableReady('tasks', {
        timeoutMs: 1000,
        intervalMs: 100,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null and stores an error message when schema loading fails', async () => {
    mocks.apiFetch.mockRejectedValue(new Error('boom'));
    const { schemaStore } = await import('./schema');

    await expect(schemaStore.loadSchema()).resolves.toBeNull();

    let snapshot:
      | { schema: Record<string, unknown>; namespaces: Record<string, unknown>; loading: boolean; error: string | null }
      | undefined;
    const unsubscribe = schemaStore.subscribe((value) => {
      snapshot = value;
    });

    expect(snapshot).toEqual({
      schema: {},
      namespaces: {},
      loading: false,
      error: 'boom',
    });
    unsubscribe();
  });
});
