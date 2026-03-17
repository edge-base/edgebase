---
sidebar_position: 1
---

# Authentication API

Client-facing authentication endpoints for user signup, sign-in, session management, OAuth, and account operations.

## Base URL

```
https://your-project.edgebase.fun/api
```

## Authentication Header

Endpoints marked with **Auth: Bearer Token** require a valid access token:

```
Authorization: Bearer <accessToken>
```

---

## Sign Up

### `POST /api/auth/signup`

Create a new account with email and password. Returns the user object along with access and refresh tokens.

**Auth**: None (public)

| Request Body | Type     | Required | Description                              |
| ------------ | -------- | -------- | ---------------------------------------- |
| `email`      | string   | Yes      | Email address (automatically lowercased) |
| `password`   | string   | Yes      | Password (minimum 8 characters)          |
| `data`       | object   |          | Optional profile data (e.g., name)       |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secret123",
    "data": { "name": "Jane" }
  }'
```

**Response** `201`

```json
{
  "user": {
    "id": "01J...",
    "email": "user@example.com",
    "name": "Jane",
    "role": "user",
    "emailVerified": false,
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}
```

| Error                  | Status | Description                           |
| ---------------------- | ------ | ------------------------------------- |
| Email already registered | `409`  | An account with this email already exists |
| Password too short     | `400`  | Password is fewer than 8 characters   |
| Rate limited           | `429`  | Exceeded 10 requests per 60 seconds per IP |

---

## Sign In

### `POST /api/auth/signin`

Sign in with email and password.

**Auth**: None (public)

| Request Body | Type   | Required | Description |
| ------------ | ------ | -------- | ----------- |
| `email`      | string | Yes      | Email address |
| `password`   | string | Yes      | Password    |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret123"}'
```

**Response** `200` -- Same format as signup (`user`, `accessToken`, `refreshToken`)

| Error               | Status | Description                              |
| ------------------- | ------ | ---------------------------------------- |
| Invalid credentials | `401`  | Email or password is incorrect           |
| Rate limited        | `429`  | Exceeded 10 requests per 60 seconds per email |

---

## Anonymous Sign-In

### `POST /api/auth/signin/anonymous`

Sign in as an anonymous user. Requires `auth.anonymousAuth: true` in your EdgeBase configuration.

**Auth**: None (public)

**Request Body**: None (empty object `{}` or no body)

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/signin/anonymous \
  -H "Content-Type: application/json"
```

**Response** `201`

```json
{
  "user": {
    "id": "01J...",
    "email": null,
    "role": "user",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}
```

---

## Sign Out

### `POST /api/auth/signout`

End the current session. Only the session associated with the provided refresh token is invalidated.

**Auth**: None (identified by refresh token)

| Request Body    | Type   | Required | Description                          |
| --------------- | ------ | -------- | ------------------------------------ |
| `refreshToken`  | string | Yes      | The refresh token of the session to end |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/signout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "eyJhbG..."}'
```

**Response** `200`

```json
{ "ok": true }
```

---

## Refresh Token

### `POST /api/auth/refresh`

Refresh an expired access token. Uses token rotation with a 30-second grace period -- the old refresh token remains valid for 30 seconds after rotation to handle concurrent requests.

**Auth**: None (identified by refresh token)

| Request Body    | Type   | Required | Description            |
| --------------- | ------ | -------- | ---------------------- |
| `refreshToken`  | string | Yes      | Current refresh token  |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "eyJhbG..."}'
```

**Response** `200`

```json
{
  "accessToken": "eyJhbG...(new)",
  "refreshToken": "eyJhbG...(new)"
}
```

| Error                 | Status | Description                        |
| --------------------- | ------ | ---------------------------------- |
| Invalid/expired token | `401`  | Token is expired or already used   |

---

## Update Profile

### `PATCH /api/auth/profile`

Update the currently authenticated user's profile.

**Auth**: Bearer Token

| Request Body       | Type   | Required | Description                        |
| ------------------ | ------ | -------- | ---------------------------------- |
| `displayName`      | string |          | Display name                       |
| `avatarUrl`        | string |          | Profile image URL                  |
| `emailVisibility`  | string |          | `'public'` or `'private'`          |

```bash
curl -X PATCH https://your-project.edgebase.fun/api/auth/profile \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Updated Name",
    "avatarUrl": "https://example.com/photo.jpg",
    "emailVisibility": "public"
  }'
