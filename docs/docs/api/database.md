---
sidebar_position: 2
---

# Database API

CRUD operations on database tables. All database endpoints use the following URL pattern:

```
/api/db/{namespace}/tables/{tableName}
```

For dynamic DB blocks with instance IDs:

```
/api/db/{namespace}/{instanceId}/tables/{tableName}
```

For example, `/api/db/workspace/ws_123/tables/documents` targets the `documents` table in the `workspace` DB block with instance ID `ws_123`.

## Authentication

Database endpoints respect access rules defined in your EdgeBase configuration. Depending on your rules, requests may require:

- **Bearer Token**: `Authorization: Bearer <accessToken>`
- **Service Key**: `X-EdgeBase-Service-Key: <serviceKey>`
- **Public access**: No authentication (if rules allow)

---

## List Records

### `GET /api/db/shared/tables/:name`

Retrieve a list of records from a table. Supports filtering, sorting, and two pagination modes.

| Query Parameter | Type   | Example                              | Description                                                     |
| --------------- | ------ | ------------------------------------ | --------------------------------------------------------------- |
| `filter`        | JSON   | `[["status","==","published"]]`      | Filter tuple array                                              |
| `sort`          | string | `createdAt:desc`                     | Sort order (`field:asc` or `field:desc`, comma-separated for multiple) |
| `limit`         | number | `20`                                 | Maximum number of records to return                             |
| `page`          | number | `2`                                  | Page number (offset-based pagination)                           |
| `perPage`       | number | `20`                                 | Number of records per page                                      |
| `offset`        | number | `20`                                 | Number of records to skip                                       |
| `after`         | string | `01J...`                             | Cursor pagination (forward)                                     |
| `before`        | string | `01J...`                             | Cursor pagination (backward)                                    |
| `orFilter`      | JSON   | `[["type","==","news"],["featured","==",true]]` | OR condition filter (maximum 5 conditions)                      |

:::warning
`page`/`offset` and `after`/`before` are mutually exclusive. Using both in the same request will result in an error.
:::

:::tip Offset-based pagination
When using `offset`, the response includes pagination metadata: `total` (total record count), `page` (computed page number), and `perPage` (records per page). For example, `?offset=20&limit=10` returns `page: 3` and `perPage: 10` along with the total count. This is useful for building paginated UIs with page number navigation.
:::

```bash
curl "https://your-project.edgebase.fun/api/db/shared/tables/posts?filter=[[\"status\",\"==\",\"published\"]]&sort=createdAt:desc&limit=20" \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200` (Offset mode -- default when using `page` or `offset`)

```json
{
  "items": [
    {
      "id": "01J...",
      "title": "Hello",
      "status": "published",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "perPage": 20,
  "hasMore": null,
  "cursor": null
}
```

**Response** `200` (Cursor mode -- when using `after` or `before`)

```json
{
  "items": [
    {
      "id": "01J...",
      "title": "Hello",
      "status": "published",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "total": null,
  "page": null,
  "perPage": null,
  "hasMore": true,
  "cursor": "01J..."
}
```

---

## Get Record

### `GET /api/db/shared/tables/:name/:id`

Retrieve a single record by its ID.

| Path Parameter | Description |
| -------------- | ----------- |
| `name`         | Table name  |
| `id`           | Record ID   |

| Query Parameter | Type   | Description                                                        |
| --------------- | ------ | ------------------------------------------------------------------ |
| `fields`        | string | Comma-separated list of fields to return (e.g. `title,status`). Omit to return all fields. |

```bash
curl https://your-project.edgebase.fun/api/db/shared/tables/posts/01J... \
  -H "Authorization: Bearer <accessToken>"
```

With field selection:

```bash
curl "https://your-project.edgebase.fun/api/db/shared/tables/posts/01J...?fields=title,status" \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200`

```json
{
  "id": "01J...",
  "title": "Hello",
  "status": "published",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

## Insert Record

### `POST /api/db/shared/tables/:name`

Insert a new record. The following fields are auto-generated if not provided: `id` (UUID v7), `createdAt`, and `updatedAt`.

| Path Parameter | Description |
| -------------- | ----------- |
| `name`         | Table name  |

```bash
curl -X POST https://your-project.edgebase.fun/api/db/shared/tables/posts \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hello World",
    "status": "draft",
    "tags": ["intro", "tutorial"],
    "authorId": "01J..."
  }'
