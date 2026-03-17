# EdgeBase Go Server SDK

Server-only SDK for EdgeBase — authenticated with a Service Key.  
: Go is server-only (1단계).

## Entry Point

```go
import (
    "os"
    edgebase "github.com/edgebase/sdk-go"
)

admin := edgebase.NewAdminClient("https://your-project.edgebase.fun", os.Getenv("EDGEBASE_SERVICE_KEY"))
```

## Run Tests

```bash
# Unit tests only (no server needed)
go test ./... -run TestUnit -v

# E2E tests (requires running server)
BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=sk_test \
  go test ./... -run TestE2E -v
```

## Prerequisites

- Go 1.22+
- No external dependencies (stdlib only: `net/http`, `encoding/json`)

## Start Server (for E2E)

```bash
cd ../../server
TMPDIR=/tmp XDG_CONFIG_HOME=/tmp npx wrangler dev --config wrangler.test.toml --port 8688
```
