---
sidebar_position: 22
---

# Limits

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Technical limits for EdgeBase Authentication.

## Tokens & Sessions

| Limit | Default | Configurable | Notes |
|-------|---------|:---:|-------|
| Access token TTL | **15 minutes** | Yes | `auth.session.accessTokenTTL` |
| Refresh token TTL | **28 days** | Yes | `auth.session.refreshTokenTTL` |
| Max active sessions per user | **Unlimited** (0) | Yes | `auth.session.maxActiveSessions` — see [Session Management](/docs/authentication/session-management) |
| Refresh token rotation grace period | **30 seconds** | No | Prevents race conditions in multi-tab scenarios |
| SDK proactive refresh buffer | **30 seconds** | No | Refreshes token 30s before expiry |

## Email Tokens

| Token Type | TTL | Notes |
|------------|-----|-------|
| Email verification | **24 hours** | `crypto.randomUUID()` generated |
| Password reset | **1 hour** | |
| Magic link | **15 minutes** | Configurable via `auth.magicLink.tokenTTL` |
| MFA ticket | **5 minutes** | Stored in KV with TTL |

## Phone / OTP

| Limit | Value | Notes |
|-------|-------|-------|
| OTP code length | **6 digits** | |
| OTP TTL | **5 minutes** | |
| Max OTP attempts | **5** per code | Exceeding locks the code |
| OTP rate limit | **5 OTPs / hour** per phone number | |
| Phone format | E.164 | `^\+[1-9]\d{6,14}$` |

## Password

| Limit | Default | Configurable | Notes |
|-------|---------|:---:|-------|
| Minimum length | **8** characters | Yes | Via [password policy](/docs/authentication/password-policy) config |
| HIBP check timeout | **3,000 ms** | No | Fail-open if API unavailable |

See [Password Policy](/docs/authentication/password-policy) for full configuration options including uppercase, lowercase, digit, special character, and leaked password requirements.

## Infrastructure

| Limit | Value | Notes |
|-------|-------|-------|
| D1 read limit | **25B rows / month** | AUTH_DB (all auth data) (Workers Paid) |
| D1 write limit | **50M rows / month** | AUTH_DB (all auth data) (Workers Paid) |
| D1 storage | **10 GB / database** | AUTH_DB (all auth data) (Workers Paid) |
| Anonymous account retention | **30 days** | Configurable via `auth.anonymousRetentionDays` |
| Session cleanup interval | **Daily at 03:00 UTC** | Cron Trigger-based |

## Rate Limiting

| Group | Default | Key | Configurable |
|-------|---------|-----|:---:|
| `auth` | **30 req / 60s** | IP | Yes |
| `authSignin` | **10 req / 60s** | email | Yes |
| `authSignup` | **10 req / 60s** | IP | Yes |

## OAuth Providers

| Provider | Auto-Link (email_verified) | Notes |
|----------|:---:|-------|
| Google | Yes | Always verified |
| GitHub | Conditional | Uses only verified primary email; email is null if none available |
| Apple | Yes | Always verified |
| Discord | Conditional | Uses `verified` field |
| Microsoft | Conditional | Org accounts always verified |
| Facebook | No | No `email_verified` field |
| Kakao | Conditional | Business app config required |
| Naver | No | API does not guarantee |
| X (Twitter) | No | Not provided |
| Reddit | No | No email returned; no PKCE |
| Line | No | Not provided |
| Slack | Yes | Email verification required at signup |
| Spotify | No | Not provided |
| Twitch | Conditional | Uses `email_verified` field |

:::tip Self-hosting
D1 limits apply only to Cloudflare edge deployments. Docker and Node.js modes use local SQLite with no limits.
:::

:::tip Scaling beyond D1
If your platform approaches D1 limits, the auth provider can be migrated to **PostgreSQL** with a single config change (`provider: 'postgres'`) plus a connection-string env key. This removes D1 storage and throughput limits for auth and keeps the SDK surface unchanged. If you use Neon, the CLI helper can provision that env value for you.
:::