```

**Response** `200`

```json
{
  "user": {
    "id": "01J...",
    "email": "user@example.com",
    "displayName": "Updated Name",
    "avatarUrl": "https://example.com/photo.jpg",
    "emailVisibility": "public"
  }
}
```

---

## List Sessions

### `GET /api/auth/sessions`

List all active sessions for the currently authenticated user.

**Auth**: Bearer Token

```bash
curl https://your-project.edgebase.fun/api/auth/sessions \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200`

```json
{
  "sessions": [
    {
      "id": "session_1",
      "ip": "1.2.3.4",
      "userAgent": "Mozilla/5.0...",
      "createdAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "id": "session_2",
      "ip": "5.6.7.8",
      "userAgent": "EdgeBase-SDK/1.0",
      "createdAt": "2026-01-02T00:00:00.000Z"
    }
  ]
}
```

---

## Revoke Session

### `DELETE /api/auth/sessions/:id`

Revoke a specific session by its ID.

**Auth**: Bearer Token

| Path Parameter | Description      |
| -------------- | ---------------- |
| `id`           | The session ID to revoke |

```bash
curl -X DELETE https://your-project.edgebase.fun/api/auth/sessions/session_1 \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200`

```json
{ "ok": true }
```

---

## Change Password

### `POST /api/auth/change-password`

Change the current user's password. Requires the current password for verification.

**Auth**: Bearer Token

| Request Body      | Type   | Required | Description                      |
| ----------------- | ------ | -------- | -------------------------------- |
| `currentPassword` | string | Yes      | Current password                 |
| `newPassword`     | string | Yes      | New password (minimum 8 characters) |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/change-password \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword": "oldpass123", "newPassword": "newpass456"}'
```

**Response** `200`

```json
{
  "user": {
    "id": "01J...",
    "email": "user@example.com",
    "role": "user",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}
```

---

## Link Email to Anonymous Account

### `POST /api/auth/link/email`

Link an email and password to an existing anonymous account. After linking, the user can sign in with the email and password. New tokens are issued.

**Auth**: Bearer Token (anonymous account)

| Request Body | Type   | Required | Description                        |
| ------------ | ------ | -------- | ---------------------------------- |
| `email`      | string | Yes      | Email to link                      |
| `password`   | string | Yes      | Password to set (minimum 8 characters) |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/link/email \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret123"}'
```

**Response** `200` -- Includes new tokens (`user`, `accessToken`, `refreshToken`)

---

## Email OTP (Passwordless)

### `POST /api/auth/signin/email-otp`

Send a one-time code to an email address for passwordless sign-in.

**Auth**: None (public)

| Request Body | Type   | Required | Description       |
| ------------ | ------ | -------- | ----------------- |
| `email`      | string | Yes      | Email address     |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/signin/email-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

**Response** `200`

```json
{ "message": "OTP sent" }
```

In development mode (no email provider configured), the OTP code is included in the response:

```json
{ "message": "OTP sent", "code": "123456" }
```

### `POST /api/auth/verify-email-otp`

Verify the OTP code and create a session. Auto-creates a new user if the email is not registered (configurable via `auth.emailOtp.autoCreate`).

**Auth**: None (public)

| Request Body | Type   | Required | Description            |
| ------------ | ------ | -------- | ---------------------- |
| `email`      | string | Yes      | Email address          |
| `code`       | string | Yes      | 6-digit OTP code       |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/verify-email-otp \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "code": "123456"}'
```

**Response** `200`

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}
```

| Error               | Status | Description                                |
| ------------------- | ------ | ------------------------------------------ |
| Invalid/expired OTP | `400`  | Code is incorrect or expired (5-minute TTL) |
| Account disabled    | `403`  | User account has been disabled             |

---

## Change Email

### `POST /api/auth/change-email`

Request an email change. Requires re-authentication with the current password. A verification email is sent to the new address.

**Auth**: Bearer Token

