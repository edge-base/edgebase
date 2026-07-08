import { describe, expect, it } from 'vitest';

import { RecordCache, createMemoryRecordCacheAdapter } from '../../src/record-cache.js';

describe('RecordCache', () => {
  it('round-trips tables and meta', async () => {
    const cache = new RecordCache({ adapter: createMemoryRecordCacheAdapter(), name: 't', schemaVersion: 1 });

    await cache.replaceTable('pages', [
      { id: 'a', value: { title: 'A' } },
      { id: 'b', value: { title: 'B' } },
    ]);
    await cache.setMeta('bootstrap:x', { savedAt: 1 });

    expect((await cache.listTable('pages')).map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(await cache.getMeta('bootstrap:x')).toEqual({ savedAt: 1 });
  });

  it('replaceTable swaps wholesale and only touches its own table', async () => {
    const adapter = createMemoryRecordCacheAdapter();
    const cache = new RecordCache({ adapter, name: 't', schemaVersion: 1 });
    await cache.replaceTable('pages', [{ id: 'a', value: 1 }]);
    await cache.replaceTable('blocks:p1', [{ id: 'x', value: 1 }]);

    await cache.replaceTable('pages', [{ id: 'c', value: 2 }]);

    expect((await cache.listTable('pages')).map((r) => r.id)).toEqual(['c']);
    expect((await cache.listTable('blocks:p1')).map((r) => r.id)).toEqual(['x']);
  });

  it('nukes everything when the schema version changes', async () => {
    const adapter = createMemoryRecordCacheAdapter();
    const v1 = new RecordCache({ adapter, name: 't', schemaVersion: 1 });
    await v1.replaceTable('pages', [{ id: 'a', value: 1 }]);
    await v1.setMeta('stamp', 'old');

    const v2 = new RecordCache({ adapter, name: 't', schemaVersion: 2 });

    expect(await v2.listTable('pages')).toHaveLength(0);
    expect(await v2.getMeta('stamp')).toBeUndefined();
    // Same-version reopen keeps data.
    const v2again = new RecordCache({ adapter, name: 't', schemaVersion: 2 });
    await v2.replaceTable('pages', [{ id: 'b', value: 2 }]);
    expect((await v2again.listTable('pages')).map((r) => r.id)).toEqual(['b']);
  });

  it('clear wipes data but keeps the store usable at the same version', async () => {
    const adapter = createMemoryRecordCacheAdapter();
    const cache = new RecordCache({ adapter, name: 't', schemaVersion: 3 });
    await cache.replaceTable('pages', [{ id: 'a', value: 1 }]);

    await cache.clear();

    expect(await cache.listTable('pages')).toHaveLength(0);
    const reopened = new RecordCache({ adapter, name: 't', schemaVersion: 3 });
    await cache.replaceTable('pages', [{ id: 'z', value: 9 }]);
    expect((await reopened.listTable('pages')).map((r) => r.id)).toEqual(['z']);
  });
});
