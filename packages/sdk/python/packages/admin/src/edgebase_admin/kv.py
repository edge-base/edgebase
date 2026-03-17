"""KvClient — KV namespace access for server-side use.

Usage::

    import os

    admin = EdgeBaseServer('https://...', service_key=os.environ['EDGEBASE_SERVICE_KEY'])
    await admin.kv('cache').set('key', 'value', ttl=300)
    val = admin.kv('cache').get('key')
"""

from __future__ import annotations

from typing import Any

from edgebase_admin.generated.admin_api_core import GeneratedAdminApi
from edgebase_core.http_client import HttpClient


class KvClient:
    """Client for a user-defined KV namespace."""

    def __init__(self, http_client: HttpClient, namespace: str) -> None:
        self._http = http_client
        self._admin_core = GeneratedAdminApi(http_client)
        self._namespace = namespace

    def get(self, key: str) -> str | None:
        """Get a value by key. Returns None if not found."""
        res = self._admin_core.kv_operation(self._namespace, {"action": "get", "key": key})
        return res.get("value")

    def set(self, key: str, value: str, *, ttl: int | None = None) -> None:
        """Set a key-value pair with optional TTL in seconds."""
        body: dict[str, Any] = {"action": "set", "key": key, "value": value}
        if ttl is not None:
            body["ttl"] = ttl
        self._admin_core.kv_operation(self._namespace, body)

    def delete(self, key: str) -> None:
        """Delete a key."""
        self._admin_core.kv_operation(self._namespace, {"action": "delete", "key": key})

    def list(
        self,
        *,
        prefix: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """List keys with optional prefix, limit, and cursor."""
        body: dict[str, Any] = {"action": "list"}
        if prefix is not None:
            body["prefix"] = prefix
        if limit is not None:
            body["limit"] = limit
        if cursor is not None:
            body["cursor"] = cursor
        return self._admin_core.kv_operation(self._namespace, body)
