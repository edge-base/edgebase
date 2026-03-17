---
sidebar_position: 9
---

# Admin API

Server-side administration endpoints for managing users, custom claims, and sessions. All endpoints require the `X-EdgeBase-Service-Key` header.

## Authentication

Every request must include the service key header:

```
X-EdgeBase-Service-Key: <serviceKey>
```

The service key is a server-side secret. Never expose it in client-side code or public repositories.

---

## List Users

### `GET /api/auth/admin/users`

List all users with cursor-based pagination.

| Query Parameter | Type   | Default | Description                           |
| --------------- | ------ | ------- | ------------------------------------- |
| `limit`         | number | `20`    | Number of users per page              |
| `cursor`        | string | `"0"`   | Pagination cursor from previous response |

```bash
curl "https://your-project.edgebase.fun/api/auth/admin/users?limit=20&cursor=0" \
  -H "X-EdgeBase-Service-Key: <serviceKey>"
```

**Response** `200`

```json
{
  "users": [
    {
      "id": "01J...",
      "email": "user@example.com",
      "role": "user",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "cursor": "20"
}
```

When `cursor` is `null`, you have reached the last page.

---

## Get User

### `GET /api/auth/admin/users/:id`

Get detailed information for a specific user, including custom claims.

| Path Parameter | Description |
| -------------- | ----------- |
| `id`           | User ID     |

```bash
curl https://your-project.edgebase.fun/api/auth/admin/users/01J... \
  -H "X-EdgeBase-Service-Key: <serviceKey>"
```

**Response** `200`

```json
{
  "id": "01J...",
  "email": "user@example.com",
  "name": "Jane",
  "role": "user",
  "emailVerified": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "customClaims": {}
}
```

---

## Create User

### `POST /api/auth/admin/users`

Create a new user from the server side. Unlike the client signup endpoint, this does not return tokens.

| Request Body  | Type   | Required | Description                    |
| ------------- | ------ | -------- | ------------------------------ |
| `email`       | string | Yes      | Email address                  |
| `password`    | string | Yes      | Password                       |
| `displayName` | string |          | Display name                   |
| `role`        | string |          | User role (default: `"user"`)  |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/admin/users \
  -H "X-EdgeBase-Service-Key: <serviceKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "secret123",
    "displayName": "New User",
    "role": "editor"
  }'
