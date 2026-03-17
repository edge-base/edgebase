import { base } from '$app/paths';

const APP_ORIGIN = 'http://edgebase.local';
const LOGIN_PATH = `${base}/login`;
const MANUAL_LOGOUT_FLAG = 'edgebase_admin_manual_logout';

function toPath(url: URL): string {
	return `${url.pathname}${url.search}${url.hash}`;
}

function isAppPath(pathname: string): boolean {
	if (!base) return pathname.startsWith('/');
	return pathname === base || pathname.startsWith(`${base}/`);
}

export function normalizePostLoginPath(input: string | URL | null | undefined): string | null {
	if (!input) return null;

	try {
		const url = typeof input === 'string' ? new URL(input, APP_ORIGIN) : input;
		if (!isAppPath(url.pathname)) return null;
		if (url.pathname === LOGIN_PATH || url.pathname === `${LOGIN_PATH}/`) return null;
		return toPath(url);
	} catch {
		return null;
	}
}

export function buildLoginPath(input: string | URL | null | undefined): string {
	const next = normalizePostLoginPath(input);
	if (!next) return LOGIN_PATH;

	const url = new URL(LOGIN_PATH, APP_ORIGIN);
	url.searchParams.set('next', next);
	return toPath(url);
}

export function getPostLoginPath(url: URL): string {
	return (
		normalizePostLoginPath(url.searchParams.get('next'))
		?? normalizePostLoginPath(url.searchParams.get('returnTo'))
		?? `${base}/`
	);
}

export function markManualLogout(): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(MANUAL_LOGOUT_FLAG, '1');
	} catch {
		// Ignore storage errors and fall back to the standard redirect.
	}
}

export function consumeManualLogout(): boolean {
	if (typeof sessionStorage === 'undefined') return false;
	try {
		const flagged = sessionStorage.getItem(MANUAL_LOGOUT_FLAG) === '1';
		sessionStorage.removeItem(MANUAL_LOGOUT_FLAG);
		return flagged;
	} catch {
		return false;
	}
}
