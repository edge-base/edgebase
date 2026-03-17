---
sidebar_position: 11
---

# System API

System-level endpoints for health checks, configuration, and schema introspection.

---

## Schema

### `GET /api/schema`

Returns table metadata (field definitions). Access rules are not included in the response.

Access is controlled by the `api.schemaEndpoint` config option:

| Value | Behavior |
|---|---|
| `false` (default) | Returns 404 |
| `true` | Public access |
| `'authenticated'` | Requires JWT or Service Key |

---

## Config

### `GET /api/config`

Returns public configuration needed for client SDK initialization (e.g., Turnstile CAPTCHA site key).

No authentication required. Only exposes non-sensitive configuration values.

---

## Health

### `GET /api/health`

Health check endpoint. Returns server status, version, and current timestamp.

```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-03-17T12:00:00.000Z"
}
```

No authentication required.

---

## Error Format

All API errors follow a consistent format:

```json
{
  "code": 400,
  "message": "Validation failed.",
  "data": {
    "title": { "code": "required", "message": "Field is required." }
  }
}
```

### HTTP Status Codes

| Status | Meaning |
|---|---|
| `400` | Bad request / validation failed |
| `401` | Authentication required (missing or expired token) |
| `403` | Access denied (access rule violation) |
| `404` | Resource not found |
| `405` | Method not allowed |
| `409` | Conflict (e.g., duplicate email) |
| `413` | Request entity too large |
| `415` | Unsupported media type |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

### Error Response Fields

| Field | Type | Description |
|---|---|---|
| `code` | number | HTTP status code |
| `message` | string | Human-readable error description |
| `data` | object | Optional field-level validation details |

### Common Authentication Errors

| Scenario | Status | Message |
|---|---|---|
| No token provided | `401` | Authentication required |
| Expired access token | `401` | Token expired |
| Invalid token signature | `401` | Invalid token |
| Access rule denied | `403` | Access denied |
| Service Key invalid | `401` | Invalid service key |
