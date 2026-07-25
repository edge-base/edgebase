import { describe, expect, it } from 'vitest';
import { EdgeBaseError } from '@edge-base/shared';
import type { TableConfig } from '@edge-base/shared';
import {
  MAX_RELATED_SEARCH_AFTER_LENGTH,
  MAX_RELATED_SEARCH_DEPTH,
  MAX_RELATED_SEARCH_IN_VALUES,
  MAX_RELATED_SEARCH_LIMIT,
  MAX_RELATED_SEARCH_PAYLOAD_BYTES,
  MAX_RELATED_SEARCH_PRINCIPAL_BRANCHES,
  MAX_RELATED_SEARCH_QUERY_LENGTH,
  MAX_RELATED_SEARCH_QUERY_VARIANTS,
  MAX_RELATED_SEARCH_REQUIRED_ANCESTOR_IDS,
  MAX_RELATED_SEARCH_WHERE_CLAUSES,
  createSearchRelatedCursor,
  validateSearchRelatedInput,
} from '../lib/related-search-constraint.js';

const tables: Record<string, TableConfig> = {
  pages: {
    schema: {
      workspaceId: { type: 'string', required: true },
      parentId: { type: 'string' },
      parentType: { type: 'string' },
      notionImportStaging: { type: 'boolean' },
      inTrash: { type: 'boolean' },
      title: { type: 'text' },
      _fts_shadow: { type: 'string' },
    },
    fts: ['title'],
  },
  blocks: {
    schema: {
      pageId: { type: 'string', references: 'pages' },
      plainText: { type: 'text' },
    },
    fts: ['plainText'],
  },
  page_permissions: {
    schema: {
      pageId: { type: 'string', references: { table: 'pages' } },
      workspaceId: { type: 'string' },
      principalType: { type: 'string' },
      principalId: { type: 'string' },
      role: { type: 'string' },
    },
  },
  organization_groups: {
    schema: {
      name: { type: 'string' },
    },
  },
  organization_group_members: {
    schema: {
      groupId: { type: 'string', references: 'organization_groups' },
      organizationMemberId: { type: 'string' },
      userId: { type: 'string' },
      active: { type: 'boolean' },
    },
  },
};

function fullAccessInput(): Record<string, unknown> {
  return {
    query: 'needle',
    order: [{ field: 'id', direction: 'asc' }],
    after: { values: ['block-010'] },
    limit: 25,
    includeTotal: true,
    relation: {
      localField: 'pageId',
      table: 'pages',
      whereAll: [
        ['workspaceId', '==', 'workspace-1'],
        ['notionImportStaging', 'is-not-true'],
        ['inTrash', 'is-not-true'],
      ],
    },
  };
}

function directAccessInput(): Record<string, unknown> {
  const input = fullAccessInput();
  input.relation = {
    ...(input.relation as Record<string, unknown>),
    ancestry: {
      parentField: 'parentId',
      parentTypeField: 'parentType',
      stopParentType: 'workspace',
      maxDepth: 256,
      whereAll: [['workspaceId', '==', 'workspace-1']],
      grantSource: {
        table: 'page_permissions',
        ancestorField: 'pageId',
        whereAll: [
          ['workspaceId', '==', 'workspace-1'],
          ['role', 'in', ['view', 'comment', 'edit', 'full_access']],
        ],
        principalAny: [
          {
            whereAll: [
              ['principalType', 'in', ['user', 'integration']],
              ['principalId', '==', 'actor-1'],
            ],
          },
          {
            whereAll: [['principalType', '==', 'email']],
            groupMembership: {
              table: 'organization_group_members',
              grantPrincipalField: 'principalId',
              membershipGroupField: 'groupId',
              whereAll: [
                ['organizationMemberId', '==', 'member-1'],
                ['userId', '==', 'actor-1'],
              ],
            },
          },
        ],
      },
    },
  };
  return input;
}

function relation(input: Record<string, unknown>): Record<string, unknown> {
  return input.relation as Record<string, unknown>;
}

function ancestry(input: Record<string, unknown>): Record<string, unknown> {
  return relation(input).ancestry as Record<string, unknown>;
}

function grant(input: Record<string, unknown>): Record<string, unknown> {
  return ancestry(input).grantSource as Record<string, unknown>;
}

