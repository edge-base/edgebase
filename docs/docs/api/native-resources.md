---
sidebar_position: 10
---

# Native Resources API

Access user-defined Cloudflare KV, D1, and Vectorize resources. All endpoints require Service Key authentication.

---

## KV

### `POST /api/kv/:namespace`

Action-based operations on a user-defined KV namespace. The namespace must be declared in `config.kv`.

**Auth**: Service Key required.

| Action | Body Fields | Description |
|---|---|---|
| `get` | `key` | Get value by key |
| `set` | `key`, `value`, `ttl?` | Set value (TTL in seconds) |
| `delete` | `key` | Delete key |
| `list` | `prefix?`, `limit?`, `cursor?` | List keys |

**Examples:**

Set a value:
```json
{ "action": "set", "key": "user:123", "value": "cached-data", "ttl": 300 }
```

Get response:
```json
{ "value": "cached-data" }
```

List response:
```json
{ "keys": ["user:1", "user:2"], "cursor": null }
```

---

## D1

### `POST /api/d1/:database`

Execute SQL on a user-defined D1 database. The database must be declared in `config.d1`.

**Auth**: Service Key required.

| Field | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | SQL query |
| `params` | array | No | Parameter bindings |

**Request example:**
```json
{ "query": "SELECT * FROM events WHERE type = ? LIMIT 10", "params": ["click"] }
```

**Response** `200`:
```json
{
  "results": [{ "id": 1, "type": "click", "createdAt": "..." }],
  "meta": { "changes": 0, "duration": 1.23, "rows_read": 10, "rows_written": 0 }
}
```

---

## Vectorize

### `POST /api/vectorize/:index`

Action-based operations on a user-defined Vectorize index. The index must be declared in `config.vectorize`.

**Auth**: Service Key required.

| Action | Body Fields | Description |
|---|---|---|
| `upsert` | `vectors` (array of `{id, values, metadata?}`), `namespace?` | Insert or update vectors |
| `insert` | `vectors` (array of `{id, values, metadata?}`), `namespace?` | Insert vectors; returns `409` on duplicate ID |
| `search` | `vector`, `topK?`, `filter?`, `namespace?`, `returnValues?`, `returnMetadata?` | Similarity search by vector values |
| `queryById` | `vectorId`, `topK?`, `filter?`, `namespace?`, `returnValues?`, `returnMetadata?` | Similarity search using an existing vector's ID (Vectorize v2 only) |
| `getByIds` | `ids` (string array) | Retrieve vectors by ID |
| `delete` | `ids` (string array) | Delete vectors by ID |
| `describe` | *(none)* | Get index info: `vectorCount`, `dimensions`, `metric` |

**Search example:**
```json
{ "action": "search", "vector": [0.1, 0.2, 0.3], "topK": 5 }
```

**Describe example:**
```json
{ "action": "describe" }
```

**Response** `200`:
```json
{
  "vectorCount": 1500,
  "dimensions": 384,
  "metric": "cosine"
}
```
