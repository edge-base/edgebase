---
sidebar_position: 5
title: SDK Support
sidebar_label: SDK Support
description: Analytics client and admin surface comparison.
---

# SDK Support

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Analytics splits cleanly between **event ingestion from apps** and **querying plus backend tracking from servers**.

:::info Scope
This table compares **analytics capabilities by SDK role**. For package and runtime availability, see [SDK Layer Matrix](/docs/sdks/layer-matrix). For the latest cross-runtime admin certification, see [SDK Verification Matrix](/docs/sdks/verification-matrix).
:::

| Capability | Client SDK | Admin SDK | Notes |
| --- | --- | --- | --- |
| Track custom events | Yes | Yes | Clients track user events. Backends can track operational or server-side events. |
| Client batching and `flush()` control | Yes | No | This is part of the client delivery surface. |
| Query request log metrics | No | Yes | Overview, time series, breakdown, and top endpoints are backend query surfaces. |
| Query custom events and aggregations | No | Yes | Event querying is an Admin SDK analytics surface. |
| Record backend-only analytics from jobs or functions | No | Yes | Use Service Key-backed or server-side tracking when the event is not tied to an app client. |

## Use Client SDK When

- you are tracking user behavior from the app
- you want batching and page-unload-safe delivery
- analytics should run under the current user context

## Use Admin SDK When

- you need to query metrics or events
- you are tracking server-side operational events
- you are building dashboards, reports, or backend analytics jobs

## Related Docs

- [Client SDK](/docs/analytics/client-sdk)
- [Admin SDK](/docs/analytics/admin-sdk)
- [Admin Dashboard](/docs/admin-dashboard)
