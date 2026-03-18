import type { FilterTuple } from '@edge-base/core';

/**
 * Client-side filter matching for Database Live subscriptions.
 *
 * Instead of server-side per-subscription filtering,
 * all DB change events are broadcast to connected clients,
 * and this module filters locally for matching subscriptions.
 *
 * Supports operators: ==, !=, <, >, <=, >=, contains, contains-any, in
 *
 * @example
 * const matches = matchesFilter(data, {
 *   status: 'published',
 *   'score.>': 10,
 * });
 */

// ─── Types ───

export type FilterOperator = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'contains' | 'contains-any' | 'in' | 'not in';

export interface FilterEntry {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

interface ParsedFilterEntry {
  field: string;
  operator: string;
  value: unknown;
}

// ─── Filter Matching ───

/**
 * Check if data matches all filter conditions.
 * Filter keys can include an operator suffix: "field.operator"
 * e.g. "score.>" → field "score", operator ">"
 * Without suffix, defaults to "=="
 */
export function matchesFilter(
  data: Record<string, unknown>,
  filters: Record<string, unknown> | FilterTuple[],
): boolean {
  const entries = Array.isArray(filters) && filters.length > 0 && Array.isArray(filters[0])
    ? parseTupleFilters(filters as FilterTuple[])
    : parseFilters(filters as Record<string, unknown>);
  return entries.every(({ field, operator, value }) =>
    evaluateCondition(data[field], operator, value),
  );
}

/**
 * Parse filter object into structured FilterEntry array.
 * "field" → { field, ==, value }
 * "field.>" → { field, >, value }
 */
function parseFilters(filters: Record<string, unknown>): ParsedFilterEntry[] {
  const entries: ParsedFilterEntry[] = [];

  for (const [key, value] of Object.entries(filters)) {
    // Check for operator suffix
    const dotIdx = key.lastIndexOf('.');
    if (dotIdx > 0) {
      const possibleOp = key.slice(dotIdx + 1);
      if (isValidOperator(possibleOp)) {
        entries.push({
          field: key.slice(0, dotIdx),
          operator: possibleOp,
          value,
        });
        continue;
      }
    }

    // Default: equality
    entries.push({ field: key, operator: '==', value });
  }

  return entries;
}

/**
 * Parse tuple-format filters: [field, operator, value][]
 * This is the standard filter format used by SDK query builders.
 */
function parseTupleFilters(tuples: FilterTuple[]): ParsedFilterEntry[] {
  return tuples.map(([field, operator, value]) => ({ field, operator, value }));
}

function isValidOperator(op: string): op is FilterOperator {
  return ['==', '!=', '<', '>', '<=', '>=', 'contains', 'contains-any', 'in', 'not in'].includes(op);
}

function evaluateCondition(
  fieldValue: unknown,
  operator: string,
  expected: unknown,
): boolean {
  switch (operator) {
    case '==':
      return fieldValue === expected;
    case '!=':
      return fieldValue !== expected;
    case '<':
      return (fieldValue as number) < (expected as number);
    case '>':
      return (fieldValue as number) > (expected as number);
    case '<=':
      return (fieldValue as number) <= (expected as number);
    case '>=':
      return (fieldValue as number) >= (expected as number);
    case 'contains':
      if (typeof fieldValue === 'string') return fieldValue.includes(expected as string);
      if (Array.isArray(fieldValue)) return fieldValue.includes(expected);
      return false;
    case 'contains-any':
      if (!Array.isArray(fieldValue) || !Array.isArray(expected)) return false;
      return expected.some(value => fieldValue.includes(value));
    case 'in':
      if (Array.isArray(expected)) return expected.includes(fieldValue);
      return false;
    case 'not in':
      if (Array.isArray(expected)) return !expected.includes(fieldValue);
      return true;
    default:
      return false;
  }
}
