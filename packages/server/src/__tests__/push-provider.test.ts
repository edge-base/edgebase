import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPushProvider, resolveFcmEndpoints } from '../lib/push-provider.js';
import type { Env } from '../types.js';

describe('resolveFcmEndpoints', () => {
  it('uses MOCK_FCM_BASE_URL from env when present', () => {
    const endpoints = resolveFcmEndpoints(
      'test-project',
      {
        oauth2TokenUrl: 'http://localhost:9099/token',
        fcmSendUrl: 'http://localhost:9099/v1/projects/test-project/messages:send',
        iidBaseUrl: 'http://localhost:9099',
      },
      { MOCK_FCM_BASE_URL: 'http://host.docker.internal:9099/' } as Partial<Env> as Env,
    );

    expect(endpoints).toEqual({
      oauth2TokenUrl: 'http://host.docker.internal:9099/token',
      fcmSendUrl: 'http://host.docker.internal:9099/v1/projects/test-project/messages:send',
      iidBaseUrl: 'http://host.docker.internal:9099',
    });
  });

  it('falls back to configured endpoints when mock override is absent', () => {
    const endpoints = resolveFcmEndpoints(
      'test-project',
      {
        oauth2TokenUrl: 'https://oauth.example.com/token',
        fcmSendUrl: 'https://push.example.com/send',
        iidBaseUrl: 'https://iid.example.com',
      },
      {} as Partial<Env> as Env,
    );

    expect(endpoints).toEqual({
      oauth2TokenUrl: 'https://oauth.example.com/token',
      fcmSendUrl: 'https://push.example.com/send',
      iidBaseUrl: 'https://iid.example.com',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bypasses OAuth token exchange when MOCK_FCM_BASE_URL is configured', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe('https://mock.example/v1/projects/test-project/messages:send');
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer mock-access-token');
      return new Response(JSON.stringify({ name: 'projects/test-project/messages/mock-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createPushProvider(
      {
        fcm: {
          projectId: 'test-project',
          serviceAccount: JSON.stringify({
            client_email: 'push-suite@test-project.iam.gserviceaccount.com',
            private_key: '-----BEGIN PRIVATE KEY-----\\ninvalid-for-mock\\n-----END PRIVATE KEY-----\\n',
          }),
        },
      },
      { MOCK_FCM_BASE_URL: 'https://mock.example/' } as Partial<Env> as Env,
    );

    const result = await provider?.send({
      token: 'device-token',
      platform: 'web',
      payload: { title: 'Trace', body: 'Bypass mock OAuth' },
    });

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
