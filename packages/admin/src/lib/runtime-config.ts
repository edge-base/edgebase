import { browser } from '$app/environment';
import { base } from '$app/paths';

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, '');
}

function normalizeBasePath(value: string | undefined): string {
	if (!value || value === '/') return '';
	const normalized = value.startsWith('/') ? value : `/${value}`;
	return normalized.replace(/\/+$/, '');
}

function joinUrl(origin: string, path: string): string {
	const normalizedOrigin = trimTrailingSlash(origin);
	const normalizedPath = path.startsWith('/') ? path : `/${path}`;
	return `${normalizedOrigin}${normalizedPath}`;
}

const API_ORIGIN_OVERRIDE = trimTrailingSlash(import.meta.env.VITE_EDGEBASE_ADMIN_API_ORIGIN ?? '');
const APP_ORIGIN_OVERRIDE = trimTrailingSlash(import.meta.env.VITE_EDGEBASE_ADMIN_APP_ORIGIN ?? '');

export const ADMIN_APP_BASE_PATH = normalizeBasePath(base);

export function getAdminAppOrigin(): string {
	if (APP_ORIGIN_OVERRIDE) return APP_ORIGIN_OVERRIDE;
	if (browser) return window.location.origin;
	return 'http://127.0.0.1:5180';
}

export function getAdminApiOrigin(): string {
	if (API_ORIGIN_OVERRIDE) return API_ORIGIN_OVERRIDE;
	return getAdminAppOrigin();
}

export function getAdminApiUrl(path = ''): string {
	const normalizedPath = path.replace(/^\/+/, '');
	return joinUrl(
		getAdminApiOrigin(),
		normalizedPath ? `/admin/api/${normalizedPath}` : '/admin/api',
	);
}

export function getWorkerUrl(path = ''): string {
	return joinUrl(getAdminApiOrigin(), path || '/');
}
