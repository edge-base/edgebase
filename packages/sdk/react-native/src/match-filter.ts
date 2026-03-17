/**
 * Client-side filter matching for database-live subscriptions.
 *
 * React Native shares the same query/filter tuple semantics as the web SDK,
 * so the matching logic stays identical across both clients.
 */

export type FilterOperator = '==' | '!=' | '<' | '>' | '<=' | '>=' | 'contains' | 'contains-any' | 'in' | 'not in';

export interface FilterEntry {
  field: string;
  operator: FilterOperator;
  value: unknown;
}

export function matchesFilter(
  data: Record<string, unknown>,
  filters: Record<string, unknown> | [string, FilterOperator, unknown][],
): boolean {
  const entries = Array.isArray(filters) && filters.length > 0 && Array.isArray(filters[0])
    ? parseTupleFilters(filters as [string, FilterOperator, unknown][])
    : parseFilters(filters as Record<string, unknown>);
  return entries.every(({ field, operator, value }) =>
    evaluateCondition(data[field], operator, value),
  );
}

function parseFilters(filters: Record<string, unknown>): FilterEntry[] {
  const entries: FilterEntry[] = [];

  for (const [key, value] of Object.entries(filters)) {
    const dotIdx = key.lastIndexOf('.');
    if (dotIdx > 0) {
      const possibleOp = key.slice(dotIdx + 1);
      if (isValidOperator(possibleOp)) {
        entries.push({
          field: key.slice(0, dotIdx),
          operator: possibleOp as FilterOperator,
          value,
        });
        continue;
      }
    }

    entries.push({ field: key, operator: '==', value });
  }

  return entries;
}

function parseTupleFilters(tuples: [string, FilterOperator, unknown][]): FilterEntry[] {
  return tuples.map(([field, operator, value]) => ({ field, operator, value }));
}

function isValidOperator(op: string): op is FilterOperator {
  return ['==', '!=', '<', '>', '<=', '>=', 'contains', 'contains-any', 'in', 'not in'].includes(op);
}

function evaluateCondition(
  fieldValue: unknown,
  operator: FilterOperator,
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
