import { describe, expect, it, vi } from 'vitest';
import { SQLiteLogWriter, type LogEntry } from '../lib/log-writer.js';

function makeEntry(index: number): LogEntry {
  return {
    method: 'GET',
    path: `/logs/${index}`,
    status: 200,
    duration: 1,
    timestamp: Date.now(),
  };
}

describe('SQLiteLogWriter', () => {
  it('requeues durable object reset failures without noisy warnings', async () => {
    const firstError = Object.assign(new Error('reset'), { durableObjectReset: true });
    const fetchMock = vi
      .fn(async (_input: RequestInfo) => new Response(null, { status: 200 }))
      .mockRejectedValueOnce(firstError);
    const pending: Promise<unknown>[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writer = new SQLiteLogWriter(
      { fetch: fetchMock },
      { waitUntil(promise) { pending.push(promise); } },
    );

    for (let index = 0; index < 50; index++) {
      writer.write(makeEntry(index));
    }
    await Promise.all(pending.splice(0));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    writer.write(makeEntry(50));
    await Promise.all(pending.splice(0));

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
