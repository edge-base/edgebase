import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';

const {
  lookupEmailMock,
  ensureAuthSchemaMock,
  getUserByIdMock,
  replaceEmailTokenMock,
  providerSendMock,
} = vi.hoisted(() => ({
  lookupEmailMock: vi.fn(),
  ensureAuthSchemaMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  replaceEmailTokenMock: vi.fn(),
  providerSendMock: vi.fn(),
}));

vi.mock('../lib/auth-d1.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-d1.js')>('../lib/auth-d1.js');
  return {
    ...actual,
    lookupEmail: lookupEmailMock,
    ensureAuthSchema: ensureAuthSchemaMock,
  };
});

vi.mock('../lib/auth-d1-service.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-d1-service.js')>('../lib/auth-d1-service.js');
  return {
    ...actual,
    getUserById: getUserByIdMock,
    replaceEmailToken: replaceEmailTokenMock,
  };
});

vi.mock('../lib/auth-db-adapter.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth-db-adapter.js')>('../lib/auth-db-adapter.js');
  return { ...actual, resolveAuthDb: () => ({ kind: 'synthetic-auth-db' }) };
});

vi.mock('../lib/email-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/email-provider.js')>('../lib/email-provider.js');
  return {
    ...actual,
    createEmailProvider: () => ({ send: providerSendMock }),
  };
});

import { authRoute } from '../routes/auth.js';
import { setConfig } from '../lib/do-router.js';

const GENERIC_BODY = {
  ok: true,
  message: 'If the email exists, a reset link has been sent.',
};

async function requestReset(): Promise<{
  response: Response;
  pending: Promise<unknown>[];
}> {
  const pending: Promise<unknown>[] = [];
  const response = await authRoute.fetch(
    new Request('https://api.example.test/request-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'synthetic-user@example.com' }),
    }),
    { AUTH_DB: {} } as never,
    {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
      passThroughOnException() {},
      props: {},
    } as never,
  );
  return { response, pending };
}

describe('request-password-reset route privacy', () => {
  beforeEach(() => {
    setConfig(defineConfig({
      release: true,
      email: {
        provider: 'resend',
        apiKey: 'synthetic-provider-key',
        from: 'noreply@example.com',
        resetUrl: 'https://app.example.com/reset#token={token}',
      },
    }));
    lookupEmailMock.mockReset();
    ensureAuthSchemaMock.mockReset().mockResolvedValue(undefined);
    getUserByIdMock.mockReset();
    replaceEmailTokenMock.mockReset().mockResolvedValue(undefined);
    providerSendMock.mockReset();
  });

  it('keeps absent, delivered, and failed-delivery responses exactly identical', async () => {
    lookupEmailMock.mockResolvedValueOnce(null);
    const absent = await requestReset();
    await Promise.all(absent.pending);

    lookupEmailMock.mockResolvedValueOnce({ userId: 'synthetic-user' });
    getUserByIdMock.mockResolvedValueOnce({
      id: 'synthetic-user',
      email: 'synthetic-user@example.com',
      locale: 'en',
    });
    providerSendMock.mockResolvedValueOnce({ success: true, messageId: 'private-message-id' });
    const delivered = await requestReset();
    await Promise.all(delivered.pending);

    lookupEmailMock.mockResolvedValueOnce({ userId: 'synthetic-user' });
    getUserByIdMock.mockResolvedValueOnce({
      id: 'synthetic-user',
      email: 'synthetic-user@example.com',
      locale: 'en',
    });
    providerSendMock.mockResolvedValueOnce({ success: false });
    const failed = await requestReset();
    await Promise.all(failed.pending);

    for (const outcome of [absent, delivered, failed]) {
      expect(outcome.response.status).toBe(200);
      await expect(outcome.response.json()).resolves.toEqual(GENERIC_BODY);
    }
    expect(absent.pending).toHaveLength(1);
    expect(delivered.pending).toHaveLength(1);
    expect(failed.pending).toHaveLength(1);
  });

  it('returns before persistence settles and never starts delivery before persistence', async () => {
    let releasePersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    lookupEmailMock.mockResolvedValueOnce({ userId: 'synthetic-user' });
    getUserByIdMock.mockResolvedValueOnce({
      id: 'synthetic-user',
      email: 'synthetic-user@example.com',
      locale: 'en',
    });
    replaceEmailTokenMock.mockReturnValueOnce(persistence);
    providerSendMock.mockResolvedValueOnce({ success: true, messageId: 'private-message-id' });

    const outcome = await Promise.race([
      requestReset(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    expect(outcome).not.toBeNull();
    const completed = outcome!;
    expect(completed.response.status).toBe(200);
    await expect(completed.response.json()).resolves.toEqual(GENERIC_BODY);
    expect(completed.pending).toHaveLength(1);

    await vi.waitFor(() => expect(replaceEmailTokenMock).toHaveBeenCalledTimes(1));
    expect(providerSendMock).not.toHaveBeenCalled();
    releasePersistence();
    await Promise.all(completed.pending);
    expect(providerSendMock).toHaveBeenCalledTimes(1);
  });

  it('returns the generic response before the account lookup settles', async () => {
    let releaseLookup!: (value: null) => void;
    const lookup = new Promise<null>((resolve) => {
      releaseLookup = resolve;
    });
    lookupEmailMock.mockReturnValueOnce(lookup);

    const outcome = await Promise.race([
      requestReset(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    expect(outcome).not.toBeNull();
    const completed = outcome!;
    expect(completed.response.status).toBe(200);
    await expect(completed.response.json()).resolves.toEqual(GENERIC_BODY);
    expect(completed.pending).toHaveLength(1);
    expect(getUserByIdMock).not.toHaveBeenCalled();
    expect(replaceEmailTokenMock).not.toHaveBeenCalled();
    expect(providerSendMock).not.toHaveBeenCalled();

    releaseLookup(null);
    await Promise.all(completed.pending);
    expect(providerSendMock).not.toHaveBeenCalled();
  });
});
