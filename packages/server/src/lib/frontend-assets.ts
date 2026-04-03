import { normalizeFrontendMountPath, type FrontendConfigLike } from './frontend-config.js';

interface ResolveFrontendAssetPathOptions {
  method?: string;
  accept?: string | null;
  mountPath?: string;
  spaFallback?: boolean;
}

const HTML_ACCEPT_MARKERS = ['text/html', 'application/xhtml+xml'];
const HASHED_ASSET_PATTERN = /(?:^|[-._])[A-Za-z0-9]{8,}\.[A-Za-z0-9]+$/;

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

  if (assetName === 'index.html' || assetName === 'manifest.webmanifest' || assetName === 'sw.js') {
    return 'no-cache';
  }

  if (HASHED_ASSET_PATTERN.test(assetName)) {
    return 'public, max-age=31536000, immutable';
  }

  if (isExplicitAssetPath(pathname)) {
    return 'public, max-age=300';
  }

  return null;
}

export function applyFrontendAssetHeaders(response: Response, pathname: string): Response {
  if (!response.ok) {
    return response;
  }

  const cacheControl = getFrontendCacheControl(pathname);
  if (!cacheControl) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', cacheControl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
