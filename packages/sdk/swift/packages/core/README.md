# EdgeBaseCore

Shared Swift package for EdgeBase.

Use this package when you need the low-level HTTP, query, error, and storage
primitives that power the higher-level Swift client package.

## Installation

This package is part of the monorepo at `packages/sdk/swift/packages/core`.
It is consumed directly by the `EdgeBase` package in this repository.

## Main Types

- `HttpClient`
- `TableRef`
- `DbRef`
- `StorageClient`
- `EdgeBaseError`
- `EdgeBaseAuthError`
- `FieldOps`
- `TokenManager`

## Notes

- This package is the shared foundation for the Swift client package.
- Prefer the higher-level `EdgeBase` package for app code.
