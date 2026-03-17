---
sidebar_position: 21
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Auth Error Codes

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Complete reference for all authentication error codes returned by EdgeBase.

## Error Response Format

All authentication errors return a consistent JSON structure:

```json
{
  "code": 401,
  "message": "Invalid credentials.",
  "slug": "invalid-credentials",
  "data": {}
}
```

| Field     | Type     | Description                                                              |
| --------- | -------- | ------------------------------------------------------------------------ |
| `code`    | `number` | HTTP status code (400, 401, 403, 404, 409, 429, 500, 503)               |
| `message` | `string` | Human-readable description of the error                                  |
| `slug`    | `string` | _(Optional)_ Semantic error identifier for programmatic handling (e.g., `invalid-credentials`) |
| `data`    | `object` | _(Optional)_ Additional context (e.g., `{ "captcha_required": true }`)   |

:::note Auth middleware 401 responses
Auth middleware responses (token expired, invalid token, auth not configured) return an `error` field instead of `slug`. For example: `{ "error": "Token expired" }`. When handling 401 errors, check for the `error` field in addition to `slug`.
:::

:::tip Use `slug` for programmatic error handling
The `slug` field provides a stable, machine-readable identifier for each error type. Unlike `message` (which may change across versions or locales), `slug` values are part of the public API contract and safe to match on in application code. See the [SDK Error Handling](#sdk-error-handling) section for examples.
:::

---

## Sign Up Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `invalid-input` | `Email and password are required.` | Missing email or password field in request body | Show form validation — highlight empty fields |
| 400 | `invalid-email` | `Invalid email format...` | Email fails format validation | Show email-specific validation message |
| 400 | `password-too-short` | `Password must be at least 8 characters.` | Password shorter than 8 characters | Show password requirements hint |
| 409 | `email-already-exists` | `Email already registered.` | An account with this email already exists | Suggest signing in or resetting password |
| 429 | `rate-limited` | `Too many signup attempts...` | Signup rate limit exceeded | Show retry timer with countdown |
| 403 | `hook-rejected` | `Auth hook 'beforeSignUp' rejected the operation.` | `beforeSignUp` hook returned a rejection | Display hook's custom message if provided |

---

## Sign In Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `invalid-input` | `Email and password are required.` | Missing email or password field | Show form validation |
| 401 | `invalid-credentials` | `Invalid credentials.` | Wrong email or wrong password | Show generic error — do not reveal which field is incorrect |
| 403 | `oauth-only` | `This account uses OAuth sign-in. Password login is not available.` | User registered via OAuth, not email/password | Redirect user to the appropriate OAuth provider |
| 403 | `hook-rejected` | `Auth hook 'beforeSignIn' rejected the operation.` | `beforeSignIn` hook returned a rejection | Display hook's custom message if provided |
| 429 | `rate-limited` | `Too many login attempts...` | Sign-in rate limit exceeded (per email) | Show retry timer with countdown |

---

## OAuth Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `validation-failed` | `Unsupported OAuth provider: {provider}` | Provider name not recognized | Check provider name spelling |
| 400 | `feature-not-enabled` | `OAuth provider {provider} is not enabled.` | Provider not listed in `allowedOAuthProviders` config | Enable provider in server config |
| 500 | `internal-error` | `OAuth provider {provider} is not configured.` | Missing `clientId` or `clientSecret` env vars | Set required environment variables |
| 400 | `validation-failed` | `OAuth error: {description}` | OAuth provider returned an error in callback | Display the provider's error description |
| 400 | `validation-failed` | `Missing code or state parameter.` | Callback URL missing required query params | Restart the OAuth flow |
| 400 | `invalid-token` | `Invalid or expired OAuth state.` | State token expired (5 min TTL) or CSRF mismatch | Restart the OAuth flow |
| 400 | `validation-failed` | `OAuth state provider mismatch.` | State token was issued for a different provider | Restart the OAuth flow with the correct provider |
| 409 | `already-exists` | `This OAuth account is already linked to another user.` | OAuth identity already associated with a different account | Sign in with the linked account instead |
| 409 | `email-already-exists` | `Email is already registered to another account.` | Email from OAuth provider conflicts with existing account | Link accounts or sign in with existing account |

---

## Anonymous Auth Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 404 | `feature-not-enabled` | `Anonymous authentication is not enabled.` | `anonymousAuth` is disabled in server config | Enable anonymous auth in config or use a different auth method |

---

## Session & Token Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `invalid-input` | `Refresh token is required.` | Missing refresh token in request body | Re-authenticate the user |
| 401 | `invalid-refresh-token` | `Invalid refresh token.` | JWT decoding failed — malformed or tampered token | Clear stored tokens and re-authenticate |
| 401 | `refresh-token-expired` | `Refresh token expired.` | Token TTL exceeded | Clear stored tokens and re-authenticate |
| 401 | `refresh-token-reused` | `Refresh token reuse detected. Session revoked.` | A previously used refresh token was replayed — **possible token theft**. The affected session is revoked | Clear stored tokens and force full re-authentication |
| 401 | `unauthenticated` | `Authentication required.` | Missing or invalid `Authorization` header | Redirect to sign-in page |

:::danger Refresh Token Reuse Detection
When EdgeBase detects a refresh token being used more than once, it assumes the token was stolen. **The affected session is immediately revoked** as a security measure. The user will need to sign in again on that device.
:::

---

## Email Verification Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `invalid-input` | `Verification token is required.` | Missing token in request | Check the verification URL format |
| 400 | `invalid-token` | `Invalid or expired verification token.` | Token not found in the database | Request a new verification email |
| 400 | `token-expired` | `Verification token has expired. Please request a new one.` | Token TTL exceeded (24 hours) | Prompt user to request a new verification email |

---

## Password Reset Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `invalid-input` | `Email is required.` | Missing email in reset request | Show form validation |
| 400 | `invalid-input` | `Password reset token is required.` | Missing token in reset confirmation | Check the reset URL format |
| 400 | `invalid-input` | `New password is required.` | Missing new password in reset confirmation | Show form validation |
| 400 | `password-too-short` | `Password must be at least 8 characters.` | New password too short | Show password requirements |
| 400 | `invalid-token` | `Invalid or expired password reset token.` | Token not found in the database | Request a new password reset email |
| 400 | `token-expired` | `Password reset token has expired. Please request a new one.` | Token TTL exceeded (1 hour) | Prompt user to request a new reset email |
| 403 | `hook-rejected` | `Password reset was blocked by the beforePasswordReset hook.` | `beforePasswordReset` hook returned a rejection | Display hook's custom message if provided |

---

## Change Password Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `invalid-input` | `currentPassword and newPassword are required.` | Missing current or new password | Show form validation |
| 400 | `password-too-short` | `Password must be at least 8 characters.` | New password too short | Show password requirements |
| 401 | `invalid-password` | `Current password is incorrect.` | Wrong current password entered | Prompt user to re-enter current password |
| 403 | `oauth-only` | `This account uses OAuth sign-in. Password login is not available.` | Account was created via OAuth — no password set | Password change is not applicable for OAuth accounts |
| 403 | `anonymous-not-allowed` | `Anonymous accounts cannot change password.` | Anonymous user attempted password change | Link account with email first via [account linking](/docs/authentication/account-linking) |

---

## Account Linking Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `invalid-input` | `Email and password are required.` | Missing fields when linking with email/password | Show form validation |
| 400 | `password-too-short` | `Password must be at least 8 characters.` | Weak password during email link | Show password requirements |
| 400 | `action-not-allowed` | `Account linking is not allowed for this account type.` | Account linking rejected based on account state or configuration | Check the account type and linking requirements |
| 409 | `email-already-exists` | `Email is already registered.` | Email already in use by another account | Suggest signing in with that email instead |
| 409 | `already-exists` | `This OAuth account is already linked.` | OAuth identity already associated with another account | Sign in with the linked account instead |

---

## Profile Update Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 400 | `invalid-input` | `emailVisibility must be 'public' or 'private'.` | Invalid value for `emailVisibility` field | Use only `'public'` or `'private'` |
| 400 | `no-fields-to-update` | `No valid fields to update...` | Request body contains no recognized fields | Check available profile fields in the docs |

---

## Admin API Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 403 | `forbidden` | `Service Key required for admin auth operations.` | Admin endpoint called without a Service Key | Include the Service Key in the request header |
| 401 | `unauthenticated` | `Unauthorized. Service Key required.` | Invalid or expired Service Key provided | Verify your Service Key in server config |
| 404 | `user-not-found` | `User not found.` | User ID does not exist in the database | Verify the user ID before retrying |

---

## Captcha Errors

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 403 | `forbidden` | `Captcha verification required.` | Captcha is enabled but no token was provided. Response includes `data.captcha_required: true` | Render captcha widget and retry with the token |
| 403 | `forbidden` | `Captcha verification failed.` | Captcha token is invalid or expired | Reset captcha widget and prompt user to retry |
| 503 | `internal-error` | `Captcha service unavailable.` | Cloudflare Turnstile API is unreachable and `failMode` is `closed` | Show a temporary error and retry after a delay |

:::tip Captcha `data` field
When captcha verification is required, the error response includes extra context:
```json
{
  "code": 403,
  "message": "Captcha verification required.",
  "data": { "captcha_required": true }
}
```
Use the `data.captcha_required` flag to programmatically detect when to render the captcha widget.
:::

---

## Rate Limiting

| Status | Slug | Message | When | Handling |
| ------ | ---- | ------- | ---- | -------- |
| 429 | `rate-limited` | `Too many requests. Try again later.` | Global rate limit exceeded | Back off and retry after a delay |
| 429 | `rate-limited` | `Too many signup attempts...` | Signup-specific rate limit exceeded | Show retry timer |
| 429 | `rate-limited` | `Too many login attempts...` | Sign-in-specific rate limit exceeded (per email) | Show retry timer |

:::info Rate Limit Strategy
Sign-in rate limits are tracked **per email address** to prevent brute-force attacks against specific accounts while not affecting other users.
:::

---

## SDK Error Handling

All EdgeBase client SDKs throw structured errors that include the `code`, `message`, and `slug` fields from the server response. The `slug` field is the recommended way to handle errors programmatically -- it is stable across versions and locales, unlike `message` which may change.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
try {
  const { user } = await client.auth.signIn({
    email: 'user@example.com',
    password: 'wrongPassword',
  });
} catch (error) {
  // Recommended: match on slug for stable, locale-independent handling
  switch (error.slug) {
    case 'invalid-credentials':
      showError('Email or password is incorrect.');
      break;
    case 'rate-limited':
      showError('Too many attempts. Please try again later.');
      break;
    case 'oauth-only':
      redirectToOAuth();
      break;
    case 'account-disabled':
      showError('Your account has been disabled.');
      break;
    case 'hook-rejected':
      showError(error.message); // Display hook's custom message
      break;
    default:
      // Fall back to data field for captcha handling
      if (error.data?.captcha_required) {
        showCaptcha();
      } else {
        showError(error.message);
      }
  }
}
```

</TabItem>
<TabItem value="dart" label="Dart/Flutter">

```dart
try {
  final result = await client.auth.signIn(
    email: 'user@example.com',
    password: 'wrongPassword',
  );
} on EdgeBaseError catch (error) {
  switch (error.slug) {
    case 'invalid-credentials':
      showError('Email or password is incorrect.');
      break;
    case 'rate-limited':
      showError('Too many attempts. Please try again later.');
      break;
    case 'oauth-only':
      redirectToOAuth();
      break;
    case 'account-disabled':
      showError('Your account has been disabled.');
      break;
    default:
      if (error.data?['captcha_required'] == true) {
        showCaptcha();
      } else {
        showError(error.message);
      }
  }
}
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
do {
    let result = try await client.auth.signIn(
        email: "user@example.com",
        password: "wrongPassword"
    )
} catch let error as EdgeBaseError {
    switch error.slug {
    case "invalid-credentials":
        showError("Email or password is incorrect.")
    case "rate-limited":
        showError("Too many attempts. Please try again later.")
    case "oauth-only":
        redirectToOAuth()
    case "account-disabled":
        showError("Your account has been disabled.")
    default:
        if error.data?["captcha_required"] as? Bool == true {
            showCaptcha()
        } else {
            showError(error.message)
        }
    }
}
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
try {
    val result = client.auth.signIn(
        email = "user@example.com",
        password = "wrongPassword"
    )
} catch (error: EdgeBaseError) {
    when (error.slug) {
        "invalid-credentials" -> {
            showError("Email or password is incorrect.")
        }
        "rate-limited" -> {
            showError("Too many attempts. Please try again later.")
        }
        "oauth-only" -> {
            redirectToOAuth()
        }
        "account-disabled" -> {
            showError("Your account has been disabled.")
        }
        else -> {
            if (error.data?.get("captcha_required") == true) {
                showCaptcha()
            } else {
                showError(error.message)
            }
        }
    }
}
```

</TabItem>
<TabItem value="java" label="Java">

```java
try {
    Map<String, Object> result = client.auth().signIn("user@example.com", "wrongPassword");
} catch (EdgeBaseException error) {
    switch (error.getSlug()) {
        case "invalid-credentials":
            showError("Email or password is incorrect.");
            break;
        case "rate-limited":
            showError("Too many attempts. Please try again later.");
            break;
        case "oauth-only":
            redirectToOAuth();
            break;
        case "account-disabled":
            showError("Your account has been disabled.");
            break;
        default:
            if (Boolean.TRUE.equals(error.getData().get("captcha_required"))) {
                showCaptcha();
            } else {
                showError(error.getMessage());
            }
            break;
    }
}
```

</TabItem>
<TabItem value="csharp" label="C#">

```csharp
try
{
    var result = await client.Auth.SignInAsync("user@example.com", "wrongPassword");
}
catch (EdgeBaseException error)
{
    switch (error.Slug)
    {
        case "invalid-credentials":
            ShowError("Email or password is incorrect.");
            break;
        case "rate-limited":
            ShowError("Too many attempts. Please try again later.");
            break;
        case "oauth-only":
            RedirectToOAuth();
            break;
        case "account-disabled":
            ShowError("Your account has been disabled.");
            break;
        default:
            if (error.Data?.ContainsKey("captcha_required") == true)
            {
                ShowCaptcha();
            }
            else
            {
                ShowError(error.Message);
            }
            break;
    }
}
```

</TabItem>
<TabItem value="cpp" label="C++">

```cpp
try {
    auto result = client.auth().signIn("user@example.com", "wrongPassword");
} catch (const edgebase::Error& error) {
    auto slug = error.slug();
    if (slug == "invalid-credentials") {
        showError("Email or password is incorrect.");
    } else if (slug == "rate-limited") {
        showError("Too many attempts. Please try again later.");
    } else if (slug == "oauth-only") {
        redirectToOAuth();
    } else if (slug == "account-disabled") {
        showError("Your account has been disabled.");
    } else {
        showError(error.message());
    }
}
```

</TabItem>
</Tabs>

---

## Quick Reference by Status Code

| Status | Meaning | Common Slugs | Common Causes |
| ------ | ------- | ------------ | ------------- |
| **400** | Bad Request | `invalid-input`, `validation-failed`, `invalid-email`, `password-too-short`, `invalid-token`, `token-expired` | Missing required fields, invalid format, expired tokens |
| **401** | Unauthorized | `invalid-credentials`, `unauthenticated`, `invalid-refresh-token`, `refresh-token-expired`, `refresh-token-reused` | Invalid credentials, expired/invalid tokens, missing auth header |
| **403** | Forbidden | `hook-rejected`, `oauth-only`, `anonymous-not-allowed`, `account-disabled`, `forbidden` | Hook rejections, OAuth-only accounts, captcha required, anonymous restrictions |
| **404** | Not Found | `user-not-found`, `feature-not-enabled` | User not found, feature not enabled |
| **409** | Conflict | `email-already-exists`, `already-exists` | Duplicate email, OAuth account already linked |
| **429** | Too Many Requests | `rate-limited` | Rate limits (global, signup, or signin) |
| **500** | Internal Server Error | `internal-error` | Missing OAuth provider configuration |
| **503** | Service Unavailable | `internal-error` | External service unreachable (e.g., Turnstile API) |

---

## All Error Slugs

A complete list of well-known error slugs used across the authentication API:

| Slug | Status | Description |
| ---- | ------ | ----------- |
| `invalid-input` | 400 | Input validation failure in auth routes (missing fields, bad format) |
| `validation-failed` | 400 | Input validation failure in OAuth and admin routes |
| `invalid-email` | 400 | Email format validation failed |
| `password-too-short` | 400 | Password shorter than minimum length (8 characters) |
| `password-too-long` | 400 | Password exceeds maximum length (256 characters) |
| `invalid-token` | 400 | Token is malformed or not found |
| `token-expired` | 400 | Token has exceeded its TTL |
| `no-fields-to-update` | 400 | No recognized fields in the update request body |
| `invalid-otp` | 400 | OTP code is invalid or expired |
| `unauthenticated` | 401 | Missing or invalid authorization header |
| `invalid-credentials` | 401 | Wrong email or password during sign-in |
| `invalid-password` | 401 | Wrong current password during password change |
| `invalid-refresh-token` | 401 | Refresh token is malformed or tampered |
| `refresh-token-expired` | 401 | Refresh token TTL exceeded |
| `refresh-token-reused` | 401 | Refresh token replayed (possible theft -- all sessions revoked) |
| `forbidden` | 403 | General access denied |
| `oauth-only` | 403 | Account uses OAuth -- password operations not available |
| `anonymous-not-allowed` | 403 | Anonymous accounts cannot perform this action |
| `account-disabled` | 403 | Account has been disabled by an administrator |
| `hook-rejected` | 403 | Auth hook rejected the operation |
| `action-not-allowed` | 403 | Requested auth action is not allowed by config |
| `user-not-found` | 404 | User ID does not exist |
| `feature-not-enabled` | 404 | Requested feature is not enabled in server config |
| `email-already-exists` | 409 | Email already registered to another account |
| `already-exists` | 409 | Resource already exists (OAuth link, etc.) |
| `rate-limited` | 429 | Too many requests -- back off and retry |
| `internal-error` | 500 | Internal server error |
