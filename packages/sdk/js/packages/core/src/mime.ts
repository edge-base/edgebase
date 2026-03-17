/**
 * Lightweight MIME type detection from file extension.
 * No external dependencies — covers ~50 common types.
 */

const MIME_TYPES: Record<string, string> = {
  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',

  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',

  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',

  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Text
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  mjs: 'application/javascript',
  ts: 'application/typescript',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv',
  md: 'text/markdown',
  yaml: 'application/yaml',
  yml: 'application/yaml',

  // Archives
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',

  // Fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',

  // Other
  wasm: 'application/wasm',
};

/**
 * Detect MIME type from a file key (path/name) based on its extension.
 * Returns `'application/octet-stream'` if the extension is unknown.
 *
 * @example
 * getMimeType('photo.jpg')       // 'image/jpeg'
 * getMimeType('docs/readme.md')  // 'text/markdown'
 * getMimeType('data.xyz')        // 'application/octet-stream'
 */
export function getMimeType(key: string): string {
  const dotIndex = key.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex === key.length - 1) {
    return 'application/octet-stream';
  }
  const ext = key.substring(dotIndex + 1).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}
