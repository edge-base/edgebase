/**
 * Durable Object fetch with single retry on transient failure (DO reset).
 *
 * Body must be pre-read as a string — ReadableStream cannot be replayed.
 * Headers are cloned on retry to avoid mutation issues.
 *
 * When `safeToRetry` is false (default), non-idempotent requests are NOT
 * retried to avoid duplicate writes, side-effect duplication (hooks,
 * triggers, database-live events), and non-idempotent ops like `$op: increment`.
 */
export async function fetchDOWithRetry(
  stub: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> },
  url: string,
  init: { method: string; headers: HeadersInit; body?: string | null },
  options?: { safeToRetry?: boolean },
): Promise<Response> {
  try {
    return await stub.fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body ?? undefined,
    });
  } catch (err) {
    // Only retry if the caller explicitly marked the request as safe to retry.
    // Non-idempotent writes (POST, PATCH with increment, DELETE with hooks)
    // must NOT be silently retried — let the error propagate to the client.
    if (!options?.safeToRetry) throw err;

    // DO may have reset — retry once with cloned headers
    return stub.fetch(url, {
      method: init.method,
      headers: new Headers(init.headers),
      body: init.body ?? undefined,
    });
  }
}
