# EdgeBase Go Admin SDK

Server-only Go SDK for EdgeBase.

Use it with a Service Key from trusted environments such as backend APIs, workers, cron jobs, and CLIs. This package exposes the admin surface for database access, admin auth, raw SQL, storage, functions, analytics, push, and native Cloudflare resources.

Go modules resolve this package directly from the repository's git tags, so consumers install it from source control without a separate package-registry publish step.

## Documentation Map

Use this README for the fast overview, then jump into the docs when you need depth:

- [Quickstart](https://edgebase.fun/docs/getting-started/quickstart)
  Create a project and run EdgeBase locally
- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and language matrix for all public SDKs
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Server-only concepts, service keys, and capability boundaries
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language admin examples for auth, database, storage, functions, and push
- [Admin User Management](https://edgebase.fun/docs/authentication/admin-users)
  Create, update, delete, and manage users with the Service Key
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, batch writes, and admin-side database access
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Analytics Admin SDK](https://edgebase.fun/docs/analytics/admin-sdk)
  Request metrics, event tracking, and event queries
- [Push Admin SDK](https://edgebase.fun/docs/push/admin-sdk)
  Send push notifications and inspect push logs
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other edge-native resources

## For AI Coding Assistants

This package ships with an `llms.txt` file for AI-assisted development.

Use it when you want an agent or code assistant to:

- avoid incorrect Go method signatures
- remember which admin surfaces are methods vs fields
- use the right `DB(namespace, instanceID)` pattern
- avoid copying JavaScript or Python SDK shapes into Go

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/go/llms.txt)
- in your module cache after install, under the downloaded `github.com/edge-base/sdk-go@<version>` directory

## Installation

```bash
go get github.com/edge-base/sdk-go@latest
```

Minimal setup:

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

## Quick Start

```go
package main

import (
    "context"
    "log"
    "os"

    edgebase "github.com/edge-base/sdk-go"
)

func main() {
    admin := edgebase.NewAdminClient(
        "https://your-project.edgebase.fun",
        os.Getenv("EDGEBASE_SERVICE_KEY"),
    )

    ctx := context.Background()

    posts, err := admin.
        DB("app", "").
        Table("posts").
        Where("published", "==", true).
        OrderBy("createdAt", "desc").
        Limit(10).
        GetList(ctx)
    if err != nil {
        log.Fatal(err)
    }

    rows, err := admin.SQL(
        ctx,
        "app",
        "",
        "SELECT COUNT(*) AS total FROM posts",
        nil,
    )
    if err != nil {
        log.Fatal(err)
    }

    log.Printf("posts=%d sqlRows=%d", len(posts.Items), len(rows))
}
```

`DB("app", "")` uses an empty instance ID for a single-instance database block. For instance databases, pass both values, for example `DB("workspace", "ws-123")`.

## Core API

- `admin.AdminAuth`
  Create, update, delete, and manage users with Service Key authority
- `admin.DB(namespace, instanceID)`
  Query tables and perform admin-side writes
- `admin.SQL(ctx, namespace, instanceID, query, params)`
  Execute raw SQL against a database namespace
- `admin.Storage().Bucket(name)`
  Upload, download, list, and sign storage files
- `admin.Functions()`
  Invoke EdgeBase app functions from trusted code
- `admin.Analytics()`
  Query request metrics and track custom events
- `admin.Push`
  Send push notifications, inspect tokens, and read push logs
- `admin.KV(name)`, `admin.D1(name)`, `admin.Vector(name)`
  Access Cloudflare-native resources through the admin client

## Prerequisites

- Go `1.24.12+` to match the current `go.mod`
- An EdgeBase Service Key in `EDGEBASE_SERVICE_KEY`
- No external runtime dependencies beyond the Go standard library

## Run Tests

```bash
# Unit tests only (no server needed)
go test -tags unit -v ./...

# E2E tests (requires a running EdgeBase server)
BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=sk_test \
  go test -tags e2e -v ./...
```

## Start Local Server For E2E

```bash
cd ../../server
TMPDIR=/tmp XDG_CONFIG_HOME=/tmp npx wrangler dev --config wrangler.test.toml --port 8688
```
