---
sidebar_position: 9
title: SDK Support
sidebar_label: SDK Support
description: Storage client and admin surface comparison.
---

# SDK Support

:::caution Beta
This feature is in **beta**. Core behavior is stable, but some APIs or configuration may change before general availability.
:::

Storage exposes a broad surface on both the Client SDK and the Admin SDK. The main difference is whether **access rules are enforced** or **bypassed with a Service Key**.

:::info Scope
This table compares **storage capabilities by SDK role**. For package and runtime availability, see [SDK Layer Matrix](/docs/sdks/layer-matrix). For the latest cross-runtime admin certification, see [SDK Verification Matrix](/docs/sdks/verification-matrix).
:::

| Capability | Client SDK | Admin SDK | Notes |
| --- | --- | --- | --- |
| Upload and download files | Yes | Yes | Client requests respect storage access rules. Admin requests bypass them. |
| Signed download and upload URL creation | Yes | Yes | Access rules are checked when the signed URL is created. |
| Multipart upload and resume flows | Yes | Yes | The multipart surface exists on both sides. Server-only languages use the Admin SDK storage client. |
| Read and write file metadata | Yes | Yes | Same file surface, different auth context. |
| Access rule enforcement | Yes | No | Admin and App Function storage calls bypass storage access rules. |
| Privileged file access and maintenance jobs | No | Yes | Use Service Key-backed storage operations for backend workflows. |

## Use Client SDK When

- users are uploading or downloading files directly
- you want storage access rules enforced per user
- you need signed URLs from an app-facing surface that still respects rules

## Use Admin SDK When

- you need privileged file access from your backend
- you are generating signed URLs regardless of end-user auth context
- you are running cleanup, moderation, or background storage jobs

## Related Docs

- [Upload & Download](/docs/storage/upload-download)
- [Signed URLs](/docs/storage/signed-urls)
- [Access Rules](/docs/storage/access-rules)
