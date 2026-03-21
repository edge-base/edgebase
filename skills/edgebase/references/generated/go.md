<!-- Generated from packages/sdk/go/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Go Admin SDK

Use this file as a quick-reference contract for AI coding assistants working with `github.com/edge-base/sdk-go`.

## Package Boundary

Use this package for trusted, server-side EdgeBase work.

It is the Go admin SDK. It expects a Service Key and bypasses access rules. Do not use it in browsers, mobile apps, or any untrusted client environment.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/go/README.md
- SDK overview: https://edgebase.fun/docs/sdks
- Admin SDK guide: https://edgebase.fun/docs/sdks/client-vs-server
- Admin SDK reference: https://edgebase.fun/docs/admin-sdk/reference
- Admin users: https://edgebase.fun/docs/authentication/admin-users
- Database admin SDK: https://edgebase.fun/docs/database/admin-sdk
- Storage: https://edgebase.fun/docs/storage/upload-download
- Analytics admin SDK: https://edgebase.fun/docs/analytics/admin-sdk
- Push admin SDK: https://edgebase.fun/docs/push/admin-sdk
- Native resources: https://edgebase.fun/docs/server/native-resources

If docs, code snippets, and assumptions disagree, prefer the current Go package API and the official docs over guessed patterns from another language.

## Canonical Examples

### Create an admin client

```go
import (
    "os"

    edgebase "github.com/edge-base/sdk-go"
)

admin := edgebase.NewAdminClient(
    "https://your-project.edgebase.fun",
    os.Getenv("EDGEBASE_SERVICE_KEY"),
)
```

### Query a single-instance database

```go
ctx := context.Background()

posts, err := admin.
    DB("app", "").
    Table("posts").
    Where("published", "==", true).
    OrderBy("createdAt", "desc").
    Limit(20).
    GetList(ctx)
```

### Query an instance database

```go
ctx := context.Background()

docs, err := admin.
    DB("workspace", "ws-1").
    Table("documents").
    GetList(ctx)
```

### Create and update a user

```go
ctx := context.Background()

user, err := admin.AdminAuth.CreateUser(ctx, "june@example.com", "securePassword")
if err != nil {
    return err
}

updated, err := admin.AdminAuth.UpdateUser(ctx, user["id"].(string), map[string]interface{}{
    "displayName": "June",
    "role": "editor",
})
```

### List users with cursor pagination

```go
ctx := context.Background()

page, err := admin.AdminAuth.ListUsers(ctx, 20)
cursor, _ := page["cursor"].(string)

for cursor != "" {
    page, err = admin.AdminAuth.ListUsersPage(ctx, 20, cursor)
    if err != nil {
        break
    }
    cursor, _ = page["cursor"].(string)
}
```

### Upload a file and create a signed URL

```go
ctx := context.Background()

bucket := admin.Storage().Bucket("avatars")

_, err := bucket.Upload(ctx, "user-1.jpg", fileData, "image/jpeg")
signed, err := bucket.CreateSignedURL(ctx, "user-1.jpg", "1h")
```

### Call a function

```go
ctx := context.Background()

result, err := admin.Functions().Post(ctx, "send-welcome-email", map[string]interface{}{
    "userId": "user-123",
    "template": "onboarding",
})
```

### Track analytics

```go
ctx := context.Background()

err := admin.Analytics().Track(ctx, "user_upgraded", map[string]interface{}{
    "plan": "pro",
    "amount": 29.99,
}, "user_123")
```

### Use native resources

```go
ctx := context.Background()

err := admin.KV("cache").Set(ctx, "homepage", "ready", 300)
rows, err := admin.D1("analytics").Query(ctx, "SELECT 1", nil)
hits, err := admin.Vector("embeddings").Search(ctx, []float64{0.1, 0.2, 0.3}, nil)
```

## Common Mistakes

- `edgebase.NewAdminClient(...)` returns a single `*AdminClient`, not `(client, err)`
- `admin.DB(namespace, instanceID)` always takes two positional arguments; use `""` for a single-instance database
- `admin.Storage()`, `admin.Functions()`, and `admin.Analytics()` are methods, not fields
- `admin.Push` is a field, not a method
- `admin.AdminAuth.CreateUser(ctx, email, password)` only accepts email and password; apply profile fields later with `UpdateUser`
- `admin.AdminAuth.UpdateUser(ctx, userID, data)` takes a `map[string]interface{}`, not a typed input struct
- `admin.AdminAuth.ListUsers(ctx, limit)` and `ListUsersPage(ctx, limit, cursor)` return `map[string]interface{}` responses
- `table.Get(ctx)` returns a list result; use `table.GetOne(ctx, id)` for a single record
- `admin.SQL(...)` and `table.SQL(...)` expect params as `[]interface{}`
- Storage methods like `Upload`, `Download`, `GetMetadata`, `List`, and `CreateSignedURL` require `context.Context`
- `CreateSignedUploadURL(ctx, path, expiresIn)` takes seconds as an `int`, for example `600`, not a duration string like `"10m"`
- `SendToToken(ctx, token, payload, platform)` needs a platform string; pass `"web"` when unsure

