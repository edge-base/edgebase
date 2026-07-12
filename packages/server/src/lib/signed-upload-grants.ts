import { EdgeBaseError } from '@edge-base/shared';

export const INTERNAL_STORAGE_NAMESPACE = '__edgebase_internal__';
export const SIGNED_UPLOAD_GRANT_PREFIX = `${INTERNAL_STORAGE_NAMESPACE}/signed-upload-grants/`;
export const SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY = 'edgebaseSignedUploadGrantState';
export const SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY = 'edgebaseMultipartUploadId';
export const SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY = 'edgebaseMultipartMaxBytes';
export const SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY = 'edgebaseMultipartReservedBytes';

const SIGNED_MULTIPART_RESERVATION_ATTEMPTS = 64;

export type SignedUploadGrantClaims = {
  expiresAt: number;
  grantId: string | null;
  maxBytes?: number | null;
};

export type SignedMultipartUploadGrantClaim = {
  etag: string;
};

function grantError(message: string): EdgeBaseError {
  return new EdgeBaseError(403, message, undefined, 'access-denied');
}

function assertUsableGrant(claims: SignedUploadGrantClaims): string {
  if (!claims.grantId) {
    throw grantError('Signed upload token does not contain a single-use grant. Create a new signed upload URL.');
  }
  if (Date.now() >= claims.expiresAt) {
    throw grantError('Signed upload token is invalid or expired.');
  }
  return claims.grantId;
}

export function createSignedUploadGrantId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function signedUploadGrantMarkerKey(claims: SignedUploadGrantClaims): string {
  const grantId = claims.grantId;
  if (!grantId || !/^[a-f0-9]{32}$/.test(grantId)) {
    throw grantError('Signed upload token contains an invalid single-use grant.');
  }
  const expiresAt = String(Math.trunc(claims.expiresAt)).padStart(13, '0');
  return `${SIGNED_UPLOAD_GRANT_PREFIX}${expiresAt}/${grantId}`;
}

export function isSignedUploadGrantMarker(key: string): boolean {
  return key.startsWith(SIGNED_UPLOAD_GRANT_PREFIX);
}

export async function assertSignedUploadGrantActive(
  storage: R2Bucket,
  claims: SignedUploadGrantClaims,
): Promise<void> {
  assertUsableGrant(claims);
  const marker = await storage.head(signedUploadGrantMarkerKey(claims));
  if (marker) {
    throw grantError('Signed upload token has already been used or revoked.');
  }
}

/**
 * Atomically consume the grant before an object can become visible. R2
 * conditional writes and reads are strongly consistent, so concurrent replay
 * attempts cannot both create the marker.
 */
export async function consumeSignedUploadGrant(
  storage: R2Bucket,
  claims: SignedUploadGrantClaims,
): Promise<void> {
  assertUsableGrant(claims);
  const marker = await storage.put(signedUploadGrantMarkerKey(claims), null, {
    onlyIf: { etagDoesNotMatch: '*' },
  });
  if (!marker) {
    throw grantError('Signed upload token has already been used or revoked.');
  }
}

/**
 * Claim a grant before creating an R2 multipart session. Only the request that
 * wins this conditional write may incur the cost of creating that session.
 * The random body gives the intermediate marker a claim-specific ETag for the
 * subsequent compare-and-swap transition.
 */
