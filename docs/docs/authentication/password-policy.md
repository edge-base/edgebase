---
sidebar_position: 15
---

# Password Policy

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Configure password strength requirements for user sign-up, password changes, and password resets.

## Configuration

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    passwordPolicy: {
      minLength: 10,              // Default: 8
      requireUppercase: true,     // Default: false
      requireLowercase: true,     // Default: false
      requireNumber: true,        // Default: false
      requireSpecial: true,       // Default: false
      checkLeaked: true,          // Default: false
    },
  },
});
```

## Policy Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minLength` | `number` | `8` | Minimum password length |
| `requireUppercase` | `boolean` | `false` | Require at least one uppercase letter (A-Z) |
| `requireLowercase` | `boolean` | `false` | Require at least one lowercase letter (a-z) |
| `requireNumber` | `boolean` | `false` | Require at least one digit (0-9) |
| `requireSpecial` | `boolean` | `false` | Require at least one special character |
| `checkLeaked` | `boolean` | `false` | Check against the Have I Been Pwned database |

## Enforcement Points

Password policy is validated at three endpoints:

1. **Sign-up** — `POST /auth/signup`
2. **Password change** — `POST /auth/change-password`
3. **Password reset** — `POST /auth/reset-password`

When validation fails, the response includes all violated rules:

```json
{
  "error": "Password validation failed",
  "details": {
    "errors": [
      "Password must be at least 10 characters.",
      "Password must contain at least one uppercase letter.",
      "Password must contain at least one special character."
    ]
  }
}
```

## Leaked Password Detection (HIBP)

When `checkLeaked` is enabled, passwords are checked against the [Have I Been Pwned](https://haveibeenpwned.com/Passwords) database using the **k-anonymity** model:

1. The password is SHA-1 hashed
2. Only the first 5 characters of the hash are sent to the HIBP API
3. The server checks the response locally for a match

### Privacy

- The full password hash is **never** sent to HIBP
- The k-anonymity model ensures HIBP cannot determine which password is being checked

### Fail-Open Behavior

The HIBP check has a **3-second timeout** and uses a **fail-open** policy:
- If the HIBP API is unreachable or times out, the password is **allowed**
- The check only runs after all other policy rules pass (to avoid unnecessary API calls)
- Network errors do not block user sign-up or password changes

## Password Hashing

EdgeBase uses **PBKDF2-SHA256** with the following parameters:

| Parameter | Value |
|-----------|-------|
| Algorithm | PBKDF2 |
| Hash function | SHA-256 |
| Iterations | 100,000 |
| Salt | 128-bit (16 bytes), random |
| Key length | 256-bit (32 bytes) |
| Format | `pbkdf2:sha256:100000:{salt_b64}:{hash_b64}` |

### Legacy Hash Support

For users imported from other systems, EdgeBase also supports verifying **bcrypt** hashes (`$2a$`, `$2b$`, `$2y$`). Bcrypt passwords are automatically re-hashed to PBKDF2 on the user's next successful sign-in (lazy re-hash).

## Related

- [Email & Password](./email-password) — Sign-up, sign-in, password change, and reset flows
- [Authentication Triggers](./hooks) — `beforePasswordReset` for custom password policy enforcement
- [Limits](./limits) — Password-related limits and defaults
