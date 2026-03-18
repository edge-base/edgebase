import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EdgeBaseError as UnifiedEdgeBaseError,
  createAdminClient as createUnifiedAdminClient,
  createClient as createUnifiedClient,
  deleteField as unifiedDeleteField,
  increment as unifiedIncrement,
} from '../src/index.js';
import { EdgeBaseError, deleteField, increment } from '@edge-base/core';
import { createAdminClient } from '@edge-base/admin';
import { createClient } from '@edge-base/web';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('@edge-base/sdk unified exports', () => {
  it('re-exports the core field operation helpers without wrapping them', () => {
    expect(unifiedIncrement).toBe(increment);
    expect(unifiedDeleteField).toBe(deleteField);
    expect(UnifiedEdgeBaseError).toBe(EdgeBaseError);
  });

  it('re-exports the web and admin client factories without changing their identity', () => {
    expect(createUnifiedClient).toBe(createClient);
    expect(createUnifiedAdminClient).toBe(createAdminClient);
  });

  it('can construct client and admin SDK instances through the unified entrypoint', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = createUnifiedClient('http://localhost:8787');
    expect(client.auth).toBeTruthy();
    expect(client.db('shared')).toBeTruthy();
    client.destroy();

    const admin = createUnifiedAdminClient('http://localhost:8787', {
      serviceKey: 'test-service-key',
    });
    expect(admin.auth).toBeTruthy();
    expect(admin.db('shared')).toBeTruthy();
    admin.destroy();
  });
});
