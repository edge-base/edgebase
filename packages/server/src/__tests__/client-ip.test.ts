import { describe, expect, it } from 'vitest';
import { getTrustedClientIp } from '../lib/client-ip.js';

function requestHeaders(headers: Record<string, string>) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    header(name: string) {
      return normalized.get(name.toLowerCase());
    },
  };
}

describe('trusted client IP runtime boundary', () => {
  const forged = requestHeaders({
    'cf-connecting-ip': '127.0.0.1',
    'x-forwarded-for': '10.0.0.8',
  });

  it('fails closed when the CLI runtime mode is absent or invalid', () => {
    expect(getTrustedClientIp({}, forged)).toBeUndefined();
    expect(getTrustedClientIp({ EDGEBASE_RUNTIME_MODE: 'typo' }, forged)).toBeUndefined();
  });

  it('preserves Cloudflare and CLI local-development CF header behavior', () => {
    expect(getTrustedClientIp({ EDGEBASE_RUNTIME_MODE: 'cloudflare' }, forged)).toBe('127.0.0.1');
    expect(getTrustedClientIp({ EDGEBASE_RUNTIME_MODE: 'local-development' }, forged)).toBe('127.0.0.1');
  });

  it('never lets the self-hosted proxy option override Cloudflare ingress authority', () => {
    expect(getTrustedClientIp({
      EDGEBASE_RUNTIME_MODE: 'cloudflare',
      EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }),
    }, forged)).toBe('127.0.0.1');
  });

  it('ignores client-supplied forwarding headers in direct self-hosted mode', () => {
    expect(getTrustedClientIp({ EDGEBASE_RUNTIME_MODE: 'self-hosted' }, forged)).toBeUndefined();
  });

  it('uses only proxy-overwritten X-Forwarded-For after explicit opt-in', () => {
    expect(getTrustedClientIp({
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
      EDGEBASE_CONFIG: JSON.stringify({ trustSelfHostedProxy: true }),
    }, forged)).toBe('10.0.0.8');
  });

  it('requires the exact gateway proof before trusting X-Forwarded-For', () => {
    const secret = 'a'.repeat(64);
    const env = {
      EDGEBASE_RUNTIME_MODE: 'self-hosted',
      EDGEBASE_SELF_HOST_GATEWAY_SECRET: secret,
      trustSelfHostedProxy: true,
    };
    expect(getTrustedClientIp(env, forged)).toBeUndefined();
    expect(getTrustedClientIp(env, requestHeaders({
      'x-edgebase-self-host-gateway': 'b'.repeat(64),
      'x-forwarded-for': '10.0.0.8',
    }))).toBeUndefined();
    expect(getTrustedClientIp(env, requestHeaders({
      'x-edgebase-self-host-gateway': secret,
      'x-forwarded-for': '10.0.0.8, 10.0.0.9',
      'cf-connecting-ip': '127.0.0.1',
    }))).toBe('10.0.0.8');
  });

  it('does not let a forged CF header satisfy a loopback-only anonymous-auth rule', () => {
    const ip = getTrustedClientIp({ EDGEBASE_RUNTIME_MODE: 'self-hosted' }, forged);
    const loopbackOnlyAnonymousAuth = ip === '::1' || ip?.startsWith('127.') === true;
    expect(loopbackOnlyAnonymousAuth).toBe(false);
  });
});
