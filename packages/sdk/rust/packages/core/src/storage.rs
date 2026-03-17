//! EdgeBase Rust SDK — StorageClient
//! Full API: upload, download, delete, list, getMetadata, updateMetadata,
//!           createSignedUrl, createSignedUploadUrl.

use crate::{Error, http_client::HttpClient};
use crate::generated::api_core::{GeneratedDbApi, ApiPaths};
use serde_json::{json, Value};
use std::sync::Arc;

/// Storage client — access buckets by name.
pub struct StorageClient {
    http: Arc<HttpClient>,
}

impl StorageClient {
    pub fn new(http: Arc<HttpClient>) -> Self { Self { http } }

    /// Get a handle to a named bucket.
    pub fn bucket(&self, name: &str) -> StorageBucket {
        StorageBucket { http: self.http.clone(), name: name.to_string() }
    }
}

/// Operations for a single storage bucket.
pub struct StorageBucket {
    http: Arc<HttpClient>,
    pub name: String,
}

impl StorageBucket {
    fn core(&self) -> GeneratedDbApi<'_> {
        GeneratedDbApi::new(&self.http)
    }

    fn base(&self) -> String {
        ApiPaths::list_files(&self.name)
    }

    /// Get public URL for a stored file (synchronous, no network).
    pub fn get_url(&self, key: &str) -> String {
        format!("{}/api/storage/{}/{}", self.http.base_url(), self.name, urlencoded(key))
    }

    /// Upload a file using multipart/form-data.
    /// Keep as direct HTTP — binary multipart upload.
    pub async fn upload(&self, key: &str, data: Vec<u8>, content_type: &str) -> Result<Value, Error> {
        self.http.upload_multipart(
            &format!("{}/upload", self.base()), key, data, content_type
        ).await
    }

    /// Download raw file bytes.
    /// Keep as direct HTTP — binary download.
    pub async fn download(&self, key: &str) -> Result<Vec<u8>, Error> {
        self.http.download_raw(&format!("{}/{}", self.base(), urlencoded(key))).await
    }

    /// Delete a file.
    pub async fn delete(&self, key: &str) -> Result<Value, Error> {
        self.core().delete_file(&self.name, key).await
    }

    /// List files in the bucket.
    pub async fn list(&self, prefix: &str, limit: u32, offset: u32) -> Result<Value, Error> {
        self.http.get(&format!(
            "{}?prefix={}&limit={}&offset={}",
            self.base(), urlencoded(prefix), limit, offset
        )).await
    }

    /// Get file metadata.
    pub async fn get_metadata(&self, key: &str) -> Result<Value, Error> {
        self.core().get_file_metadata(&self.name, key).await
    }

    /// Update file metadata.
    pub async fn update_metadata(&self, key: &str, metadata: &Value) -> Result<Value, Error> {
        self.core().update_file_metadata(&self.name, key, metadata).await
    }

    /// Create a signed download URL.
    pub async fn create_signed_url(&self, key: &str, expires_in: &str) -> Result<Value, Error> {
        let body = json!({ "key": key, "expiresIn": expires_in });
        self.core().create_signed_download_url(&self.name, &body).await
    }

    /// Create a signed upload URL for direct client-side uploads.
    pub async fn create_signed_upload_url(&self, key: &str, expires_in: &str) -> Result<Value, Error> {
        self.create_signed_upload_url_with_options(key, expires_in, None).await
    }

    /// Create a signed upload URL with optional constraints such as maxFileSize.
    pub async fn create_signed_upload_url_with_options(
        &self,
        key: &str,
        expires_in: &str,
        max_file_size: Option<&str>,
    ) -> Result<Value, Error> {
        let mut body = json!({ "key": key, "expiresIn": expires_in });
        if let Some(max_file_size) = max_file_size {
            body["maxFileSize"] = json!(max_file_size);
        }
        self.core().create_signed_upload_url(&self.name, &body).await
    }

    /// Upload a string with encoding support.
    /// `encoding`: "raw", "base64", "base64url", "data_url".
    pub async fn upload_string(
        &self, key: &str, data: &str, encoding: &str, content_type: &str,
    ) -> Result<Value, Error> {
        use base64::Engine as _;
        let (raw, ct) = match encoding {
            "base64" => {
                let bytes = base64::engine::general_purpose::STANDARD.decode(data)
                    .map_err(|e| Error::Api { status: 400, message: format!("Invalid base64: {e}") })?;
                (bytes, content_type.to_string())
            }
            "base64url" => {
                let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(data)
                    .map_err(|e| Error::Api { status: 400, message: format!("Invalid base64url: {e}") })?;
                (bytes, content_type.to_string())
            }
            "data_url" => {
                let comma = data.find(',')
                    .ok_or_else(|| Error::Api { status: 400, message: "Invalid data URL".into() })?;
                let header = &data[..comma];
                let body = &data[comma + 1..];
                let ct = if content_type.is_empty() || content_type == "application/octet-stream" {
                    header.strip_prefix("data:").unwrap_or("")
                        .split(';').next().unwrap_or("application/octet-stream").to_string()
                } else {
                    content_type.to_string()
                };
                let bytes = base64::engine::general_purpose::STANDARD.decode(body)
                    .map_err(|e| Error::Api { status: 400, message: format!("Invalid data URL base64: {e}") })?;
                (bytes, ct)
            }
            _ => { // "raw"
                let ct = if content_type.is_empty() { "text/plain".to_string() } else { content_type.to_string() };
                (data.as_bytes().to_vec(), ct)
            }
        };
        self.upload(key, raw, &ct).await
    }

    /// Initiate a multipart upload. Returns the upload ID.
    pub async fn initiate_resumable_upload(&self, key: &str, content_type: &str) -> Result<String, Error> {
        let mut body = json!({ "key": key });
        if !content_type.is_empty() {
            body["contentType"] = json!(content_type);
        }
        let resp = self.core().create_multipart_upload(&self.name, &body).await?;
        resp["uploadId"].as_str()
            .map(|s: &str| s.to_string())
            .ok_or_else(|| Error::Api { status: 500, message: "Missing uploadId".into() })
    }

    /// Upload a single part for a multipart upload. Returns `{ partNumber, etag }`.
    /// Keep as direct HTTP — binary part upload.
    pub async fn upload_part(
        &self, key: &str, upload_id: &str, part_number: u32, data: Vec<u8>,
    ) -> Result<Value, Error> {
        let path = format!(
            "{}/multipart/upload-part?uploadId={}&partNumber={}&key={}",
            self.base(), urlencoded(upload_id), part_number, urlencoded(key)
        );
        self.http.post_bytes(&path, data, "application/octet-stream").await
    }

    /// Complete a multipart upload. `parts` is a list of `{ partNumber, etag }` from upload_part.
    pub async fn complete_resumable_upload(
        &self, key: &str, upload_id: &str, parts: Vec<Value>,
    ) -> Result<Value, Error> {
        let body = json!({ "uploadId": upload_id, "key": key, "parts": parts });
        self.core().complete_multipart_upload(&self.name, &body).await
    }

    /// Abort a multipart upload before completion.
    pub async fn abort_resumable_upload(
        &self, key: &str, upload_id: &str,
    ) -> Result<Value, Error> {
        let body = json!({ "uploadId": upload_id, "key": key });
        self.core().abort_multipart_upload(&self.name, &body).await
    }

    /// Upload a chunk for a resumable upload (legacy convenience wrapper).
    /// Uploads a single part and, if `is_last_chunk`, completes the upload.
    pub async fn resume_upload(
        &self, key: &str, upload_id: &str, chunk: Vec<u8>, part_number: usize, is_last_chunk: bool,
    ) -> Result<Value, Error> {
        let pn = (part_number + 1) as u32; // R2 partNumber is 1-based
        let part = self.upload_part(key, upload_id, pn, chunk).await?;
        if is_last_chunk {
            // Collect this part info and complete
            // Note: caller must track all parts for multi-chunk uploads
            let parts = vec![part.clone()];
            self.complete_resumable_upload(key, upload_id, parts).await
        } else {
            Ok(part)
        }
    }

}



fn urlencoded(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}
