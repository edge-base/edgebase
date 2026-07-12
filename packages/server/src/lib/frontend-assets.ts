import { normalizeFrontendMountPath, type FrontendConfigLike } from './frontend-config.js';

interface ResolveFrontendAssetPathOptions {
  method?: string;
  accept?: string | null;
  mountPath?: string;
  spaFallback?: boolean;
}

const HTML_ACCEPT_MARKERS = ['text/html', 'application/xhtml+xml'];
const HASH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const HEX_HASH_TOKEN_PATTERN = /^[A-Fa-f0-9]+$/;

function isLikelyContentHashToken(token: string): boolean {
  if (!HASH_TOKEN_PATTERN.test(token)) return false;

  const hasLetter = /[A-Za-z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  if (HEX_HASH_TOKEN_PATTERN.test(token)) {
    return hasLetter && hasDigit;
  }

  return /[A-Z]/.test(token) && /[a-z]/.test(token) && hasDigit;
}

function hasLikelyContentHash(assetName: string): boolean {
  const extensionIndex = assetName.lastIndexOf('.');
  if (extensionIndex <= 0 || extensionIndex === assetName.length - 1) return false;
  const stem = assetName.slice(0, extensionIndex);

  // Content hashes are conventionally suffixes separated from the logical
  // asset name. Walk separators from right to left so URL-safe hashes that
  // themselves contain '-' or '_' remain recognizable. False negatives only
  // shorten caching; false positives can pin mutable metadata for a year.
  for (let index = stem.length - 1; index >= 0; index -= 1) {
    if (stem[index] !== '-' && stem[index] !== '_' && stem[index] !== '.') continue;
    const token = stem.slice(index + 1);
    if (token.length < 8) continue;
    if (isLikelyContentHashToken(token)) return true;
  }
  return false;
}

function isExplicitAssetPath(pathname: string): boolean {
  const lastSegment = pathname.split('/').pop() ?? '';
  return lastSegment.includes('.');
}

function isHtmlNavigationRequest(method: string | undefined, accept: string | null | undefined): boolean {
  if (method && method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  if (!accept) {
    return false;
  }

  return HTML_ACCEPT_MARKERS.some((marker) => accept.includes(marker));
}

function stripMountPath(pathname: string, mountPath: string): string | null {
  if (mountPath === '/') {
    return pathname || '/';
  }

  if (pathname === mountPath || pathname === `${mountPath}/`) {
    return '/';
  }

  if (!pathname.startsWith(`${mountPath}/`)) {
    return null;
  }

  return pathname.slice(mountPath.length) || '/';
}

export function resolveFrontendAssetPath(
  pathname: string,
  options: ResolveFrontendAssetPathOptions = {},
): string | null {
  const mountPath = normalizeFrontendMountPath(options.mountPath);
  const relativePath = stripMountPath(pathname || '/', mountPath);
  if (relativePath === null) {
    return null;
  }

  const assetPrefix = mountPath === '/' ? '' : mountPath;

  if (relativePath === '/' || relativePath === '') {
    return `${assetPrefix}/index.html`;
  }

  const explicitAssetPath = `${assetPrefix}${relativePath}`;
  if (isExplicitAssetPath(relativePath)) {
    return explicitAssetPath;
  }

  if (options.spaFallback && isHtmlNavigationRequest(options.method, options.accept)) {
    return `${assetPrefix}/index.html`;
  }

  return explicitAssetPath;
}

export function createFrontendAssetRequest(
  request: Request,
  config: FrontendConfigLike,
): Request | null {
  const url = new URL(request.url);
  const pathname = resolveFrontendAssetPath(url.pathname, {
    method: request.method,
    accept: request.headers.get('accept'),
    mountPath: config.mountPath,
    spaFallback: config.spaFallback,
  });

  if (!pathname) {
    return null;
  }

  url.pathname = pathname;
  return new Request(url.toString(), request);
}

function getFrontendCacheControl(pathname: string): string | null {
  const assetName = pathname.split('/').pop() ?? '';

  if (
    assetName === 'index.html'
    || assetName === 'manifest.webmanifest'
    || assetName === 'sw.js'
    || assetName === 'sw-precache.json'
  ) {
    return 'no-cache';
  }

  if (hasLikelyContentHash(assetName)) {
    return 'public, max-age=31536000, immutable';
  }

  if (isExplicitAssetPath(pathname)) {
    return 'public, max-age=300';
  }

  return null;
}

export function applyFrontendAssetHeaders(
  response: Response,
  pathname: string,
  configuredHeaders: Record<string, string> | undefined = undefined,
): Response {
  if (!response.ok) {
    return response;
  }

  const cacheControl = getFrontendCacheControl(pathname);
  if (!cacheControl && !configuredHeaders) {
    return response;
  }

  const headers = new Headers(response.headers);
  if (cacheControl) {
    headers.set('Cache-Control', cacheControl);
  }
  for (const [name, value] of Object.entries(configuredHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
