import type { SchemaField, TableConfig } from '@edge-base/shared';
import { validationError } from './errors.js';
import { buildEffectiveSchema } from './schema.js';

export const MAX_RELATED_SEARCH_PAYLOAD_BYTES = 64 * 1024;
export const MAX_RELATED_SEARCH_QUERY_LENGTH = 4_096;
export const MAX_RELATED_SEARCH_AFTER_LENGTH = 1_024;
export const MAX_RELATED_SEARCH_QUERY_VARIANTS = 2;
export const MAX_RELATED_SEARCH_LIMIT = 1_000;
export const MAX_RELATED_SEARCH_DEPTH = 256;
export const MAX_RELATED_SEARCH_WHERE_CLAUSES = 16;
export const MAX_RELATED_SEARCH_PRINCIPAL_BRANCHES = 8;
export const MAX_RELATED_SEARCH_IN_VALUES = 32;
export const MAX_RELATED_SEARCH_REQUIRED_ANCESTOR_IDS = 1_000;

export type SearchRelatedWhere =
  | [field: string, op: '==' | 'in', value: unknown]
  | [field: string, op: 'is-not-true'];

export type SearchRelatedGroupMembership = {
  table: string;
  grantPrincipalField: string;
  membershipGroupField: string;
  whereAll: SearchRelatedWhere[];
};

export type SearchRelatedPrincipalBranch = {
  whereAll: SearchRelatedWhere[];
  groupMembership?: SearchRelatedGroupMembership;
};

export type SearchRelatedGrantSource = {
  table: string;
  ancestorField: string;
  whereAll: SearchRelatedWhere[];
  principalAny: SearchRelatedPrincipalBranch[];
};

export type SearchRelatedAncestry = {
  parentField: string;
  parentTypeField: string;
  stopParentType: string;
  maxDepth: number;
  whereAll: SearchRelatedWhere[];
  requiredAncestorIds?: string[];
  grantSource?: SearchRelatedGrantSource;
};

export type SearchRelatedRelation = {
  localField: string;
  table: string;
  whereAll: SearchRelatedWhere[];
  ancestry?: SearchRelatedAncestry;
};

export type SearchRelatedOrder =
  | [{ field: 'id'; direction: 'asc' }]
  | [
      { field: string; direction: 'asc' },
      { field: 'id'; direction: 'asc' },
    ];

export type SearchRelatedCursor = {
  values: string[];
};

export type SearchRelatedInput = {
  query: string;
  queryVariants?: string[];
  order: SearchRelatedOrder;
  after?: SearchRelatedCursor;
  limit: number;
  includeTotal: boolean;
  relation: SearchRelatedRelation;
};

