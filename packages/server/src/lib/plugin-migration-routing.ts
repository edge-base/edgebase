const PLUGIN_MIGRATION_PATH_PREFIXES = [
  '/api/auth',
  '/api/db',
  '/api/functions',
  '/api/sql',
  '/api/storage',
  '/admin/api',
] as const;

export function shouldRunPluginMigrationsForRequestPath(path: string): boolean {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  if (
    path === '/admin/api/backup'
    || path.startsWith('/admin/api/backup/')
    || path.startsWith('/admin/api/data/backup/')
    || path === '/internal/backup'
    || path.startsWith('/internal/backup/')
  ) {
    return false;
  }

  return PLUGIN_MIGRATION_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
