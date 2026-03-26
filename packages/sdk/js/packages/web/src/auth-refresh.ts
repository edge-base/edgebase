import { EdgeBaseError, networkError, parseErrorResponse } from '@edge-base/core';

interface RefreshResponse {
  accessToken?: string;
  refreshToken?: string;
  message?: string;
}

export async function refreshAccessToken(baseUrl: string, refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const refreshUrl = `${baseUrl.replace(/\/$/, '')}/api/auth/refresh`;
  let response: Response;

  try {
    response = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (error) {
    throw networkError(
      `Auth session refresh could not reach ${refreshUrl}. Make sure the EdgeBase server is running and reachable.`,
      { cause: error },
    );
  }

  const body = await response.json().catch(() => null) as RefreshResponse | null;
  if (!response.ok) {
    throw parseErrorResponse(response.status, body);
  }

  if (!body?.accessToken || !body?.refreshToken) {
    throw new EdgeBaseError(
      500,
      'Auth refresh succeeded but did not return both accessToken and refreshToken. Check the server auth configuration.',
    );
  }

  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}
