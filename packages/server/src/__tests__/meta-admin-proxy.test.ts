/**
 * Meta-test: admin.ts DO proxy route count.
 *
 * Counts stub.fetch() and fetchDOWithRetry(stub,) calls in admin.ts.
 * When a new proxy route is added, this count must be updated —
 * forcing the developer to also add corresponding contract tests.
 */
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

describe('admin.ts DO proxy count', () => {
  const source = readFileSync(
    new URL('../routes/admin.ts', import.meta.url),
    'utf-8',
  );

  // Expected counts — update when adding new proxy routes
  // stub.fetch() direct calls + fetchDOWithRetry(stub, ...) wrapped calls
  // Auth shard.fetch() calls removed: user management now uses D1 service directly
  // databaseLiveDO.fetch() calls removed: broadcast now uses /api/db/broadcast worker route
  const EXPECTED_STUB_FETCH = 4;
  const EXPECTED_STUB_RETRY = 4;
  const EXPECTED_SHARD_FETCH = 0;
  const EXPECTED_TOTAL = EXPECTED_STUB_FETCH + EXPECTED_STUB_RETRY + EXPECTED_SHARD_FETCH; // 8

  it(`stub.fetch() count = ${EXPECTED_STUB_FETCH}`, () => {
    const count = (source.match(/stub\.fetch\(/g) || []).length;
    expect(count).toBe(EXPECTED_STUB_FETCH);
  });

  it(`fetchDOWithRetry(stub, ...) count = ${EXPECTED_STUB_RETRY}`, () => {
    const count = (source.match(/fetchDOWithRetry\(stub,/g) || []).length;
    expect(count).toBe(EXPECTED_STUB_RETRY);
  });

  it(`shard.fetch() count = ${EXPECTED_SHARD_FETCH}`, () => {
    const count = (source.match(/shard\.fetch\(/g) || []).length;
    expect(count).toBe(EXPECTED_SHARD_FETCH);
  });

  it(`total DO proxy routes = ${EXPECTED_TOTAL}`, () => {
    const stubCount = (source.match(/stub\.fetch\(/g) || []).length;
    const retryCount = (source.match(/fetchDOWithRetry\(stub,/g) || []).length;
    const shardCount = (source.match(/shard\.fetch\(/g) || []).length;
    const total = stubCount + retryCount + shardCount;
    expect(total).toBe(EXPECTED_TOTAL);
  });
});
