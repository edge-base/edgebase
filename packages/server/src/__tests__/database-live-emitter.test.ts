import { describe, expect, it, vi } from 'vitest';
import { buildDbLiveChannel, emitDbLiveBatchEvent, emitDbLiveEvent, sendToDatabaseLiveDO } from '../lib/database-live-emitter.js';

describe('buildDbLiveChannel', () => {
  it('builds shared table channels with namespace', () => {
    expect(buildDbLiveChannel('shared', 'posts')).toBe('dblive:shared:posts');
    expect(buildDbLiveChannel('shared', 'posts', undefined, 'p1')).toBe('dblive:shared:posts:p1');
  });

  it('builds dynamic table channels with namespace and instance id', () => {
    expect(buildDbLiveChannel('workspace', 'documents', 'ws-123')).toBe('dblive:workspace:ws-123:documents');
    expect(buildDbLiveChannel('workspace', 'documents', 'ws-123', 'doc-9')).toBe('dblive:workspace:ws-123:documents:doc-9');
  });
});

describe('database-live emitter', () => {
  it('emits shared-table events to namespace-aware table and doc channels', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const get = vi.fn().mockReturnValue({ fetch });
    const env = {
      DATABASE_LIVE: {
        idFromName: vi.fn((name: string) => name),
        get,
      },
    } as any;

    emitDbLiveEvent(env, 'shared', 'posts', 'added', 'post-1', { id: 'post-1' });
    await Promise.resolve();

    expect(env.DATABASE_LIVE.idFromName).toHaveBeenCalledWith('database-live:hub');
    expect(fetch).toHaveBeenCalledTimes(2);
    const tablePayload = JSON.parse(fetch.mock.calls[0]![1].body as string);
    const docPayload = JSON.parse(fetch.mock.calls[1]![1].body as string);
    expect(tablePayload.channel).toBe('dblive:shared:posts');
    expect(docPayload.channel).toBe('dblive:shared:posts:post-1');
  });

  it('emits batch events to the namespace-aware table channel', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const get = vi.fn().mockReturnValue({ fetch });
    const env = {
      DATABASE_LIVE: {
        idFromName: vi.fn((name: string) => name),
        get,
      },
    } as any;

    emitDbLiveBatchEvent(env, 'workspace', 'documents', [{ type: 'modified', docId: 'd1', data: { id: 'd1' } }], 'ws-9');
    await Promise.resolve();

    expect(env.DATABASE_LIVE.idFromName).toHaveBeenCalledWith('database-live:hub');
    expect(fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetch.mock.calls[0]![1].body as string);
    expect(payload.channel).toBe('dblive:workspace:ws-9:documents');
  });

  it('rejects when the database-live DO responds with a server error', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const env = {
      DATABASE_LIVE: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn().mockReturnValue({ fetch }),
      },
    } as any;

    await expect(
      emitDbLiveEvent(env, 'shared', 'posts', 'modified', 'post-1', { id: 'post-1' }),
    ).rejects.toThrow(/DatabaseLiveDO .* failed with 500/);

    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('reuses the same deliveryId across retries for a single handoff', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const env = {
      DATABASE_LIVE: {
        idFromName: vi.fn((name: string) => name),
        get: vi.fn().mockReturnValue({ fetch }),
      },
    } as any;

    await sendToDatabaseLiveDO(env, { channel: 'dblive:shared:posts', event: 'refresh' }, '/internal/broadcast');

    expect(fetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetch.mock.calls[0]![1].body as string);
    const secondBody = JSON.parse(fetch.mock.calls[1]![1].body as string);
    expect(firstBody.deliveryId).toBeTruthy();
    expect(firstBody.deliveryId).toBe(secondBody.deliveryId);
  });
});