export function createSearchRelatedCursor(
  row: Record<string, unknown>,
  order: SearchRelatedOrder,
): SearchRelatedCursor {
  return {
    values: order.map(({ field }) => {
      const value = row[field];
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Related-search ordered field '${field}' did not produce a string value.`);
      }
      return value;
    }),
  };
}

type JsonRecord = Record<string, unknown>;

type ReferenceTarget = {
  table: string;
  column: string;
};

const hasOwn = (value: object, key: PropertyKey): boolean => (
  Object.prototype.hasOwnProperty.call(value, key)
);

function invalid(path: string, reason: string): never {
  throw validationError(
    `Invalid related search input at '${path}': ${reason}`,
    undefined,
    'invalid-related-search',
  );
}

function expectRecord(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'expected an object.');
  }
  return value as JsonRecord;
}

function expectOnlyKeys(value: JsonRecord, path: string, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      invalid(`${path}.${String(key)}`, 'unknown field.');
    }
  }
}

function expectString(
  value: unknown,
  path: string,
  options: { maxLength?: number; nonBlank?: boolean } = {},
): string {
  if (typeof value !== 'string') invalid(path, 'expected a string.');
  if (options.nonBlank !== false && value.trim().length === 0) {
    invalid(path, 'must not be blank.');
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    invalid(path, `must not exceed ${options.maxLength} characters.`);
  }
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, 'expected a boolean.');
  return value;
}

function expectBoundedInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(path, `expected an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function assertPayloadBound(raw: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    invalid('$', 'must be JSON serializable.');
  }
  if (serialized === undefined) invalid('$', 'expected a JSON object.');
  if (new TextEncoder().encode(serialized).byteLength > MAX_RELATED_SEARCH_PAYLOAD_BYTES) {
    invalid('$', `must not exceed ${MAX_RELATED_SEARCH_PAYLOAD_BYTES} UTF-8 bytes.`);
  }
}

function referenceTarget(field: SchemaField): ReferenceTarget | null {
  const reference = field.references;
  if (!reference) return null;
  if (typeof reference !== 'string') {
    return {
      table: reference.table,
      column: reference.column ?? 'id',
    };
  }

  const match = reference.trim().match(/^([^()\s]+)(?:\(([^()\s]+)\))?$/);
  if (!match) return { table: '', column: '' };
  return {
    table: match[1]!,
    column: match[2] ?? 'id',
  };
}

function isTextIdentifierField(field: SchemaField): boolean {
  return field.type === 'string' || field.type === 'text';
}

function assertTextIdentifierField(field: SchemaField, path: string): void {
  if (!isTextIdentifierField(field)) {
    invalid(path, 'must be a string or text field.');
  }
}

function assertSameJoinType(
  left: SchemaField,
  right: SchemaField,
  path: string,
): void {
  if (isTextIdentifierField(left) && isTextIdentifierField(right)) return;
  if (left.type !== right.type || left.type === 'json') {
    invalid(path, 'join fields must have compatible scalar types.');
  }
}

function isIdentityField(fieldName: string, field: SchemaField): boolean {
  return fieldName === 'id'
    || /Id$/i.test(fieldName)
    || field.primaryKey === true
    || field.references !== undefined;
}

function assertComparableValue(
  value: unknown,
  field: SchemaField,
  path: string,
): void {
  if (value === null || typeof value === 'object' || value === undefined) {
    invalid(path, 'expected a non-null scalar value.');
  }

  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      invalid(path, 'expected a finite number.');
    }
    return;
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') invalid(path, 'expected a boolean.');
    return;
  }
  if (field.type === 'json') {
    invalid(path, 'JSON fields cannot be used as authority predicates.');
  }
  if (typeof value !== 'string') invalid(path, 'expected a string.');
}

/**
 * Validate and clone the trusted server-only related-search request.
 *
 * The returned object contains only the closed contract. In particular, it
 * cannot carry pre-materialized group membership arrays. Authority is
 * expressed through bounded predicates, a co-located membership relation,
 * and an optional bounded set of required ancestor roots.
 */
export function validateSearchRelatedInput(
  raw: unknown,
  sourceTable: string,
  tables: Record<string, TableConfig>,
): SearchRelatedInput {
  assertPayloadBound(raw);
  const input = expectRecord(raw, '$');
  expectOnlyKeys(input, '$', [
    'query',
    'queryVariants',
    'order',
    'after',
    'limit',
    'includeTotal',
    'relation',
  ]);

  const schemaCache = new Map<string, Record<string, SchemaField>>();

  const tableConfig = (tableName: string, path: string): TableConfig => {
    if (!hasOwn(tables, tableName)) {
      invalid(path, `table '${tableName}' is not in the current database.`);
    }
    return tables[tableName]!;
  };

  const tableSchema = (tableName: string, path: string): Record<string, SchemaField> => {
    const cached = schemaCache.get(tableName);
    if (cached) return cached;
    const schema = buildEffectiveSchema(tableConfig(tableName, path).schema);
    schemaCache.set(tableName, schema);
    return schema;
  };

  const tableField = (tableName: string, rawField: unknown, path: string): {
    name: string;
    field: SchemaField;
  } => {
    const name = expectString(rawField, path);
    if (name.startsWith('_fts')) {
      invalid(path, 'provider-managed FTS fields are not addressable.');
    }
    const schema = tableSchema(tableName, path);
    if (!hasOwn(schema, name)) {
      invalid(path, `field '${name}' is not in table '${tableName}'.`);
    }
    return { name, field: schema[name]! };
  };

  const parseWhereAll = (
    rawWhereAll: unknown,
    tableName: string,
    path: string,
    requireOne: boolean,
  ): SearchRelatedWhere[] => {
    if (!Array.isArray(rawWhereAll)) invalid(path, 'expected an array.');
    if (rawWhereAll.length > MAX_RELATED_SEARCH_WHERE_CLAUSES) {
      invalid(path, `must not contain more than ${MAX_RELATED_SEARCH_WHERE_CLAUSES} predicates.`);
    }
    if (requireOne && rawWhereAll.length === 0) {
      invalid(path, 'must contain at least one predicate.');
    }

    return rawWhereAll.map((rawWhere, index) => {
      const wherePath = `${path}[${index}]`;
      if (!Array.isArray(rawWhere)) invalid(wherePath, 'expected a predicate tuple.');
      if (rawWhere.length !== 2 && rawWhere.length !== 3) {
        invalid(wherePath, 'expected [field, operator, value] or [field, "is-not-true"].');
      }
      const { name, field } = tableField(tableName, rawWhere[0], `${wherePath}[0]`);
      const operator = rawWhere[1];

      if (operator === 'is-not-true') {
        if (rawWhere.length !== 2) invalid(wherePath, "'is-not-true' does not accept a value.");
        if (field.type !== 'boolean') {
          invalid(`${wherePath}[0]`, "'is-not-true' requires a boolean field.");
        }
        return [name, 'is-not-true'];
      }

      if (operator !== '==' && operator !== 'in') {
        invalid(`${wherePath}[1]`, "expected '==', 'in', or 'is-not-true'.");
      }
      if (rawWhere.length !== 3) invalid(wherePath, `'${operator}' requires a value.`);

      if (operator === '==') {
        assertComparableValue(rawWhere[2], field, `${wherePath}[2]`);
        return [name, '==', rawWhere[2]];
      }

      if (isIdentityField(name, field)) {
        invalid(
          `${wherePath}[1]`,
          "'in' is not allowed for identity/reference fields; use equality or a co-located relation.",
        );
      }
      if (!Array.isArray(rawWhere[2]) || rawWhere[2].length === 0) {
        invalid(`${wherePath}[2]`, "'in' requires a non-empty array.");
      }
      if (rawWhere[2].length > MAX_RELATED_SEARCH_IN_VALUES) {
        invalid(
          `${wherePath}[2]`,
          `must not contain more than ${MAX_RELATED_SEARCH_IN_VALUES} values.`,
        );
      }
      const values = rawWhere[2].map((value, valueIndex) => {
        assertComparableValue(value, field, `${wherePath}[2][${valueIndex}]`);
        return value;
      });
      return [name, 'in', values];
    });
  };

  const sourceName = expectString(sourceTable, 'sourceTable');
  tableConfig(sourceName, 'sourceTable');
  const sourceId = tableField(sourceName, 'id', 'sourceTable.id');
  assertTextIdentifierField(sourceId.field, 'sourceTable.id');

  const query = expectString(input.query, '$.query', {
    maxLength: MAX_RELATED_SEARCH_QUERY_LENGTH,
  });
  let queryVariants: string[] | undefined;
  if (hasOwn(input, 'queryVariants')) {
    if (!Array.isArray(input.queryVariants)) {
      invalid('$.queryVariants', 'expected an array.');
    }
    if (input.queryVariants.length > MAX_RELATED_SEARCH_QUERY_VARIANTS) {
      invalid(
        '$.queryVariants',
        `must not contain more than ${MAX_RELATED_SEARCH_QUERY_VARIANTS} values.`,
      );
    }
    const distinct = new Set<string>([query]);
    const alternatives: string[] = [];
    input.queryVariants.forEach((rawVariant, index) => {
      const variant = expectString(rawVariant, `$.queryVariants[${index}]`, {
        maxLength: MAX_RELATED_SEARCH_QUERY_LENGTH,
      });
      if (!distinct.has(variant)) {
        distinct.add(variant);
        alternatives.push(variant);
      }
    });
    if (distinct.size > MAX_RELATED_SEARCH_QUERY_VARIANTS) {
      invalid(
        '$.queryVariants',
        `query and queryVariants must contain at most ${MAX_RELATED_SEARCH_QUERY_VARIANTS} distinct values.`,
      );
    }
    if (alternatives.length > 0) queryVariants = alternatives;
  }
  const limit = expectBoundedInteger(input.limit, '$.limit', 1, MAX_RELATED_SEARCH_LIMIT);
  const includeTotal = expectBoolean(input.includeTotal, '$.includeTotal');

  if (!Array.isArray(input.order) || (input.order.length !== 1 && input.order.length !== 2)) {
    invalid('$.order', 'expected id ordering or a two-field ordering ending in id.');
  }
  const parsedOrder = input.order.map((rawValue, index) => {
    const path = `$.order[${index}]`;
    const rawOrder = expectRecord(rawValue, path);
    expectOnlyKeys(rawOrder, path, ['field', 'direction']);
    const orderedField = tableField(sourceName, rawOrder.field, `${path}.field`);
    assertTextIdentifierField(orderedField.field, `${path}.field`);
    if (rawOrder.direction !== 'asc') {
      invalid(`${path}.direction`, "must be 'asc'.");
    }
    return { field: orderedField.name, direction: 'asc' as const };
  });
  if (parsedOrder[parsedOrder.length - 1]!.field !== 'id') {
    invalid(`$.order[${parsedOrder.length - 1}].field`, "must be 'id'.");
  }
  if (parsedOrder.length === 2 && parsedOrder[0]!.field === 'id') {
    invalid('$.order[0].field', 'must be distinct from the final id field.');
  }
  const order = parsedOrder as SearchRelatedOrder;

  let after: SearchRelatedCursor | undefined;
  if (hasOwn(input, 'after')) {
    const rawAfter = expectRecord(input.after, '$.after');
    expectOnlyKeys(rawAfter, '$.after', ['values']);
    if (!Array.isArray(rawAfter.values) || rawAfter.values.length !== order.length) {
      invalid('$.after.values', `expected exactly ${order.length} values aligned to order.`);
    }
    after = {
      values: rawAfter.values.map((value, index) => expectString(
        value,
        `$.after.values[${index}]`,
        { maxLength: MAX_RELATED_SEARCH_AFTER_LENGTH },
      )),
    };
  }

  const rawRelation = expectRecord(input.relation, '$.relation');
  expectOnlyKeys(rawRelation, '$.relation', ['localField', 'table', 'whereAll', 'ancestry']);
  const relationTable = expectString(rawRelation.table, '$.relation.table');
  tableConfig(relationTable, '$.relation.table');
  const relationId = tableField(relationTable, 'id', '$.relation.table.id');
  assertTextIdentifierField(relationId.field, '$.relation.table.id');
  const localField = tableField(sourceName, rawRelation.localField, '$.relation.localField');
  assertSameJoinType(localField.field, relationId.field, '$.relation.localField');

  if (sourceName === relationTable) {
    if (localField.name !== 'id') {
      invalid('$.relation.localField', 'a self relation must use the source id field.');
    }
  } else {
    const target = referenceTarget(localField.field);
    if (!target || target.table !== relationTable || target.column !== 'id') {
      invalid(
        '$.relation.localField',
        `must reference '${relationTable}.id' from source table '${sourceName}'.`,
      );
    }
  }

  const relationWhere = parseWhereAll(
    rawRelation.whereAll,
    relationTable,
    '$.relation.whereAll',
    true,
  );

  let ancestry: SearchRelatedAncestry | undefined;
  if (hasOwn(rawRelation, 'ancestry')) {
    const rawAncestry = expectRecord(rawRelation.ancestry, '$.relation.ancestry');
    expectOnlyKeys(rawAncestry, '$.relation.ancestry', [
      'parentField',
      'parentTypeField',
      'stopParentType',
      'maxDepth',
      'whereAll',
      'requiredAncestorIds',
      'grantSource',
    ]);

    const parentField = tableField(
      relationTable,
      rawAncestry.parentField,
      '$.relation.ancestry.parentField',
    );
    assertTextIdentifierField(parentField.field, '$.relation.ancestry.parentField');
    if (parentField.name === 'id') {
      invalid('$.relation.ancestry.parentField', 'must not be the id field.');
    }
    const parentTarget = referenceTarget(parentField.field);
    if (parentTarget && (parentTarget.table !== relationTable || parentTarget.column !== 'id')) {
      invalid(
        '$.relation.ancestry.parentField',
        `a declared parent reference must target '${relationTable}.id'.`,
      );
    }

    const parentTypeField = tableField(
      relationTable,
      rawAncestry.parentTypeField,
      '$.relation.ancestry.parentTypeField',
    );
    assertTextIdentifierField(parentTypeField.field, '$.relation.ancestry.parentTypeField');
    if (parentTypeField.name === 'id' || parentTypeField.name === parentField.name) {
      invalid(
        '$.relation.ancestry.parentTypeField',
        'must be distinct from the id and parent fields.',
      );
    }

    const stopParentType = expectString(
      rawAncestry.stopParentType,
      '$.relation.ancestry.stopParentType',
      { maxLength: 256 },
    );
    const maxDepth = expectBoundedInteger(
      rawAncestry.maxDepth,
      '$.relation.ancestry.maxDepth',
      1,
      MAX_RELATED_SEARCH_DEPTH,
    );
    const ancestryWhere = parseWhereAll(
      rawAncestry.whereAll,
      relationTable,
      '$.relation.ancestry.whereAll',
      true,
    );

    let requiredAncestorIds: string[] | undefined;
    if (hasOwn(rawAncestry, 'requiredAncestorIds')) {
      if (
        !Array.isArray(rawAncestry.requiredAncestorIds)
        || rawAncestry.requiredAncestorIds.length === 0
        || rawAncestry.requiredAncestorIds.length > MAX_RELATED_SEARCH_REQUIRED_ANCESTOR_IDS
      ) {
        invalid(
          '$.relation.ancestry.requiredAncestorIds',
          `expected 1 through ${MAX_RELATED_SEARCH_REQUIRED_ANCESTOR_IDS.toLocaleString('en-US')} values.`,
        );
      }
      const seen = new Set<string>();
      requiredAncestorIds = rawAncestry.requiredAncestorIds.map((rawId, index) => {
        const id = expectString(
          rawId,
          `$.relation.ancestry.requiredAncestorIds[${index}]`,
          { maxLength: 512 },
        );
        if (seen.has(id)) {
          invalid(
            `$.relation.ancestry.requiredAncestorIds[${index}]`,
            'must not contain a duplicate value.',
          );
        }
        seen.add(id);
        return id;
      });
    }

    let grantSource: SearchRelatedGrantSource | undefined;
    if (hasOwn(rawAncestry, 'grantSource')) {
      const rawGrant = expectRecord(
        rawAncestry.grantSource,
        '$.relation.ancestry.grantSource',
      );
      expectOnlyKeys(rawGrant, '$.relation.ancestry.grantSource', [
        'table',
        'ancestorField',
        'whereAll',
        'principalAny',
      ]);
      const grantTable = expectString(
        rawGrant.table,
        '$.relation.ancestry.grantSource.table',
      );
      tableConfig(grantTable, '$.relation.ancestry.grantSource.table');
      const ancestorField = tableField(
        grantTable,
        rawGrant.ancestorField,
        '$.relation.ancestry.grantSource.ancestorField',
      );
      assertSameJoinType(
        ancestorField.field,
        relationId.field,
        '$.relation.ancestry.grantSource.ancestorField',
      );
      const ancestorTarget = referenceTarget(ancestorField.field);
      if (!ancestorTarget
        || ancestorTarget.table !== relationTable
        || ancestorTarget.column !== 'id') {
        invalid(
          '$.relation.ancestry.grantSource.ancestorField',
          `must reference '${relationTable}.id'.`,
        );
      }
      const grantWhere = parseWhereAll(
        rawGrant.whereAll,
        grantTable,
        '$.relation.ancestry.grantSource.whereAll',
        true,
      );

      if (!Array.isArray(rawGrant.principalAny)
        || rawGrant.principalAny.length === 0
        || rawGrant.principalAny.length > MAX_RELATED_SEARCH_PRINCIPAL_BRANCHES) {
        invalid(
          '$.relation.ancestry.grantSource.principalAny',
          `expected 1 through ${MAX_RELATED_SEARCH_PRINCIPAL_BRANCHES} branches.`,
        );
      }

      const principalAny = rawGrant.principalAny.map((rawBranch, branchIndex) => {
        const branchPath = `$.relation.ancestry.grantSource.principalAny[${branchIndex}]`;
        const branch = expectRecord(rawBranch, branchPath);
        expectOnlyKeys(branch, branchPath, ['whereAll', 'groupMembership']);
        const branchWhere = parseWhereAll(
          branch.whereAll,
          grantTable,
          `${branchPath}.whereAll`,
          true,
        );

        if (!hasOwn(branch, 'groupMembership')) {
          return { whereAll: branchWhere };
        }

        const rawMembership = expectRecord(
          branch.groupMembership,
          `${branchPath}.groupMembership`,
        );
        expectOnlyKeys(rawMembership, `${branchPath}.groupMembership`, [
          'table',
          'grantPrincipalField',
          'membershipGroupField',
          'whereAll',
        ]);
        const membershipTable = expectString(
          rawMembership.table,
          `${branchPath}.groupMembership.table`,
        );
        tableConfig(membershipTable, `${branchPath}.groupMembership.table`);
        const grantPrincipalField = tableField(
          grantTable,
          rawMembership.grantPrincipalField,
          `${branchPath}.groupMembership.grantPrincipalField`,
        );
        const membershipGroupField = tableField(
          membershipTable,
          rawMembership.membershipGroupField,
          `${branchPath}.groupMembership.membershipGroupField`,
        );
        assertTextIdentifierField(
          grantPrincipalField.field,
          `${branchPath}.groupMembership.grantPrincipalField`,
        );
        assertSameJoinType(
          grantPrincipalField.field,
          membershipGroupField.field,
          `${branchPath}.groupMembership.membershipGroupField`,
        );
        const membershipTarget = referenceTarget(membershipGroupField.field);
        if (!membershipTarget || membershipTarget.column !== 'id') {
          invalid(
            `${branchPath}.groupMembership.membershipGroupField`,
            'must be an id reference to a table in the current database.',
          );
        }
        tableConfig(
          membershipTarget.table,
          `${branchPath}.groupMembership.membershipGroupField`,
        );
        const membershipTargetId = tableField(
          membershipTarget.table,
          membershipTarget.column,
          `${branchPath}.groupMembership.membershipGroupField`,
        );
        assertSameJoinType(
          membershipGroupField.field,
          membershipTargetId.field,
          `${branchPath}.groupMembership.membershipGroupField`,
        );
        const membershipWhere = parseWhereAll(
          rawMembership.whereAll,
          membershipTable,
          `${branchPath}.groupMembership.whereAll`,
          true,
        );

        return {
          whereAll: branchWhere,
          groupMembership: {
            table: membershipTable,
            grantPrincipalField: grantPrincipalField.name,
            membershipGroupField: membershipGroupField.name,
            whereAll: membershipWhere,
          },
        };
      });
      grantSource = {
        table: grantTable,
        ancestorField: ancestorField.name,
        whereAll: grantWhere,
        principalAny,
      };
    }
    if (!requiredAncestorIds && !grantSource) {
      invalid(
        '$.relation.ancestry',
        'must declare requiredAncestorIds, grantSource, or both as ancestry authority.',
      );
    }

    ancestry = {
      parentField: parentField.name,
      parentTypeField: parentTypeField.name,
      stopParentType,
      maxDepth,
      whereAll: ancestryWhere,
      ...(requiredAncestorIds ? { requiredAncestorIds } : {}),
      ...(grantSource ? { grantSource } : {}),
    };
  }

  const relation: SearchRelatedRelation = {
    localField: localField.name,
    table: relationTable,
    whereAll: relationWhere,
    ...(ancestry ? { ancestry } : {}),
  };

  return {
    query,
    ...(queryVariants ? { queryVariants } : {}),
    order,
    ...(after !== undefined ? { after } : {}),
    limit,
    includeTotal,
    relation,
  };
}
