"""HTTP client — httpx-based, server-side only.

Python SDK is server-only: authenticates via Service Key header.
No token refresh logic — use service_key for all server-side calls.
"""

from __future__ import annotations

import os
import time
import random
from typing import Any

import httpx

from edgebase_core.context_manager import ContextManager
from edgebase_core.errors import EdgeBaseError

DEFAULT_HTTP_TIMEOUT = httpx.Timeout(120.0, connect=30.0)
DEFAULT_HTTP_LIMITS = httpx.Limits(max_connections=10, max_keepalive_connections=0, keepalive_expiry=0.0)


class HttpClient:
    """Synchronous HTTP client for server-side use.

    Features:
    - Service Key header injection (X-EdgeBase-Service-Key)
    - Optional Bearer token injection (for impersonation)
    - Legacy context state for compatibility (not serialized into HTTP headers)
    """

    def __init__(
        self,
        base_url: str,
        context_manager: ContextManager | None = None,
        service_key: str | None = None,
        bearer_token: str | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._context_manager = context_manager if context_manager is not None else ContextManager()
        self._service_key = service_key
        self._bearer_token = bearer_token
        self._client = httpx.Client(
            timeout=self._resolve_timeout(),
            limits=DEFAULT_HTTP_LIMITS,
            headers={"Connection": "close"},
        )

    @staticmethod
    def _resolve_timeout() -> httpx.Timeout:
        raw = os.getenv("EDGEBASE_HTTP_TIMEOUT_MS", "").strip()
        if not raw:
            return DEFAULT_HTTP_TIMEOUT
        try:
            timeout_ms = int(raw)
        except ValueError:
            return DEFAULT_HTTP_TIMEOUT
        if timeout_ms <= 0:
            return DEFAULT_HTTP_TIMEOUT
        return httpx.Timeout(timeout_ms / 1000.0)

    def get(self, path: str, params: dict[str, str] | None = None) -> Any:
        return self._request("GET", path, params=params)

    def post(self, path: str, body: Any = None, params: dict[str, str] | None = None) -> Any:
        return self._request("POST", path, json_body=body, params=params)

    def patch(self, path: str, body: Any = None, params: dict[str, str] | None = None) -> Any:
        return self._request("PATCH", path, json_body=body, params=params)

    def put(self, path: str, body: Any = None, params: dict[str, str] | None = None) -> Any:
        return self._request("PUT", path, json_body=body, params=params)

    def delete(self, path: str, body: Any = None) -> Any:
        return self._request("DELETE", path, json_body=body)

    def head(self, path: str) -> bool:
        """HEAD request — returns True if resource exists (2xx)."""
        url = self._build_url(path)
        headers = self._auth_headers()
        response = self._client.request("HEAD", url, headers=headers)
        return response.status_code < 400

    def post_multipart(
        self,
        path: str,
        files: dict[str, Any],
        data: dict[str, str] | None = None,
    ) -> Any:
        """POST multipart form data (for file uploads)."""
        url = self._build_url(path)
        headers = self._auth_headers()
        headers.pop("Content-Type", None)  # Let httpx set multipart boundary
        response = self._client.post(url, files=files, data=data, headers=headers)
        return self._parse_response(response)

    def post_raw(
        self,
        path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> Any:
        """POST raw binary data (for multipart upload-part)."""
        url = self._build_url(path)
        headers = self._auth_headers()
        headers["Content-Type"] = content_type
        response = self._client.post(url, content=data, headers=headers)
        return self._parse_response(response)

    def get_raw(self, path: str) -> bytes:
        """GET raw bytes (for file downloads)."""
        url = self._build_url(path)
        headers = self._auth_headers()
        response = self._client.get(url, headers=headers)
        if response.status_code >= 400:
            raise EdgeBaseError(response.status_code, response.text)
        return response.content

    def close(self) -> None:
        """Close the underlying httpx client."""
        self._client.close()

    # MARK: - Internal

    @staticmethod
    def _parse_retry_after_delay(response: httpx.Response, attempt: int) -> float:
        base_delay = 1.0 * (2 ** attempt)
        retry_after = response.headers.get("retry-after")
        if retry_after:
            try:
                seconds = int(retry_after)
                if seconds > 0: base_delay = float(seconds)
            except ValueError: pass
        jitter = random.random() * base_delay * 0.25
        return min(base_delay + jitter, 10.0)

    @staticmethod
    def _is_retryable_transport_error(error: Exception) -> bool:
        msg = str(error).lower()
        return any(k in msg for k in ["timeout", "connection", "reset", "refused", "network", "eof"])

    def _request(self, method: str, path: str, params: dict[str, str] | None = None, json_body: Any = None) -> Any:
        url = self._build_url(path)
        headers = self._auth_headers()
        max_retries = 3
        for attempt in range(max_retries + 1):
            try:
                response = self._client.request(method, url, params=params, json=json_body, headers=headers)
            except Exception as exc:
                if attempt < 2 and self._is_retryable_transport_error(exc):
                    time.sleep(0.05 * (attempt + 1))
                    continue
                raise
            if response.status_code == 429 and attempt < max_retries:
                delay = self._parse_retry_after_delay(response, attempt)
                time.sleep(delay)
                continue
            return self._parse_response(response)
        # Final attempt exhausted (e.g., persistent 429) — parse last response as-is
        return self._parse_response(response)

    def _build_url(self, path: str) -> str:
        if path.startswith("/api/"):
            return f"{self._base_url}{path}"
        return f"{self._base_url}/api{path}"

    def _auth_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Connection": "close",
        }
        try:
            if self._bearer_token:
                headers["Authorization"] = f"Bearer {self._bearer_token}"
            if self._service_key:
                headers["X-EdgeBase-Service-Key"] = self._service_key
                headers["Authorization"] = f"Bearer {self._service_key}"
        except Exception:
            # Token refresh failed — proceed as unauthenticated
            pass
        return headers

    @staticmethod
    def _parse_response(response: httpx.Response) -> Any:
        if response.status_code >= 400:
            try:
                data = response.json()
                raise EdgeBaseError.from_json(data, response.status_code)
            except EdgeBaseError:
                raise
            except Exception:
                raise EdgeBaseError(response.status_code, response.text)

        if not response.content or response.status_code == 204:
            return None
        try:
            return response.json()
        except Exception:
            raise EdgeBaseError(
                response.status_code,
                "Expected a JSON response but received malformed JSON.",
            )
