/**
 * Security policy for bytes served from user-controlled storage.
 *
 * Storage content types are uploader-controlled metadata. Only explicitly
 * passive formats may be rendered inline; everything else is downloaded as an
 * opaque attachment so active documents cannot execute in the app origin.
 */

export const STORAGE_ATTACHMENT_CONTENT_TYPE = 'application/octet-stream';
export const STORAGE_ATTACHMENT_CSP = "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MIME_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const SAFE_INLINE_STORAGE_CONTENT_TYPES = new Set([
  // Passive raster image formats. SVG is deliberately excluded.
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/x-icon',

  // Common browser-supported audio formats.
  'audio/3gpp',
  'audio/3gpp2',
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'audio/x-wav',

  // Common browser-supported video formats.
  'video/3gpp',
  'video/3gpp2',
  'video/mp4',
  'video/mpeg',
  'video/ogg',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/x-msvideo',

  // Passive text/media/font resources used directly by applications.
  'application/font-woff',
  'application/ogg',
  'application/vnd.ms-fontobject',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2',
  'text/plain',
  'text/vtt',
]);

/**
 * Return a syntactically valid, parameter-free MIME type for R2 metadata and
 * response decisions. Invalid or missing values are made opaque.
 */
export function normalizeStorageContentType(value?: string | null): string {
  if (!value) return STORAGE_ATTACHMENT_CONTENT_TYPE;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const slash = mediaType.indexOf('/');
  if (
    slash <= 0
    || slash !== mediaType.lastIndexOf('/')
    || !MIME_TOKEN.test(mediaType.slice(0, slash))
    || !MIME_TOKEN.test(mediaType.slice(slash + 1))
  ) {
    return STORAGE_ATTACHMENT_CONTENT_TYPE;
  }
  return mediaType;
}

export function isSafeInlineStorageContentType(value?: string | null): boolean {
  return SAFE_INLINE_STORAGE_CONTENT_TYPES.has(normalizeStorageContentType(value));
}

function storageAttachmentFilename(key: string): string {
  const raw = key.split('/').filter(Boolean).pop() || 'download';
  return raw.slice(0, 255) || 'download';
}

function wellFormedStorageFilename(value: string): string {
  let result = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0)!;
    result += codePoint >= 0xD800 && codePoint <= 0xDFFF ? '\uFFFD' : char;
  }
  return result;
}

/** Build a CR/LF-safe, Unicode-preserving attachment header. */
export function createStorageAttachmentDisposition(key: string): string {
  const filename = wellFormedStorageFilename(storageAttachmentFilename(key));
  const ascii = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\;]/g, '_')
    .slice(0, 150) || 'download';
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) => (
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Apply the storage delivery policy to an existing response header set.
 * Callers may add Content-Length/Range/ETag/Cache-Control before or after it.
 */
export function applyStorageContentSecurityHeaders(
  headers: Headers,
  key: string,
  declaredContentType?: string | null,
): Headers {
  const normalized = normalizeStorageContentType(declaredContentType);
  headers.set('X-Content-Type-Options', 'nosniff');

  if (isSafeInlineStorageContentType(normalized)) {
    headers.set('Content-Type', normalized);
    headers.delete('Content-Disposition');
    headers.delete('Content-Security-Policy');
    return headers;
  }

  headers.set('Content-Type', STORAGE_ATTACHMENT_CONTENT_TYPE);
  headers.set('Content-Disposition', createStorageAttachmentDisposition(key));
  headers.set('Content-Security-Policy', STORAGE_ATTACHMENT_CSP);
  return headers;
}
