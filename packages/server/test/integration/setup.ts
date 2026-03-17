import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';
import { resetSchemaInit } from '../../src/lib/auth-d1';
import { _resetD1SchemaCache } from '../../src/lib/d1-schema-init';

// Inject the SELF Service Binding into globalThis so all integration tests can access it
// This allows tests to simply call (globalThis as any).SELF.fetch(...)
(globalThis as any).SELF = env.SELF;
(globalThis as any).env = env;

// Reset the module-level schemaInitialized flags before each test file.
// Ensures ensureAuthSchema() and ensureD1Schema() re-run if D1 state was cleared between files.
beforeAll(() => {
  resetSchemaInit();
  _resetD1SchemaCache();
});
