import { describe, expect, it } from 'vitest';
import { _migrateInternals } from '../src/commands/migrate.js';

const { listConfigDataNamespaces, resolveMigrationTargets } = _migrateInternals;

describe('migrate namespace resolution', () => {
  it('lists database namespaces from config', () => {
    expect(listConfigDataNamespaces({
      databases: {
        app: { tables: { posts: {} } },
        workspace: { instance: true, tables: { docs: {} } },
      },
    })).toEqual(['app', 'workspace']);
  });

  it('uses an explicit namespace as a data-only migration target', () => {
    expect(resolveMigrationTargets({
      scope: 'all',
      namespace: 'app',
      configNamespaces: ['app', 'workspace'],
      configState: 'loaded',
    })).toEqual({
      scope: 'data',
      namespaces: ['app'],
    });
  });

  it('auto-expands data scope to every configured namespace', () => {
    expect(resolveMigrationTargets({
      scope: 'data',
      configNamespaces: ['app', 'workspace'],
      configState: 'loaded',
    })).toEqual({
      scope: 'data',
      namespaces: ['app', 'workspace'],
    });
  });

  it('downgrades all -> auth when config has no data namespaces', () => {
    expect(resolveMigrationTargets({
      scope: 'all',
      configNamespaces: [],
      configState: 'loaded',
    })).toEqual({
      scope: 'auth',
    });
  });

  it('fails when data scope has no resolvable namespaces', () => {
    expect(() => resolveMigrationTargets({
      scope: 'data',
      configNamespaces: [],
      configState: 'failed',
    })).toThrow(/Could not determine data namespaces/);
  });
});
