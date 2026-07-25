import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { buildInternalHandlerContext } from '../lib/internal-request.js';
import { _resetPgSchemaCache } from '../lib/postgres-schema-init.js';
import { handlePgRequest } from '../lib/postgres-handler.js';
import type { Env } from '../types.js';

const postgresUrl = process.env.EDGEBASE_TEST_POSTGRES_URL;
const describePostgres = postgresUrl ? describe : describe.skip;
const NAMESPACE = 'form_parity';
const CONNECTION_KEY = 'DB_POSTGRES_FORM_PARITY_URL';

const CONFIG = defineConfig({
  release: true,
  databases: {
    [NAMESPACE]: {
      provider: 'postgres',
      connectionString: CONNECTION_KEY,
      tables: {
        form_links: {
          schema: {
            workspaceId: { type: 'string', required: true },
            databaseId: { type: 'string', required: true },
            viewId: { type: 'string', required: true },
            token: { type: 'string', required: true },
            audience: { type: 'string', required: true },
            enabled: { type: 'boolean', required: true },
          },
        },
        db_views: {
          schema: {
            databaseId: { type: 'string', required: true },
            type: { type: 'string', required: true },
          },
        },
        pages: {
          schema: {
            workspaceId: { type: 'string', required: true },
            parentId: { type: 'string' },
            parentType: { type: 'string', required: true },
            kind: { type: 'string', required: true },
            title: { type: 'string', required: true },
            properties: { type: 'json' },
            inTrash: { type: 'boolean', required: true, default: false },
            deletionPendingAt: { type: 'datetime' },
            isLocked: { type: 'boolean', required: true, default: false },
            lastEditedBy: { type: 'string' },
            lastMutationId: { type: 'string' },
          },
        },
        db_properties: {
          schema: {
            databaseId: { type: 'string', required: true },
            type: { type: 'string', required: true },
          },
        },
        db_property_indexes: {
          schema: {
            databaseId: { type: 'string', required: true },
            rowId: { type: 'string', required: true },
            propertyId: { type: 'string', required: true },
            valueJson: { type: 'json' },
          },
        },
      },
    },
  },
});

