---
sidebar_position: 8
---

# Functions API

Custom HTTP function endpoints. All HTTP methods supported.

## Custom Functions

### `ALL /api/functions/:functionName`

Executes a user-defined HTTP function. Any HTTP method can be used (GET, POST, PUT, DELETE, etc.).

```bash
curl https://your-project.edgebase.fun/api/functions/my-function \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"input": "data"}'
```

**Auth**: Depends on function implementation. Functions can access `auth` from the context to check authentication.

**Request/Response**: Entirely determined by the function implementation. The function receives the full HTTP request and returns a custom response.

---

## SQL Endpoint

### `POST /api/sql`

Execute raw SQL against a configured database namespace. Depending on the namespace provider, the same endpoint can route to Durable Object SQLite, Cloudflare D1, or PostgreSQL/Neon.

**Auth**: Service Key required (`X-EdgeBase-Service-Key` header).

| Field | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Configured database namespace (e.g., `"shared"`) |
| `id` | string | No | Instance ID for dynamic DB blocks. Required for dynamic namespaces. |
| `sql` | string | Yes | SQL query |
| `params` | array | No | Parameter bindings |

**Request example:**
```json
{
  "namespace": "shared",
  "sql": "SELECT * FROM posts WHERE status = ?",
  "params": ["published"]
}
```

Undeclared namespaces are rejected. For the full contract and Admin SDK examples, see [Raw SQL](/docs/server/raw-sql).

**Response** `200` — SQL result payload (`rows`, `items`, `results`).

:::warning
Raw SQL bypasses access rules. Only use with Service Key from trusted server-side code.
:::
