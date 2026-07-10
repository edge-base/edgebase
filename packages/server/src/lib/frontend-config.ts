export interface FrontendConfigLike {
  directory: string;
  mountPath?: string;
  spaFallback?: boolean;
  headers?: Record<string, string>;
}

export function normalizeFrontendMountPath(mountPath: string | undefined): string {
  if (!mountPath) return '/';
  if (mountPath === '/') return '/';
  return mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath;
}
