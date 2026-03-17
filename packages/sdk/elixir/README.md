# EdgeBase Elixir SDK

Elixir packages for EdgeBase server-side integrations.

Packages:

- `packages/core` - shared HTTP/runtime helpers, DB table references, and storage
- `packages/admin` - admin client facade for auth, SQL, KV, D1, vector, push,
  analytics, functions, and broadcast

The initial layout mirrors the other server-side SDKs so admin-app wiring and
publish metadata can land in the same repository shape.
