import { describe, expect, it } from 'vitest';
import { getRecentInstances, rememberRecentInstance } from './instance-discovery';

describe('instance discovery history', () => {
  it('stores recent instances per namespace and keeps newest first', () => {
    rememberRecentInstance('workspace', { id: 'ws-1', label: 'Acme' });
    rememberRecentInstance('workspace', { id: 'ws-2', label: 'Beta' });
    rememberRecentInstance('workspace', { id: 'ws-1', label: 'Acme Inc.' });

    expect(getRecentInstances('workspace')).toEqual([
      { id: 'ws-1', label: 'Acme Inc.', description: undefined },
      { id: 'ws-2', label: 'Beta', description: undefined },
    ]);
  });

  it('isolates recent instances by namespace', () => {
    rememberRecentInstance('workspace', { id: 'ws-1', label: 'Workspace' });
    rememberRecentInstance('user', { id: 'user-1', label: 'User' });

    expect(getRecentInstances('workspace')).toEqual([
      { id: 'ws-1', label: 'Workspace', description: undefined },
    ]);
    expect(getRecentInstances('user')).toEqual([
      { id: 'user-1', label: 'User', description: undefined },
    ]);
  });
});