```

**Response** `201`

```json
{
  "id": "01J...",
  "title": "Hello World",
  "status": "draft",
  "tags": ["intro", "tutorial"],
  "authorId": "01J...",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

## Upsert Record

### `POST /api/db/shared/tables/:name?upsert=true`

Insert a new record or update an existing one if a conflict is detected on the specified field.

| Query Parameter  | Type   | Default | Description                           |
| ---------------- | ------ | ------- | ------------------------------------- |
| `upsert`         | `true` | --      | Enable upsert mode                    |
| `conflictTarget` | string | `id`    | Field to check for conflicts          |

| Request Body   | Type   | Required | Description                       |
| -------------- | ------ | -------- | --------------------------------- |
| `id`           | string | Yes      | Record ID (used for conflict check) |
| *(any field)*  | any    |          | Data to upsert                    |

```bash
curl -X POST "https://your-project.edgebase.fun/api/db/shared/tables/posts?upsert=true" \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "01J...",
    "title": "Hello World",
    "status": "published"
  }'
```

**Response** `200` (updated) or `201` (created)

```json
{
  "id": "01J...",
  "title": "Hello World",
  "status": "published",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

:::info Access Rules for Upsert
When `upsert=true` is set, both `insert` and `update` access rules are evaluated. The request passes if **either** rule allows it.
:::

---

## Update Record

### `PATCH /api/db/shared/tables/:name/:id`

Partially update a record. Supports special field operators for atomic operations.

| Path Parameter | Description |
| -------------- | ----------- |
| `name`         | Table name  |
| `id`           | Record ID   |

| Request Body                                 | Type   | Description                |
| -------------------------------------------- | ------ | -------------------------- |
| *(any field)*                                | any    | Fields to update           |
| `{field}: {"$op": "increment", "value": n}`  | object | Atomically increment a numeric field by `n` |
| `{field}: {"$op": "deleteField"}`            | object | Remove a field (set to NULL) |

```bash
curl -X PATCH https://your-project.edgebase.fun/api/db/shared/tables/posts/01J... \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "viewCount": { "$op": "increment", "value": 1 },
    "removedField": { "$op": "deleteField" }
  }'
```

**Response** `200`

```json
{
  "id": "01J...",
  "title": "Updated Title",
  "viewCount": 43,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T12:00:00.000Z"
}
```

---

## Delete Record

### `DELETE /api/db/shared/tables/:name/:id`

Delete a single record by its ID.

| Path Parameter | Description |
| -------------- | ----------- |
| `name`         | Table name  |
| `id`           | Record ID   |

```bash
curl -X DELETE https://your-project.edgebase.fun/api/db/shared/tables/posts/01J... \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200`

```json
{ "ok": true }
```

---

## Count Records

### `GET /api/db/shared/tables/:name/count`

Return the count of records matching a filter, without returning the records themselves.

| Query Parameter | Type | Description                             |
| --------------- | ---- | --------------------------------------- |
| `filter`        | JSON | Filter tuple array (same format as list) |

```bash
curl "https://your-project.edgebase.fun/api/db/shared/tables/posts/count?filter=[[\"status\",\"==\",\"published\"]]" \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200`

```json
{ "total": 42 }
```

---

## Full-Text Search

### `GET /api/db/shared/tables/:name/search`

Perform a full-text search (FTS) query. Requires the table to have `fts` configured in the schema.

| Query Parameter  | Type    | Default    | Description                            |
| ---------------- | ------- | ---------- | -------------------------------------- |
| `q`              | string  | --         | Search query term                      |
| `limit`          | number  |            | Maximum number of results              |
| `offset`         | number  |            | Number of results to skip              |
| `highlightPre`   | string  | `<mark>`   | Opening highlight tag                  |
| `highlightPost`  | string  | `</mark>`  | Closing highlight tag                  |

```bash
curl "https://your-project.edgebase.fun/api/db/shared/tables/posts/search?q=hello&limit=10" \
  -H "Authorization: Bearer <accessToken>"
```

With custom highlight tags:

```bash
curl "https://your-project.edgebase.fun/api/db/shared/tables/posts/search?q=hello&limit=10&highlightPre=<b>&highlightPost=</b>" \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200` -- Same format as list endpoint

---

## Batch Operations

### `POST /api/db/shared/tables/:name/batch`

Execute multiple insert, update, and delete operations in a single all-or-nothing transaction. Maximum 500 operations per request.

