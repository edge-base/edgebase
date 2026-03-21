<!-- Generated from packages/sdk/swift/packages/ios/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase

Use this file as a quick-reference contract for AI coding assistants working with the
Swift client package.

## Package Boundary

Use `EdgeBase` for client apps and `EdgeBaseServerClient` only in trusted code.

Do not ship the service-key client into app bundles that are exposed to end users.

## Source Of Truth

- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/swift/packages/ios/README.md
- Root README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/swift/README.md
- SDK Overview: https://edgebase.fun/docs/sdks
- Admin SDK: https://edgebase.fun/docs/sdks/client-vs-server

## Public Package

- `EdgeBase`

## Canonical Examples

### Create a client

```swift
import EdgeBase

let client = EdgeBaseClient("https://your-project.edgebase.fun")
```

### Create a service-key client

```swift
let admin = EdgeBaseServerClient("https://your-project.edgebase.fun", serviceKey: "sk-...")
```

## Hard Rules

- keep Service Keys out of client apps
- use async/await for networked operations
- prefer `EdgeBaseCore` for shared low-level primitives

## Quick Reference

```text
EdgeBaseClient(url)                                 -> EdgeBaseClient
EdgeBaseServerClient(url, serviceKey)               -> EdgeBaseServerClient
client.auth                                         -> AuthClient
client.db(namespace, instanceId?)                   -> DbRef
client.storage                                      -> StorageClient
client.functions                                    -> FunctionsClient
client.analytics                                    -> AnalyticsClient
admin.adminAuth                                     -> AdminAuthClient
admin.db(namespace, instanceId?)                   -> AdminDbRef
admin.destroy()                                     -> async Void
```
