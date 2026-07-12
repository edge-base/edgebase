import { describe, expect, it, vi } from 'vitest';
import {
  assertSignedMultipartUploadGrant,
  assertSignedUploadGrantActive,
  bindSignedMultipartUploadGrant,
  claimSignedMultipartUploadGrant,
  cleanupExpiredSignedUploadGrants,
  consumeSignedUploadGrant,
  createSignedUploadGrantId,
  INTERNAL_STORAGE_NAMESPACE,
  reserveSignedMultipartUploadBytes,
  SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY,
  SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY,
  SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY,
  SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY,
  SIGNED_UPLOAD_GRANT_PREFIX,
  signedUploadGrantMarkerKey,
  terminateSignedMultipartUploadGrant,
} from '../lib/signed-upload-grants.js';

function object(key: string, etag = 'etag', customMetadata: Record<string, string> = {}): R2Object {
  return { key, etag, customMetadata } as unknown as R2Object;
}

function conditional(options: R2PutOptions): R2Conditional {
  return options.onlyIf as R2Conditional;
}

describe('signed upload grant state', () => {
  it('creates unpredictable identifiers in the reserved internal namespace', () => {
    const first = createSignedUploadGrantId();
    const second = createSignedUploadGrantId();
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
    expect(SIGNED_UPLOAD_GRANT_PREFIX).toBe(
      `${INTERNAL_STORAGE_NAMESPACE}/signed-upload-grants/`,
    );
  });

  it('uses a conditional zero-byte marker to atomically consume a grant', async () => {
    const claims = { expiresAt: Date.now() + 60_000, grantId: 'a'.repeat(32) };
    const markerKey = signedUploadGrantMarkerKey(claims);
    let marker: R2Object | null = null;
    const put = vi.fn(async (key: string, value: unknown, options: R2PutOptions) => {
      expect(value).toBeNull();
      expect(options.onlyIf).toEqual({ etagDoesNotMatch: '*' });
      if (marker) return null;
      marker = object(key);
      return marker;
    });
    const storage = { put } as unknown as R2Bucket;

    await consumeSignedUploadGrant(storage, claims);
    await expect(consumeSignedUploadGrant(storage, claims)).rejects.toMatchObject({
      code: 403,
      slug: 'access-denied',
    });
    expect(put).toHaveBeenNthCalledWith(1, markerKey, null, {
      onlyIf: { etagDoesNotMatch: '*' },
    });
  });

  it('allows only one competing multipart create to claim the grant', async () => {
    const claims = { expiresAt: Date.now() + 60_000, grantId: 'd'.repeat(32) };
    const markerKey = signedUploadGrantMarkerKey(claims);
    let marker: R2Object | null = null;
    const put = vi.fn(async (key: string, value: unknown, options: R2PutOptions) => {
      expect(value).toMatch(/^[a-f0-9]{32}$/);
      expect(options.onlyIf).toEqual({ etagDoesNotMatch: '*' });
      await Promise.resolve();
      if (marker) return null;
      marker = object(key, 'claim-etag', options.customMetadata);
      return marker;
    });
    const storage = { put } as unknown as R2Bucket;

    const results = await Promise.allSettled([
      claimSignedMultipartUploadGrant(storage, claims),
      claimSignedMultipartUploadGrant(storage, claims),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(marker).toMatchObject({
      key: markerKey,
      customMetadata: {
        [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'creating',
      },
    });
  });

  it('CAS-binds the winning create claim and allows only that upload ID', async () => {
    const claims = { expiresAt: Date.now() + 60_000, grantId: 'e'.repeat(32), maxBytes: 10 };
    const markerKey = signedUploadGrantMarkerKey(claims);
    let marker = object(markerKey, 'claim-etag', {
      [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'creating',
    });
    const put = vi.fn(async (key: string, value: unknown, options: R2PutOptions) => {
      expect(key).toBe(markerKey);
      expect(value).toBeNull();
      if (conditional(options).etagMatches !== marker.etag) return null;
      marker = object(key, 'bound-etag', options.customMetadata);
      return marker;
    });
    const storage = {
      put,
      head: vi.fn(async () => marker),
    } as unknown as R2Bucket;

    await bindSignedMultipartUploadGrant(storage, claims, { etag: 'claim-etag' }, 'upload-1');
    expect(put).toHaveBeenCalledWith(markerKey, null, {
      onlyIf: { etagMatches: 'claim-etag' },
      customMetadata: {
        [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'multipart',
        [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: 'upload-1',
        [SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY]: '10',
        [SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY]: '0',
      },
    });
    await expect(assertSignedMultipartUploadGrant(storage, claims, 'upload-1')).resolves.toBeUndefined();
    await expect(assertSignedMultipartUploadGrant(storage, claims, 'upload-2')).rejects.toMatchObject({
      code: 403,
      slug: 'access-denied',
    });
  });

  it('atomically caps concurrent multipart byte reservations at the aggregate grant limit', async () => {
    const claims = {
      expiresAt: Date.now() + 60_000,
      grantId: '3'.repeat(32),
      maxBytes: 10,
    };
    const markerKey = signedUploadGrantMarkerKey(claims);
    let revision = 0;
    let marker = object(markerKey, `etag-${revision}`, {
      [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'multipart',
      [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: 'upload-1',
      [SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY]: '10',
      [SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY]: '0',
    });
    const storage = {
      head: vi.fn(async () => marker),
      put: vi.fn(async (key: string, value: unknown, options: R2PutOptions) => {
        expect(key).toBe(markerKey);
        expect(value).toBeNull();
        const expectedEtag = conditional(options).etagMatches;
        await Promise.resolve();
        if (expectedEtag !== marker.etag) return null;
        revision += 1;
        marker = object(key, `etag-${revision}`, options.customMetadata);
        return marker;
      }),
    } as unknown as R2Bucket;

    const results = await Promise.allSettled(Array.from(
      { length: 8 },
      () => reserveSignedMultipartUploadBytes(storage, claims, 'upload-1', 2),
    ));
    const fulfilled = results
      .filter((result): result is PromiseFulfilledResult<boolean> => result.status === 'fulfilled')
      .map((result) => result.value);

    expect(fulfilled.filter(Boolean)).toHaveLength(5);
    expect(fulfilled.filter((value) => !value)).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);
    expect(marker).toMatchObject({
      customMetadata: {
        [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'failed',
        [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: 'upload-1',
        [SIGNED_MULTIPART_MAX_BYTES_METADATA_KEY]: '10',
        [SIGNED_MULTIPART_RESERVED_BYTES_METADATA_KEY]: '10',
      },
    });
  });

  it('rejects zero-byte reservations before touching grant state', async () => {
    const claims = {
      expiresAt: Date.now() + 60_000,
      grantId: '4'.repeat(32),
      maxBytes: 10,
    };
    const storage = { head: vi.fn(), put: vi.fn() } as unknown as R2Bucket;

    await expect(reserveSignedMultipartUploadBytes(
      storage,
      claims,
      'upload-1',
      0,
    )).rejects.toMatchObject({ code: 403, slug: 'access-denied' });
    expect(storage.head).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('terminally closes a failed create claim instead of reopening it for retry', async () => {
    const claims = { expiresAt: Date.now() + 60_000, grantId: '1'.repeat(32) };
    const markerKey = signedUploadGrantMarkerKey(claims);
    let marker = object(markerKey, 'claim-etag', {
      [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'creating',
    });
    const put = vi.fn(async (key: string, value: unknown, options: R2PutOptions) => {
      expect(value).toBeNull();
      if (conditional(options).etagMatches !== marker.etag) return null;
      marker = object(key, 'failed-etag', options.customMetadata);
      return marker;
    });
    const storage = {
      put,
      head: vi.fn(async () => marker),
    } as unknown as R2Bucket;

    await expect(terminateSignedMultipartUploadGrant(
      storage,
      claims,
      { etag: 'claim-etag' },
    )).resolves.toBe(true);
    expect(marker).toMatchObject({
      customMetadata: { [SIGNED_UPLOAD_GRANT_STATE_METADATA_KEY]: 'failed' },
    });
    await expect(assertSignedMultipartUploadGrant(storage, claims, 'upload-1')).rejects.toMatchObject({
      code: 403,
      slug: 'access-denied',
    });
  });

  it('rejects a bound marker that lacks the multipart state', async () => {
    const claims = { expiresAt: Date.now() + 60_000, grantId: '2'.repeat(32) };
    const marker = object(signedUploadGrantMarkerKey(claims), 'bound', {
      [SIGNED_MULTIPART_UPLOAD_ID_METADATA_KEY]: 'upload-1',
    });
    const storage = { head: vi.fn().mockResolvedValue(marker) } as unknown as R2Bucket;

    await expect(assertSignedMultipartUploadGrant(storage, claims, 'upload-1')).rejects.toMatchObject({
      code: 403,
      slug: 'access-denied',
    });
  });

  it('rejects multipart claiming at the expiry boundary before writing a marker', async () => {
    const claims = { expiresAt: Date.now(), grantId: 'f'.repeat(32) };
    const storage = { put: vi.fn() } as unknown as R2Bucket;

    await expect(claimSignedMultipartUploadGrant(storage, claims)).rejects.toMatchObject({
      code: 403,
      slug: 'access-denied',
    });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects a new single-upload attempt at the expiry boundary before consuming it', async () => {
    const claims = { expiresAt: Date.now(), grantId: '0'.repeat(32) };
    const storage = { put: vi.fn() } as unknown as R2Bucket;

    await expect(consumeSignedUploadGrant(storage, claims)).rejects.toMatchObject({
      code: 403,
      slug: 'access-denied',
    });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('fails closed for legacy upload tokens without a single-use grant', async () => {
    const storage = { head: vi.fn() } as unknown as R2Bucket;
    await expect(assertSignedUploadGrantActive(storage, {
      expiresAt: Date.now() + 60_000,
      grantId: null,
    })).rejects.toMatchObject({ code: 403, slug: 'access-denied' });
    expect(storage.head).not.toHaveBeenCalled();
  });

  it('cleans expired markers while preserving active grants', async () => {
    const now = Date.UTC(2026, 6, 11);
    const expired = `${SIGNED_UPLOAD_GRANT_PREFIX}${String(now - 1).padStart(13, '0')}/${'b'.repeat(32)}`;
    const active = `${SIGNED_UPLOAD_GRANT_PREFIX}${String(now + 1).padStart(13, '0')}/${'c'.repeat(32)}`;
    const remove = vi.fn().mockResolvedValue(undefined);
    const storage = {
      list: vi.fn().mockResolvedValue({
        objects: [object(expired), object(active)],
        truncated: false,
      }),
      delete: remove,
    } as unknown as R2Bucket;

    await expect(cleanupExpiredSignedUploadGrants(storage, now)).resolves.toBe(1);
    expect(remove).toHaveBeenCalledWith([expired]);
  });
});
