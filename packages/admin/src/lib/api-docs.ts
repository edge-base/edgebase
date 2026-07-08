function escapeInlineJson(value: string): string {
	return value.replace(/<\/script/gi, '<\\/script');
}

/**
 * Pinned Scalar API Reference release.
 *
 * Never reference a floating "latest" build from a third-party CDN: that would let
 * the CDN ship arbitrary new code into the docs iframe on every deploy. Pin to an
 * exact version tag so the served bytes are stable and auditable.
 */
export const SCALAR_API_REFERENCE_VERSION = '1.25.0';
export const SCALAR_API_REFERENCE_SRC =
	`https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_API_REFERENCE_VERSION}`;

/**
 * Build the standalone HTML document rendered inside the docs iframe.
 *
 * Security model:
 * - The iframe is sandboxed WITHOUT `allow-same-origin`, so it runs on an opaque
 *   origin and cannot read the admin session (`localStorage`) even though the
 *   third-party Scalar bundle executes inside it.
 * - The short-lived admin access token is delivered on demand via `postMessage`
 *   from the parent window and kept in memory only. The long-lived refresh token
 *   never enters the iframe; refreshes are performed by the parent.
 */
export function buildScalarHtml(specJson: string, origin: string): string {
	const escapedSpecJson = escapeInlineJson(specJson);

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>body { margin: 0; }</style>
</head>
<body>
<script>
const EDGEBASE_ORIGIN = ${JSON.stringify(origin)};
const ADMIN_API_PREFIX = '/admin/api/';
const ADMIN_AUTH_SKIP_PATHS = new Set([
\t'/admin/api/auth/login',
\t'/admin/api/auth/refresh',
\t'/admin/api/setup',
\t'/admin/api/setup/status'
]);

const MSG_READY = 'edgebase-docs-ready';
const MSG_REQUEST_TOKEN = 'edgebase-docs-request-token';
const MSG_TOKEN = 'edgebase-admin-token';

// In-memory only. The iframe never touches localStorage, so a compromised Scalar
// bundle cannot exfiltrate the admin session.
let adminAccessToken = null;
let pendingTokenRequest = null;

window.addEventListener('message', (event) => {
\tif (event.source !== window.parent) return;
\tconst data = event.data;
\tif (!data || data.type !== MSG_TOKEN) return;
\tadminAccessToken = typeof data.accessToken === 'string' ? data.accessToken : null;
\tif (pendingTokenRequest) {
\t\tpendingTokenRequest.resolve(adminAccessToken);
\t\tpendingTokenRequest = null;
\t}
});

function requestAdminToken(refresh) {
\tif (pendingTokenRequest) return pendingTokenRequest.promise;
\tlet resolve;
\tconst promise = new Promise((r) => { resolve = r; });
\tpendingTokenRequest = { resolve, promise };
\twindow.parent.postMessage({ type: MSG_REQUEST_TOKEN, refresh: Boolean(refresh) }, '*');
\t// Fail open after a short wait so a silent parent cannot hang every request.
\tsetTimeout(() => {
\t\tif (pendingTokenRequest) {
\t\t\tpendingTokenRequest.resolve(adminAccessToken);
\t\t\tpendingTokenRequest = null;
\t\t}
\t}, 5000);
\treturn promise;
}

function hasExplicitAuthorization(headers) {
\tconst authorization = headers.get('authorization');
\tif (!authorization) return false;
\treturn !/^Bearer\\s*$/i.test(authorization);
}

function hasExplicitServiceKey(headers) {
\treturn Boolean(headers.get('x-edgebase-service-key'));
}

function shouldAttachAdminAuth(url, headers) {
\tif (url.origin !== EDGEBASE_ORIGIN) return false;
\tif (!url.pathname.startsWith(ADMIN_API_PREFIX)) return false;
\tif (ADMIN_AUTH_SKIP_PATHS.has(url.pathname)) return false;
\tif (hasExplicitAuthorization(headers)) return false;
\tif (hasExplicitServiceKey(headers)) return false;
\treturn true;
}

function withAdminToken(request, accessToken) {
\tconst headers = new Headers(request.headers);
\theaders.set('Authorization', \`Bearer \${accessToken}\`);
\treturn new Request(request, { headers });
}

const originalFetch = window.fetch.bind(window);

window.fetch = async (input, init) => {
\tconst baseRequest = input instanceof Request ? input : new Request(input, init);
\tconst requestUrl = new URL(baseRequest.url, EDGEBASE_ORIGIN);
\tif (!shouldAttachAdminAuth(requestUrl, baseRequest.headers)) {
\t\treturn originalFetch(baseRequest);
\t}

\tlet token = adminAccessToken ?? (await requestAdminToken(false));
\tif (!token) return originalFetch(baseRequest);

\tlet response = await originalFetch(withAdminToken(baseRequest.clone(), token));
\tif (response.status !== 401) return response;

\tconst refreshedToken = await requestAdminToken(true);
\tif (!refreshedToken) return response;
\treturn originalFetch(withAdminToken(baseRequest.clone(), refreshedToken));
};

// Let the parent know the iframe is ready to receive the initial access token.
window.parent.postMessage({ type: MSG_READY }, '*');
</script>
<script id="api-reference" data-proxy-url="https://proxy.scalar.com" type="application/json">${escapedSpecJson}<\/script>
<script src=${JSON.stringify(SCALAR_API_REFERENCE_SRC)}><\/script>
</body>
</html>`;
}
