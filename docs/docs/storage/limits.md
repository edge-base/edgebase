---
sidebar_position: 7
---

# Limits

:::info Beta
This feature is in **beta**. Core behavior is stable and ready to try, but some APIs or configuration may still evolve before general availability.
:::

Technical limits for EdgeBase Storage (backed by Cloudflare R2).

## File Operations

| Limit | Value | Notes |
|-------|-------|-------|
| Max file size (single upload) | **100 MB** | R2 single-put limit; use multipart for larger files |
| Max file size (multipart) | **5 TB** | R2 multipart limit |
| Max part size (multipart) | **5 GB** | Per part |
| Min part size (multipart) | **5 MB** | Except last part |
| Max parts per upload | **10,000** | R2 limit |
| Batch delete | **100 keys** per request | Individual `delete` rule evaluated per key |
| Batch signed URLs | **100 keys** per request | Non-existent files are skipped |

## Signed URLs

| Limit | Default | Notes |
|-------|---------|-------|
| Download signed URL expiry | **1 hour** | Configurable via `expiresIn` parameter |
| Upload signed URL expiry | **30 minutes** | Configurable via `expiresIn` parameter |
| Security rule evaluation | At **generation** time | Not re-evaluated when the URL is used |

## Multipart Upload

| Limit | Value | Notes |
|-------|-------|-------|
| Part tracking | KV-based | `upload:{bucket}:{key}:{uploadId}:parts` |
| Part tracking TTL | **7 days** | Auto-cleaned; orphaned uploads expire |
| Resume support | Yes | `GET /storage/:bucket/uploads/:uploadId/parts` |

## Content Type Detection

Upload priority: explicit value > `File.type` > extension-based MIME (~50 mappings) > `application/octet-stream`.

## Rate Limiting

| Group | Default | Key | Configurable |
|-------|---------|-----|:---:|
| `storage` | **50 req / 60s** | IP | Yes |
| `global` | **10,000,000 req / 60s** | IP | Yes |

Service Key requests bypass the `storage` group limit.

That storage bypass applies across all Admin SDKs.

## Access Rules

| Rule | Evaluated On | Notes |
|------|-------------|-------|
| `read` | Download, HEAD, signed URL generation | |
| `write` | Upload (single + all multipart steps) | |
| `delete` | Delete, batch delete | |
| Default (`release: true`) | **Deny** | Must explicitly define rules |
| Default (`release: false`) | **Allow** | Development convenience |

:::tip Self-hosting
When running on Docker, R2 is emulated as local file storage. The 100 MB single-upload limit and multipart limits still apply (Miniflare emulation), but there is no egress cost.
:::
