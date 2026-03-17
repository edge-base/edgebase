---
sidebar_position: 11
title: SDK Support
sidebar_label: SDK Support
description: Database client and admin surface comparison.
---

# SDK Support

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

This page compares the **product surface** of EdgeBase Database across the Client SDK and the Admin SDK.

:::info Scope
This table is about **what you can do from each SDK surface**, not package layout. For exact language and package availability, see [SDK Layer Matrix](/docs/sdks/layer-matrix). For the latest cross-runtime admin certification, see [SDK Verification Matrix](/docs/sdks/verification-matrix).
:::

| Capability | Client SDK | Admin SDK | Notes |
| --- | --- | --- | --- |
| CRUD and query builders | Yes | Yes | `client.db()` respects access rules. `admin.db()` uses a Service Key and bypasses them. |
| Batch operations | Yes | Yes | Both surfaces expose batch helpers, but exact helper coverage can vary by language. |
| Database Subscriptions (`onSnapshot()`) | Yes | No | Live query subscriptions ride the client database subscription WebSocket surface. |
| Access rule enforcement | Yes | No | Admin requests bypass app-level database access rules by design. |
| Raw SQL | No | Yes | Use [`admin.sql()`](/docs/server/raw-sql) for privileged SQL access. |
| Direct DB block and privileged cross-tenant access | No | Yes | Intended for backend jobs, migrations, moderation, and server workflows. |

## Use Client SDK When

- you are building app-facing CRUD flows
- you need `onSnapshot()` or user-token-aware reads and writes
- you want access rules enforced automatically

## Use Admin SDK When

- you need Service Key-backed backend jobs
- you need raw SQL or privileged DB block access
- you are running moderation, migrations, or maintenance tasks

## Related Docs

- [Client SDK](/docs/database/client-sdk)
- [Admin SDK](/docs/database/admin-sdk)
- [Access Rules](/docs/database/access-rules)
