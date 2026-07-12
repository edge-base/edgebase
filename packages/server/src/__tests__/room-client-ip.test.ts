import { afterEach, describe, expect, it, vi } from 'vitest';
import { setConfig } from '../lib/do-router.js';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

afterEach(() => setConfig({}));

describe('room websocket client-IP trust boundary', () => {
  it.each([
    {
      label: 'Cloudflare ignores spoofed XFF even when proxy trust is configured',
      mode: 'cloudflare',
      trust: true,
      expected: '198.51.100.20',
    },
    {
      label: 'trusted self-hosted proxy uses overwritten XFF',
      mode: 'self-hosted',
      trust: true,
      expected: '10.0.0.8',
    },
    {
      label: 'direct self-hosted ingress ignores both forwarded headers',
      mode: 'self-hosted',
      trust: false,
      expected: undefined,
    },
    {
      label: 'absent runtime identity fails closed despite proxy config',
      mode: undefined,
      trust: true,
      expected: undefined,
    },
  ])('$label', async ({ mode, trust, expected }) => {
    setConfig({ trustSelfHostedProxy: trust });
    const { resolveRoomClientIp } = await import('../durable-objects/room-runtime-base.js');
    const env = {
      ...(mode ? { EDGEBASE_RUNTIME_MODE: mode } : {}),
    };
    const request = new Request('https://rooms.example.test/internal', {
      headers: {
        'CF-Connecting-IP': '198.51.100.20',
        'X-Forwarded-For': '10.0.0.8, 192.0.2.1',
      },
    });

    expect(resolveRoomClientIp(env as never, request)).toBe(expected);
  });
});
