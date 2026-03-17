---
sidebar_position: 16
---

# Ban & Disable Users

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

EdgeBase provides a built-in mechanism to ban or disable user accounts. Disabled users are immediately locked out of all authentication flows.

## How It Works

When a user is disabled:

1. All existing sessions are **immediately deleted**
2. Authentication endpoints return `403 Forbidden` with an account-disabled error message such as `"This account has been disabled."`
3. The user cannot sign in, refresh tokens, change passwords, register passkeys, or perform any authenticated action

### Enforcement Points

The `disabled` check is enforced across **all** authentication flows:

| Flow | Endpoint |
|------|----------|
| Email/Password sign-in | `POST /auth/signin` |
| OAuth session creation | OAuth callback |
| Token refresh | `POST /auth/refresh` |
| Email OTP | `POST /verify-email-otp` |
| Passkey registration | `POST /passkeys/register-options`, `POST /passkeys/register` |
| Passkey authentication | `POST /passkeys/authenticate` |
| MFA verification | `POST /mfa/verify`, `POST /mfa/recovery` |
| Password change | `POST /change-password` |
| Email change | `POST /change-email` |
| Account linking | `POST /auth/link/email` |

## Admin API

### Disable a User

```bash
curl -X PATCH https://your-project.edgebase.app/api/auth/admin/users/{userId} \
  -H "X-EdgeBase-Service-Key: YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "disabled": true }'
```

### Re-enable a User

```bash
curl -X PATCH https://your-project.edgebase.app/api/auth/admin/users/{userId} \
  -H "X-EdgeBase-Service-Key: YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "disabled": false }'
```

### SDK (Admin)

```typescript
const admin = createAdminClient('https://...', { serviceKey: '...' });

// Disable
await admin.auth.updateUser(userId, { disabled: true });

// Re-enable
await admin.auth.updateUser(userId, { disabled: false });
```

## Data Model

- Column: `_users.disabled` (`INTEGER`, `0` = active, `1` = disabled)
- API responses convert `disabled` to a boolean value
- On disable: `DELETE FROM _sessions WHERE userId = ?` (all sessions revoked)

## Use Cases

- **Abuse prevention**: Immediately block a malicious user
- **Account suspension**: Temporarily disable an account pending review
- **Compliance**: Lock accounts as required by legal or policy requirements