| Request Body | Type     | Description                         |
| ------------ | -------- | ----------------------------------- |
| `inserts`    | array    | Array of objects to insert          |
| `updates`    | array    | Array of objects with `id` to update |
| `deletes`    | array    | Array of record IDs to delete       |

Append `?upsert=true` to enable upsert mode for the inserts and updates. When enabled, each item in the `inserts` array becomes an upsert — if a record with the same primary key already exists, it is updated instead of causing a conflict error. The same access rule semantics as [single upsert](#upsert-record) apply: both `insert` and `update` rules are evaluated, and the request passes if either allows it.

**Example: Batch insert**

```bash
curl -X POST https://your-project.edgebase.fun/api/db/shared/tables/posts/batch \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "inserts": [
      { "title": "Post 1", "status": "draft" },
      { "title": "Post 2", "status": "draft" }
    ]
  }'
```

**Example: Mixed batch**

```json
{
  "inserts": [
    { "title": "New Post" }
  ],
  "updates": [
    { "id": "01J...", "data": { "title": "Updated Post" } }
  ],
  "deletes": ["01Jabc...", "01Jdef..."]
}
```

**Response** `200`

```json
{
  "inserted": [
    { "id": "01J...", "title": "Post 1", "createdAt": "...", "updatedAt": "..." }
  ],
  "updated": [],
  "deleted": []
}
```

---

## Batch by Filter

### `POST /api/db/shared/tables/:name/batch-by-filter`

Update or delete multiple records matching a filter condition. Maximum 500 records affected per request.

| Request Body | Type   | Required | Description                                     |
| ------------ | ------ | -------- | ----------------------------------------------- |
| `action`     | string | Yes      | `"update"` or `"delete"`                        |
| `filter`     | array  |          | Filter tuple array                              |
| `orFilter`   | array  |          | OR condition filter (maximum 5 conditions)      |
| `data`       | object |          | Data to apply (required when action is `"update"`) |

**Example: Delete by filter**

```json
{
  "action": "delete",
  "filter": [["status", "==", "draft"]]
}
```

**Example: Update by filter**

```bash
curl -X POST https://your-project.edgebase.fun/api/db/shared/tables/posts/batch-by-filter \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update",
    "filter": [["status", "==", "draft"]],
    "data": { "status": "archived" }
  }'
```

**Response** `200`

```json
{ "processed": 15, "succeeded": 15 }
```

---

## Filter Syntax

Filters use a tuple array format: `[field, operator, value]`.

| Operator | Description              | Example                            |
| -------- | ------------------------ | ---------------------------------- |
| `==`     | Equal                    | `["status", "==", "published"]`    |
| `!=`     | Not equal                | `["status", "!=", "draft"]`        |
| `>`      | Greater than             | `["price", ">", 100]`             |
| `>=`     | Greater than or equal    | `["price", ">=", 100]`            |
| `<`      | Less than                | `["price", "<", 50]`              |
| `<=`     | Less than or equal       | `["price", "<=", 50]`             |
| `contains` | Substring match (case-sensitive) | `["title", "contains", "hello"]` |
| `in`     | Value in array           | `["status", "in", ["a", "b"]]`    |
| `not in` | Value not in array       | `["status", "not in", ["x"]]`     |

Multiple filter tuples are combined with AND logic:

```json
[["status", "==", "published"], ["authorId", "==", "01J..."]]
```

Use `orFilter` for OR conditions (each condition is ORed):

```json
[["status", "==", "published"], ["featured", "==", true]]
```

---

## Dynamic DB Blocks

For tables in dynamic DB blocks, include the instance ID in the URL path:

```
GET  /api/db/workspace/ws_123/tables/documents
POST /api/db/user/user_456/tables/preferences
```

The static `shared` namespace does not require an instance ID:

```
GET /api/db/shared/tables/posts
```

---

## Error Format

All error responses follow this structure:

```json
{
  "code": 400,
  "message": "Validation failed.",
  "data": {
    "title": { "code": "required", "message": "Field is required." }
  }
}
```

| HTTP Status | Meaning                              |
| ----------- | ------------------------------------ |
| `400`       | Bad request / validation error       |
| `401`       | Authentication required              |
| `403`       | Access denied (access rule violation) |
| `404`       | Table or record not found            |
| `409`       | Conflict (e.g., duplicate ID)        |
| `429`       | Rate limit exceeded                  |
| `500`       | Internal server error                |
