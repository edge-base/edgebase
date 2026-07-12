import { describe, expect, it, vi } from 'vitest';
import { completePrivatePasswordResetRequest } from '../lib/password-reset-privacy.js';

describe('password reset account-enumeration privacy', () => {
  it('returns one generic public body whether delivery is absent, succeeds, or fails', async () => {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    const onDeliveryError = vi.fn();
    const absent = completePrivatePasswordResetRequest();
    const success = completePrivatePasswordResetRequest({
      delivery: Promise.resolve({ success: true, messageId: 'private-id' }),
      waitUntil,
      onDeliveryError,
    });
    const failure = completePrivatePasswordResetRequest({
      delivery: Promise.reject(new Error('synthetic delivery failure')),
      waitUntil,
      onDeliveryError,
    });
    const absentWork = completePrivatePasswordResetRequest({
      backgroundWork: async () => undefined,
      waitUntil,
      onDeliveryError,
    });

    expect(absent).toEqual(success);
    expect(success).toEqual(failure);
    expect(failure).toEqual(absentWork);
    expect(absent).toEqual({
      ok: true,
      message: 'If the email exists, a reset link has been sent.',
    });
    expect(absent).not.toHaveProperty('token');
    expect(absent).not.toHaveProperty('actionUrl');
    expect(absent).not.toHaveProperty('messageId');
    expect(waitUntil).toHaveBeenCalledTimes(3);

    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise));
    expect(onDeliveryError).toHaveBeenCalledTimes(1);
  });
});
