---
sidebar_position: 4
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Passkeys (WebAuthn)

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Sign in with biometrics, hardware security keys, or platform authenticators. EdgeBase implements the WebAuthn standard using [SimpleWebAuthn](https://simplewebauthn.dev/) on the server side, with a full registration and authentication flow.

:::info Browser/Platform Required
Passkeys require a WebAuthn-capable environment (modern browsers, iOS 16+, Android 9+). The SDK provides the REST API layer; you use the browser's `navigator.credentials` API or a native WebAuthn library to handle the actual credential ceremony.
:::

## How It Works

1. **Register**: Authenticated user requests registration options, creates a credential via the platform authenticator, and sends the attestation back to the server
2. **Authenticate**: User requests authentication options, signs the challenge via their passkey, and sends the assertion back. The server verifies and creates a session
3. **Manage**: Users can list their registered passkeys and delete individual ones

## Configuration

Enable passkeys in your `edgebase.config.ts`:

```typescript
// edgebase.config.ts
export default defineConfig({
  auth: {
    passkeys: {
      enabled: true,
      rpName: 'My App',              // Displayed in authenticator UI
      rpID: 'example.com',           // Your domain (no protocol, no port)
      origin: 'https://example.com', // Expected origin(s) for WebAuthn requests
    },
  },
});
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Enable WebAuthn/Passkeys |
| `rpName` | `string` | Yes | Relying Party name shown in the authenticator prompt |
| `rpID` | `string` | Yes | Relying Party ID — typically your domain (e.g., `example.com`) |
| `origin` | `string \| string[]` | Yes | Expected origin(s) for WebAuthn requests (e.g., `https://example.com`). Use an array for multiple origins (web + mobile) |

**Local development example:**

```typescript
passkeys: {
  enabled: true,
  rpName: 'My App (Dev)',
  rpID: 'localhost',
  origin: 'http://localhost:3000',
},
```

## Registration Flow

Registration adds a new passkey to an already-authenticated user's account. The user must be signed in first (via email/password, OAuth, etc.).

### Step 1: Get Registration Options

Request WebAuthn registration options from the server. The server generates a challenge and returns parameters for the browser's `navigator.credentials.create()` call.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// 1. Get registration options from EdgeBase
const res = await fetch('/api/auth/passkeys/register-options', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  },
});
const { options } = await res.json();

// 2. Create credential using the browser WebAuthn API
// (use @simplewebauthn/browser for convenience)
import { startRegistration } from '@simplewebauthn/browser';
const credential = await startRegistration(options);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Use ASAuthorizationPlatformPublicKeyCredentialProvider for iOS 16+
// 1. Fetch registration options from /api/auth/passkeys/register-options
// 2. Use the options to create an ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest
// 3. Present via ASAuthorizationController
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// Use Android Credential Manager API (Android 9+)
// 1. Fetch registration options from /api/auth/passkeys/register-options
// 2. Create a CreatePublicKeyCredentialRequest with the options
// 3. Call credentialManager.createCredential(context, request)
```

</TabItem>
</Tabs>

### Step 2: Register the Credential

Send the credential response back to the server for verification and storage.

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// 3. Send the credential to EdgeBase for verification
const registerRes = await fetch('/api/auth/passkeys/register', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ response: credential }),
});
const { credentialId } = await registerRes.json();
// Passkey registered successfully
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Send the ASAuthorizationPlatformPublicKeyCredentialRegistration response
// to POST /api/auth/passkeys/register with the attestation object
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// Send the CreatePublicKeyCredentialResponse
// to POST /api/auth/passkeys/register with the attestation response
```

</TabItem>
</Tabs>

## Authentication Flow

Authentication allows a user to sign in using a registered passkey instead of a password.

### Step 1: Get Authentication Options

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// 1. Request authentication options (public endpoint, no auth required)
const res = await fetch('/api/auth/passkeys/auth-options', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com' }), // optional — narrows to user's credentials
});
const { options } = await res.json();

// 2. Get assertion from the browser
import { startAuthentication } from '@simplewebauthn/browser';
const assertion = await startAuthentication(options);
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Use ASAuthorizationPlatformPublicKeyCredentialAssertionRequest
// 1. Fetch auth options from POST /api/auth/passkeys/auth-options
// 2. Present assertion request via ASAuthorizationController
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// Use Android Credential Manager
// 1. Fetch auth options from POST /api/auth/passkeys/auth-options
// 2. Create GetPublicKeyCredentialOption and call credentialManager.getCredential()
```

</TabItem>
</Tabs>

### Step 2: Authenticate

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
// 3. Send the assertion to EdgeBase
const authRes = await fetch('/api/auth/passkeys/authenticate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ response: assertion }),
});
const { accessToken, refreshToken, user } = await authRes.json();
// User is now signed in via passkey
```

