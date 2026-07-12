---
sidebar_position: 3
---

# Storage API

File storage operations using R2 with $0 egress.

All Storage endpoints use the base path `/api/storage/:bucket`, where `:bucket` is the bucket name defined in your `edgebase.config.ts`.

## Authentication

All endpoints require a **Bearer Token** (`Authorization: Bearer <accessToken>`) unless a signed URL is used for access.

---

## Upload File

`POST /api/storage/:bucket/upload`

Upload a file using `multipart/form-data`.

**Auth**: Bearer Token required

| Form Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | Yes | The file to upload |
| `key` | string | Yes | Storage path (key) for the file |
| `metadata` | JSON string | No | Custom metadata as a JSON string |

```bash
curl -X POST https://your-project.edgebase.fun/api/storage/avatars/upload \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@photo.jpg" \
  -F "key=profile/photo.jpg" \
  -F 'metadata={"alt":"Profile photo"}'
```

**Response** `201`

```json
{
  "key": "profile/photo.jpg",
  "size": 123456,
  "httpMetadata": { "contentType": "image/jpeg" },
  "customMetadata": { "alt": "Profile photo" },
  "uploaded": "2026-01-01T00:00:00.000Z"
}
```

| Error | Status | Description |
|---|---|---|
| Missing file | `400` | No file provided in the request |
| Missing key | `400` | Storage key not specified |
| Unauthorized | `401` | Invalid or missing token |
| Rule denied | `403` | Bucket write rule rejected the request |
| File too large | `413` | File exceeds the configured size limit |

---

## Download File

`GET /api/storage/:bucket/:key`

Download a file by its key. The response is the raw file binary. Passive media
uses a normalized stored `Content-Type`; active or unknown content is returned
as an opaque attachment so it cannot execute in the application origin.

**Auth**: Bearer Token required (unless bucket read rule allows public access)

| Path Parameter | Description |
|---|---|
| `bucket` | Bucket name |
| `key` | File key (path) |

**Response**: File binary.

| Header | Behavior |
|---|---|
| `Content-Type` | Passive raster image/audio/video/font/plain-text media keeps its normalized MIME type. Active or unknown content uses `application/octet-stream`. |
| `Content-Disposition` | Set to `attachment` for HTML, XHTML, SVG, XML, JavaScript, CSS, PDF, binary, unknown, or malformed types. |
| `Content-Security-Policy` | Restrictive sandbox policy on forced attachments. |
| `X-Content-Type-Options` | Always `nosniff`. |

This policy is identical for authenticated, public, signed, full, and byte-range downloads.

| Error | Status | Description |
|---|---|---|
| Not found | `404` | File does not exist |
| Unauthorized | `401` | Invalid or missing token |
| Rule denied | `403` | Bucket read rule rejected the request |

---

## Check File Exists (HEAD)

`HEAD /api/storage/:bucket/:key`

Check if a file exists without downloading the content. Returns only HTTP headers with no response body.

**Auth**: Bearer Token required (unless bucket read rule allows public access)

**Service Key Scope**: `storage:bucket:{bucketName}:read`

| Path Parameter | Description |
|---|---|
| `bucket` | Bucket name |
| `key` | File key (path) |

**Response** `200` — file exists. Includes the following headers:

| Header | Description |
|---|---|
| `Content-Type` | MIME type of the file |
| `Content-Length` | File size in bytes |
| `ETag` | R2 ETag |
| `Last-Modified` | Last modification timestamp |

**Response** `404` — file does not exist.

| Error | Status | Description |
|---|---|---|
| Not found | `404` | File does not exist |
| Unauthorized | `401` | Invalid or missing token |
| Rule denied | `403` | Bucket read rule rejected the request |

---

## List Files

`GET /api/storage/:bucket`

List files in a bucket with optional prefix filtering and cursor-based pagination.

**Auth**: Bearer Token required

| Query Parameter | Type | Default | Description |
|---|---|---|---|
| `prefix` | string | | Filter files by key prefix |
| `limit` | number | | Maximum number of results to return |
| `cursor` | string | | Pagination cursor from a previous response |

**Response** `200`

```json
{
  "objects": [
    { "key": "profile/photo.jpg", "size": 123456, "uploaded": "2026-01-01T00:00:00.000Z" },
    { "key": "profile/banner.png", "size": 654321, "uploaded": "2026-01-02T00:00:00.000Z" }
  ],
  "truncated": false,
  "cursor": null
}
```

| Field | Type | Description |
|---|---|---|
| `objects` | array | Array of file objects with `key`, `size`, and `uploaded` |
| `truncated` | boolean | `true` if more results are available |
| `cursor` | string \| null | Cursor to pass for the next page, `null` if no more results |

---

## Delete File

`DELETE /api/storage/:bucket/:key`

Delete a file by its key.

**Auth**: Bearer Token required

| Path Parameter | Description |
|---|---|
| `bucket` | Bucket name |
| `key` | File key (path) to delete |

**Response** `200`

```json
{ "ok": true }
```

| Error | Status | Description |
|---|---|---|
| Not found | `404` | File does not exist |
| Rule denied | `403` | Bucket delete rule rejected the request |