| Request Body  | Type   | Required | Description            |
| ------------- | ------ | -------- | ---------------------- |
| `newEmail`    | string | Yes      | New email address      |
| `password`    | string | Yes      | Current password       |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/change-email \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"newEmail": "new@example.com", "password": "current_password"}'
```

**Response** `200`

```json
{ "message": "Verification email sent" }
```

| Error                  | Status | Description                           |
| ---------------------- | ------ | ------------------------------------- |
| Invalid password       | `401`  | Current password is incorrect         |
| Email already in use   | `409`  | The new email is already registered   |
| Rate limited           | `429`  | Exceeded 3 requests per user per hour |

### `POST /api/auth/verify-email-change`

Confirm the email change using the token received via email. The token is valid for 24 hours and is single-use.

**Auth**: None

| Request Body | Type   | Required | Description                           |
| ------------ | ------ | -------- | ------------------------------------- |
| `token`      | string | Yes      | Verification token from the email     |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/verify-email-change \
  -H "Content-Type: application/json" \
  -d '{"token": "token_from_email"}'
```

**Response** `200`

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG..."
}
```

| Error               | Status | Description                        |
| ------------------- | ------ | ---------------------------------- |
| Invalid/expired token | `400` | Token is expired (24h) or already used |
| Email already in use  | `409` | The new email was registered by another user since the request |

---

## Passkeys (WebAuthn)

### `POST /api/auth/passkeys/register-options`

Get WebAuthn registration challenge. The response contains the `PublicKeyCredentialCreationOptions` for the browser's `navigator.credentials.create()` call.

**Auth**: Bearer Token

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/passkeys/register-options \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json"
```

**Response** `200`

```json
{
  "options": {
    "challenge": "base64url-encoded-challenge",
    "rp": { "name": "My App", "id": "example.com" },
    "user": { "id": "...", "name": "user@example.com", "displayName": "User" },
    "pubKeyCredParams": [],
    "excludeCredentials": []
  }
}
```

### `POST /api/auth/passkeys/register`

Register a WebAuthn credential. Send the attestation response from `navigator.credentials.create()`.

**Auth**: Bearer Token

| Request Body | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| `response`   | object | Yes      | WebAuthn attestation response        |

**Response** `200`

```json
{ "credentialId": "base64url-encoded-credential-id" }
```

### `POST /api/auth/passkeys/auth-options`

Get WebAuthn authentication challenge. The response contains the `PublicKeyCredentialRequestOptions` for the browser's `navigator.credentials.get()` call.

**Auth**: None (public)

| Request Body | Type   | Required | Description                                |
| ------------ | ------ | -------- | ------------------------------------------ |
| `email`      | string |          | Optional -- narrows to user's credentials  |

**Response** `200`

```json
{
  "options": {
    "challenge": "base64url-encoded-challenge",
    "rpId": "example.com",
    "allowCredentials": [{ "id": "...", "transports": ["internal"] }],
    "userVerification": "preferred"
  }
}
```

### `POST /api/auth/passkeys/authenticate`

Authenticate with a passkey. Send the assertion response from `navigator.credentials.get()`.

**Auth**: None (public)

| Request Body | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| `response`   | object | Yes      | WebAuthn assertion response          |

**Response** `200`

```json
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "user": {
    "id": "01J...",
    "email": "user@example.com"
  }
}
```

### `GET /api/auth/passkeys`

List all registered passkeys for the authenticated user.

**Auth**: Bearer Token

```bash
curl https://your-project.edgebase.fun/api/auth/passkeys \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200`

```json
{
  "passkeys": [
    { "credentialId": "...", "createdAt": "2026-01-01T00:00:00.000Z" }
  ]
}
```

### `DELETE /api/auth/passkeys/:credentialId`

Delete a registered passkey.

**Auth**: Bearer Token

| Path Parameter   | Description                   |
| ---------------- | ----------------------------- |
| `credentialId`   | The credential ID to delete   |

```bash
curl -X DELETE https://your-project.edgebase.fun/api/auth/passkeys/credential-id-here \
  -H "Authorization: Bearer <accessToken>"
```

**Response** `200`

```json
{ "ok": true }
```

### Passkeys Configuration

Enable passkeys in `edgebase.config.ts`:

```typescript
auth: {
  passkeys: {
    enabled: true,
    rpName: 'My App',
    rpID: 'example.com',
    origin: 'https://example.com' // or array of origins
  }
}
```

