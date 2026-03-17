---
sidebar_position: 6
---

# Email Provider

EdgeBase uses an external email provider to send transactional emails — verification codes, password resets, magic links, and email-change verification messages. Configure your provider in `edgebase.config.ts`.

## Configuration

```typescript
import { defineConfig } from '@edgebase/shared';

export default defineConfig({
  email: {
    provider: 'resend',
    apiKey: process.env.EMAIL_API_KEY,
    from: 'noreply@my-app.com',
    appName: 'My App',                                    // Optional
    verifyUrl: 'https://my-app.com/verify?token={token}', // Optional
    resetUrl: 'https://my-app.com/reset?token={token}',   // Optional
    magicLinkUrl: 'https://my-app.com/magic?token={token}', // Optional
    emailChangeUrl: 'https://my-app.com/verify-email-change?token={token}', // Optional
  },
});
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `string` | ✅ | `'resend'` \| `'sendgrid'` \| `'mailgun'` \| `'ses'` |
| `apiKey` | `string` | ✅ | API key from your email provider |
| `from` | `string` | ✅ | Sender email address (must be verified with provider) |
| `domain` | `string` | Mailgun only | Mailgun sending domain |
| `region` | `string` | SES only | AWS region (e.g. `'us-east-1'`) |
| `appName` | `string` | — | Display name shown in email templates (e.g. "My App") |
| `verifyUrl` | `string` | — | Custom email verification URL. Use `{token}` as placeholder |
| `resetUrl` | `string` | — | Custom password reset URL. Use `{token}` as placeholder |
| `magicLinkUrl` | `string` | — | Default magic link URL. Use `{token}` as placeholder |
| `emailChangeUrl` | `string` | — | Default email-change verification URL. Use `{token}` as placeholder |

These templates are default fallbacks. For magic link, password reset, and email change, clients can override them per request with `redirectUrl`. EdgeBase appends `token`, `type`, and optional `state` to that request-specific URL.

If you want to restrict request-specific redirects, configure `auth.allowedRedirectUrls`.

:::info No email provider?
If `email` is not configured, EdgeBase cannot deliver transactional emails. Email-driven flows can still generate action tokens for testing, but production apps should configure a provider.
:::

## Supported Providers

### Resend (Recommended)

Best developer experience with the most generous free tier.

```typescript
email: {
  provider: 'resend',
  apiKey: 're_xxxxxxxxxx',
  from: 'noreply@my-app.com',
},
```

- **Free tier**: 3,000 emails/month
- **Setup**: [resend.com](https://resend.com) → Create API Key → Verify domain
- **Docs**: [resend.com/docs](https://resend.com/docs)

:::tip Resend current behavior
As of March 8, 2026, Resend does **not** require production approval. You can create an API key and send immediately.
:::

:::caution Default resend.dev domain is test-only
Resend's default `onboarding@resend.dev` sender can only send to the email address associated with your own Resend account. To send magic links, password resets, or verification emails to other recipients, you must add and verify your own domain and use a `from` address on that verified domain.
:::

:::info Use a subdomain for sending
Resend recommends verifying a subdomain such as `auth.example.com` or `mail.example.com` instead of your root domain. This keeps your transactional-email reputation isolated and makes the sender purpose clearer.
:::

### SendGrid

Most widely used transactional email service.

```typescript
email: {
  provider: 'sendgrid',
  apiKey: 'SG.xxxxxxxxxx',
  from: 'noreply@my-app.com',
},
```

- **Free tier**: 100 emails/day
- **Setup**: [sendgrid.com](https://sendgrid.com) → Settings → API Keys
- **Docs**: [docs.sendgrid.com](https://docs.sendgrid.com)

:::info SendGrid smoke prerequisites
For local smoke tests, you still need a verified sender. Twilio SendGrid supports **Single Sender Verification** for quick testing and **Domain Authentication** for full production sending. Use a verified `from` address before testing magic links, verification emails, or password resets.
:::

:::info SendGrid domain-auth tips
- If you use **Domain Authentication** with **Automated Security** turned on, SendGrid gives you **3 CNAME records** and an optional DMARC TXT record.
- Twilio documents that providers such as **Namecheap** may append your root domain automatically. In that case, enter only the host portion before your root domain.
  - Example root domain: `edgebase.fun`
  - Wrong host input: `em123.sendgrid.auth.edgebase.fun`
  - Correct host input in Namecheap: `em123.sendgrid.auth`
- DMARC is recommended, but Twilio documents that Domain Authentication itself does **not** require DMARC to validate.
- For local smoke, `from` should match the authenticated domain, for example `noreply@sendgrid.auth.example.com`.
- In this repository's current validation order, SendGrid support remains available but active local smoke coverage is deferred behind `Resend`, `Mailgun`, and `SES`.
:::

### Mailgun

European data sovereignty option with region selection.

```typescript
email: {
  provider: 'mailgun',
  apiKey: 'key-xxxxxxxxxx',
  from: 'noreply@my-app.com',
  domain: 'mg.my-app.com',  // Required for Mailgun
},
```

- **Free tier**: 1,000 emails/month (first 3 months)
- **Setup**: [mailgun.com](https://www.mailgun.com) → Sending → Domains → API Keys
- **Docs**: [documentation.mailgun.com](https://documentation.mailgun.com)

:::info Mailgun smoke prerequisites
Mailgun smoke tests require a verified sending domain. Set `domain` to the Mailgun domain you configured, and make sure `from` uses that same domain.
:::

### AWS SES

Lowest cost at scale for high-volume senders.

```typescript
email: {
  provider: 'ses',
  apiKey: 'AKIA...:secretKey',  // accessKeyId:secretAccessKey[:sessionToken]
  from: 'noreply@my-app.com',
  region: 'us-east-1',  // Required for SES
},
```

- **Pricing**: $0.10 per 1,000 emails
- **Setup**: [AWS Console](https://console.aws.amazon.com/sesv2/) → Verified Identities → Create domain identity, then IAM → Users → Access keys
- **Docs**: [docs.aws.amazon.com/ses](https://docs.aws.amazon.com/ses)

:::info SES smoke prerequisites
SES HTTP API requests must be AWS SigV4-signed. EdgeBase expects `apiKey` in the form `accessKeyId:secretAccessKey[:sessionToken]` and signs the request for you.
:::

:::info SES domain-auth tips
- Use a **domain identity** such as `ses.auth.example.com`, then set `from` on that same domain, for example `noreply@ses.auth.example.com`.
- For manual DNS providers such as Namecheap, keep **Easy DKIM** enabled, select **RSA_2048_BIT**, and turn off automatic Route53 DNS publishing.
- SES usually gives you **3 DKIM CNAME records**. In DNS UIs that automatically append your root domain, enter only the host portion before the root domain.
  - Example root domain: `edgebase.fun`
  - SES full record name: `abc._domainkey.ses.auth.edgebase.fun`
  - Namecheap host input: `abc._domainkey.ses.auth`
- Use **IAM access keys**, not SES SMTP credentials, because EdgeBase uses the SES HTTP API rather than SMTP.
:::

:::caution SES sandbox restrictions
If your AWS account is still in the SES sandbox, you may need to verify **both** the sender and the recipient email address before any smoke test mail can be delivered.
:::

## Provider Comparison

| Provider | Free Tier | Best For |
|----------|-----------|----------|
| **Resend** | 3,000/month | Most projects (recommended default) |
| SendGrid | 100/day | Teams already using SendGrid |
| Mailgun | 1,000/month (3mo) | EU data residency requirements |
| AWS SES | Pay-as-you-go | High-volume (100K+ emails/month) |

## What Emails Are Sent?

EdgeBase sends transactional emails for these auth flows:

| Flow | Trigger | Template |
|------|---------|----------|
| **Email Verification** | User signs up with email/password | Verification code link |
| **Password Reset** | User requests password reset | Reset token link |
| **Magic Link** | User requests passwordless sign-in | One-time sign-in link |
| **Email Change** | Signed-in user requests email change | Verify new-email link |

Email templates are built-in and include responsive HTML styling. Custom template support is planned for a future release.

## Local Harness Mailbox-Click Tests

The local JS web harness separates **capability validation** from **mailbox-click validation**.

- `Run Email Validation`
  - Tests the current signed-in email account's password/session/TOTP/passkey capabilities
  - Does **not** automatically click or complete email inbox links
- `Send Verify Email`
- `Send Password Reset Email`
- `Send Change Email Link`
  - These three are the mailbox-click tests

Current local callback targets used by the harness:

- Magic link: `http://localhost:4173/auth/magic?token=...&type=magic-link`
- Verify email: `http://localhost:4173/auth/verify-email?token=...&type=verify`
- Password reset: `http://localhost:4173/auth/reset-password?token=...&type=password-reset`
- Change email: `http://localhost:4173/auth/change-email?token=...&type=email-change`

