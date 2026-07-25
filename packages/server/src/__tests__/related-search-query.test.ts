import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import {
  buildSearchQuery,
  buildSubstringSearchQuery,
} from '../lib/query-engine.js';
import type {
  SearchRelatedAncestry,
  SearchRelatedGrantSource,
  SearchRelatedOrder,
  SearchRelatedRelation,
} from '../lib/related-search-constraint.js';

function directRelation(): SearchRelatedRelation {
  return {
    localField: 'pageId',
    table: 'pages',
    whereAll: [
      ['workspaceId', '==', 'ws-1'],
      ['notionImportStaging', 'is-not-true'],
      ['inTrash', 'is-not-true'],
    ],
    ancestry: {
      parentField: 'parentId',
      parentTypeField: 'parentType',
      stopParentType: 'workspace',
      maxDepth: 3,
      whereAll: [['workspaceId', '==', 'ws-1']],
      grantSource: {
        table: 'page_permissions',
        ancestorField: 'pageId',
        whereAll: [
          ['workspaceId', '==', 'ws-1'],
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
            whereAll: [['principalType', '==', 'group']],
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
}

function createSqliteFixture(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE pages (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL,
      parentId TEXT,
      parentType TEXT,
      notionImportStaging INTEGER,
      inTrash INTEGER
    );
    CREATE TABLE blocks (
      id TEXT PRIMARY KEY,
      pageId TEXT NOT NULL,
      plainText TEXT
    );
    CREATE TABLE page_permissions (
      id TEXT PRIMARY KEY,
      pageId TEXT NOT NULL,
      workspaceId TEXT NOT NULL,
      principalType TEXT NOT NULL,
      principalId TEXT NOT NULL,
      role TEXT NOT NULL
    );
    CREATE TABLE organization_group_members (
      id TEXT PRIMARY KEY,
      groupId TEXT NOT NULL,
      organizationMemberId TEXT NOT NULL,
      userId TEXT NOT NULL
    );
  `);
  const insertPage = db.prepare(
    'INSERT INTO pages (id, workspaceId, parentId, parentType, notionImportStaging, inTrash) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertBlock = db.prepare(
    'INSERT INTO blocks (id, pageId, plainText) VALUES (?, ?, ?)',
  );
  const insertPermission = db.prepare(
    'INSERT INTO page_permissions (id, pageId, workspaceId, principalType, principalId, role) VALUES (?, ?, ?, ?, ?, ?)',
  );

  // A trashed grant root may still authorize its visible descendant.
  insertPage.run('shared-root', 'ws-1', null, 'workspace', 0, 1);
  insertPage.run('shared-child', 'ws-1', 'shared-root', 'page', 0, 0);
  insertPermission.run('grant-user', 'shared-root', 'ws-1', 'user', 'actor-1', 'view');
  insertBlock.run('allowed-user', 'shared-child', 'needle user');

  insertPage.run('group-root', 'ws-1', null, 'workspace', 0, 0);
  insertPage.run('group-child', 'ws-1', 'group-root', 'page', 0, 0);
  insertPermission.run('grant-group', 'group-root', 'ws-1', 'group', 'group-1', 'comment');
  db.prepare(
    'INSERT INTO organization_group_members (id, groupId, organizationMemberId, userId) VALUES (?, ?, ?, ?)',
  ).run('membership-1', 'group-1', 'member-1', 'actor-1');
  insertBlock.run('allowed-group', 'group-child', 'needle group');

  insertPage.run('private-page', 'ws-1', null, 'workspace', 0, 0);
  insertBlock.run('denied-private', 'private-page', 'needle private');

  // A resolvable foreign parent invalidates the chain even with a target grant.
  insertPage.run('foreign-parent', 'ws-2', null, 'workspace', 0, 0);
  insertPage.run('foreign-child', 'ws-1', 'foreign-parent', 'page', 0, 0);
  insertPermission.run('grant-foreign', 'foreign-child', 'ws-1', 'user', 'actor-1', 'view');
  insertBlock.run('denied-foreign', 'foreign-child', 'needle foreign');

  // A cycle is invalid even if the target itself has a grant.
  insertPage.run('cycle-a', 'ws-1', 'cycle-b', 'page', 0, 0);
  insertPage.run('cycle-b', 'ws-1', 'cycle-a', 'page', 0, 0);
  insertPermission.run('grant-cycle', 'cycle-a', 'ws-1', 'user', 'actor-1', 'view');
  insertBlock.run('denied-cycle', 'cycle-a', 'needle cycle');

  // An unresolved parent terminates normally; the direct target grant remains valid.
  insertPage.run('dangling', 'ws-1', 'missing-parent', 'page', 0, 0);
  insertPermission.run('grant-dangling', 'dangling', 'ws-1', 'user', 'actor-1', 'view');
  insertBlock.run('allowed-dangling', 'dangling', 'needle dangling');

  return db;
}

describe('related search query compilation', () => {
  it('applies target, full-chain, and co-located grant authority before SQLite LIMIT/count', () => {
    const db = createSqliteFixture();
    const query = buildSubstringSearchQuery('blocks', 'needle', {
      fields: ['plainText'],
      pagination: { limit: 100 },
      sort: [{ field: 'id', direction: 'asc' }],
      relatedSearch: directRelation(),
    });

    const rows = db.prepare(query.sql).all(
      ...query.params as SQLInputValue[],
    ) as Array<{ id: string }>;
    const count = db.prepare(query.countSql!).get(
      ...query.countParams! as SQLInputValue[],
    ) as { total: number };

    expect(rows.map(({ id }) => id)).toEqual([
      'allowed-dangling',
      'allowed-group',
      'allowed-user',
    ]);
    expect(count.total).toBe(3);
    expect(query.sql.indexOf('EXISTS (')).toBeLessThan(query.sql.indexOf('ORDER BY'));
    expect(query.sql.indexOf('ORDER BY')).toBeLessThan(query.sql.indexOf('LIMIT'));
  });

  it('conjoins bounded required ancestor ids with grant authority before SQLite LIMIT/count', () => {
    const db = createSqliteFixture();
    const relation = directRelation();
    (relation.ancestry as SearchRelatedAncestry & {
      requiredAncestorIds: string[];
    }).requiredAncestorIds = ['shared-root'];
    const query = buildSubstringSearchQuery('blocks', 'needle', {
      fields: ['plainText'],
      pagination: { limit: 100 },
      sort: [{ field: 'id', direction: 'asc' }],
      relatedSearch: relation,
    });

    const rows = db.prepare(query.sql).all(
      ...query.params as SQLInputValue[],
    ) as Array<{ id: string }>;
    const count = db.prepare(query.countSql!).get(
      ...query.countParams! as SQLInputValue[],
    ) as { total: number };

    expect(rows.map(({ id }) => id)).toEqual(['allowed-user']);
    expect(count.total).toBe(1);
    expect(query.sql).not.toContain('shared-root');
    expect(query.sql.indexOf('WITH RECURSIVE')).toBeLessThan(query.sql.indexOf('ORDER BY'));
    db.close();
  });

  it('uses bounded required ancestor ids as the only ancestry authority on both providers', () => {
    const relation = directRelation();
    const ancestry = relation.ancestry as SearchRelatedAncestry & {
      requiredAncestorIds: string[];
      grantSource?: SearchRelatedGrantSource;
    };
    ancestry.requiredAncestorIds = ['shared-root', 'group-root'];
    delete ancestry.grantSource;

    const sqlite = buildSubstringSearchQuery('blocks', 'needle', {
      fields: ['plainText'],
      pagination: { limit: 100 },
      sort: [{ field: 'id', direction: 'asc' }],
      relatedSearch: relation,
    });
    const db = createSqliteFixture();
    const rows = db.prepare(sqlite.sql).all(
      ...sqlite.params as SQLInputValue[],
    ) as Array<{ id: string }>;
    expect(rows.map(({ id }) => id)).toEqual(['allowed-group', 'allowed-user']);

    const postgres = buildSubstringSearchQuery('blocks', 'needle', {
      fields: ['plainText'],
      pagination: { limit: 100 },
      sort: [{ field: 'id', direction: 'asc' }],
      relatedSearch: relation,
    }, 'postgres');
    expect(postgres.sql).toContain('= ANY(');
    expect(postgres.sql).not.toContain('"page_permissions"');
    expect(postgres.sql).not.toContain('shared-root');
    db.close();
  });

  it('advances within the same first key and then across the next key in one variant union', () => {
    const db = createSqliteFixture();
    db.prepare('INSERT INTO blocks (id, pageId, plainText) VALUES (?, ?, ?)')
      .run('allowed-variant', 'shared-child', 'alternate form');
    const order: SearchRelatedOrder = [
      { field: 'pageId', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ];

    const afterNextKey = buildSubstringSearchQuery('blocks', 'needle', {
      queryVariants: ['alternate'],
      fields: ['plainText'],
      pagination: { limit: 10 },
      sort: order,
      searchRelatedKeyset: {
        order,
        after: { values: ['group-child', 'allowed-group'] },
      },
      relatedSearch: directRelation(),
    });
    const nextKeyRows = db.prepare(afterNextKey.sql).all(
      ...afterNextKey.params as SQLInputValue[],
    ) as Array<{ id: string; pageId: string }>;
    expect(nextKeyRows.map(({ pageId, id }) => [pageId, id])).toEqual([
      ['shared-child', 'allowed-user'],
      ['shared-child', 'allowed-variant'],
    ]);

    const afterSameKey = buildSubstringSearchQuery('blocks', 'needle', {
      queryVariants: ['alternate'],
      fields: ['plainText'],
      pagination: { limit: 10 },
      sort: order,
      searchRelatedKeyset: {
        order,
        after: { values: ['shared-child', 'allowed-user'] },
      },
      relatedSearch: directRelation(),
    });
    const sameKeyRows = db.prepare(afterSameKey.sql).all(
      ...afterSameKey.params as SQLInputValue[],
    ) as Array<{ id: string; pageId: string }>;
    expect(sameKeyRows.map(({ pageId, id }) => [pageId, id])).toEqual([
      ['shared-child', 'allowed-variant'],
    ]);
    expect(afterSameKey.countParams).not.toEqual(expect.arrayContaining([
      'shared-child',
      'allowed-user',
    ]));
    db.close();
  });

  it('binds variant OR terms and composite keysets in configured FTS for both providers', () => {
    const order: SearchRelatedOrder = [
      { field: 'pageId', direction: 'asc' },
      { field: 'id', direction: 'asc' },
    ];
    const options = {
      queryVariants: ['alternate'],
      ftsFields: ['plainText'],
      pagination: { limit: 3 },
      sort: order,
      searchRelatedKeyset: {
        order,
        after: { values: ['page-1', 'block-1'] },
      },
    };

    const sqlite = buildSearchQuery('blocks', 'needle', options, 'sqlite');
    expect(sqlite.sql.match(/"blocks_fts" MATCH \?/g)).toHaveLength(1);
    expect(sqlite.sql).toContain(
      '("blocks"."pageId" > ? OR ("blocks"."pageId" = ? AND "blocks"."id" > ?))',
    );
    expect(sqlite.params).toEqual([
      '("needle"*) OR ("alternate"*)',
      'page-1',
      'page-1',
      'block-1',
      3,
    ]);
    expect(sqlite.countParams).toEqual(['("needle"*) OR ("alternate"*)']);

    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE blocks (id TEXT PRIMARY KEY, pageId TEXT NOT NULL, plainText TEXT);
      CREATE VIRTUAL TABLE blocks_fts USING fts5(
        plainText,
        content='blocks',
        content_rowid='rowid'
      );
      INSERT INTO blocks (id, pageId, plainText) VALUES
        ('block-1', 'page-1', 'needle first'),
        ('block-2', 'page-1', 'alternate second'),
        ('next-1', 'page-2', 'needle next');
      INSERT INTO blocks_fts(blocks_fts) VALUES ('rebuild');
    `);
    const sqliteRows = db.prepare(sqlite.sql).all(
      ...sqlite.params as SQLInputValue[],
    ) as Array<{ id: string; pageId: string }>;
    expect(sqliteRows.map(({ pageId, id }) => [pageId, id])).toEqual([
      ['page-1', 'block-2'],
      ['page-2', 'next-1'],
    ]);
    db.close();

    const postgres = buildSearchQuery('blocks', 'needle', options, 'postgres');
    expect(postgres.sql).toContain('"_fts_text" ILIKE');
    expect(postgres.sql).toContain(
      '("blocks"."pageId" > $3 OR ("blocks"."pageId" = $4 AND "blocks"."id" > $5))',
    );
    expect(postgres.params).toEqual([
      'needle',
      'alternate',
      'page-1',
      'page-1',
      'block-1',
      3,
    ]);
    expect(postgres.countParams).toEqual(['needle', 'alternate']);
  });

  it('emits bound PostgreSQL recursion/path checks for SELECT and COUNT', () => {
    const relation = directRelation();
    const query = buildSubstringSearchQuery('blocks', 'needle', {
      fields: ['plainText'],
      pagination: { after: 'block-010', limit: 25 },
      sort: [{ field: 'id', direction: 'asc' }],
      relatedSearch: relation,
    }, 'postgres');

    expect(query.sql).toContain('WITH RECURSIVE');
    expect(query.sql).toContain(' = ANY(');
    expect(query.sql).toContain('IS NOT TRUE');
    expect(query.sql).toContain('"organization_group_members"');
    expect(query.sql).toMatch(/ORDER BY "id" ASC LIMIT \$\d+$/);
    expect(query.countSql).toContain('WITH RECURSIVE');
    expect(query.params).toEqual(expect.arrayContaining([
      'needle',
      'block-010',
      'ws-1',
      'workspace',
      3,
      'actor-1',
      'member-1',
      25,
    ]));
    expect(query.countParams).not.toContain('block-010');
    expect(query.countParams).not.toContain(25);
  });

  it('preserves the one-row overflow probe at the maximum related-search limit', () => {
    const order: SearchRelatedOrder = [{ field: 'id', direction: 'asc' }];
    const related = buildSubstringSearchQuery('blocks', 'needle', {
      fields: ['plainText'],
      pagination: { limit: 1_001 },
      sort: order,
      searchRelatedKeyset: { order },
    });
    const ordinary = buildSubstringSearchQuery('blocks', 'needle', {
      fields: ['plainText'],
      pagination: { limit: 1_001 },
      sort: order,
    });

    expect(related.params.at(-1)).toBe(1_001);
    expect(ordinary.params.slice(-2)).toEqual([1_000, 0]);
  });
});
