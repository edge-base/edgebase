import { resolveAuthDb } from './auth-db-adapter.js';
import { parseConfig } from './do-router.js';

const SESSION_AUTHORITY_TIMEOUT_MS = 2_000;
const sessionAuthorityInFlightByBinding = new WeakMap<
  object,
  Map<string, Promise<boolean>>
>();

export class AuthSessionAuthorityUnavailableError extends Error {
  constructor(message = 'Authentication session authority is temporarily unavailable.') {
    super(message);
    this.name = 'AuthSessionAuthorityUnavailableError';
  }
}

function authSessionAuthorityBinding(env: Record<string, unknown>): object {
  let provider = 'd1';
  try {
    provider = parseConfig(env).auth?.provider ?? 'd1';
  } catch {
    // Preserve the existing wrapped authority-unavailable outcome below; the
    // environment object is still an isolated in-flight scope for this call.
    return env;
  }
  const candidates = provider === 'd1'
    ? [env.AUTH_DB]
    : [env.AUTH_POSTGRES];
  for (const candidate of candidates) {
    if (
      (typeof candidate === 'object' && candidate !== null) ||
      typeof candidate === 'function'
    ) {
      return candidate as object;
    }
  }
  return env;
}

function authSessionAuthorityKey(userId: string, sessionId: string): string {
  return JSON.stringify([userId, sessionId]);
}

async function readAuthSessionActive(
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
  const binding = authSessionAuthorityBinding(env);
  const key = authSessionAuthorityKey(userId, sessionId);
  let inFlight = sessionAuthorityInFlightByBinding.get(binding);
  const active = inFlight?.get(key);
  if (active) return active;

  if (!inFlight) {
    inFlight = new Map();
    sessionAuthorityInFlightByBinding.set(binding, inFlight);
  }

  const operation = readAuthSessionActive(env, userId, sessionId);
  inFlight.set(key, operation);
  const cleanup = () => {
    if (inFlight?.get(key) !== operation) return;
    inFlight.delete(key);
    if (inFlight.size === 0 && sessionAuthorityInFlightByBinding.get(binding) === inFlight) {
      sessionAuthorityInFlightByBinding.delete(binding);
    }
  };
  void operation.then(cleanup, cleanup);
  return operation;
}
