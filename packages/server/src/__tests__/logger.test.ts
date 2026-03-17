import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createLogWriterMock, writeMock } = vi.hoisted(() => {
  const writeMock = vi.fn();

  return {
    createLogWriterMock: vi.fn(() => ({
      write: writeMock,
      query: vi.fn(),
    })),
    writeMock,
  };
});

vi.mock('../lib/log-writer.js', () => ({
  createLogWriter: createLogWriterMock,
}));

describe('loggerMiddleware', () => {
  beforeEach(() => {
    vi.resetModules();
    writeMock.mockReset();
    createLogWriterMock.mockReset();
    createLogWriterMock.mockImplementation(() => ({
      write: writeMock,
      query: vi.fn(),
    }));
  });

  it('logs relative request URLs without throwing', async () => {
    const { loggerMiddleware } = await import('../middleware/logger.js');
    const header = vi.fn(() => null);
    const get = vi.fn(() => undefined);
    const ctx = {
      req: {
        url: '/relative-only?hello=1',
        method: 'GET',
        header,
        raw: {},
      },
      res: {
        status: 204,
        headers: new Headers(),
      },
      get,
      env: {},
    } as any;

    await expect(loggerMiddleware(ctx, async () => {})).resolves.toBeUndefined();

    expect(createLogWriterMock).toHaveBeenCalledWith({}, undefined);
    expect(writeMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      path: '/relative-only',
      status: 204,
    }));
  });
});
