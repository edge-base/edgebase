<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase Rust SDK Workspace

Workspace root for the Rust EdgeBase SDKs.

Most application code should install `edgebase-admin` for trusted server-side usage or `edgebase-core` for lower-level primitives. This root package tracks the Rust SDK release line and houses the integrated test workspace in this repository. It is not the main public crates.io install target.

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Documentation Map

Use this README for the package map, then jump into the package-specific docs when you need depth:

- [SDK Overview](https://edgebase.fun/docs/sdks)
  Install commands and the public SDK matrix
- [Admin SDK](https://edgebase.fun/docs/sdks/client-vs-server)
  Trusted-server concepts and admin-only capabilities
- [Admin SDK Reference](https://edgebase.fun/docs/admin-sdk/reference)
  Cross-language examples for auth, database, storage, functions, push, and analytics
- [Database Admin SDK](https://edgebase.fun/docs/database/admin-sdk)
  Table queries, filters, pagination, batch writes, and raw SQL
- [Storage](https://edgebase.fun/docs/storage/upload-download)
  Uploads, downloads, metadata, and signed URLs
- [Native Resources](https://edgebase.fun/docs/server/native-resources)
  KV, D1, Vectorize, and other trusted edge-native resources

## For AI Coding Assistants

This workspace includes an `llms.txt` file for AI-assisted development.

Use it when you want an assistant to:

- choose the right Rust package boundary
- keep Service Key logic on the server
- use Rust method names and async patterns instead of copying JavaScript examples directly
- know that `edgebase-admin` is the main application-facing crate and `edgebase-core` is the lower-level foundation

You can find it:

- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/rust/llms.txt)
- in this workspace checkout next to the README

## Package Map

| Package | Use it for |
| --- | --- |
| `edgebase-sdk` | Workspace release line and integrated repository package |
| `edgebase-admin` | Trusted server-side Rust code with Service Key access |
| `edgebase-core` | Lower-level HTTP, database, storage, and shared primitives |

## Installation

For published application code, prefer the narrower crates:

```toml
[dependencies]
edgebase-admin = "0.2.6"
```

Or for lower-level primitives:

```toml
[dependencies]
edgebase-core = "0.2.6"
```

The current public Rust release unit focuses on `edgebase-core` and `edgebase-admin`.

## Development

Run tests from the workspace root:

```bash
cd packages/sdk/rust

cargo test -p edgebase-core
cargo test -p edgebase-admin
BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=sk_test cargo test
```

## License

MIT
