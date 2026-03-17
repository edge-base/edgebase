function escapeInlineJson(value: string): string {
	return value.replace(/<\/script/gi, '<\\/script');
}

export function buildScalarHtml(specJson: string, origin: string, authStorageKey: string): string {
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
const ADMIN_AUTH_STORAGE_KEY = ${JSON.stringify(authStorageKey)};
const ADMIN_API_PREFIX = '/admin/api/';
const ADMIN_AUTH_SKIP_PATHS = new Set([
\t'/admin/api/auth/login',
\t'/admin/api/auth/refresh',
\t'/admin/api/setup',
\t'/admin/api/setup/status'
]);

function readAdminAuth() {
\ttry {
\t\tconst raw = localStorage.getItem(ADMIN_AUTH_STORAGE_KEY);
\t\treturn raw ? JSON.parse(raw) : null;
\t} catch {
\t\treturn null;
\t}
}

function writeAdminAuth(state) {
\ttry {
\t\tlocalStorage.setItem(ADMIN_AUTH_STORAGE_KEY, JSON.stringify(state));
\t} catch {
\t\t// Ignore storage sync failures inside the docs iframe.
\t}
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

async function refreshAdminAccessToken() {
\tconst state = readAdminAuth();
\tif (!state?.refreshToken) return null;

\tconst refreshRequest = new Request(\`\${EDGEBASE_ORIGIN}/admin/api/auth/refresh\`, {
\t\tmethod: 'POST',
\t\theaders: { 'Content-Type': 'application/json' },
\t\tbody: JSON.stringify({ refreshToken: state.refreshToken })
\t});
\tconst refreshResponse = await originalFetch(refreshRequest);
\tif (!refreshResponse.ok) return null;

\tconst refreshed = await refreshResponse.json().catch(() => null);
\tif (!refreshed?.accessToken || !refreshed?.refreshToken) return null;

\twriteAdminAuth({
\t\t...state,
\t\taccessToken: refreshed.accessToken,
\t\trefreshToken: refreshed.refreshToken,
\t\tadmin: refreshed.admin ?? state.admin ?? null
\t});
\treturn refreshed.accessToken;
}

window.fetch = async (input, init) => {
\tconst baseRequest = input instanceof Request ? input : new Request(input, init);
\tconst requestUrl = new URL(baseRequest.url, EDGEBASE_ORIGIN);
\tif (!shouldAttachAdminAuth(requestUrl, baseRequest.headers)) {
\t\treturn originalFetch(baseRequest);
\t}

\tconst state = readAdminAuth();
\tif (!state?.accessToken) {
\t\treturn originalFetch(baseRequest);
\t}

\tconst send = (token) => originalFetch(withAdminToken(baseRequest.clone(), token));
\tlet response = await send(state.accessToken);
\tif (response.status !== 401) return response;

\tconst refreshedToken = await refreshAdminAccessToken();
\tif (!refreshedToken) return response;
\treturn send(refreshedToken);
};
</script>
<script id="api-reference" data-proxy-url="https://proxy.scalar.com" type="application/json">${escapedSpecJson}<\/script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"><\/script>
</body>
</html>`;
}
