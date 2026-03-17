//! edgebase-core — EdgeBase shared types, HTTP client, and table/storage operations.

pub mod http_client;
pub mod table;
pub mod storage;
pub mod field_ops;
pub mod error;
pub mod room;
pub mod generated;

// Re-export Error at crate root for convenience
pub use error::Error;

// Re-export commonly used types so E2E tests can use `edgebase_core::{HttpClient, TableRef, ...}`
pub use http_client::HttpClient;
pub use table::{TableRef, ListResult, BatchResult, UpsertResult};
pub use storage::{StorageClient, StorageBucket};
pub use field_ops::FieldOps;
pub use generated::api_core::GeneratedDbApi;

#[cfg(test)]
mod tests;
