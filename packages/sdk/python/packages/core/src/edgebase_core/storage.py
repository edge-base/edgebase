"""Storage client — bucket operations, uploads, downloads, signed URLs."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any

from edgebase_core.generated.api_core import GeneratedDbApi
from edgebase_core.http_client import HttpClient


@dataclass
class SignedUrlResult:
    """Signed URL result."""

    url: str
    expires_in: int


@dataclass
class FileInfo:
    """File metadata."""

    key: str
    size: int
    content_type: str | None = None
    etag: str | None = None
    uploaded_at: str | None = None
    uploaded_by: str | None = None
    custom_metadata: dict[str, str] | None = None

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> FileInfo:
        return cls(
            key=data.get("key", ""),
            size=data.get("size", 0),
            content_type=data.get("contentType"),
            etag=data.get("etag"),
            uploaded_at=data.get("uploadedAt"),
            uploaded_by=data.get("uploadedBy"),
            custom_metadata=data.get("customMetadata"),
        )


@dataclass
class FileListResult:
    """Paginated bucket listing result."""

    files: list[FileInfo]
    cursor: str | None = None
    truncated: bool = False

    @property
    def has_more(self) -> bool:
        return self.truncated


class StorageClient:
    """Storage subsystem — bucket factory.

    Usage::

        bucket = client.storage.bucket("avatars")
        url = bucket.get_url("profile.png")
    """

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    def bucket(self, name: str) -> StorageBucket:
        return StorageBucket(self._client, name)


class StorageBucket:
    """Bucket-level storage operations.

    Usage::

        bucket.upload("file.png", data, content_type="image/png")
        url = bucket.get_url("file.png")
        data = bucket.download("file.png")
    """

    def __init__(self, client: HttpClient, name: str) -> None:
        self._client = client
        self._core = GeneratedDbApi(client)
        self.name = name

    def get_url(self, path: str) -> str:
        """Get the public URL of a file."""
        from urllib.parse import quote

        return f"{self._client._base_url}/api/storage/{self.name}/{quote(path, safe='')}"

    # MARK: - Upload

    def upload(
        self,
        path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
        custom_metadata: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Upload a file."""
        form_data = {"key": path}
        if custom_metadata:
            import json

            form_data["customMetadata"] = json.dumps(custom_metadata)
        return self._client.post_multipart(
            f"/storage/{self.name}/upload",
            files={"file": (path, data, content_type)},
            data=form_data,
        )

    def upload_string(
        self,
        path: str,
        data: str,
        encoding: str = "raw",
        content_type: str = "text/plain",
    ) -> dict[str, Any]:
        """Upload a string with encoding support.

        Args:
            encoding: One of 'raw', 'base64', 'base64url', 'data_url'
        """
        if encoding == "raw":
            raw_bytes = data.encode("utf-8")
        elif encoding == "base64":
            raw_bytes = base64.b64decode(data)
        elif encoding == "base64url":
            raw_bytes = base64.urlsafe_b64decode(data + "=" * (4 - len(data) % 4))
        elif encoding == "data_url":
            # data:image/png;base64,xxx
            _, encoded = data.split(",", 1)
            raw_bytes = base64.b64decode(encoded)
        else:
            raw_bytes = data.encode("utf-8")

        return self.upload(path, raw_bytes, content_type)

    # MARK: - Download

    def download(self, path: str) -> bytes:
        """Download a file as bytes."""
        from urllib.parse import quote

        return self._client.get_raw(f"/storage/{self.name}/{quote(path, safe='')}")

    # MARK: - Metadata

    def get_metadata(self, path: str) -> FileInfo:
        """Get file metadata."""
        data = self._core.get_file_metadata(self.name, path)
        return FileInfo.from_json(data)

    def update_metadata(self, path: str, metadata: dict[str, Any]) -> dict[str, Any]:
        """Update file metadata."""
        return self._core.update_file_metadata(self.name, path, metadata)

    # MARK: - Signed URLs

    def create_signed_url(self, path: str, expires_in: str = "1h") -> SignedUrlResult:
        """Create a signed URL for temporary access."""
        data = self._core.create_signed_download_url(
            self.name,
            {"key": path, "expiresIn": expires_in},
        )
        return SignedUrlResult(
            url=data.get("url", ""),
            expires_in=data.get("expiresIn", expires_in),
        )

    def create_signed_upload_url(self, path: str, expires_in: int = 3600) -> SignedUrlResult:
        """Create a signed upload URL."""
        data = self._core.create_signed_upload_url(
            self.name,
            {"key": path, "expiresIn": f"{expires_in}s"},
        )
        return SignedUrlResult(
            url=data.get("url", ""),
            expires_in=data.get("expiresIn", expires_in),
        )

    def create_constrained_signed_upload_url(
        self,
        path: str,
        *,
        expires_in: str = "30m",
        max_file_size: str | None = None,
    ) -> dict[str, Any]:
        """Create a signed upload URL with optional quota constraints."""
        body: dict[str, Any] = {"key": path, "expiresIn": expires_in}
        if max_file_size is not None:
            body["maxFileSize"] = max_file_size
        data = self._core.create_signed_upload_url(self.name, body)
        return data if isinstance(data, dict) else {}

    # MARK: - Management

    def delete_file(self, path: str) -> dict[str, Any]:
        """Delete a file."""
        return self._core.delete_file(self.name, path)

    def delete(self, path: str) -> dict[str, Any]:
        """Delete a file. Alias for :meth:`delete_file`."""
        return self.delete_file(path)

    def list(
        self,
        prefix: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> list[FileInfo]:
        """List files in bucket. Alias for :meth:`list_files`."""
        return self.list_files(prefix=prefix, limit=limit, offset=offset)

    def list_page(
        self,
        *,
        prefix: str = "",
        limit: int = 100,
        cursor: str | None = None,
    ) -> FileListResult:
        """List files with cursor pagination."""
        params: dict[str, str] = {"limit": str(limit)}
        if prefix:
            params["prefix"] = prefix
        if cursor:
            params["cursor"] = cursor
        data = self._client.get(f"/storage/{self.name}", params)
        records = data if isinstance(data, dict) else {}
        items = records.get("files", records.get("items", []))
        files = [FileInfo.from_json(item) for item in items] if isinstance(items, list) else []
        return FileListResult(
            files=files,
            cursor=records.get("cursor"),
            truncated=bool(records.get("truncated")),
        )

    def list_files(
        self,
        prefix: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> list[FileInfo]:
        """List files in bucket."""
        params: dict[str, str] = {"limit": str(limit), "offset": str(offset)}
        if prefix:
            params["prefix"] = prefix
        data = self._client.get(f"/storage/{self.name}", params)
        items = data.get("files", data.get("items", [])) if isinstance(data, dict) else []
        return [FileInfo.from_json(item) for item in items]

    # MARK: - Resumable / Multipart Upload

    def initiate_resumable_upload(
        self,
        path: str,
        content_type: str = "application/octet-stream",
        total_size: int | None = None,
    ) -> str:
        """Initiate a multipart upload. Returns upload ID.

        Args:
            path: Object key / path in the bucket.
            content_type: MIME type of the file.
            total_size: Optional total size hint (ignored by server, kept for compat).
        """
        body: dict[str, Any] = {"key": path, "contentType": content_type}
        if total_size is not None:
            body["totalSize"] = total_size
        data = self._core.create_multipart_upload(
            self.name,
            body,
        )
        return data.get("uploadId", "")

    def abort_resumable_upload(self, path: str, upload_id: str) -> dict[str, Any]:
        """Abort a multipart upload."""
        return self._core.abort_multipart_upload(
            self.name,
            {"uploadId": upload_id, "key": path},
        )

    def resume_upload(
        self,
        path: str,
        upload_id: str,
        chunk: bytes,
        *,
        part_number: int = 1,
        is_last_chunk: bool = False,
    ) -> dict[str, Any]:
        """Upload a part of a multipart upload.

        Returns the part etag dict from the server (used for completing the upload).
        """
        from urllib.parse import quote

        params = f"uploadId={upload_id}&partNumber={part_number}&key={quote(path, safe='')}"
        return self._client.post_raw(
            f"/storage/{self.name}/multipart/upload-part?{params}",
            data=chunk,
            content_type="application/octet-stream",
        )

    def complete_resumable_upload(
        self,
        path: str,
        upload_id: str,
        parts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Complete a multipart upload.

        Args:
            path: Object key / path in the bucket.
            upload_id: The upload ID returned by initiate_resumable_upload.
            parts: List of ``{"partNumber": int, "etag": str}`` dicts.
        """
        return self._core.complete_multipart_upload(
            self.name,
            {"uploadId": upload_id, "key": path, "parts": parts},
        )
