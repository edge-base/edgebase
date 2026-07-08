import { describe, expect, it } from 'vitest';

import {
  DurableOutbox,
  createMemoryOutboxAdapter,
  type OutboxLockManager,
} from '../../src/durable-outbox.js';

/**
 * Fake Web Locks manager: locks in `held` behave as owned by a live tab
 * (ifAvailable hands the callback null); everything else is acquirable.
 */
function fakeLocks(held: Set<string>): OutboxLockManager {
  return {
    async request(name, options, callback) {
      if (options.ifAvailable && held.has(name)) return callback(null);
      return callback({ name });
    },
  };
}

describe('DurableOutbox', () => {
  it('preserves first-write seq order across per-key merges', async () => {
    const adapter = createMemoryOutboxAdapter<string>();
    const outbox = new DurableOutbox<string>({ adapter, locks: null, name: 'test', tabId: 'a' });

    await outbox.set('create:b1', 'create');
    await outbox.set('block:b1', 'patch-1');
    await outbox.set('delete:x', 'delete');
    // Re-set an existing key: value updates, seq (replay position) stays.
    await outbox.set('block:b1', 'patch-2');

    const entries = await outbox.entries();
    expect(entries.map((entry) => entry.entryKey)).toEqual(['create:b1', 'block:b1', 'delete:x']);
    expect(entries[1]?.value).toBe('patch-2');
  });

  it('ack removes only the acked key for this tab', async () => {
    const adapter = createMemoryOutboxAdapter<string>();
    const mine = new DurableOutbox<string>({ adapter, locks: null, name: 'test', tabId: 'a' });
    const other = new DurableOutbox<string>({ adapter, locks: null, name: 'test', tabId: 'b' });

    await mine.set('block:b1', 'mine');
    await other.set('block:b1', 'other');
    await mine.ack('block:b1');

    expect(await mine.entries()).toHaveLength(0);
    expect((await other.entries())[0]?.value).toBe('other');
  });

  it('claims only dead tabs and reassigns their entries in seq order', async () => {
    const adapter = createMemoryOutboxAdapter<string>();
    const held = new Set(['test::tab::alive']);
    const locks = fakeLocks(held);

    const dead = new DurableOutbox<string>({ adapter, locks, name: 'test', tabId: 'dead' });
    const alive = new DurableOutbox<string>({ adapter, locks, name: 'test', tabId: 'alive' });
    await dead.set('create:b1', 'first');
    await alive.set('block:live', 'still-owned');
    await dead.set('block:b1', 'second');

    const claimer = new DurableOutbox<string>({ adapter, locks, name: 'test', tabId: 'fresh' });
    const claimed = await claimer.claimAbandoned();

    expect(claimed.map((entry) => entry.value)).toEqual(['first', 'second']);
    expect(claimed.every((entry) => entry.tabId === 'fresh')).toBe(true);
    // Claimed entries are now durable under the claiming tab...
    expect((await claimer.entries()).map((entry) => entry.value)).toEqual(['first', 'second']);
    // ...and the live tab's entries were left alone.
    expect((await alive.entries())[0]?.value).toBe('still-owned');
  });

  it('treats every foreign tab as dead when no lock manager exists', async () => {
    const adapter = createMemoryOutboxAdapter<string>();
    const previous = new DurableOutbox<string>({ adapter, locks: null, name: 'test', tabId: 'old' });
    await previous.set('block:b1', 'leftover');

    const fresh = new DurableOutbox<string>({ adapter, locks: null, name: 'test', tabId: 'new' });
    const claimed = await fresh.claimAbandoned();

    expect(claimed.map((entry) => entry.value)).toEqual(['leftover']);
  });

  it('clear wipes the store', async () => {
    const adapter = createMemoryOutboxAdapter<string>();
    const outbox = new DurableOutbox<string>({ adapter, locks: null, name: 'test', tabId: 'a' });
    await outbox.set('block:b1', 'x');

    await outbox.clear();

    expect(await outbox.entries()).toHaveLength(0);
  });
});