When these links are opened in the harness, EdgeBase verifies the token and the harness updates the signed-in session automatically where possible.

:::info Local external-provider dev mode
If you want local `wrangler dev` to send real external email instead of local capture/fallback delivery, set `EDGEBASE_AUTH_FORCE_LOCAL_DELIVERY=false`.

In this repository, local worker startup also uses a generated dev shim. If you change `.env.development` while running `wrangler dev` directly, make sure the generated local config has been refreshed before restarting the worker.
:::

## Smoke Test Strategy Across Providers

For `Resend / SendGrid / Mailgun / SES`, reuse the same harness buttons instead of making provider-specific clients:

1. Configure the provider in `edgebase.config.ts`
2. Restart the local EdgeBase dev server
3. Sign in to the harness with the mailbox you want to test
4. Send verification / password reset / change-email mail
5. Confirm inbox delivery and click the link

That means:

- one provider is enough to prove the **auth flow**
- each additional provider should at least pass **mail acceptance + inbox-click smoke**

## Self-Hosting (Docker)

When self-hosting with Docker, the same email configuration works identically. All four HTTP REST providers are fully supported in the Docker environment.

```typescript
// Works the same in Docker
email: {
  provider: 'resend',
  apiKey: process.env.EMAIL_API_KEY,
  from: 'noreply@my-app.com',
},
```
