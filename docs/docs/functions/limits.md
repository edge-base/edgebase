---
sidebar_position: 8
---

# Limits

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Technical limits for EdgeBase App Functions.

## Execution

| Limit | Default | Configurable | Notes |
|-------|---------|:---:|-------|
| Max call depth | **5** | No | Prevents circular `context.admin.functions.call()` chains |
| Blocking hook timeout | **5 seconds** | No | Fixed — `beforeSignUp`, `beforeSignIn`, `onTokenRefresh`, `beforePasswordReset`, `beforeSignOut`. On timeout the operation is rejected with 403 `hook-rejected`. |
| Non-blocking hook | No timeout | — | `afterSignUp`, `afterSignIn`, `afterPasswordReset`, `afterSignOut`, `onDeleteAccount`, `onEmailVerified` run via `ctx.waitUntil()` |
| Action handler timeout (Room) | **5 seconds** | No | Per `onAction` execution |
| Schedule function timeout | **10 seconds** | Yes | Defaults to `10s`. Override with `functions.scheduleFunctionTimeout`. Applied by both Worker cron dispatch and DB-triggered schedule execution. |
| Alarm wall-clock budget | **30 seconds** | No | Cloudflare DO Alarm limit; functions split if exceeded |

## HTTP Triggers

| Feature | Details |
|---------|---------|
| Routing | Filesystem-based (SvelteKit style) |
| Dynamic params | `[param].ts` → `context.params.param` |
| Catch-all | `[...slug].ts` → `context.params.slug` |
| Route groups | `(group)/file.ts` → parentheses removed from URL |
| Methods | `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (named exports) |
| Middleware | `_middleware.ts` applies to directory and subdirectories |
| Ignored files | `_helper.ts` (underscore prefix, not middleware) |
| Request body | **1 MiB** by default. `Content-Length` is rejected early; otherwise the transport reads and bounds the actual bytes before CAPTCHA, middleware, or handler code runs. Set `maxRequestBodyBytes` on one HTTP function for a deliberate bounded override; use Storage for large or streaming files. |

```typescript
export const POST = defineFunction({
  trigger: { type: 'http' },
  maxRequestBodyBytes: 4 * 1024 * 1024,
  handler: async ({ request }) => {
    const body = await request.json();
    return { accepted: body.items.length };
  },
});
```

The override must be a safe integer from `0` through `16 MiB`. The transport
buffers no more than that bound and returns `413 payload-too-large` before
CAPTCHA, middleware, or handler side effects if the request crosses it. This
prevalidation intentionally trades streaming for a strong no-partial-mutation
contract. Put large or streaming payloads in Storage instead. Raising the
ceiling still does not make an unbounded JSON parser safe; validate item, text,
and nesting limits inside the function.

## Database Triggers

| Trigger Event | Execution | Notes |
|---------|-----------|-------|
| `insert` | Async (`ctx.waitUntil()`) | Never blocks API response |
| `update` | Async (`ctx.waitUntil()`) | |
| `delete` | Async (`ctx.waitUntil()`) | |
| Trigger error | Logged only | Best-effort; does not roll back the CUD operation |

## Authentication Triggers

| Trigger Event | Type | Timeout | Notes |
|------|------|---------|-------|
| `beforeSignUp` | Blocking | 5s (hardcoded) | Can reject signup; rejected with 403 `hook-rejected` on timeout |
| `beforeSignIn` | Blocking | 5s (hardcoded) | Can reject signin; rejected with 403 `hook-rejected` on timeout |
| `onTokenRefresh` | Blocking | 5s (hardcoded) | Can inject custom claims; on timeout the hook is skipped and the token is issued without hook claims (error is swallowed) |
| `afterSignUp` | Non-blocking | None | `ctx.waitUntil()` |
| `afterSignIn` | Non-blocking | None | `ctx.waitUntil()` |
| `beforePasswordReset` | Blocking | 5s | Called on both `reset-password` and `change-password` |
| `afterPasswordReset` | Non-blocking | None | `ctx.waitUntil()` |
| `beforeSignOut` | Blocking | 5s | Can reject sign-out; rejected with 403 `hook-rejected` on timeout |
| `afterSignOut` | Non-blocking | None | `ctx.waitUntil()` |
| `onDeleteAccount` | Non-blocking | None | `ctx.waitUntil()` |
| `onEmailVerified` | Non-blocking | None | `ctx.waitUntil()` |

## Schedule Triggers

| Limit | Value | Notes |
|-------|-------|-------|
| Cron syntax | Standard 5-field | Defined in `edgebase.config.ts`, deployed as Cloudflare Cron Triggers |
| Execution | Worker `scheduled()` handler | Each schedule function runs via `ctx.waitUntil()` |
| Concurrent execution | Parallel | Each schedule trigger runs independently in the Worker |

## Rate Limiting

| Group | Default | Key | Configurable |
|-------|---------|-----|:---:|
| `functions` | **50 req / 60s** | IP | Yes |
| `global` | **10,000,000 req / 60s** | IP | Yes |

Service Key requests bypass the `functions` group limit.

The same bypass semantics apply to all Admin SDKs.

## FunctionError Codes

| Code | HTTP Status |
|------|------------|
| `not-found` | 404 |
| `permission-denied` | 403 |
| `unauthenticated` | 401 |
| `invalid-argument` | 400 |
| `already-exists` | 409 |
| `payload-too-large` | 413 |
| `internal` | 500 |
| `unavailable` | 503 |
| `failed-precondition` | 412 |
| `resource-exhausted` | 429 |