describePostgres('live PostgreSQL form-shaped transaction parity', () => {
  const schema = `form_parity_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let adminClient: Client;
  let scopedClient: Client;
  let scopedUrl = '';

  function env(): Env {
    return {
      EDGEBASE_CONFIG: CONFIG,
      [CONNECTION_KEY]: scopedUrl,
    } as unknown as Env;
  }

  async function callPg(
    method: 'POST',
    path: string,
    tableName: string,
    body: Record<string, unknown>,
  ) {
    const request = new Request(`http://internal/api/db/${NAMESPACE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Is-Service-Key': 'true',
      },
    });
    const context = buildInternalHandlerContext({ env: env(), request, body });
    return handlePgRequest(context, NAMESPACE, tableName, path);
  }

  async function insert(tableName: string, data: Record<string, unknown>) {
    const response = await callPg('POST', `/tables/${tableName}`, tableName, data);
    expect(response.status).toBe(201);
    return await response.json() as Record<string, unknown>;
  }

  async function transact(operations: unknown[]) {
    return callPg('POST', '/transact', '', { operations });
  }

  beforeAll(async () => {
    adminClient = new Client({ connectionString: postgresUrl! });
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA "${schema}"`);

    const url = new URL(postgresUrl!);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    scopedUrl = url.toString();
    scopedClient = new Client({ connectionString: scopedUrl });
    await scopedClient.connect();
    _resetPgSchemaCache();
  }, 30_000);

  afterAll(async () => {
    _resetPgSchemaCache();
    if (scopedClient) await scopedClient.end();
    if (adminClient) {
      await adminClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminClient.end();
    }
  }, 30_000);

  it('commits scalar-fenced response/index/backlink writes and rolls back rejected, replay, and stale attempts', async () => {
    const link = await insert('form_links', {
      id: 'link-1',
      workspaceId: 'workspace-1',
      databaseId: 'database-1',
      viewId: 'view-1',
      token: 'synthetic-token',
      audience: 'workspace',
      enabled: true,
    });
    const view = await insert('db_views', {
      id: 'view-1',
      databaseId: 'database-1',
      type: 'form',
    });
    const database = await insert('pages', {
      id: 'database-1',
      workspaceId: 'workspace-1',
      parentId: null,
      parentType: 'workspace',
      kind: 'database',
      title: 'Responses',
      properties: {},
      inTrash: false,
      deletionPendingAt: null,
      isLocked: false,
    });
    const relationTarget = await insert('pages', {
      id: 'related-row-1',
      workspaceId: 'workspace-1',
      parentId: 'related-database-1',
      parentType: 'database',
      kind: 'page',
      title: 'Synthetic project',
      properties: { backlink: [] },
      inTrash: false,
      deletionPendingAt: null,
      isLocked: false,
    });
    const ownerProperty = await insert('db_properties', {
      id: 'property-owner',
      databaseId: 'database-1',
      type: 'person',
    });
    const relationProperty = await insert('db_properties', {
      id: 'property-related',
      databaseId: 'database-1',
      type: 'relation',
    });

    const objectExpectation = await transact([
      {
        table: 'pages', op: 'insert', data: {
          id: 'object-expect-must-not-commit',
          workspaceId: 'workspace-1',
          parentId: 'database-1',
          parentType: 'database',
          kind: 'page',
          title: 'Must roll back',
          properties: {},
          inTrash: false,
          deletionPendingAt: null,
          isLocked: false,
        },
      },
      {
        table: 'pages', op: 'expect', id: 'related-row-1', exists: true,
        where: [['properties', '==', relationTarget.properties]],
      },
    ]);
    expect(objectExpectation.status).toBe(400);
    await expect(objectExpectation.json()).resolves.toMatchObject({
      code: 400,
      message: 'transact expect cannot compare object values.',
    });
    const objectExpectationRows = await scopedClient.query(
      'SELECT COUNT(*)::integer AS "count" FROM "pages" WHERE "id" = $1',
      ['object-expect-must-not-commit'],
    );
    expect(objectExpectationRows.rows).toEqual([{ count: 0 }]);

    const responseId = 'form-response-1';
    const responseProperties = {
      'property-owner': ['user-1'],
      'property-related': ['related-row-1'],
    };
    const operations = [
      {
        table: 'form_links', op: 'expect', id: 'link-1', exists: true,
        where: [
          ['workspaceId', '==', 'workspace-1'],
          ['databaseId', '==', 'database-1'],
          ['viewId', '==', 'view-1'],
          ['token', '==', 'synthetic-token'],
          ['audience', '==', 'workspace'],
          ['enabled', '==', true],
          ['updatedAt', '==', link.updatedAt],
        ],
      },
      {
        table: 'db_views', op: 'expect', id: 'view-1', exists: true,
        where: [
          ['databaseId', '==', 'database-1'],
          ['type', '==', 'form'],
          ['updatedAt', '==', view.updatedAt],
        ],
      },
      {
        table: 'pages', op: 'expect', id: 'database-1', exists: true,
        where: [
          ['workspaceId', '==', 'workspace-1'],
          ['kind', '==', 'database'],
          ['inTrash', '==', false],
          ['deletionPendingAt', '==', null],
          ['isLocked', '==', false],
          ['updatedAt', '==', database.updatedAt],
        ],
      },
      {
        table: 'db_properties', op: 'expect', id: 'property-owner', exists: true,
        where: [
          ['databaseId', '==', 'database-1'],
          ['type', '==', 'person'],
          ['updatedAt', '==', ownerProperty.updatedAt],
        ],
      },
      {
        table: 'db_properties', op: 'expect', id: 'property-related', exists: true,
        where: [
          ['databaseId', '==', 'database-1'],
          ['type', '==', 'relation'],
          ['updatedAt', '==', relationProperty.updatedAt],
        ],
      },
      {
        table: 'pages', op: 'expect', id: 'related-row-1', exists: true,
        where: [
          ['workspaceId', '==', 'workspace-1'],
          ['parentId', '==', 'related-database-1'],
          ['parentType', '==', 'database'],
          ['kind', '==', 'page'],
          ['inTrash', '==', false],
          ['deletionPendingAt', '==', null],
          ['updatedAt', '==', relationTarget.updatedAt],
        ],
      },
      { table: 'pages', op: 'expect', id: responseId, exists: false },
      {
        table: 'pages', op: 'insert', data: {
          id: responseId,
          workspaceId: 'workspace-1',
          parentId: 'database-1',
          parentType: 'database',
          kind: 'page',
          title: 'Synthetic response',
          properties: responseProperties,
          inTrash: false,
          deletionPendingAt: null,
          isLocked: false,
          lastEditedBy: 'user-1',
          lastMutationId: 'form:link-1:request-1',
        },
      },
      {
        table: 'db_property_indexes', op: 'insert', data: {
          id: 'index-owner',
          databaseId: 'database-1',
          rowId: responseId,
          propertyId: 'property-owner',
          valueJson: ['user-1'],
        },
      },
      {
        table: 'db_property_indexes', op: 'insert', data: {
          id: 'index-related',
          databaseId: 'database-1',
          rowId: responseId,
          propertyId: 'property-related',
          valueJson: ['related-row-1'],
        },
      },
      {
        table: 'pages', op: 'update', id: 'related-row-1', data: {
          properties: { backlink: [responseId] },
          lastEditedBy: 'user-1',
        },
      },
    ];

    const committed = await transact(operations);
    const committedBody = await committed.clone().json();
    expect(committed.status, JSON.stringify(committedBody)).toBe(200);

    const responseRow = await scopedClient.query(
      'SELECT "properties", "lastMutationId" FROM "pages" WHERE "id" = $1',
      [responseId],
    );
    expect(responseRow.rows).toEqual([{
      properties: responseProperties,
      lastMutationId: 'form:link-1:request-1',
    }]);
    const indexRows = await scopedClient.query(
      'SELECT "propertyId", "valueJson" FROM "db_property_indexes" WHERE "rowId" = $1 ORDER BY "propertyId"',
      [responseId],
    );
    expect(indexRows.rows).toEqual([
      { propertyId: 'property-owner', valueJson: ['user-1'] },
      { propertyId: 'property-related', valueJson: ['related-row-1'] },
    ]);
    const backlink = await scopedClient.query(
      'SELECT "properties" FROM "pages" WHERE "id" = $1',
      ['related-row-1'],
    );
    expect(backlink.rows).toEqual([{ properties: { backlink: [responseId] } }]);

    const replay = await transact(operations);
    expect(replay.status).toBe(409);
    const exactRows = await scopedClient.query(
      'SELECT COUNT(*)::integer AS "count" FROM "pages" WHERE "id" = $1',
      [responseId],
    );
    expect(exactRows.rows).toEqual([{ count: 1 }]);

    const stale = await transact([
      operations[5],
      {
        table: 'pages', op: 'insert', data: {
          id: 'stale-response',
          workspaceId: 'workspace-1',
          parentId: 'database-1',
          parentType: 'database',
          kind: 'page',
          title: 'Must roll back',
          properties: {},
          inTrash: false,
          deletionPendingAt: null,
          isLocked: false,
        },
      },
      {
        table: 'db_property_indexes', op: 'insert', data: {
          id: 'stale-index',
          databaseId: 'database-1',
          rowId: 'stale-response',
          propertyId: 'property-related',
          valueJson: ['related-row-1'],
        },
      },
      {
        table: 'pages', op: 'update', id: 'related-row-1', data: {
          properties: { backlink: [responseId, 'stale-response'] },
          lastEditedBy: 'user-1',
        },
      },
    ]);
    expect(stale.status).toBe(409);
    const staleRows = await scopedClient.query(
      'SELECT COUNT(*)::integer AS "count" FROM "pages" WHERE "id" = $1',
      ['stale-response'],
    );
    expect(staleRows.rows).toEqual([{ count: 0 }]);
    const staleIndexRows = await scopedClient.query(
      'SELECT COUNT(*)::integer AS "count" FROM "db_property_indexes" WHERE "id" = $1',
      ['stale-index'],
    );
    expect(staleIndexRows.rows).toEqual([{ count: 0 }]);
    const backlinkAfterStale = await scopedClient.query(
      'SELECT "properties" FROM "pages" WHERE "id" = $1',
      ['related-row-1'],
    );
    expect(backlinkAfterStale.rows).toEqual([{ properties: { backlink: [responseId] } }]);
  }, 30_000);
});
