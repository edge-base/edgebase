import { defineConfig } from '@edgebase-fun/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  executeAdminDbQuery,
  resolveAdminInstanceOptions,
  serializeAdminInstanceDiscovery,
} from '../lib/admin-db-target.js';

describe('admin db target helpers', () => {
  it('serializes manual discovery metadata with fallback defaults', () => {
    expect(
      serializeAdminInstanceDiscovery(undefined, { fallbackManual: true }),
    ).toEqual({
      source: 'manual',
      targetLabel: 'Target',
      placeholder: 'Target ID',
      helperText: 'Enter a target ID to browse records and run queries for this table.',
    });

    expect(serializeAdminInstanceDiscovery({
      source: 'manual',
      targetLabel: 'Workspace',
      placeholder: 'Workspace ID',
      helperText: 'Pick a workspace.',
    })).toEqual({
      source: 'manual',
      targetLabel: 'Workspace',
      placeholder: 'Workspace ID',
      helperText: 'Pick a workspace.',
    });
  });

  it('executes admin SQL against D1-backed static namespaces', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [{ id: 'row-1', label: 'Acme' }],
    });
    const prepare = vi.fn(() => ({ all }));

    const result = await executeAdminDbQuery({
      env: {
        DB_D1_SHARED: {
          prepare,
        },
      } as any,
      config: defineConfig({
        databases: {
          shared: {
            provider: 'd1',
            tables: {
              posts: {},
            },
          },
        },
      }),
      namespace: 'shared',
      sql: 'SELECT id, label FROM posts',
    });

    expect(prepare).toHaveBeenCalledWith('SELECT id, label FROM posts');
    expect(result).toEqual({
      columns: ['id', 'label'],
      rows: [{ id: 'row-1', label: 'Acme' }],
      rowCount: 1,
    });
  });

  it('returns empty suggestions for manual dynamic instance discovery', async () => {
    const result = await resolveAdminInstanceOptions({
      env: {} as any,
      config: defineConfig({
        databases: {
          workspace: {
            instance: true,
            admin: {
              instances: {
                source: 'manual',
                targetLabel: 'Workspace',
                placeholder: 'Workspace ID',
                helperText: 'Enter a workspace ID.',
              },
            },
            tables: {
              members: {},
            },
          },
        },
      }),
      namespace: 'workspace',
      query: 'acme',
      limit: 20,
    });

    expect(result).toEqual({
      discovery: {
        source: 'manual',
        targetLabel: 'Workspace',
        placeholder: 'Workspace ID',
        helperText: 'Enter a workspace ID.',
      },
      items: [],
    });
  });
});
