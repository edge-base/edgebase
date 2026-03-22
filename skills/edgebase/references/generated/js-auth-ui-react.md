<!-- Generated from packages/sdk/js/packages/auth-ui-react/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase React Auth UI

Use this file as a quick-reference contract for AI coding assistants working with `@edge-base/auth-ui-react`.

## Package Boundary

Use `@edge-base/auth-ui-react` for React auth components in browser-oriented apps.

It must be paired with `@edge-base/web`. Do not pass an admin or SSR client to `AuthProvider`. Do not use this package for React Native.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/js/packages/auth-ui-react/README.md
- Authentication overview: https://edgebase.fun/docs/authentication
- Email/password: https://edgebase.fun/docs/authentication/email-password
- Magic link: https://edgebase.fun/docs/authentication/magic-link
- Email OTP: https://edgebase.fun/docs/authentication/email-otp
- MFA: https://edgebase.fun/docs/authentication/mfa
- Next.js guide: https://edgebase.fun/docs/sdks/nextjs

## Canonical Examples

### Basic provider setup

```tsx
import { createClient } from '@edge-base/web';
import { AuthProvider, AuthForm } from '@edge-base/auth-ui-react';
import '@edge-base/auth-ui-react/styles.css';

const client = createClient('https://your-project.edgebase.fun');

export function LoginScreen() {
  return (
    <AuthProvider client={client}>
      <AuthForm />
    </AuthProvider>
  );
}
```

### Provider with config

```tsx
<AuthProvider
  client={client}
  config={{
    providers: ['google', 'github'],
    defaultView: 'sign_in',
    magicLinkEnabled: true,
    emailOtpEnabled: true,
  }}
>
  <AuthForm onSuccess={() => navigate('/dashboard')} />
</AuthProvider>
```

### Read auth state

```tsx
import { useAuth } from '@edge-base/auth-ui-react';

function HeaderActions() {
  const { user, loading, signOut } = useAuth();

  if (loading) return <span>Loading...</span>;
  if (!user) return <a href="/login">Sign in</a>;

  return <button onClick={() => void signOut()}>Sign out</button>;
}
```

## Hard Rules

- `AuthProvider` requires a `client` created with `@edge-base/web`
- `useAuthContext()` must be used inside `<AuthProvider>`
- `useAuth()` returns `{ user, loading, signOut }`
- importing `@edge-base/auth-ui-react/styles.css` is optional, but available
- default `classPrefix` is `eb-auth`
- supported `defaultView` values are:
  - `sign_in`
  - `sign_up`
  - `magic_link`
  - `email_otp`
  - `phone_otp`
  - `forgot_password`
  - `reset_password`
  - `mfa_challenge`
  - `verify_email`

## Common Mistakes

- do not create a new EdgeBase client inside every render; create it once and pass it to `AuthProvider`
- do not pass `@edge-base/admin` or `@edge-base/ssr` clients to `AuthProvider`
- `AuthForm` returns `null` when a user is already signed in
- `useAuthContext()` throws if used outside the provider
- `onSuccess` is a UI callback; routing and redirect behavior are still your job
- OAuth provider buttons are configured through `config.providers`

## Quick Reference

```text
AuthProvider({ client, config?, children })        -> context provider
AuthForm({ onSuccess?, defaultView?, className? }) -> complete auth flow UI
useAuth()                                          -> { user, loading, signOut }
useAuthContext()                                   -> raw context, throws outside provider
```
