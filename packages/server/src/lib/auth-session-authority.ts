import { resolveAuthDb } from './auth-db-adapter.js';

const SESSION_AUTHORITY_TIMEOUT_MS = 2_000;

export class AuthSessionAuthorityUnavailableError extends Error {
  constructor(message = 'Authentication session authority is temporarily unavailable.') {
    super(message);
    this.name = 'AuthSessionAuthorityUnavailableError';
  }
}

/**
 * Check the authoritative auth-session row used by an access-token sid.
 * A missing/expired row is a normal revoked result. Provider/DB failures stay
 * distinguishable so callers can fail closed without telling SDKs to erase
 * otherwise valid credentials.
 */
export async function isAuthSessionActive(
  env: Record<string, unknown>,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  try {
    const db = resolveAuthDb(env);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const session = await Promise.race([
      db.first<{ id: string }>(
        `SELECT id FROM _sessions
         WHERE id = ? AND userId = ? AND expiresAt > ?`,
        [sessionId, userId, new Date().toISOString()],
      ),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`session authority timed out after ${SESSION_AUTHORITY_TIMEOUT_MS}ms`)),
          SESSION_AUTHORITY_TIMEOUT_MS,
        );
      }),
    ]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
    return session !== null;
  } catch (error) {
    throw new AuthSessionAuthorityUnavailableError(
      error instanceof Error && error.message
        ? `Authentication session authority is unavailable: ${error.message}`
        : undefined,
    );
  }
}
