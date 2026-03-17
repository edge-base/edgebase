---
sidebar_position: 3
sidebar_label: Authentication Delivery Hooks
---

# Authentication Delivery Hooks

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Transactional authentication delivery hooks live under:

- `auth.handlers.email.onSend`
- `auth.handlers.sms.onSend`

Use them to modify or block verification emails, password reset emails, magic links, email OTP, email change messages, and phone OTP/SMS login messages.

## Email Hook

```typescript
import { defineConfig } from '@edgebase/shared';

export default defineConfig({
  email: {
    provider: 'resend',
    apiKey: process.env.EMAIL_API_KEY!,
    from: 'noreply@myapp.com',
  },
  auth: {
    handlers: {
      email: {
        onSend: async (type, to, subject, html, ctx, locale) => {
          if (to.endsWith('@disposable.test')) {
            throw new Error('Disposable email addresses are not allowed.');
          }

          return {
            subject,
            html: `<div data-locale="${locale ?? 'en'}">${html}</div>`,
          };
        },
      },
    },
  },
});
```

### Signature

```typescript
type MailType =
  | 'verification'
  | 'passwordReset'
  | 'magicLink'
  | 'emailOtp'
  | 'emailChange';

type EmailOnSend = (
  type: MailType,
  to: string,
  subject: string,
  html: string,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  locale?: string,
) => Promise<{ subject?: string; html?: string } | void>
  | { subject?: string; html?: string }
  | void;
```

## SMS Hook

```typescript
export default defineConfig({
  sms: {
    provider: 'twilio',
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    from: '+15551234567',
  },
  auth: {
    handlers: {
      sms: {
        onSend: async (type, to, body) => {
          if (type === 'phoneOtp') {
            return { body: `[MyApp] ${body}` };
          }
        },
      },
    },
  },
});
```

### Signature

```typescript
type SmsType = 'phoneOtp' | 'phoneLink';

type SmsOnSend = (
  type: SmsType,
  to: string,
  body: string,
  ctx: { waitUntil(promise: Promise<unknown>): void },
) => Promise<{ body?: string } | void>
  | { body?: string }
  | void;
```

## Behavior

- Blocking hooks
- Timeout is `5s`
- Throw to reject delivery
- Return partial overrides to rewrite the outbound message
- `ctx.waitUntil(...)` is available for background side effects

## See Also

- [Authentication Triggers](/docs/authentication/hooks)
- [Configuration](/docs/getting-started/configuration)