</TabItem>
<TabItem value="swift" label="Swift">

```swift
// Send the ASAuthorizationPlatformPublicKeyCredentialAssertion response
// to POST /api/auth/passkeys/authenticate
// Returns accessToken, refreshToken, user
```

</TabItem>
<TabItem value="kotlin" label="Kotlin">

```kotlin
// Send the GetPublicKeyCredentialResponse
// to POST /api/auth/passkeys/authenticate
// Returns accessToken, refreshToken, user
```

</TabItem>
</Tabs>

## Managing Passkeys

### List Registered Passkeys

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
const res = await fetch('/api/auth/passkeys', {
  headers: { 'Authorization': `Bearer ${accessToken}` },
});
const { passkeys } = await res.json();
// passkeys: [{ id, credentialId, transports, createdAt }, ...]
```

</TabItem>
</Tabs>

### Delete a Passkey

<Tabs groupId="sdk-language">
<TabItem value="js" label="JavaScript" default>

```typescript
await fetch(`/api/auth/passkeys/${encodeURIComponent(credentialId)}`, {
  method: 'DELETE',
  headers: { 'Authorization': `Bearer ${accessToken}` },
});
```

</TabItem>
</Tabs>

## REST API

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/passkeys/register-options` | Required | Generate WebAuthn registration options |
| `POST` | `/auth/passkeys/register` | Required | Verify attestation and store credential |
| `POST` | `/auth/passkeys/auth-options` | Public | Generate WebAuthn authentication options |
| `POST` | `/auth/passkeys/authenticate` | Public | Verify assertion and create session |
| `GET` | `/auth/passkeys` | Required | List passkeys for the authenticated user |
| `DELETE` | `/auth/passkeys/:credentialId` | Required | Delete a passkey |

### Request/Response Examples

**POST /auth/passkeys/register-options**

```json
// Response
{
  "options": {
    "challenge": "base64url-encoded-challenge",
    "rp": { "name": "My App", "id": "example.com" },
    "user": { "id": "...", "name": "user@example.com", "displayName": "User" },
    "pubKeyCredParams": [...],
    "excludeCredentials": [...]
  }
}
```

**POST /auth/passkeys/register**

```json
// Request
{ "response": { /* WebAuthn attestation response from navigator.credentials.create() */ } }

// Response
{ "credentialId": "base64url-encoded-credential-id" }
```

**POST /auth/passkeys/auth-options**

```json
// Request (email is optional)
{ "email": "user@example.com" }

// Response
{
  "options": {
    "challenge": "base64url-encoded-challenge",
    "rpId": "example.com",
    "allowCredentials": [{ "id": "...", "transports": ["internal"] }],
    "userVerification": "preferred"
  }
}
```

**POST /auth/passkeys/authenticate**

```json
// Request
{ "response": { /* WebAuthn assertion response from navigator.credentials.get() */ } }

// Response
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id": "...", "email": "user@example.com", ... }
}
```

## Architecture Notes

- **Credential storage**: WebAuthn credentials (public key, counter, transports) are stored in D1 (AUTH_DB) in the `_webauthn_credentials` table
- **D1 index**: A `_passkey_index` table in D1 maps `credentialId` to `userId`, enabling credential lookup during authentication
- **Challenge management**: Registration and authentication challenges are stored in KV with a 5-minute TTL and are single-use (deleted after verification)
- **PKCE-like flow**: The server generates challenges and the client proves possession of the private key, similar to the OAuth PKCE pattern

## Discoverable Credentials

If you call `/auth/passkeys/auth-options` without providing an `email`, the server generates options without `allowCredentials` restrictions. This enables **discoverable credential** (resident key) flows where the authenticator presents all available passkeys for the relying party, and the user selects which one to use.

## Recommended Client Libraries

| Platform | Library |
|----------|---------|
| Web (JavaScript) | [@simplewebauthn/browser](https://www.npmjs.com/package/@simplewebauthn/browser) |
| iOS (Swift) | `AuthenticationServices` framework (built-in, iOS 16+) |
| Android (Kotlin) | [Credential Manager](https://developer.android.com/identity/sign-in/credential-manager) |
