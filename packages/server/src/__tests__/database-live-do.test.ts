import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;

    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

describe('DatabaseLiveDO delivery idempotency', () => {
  it('ignores duplicate internal change events with the same deliveryId', async () => {
    const { DatabaseLiveDO } = await import('../durable-objects/database-live-do.js');

    const ctx = {
      acceptWebSocket: vi.fn(),
      getWebSockets: vi.fn(() => []),
      getTags: vi.fn(() => []),
    } as any;
    const live = new DatabaseLiveDO(ctx, { EDGEBASE_CONFIG: {} }) as any;
    live.broadcastWithFilters = vi.fn().mockResolvedValue(undefined);

    const payload = {
      deliveryId: 'delivery-1',
      type: 'modified',
      channel: 'dblive:shared:posts',
      table: 'posts',
      docId: 'post-1',
      data: { id: 'post-1', title: 'hello' },
      timestamp: '2026-03-24T00:00:00.000Z',
    };

    const first = await live.handleInternalEvent(new Request('http://internal/internal/event', {
      method: 'POST',
      body: JSON.stringify(payload),
    }));
    const second = await live.handleInternalEvent(new Request('http://internal/internal/event', {
      method: 'POST',
      body: JSON.stringify(payload),
    }));

    await expect(first.json()).resolves.toEqual({ ok: true });
    await expect(second.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(live.broadcastWithFilters).toHaveBeenCalledTimes(1);
  });
});
