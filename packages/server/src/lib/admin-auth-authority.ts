import type { AuthDb } from './auth-db-adapter.js';
import { getAdminSessionById } from './auth-d1.js';
import { verifyAdminTokenWithFallback } from './jwt.js';

export interface AdminJwtAuthorityOptions {
  token: string;
  secret: string;
  oldSecret?: string;
  oldSecretRotatedAt?: string;
}

/**
 * Resolve an admin JWT to its authoritative subject.
 *
 * Credential verification failures return null. Backing-session lookup errors
 * deliberately propagate so infrastructure outages remain 5xx responses.
 */
export async function resolveAdminJwtAuthority(
  db: AuthDb,
  options: AdminJwtAuthorityOptions,
): Promise<string | null> {
  let payload: Awaited<ReturnType<typeof verifyAdminTokenWithFallback>>;
  try {
    payload = await verifyAdminTokenWithFallback(
      options.token,
      options.secret,
      options.oldSecret,
      options.oldSecretRotatedAt,
    );
  } catch {
    return null;
  }

  // Rolling compatibility for pre-0.3.6 access tokens. They remain valid only
  // for their original short lifetime because no new sid-less tokens are made.
  if (payload.sid === undefined) return payload.sub;
  if (typeof payload.sid !== 'string') return null;

  const session = await getAdminSessionById(db, payload.sid);
  if (!session || session.adminId !== payload.sub) return null;
  return payload.sub;
}
