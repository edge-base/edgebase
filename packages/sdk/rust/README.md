# EdgeBase Rust Server SDK

Server-only SDK for EdgeBase — (2단계).

## Entry Point

```rust
use edgebase::EdgeBase;

let client = EdgeBase::server(
    "https://your-project.edgebase.fun",
    std::env::var("EDGEBASE_SERVICE_KEY")?.as_str(),
)?;
```

## Run Tests

```bash
cd packages/sdk/rust

# Unit tests only (no server needed) — offline OK
cargo test --lib

# E2E tests (requires running server)
BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=sk_test cargo test
```

## Prerequisites

- Rust 1.75+ (2021 edition)
- `cargo`

## Dependencies

```toml
reqwest  = "0.12"  # HTTP client (json feature)
serde    = "1"     # Serialization
tokio    = "1"     # Async runtime
thiserror = "1"    # Error types
```

## Start Server (for E2E)

```bash
cd packages/server
TMPDIR=/tmp XDG_CONFIG_HOME=/tmp npx wrangler dev --config wrangler.test.toml --port 8688
```