---

## Batch Delete

`POST /api/storage/:bucket/delete-batch`

Delete multiple files in a single request.

**Auth**: Bearer Token required

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `keys` | string[] | Yes | Array of file keys to delete (max 100) |

```json
{
  "keys": ["file1.jpg", "folder/file2.png"]
}
```

**Response** `200`

```json
{
  "deleted": ["file1.jpg"],
  "failed": [{ "key": "folder/file2.png", "error": "Not found" }]
}
```

| Field | Type | Description |
|---|---|---|
| `deleted` | string[] | Array of successfully deleted file keys |
| `failed` | array | Array of objects with `key` and `error` for files that could not be deleted |

- Maximum **100 keys** per request
- Each key is individually checked against delete access rules
- Non-existent files are reported in the `failed` array

| Error | Status | Description |
|---|---|---|
| Too many keys | `400` | More than 100 keys provided |
| Unauthorized | `401` | Invalid or missing token |
| Rule denied | `403` | Bucket delete rule rejected the request for a key |

---

## Get File Metadata

`GET /api/storage/:bucket/:key/metadata`

Retrieve file metadata without downloading the file body.

**Auth**: Bearer Token required

| Path Parameter | Description |
|---|---|
| `bucket` | Bucket name |
| `key` | File key (path) |

**Response** `200`

```json
{
  "key": "profile/photo.jpg",
  "size": 123456,
  "httpMetadata": { "contentType": "image/jpeg" },
  "customMetadata": { "alt": "Profile photo" },
  "uploaded": "2026-01-01T00:00:00.000Z"
}
```

---

## Update File Metadata

`PATCH /api/storage/:bucket/:key/metadata`

Update the custom metadata of an existing file. Provide key-value pairs to set or overwrite.

**Auth**: Bearer Token required

| Path Parameter | Description |
|---|---|
| `bucket` | Bucket name |
| `key` | File key (path) |

**Request Body**: Key-value pairs of custom metadata.

```json
{
  "alt": "Updated description",
  "tags": "profile,avatar"
}
```

**Response** `200`

```json
{
  "key": "profile/photo.jpg",
  "size": 123456,
  "httpMetadata": { "contentType": "image/jpeg" },
  "customMetadata": { "alt": "Updated description", "tags": "profile,avatar" },
  "uploaded": "2026-01-01T00:00:00.000Z"
}
```

---

## Generate Signed Download URL

`POST /api/storage/:bucket/signed-url`

Generate a temporary signed URL for downloading a file. The URL provides public access without authentication for a limited time.
The bucket's `read` rule is evaluated against the stored object's actual
metadata before the URL is issued. Batch generation repeats that authorization
for every existing key; a list-level empty-resource decision does not authorize
other objects.
Signed download URLs include signed file metadata, which lets byte-range media playback seek with a direct range read and return private browser-cacheable range responses until the URL expires.
The signed size, MIME type, and ETag are checked against the object returned by
R2. Overwriting the key invalidates existing signed URLs with `412
failed-precondition` instead of serving the replacement body.

**Auth**: Bearer Token required

| Request Body | Type | Required | Description |
|---|---|---|---|
| `key` | string | Yes | File key to generate the URL for |
| `expiresIn` | string | No | Expiration duration such as `"30m"` or `"1h"` |

```json
{
  "key": "profile/photo.jpg",
  "expiresIn": "1h"
}
```

**Response** `200`

```json
{
  "url": "https://your-project.edgebase.fun/api/storage/private/profile%2Fphoto.jpg?token=...",
  "expiresAt": "2026-07-11T12:00:00.000Z"
}
```

Fetching a signed URL returns `412 failed-precondition` if the key's object
version no longer matches the size, MIME type, and ETag captured in the token.

---

## Batch Signed URLs

`POST /api/storage/:bucket/signed-urls`

Generate multiple signed download URLs in a single request.

**Auth**: Bearer Token required

**Service Key Scope**: `storage:bucket:{bucketName}:read`

**Request Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `keys` | string[] | Yes | Array of file keys (max 100) |
| `expiresIn` | string | No | Expiration duration (e.g. `"1h"`, `"30m"`) |

```json
{
  "keys": ["photo1.jpg", "photo2.jpg"],
  "expiresIn": "1h"
}
```

**Response** `200`

```json
{
  "urls": [
    {
      "key": "photo1.jpg",
      "url": "/api/storage/my-bucket/photo1.jpg?token=...",
      "expiresAt": "2024-01-01T01:00:00Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `urls` | array | Array of objects with `key`, `url`, and `expiresAt` |

- Maximum **100 keys** per request
- Non-existent files are silently skipped (no error)
- Subject to read access rules
- Token format: HMAC-SHA256 signed

---

## Generate Signed Upload URL

`POST /api/storage/:bucket/signed-upload-url`

Generate a signed URL that allows the client to upload through the EdgeBase
storage endpoint without sending an auth header. The token binds the bucket,
key, expiry, optional maximum size, and a random single-use grant. Use multipart
upload for large files.

**Auth**: Bearer Token required

| Request Body | Type | Required | Description |
|---|---|---|---|
| `key` | string | Yes | Target storage key for the upload |

```json
{
  "key": "videos/intro.mp4"
}
```

**Response** `200`

```json
{
  "url": "https://your-project.edgebase.fun/api/storage/uploads/upload?token=...&key=videos%2Fintro.mp4"
}
```

The client sends the same multipart form used by the normal upload endpoint:

```bash
curl -X POST "<signed-upload-url>" \
  -F "file=@intro.mp4;type=video/mp4" \
  -F "key=videos/intro.mp4"
