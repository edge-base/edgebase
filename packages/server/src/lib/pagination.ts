/**
 * Pagination parameter validation.
 *
 * Clamps limit to 1..1000 (default 100) and offset to ≥0 (default 0).
 * Handles NaN, negative, and absurdly large values safely.
 */

export function parsePagination(
  limitParam: string | undefined,
  offsetParam: string | undefined,
): { limit: number; offset: number } {
  const rawLimit = parseInt(limitParam || '100', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 100;

  const rawOffset = parseInt(offsetParam || '0', 10);
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  return { limit, offset };
}
