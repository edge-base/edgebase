import { EdgeBaseError } from '@edge-base/core';

interface RefreshResponse {
  accessToken?: string;
  refreshToken?: string;
  message?: string;
}

export async function refreshAccessToken(baseUrl: string, refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  let response: Response;

  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (error) {
    throw new EdgeBaseError(
      0,
      `Network error: ${error instanceof Error ? error.message : 'Failed to refresh access token.'}`,
    );
  }

  const body = await response.json().catch(() => null) as RefreshResponse | null;
  if (!response.ok) {
    throw new EdgeBaseError(
      response.status,
      typeof body?.message === 'string' ? body.message : 'Failed to refresh access token.',
    );
  }

  if (!body?.accessToken || !body?.refreshToken) {
    throw new EdgeBaseError(500, 'Invalid auth refresh response.');
  }

  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}
