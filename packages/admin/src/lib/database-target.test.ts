import { describe, expect, it } from 'vitest';
import { buildAdminRecordsPath, buildTableHref, normalizeInstanceId } from './database-target';

describe('database target helpers', () => {
  it('builds admin records paths with optional instance context and query params', () => {
    expect(
      buildAdminRecordsPath('tasks', {
        instanceId: 'ws-1',
        params: { limit: 20, offset: 40 },
      }),
    ).toBe('data/tables/tasks/records?instanceId=ws-1&limit=20&offset=40');
    expect(buildAdminRecordsPath('posts')).toBe('data/tables/posts/records');
  });

  it('builds table hrefs that preserve instance, search, and non-default tab state', () => {
    expect(
      buildTableHref('/admin', 'tasks', {
        instanceId: 'ws-1',
        search: 'alice',
        tab: 'sql',
      }),
    ).toBe('/admin/database/tables/tasks?instance=ws-1&search=alice&tab=sql');
    expect(buildTableHref('/admin', 'posts', { tab: 'records' })).toBe(
      '/admin/database/tables/posts',
    );
  });

  it('normalizes blank instance ids away', () => {
    expect(normalizeInstanceId('  ws-1  ')).toBe('ws-1');
    expect(normalizeInstanceId('   ')).toBeUndefined();
    expect(normalizeInstanceId(undefined)).toBeUndefined();
  });
});
