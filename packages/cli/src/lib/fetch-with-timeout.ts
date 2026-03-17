/**
 * Fetch wrapper with AbortController-based timeout.
 *
 * Prevents indefinite hangs on network calls (backup API, export, seed, admin).
 * Default timeout: 30 seconds.
 */

/**
 * Fetch with automatic timeout via AbortController.
 * @param url - Request URL
 * @param init - Standard RequestInit options
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