## Quick Reference

```go
// Initialize
admin := edgebase.NewAdminClient(baseURL, serviceKey)

// Admin auth
admin.AdminAuth.CreateUser(ctx, email, password)                         // (map[string]interface{}, error)
admin.AdminAuth.GetUser(ctx, userID)                                     // (map[string]interface{}, error)
admin.AdminAuth.ListUsers(ctx, limit)                                    // (map[string]interface{}, error)
admin.AdminAuth.ListUsersPage(ctx, limit, cursor)                        // (map[string]interface{}, error)
admin.AdminAuth.UpdateUser(ctx, userID, map[string]interface{}{})        // (map[string]interface{}, error)
admin.AdminAuth.SetCustomClaims(ctx, userID, map[string]interface{}{})   // error
admin.AdminAuth.RevokeAllSessions(ctx, userID)                           // error
admin.AdminAuth.DeleteUser(ctx, userID)                                  // error

// Database
admin.DB("app", "").Table("posts").GetList(ctx)                          // (*ListResult, error)
admin.DB("app", "").Table("posts").GetOne(ctx, id)                       // (map[string]interface{}, error)
admin.DB("app", "").Table("posts").Insert(ctx, record)                   // (map[string]interface{}, error)
admin.DB("app", "").Table("posts").Update(ctx, id, data)                 // (map[string]interface{}, error)
admin.DB("app", "").Table("posts").Delete(ctx, id)                       // error
admin.SQL(ctx, "app", "", query, []interface{}{1, "a"})                  // ([]interface{}, error)

// Storage
bucket := admin.Storage().Bucket("avatars")
bucket.GetURL("user-1.jpg")                                              // string
bucket.Upload(ctx, "user-1.jpg", fileData, "image/jpeg")                 // (map[string]interface{}, error)
bucket.Download(ctx, "user-1.jpg")                                       // ([]byte, error)
bucket.GetMetadata(ctx, "user-1.jpg")                                    // (map[string]interface{}, error)
bucket.UpdateMetadata(ctx, "user-1.jpg", map[string]interface{}{})       // (map[string]interface{}, error)
bucket.List(ctx, "", 100, 0)                                             // ([]map[string]interface{}, error)
bucket.ListPage(ctx, "", 100, "")                                        // (*FileListResult, error)
bucket.CreateSignedURL(ctx, "user-1.jpg", "1h")                          // (map[string]interface{}, error)
bucket.CreateSignedURLs(ctx, []string{"a.jpg", "b.jpg"}, "1h")           // (map[string]interface{}, error)
bucket.CreateSignedUploadURL(ctx, "large.zip", 600)                      // (map[string]interface{}, error)

// Functions
admin.Functions().Get(ctx, "health", nil)                                // (map[string]interface{}, error)
admin.Functions().Post(ctx, "jobs/run", map[string]interface{}{})        // (map[string]interface{}, error)
admin.Functions().Put(ctx, path, body)                                   // (map[string]interface{}, error)
admin.Functions().Patch(ctx, path, body)                                 // (map[string]interface{}, error)
admin.Functions().Delete(ctx, path)                                      // (map[string]interface{}, error)

// Analytics
admin.Analytics().Overview(ctx, map[string]string{"range": "7d"})        // (map[string]interface{}, error)
admin.Analytics().Track(ctx, name, props, userID)                        // error
admin.Analytics().TrackBatch(ctx, []edgebase.AnalyticsEvent{...})        // error
admin.Analytics().QueryEvents(ctx, map[string]string{"metric": "list"})  // (map[string]interface{}, error)

// KV / D1 / Vectorize
admin.KV("cache").Get(ctx, "homepage")                                   // (string, error)
admin.KV("cache").Set(ctx, "homepage", "ready", 300)                     // error
admin.KV("cache").List(ctx, "", 100, "")                                 // (map[string]interface{}, error)
admin.KV("cache").Delete(ctx, "homepage")                                // error
admin.D1("analytics").Query(ctx, "SELECT 1", nil)                        // ([]interface{}, error)
admin.Vector("embeddings").Search(ctx, []float64{0.1, 0.2, 0.3}, nil)    // ([]map[string]interface{}, error)

// Push
admin.Push.Send(ctx, userID, payload)                                    // (map[string]interface{}, error)
admin.Push.SendMany(ctx, []string{"u1", "u2"}, payload)                  // (map[string]interface{}, error)
admin.Push.SendToToken(ctx, token, payload, "web")                       // (map[string]interface{}, error)
admin.Push.SendToTopic(ctx, topic, payload)                              // (map[string]interface{}, error)
admin.Push.BroadcastPush(ctx, payload)                                   // (map[string]interface{}, error)
admin.Push.GetTokens(ctx, userID)                                        // (map[string]interface{}, error)
admin.Push.GetLogs(ctx, userID, 50)                                      // (map[string]interface{}, error)
```
