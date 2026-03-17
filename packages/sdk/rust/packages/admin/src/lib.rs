//! edgebase-admin — EdgeBase server-side SDK (admin auth, KV, D1, Vectorize).

pub mod admin_auth;
pub mod analytics;
pub mod kv;
pub mod push;
pub mod d1;
pub mod functions;
pub mod vectorize;
pub mod edgebase;
pub mod generated;

// Re-export the main entry point
pub use edgebase::EdgeBase;
pub use analytics::AnalyticsClient;
pub use functions::FunctionsClient;

// Re-export core types so generated code can use `crate::Error` / `crate::HttpClient`
pub use edgebase_core::Error;
pub use edgebase_core::HttpClient;

#[cfg(test)]
mod tests;
