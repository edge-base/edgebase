---
sidebar_position: 18
---

# User Import

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Batch import users from another system into EdgeBase. Supports pre-hashed passwords for seamless migration without requiring users to reset their passwords.

## REST API

```
POST /api/auth/admin/users/import
X-EdgeBase-Service-Key: YOUR_SERVICE_KEY
Content-Type: application/json

{
  "users": [
    {
      "email": "user1@example.com",
      "password": "plaintext-password",
      "displayName": "User One",
      "role": "user",
      "verified": true,
      "metadata": { "source": "legacy-system" }
    },
    {
      "email": "user2@example.com",
      "passwordHash": "pbkdf2:sha256:100000:base64salt:base64hash",
      "displayName": "User Two"
    }
  ]
}
```

## User Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | No | Custom user ID (auto-generated if omitted) |
| `email` | `string` | Yes | User email address |
| `password` | `string` | No | Plaintext password (hashed with PBKDF2-SHA256) |
| `passwordHash` | `string` | No | Pre-hashed password (pbkdf2 or bcrypt format) |
| `displayName` | `string` | No | Display name |
| `avatarUrl` | `string` | No | Avatar URL |
| `role` | `string` | No | User role (default: `'user'`) |
| `verified` | `boolean` | No | Email verified status |
| `metadata` | `object` | No | Custom user metadata |
| `appMetadata` | `object` | No | Server-only metadata (not exposed to client) |

Provide either `password` or `passwordHash`, not both. If neither is provided, the user will have no password (OAuth-only or passwordless).

## Supported Hash Formats

| Format | Example |
|--------|---------|
| **PBKDF2** (EdgeBase native) | `pbkdf2:sha256:100000:{salt}:{hash}` |
| **bcrypt** | `$2a$10$...`, `$2b$10$...`, `$2y$10$...` |

Bcrypt-hashed passwords are verified as-is and lazily re-hashed to PBKDF2 on the user's next sign-in.

## Limits

- **Maximum 1,000 users per batch**
- Duplicate emails within a batch are reported as errors
- Emails already registered are skipped (not overwritten)

## Response

```json
{
  "imported": 2,
  "skipped": 0,
  "errors": 0,
  "results": [
    { "id": "user-id-1", "email": "user1@example.com", "status": "created" },
    { "id": "user-id-2", "email": "user2@example.com", "status": "created" }
  ]
}
```

Each result has a `status` of `"created"`, `"skipped"`, or `"error"` (with an `error` message if applicable).
Validation and creation are reported per user, so a failed row does not roll back successful imports from the same batch.

## SDK (Admin)

```typescript
const admin = createAdminClient('https://...', { serviceKey: '...' });

const result = await admin.auth.importUsers([
  { email: 'user@example.com', password: 'secret', displayName: 'User' },
]);
console.log(result.imported); // Number of successfully imported users
```
