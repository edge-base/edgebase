//! EdgeBase Rust SDK — Internal HTTP client (#133: set_context / X-EdgeBase-Context removed)

use crate::Error;
use reqwest::{Client, Method};
use serde_json::Value;
use std::time::Duration;

pub struct HttpClient {
    client: Client,
    base_url: String,
    service_key: String,
    #[cfg_attr(not(test), allow(dead_code))]
    timeout_ms: Option<u64>,
}

fn parse_timeout_ms(raw: Option<&str>) -> Option<u64> {
    raw.and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
}

impl HttpClient {
    pub fn new(base_url: &str, service_key: &str) -> Result<Self, Error> {
        let url = base_url.trim_end_matches('/').to_string();
        let timeout_ms = parse_timeout_ms(std::env::var("EDGEBASE_HTTP_TIMEOUT_MS").ok().as_deref());
        let mut builder = Client::builder();
        if let Some(timeout_ms) = timeout_ms {
            builder = builder.timeout(Duration::from_millis(timeout_ms));
        }
        Ok(Self {
            client: builder.build()?,
            base_url: url,
            service_key: service_key.to_string(),
            timeout_ms,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn timeout_ms(&self) -> Option<u64> {
        self.timeout_ms
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn parse_timeout_ms_for_tests(raw: Option<&str>) -> Option<u64> {
        parse_timeout_ms(raw)
    }

    fn build_request(&self, method: Method, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url);
        if !self.service_key.is_empty() {
            req = req.header("X-EdgeBase-Service-Key", &self.service_key);
            req = req.header("Authorization", format!("Bearer {}", self.service_key));
        }
        req
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> Result<Value, Error> {
        let resp = req.send().await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            let msg = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| {
                    v.get("error")
                        .or_else(|| v.get("message"))
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| text.clone());
            return Err(Error::Api {
                status: status.as_u16(),
                message: msg,
            });
        }
        if text.is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&text)?)
    }

    pub async fn get(&self, path: &str) -> Result<Value, Error> {
        let req = self.build_request(Method::GET, path);
        self.send(req).await
    }

    pub async fn get_with_query(&self, path: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        let req = self.build_request(Method::GET, path).query(query);
        self.send(req).await
    }

    pub async fn post(&self, path: &str, body: &Value) -> Result<Value, Error> {
        let req = self.build_request(Method::POST, path).json(body);
        self.send(req).await
    }

    pub async fn post_with_query(&self, path: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        let req = self.build_request(Method::POST, path).json(body).query(query);
        self.send(req).await
    }

    pub async fn patch(&self, path: &str, body: &Value) -> Result<Value, Error> {
        let req = self.build_request(Method::PATCH, path).json(body);
        self.send(req).await
    }

    pub async fn delete(&self, path: &str) -> Result<Value, Error> {
        let req = self.build_request(Method::DELETE, path);
        self.send(req).await
    }

    pub async fn delete_with_body(&self, path: &str, body: &Value) -> Result<Value, Error> {
        let req = self.build_request(Method::DELETE, path).json(body);
        self.send(req).await
    }

    /// HEAD request — returns `true` if the resource exists (2xx status).
    pub async fn head(&self, path: &str) -> Result<bool, Error> {
        let req = self.build_request(Method::HEAD, path);
        let resp = req.send().await?;
        Ok(resp.status().is_success())
    }

    pub async fn put(&self, path: &str, body: &Value) -> Result<Value, Error> {
        let req = self.build_request(Method::PUT, path).json(body);
        self.send(req).await
    }

    pub async fn put_with_query(&self, path: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        let req = self.build_request(Method::PUT, path).json(body).query(query);
        self.send(req).await
    }

    /// Multipart file upload.
    pub async fn upload_multipart(
        &self, path: &str, key: &str, data: Vec<u8>, content_type: &str,
    ) -> Result<Value, Error> {
        use reqwest::multipart::{Form, Part};
        let part = Part::bytes(data)
            .file_name(key.to_string())
            .mime_str(content_type)
            .map_err(|e| Error::Url(e.to_string()))?;
        let form = Form::new()
            .part("file", part)
            .text("key", key.to_string());
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.post(&url).multipart(form);
        if !self.service_key.is_empty() {
            req = req.header("X-EdgeBase-Service-Key", &self.service_key);
            req = req.header("Authorization", format!("Bearer {}", self.service_key));
        }
        self.send(req).await
    }

    /// POST raw bytes (for multipart upload-part).
    pub async fn post_bytes(&self, path: &str, data: Vec<u8>, content_type: &str) -> Result<Value, Error> {
        let req = self.build_request(Method::POST, path)
            .header("Content-Type", content_type)
            .body(data);
        self.send(req).await
    }

    /// Download raw bytes.
    pub async fn download_raw(&self, path: &str) -> Result<Vec<u8>, Error> {
        let req = self.build_request(Method::GET, path);
        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() {
            let msg = resp.text().await.unwrap_or_default();
            return Err(Error::Api { status: status.as_u16(), message: msg });
        }
        Ok(resp.bytes().await.map(|b| b.to_vec())?)
    }
}
