<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

<h1 align="center">@edge-base/auth-ui-react</h1>

<p align="center">
  <b>Pre-built React authentication UI for EdgeBase</b><br>
  Drop in a provider, forms, and auth helpers on top of the EdgeBase web client
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@edge-base/auth-ui-react"><img src="https://img.shields.io/npm/v/%40edge-base%2Fauth-ui-react?color=brightgreen" alt="npm"></a>&nbsp;
  <a href="https://edgebase.fun/docs/authentication"><img src="https://img.shields.io/badge/docs-auth-blue" alt="Docs"></a>&nbsp;
  <a href="https://github.com/edge-base/edgebase/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  React · Vite · Next.js · SPA auth flows · Email/password · OAuth · MFA
</p>

<p align="center">
  <a href="https://edgebase.fun/docs/authentication"><b>Authentication</b></a> ·
  <a href="https://edgebase.fun/docs/authentication/email-password"><b>Email/Password</b></a> ·
  <a href="https://edgebase.fun/docs/authentication/magic-link"><b>Magic Link</b></a> ·
  <a href="https://edgebase.fun/docs/authentication/mfa"><b>MFA</b></a> ·
  <a href="https://edgebase.fun/docs/sdks/nextjs"><b>Next.js Guide</b></a>
</p>

---

`@edge-base/auth-ui-react` adds ready-to-use React auth components on top of [`@edge-base/web`](https://www.npmjs.com/package/@edge-base/web).

It is a good fit when you want:

- a working sign-in and sign-up UI quickly
- OAuth, magic link, OTP, and MFA flows without rebuilding every screen
- a headless-first component set that still ships a default stylesheet
- a simple auth context and `useAuth()` hook for the current user

This package is for React in browser-oriented apps. It is not the admin SDK, and it is not a React Native package.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

> Beta: the package is already usable, but some APIs and components may still evolve before general availability.

## Documentation Map

- [Authentication Overview](https://edgebase.fun/docs/authentication)
  Core auth concepts and flow selection
- [Email/Password](https://edgebase.fun/docs/authentication/email-password)
  Standard credential sign-in flows
- [Magic Link](https://edgebase.fun/docs/authentication/magic-link)
  Passwordless email flows
- [Email OTP](https://edgebase.fun/docs/authentication/email-otp)
  One-time code flows
- [MFA](https://edgebase.fun/docs/authentication/mfa)
  Multi-factor authentication setup and verification
- [Next.js Integration](https://edgebase.fun/docs/sdks/nextjs)
  Example integration in a full React framework

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted React auth integration.

You can find it:

- after install: `node_modules/@edge-base/auth-ui-react/llms.txt`
- in the repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/js/packages/auth-ui-react/llms.txt)

Use it when you want an agent to:

- wrap the app with `AuthProvider` correctly
- pair this package with `@edge-base/web` instead of `admin` or `ssr`
- choose between `AuthForm`, individual components, and `useAuth()`
- avoid guessing config field names or default views

## Installation

```bash
npm install @edge-base/web @edge-base/auth-ui-react
```

Make sure your app already has React and React DOM.

## Quick Start

```tsx
import { createClient } from '@edge-base/web';
import { AuthProvider, AuthForm } from '@edge-base/auth-ui-react';
import '@edge-base/auth-ui-react/styles.css';

const client = createClient('https://your-project.edgebase.fun');

export function LoginScreen() {
  return (
    <AuthProvider
      client={client}
      config={{
        providers: ['google', 'github'],
        magicLinkEnabled: true,
      }}
    >
      <AuthForm onSuccess={() => window.location.assign('/dashboard')} />
    </AuthProvider>
  );
}
```

## Core Building Blocks

| Export | Use it for |
| --- | --- |
| `AuthProvider` | Provide the EdgeBase web client and shared UI config |
| `AuthForm` | A full auth flow wrapper that switches between common views |
| `SignIn`, `SignUp` | Individual credential screens |
| `SocialButtons` | OAuth provider buttons |
| `MagicLink`, `EmailOTP`, `PhoneOTP` | Alternative sign-in flows |
| `ForgotPassword`, `MFAChallenge` | Recovery and multi-factor flows |
| `useAuth()` | Read the current user, loading state, and sign out |
| `useAuthContext()` | Access the raw provider context when building custom UI |

## Auth Context

If you want your own UI while still using the provided auth state hook:

```tsx
import { useAuth } from '@edge-base/auth-ui-react';

function HeaderActions() {
  const { user, loading, signOut } = useAuth();

  if (loading) return <span>Loading...</span>;
  if (!user) return <a href="/login">Sign in</a>;

  return (
    <button onClick={() => void signOut()}>
      Sign out {user.displayName ?? user.email}
    </button>
  );
}
```

## Configuration

`AuthProvider` accepts a `config` object for common flow choices:

- `providers`
- `defaultView`
- `showForgotPassword`
- `showToggle`
- `oauthRedirectUrl`
- `magicLinkEnabled`
- `emailOtpEnabled`
- `phoneOtpEnabled`
- `classPrefix`
- `localization`

The default `classPrefix` is `eb-auth`.

## Styling

You have two good options:

1. import the default stylesheet:

```tsx
import '@edge-base/auth-ui-react/styles.css';
```

2. keep the components headless-first and target the generated CSS classes using your own design system

The generated classes use the configured prefix, so the default form class names look like `eb-auth-form`, `eb-auth-button`, and `eb-auth-error`.

## Choose The Right Package

| Package | Use it for |
| --- | --- |
| `@edge-base/web` | The underlying browser SDK and auth client |
| `@edge-base/auth-ui-react` | Pre-built React auth components on top of the web SDK |
| `@edge-base/ssr` | Cookie-based server-side auth handling |
| `@edge-base/admin` | Trusted server-side admin tasks |

## License

MIT
