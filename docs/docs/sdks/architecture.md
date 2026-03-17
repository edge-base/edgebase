---
sidebar_position: 4
---

# SDK Architecture

EdgeBase SDKs share a generated HTTP contract, but the public client surface is not "fully generated" end-to-end.

The accurate model is:

1. **Generated Core API** is the single source of truth for spec-backed HTTP routes.
2. **Generated Wrappers** add friendly names for some spec-backed groups such as auth, storage, analytics, and passkeys.
3. **Hand-written Public Clients** compose the generated pieces with platform behavior such as token storage, database subscriptions, room, push, captcha, auth side effects, and manual helpers like App Functions.

## Layer Model

```text
┌──────────────────────────────────────────────────────┐
│ Layer 3: Public Client SDK                          │
│ auth / db / storage / databaseLive / room / push     │
│ functions helper, token storage, platform behavior  │
├──────────────────────────────────────────────────────┤
│ Layer 2: Generated Convenience Wrappers             │
│ signUp(), track(), passkeysRegisterOptions() ...    │
│ thin forwarding over generated core methods         │
├──────────────────────────────────────────────────────┤
│ Layer 1: Generated Core API                         │
│ authSignup(), trackEvents(), dbSingleListRecords()  │
│ exact HTTP method/path/query/body binding           │
└──────────────────────────────────────────────────────┘
                ▲
                │
          OpenAPI specification
                ▲
                │
       Hono + Zod route definitions
```

## What Is Generated

The generated core layer is where transport correctness is guaranteed.

- HTTP method/path/query/body binding
- path parameter handling
- OpenAPI-driven request shapes
- spec-backed helper wrappers from `wrapper-config.json`

If a new REST route is added to the OpenAPI spec and the SDKs are regenerated, the generated core will stay aligned across languages.

## What Is Hand-Written

The public client entrypoints are intentionally hand-written because several behaviors are platform-specific or not driven by OpenAPI alone.

- token persistence and refresh
- auth state side effects
- captcha / Turnstile integration
- database subscription and room lifecycle management
- push integration
- query-builder ergonomics
- App Functions helper (`client.functions`)
- platform-specific analytics behavior

That means public-surface drift is still possible if a generated capability is not re-exported or wrapped by the hand-written client layer.

## Public Surface Policy

We treat the client SDK surface in two categories.

### Spec-backed surface

These should be exposed consistently across client SDKs because the server contract already exists in OpenAPI.

- auth/session/profile
- storage REST helpers
- analytics `track`
- raw passkeys REST methods

### Platform/manual surface

These are not guaranteed by code generation and are implemented per SDK.

- App Functions helper
- web analytics batching and `sendBeacon`
- database subscription lifecycle recovery
- push adapters
- captcha UI/ceremony helpers

Docs should describe these as **manual parity**, not generator parity.

## What The Architecture Prevents

This architecture strongly reduces transport drift:

| Problem | Status |
|---|---|
| Wrong HTTP method/path in a generated route | Prevented by generated core |
| Missing spec parameter in generated core | Prevented by OpenAPI generation |
| Client-side auth/storage helper drift | Still possible in hand-written layer |
| Missing public export for a generated capability | Still possible in hand-written layer |

So the right claim is:

> The generated core makes HTTP contract drift hard. Public client parity still requires conformance tests and docs discipline.

## Adding A New Capability

### If the capability is spec-backed

1. Add the server route.
2. Regenerate OpenAPI.
3. Regenerate SDK core/wrapper code.
4. Expose the capability from each public client that should support it.
5. Add conformance tests for the public surface.

### If the capability is manual

Examples: App Functions, browser-only analytics behavior, native passkey ceremony helpers.

1. Implement the helper in each target client SDK deliberately.
2. Document it as manual surface.
3. Add per-SDK tests instead of relying on codegen drift checks.

## Recommended Drift Guardrails

- Keep generated core as the transport source of truth.
- Add public-surface conformance tests per SDK.
- Document intentional platform differences explicitly.
- Avoid claiming "all SDKs have identical public APIs" unless tests enforce it.
