---
sidebar_position: 10
title: SDK Support
sidebar_label: SDK Support
description: App Functions client and admin call surface comparison.
---

# SDK Support

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

App Functions are primarily a **server authoring surface**. SDKs do not define functions or triggers; they **call** them.

:::info Scope
This table compares **who can call App Functions from an SDK**. For language and package availability, see [SDK Layer Matrix](/docs/sdks/layer-matrix). For the latest cross-runtime admin certification, see [SDK Verification Matrix](/docs/sdks/verification-matrix).
:::

| Capability | Client SDK | Admin SDK | Notes |
| --- | --- | --- | --- |
| Call HTTP App Functions | Yes | Yes | Client calls use the current user token. Admin calls use a Service Key. |
| Automatic auth context on function calls | Yes | Yes | Client calls carry user auth. Admin calls carry backend authority. |
| Call privileged internal workflows from backend code | No | Yes | Use `admin.functions.call()` for Service Key-backed server workflows. |
| Define HTTP functions | No | No | Functions are authored in the `functions/` directory, not from an SDK. |
| Define DB, auth, or schedule triggers | No | No | Trigger configuration is part of server code, not a client or admin SDK surface. |

:::note
App Functions are the main exception to a pure client-vs-admin split: the **authoring surface** lives in your project code, while the SDK surfaces are only **callers**.
:::

## Use Client SDK When

- your app needs to call HTTP functions with user auth
- you want the current user token attached automatically
- you are invoking app-facing custom endpoints

## Use Admin SDK When

- your backend needs to call functions with Service Key authority
- you are chaining backend jobs or internal workflows
- you need privileged function access outside the client auth model

## Related Docs

- [Client SDK](/docs/functions/client-sdk)
- [Function Trigger Types](/docs/functions/triggers)
- [Context API](/docs/functions/context-api)
