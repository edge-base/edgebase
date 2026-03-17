import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type SchemaState = {
    schema: Record<string, {
      namespace: string;
      dynamic?: boolean;
      instanceDiscovery?: { targetLabel?: string };
      fields?: Record<string, unknown>;
    }>;
  };

  let schemaState: SchemaState = {
    schema: {
      posts: { namespace: 'shared', fields: { id: {}, title: {} } },
      members: {
        namespace: 'workspace',
        dynamic: true,
        instanceDiscovery: {
          targetLabel: 'Workspace',
        },
        fields: { id: {}, email: {} },
      },
      comments: { namespace: 'shared', fields: { id: {}, body: {} } },
    },
  };
  const subscribers = new Set<(value: SchemaState) => void>();

  return {
    apiFetch: vi.fn(),
    toastError: vi.fn(),
    schemaStore: {
      subscribe(run: (value: SchemaState) => void) {
        run(schemaState);
        subscribers.add(run);
        return () => subscribers.delete(run);
      },
      loadSchema: vi.fn().mockResolvedValue(schemaState.schema),
    },
  };
});

vi.mock('$lib/api', () => ({
  api: {
    fetch: mocks.apiFetch,
  },
}));

vi.mock('$lib/stores/schema', () => ({
  schemaStore: mocks.schemaStore,
}));

vi.mock('$lib/stores/toast.svelte', () => ({
  toastError: mocks.toastError,
}));

vi.mock('$lib/components/ui/SqlEditor.svelte', async () => ({
  default: (await import('../../../test/fixtures/MockSqlEditor.svelte')).default,
}));

vi.mock('$lib/components/ui/DataGrid.svelte', async () => ({
  default: (await import('../../../test/fixtures/MockDataGrid.svelte')).default,
}));

import TableSqlTab from './TableSqlTab.svelte';

describe('TableSqlTab', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.toastError.mockReset();
    mocks.schemaStore.loadSchema.mockClear();
  });

  it('executes SQL against the current table target', async () => {
    mocks.apiFetch.mockResolvedValue({
      columns: ['id', 'title'],
      rows: [{ id: '1', title: 'Hello' }],
      rowCount: 1,
      time: 5,
    });

    render(TableSqlTab, {
      props: {
        tableName: 'posts',
        namespace: 'shared',
      },
    });

    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Single DB')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Execute' }));

    await waitFor(() => {
      expect(mocks.apiFetch).toHaveBeenCalledWith('data/sql', {
        method: 'POST',
        body: {
          namespace: 'shared',
          id: undefined,
          sql: 'SELECT * FROM "posts" LIMIT 100;',
        },
      });
    });

    expect(await screen.findByText('1 row · 5ms')).toBeInTheDocument();
    expect(screen.getByTestId('mock-data-grid-columns')).toHaveTextContent('id, title');
  });

  it('shows a friendly tenant label for dynamic targets', () => {
    render(TableSqlTab, {
      props: {
        tableName: 'members',
        namespace: 'workspace',
        instanceId: 'ws-1',
      },
    });

    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Per-tenant DB')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('ws-1')).toBeInTheDocument();
  });
});
