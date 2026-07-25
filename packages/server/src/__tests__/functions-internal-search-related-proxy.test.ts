import { DefaultDbApi, DbRef, type HttpTransport, type TableRef } from '@edge-base/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAdminDbProxy } from '../lib/functions.js';
import { InternalHttpTransport } from '../lib/internal-transport.js';

type InternalSearchRelatedTableRef = TableRef & {
  searchRelated(input: unknown): Promise<unknown>;
};

describe('buildAdminDbProxy internal searchRelated capability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      namespace: 'shared',
      instanceId: undefined,
      tableName: 'signals',
      expectedPath: '/api/db/shared/tables/signals/search-related',
    },
    {
      namespace: 'workspace',
      instanceId: 'ws-1',
      tableName: 'plugin-a/events',
      expectedPath: '/api/db/workspace/ws-1/tables/plugin-a%2Fevents/search-related',
    },
  ])(
    'posts immediately to the internal related-search route for $namespace',
    async ({ namespace, instanceId, tableName, expectedPath }) => {
      const result = {
        items: [{ id: 'result-1' }],
        total: null,
        page: null,
        perPage: null,
        hasMore: false,
        cursor: null,
      };
      const request = vi
        .spyOn(InternalHttpTransport.prototype, 'request')
        .mockResolvedValue(result);
      const adminDb = buildAdminDbProxy({
        databaseNamespace: {} as DurableObjectNamespace,
        config: {
          databases: {
            shared: { tables: { signals: {} } },
            workspace: {
              instance: true,
              tables: { 'plugin-a/events': {} },
            },
          },
        },
      });
      const input = {
        query: 'needle',
        order: [{ field: 'id', direction: 'asc' }],
        limit: 25,
        includeTotal: false,
        relation: {
          localField: 'pageId',
          table: 'pages',
          whereAll: [['workspaceId', '==', 'ws-1']],
        },
      };
      const table = adminDb(namespace, instanceId).table(tableName) as InternalSearchRelatedTableRef;

      const pending = table.searchRelated(input);

      expect(request).toHaveBeenCalledWith('POST', expectedPath, { body: input });
      await expect(pending).resolves.toBe(result);
    },
  );

  it('preserves normal table query and database transaction methods', async () => {
    const request = vi
      .spyOn(InternalHttpTransport.prototype, 'request')
      .mockResolvedValueOnce({
        items: [],
        total: null,
        page: null,
        perPage: 1,
        hasMore: false,
        cursor: null,
      })
      .mockResolvedValueOnce({ results: [] });
    const adminDb = buildAdminDbProxy({
      databaseNamespace: {} as DurableObjectNamespace,
      config: { databases: { shared: { tables: { signals: {} } } } },
    });
    const db = adminDb('shared');

    await db.table('signals').limit(1).includeTotal(false).getList();
    await db.transact([]);

    expect(request).toHaveBeenNthCalledWith(
      1,
      'GET',
      '/api/db/shared/tables/signals',
      { query: { limit: '1', includeTotal: 'false' } },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'POST',
      '/api/db/shared/transact',
      { body: { operations: [] } },
    );
  });

  it('remains callable through a server wrapper that binds table methods', async () => {
    const result = {
      items: [],
      total: null,
      page: null,
      perPage: null,
      hasMore: false,
      cursor: null,
    };
    const request = vi
      .spyOn(InternalHttpTransport.prototype, 'request')
      .mockResolvedValue(result);
    const adminDb = buildAdminDbProxy({
      databaseNamespace: {} as DurableObjectNamespace,
      config: { databases: { shared: { tables: { signals: {} } } } },
    });
    const table = adminDb('shared').table('signals') as InternalSearchRelatedTableRef;
    const wrapped = new Proxy(table, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as InternalSearchRelatedTableRef;

    await expect(wrapped.searchRelated({ query: 'needle' })).resolves.toBe(result);
    expect(request).toHaveBeenCalledWith(
      'POST',
      '/api/db/shared/tables/signals/search-related',
      { body: { query: 'needle' } },
    );
  });

  it('does not add searchRelated to the public core TableRef surface', () => {
    const transport = {
      request: vi.fn(),
      head: vi.fn(),
    } as unknown as HttpTransport;
    const publicDb = new DbRef(new DefaultDbApi(transport), 'shared');
    const publicTable = publicDb.table('signals') as TableRef & {
      searchRelated?: unknown;
    };

    expect('searchRelated' in publicTable).toBe(false);
    expect(publicTable.searchRelated).toBeUndefined();
  });
});
