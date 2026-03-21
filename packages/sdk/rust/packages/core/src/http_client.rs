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
        // Token refresh failed — proceed as unauthenticated
        if let Ok(key) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.service_key.clone())) {
            if !key.is_empty() {
                req = req.header("X-EdgeBase-Service-Key", &key);
                req = req.header("Authorization", format!("Bearer {}", key));
            }
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

    /// Send request with 429 retry and transport retry. Rebuilds request on each attempt.
    async fn send_with_retry(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        query: Option<&std::collections::HashMap<String, String>>,
    ) -> Result<Value, Error> {
        let max_retries: usize = 3;
        for attempt in 0..=max_retries {
            let mut req = self.build_request(method.clone(), path);
            if let Some(b) = body {
                req = req.json(b);
            }
            if let Some(q) = query {
                req = req.query(q);
            }

            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    // 429 retry with Retry-After header
                    if status.as_u16() == 429 && attempt < max_retries {
                        let retry_after = resp
                            .headers()
                            .get("retry-after")
                            .and_then(|v| v.to_str().ok())
                            .and_then(|v| v.parse::<u64>().ok());
                        let base_ms = retry_after.map(|s| s * 1000).unwrap_or(1000 * (1u64 << attempt));
                        // Jitter: 0–25% of base delay (use simple pseudo-random from time nanos)
                        let nanos = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.subsec_nanos())
                            .unwrap_or(0);
                        let jitter = (base_ms as f64 * 0.25 * (nanos % 1_000_000) as f64 / 1_000_000.0) as u64;
                        let delay = std::cmp::min(base_ms + jitter, 10000);
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        continue;
                    }
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
                    return Ok(serde_json::from_str(&text)?);
                }
                Err(e) => {
                    if attempt < 2 {
                        tokio::time::sleep(Duration::from_millis(50 * (attempt as u64 + 1))).await;
                        continue;
                    }
                    return Err(e.into());
                }
            }
        }
        Err(Error::Api {
            status: 0,
            message: "Request failed after retries".to_string(),
        })
    }

    pub async fn get(&self, path: &str) -> Result<Value, Error> {
        self.send_with_retry(Method::GET, path, None, None).await
    }

    pub async fn get_with_query(&self, path: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.send_with_retry(Method::GET, path, None, Some(query)).await
    }

    pub async fn post(&self, path: &str, body: &Value) -> Result<Value, Error> {
        self.send_with_retry(Method::POST, path, Some(body), None).await
    }

    pub async fn post_with_query(&self, path: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.send_with_retry(Method::POST, path, Some(body), Some(query)).await
    }

    pub async fn patch(&self, path: &str, body: &Value) -> Result<Value, Error> {
        self.send_with_retry(Method::PATCH, path, Some(body), None).await
    }

    pub async fn delete(&self, path: &str) -> Result<Value, Error> {
        self.send_with_retry(Method::DELETE, path, None, None).await
    }

    pub async fn delete_with_body(&self, path: &str, body: &Value) -> Result<Value, Error> {
        self.send_with_retry(Method::DELETE, path, Some(body), None).await
    }

    /// HEAD request — returns `true` if the resource exists (2xx status).
    pub async fn head(&self, path: &str) -> Result<bool, Error> {
        let req = self.build_request(Method::HEAD, path);
        let resp = req.send().await?;
        Ok(resp.status().is_success())
    }

    pub async fn put(&self, path: &str, body: &Value) -> Result<Value, Error> {
        self.send_with_retry(Method::PUT, path, Some(body), None).await
    }

    pub async fn put_with_query(&self, path: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.send_with_retry(Method::PUT, path, Some(body), Some(query)).await
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
        // Token refresh failed — proceed as unauthenticated
        if let Ok(key) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.service_key.clone())) {
            if !key.is_empty() {
                req = req.header("X-EdgeBase-Service-Key", &key);
                req = req.header("Authorization", format!("Bearer {}", key));
            }
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
