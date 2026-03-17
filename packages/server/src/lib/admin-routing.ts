function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  return trimmed;
}

export function resolveAdminRedirectTarget(
  requestUrl: string,
  adminOrigin: string | undefined,
): string | null {
  const origin = normalizeOrigin(adminOrigin);
  if (!origin) return null;

  const request = new URL(requestUrl);
  let pathname = request.pathname;
  if (pathname === '/' || pathname === '') {
    pathname = '/';
  } else if (pathname === '/admin' || pathname === '/admin/') {
    pathname = '/';
  } else if (pathname.startsWith('/admin/')) {
    pathname = pathname.slice('/admin'.length) || '/';
  }

  const target = new URL(pathname, `${origin}/`);
  target.search = request.search;
  target.hash = request.hash;
  return target.toString();
}

export function resolveAdminFaviconTarget(adminOrigin: string | undefined): string | null {
  const origin = normalizeOrigin(adminOrigin);
  if (!origin) return null;
  return `${origin}/favicon.svg`;
}