function expectInvalid(
  input: unknown,
  sourceTable: string,
  expected: RegExp,
  currentTables: Record<string, TableConfig> = tables,
): void {
  let caught: unknown;
  try {
    validateSearchRelatedInput(input, sourceTable, currentTables);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EdgeBaseError);
  expect(caught).toMatchObject({ code: 400, slug: 'invalid-related-search' });
  expect((caught as Error).message).toMatch(expected);
}

describe('validateSearchRelatedInput', () => {
  it('creates a structured cursor aligned to the validated order', () => {
    expect(createSearchRelatedCursor(
      { pageId: 'page-1', id: 'block-2' },
      [
        { field: 'pageId', direction: 'asc' },
        { field: 'id', direction: 'asc' },
      ],
    )).toEqual({ values: ['page-1', 'block-2'] });
  });

  it('accepts and clones the bounded full-workspace relation contract', () => {
    const input = fullAccessInput();
    const result = validateSearchRelatedInput(input, 'blocks', tables);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.order).not.toBe(input.order);
    expect(result.relation).not.toBe(input.relation);
  });

  it('accepts direct user, integration, role-list, and co-located group authority', () => {
    const input = directAccessInput();
    const result = validateSearchRelatedInput(input, 'blocks', tables);

    expect(result.relation.ancestry).toEqual(ancestry(input));
    expect(result.relation.ancestry?.grantSource?.principalAny).toHaveLength(2);
    expect(
      result.relation.ancestry?.grantSource?.principalAny[1]?.groupMembership?.table,
    ).toBe('organization_group_members');
  });

  it('accepts bounded required ancestor ids alone and conjunctively with grant authority', () => {
    const onlyRequired = directAccessInput();
    ancestry(onlyRequired).requiredAncestorIds = ['root-a', 'database-b'];
    delete ancestry(onlyRequired).grantSource;

    const requiredResult = validateSearchRelatedInput(onlyRequired, 'blocks', tables);
    expect(requiredResult.relation.ancestry).toEqual(ancestry(onlyRequired));
    expect(requiredResult.relation.ancestry?.requiredAncestorIds).toEqual([
      'root-a',
      'database-b',
    ]);
    expect(requiredResult.relation.ancestry?.grantSource).toBeUndefined();

    const conjunctive = directAccessInput();
    ancestry(conjunctive).requiredAncestorIds = ['root-a'];
    const conjunctiveResult = validateSearchRelatedInput(conjunctive, 'blocks', tables);
    expect(conjunctiveResult.relation.ancestry?.requiredAncestorIds).toEqual(['root-a']);
    expect(conjunctiveResult.relation.ancestry?.grantSource).toBeDefined();
  });

  it('rejects empty, duplicate, malformed, and oversized required ancestor ids', () => {
    const invalidValues: Array<[unknown, RegExp]> = [
      [[], /requiredAncestorIds.*1 through 1,000/],
      [['root-a', 'root-a'], /requiredAncestorIds.*duplicate/],
      [[''], /requiredAncestorIds\[0\].*blank/],
      [[{ id: 'root-a' }], /requiredAncestorIds\[0\].*string/],
      [
        Array.from(
          { length: MAX_RELATED_SEARCH_REQUIRED_ANCESTOR_IDS + 1 },
          (_, index) => `root-${index}`,
        ),
        /requiredAncestorIds.*1 through 1,000/,
      ],
    ];
    for (const [requiredAncestorIds, expected] of invalidValues) {
      const input = directAccessInput();
      ancestry(input).requiredAncestorIds = requiredAncestorIds;
      expectInvalid(input, 'blocks', expected);
    }

    const missingAuthority = directAccessInput();
    delete ancestry(missingAuthority).grantSource;
    expectInvalid(missingAuthority, 'blocks', /ancestry.*authority/);
  });

  it('accepts a two-field ascending text keyset ending in id', () => {
    const input = fullAccessInput();
    input.order = [
      { field: 'pageId', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ];
    input.after = { values: ['page-010', 'block-010'] };

    const result = validateSearchRelatedInput(input, 'blocks', tables);

    expect(result.order).toEqual(input.order);
    expect(result.after).toEqual({ values: ['page-010', 'block-010'] });
  });

  it('deduplicates one alternate query while bounding all query forms', () => {
    const input = fullAccessInput();
    input.queryVariants = ['needle', 'needle-normalized'];

    const result = validateSearchRelatedInput(input, 'blocks', tables);
    expect(result.queryVariants).toEqual(['needle-normalized']);

    const tooMany = fullAccessInput();
    tooMany.queryVariants = Array.from(
      { length: MAX_RELATED_SEARCH_QUERY_VARIANTS + 1 },
      (_, index) => `variant-${index}`,
    );
    expectInvalid(tooMany, 'blocks', /queryVariants.*must not contain more than/);

    const tooManyDistinct = fullAccessInput();
    tooManyDistinct.queryVariants = ['variant-a', 'variant-b'];
    expectInvalid(tooManyDistinct, 'blocks', /queryVariants.*at most 2 distinct values/);

    const blankVariant = fullAccessInput();
    blankVariant.queryVariants = ['   '];
    expectInvalid(blankVariant, 'blocks', /queryVariants\[0\].*must not be blank/);

    const longVariant = fullAccessInput();
    longVariant.queryVariants = ['x'.repeat(MAX_RELATED_SEARCH_QUERY_LENGTH + 1)];
    expectInvalid(longVariant, 'blocks', /queryVariants\[0\].*must not exceed/);

    const wrongVariantShape = fullAccessInput();
    wrongVariantShape.queryVariants = 'alternate';
    expectInvalid(wrongVariantShape, 'blocks', /queryVariants.*expected an array/);
  });

  it('allows page title search to use the related table id as its self relation', () => {
    const input = fullAccessInput();
    relation(input).localField = 'id';
    delete input.after;

    const result = validateSearchRelatedInput(input, 'pages', tables);

    expect(result.relation.localField).toBe('id');
    expect(result.after).toBeUndefined();
  });

  it('rejects non-objects, unknown fields, oversized JSON, and authority ID-array fields', () => {
    expectInvalid(null, 'blocks', /expected a JSON object|expected an object/);

    const unknownRoot = fullAccessInput();
    unknownRoot.rootIds = ['page-1'];
    expectInvalid(unknownRoot, 'blocks', /rootIds.*unknown field/);

    const unknownBranch = directAccessInput();
    (grant(unknownBranch).principalAny as Array<Record<string, unknown>>)[0]!.activeGroupIds = [
      'group-1',
    ];
    expectInvalid(unknownBranch, 'blocks', /activeGroupIds.*unknown field/);

    const oversized = fullAccessInput();
    oversized.query = '한'.repeat(Math.ceil(MAX_RELATED_SEARCH_PAYLOAD_BYTES / 3) + 1);
    expectInvalid(oversized, 'blocks', /UTF-8 bytes/);

    const identityIn = directAccessInput();
    (grant(identityIn).principalAny as Array<Record<string, unknown>>)[0]!.whereAll = [
      ['principalId', 'in', ['actor-1', 'actor-2']],
    ];
    expectInvalid(identityIn, 'blocks', /identity\/reference fields/);
  });

  it('enforces bounded query, cursor, limit, order, and response metadata', () => {
    const blankQuery = fullAccessInput();
    blankQuery.query = '   ';
    expectInvalid(blankQuery, 'blocks', /query.*must not be blank/);

    const longQuery = fullAccessInput();
    longQuery.query = 'x'.repeat(MAX_RELATED_SEARCH_QUERY_LENGTH + 1);
    expectInvalid(longQuery, 'blocks', /query.*must not exceed/);

    for (const invalidLimit of [0, MAX_RELATED_SEARCH_LIMIT + 1, 1.5]) {
      const input = fullAccessInput();
      input.limit = invalidLimit;
      expectInvalid(input, 'blocks', /limit.*expected an integer/);
    }

    const blankAfter = fullAccessInput();
    blankAfter.after = { values: [' '] };
    expectInvalid(blankAfter, 'blocks', /after\.values\[0\].*must not be blank/);

    const longAfter = fullAccessInput();
    longAfter.after = { values: ['x'.repeat(MAX_RELATED_SEARCH_AFTER_LENGTH + 1)] };
    expectInvalid(longAfter, 'blocks', /after.*must not exceed/);

    const stringAfter = fullAccessInput();
    stringAfter.after = 'block-010';
    expectInvalid(stringAfter, 'blocks', /after.*expected an object/);

    const extraAfterField = fullAccessInput();
    extraAfterField.after = { values: ['block-010'], injected: true };
    expectInvalid(extraAfterField, 'blocks', /after\.injected.*unknown field/);

    const mismatchedAfter = fullAccessInput();
    mismatchedAfter.after = { values: ['page-010', 'block-010'] };
    expectInvalid(mismatchedAfter, 'blocks', /after\.values.*exactly 1 values/);

    const wrongOrder = fullAccessInput();
    wrongOrder.order = [{ field: 'plainText', direction: 'asc' }];
    expectInvalid(wrongOrder, 'blocks', /order\[0\]\.field.*must be 'id'/);

    const multipleOrder = fullAccessInput();
    multipleOrder.order = [
      { field: 'id', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ];
    expectInvalid(multipleOrder, 'blocks', /order\[0\]\.field.*distinct from the final id/);

    const descendingOrder = fullAccessInput();
    descendingOrder.order = [{ field: 'id', direction: 'desc' }];
    expectInvalid(descendingOrder, 'blocks', /order\[0\]\.direction.*must be 'asc'/);

    const injectedOrder = fullAccessInput();
    injectedOrder.order = [
      { field: 'pageId" > ? --', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ];
    expectInvalid(injectedOrder, 'blocks', /order\[0\]\.field.*not in table 'blocks'/);

    const invalidTotal = fullAccessInput();
    invalidTotal.includeTotal = 'true';
    expectInvalid(invalidTotal, 'blocks', /includeTotal.*expected a boolean/);
  });

  it('requires exact current-database tables, effective fields, and provider-safe fields', () => {
    expectInvalid(fullAccessInput(), 'missing', /sourceTable.*not in the current database/);

    const unknownRelationTable = fullAccessInput();
    relation(unknownRelationTable).table = 'foreign_pages';
    expectInvalid(unknownRelationTable, 'blocks', /foreign_pages.*not in the current database/);

    const unknownField = fullAccessInput();
    relation(unknownField).whereAll = [['missing', '==', 'value']];
    expectInvalid(unknownField, 'blocks', /field 'missing'.*not in table 'pages'/);

    const ftsField = fullAccessInput();
    relation(ftsField).whereAll = [['_fts_shadow', '==', 'value']];
    expectInvalid(ftsField, 'blocks', /provider-managed FTS fields/);

    const disabledIdTables: Record<string, TableConfig> = {
      ...tables,
      blocks: {
        ...tables.blocks,
        schema: {
          ...tables.blocks!.schema,
          id: false,
        },
      },
    };
    expectInvalid(fullAccessInput(), 'blocks', /field 'id'.*not in table 'blocks'/, disabledIdTables);
  });

  it('requires an id reference for cross-table source and grant joins', () => {
    const unreferencedSourceTables: Record<string, TableConfig> = {
      ...tables,
      blocks: {
        ...tables.blocks,
        schema: {
          ...tables.blocks!.schema,
          pageId: { type: 'string' },
        },
      },
    };
    expectInvalid(
      fullAccessInput(),
      'blocks',
      /localField.*must reference 'pages\.id'/,
      unreferencedSourceTables,
    );

    const wrongSourceTables: Record<string, TableConfig> = {
      ...tables,
      blocks: {
        ...tables.blocks,
        schema: {
          ...tables.blocks!.schema,
          pageId: { type: 'string', references: 'organization_groups' },
        },
      },
    };
    expectInvalid(
      fullAccessInput(),
      'blocks',
      /localField.*must reference 'pages\.id'/,
      wrongSourceTables,
    );

    const wrongGrantTables: Record<string, TableConfig> = {
      ...tables,
      page_permissions: {
        ...tables.page_permissions,
        schema: {
          ...tables.page_permissions!.schema,
          pageId: { type: 'string', references: 'organization_groups' },
        },
      },
    };
    expectInvalid(
      directAccessInput(),
      'blocks',
      /ancestorField.*must reference 'pages\.id'/,
      wrongGrantTables,
    );

    const wrongSelfRelation = fullAccessInput();
    relation(wrongSelfRelation).localField = 'workspaceId';
    expectInvalid(wrongSelfRelation, 'pages', /self relation must use the source id/);
  });

  it('validates ancestry fields, join types, and bounded authority complexity', () => {
    const wrongParentType = directAccessInput();
    ancestry(wrongParentType).parentTypeField = 'parentId';
    expectInvalid(wrongParentType, 'blocks', /parentTypeField.*must be distinct/);

    const wrongParentReferenceTables: Record<string, TableConfig> = {
      ...tables,
      pages: {
        ...tables.pages,
        schema: {
          ...tables.pages!.schema,
          parentId: { type: 'string', references: 'organization_groups' },
        },
      },
    };
    expectInvalid(
      directAccessInput(),
      'blocks',
      /parentField.*declared parent reference must target 'pages\.id'/,
      wrongParentReferenceTables,
    );

    const deep = directAccessInput();
    ancestry(deep).maxDepth = MAX_RELATED_SEARCH_DEPTH + 1;
    expectInvalid(deep, 'blocks', /maxDepth.*expected an integer/);

    const manyBranches = directAccessInput();
    grant(manyBranches).principalAny = Array.from(
      { length: MAX_RELATED_SEARCH_PRINCIPAL_BRANCHES + 1 },
      () => ({ whereAll: [['principalType', '==', 'user']] }),
    );
    expectInvalid(manyBranches, 'blocks', /principalAny.*expected 1 through/);

    const manyPredicates = fullAccessInput();
    relation(manyPredicates).whereAll = Array.from(
      { length: MAX_RELATED_SEARCH_WHERE_CLAUSES + 1 },
      () => ['workspaceId', '==', 'workspace-1'],
    );
    expectInvalid(manyPredicates, 'blocks', /more than .* predicates/);

    const unreferencedMembershipTables: Record<string, TableConfig> = {
      ...tables,
      organization_group_members: {
        ...tables.organization_group_members,
        schema: {
          ...tables.organization_group_members!.schema,
          groupId: { type: 'string' },
        },
      },
    };
    expectInvalid(
      directAccessInput(),
      'blocks',
      /membershipGroupField.*must be an id reference/,
      unreferencedMembershipTables,
    );
  });

  it('validates predicate operators, arity, scalar field types, and IN bounds', () => {
    const invalidOperator = fullAccessInput();
    relation(invalidOperator).whereAll = [['workspaceId', 'contains', 'workspace']];
    expectInvalid(invalidOperator, 'blocks', /expected '==', 'in', or 'is-not-true'/);

    const wrongNotTrueField = fullAccessInput();
    relation(wrongNotTrueField).whereAll = [['workspaceId', 'is-not-true']];
    expectInvalid(wrongNotTrueField, 'blocks', /requires a boolean field/);

    const notTrueValue = fullAccessInput();
    relation(notTrueValue).whereAll = [['inTrash', 'is-not-true', false]];
    expectInvalid(notTrueValue, 'blocks', /does not accept a value/);

    const nestedValue = fullAccessInput();
    relation(nestedValue).whereAll = [['workspaceId', '==', { id: 'workspace-1' }]];
    expectInvalid(nestedValue, 'blocks', /non-null scalar value/);

    const emptyIn = directAccessInput();
    grant(emptyIn).whereAll = [['role', 'in', []]];
    expectInvalid(emptyIn, 'blocks', /requires a non-empty array/);

    const largeIn = directAccessInput();
    grant(largeIn).whereAll = [[
      'role',
      'in',
      Array.from({ length: MAX_RELATED_SEARCH_IN_VALUES + 1 }, (_, index) => `role-${index}`),
    ]];
    expectInvalid(largeIn, 'blocks', /must not contain more than .* values/);
  });

  it('requires scoped predicates and a non-empty principal decision tree', () => {
    const noTargetScope = fullAccessInput();
    relation(noTargetScope).whereAll = [];
    expectInvalid(noTargetScope, 'blocks', /whereAll.*at least one predicate/);

    const noAncestryScope = directAccessInput();
    ancestry(noAncestryScope).whereAll = [];
    expectInvalid(noAncestryScope, 'blocks', /ancestry\.whereAll.*at least one predicate/);

    const noGrantScope = directAccessInput();
    grant(noGrantScope).whereAll = [];
    expectInvalid(noGrantScope, 'blocks', /grantSource\.whereAll.*at least one predicate/);

    const noPrincipals = directAccessInput();
    grant(noPrincipals).principalAny = [];
    expectInvalid(noPrincipals, 'blocks', /principalAny.*expected 1 through/);

    const noBranchPredicate = directAccessInput();
    (grant(noBranchPredicate).principalAny as Array<Record<string, unknown>>)[0]!.whereAll = [];
    expectInvalid(noBranchPredicate, 'blocks', /principalAny\[0\]\.whereAll.*at least one/);

    const noMembershipPredicate = directAccessInput();
    const branch = (grant(noMembershipPredicate).principalAny as Array<Record<string, unknown>>)[1]!;
    (branch.groupMembership as Record<string, unknown>).whereAll = [];
    expectInvalid(noMembershipPredicate, 'blocks', /groupMembership\.whereAll.*at least one/);
  });
});