```

The grant must still be valid when EdgeBase atomically consumes a single-file
attempt or authorizes a multipart continuation. A request admitted before
`expiresAt` may finish afterward; new requests at or after the boundary are
rejected. The grant is consumed before a single-file write or bound to the
first multipart session, so replay is rejected even after the uploaded object
is deleted.

---

## Multipart Upload

For large files, use multipart upload to split the file into parts and upload them individually. This supports resumable uploads and parallel part uploads.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/storage/:bucket/multipart/create` | Start a new multipart upload |
| `POST` | `/api/storage/:bucket/multipart/upload-part` | Upload a single part |
| `POST` | `/api/storage/:bucket/multipart/complete` | Complete the multipart upload |
| `POST` | `/api/storage/:bucket/multipart/abort` | Abort the multipart upload |
| `GET` | `/api/storage/:bucket/uploads/:uploadId/parts` | List uploaded parts (for resuming) |

**Auth**: Use a user Bearer token or service key, or pass the bound `token` and
`key` query parameters from a signed-upload URL. A signed-upload grant is
single-use at multipart creation and remains bound to that upload ID for part,
list, complete, and abort requests.

### Create Multipart Upload

`POST /api/storage/:bucket/multipart/create`

Start a new multipart upload session.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `key` | string | Yes | Target storage key |

```json
{
  "key": "videos/large-file.mp4"
}
```

**Response** `200`

```json
{
  "uploadId": "upload_abc123",
  "key": "videos/large-file.mp4"
}
```

### Upload Part

`POST /api/storage/:bucket/multipart/upload-part`

Upload a single part of a multipart upload. Parts can be uploaded in parallel.

For a signed upload with `maxFileSize`, every part must send a positive `Content-Length`.
EdgeBase atomically reserves each declared length against the grant's aggregate
budget before writing the part to R2. The first request that would exceed the
budget terminally closes and aborts the session. Retries and replacements also
consume reservation budget, preventing repeated part writes from multiplying
the signed grant's storage cost.

| Query Parameter | Type | Required | Description |
|---|---|---|---|
| `uploadId` | string | Yes | The upload ID from the create step |
| `partNumber` | number | Yes | Part number (starting from 1) |
| `key` | string | Yes | The file key |

The request body should be the raw binary data for this part.

**Response** `200`

```json
{
  "partNumber": 1,
  "etag": "\"abc123def456\""
}
```

### Complete Multipart Upload

`POST /api/storage/:bucket/multipart/complete`

Finalize the multipart upload by assembling all uploaded parts.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `uploadId` | string | Yes | The upload ID |
| `key` | string | Yes | The file key |
| `parts` | array | Yes | Array of `{ partNumber, etag }` objects |

```json
{
  "uploadId": "upload_abc123",
  "key": "videos/large-file.mp4",
  "parts": [
    { "partNumber": 1, "etag": "\"abc123def456\"" },
    { "partNumber": 2, "etag": "\"789ghi012jkl\"" }
  ]
}
```

**Response** `200`

```json
{
  "key": "videos/large-file.mp4",
  "size": 52428800,
  "uploaded": "2026-01-01T00:00:00.000Z"
}
```

### Abort Multipart Upload

`POST /api/storage/:bucket/multipart/abort`

Cancel an in-progress multipart upload and clean up any uploaded parts.

| Request Body | Type | Required | Description |
|---|---|---|---|
| `uploadId` | string | Yes | The upload ID to abort |
| `key` | string | Yes | The file key |

```json
{
  "uploadId": "upload_abc123",
  "key": "videos/large-file.mp4"
}
```

**Response** `200`

```json
{ "ok": true }
```

### List Uploaded Parts

`GET /api/storage/:bucket/uploads/:uploadId/parts`

List all parts that have been uploaded for a given multipart upload. Useful for resuming an interrupted upload.

| Path Parameter | Description |
|---|---|
| `uploadId` | The upload ID |

| Query Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | Yes | The file key |

**Response** `200`

```json
{
  "parts": [
    { "partNumber": 1, "size": 10485760, "etag": "\"abc123def456\"" },
    { "partNumber": 2, "size": 10485760, "etag": "\"789ghi012jkl\"" }
  ]
}
```

---

## Error Format

All Storage API errors follow the standard EdgeBase error format:

```json
{
  "code": 400,
  "message": "Validation failed.",
  "data": {
    "key": { "code": "required", "message": "Field is required." }
  }
}
```

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request or validation failure |
| `401` | Authentication required |
| `403` | Access denied by bucket access rule |
| `404` | File not found |
| `413` | File size exceeds the configured limit |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