```

**Response** `201`

```json
{
  "user": {
    "id": "01J...",
    "email": "newuser@example.com",
    "displayName": "New User",
    "role": "editor",
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

---

## Update User

### `PATCH /api/auth/admin/users/:id`

Update a user's information.

| Path Parameter | Description |
| -------------- | ----------- |
| `id`           | User ID     |

| Request Body      | Type    | Required | Description                         |
| ----------------- | ------- | -------- | ----------------------------------- |
| `displayName`     | string  |          | Display name                        |
| `avatarUrl`       | string  |          | Avatar URL                          |
| `role`            | string  |          | User role (e.g., `user`, `admin`, `editor`) |
| `emailVisibility` | string  |          | `'public'` or `'private'`           |
| `disabled`        | boolean |          | Ban/disable user                    |
| `metadata`        | object  |          | Custom metadata (16KB limit)        |
| `appMetadata`     | object  |          | App metadata (16KB limit)           |

```bash
curl -X PATCH https://your-project.edgebase.fun/api/auth/admin/users/01J... \
  -H "X-EdgeBase-Service-Key: <serviceKey>" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "Jane Doe", "role": "admin", "disabled": false}'
```

**Response** `200`

```json
{
  "id": "01J...",
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "role": "admin",
  "disabled": false
}
```

---

## Delete User

### `DELETE /api/auth/admin/users/:id`

Permanently delete a user. This automatically cleans up:

- D1 index entries
- OAuth connections
- `_users_public` record

| Path Parameter | Description |
| -------------- | ----------- |
| `id`           | User ID     |

```bash
curl -X DELETE https://your-project.edgebase.fun/api/auth/admin/users/01J... \
  -H "X-EdgeBase-Service-Key: <serviceKey>"
```

**Response** `200`

```json
{ "ok": true }
```

---

## Set Custom Claims

### `PUT /api/auth/admin/users/:id/claims`

Set custom claims on a user. Custom claims are included in the user's JWT and can be used in access rules for authorization decisions.

| Path Parameter | Description |
| -------------- | ----------- |
| `id`           | User ID     |

| Request Body  | Type | Required | Description                                   |
| ------------- | ---- | -------- | --------------------------------------------- |
| *(any key)*   | any  | Yes      | Key-value pairs (e.g., `plan`, `orgId`, `tier`) |

```bash
curl -X PUT https://your-project.edgebase.fun/api/auth/admin/users/01J.../claims \
  -H "X-EdgeBase-Service-Key: <serviceKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "plan": "pro",
    "orgId": "org_1",
    "tier": 2
  }'
```

**Response** `200`

```json
{ "ok": true }
```

After setting claims, the user's next access token will include these values. You can reference them in access rules via `auth.custom` (e.g., `read(auth) { return auth?.custom?.plan === 'pro' }`).

---

## Revoke All Sessions

### `POST /api/auth/admin/users/:id/revoke`

Revoke all active sessions for a specific user. This forces the user to re-authenticate on all devices.

| Path Parameter | Description |
| -------------- | ----------- |
| `id`           | User ID     |

**Request Body**: None

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/admin/users/01J.../revoke \
  -H "X-EdgeBase-Service-Key: <serviceKey>"
```

**Response** `200`

```json
{ "ok": true }
```

---

## Ban / Disable User

### `PATCH /api/auth/admin/users/:id`

Disable (ban) a user by setting the `disabled` field to `true`. This can be done via the existing [Update User](#update-user) endpoint.

```bash
curl -X PATCH https://your-project.edgebase.fun/api/auth/admin/users/01J... \
  -H "X-EdgeBase-Service-Key: <serviceKey>" \
  -H "Content-Type: application/json" \
  -d '{"disabled": true}'
```

When `disabled` is set to `true`:

- All existing sessions are **revoked immediately**
- New sign-in attempts return `403 "Account is disabled"`
- Token refresh attempts are rejected

To re-enable a user, set `disabled` to `false`:

```bash
curl -X PATCH https://your-project.edgebase.fun/api/auth/admin/users/01J... \
  -H "X-EdgeBase-Service-Key: <serviceKey>" \
  -H "Content-Type: application/json" \
  -d '{"disabled": false}'
```

---

## Batch Import Users

### `POST /api/auth/admin/users/import`

Import multiple users at once. Supports plaintext passwords (hashed automatically) and pre-hashed passwords (bcrypt and PBKDF2 formats).

| Request Body | Type  | Required | Description               |
| ------------ | ----- | -------- | ------------------------- |
| `users`      | array | Yes      | Array of user objects     |

Each user object supports these fields:

| Field          | Type    | Required | Description                                       |
| -------------- | ------- | -------- | ------------------------------------------------- |
| `id`           | string  |          | Custom user ID (auto-generated if omitted)        |
| `email`        | string  | Yes      | Email address                                     |
| `password`     | string  |          | Plaintext password (hashed automatically)         |
| `passwordHash` | string  |          | Pre-hashed password (bcrypt or PBKDF2 format)     |
| `displayName`  | string  |          | Display name                                      |
| `avatarUrl`    | string  |          | Avatar URL                                        |
| `role`         | string  |          | User role (default: `"user"`)                     |
| `verified`     | boolean |          | Email verified status                             |
| `metadata`     | object  |          | Custom user metadata                              |
| `appMetadata`  | object  |          | Server-only metadata (not exposed to client)      |

Provide either `password` or `passwordHash`, not both.

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/admin/users/import \
  -H "X-EdgeBase-Service-Key: <serviceKey>" \
  -H "Content-Type: application/json" \
  -d '{
    "users": [
      {
        "id": "user-123",
        "email": "user@example.com",
        "password": "plaintext",
        "displayName": "User Name",
        "avatarUrl": "https://example.com/photo.jpg",
        "role": "user",
        "verified": true,
        "metadata": {},
        "appMetadata": {}
      }
    ]
  }'
```

**Response** `200`

```json
{
  "imported": 1,
  "skipped": 0,
  "errors": 0,
  "results": [
    {
      "id": "user-123",
      "email": "user@example.com",
      "status": "created"
    }
  ]
}
```

Pre-hashed passwords support **bcrypt** (`$2a$`, `$2b$`, `$2y$`) and **PBKDF2** (`pbkdf2:sha256:...`) formats. Results are reported per user; duplicate emails in the same batch are returned as `error`, and already-existing users are returned as `skipped`.

**Limits**: Maximum 1,000 users per batch.

---

## Admin MFA Force-Disable

### `DELETE /api/auth/admin/users/:id/mfa`

Force-disable MFA for a user. Deletes all MFA factors and recovery codes. Useful when a user is locked out of their account.

| Path Parameter | Description |
| -------------- | ----------- |
| `id`           | User ID     |

```bash
curl -X DELETE https://your-project.edgebase.fun/api/auth/admin/users/01J.../mfa \
  -H "X-EdgeBase-Service-Key: <serviceKey>"
```

**Response** `200`

```json
{ "ok": true }
```

This operation is transaction-safe -- all MFA factors and recovery codes are deleted atomically.

---

## Error Format

All error responses follow this structure:

```json
{
  "code": 400,
  "message": "Validation failed.",
  "data": {}
}
```

| HTTP Status | Meaning                              |
| ----------- | ------------------------------------ |
| `400`       | Bad request / validation error       |
| `401`       | Missing or invalid service key       |
| `404`       | User not found                       |
| `409`       | Conflict (e.g., email already exists) |
| `500`       | Internal server error                |
