import { describe, expect, it } from 'vitest';
import {
  applyStorageContentSecurityHeaders,
  createStorageAttachmentDisposition,
  isSafeInlineStorageContentType,
  normalizeStorageContentType,
  STORAGE_ATTACHMENT_CONTENT_TYPE,
  STORAGE_ATTACHMENT_CSP,
} from '../lib/storage-content-security.js';

describe('storage content security', () => {
  it.each([
    'image/png',
    'image/jpeg; charset=binary',
    'audio/mpeg',
    'video/mp4',
    'font/woff2',
    'text/plain; charset=utf-8',
    'text/vtt',
  ])('allows passive inline content: %s', (contentType) => {
    expect(isSafeInlineStorageContentType(contentType)).toBe(true);
  });

  it.each([
    'text/html',
    'application/xhtml+xml',
    'image/svg+xml',
    'application/xml',
    'text/xml',
    'text/javascript',
    'application/javascript',
    'text/css',
    'application/pdf',
    'application/octet-stream',
    'invalid',
    '',
  ])('forces active or unknown content to download: %s', (contentType) => {
    expect(isSafeInlineStorageContentType(contentType)).toBe(false);
  });

  it('normalizes case and parameters and rejects malformed MIME values', () => {
    expect(normalizeStorageContentType(' Image/PNG ; charset=binary ')).toBe('image/png');
    expect(normalizeStorageContentType('text/html\r\nX-Injected: true')).toBe(STORAGE_ATTACHMENT_CONTENT_TYPE);
    expect(normalizeStorageContentType('text//html')).toBe(STORAGE_ATTACHMENT_CONTENT_TYPE);
    expect(normalizeStorageContentType(null)).toBe(STORAGE_ATTACHMENT_CONTENT_TYPE);
  });

  it('preserves safe inline media with nosniff', () => {
    const headers = new Headers({
      'Content-Disposition': 'attachment',
      'Content-Security-Policy': "default-src 'self'",
    });

    applyStorageContentSecurityHeaders(headers, 'avatars/photo.png', 'IMAGE/PNG');

    expect(headers.get('Content-Type')).toBe('image/png');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.has('Content-Disposition')).toBe(false);
    expect(headers.has('Content-Security-Policy')).toBe(false);
  });

  it('makes unsafe content opaque, downloadable, and sandboxed', () => {
    const headers = new Headers();

    applyStorageContentSecurityHeaders(headers, 'imports/payload.html', 'text/html; charset=utf-8');

    expect(headers.get('Content-Type')).toBe(STORAGE_ATTACHMENT_CONTENT_TYPE);
    expect(headers.get('Content-Disposition')).toContain('attachment;');
    expect(headers.get('Content-Disposition')).toContain('payload.html');
    expect(headers.get('Content-Security-Policy')).toBe(STORAGE_ATTACHMENT_CSP);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('builds a CR/LF-safe attachment filename with a Unicode filename* value', () => {
    const disposition = createStorageAttachmentDisposition('folder/보고서\r\nX-Evil: yes.svg');

    expect(disposition).toMatch(/^attachment; filename="[^"]+"; filename\*=UTF-8''/);
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
    expect(disposition).toContain('%EB%B3%B4%EA%B3%A0%EC%84%9C');
  });

  it('does not throw when a storage key contains an unpaired surrogate', () => {
    expect(() => createStorageAttachmentDisposition(`folder/bad-\uD800.html`)).not.toThrow();
    expect(createStorageAttachmentDisposition(`folder/bad-\uD800.html`)).toContain('%EF%BF%BD');
  });
});
