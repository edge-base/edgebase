---
sidebar_position: 24
sidebar_label: Access Rules
---

# Access Rules

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Authentication also has its own access-rule surface.

Use `auth.access` to allow or deny specific authentication actions such as sign-up, sign-in, password reset, MFA verification, profile reads, session reads, OAuth redirects, refresh, and sign-out.

This is different from database, storage, database subscription, room, or push access rules:

- Authentication access rules protect **auth endpoints and auth actions**
- Other access rules protect **product resources** such as rows, files, channels, rooms, and notifications

## Configuration

```typescript
import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  auth: {
    access: {
      signUp(input, ctx) {
        const email = String(input?.email ?? '');
        return email.endsWith('@company.com');
      },
      signIn(_input, ctx) {
        return ctx.ip !== '203.0.113.10';
      },
      refresh(_input, ctx) {
        return ctx.auth !== null;
      },
      mfaTotpEnroll(_input, ctx) {
        return ctx.auth?.custom?.plan === 'pro';
      },
    },
  },
});
```

If a rule returns `false`, the server rejects the request with `403 Forbidden`.

## Signature

```typescript
type AuthAccessRule = (
  input: Record<string, unknown> | null,
  ctx: {
    request?: Request;
    auth?: AuthContext | null;
    ip?: string;
  },
) => boolean | Promise<boolean>;
```

## What You Can Check

- `input`
  - Request payload for the current auth action
- `ctx.auth`
  - Current authenticated user if one exists
- `ctx.ip`
  - Client IP address
- `ctx.request`
  - Raw request object

## Supported Actions

| Action | Purpose |
| --- | --- |
| `signUp` | Email/password sign-up |
| `signIn` | Email/password sign-in |
| `signInAnonymous` | Anonymous sign-in |
| `signInMagicLink` | Request a magic link |
| `verifyMagicLink` | Complete magic link sign-in |
| `signInPhone` | Request phone OTP |
| `verifyPhoneOtp` | Complete phone OTP sign-in |
| `linkPhone` | Start phone linking |
| `verifyLinkPhone` | Complete phone linking |
| `signInEmailOtp` | Request email OTP |
| `verifyEmailOtp` | Complete email OTP sign-in |
| `mfaTotpEnroll` | Start TOTP enrollment |
| `mfaTotpVerify` | Confirm TOTP enrollment |
| `mfaVerify` | Complete MFA challenge |
| `mfaRecovery` | Complete MFA via recovery code |
| `mfaTotpDelete` | Disable TOTP |
| `mfaFactors` | List MFA factors |
| `requestPasswordReset` | Request password reset |
| `resetPassword` | Complete password reset |
| `verifyEmail` | Verify email |
| `changePassword` | Change password |
| `changeEmail` | Start email change |
| `verifyEmailChange` | Complete email change |
| `passkeysRegisterOptions` | Start passkey registration |
| `passkeysRegister` | Complete passkey registration |
| `passkeysAuthOptions` | Start passkey sign-in |
| `passkeysAuthenticate` | Complete passkey sign-in |
| `passkeysList` | List passkeys |
| `passkeysDelete` | Delete a passkey |
| `getMe` | Read current user profile |
| `updateProfile` | Update current user profile |
| `getSessions` | List current user sessions |
| `deleteSession` | Revoke one session |
| `getIdentities` | List linked identities |
| `deleteIdentity` | Remove a linked identity |
| `linkEmail` | Link email/password to an account |
| `oauthRedirect` | Start OAuth sign-in |
| `oauthCallback` | Complete OAuth sign-in |
| `oauthLinkStart` | Start OAuth linking |
| `oauthLinkCallback` | Complete OAuth linking |
| `refresh` | Refresh JWT session |
| `signOut` | Sign out |

## Examples

### Restrict Sign-Up Email Domains

```typescript
auth: {
  access: {
    signUp(input) {
      const email = String(input?.email ?? '');
      return email.endsWith('@company.com');
    },
  },
}
```

### Block Anonymous Sign-In By IP

```typescript
auth: {
  access: {
    signInAnonymous(_input, ctx) {
      return ctx.ip !== '203.0.113.10';
    },
  },
}
```

### Require An Authenticated User For Profile Actions

```typescript
auth: {
  access: {
    getMe(_input, ctx) {
      return ctx.auth !== null;
    },
    updateProfile(_input, ctx) {
      return ctx.auth !== null;
    },
    getSessions(_input, ctx) {
      return ctx.auth !== null;
    },
    signOut(_input, ctx) {
      return ctx.auth !== null;
    },
  },
}
```

### Gate MFA Enrollment By Plan

```typescript
auth: {
  access: {
    mfaTotpEnroll(_input, ctx) {
      return ctx.auth?.custom?.plan === 'pro';
    },
  },
}
```

## Default Behavior

- If a specific `auth.access.*` rule is **not** defined, that action is not blocked by `auth.access`.
- Built-in authentication requirements still apply:
  - session-protected routes still require a valid token
  - disabled users are still rejected
  - captcha, MFA, password policy, and provider configuration still apply

In other words, `auth.access` is an extra policy layer, not a replacement for the built-in auth flow checks.

## See Also

- [Authentication Triggers](/docs/authentication/hooks)
- [Authentication Delivery Hooks](/docs/functions/mail-hooks)
- [Captcha](/docs/authentication/captcha)
- [Ban & Disable](/docs/authentication/ban-disable)
- [Server Access Rules Reference](/docs/server/access-rules)
