import { describe, expect, it } from 'vitest';
import { getLocalDevPostgresExecOptions } from '../lib/postgres-executor.js';

describe('local PostgreSQL sidecar runtime boundary', () => {
  const sensitiveBindings = {
    EDGEBASE_DEV_SIDECAR_PORT: '8788',
    JWT_ADMIN_SECRET: 'synthetic-admin-signing-secret',
  };

  it('requires the CLI-owned local-development runtime mode', () => {
    expect(getLocalDevPostgresExecOptions(sensitiveBindings, 'primary')).toBeUndefined();
    expect(getLocalDevPostgresExecOptions({
      ...sensitiveBindings,
      EDGEBASE_RUNTIME_MODE: 'cloudflare',
    }, 'primary')).toBeUndefined();
    expect(getLocalDevPostgresExecOptions({
      ...sensitiveBindings,
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
    }, 'primary')).toBeUndefined();

    expect(getLocalDevPostgresExecOptions({
      ...sensitiveBindings,
      EDGEBASE_RUNTIME_MODE: 'local-development',
    }, 'primary')).toEqual({
      namespace: 'primary',
      sidecarPort: '8788',
      sidecarSecret: 'synthetic-admin-signing-secret',
    });
  });
});
