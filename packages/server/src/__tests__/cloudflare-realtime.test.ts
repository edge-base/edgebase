import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CloudflareRealtimeClient,
  assertCloudflareRealtimeConfig,
  createCloudflareRealtimeClient,
  hasCloudflareRealtimeConfig,
} from '../lib/cloudflare-realtime.js';

describe('cloudflare realtime helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('detects whether the required realtime config is present', () => {
    expect(hasCloudflareRealtimeConfig({})).toBe(false);
    expect(hasCloudflareRealtimeConfig({
      CF_REALTIME_APP_ID: ' app-123 ',
      CF_REALTIME_APP_SECRET: ' secret-456 ',
    })).toBe(true);
  });

  it('normalizes realtime config and defaults the base URL', () => {
    expect(assertCloudflareRealtimeConfig({
      CF_REALTIME_APP_ID: ' app-123 ',
      CF_REALTIME_APP_SECRET: ' secret-456 ',
      CF_REALTIME_TURN_KEY_ID: ' key-1 ',
      CF_REALTIME_TURN_API_TOKEN: ' token-1 ',
    })).toEqual({
      appId: 'app-123',
      appSecret: 'secret-456',
      baseUrl: 'https://rtc.live.cloudflare.com/v1',
      turnKeyId: 'key-1',
      turnApiToken: 'token-1',
    });

    expect(() => assertCloudflareRealtimeConfig({
      CF_REALTIME_APP_ID: 'missing-secret',
    })).toThrow('Cloudflare Realtime is not configured');
  });

  it('creates a realtime client and sends authenticated session requests', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ sessionId: 'sess-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createCloudflareRealtimeClient({
      CF_REALTIME_APP_ID: 'app-123',
      CF_REALTIME_APP_SECRET: 'secret-456',
    } as never);

    expect(client).toBeInstanceOf(CloudflareRealtimeClient);
    await expect(client.createSession({
      sessionDescription: {
        sdp: 'offer-sdp',
        type: 'offer',
      },
    }, {
      thirdparty: true,
      correlationId: 'corr-1',
    })).resolves.toEqual({ sessionId: 'sess-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://rtc.live.cloudflare.com/v1/apps/app-123/sessions/new?thirdparty=true&correlationId=corr-1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-456',
        'Content-Type': 'application/json',
      },
    });
  });

  it('uses TURN credentials when generating ICE servers', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        iceServers: [{ urls: 'turn:global.example.com', username: 'user', credential: 'pass' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new CloudflareRealtimeClient({
      CF_REALTIME_APP_ID: 'app-123',
      CF_REALTIME_APP_SECRET: 'secret-456',
      CF_REALTIME_BASE_URL: 'https://rtc.example.com/base/',
      CF_REALTIME_TURN_KEY_ID: 'turn-key',
      CF_REALTIME_TURN_API_TOKEN: 'turn-token',
    });

    await expect(client.generateIceServers(120)).resolves.toEqual({
      iceServers: [{ urls: 'turn:global.example.com', username: 'user', credential: 'pass' }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://rtc.example.com/base/turn/keys/turn-key/credentials/generate-ice-servers',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer turn-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 120 }),
      },
    );
  });
});
