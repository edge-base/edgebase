import { EdgeBaseError, networkError, parseErrorResponse } from '@edge-base/core';

interface RefreshResponse {
  accessToken?: string;
  refreshToken?: string;
  message?: string;
}

const COOKIE_REFRESH_TIMEOUT_MS = 15_000;

export async function refreshAccessToken(
  baseUrl: string,
  refreshToken: string,
  transport: 'body' | 'httpOnlyCookie' = 'body',
): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const refreshUrl = `${baseUrl.replace(/\/$/, '')}/api/auth/refresh`;
  const useCookie = transport === 'httpOnlyCookie';
  let response: Response;
  let body: RefreshResponse | null;
  const controller = useCookie ? new AbortController() : null;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const request = (async () => {
      const nextResponse = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(useCookie ? { 'X-EdgeBase-Auth-Transport': 'cookie' } : {}),
        },
        ...(useCookie ? { credentials: 'include' as const } : {}),
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const nextBody = await nextResponse.json().catch(() => null) as RefreshResponse | null;
      return { response: nextResponse, body: nextBody };
    })();
    const result = useCookie
      ? await Promise.race([
          request,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              timedOut = true;
              controller?.abort();
              reject(new Error(`Cookie auth refresh timed out after ${COOKIE_REFRESH_TIMEOUT_MS}ms.`));
            }, COOKIE_REFRESH_TIMEOUT_MS);
          }),
        ])
      : await request;
    response = result.response;
    body = result.body;
  } catch (error) {
    throw networkError(
      timedOut
        ? `Auth session refresh timed out while reaching ${refreshUrl}.`
        : `Auth session refresh could not reach ${refreshUrl}. Make sure the EdgeBase server is running and reachable.`,
      { cause: error },
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }

  if (!response.ok) {
    throw parseErrorResponse(response.status, body);
  }

  if (!body?.accessToken || (!useCookie && !body?.refreshToken)) {
    throw new EdgeBaseError(
      500,
      useCookie
        ? 'Auth refresh succeeded but did not return an accessToken. Check the server auth configuration.'
        : 'Auth refresh succeeded but did not return both accessToken and refreshToken. Check the server auth configuration.',
    );
  }

  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken ?? '',
  };
}
