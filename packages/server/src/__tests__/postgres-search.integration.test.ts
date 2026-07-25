import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TableConfig } from '@edge-base/shared';
import { buildSearchQuery } from '../lib/query-engine.js';
import type { SearchRelatedRelation } from '../lib/related-search-constraint.js';
import { ensurePgSchema, _resetPgSchemaCache } from '../lib/postgres-schema-init.js';

const postgresUrl = process.env.EDGEBASE_TEST_POSTGRES_URL;
const describePostgres = postgresUrl ? describe : describe.skip;

describePostgres('PostgreSQL indexed substring search', () => {
  const schema = `search_review_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const tableName = 'plugin-a/events';
  const table: TableConfig = {
    schema: {
      pageId: { type: 'string', references: 'pages' },
      plainText: { type: 'string' },
      content: { type: 'json' },
    },
    fts: ['plainText', 'content'],
  };
  const pages: TableConfig = {
    schema: {
      workspaceId: { type: 'string', required: true },
      notionImportStaging: { type: 'boolean' },
      inTrash: { type: 'boolean' },
    },
  };
  const relation: SearchRelatedRelation = {
    localField: 'pageId',
    table: 'pages',
    whereAll: [
      ['workspaceId', '==', 'workspace-1'],
      ['notionImportStaging', 'is-not-true'],
      ['inTrash', 'is-not-true'],
    ],
  };
  let adminClient: Client;
  let scopedClient: Client;
  let scopedUrl: string;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: postgresUrl! });
    await adminClient.connect();
    await adminClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
    await adminClient.query(`CREATE SCHEMA "${schema}"`);

    const url = new URL(postgresUrl!);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    scopedUrl = url.toString();
    scopedClient = new Client({ connectionString: scopedUrl });
    await scopedClient.connect();
  }, 30_000);

  afterAll(async () => {
    if (scopedClient) await scopedClient.end();
    if (adminClient) {
      await adminClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminClient.end();
    }
  });

  it('repairs a dropped trigram index and produces an index-eligible EXPLAIN plan', async () => {
    _resetPgSchemaCache();
    await ensurePgSchema(scopedUrl, `search-integration-${schema}`, { pages, [tableName]: table });

    await scopedClient.query(`
      INSERT INTO "pages" ("id", "workspaceId", "notionImportStaging", "inTrash")
      SELECT
        'filler-page-' || value,
        'workspace-1',
        false,
        false
      FROM generate_series(1, 5000) AS value
    `);
    await scopedClient.query(`
      INSERT INTO "plugin-a/events" ("id", "pageId", "plainText", "content")
      SELECT
        'filler-' || value,
        'filler-page-' || value,
        'ordinary filler',
        jsonb_build_object('text', 'ordinary filler')
      FROM generate_series(1, 5000) AS value
    `);
    await scopedClient.query(
      'INSERT INTO "pages" ("id", "workspaceId", "notionImportStaging", "inTrash") VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
      ['visible-page', 'workspace-1', false, false, 'foreign-page', 'workspace-2', false, false],
    );
    await scopedClient.query(
      'INSERT INTO "plugin-a/events" ("id", "pageId", "plainText", "content") VALUES ($1, $2, $3, $4::jsonb), ($5, $6, $7, $8::jsonb)',
      [
        'target',
        'visible-page',
        'header',
        JSON.stringify({ nested: { text: 'content needle' } }),
        'denied-target',
        'foreign-page',
        'header',
        JSON.stringify({ nested: { text: 'content needle' } }),
      ],
    );
    await scopedClient.query('DROP INDEX "idx_plugin-a/events_fts_text_trgm"');

    _resetPgSchemaCache();
    await ensurePgSchema(scopedUrl, `search-repair-${schema}`, { pages, [tableName]: table });

    const repairedIndex = await scopedClient.query(
      `SELECT 1
       FROM pg_catalog.pg_class AS idx
       JOIN pg_catalog.pg_index AS i ON i.indexrelid = idx.oid
       JOIN pg_catalog.pg_class AS target ON target.oid = i.indrelid
       JOIN pg_catalog.pg_namespace AS n ON n.oid = target.relnamespace
       WHERE target.relname = $1
         AND n.nspname = pg_catalog.current_schema()
         AND idx.relname = $2
         AND i.indisvalid
         AND i.indisready
       LIMIT 1`,
      [tableName, 'idx_plugin-a/events_fts_text_trgm'],
    );
    expect(repairedIndex.rowCount).toBe(1);

    const search = buildSearchQuery(tableName, 'needle', {
      ftsFields: table.fts,
      pagination: { limit: 10 },
      relatedSearch: relation,
    }, 'postgres');
    const result = await scopedClient.query(search.sql, search.params);
    expect(result.rows.map((row) => row.id)).toEqual(['target']);

    await scopedClient.query('ANALYZE "plugin-a/events"');
    await scopedClient.query('ANALYZE "pages"');
    await scopedClient.query('SET enable_seqscan = off');
    await scopedClient.query('SET enable_indexscan = off');
    const explained = await scopedClient.query(
      `EXPLAIN (FORMAT JSON) ${search.sql}`,
      search.params,
    );
    expect(JSON.stringify(explained.rows[0]?.['QUERY PLAN']))
      .toContain('idx_plugin-a/events_fts_text_trgm');

    await scopedClient.query(
      'UPDATE "plugin-a/events" SET "content" = $1::jsonb WHERE "id" = $2',
      [JSON.stringify({ text: 'updated marker' }), 'target'],
    );
    const updatedSearch = buildSearchQuery(tableName, 'marker', {
      ftsFields: table.fts,
      pagination: { limit: 10 },
      relatedSearch: relation,
    }, 'postgres');
    const updatedResult = await scopedClient.query(updatedSearch.sql, updatedSearch.params);
    expect(updatedResult.rows.map((row) => row.id)).toEqual(['target']);
  }, 30_000);
});