| Option   | Type                 | Required | Description                                   |
| -------- | -------------------- | -------- | --------------------------------------------- |
| `enabled` | `boolean`           | Yes      | Enable WebAuthn/Passkeys                      |
| `rpName`  | `string`            | Yes      | Relying Party name (shown in authenticator UI) |
| `rpID`    | `string`            | Yes      | Your domain (e.g., `example.com`)             |
| `origin`  | `string \| string[]` | Yes      | Expected origin(s) for WebAuthn requests      |

---

## Start OAuth Flow

### `GET /api/auth/oauth/:provider`

Initiate an OAuth login flow. This endpoint redirects the user's browser to the OAuth provider's authorization page.

**Auth**: None

| Path Parameter | Description                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `provider`     | OAuth provider name: `google`, `github`, `apple`, `discord`, `microsoft`, `facebook`, `kakao`, `naver`, `x`, `line`, `slack`, `spotify`, `twitch` |

| Query Parameter | Description                                     |
| --------------- | ----------------------------------------------- |
| `redirect_url`  | URL to redirect to after authentication completes |

```
GET https://your-project.edgebase.fun/api/auth/oauth/google?redirect_url=https://myapp.com/callback
```

**Response**: `302` redirect to the OAuth provider's authorization page

---

## Link OAuth to Anonymous Account

### `POST /api/auth/oauth/link/:provider`

Start an OAuth account linking flow for the currently authenticated user. This initiates a redirect-based OAuth flow -- the server returns a URL that the client should open in a browser to complete the linking process. Works for both anonymous account upgrades and attaching an additional OAuth identity to an existing account.

**Auth**: Bearer Token

| Path Parameter | Description         |
| -------------- | ------------------- |
| `provider`     | OAuth provider name |

| Request Body  | Type   | Required | Description                                      |
| ------------- | ------ | -------- | ------------------------------------------------ |
| `redirectUrl` | string |          | URL to redirect to after OAuth flow completes     |
| `state`       | string |          | Optional state to pass through the OAuth redirect |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/oauth/link/google \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"redirectUrl": "https://myapp.com/callback"}'
```

**Response** `200`

```json
{
  "redirectUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

The client should redirect the user to the returned `redirectUrl`. After the user completes authorization with the OAuth provider, they will be redirected to the link callback endpoint (`/api/auth/oauth/link/:provider/callback`), which handles the token exchange and account linking. If a `redirectUrl` was provided, the user is then redirected there with `access_token` and `refresh_token` as query parameters.

---

## Verify Email

### `POST /api/auth/verify-email`

Verify a user's email address using the token sent via email.

**Auth**: None

| Request Body | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| `token`      | string | Yes      | Verification token from the email    |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"token": "verification-token-here"}'
```

**Response** `200`

```json
{ "ok": true, "message": "Email verified." }
```

---

## Request Password Reset

### `POST /api/auth/request-password-reset`

Send a password reset email. This endpoint always returns a success response regardless of whether the email exists, to prevent email enumeration.

**Auth**: None

| Request Body | Type   | Required | Description          |
| ------------ | ------ | -------- | -------------------- |
| `email`      | string | Yes      | Account email address |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/request-password-reset \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

**Response** `200` (always, regardless of whether the email exists)

```json
{ "ok": true, "message": "If the email exists, a reset link has been sent." }
```

---

## Reset Password

### `POST /api/auth/reset-password`

Reset a user's password using the token received via email.

**Auth**: None

| Request Body  | Type   | Required | Description                        |
| ------------- | ------ | -------- | ---------------------------------- |
| `token`       | string | Yes      | Password reset token from the email |
| `newPassword` | string | Yes      | New password (minimum 8 characters) |

```bash
curl -X POST https://your-project.edgebase.fun/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token": "reset-token-here", "newPassword": "newpass456"}'
```

**Response** `200`

```json
{ "ok": true }
```

---

## Error Format

All error responses follow this structure:

```json
{
  "code": 400,
  "message": "Validation failed.",
  "data": {
    "email": { "code": "invalid_format", "message": "Invalid email format." }
  }
}
```

| HTTP Status | Meaning                              |
| ----------- | ------------------------------------ |
| `400`       | Bad request / validation error       |
| `401`       | Authentication required or failed    |
| `409`       | Conflict (e.g., email already exists) |
| `429`       | Rate limit exceeded                  |
