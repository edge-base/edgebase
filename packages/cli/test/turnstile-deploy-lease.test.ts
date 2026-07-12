import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireTurnstileDeployLease,
  renewTurnstileDeployLease,
  releaseTurnstileDeployLease,
} from '../src/lib/turnstile-deploy-lease.js';

function d1Response(results: Array<Record<string, unknown>> = []) {
  return new Response(JSON.stringify({
    success: true,
    result: [{ success: true, results }],
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('managed Turnstile remote deploy lease', () => {
  it('atomically acquires and owner-conditionally releases the D1 lease', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(d1Response())
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { params: unknown[] };
        return d1Response([{ owner: request.params[1], expires_at: 2_200 }]);
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(String(init.body)) as { params: unknown[] };
        return d1Response([{ owner: request.params[2], expires_at: 2_300 }]);
      })
      .mockResolvedValueOnce(d1Response());
    vi.stubGlobal('fetch', fetchMock);

    const lease = await acquireTurnstileDeployLease(
      '0123456789abcdef0123456789abcdef',
      '11111111-2222-3333-4444-555555555555',
      'synthetic-api-token',
    );
    const renewed = await renewTurnstileDeployLease(lease, 'synthetic-api-token');
    await releaseTurnstileDeployLease(renewed, 'synthetic-api-token');

    expect(lease.owner).toMatch(/^[0-9a-f]{32}$/);
    const acquireBody = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(acquireBody.sql).toMatch(/ON CONFLICT.*WHERE.*expires_at.*RETURNING/is);
    expect(acquireBody.params).toEqual([
      'managed-turnstile-deploy',
      lease.owner,
      '1200',
    ]);
    expect(acquireBody.sql).toMatch(/unixepoch\(\)/i);
    const renewBody = JSON.parse(String((fetchMock.mock.calls[2]![1] as RequestInit).body));
    expect(renewBody.sql).toMatch(/UPDATE.*WHERE.*owner = \?.*RETURNING/is);
    expect(renewed.expiresAt).toBe(2_300_000);
    const releaseBody = JSON.parse(String((fetchMock.mock.calls[3]![1] as RequestInit).body));
    expect(releaseBody.sql).toMatch(/DELETE.*owner = \?/i);
    expect(releaseBody.params).toEqual(['managed-turnstile-deploy', lease.owner]);
  });

  it('fails closed when another unexpired owner holds the lease', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(d1Response())
      .mockResolvedValueOnce(d1Response([])));

    await expect(acquireTurnstileDeployLease(
      '0123456789abcdef0123456789abcdef',
      '11111111-2222-3333-4444-555555555555',
      'synthetic-api-token',
    )).rejects.toThrow(/another managed Turnstile deployment holds/i);
  });

  it('fails closed when renewal no longer owns the lease', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(d1Response([])));
    await expect(renewTurnstileDeployLease({
      accountId: '0123456789abcdef0123456789abcdef',
      databaseId: '11111111-2222-3333-4444-555555555555',
      owner: 'a'.repeat(32),
      expiresAt: 0,
    }, 'synthetic-api-token')).rejects.toThrow(/expired or changed owner/i);
  });

  it('rejects oversized D1 responses before parsing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', {
      headers: { 'Content-Length': String(64 * 1024 + 1) },
    })));
    await expect(acquireTurnstileDeployLease(
      '0123456789abcdef0123456789abcdef',
      '11111111-2222-3333-4444-555555555555',
      'synthetic-api-token',
    )).rejects.toThrow(/exceeded 64 KiB/i);
  });

  it('bounds an unavailable D1 lease API', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })));
    const pending = acquireTurnstileDeployLease(
      '0123456789abcdef0123456789abcdef',
      '11111111-2222-3333-4444-555555555555',
      'synthetic-api-token',
    );
    const assertion = expect(pending).rejects.toThrow(/timed out after 10000ms/i);
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });
});
