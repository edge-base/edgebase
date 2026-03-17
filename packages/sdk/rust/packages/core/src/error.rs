//! EdgeBase Rust SDK — Error types

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("HTTP error {status}: {message}")]
    Api { status: u16, message: String },

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Config error: {0}")]
    Config(String),

    #[error("URL parse error: {0}")]
    Url(String),

    #[error("Room error: {0}")]
    Room(String),

    #[error("Room action timed out: {0}")]
    RoomTimeout(String),

    #[error("WebSocket error: {0}")]
    WebSocket(String),
}