export async function claimSignedMultipartUploadGrant(
  storage: R2Bucket,
  claims: SignedUploadGrantClaims,
): Promise<SignedMultipartUploadGrantClaim> {
  assertUsableGrant(claims);
  const marker = await storage.put(signedUploadGrantMarkerKey(claims), createSignedUploadGrantId(), {
    onlyIf: { etagDoesNotMatch: '*' },
    customMetadata: {
      [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'creating',
    },
  });
  if (!marker) {
    throw grantError('Signed upload token has already been used or revoked.');
  }
  return { etag: marker.etag };
}

/** Atomically transition the winning create claim to its server-issued upload ID. */
export async function bindSignedMultipartUploadGrant(
  storage: R2Bucket,
  claims: SignedUploadGrantClaims,
  claim: SignedMultipartUploadGrantClaim,
  uploadId: string,
): Promise<void> {
  assertUsableGrant(claims);
  if (!claim.etag || !uploadId) {
    throw grantError('Signed multipart upload is missing its grant claim or upload ID.');
  }
  const maxBytes = claims.maxBytes;
  if (maxBytes != null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
    throw grantError('Signed multipart upload contains an invalid maximum file size.');
  }
  const customMetadata: Record<string, string> = {
    [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'multipart',
    [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: uploadId,
  };
  if (maxBytes != null) {
    customMetadata[SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY] = String(maxBytes);
    customMetadata[SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY] = '0';
  }
  const marker = await storage.put(signedUploadGrantMarkerKey(claims), null, {
    onlyIf: { etagMatches: claim.etag },
    customMetadata,
  });
  if (!marker) {
    throw grantError('Signed upload token grant changed or was revoked before multipart binding completed.');
  }
}

/**
 * Atomically reserve a signed multipart part's declared bytes before sending
 * its body to R2. Reservations are intentionally monotonic: a retry or part
 * replacement consumes budget again so repeated writes cannot turn one grant
 * into unbounded storage/ingress work.
 *
 * Returns false only after this request wins the CAS transition to a terminal
 * failed marker because the aggregate reservation would exceed maxBytes.
 */
export async function reserveSignedMultipartUploadBytes(
  storage: R2Bucket,
  claims: SignedUploadGrantClaims,
  uploadId: string,
  bytes: number,
): Promise<boolean> {
  assertUsableGrant(claims);
  const maxBytes = claims.maxBytes;
  if (
    maxBytes == null
    || !Number.isSafeInteger(maxBytes)
    || maxBytes < 0
    || !Number.isSafeInteger(bytes)
    || bytes <= 0
  ) {
    throw grantError('Signed multipart upload contains invalid byte reservation metadata.');
  }

  const markerKey = signedUploadGrantMarkerKey(claims);
  for (let attempt = 0; attempt < SIGNED_MULTIPART_RESERVATION_ATTEMPTS; attempt += 1) {
    const marker = await storage.head(markerKey);
    const metadata = marker?.customMetadata;
    if (
      !marker
      || metadata?.[SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY] !== 'multipart'
      || metadata[SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY] !== uploadId
    ) {
      throw grantError('Signed upload token does not authorize this multipart upload.');
    }

    const markerMaxBytes = Number(metadata[SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY]);
    const reservedBytes = Number(metadata[SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY]);
    if (
      !Number.isSafeInteger(markerMaxBytes)
      || markerMaxBytes < 0
      || markerMaxBytes !== maxBytes
      || !Number.isSafeInteger(reservedBytes)
      || reservedBytes < 0
      || reservedBytes > maxBytes
    ) {
      throw grantError('Signed multipart upload byte reservation state is invalid.');
    }

    const commonMetadata = {
      [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: uploadId,
      [SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY]: String(maxBytes),
      [SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY]: String(reservedBytes),
    };
    if (bytes > maxBytes - reservedBytes) {
      const terminal = await storage.put(markerKey, null, {
        onlyIf: { etagMatches: marker.etag },
        customMetadata: {
          [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'failed',
          ...commonMetadata,
        },
      });
      if (terminal) return false;
      continue;
    }

    const reserved = await storage.put(markerKey, null, {
      onlyIf: { etagMatches: marker.etag },
      customMetadata: {
        [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'multipart',
        ...commonMetadata,
        [SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY]: String(reservedBytes + bytes),
      },
    });
    if (reserved) return true;
  }

  throw grantError(
    'Signed multipart upload byte reservation could not be established safely. Retry this part.',
  );
}

/**
 * Fail closed after a claimed create cannot be completed. The grant is not
 * released for retry because an R2 failure can be ambiguous about whether a
 * session was created; callers must request a new signed upload URL.
 */
export async function terminateSignedMultipartUploadGrant(
  storage: R2Bucket,
  claims: SignedUploadGrantClaims,
  claim: SignedMultipartUploadGrantClaim,
): Promise<boolean> {
  if (!claim.etag) return false;
  const marker = await storage.put(signedUploadGrantMarkerKey(claims), null, {
    onlyIf: { etagMatches: claim.etag },
    customMetadata: {
      [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'failed',
    },
  });
  return marker !== null;
}

/** Require a signed multipart continuation to use the session bound at create. */
export async function assertSignedMultipartUploadGrant(
  storage: R2Bucket,
  claims: SignedUploadGrantClaims,
  uploadId: string,
): Promise<void> {
  assertUsableGrant(claims);
  const marker = await storage.head(signedUploadGrantMarkerKey(claims));
  if (
    marker?.customMetadata?.[SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY] !== 'multipart'
    || marker.customMetadata?.[SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY] !== uploadId
  ) {
    throw grantError('Signed upload token does not authorize this multipart upload.');
  }
}

/** Delete bounded batches of expired internal grant markers on the built-in cron. */
export async function cleanupExpiredSignedUploadGrants(
  storage: R2Bucket,
  now = Date.now(),
  maxDeletes = 10_000,
): Promise<number> {
  let deleted = 0;

  while (deleted < maxDeletes) {
    const limit = Math.min(1000, maxDeletes - deleted);
    const listed = await storage.list({ prefix: SIGNED_UPLOAD_GRANT_PREFIX, limit });
    const expiredKeys = listed.objects
      .filter((object) => {
        const relative = object.key.slice(SIGNED_UPLOAD_GRANT_PREFIX.length);
        const separator = relative.indexOf('/');
        if (separator <= 0) return false;
        const expiresAt = Number(relative.slice(0, separator));
        return Number.isFinite(expiresAt) && expiresAt <= now;
      })
      .map((object) => object.key);

    if (expiredKeys.length === 0) break;
    await storage.delete(expiredKeys);
    deleted += expiredKeys.length;

    if (listed.objects.length < limit) break;
  }

  return deleted;
}
