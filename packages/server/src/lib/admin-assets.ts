export function resolveAdminAssetPath(pathname: string): string {
  if (pathname === '/admin' || pathname === '/admin/') {
    return '/admin/index.html';
  }

  if (!pathname.startsWith('/admin/')) {
    return pathname;
  }

  const assetPath = pathname.slice('/admin'.length) || '/';
  if (assetPath === '/' || assetPath === '') {
    return '/admin/index.html';
  }

  if (assetPath.startsWith('/_app/')) {
    return `/admin${assetPath}`;
  }

  const lastSegment = assetPath.split('/').pop() ?? '';
  if (lastSegment.includes('.')) {
    return `/admin${assetPath}`;
  }

  return '/admin/index.html';
}

export function createAdminAssetRequest(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = resolveAdminAssetPath(url.pathname);
  return new Request(url.toString(), request);
}

export function resolveHarnessAssetPath(pathname: string): string {
  if (pathname === '/harness' || pathname === '/harness/') {
    return '/harness.html';
  }

  if (!pathname.startsWith('/harness/')) {
    return '/harness.html';
  }

  const lastSegment = pathname.split('/').pop() ?? '';
  if (lastSegment.includes('.')) {
    return pathname;
  }

  return '/harness.html';
}

export function createHarnessAssetRequest(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = resolveHarnessAssetPath(url.pathname);
  return new Request(url.toString(), request);
}
