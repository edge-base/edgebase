import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

describe('room rate-limit scopes', () => {
  it('keeps signal/media/admin buckets independent per connection', async () => {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');

    const room: any = Object.create(RoomRuntimeBaseDO.prototype);
    room.namespaceConfig = {
      rateLimit: {
        actions: 2,
        signals: 4,
        media: 1,
        admin: 1,
      },
    };
    room.rateBuckets = new Map();

    expect(room.checkRateLimit('conn-1', 'signals')).toBe(true);
    expect(room.checkRateLimit('conn-1', 'signals')).toBe(true);
    expect(room.checkRateLimit('conn-1', 'signals')).toBe(true);
    expect(room.checkRateLimit('conn-1', 'signals')).toBe(true);
    expect(room.checkRateLimit('conn-1', 'signals')).toBe(false);

    expect(room.checkRateLimit('conn-1', 'media')).toBe(true);
    expect(room.checkRateLimit('conn-1', 'media')).toBe(false);

    expect(room.checkRateLimit('conn-1', 'admin')).toBe(true);
    expect(room.checkRateLimit('conn-1', 'admin')).toBe(false);

    expect(room.checkRateLimit('conn-1', 'actions')).toBe(true);
    expect(room.checkRateLimit('conn-1', 'actions')).toBe(true);
    expect(room.checkRateLimit('conn-1', 'actions')).toBe(false);
  });
});
