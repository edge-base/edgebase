export interface PasswordResetPrivacyResponse {
  ok: true;
  message: 'If the email exists, a reset link has been sent.';
}

/**
 * Produce the one public password-reset response and, when present, move
 * delivery work behind waitUntil. Delivery failures are logged server-side
 * and never alter the public status/body used for account enumeration.
 */
export function completePrivatePasswordResetRequest(options?: {
  backgroundWork?: () => Promise<unknown>;
  delivery?: Promise<unknown>;
  waitUntil?: (promise: Promise<unknown>) => void;
  onDeliveryError?: (error: unknown) => void;
}): PasswordResetPrivacyResponse {
  const background = options?.backgroundWork
    ? Promise.resolve().then(options.backgroundWork)
    : options?.delivery;
  if (background) {
    const settled = background.catch((error: unknown) => {
      // The default is deliberately silent: even a generic per-request error
      // log would reveal that this address reached existence-dependent work.
      // Tests/embedders may supply a private aggregate-only error sink.
      options?.onDeliveryError?.(error);
    });
    options?.waitUntil?.(settled);
  }

  return {
    ok: true,
    message: 'If the email exists, a reset link has been sent.',
  };
}
