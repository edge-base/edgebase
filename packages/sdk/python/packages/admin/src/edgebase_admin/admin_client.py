"""AdminClient — unified admin entry point (db + storage + auth).

mirror of JS AdminEdgeBase for Python server-side use.

Usage::

    import os
    from edgebase_admin import AdminClient

    admin = AdminClient("http://localhost:8688", service_key=os.environ["EDGEBASE_SERVICE_KEY"])
    table = admin.db("shared").table("posts")
    record = table.insert({"title": "Hello"})

    bucket = admin.storage().bucket("documents")
    bucket.upload("file.txt", b"Hello", content_type="text/plain")
"""

from __future__ import annotations

from typing import Any

from edgebase_admin.analytics import AnalyticsClient
from edgebase_core.generated.api_core import GeneratedDbApi
from edgebase_core.http_client import HttpClient
from edgebase_core.storage import StorageClient
from edgebase_core.table import TableRef
from edgebase_admin.admin_auth import AdminAuthClient
from edgebase_admin.d1 import D1Client
from edgebase_admin.functions import FunctionsClient
from edgebase_admin.generated.admin_api_core import GeneratedAdminApi
from edgebase_admin.kv import KvClient
from edgebase_admin.push import PushClient
from edgebase_admin.vectorize import VectorizeClient


class DbRef:
    """DB namespace block reference for table access (#133 §2).

    Obtained via ``admin.db('shared')``."""

    def __init__(self, core: GeneratedDbApi, namespace: str, instance_id: str | None = None) -> None:
        self._core = core
        self._namespace = namespace
        self._instance_id = instance_id

    def table(self, name: str) -> TableRef:
        """Get a TableRef for the named table."""
        return TableRef(
            core=self._core,
            name=name,
            namespace=self._namespace,
            instance_id=self._instance_id,
        )


class AdminClient:
    """Unified admin client — db, storage, auth access via Service Key.

    Args:
        base_url: The EdgeBase server URL.
        service_key: The service key for admin operations.
    """

    def __init__(self, base_url: str, *, service_key: str) -> None:
        self._http = HttpClient(base_url, service_key=service_key)
        self._core = GeneratedDbApi(self._http)
        self._admin = GeneratedAdminApi(self._http)
        self.admin_auth = AdminAuthClient(self._http)
        self._functions = FunctionsClient(self._http)
        self._analytics = AnalyticsClient(self._core, self._admin)
        self._push = PushClient(self._http)

    def db(self, namespace: str = "shared", instance_id: str | None = None) -> DbRef:
        """Get a DbRef for the given namespace.

        Args:
            namespace: DB block namespace, e.g. 'shared', 'workspace'.
            instance_id: Optional dynamic DO instance ID.
        """
        return DbRef(self._core, namespace, instance_id)

    def storage(self) -> StorageClient:
        """Get the StorageClient for file operations."""
        return StorageClient(self._http)

    def sql(
        self,
        namespace: str = "shared",
        instance_id: str | None = None,
        query: str = "",
        params: list[Any] | None = None,
    ) -> list[Any]:
        """Execute raw SQL on a DB namespace."""
        if not query.strip():
            raise ValueError("admin.sql() requires a non-empty query string.")
        body: dict[str, Any] = {
            "namespace": namespace,
            "sql": query,
            "params": params or [],
        }
        if instance_id is not None:
            body["id"] = instance_id
        result = self._admin.execute_sql(body)
        if isinstance(result, dict) and isinstance(result.get("rows"), list):
            return result["rows"]
        return result if isinstance(result, list) else []

    def kv(self, namespace: str) -> KvClient:
        """Get a KvClient for the named KV namespace."""
        return KvClient(self._http, namespace)

    def d1(self, database: str) -> D1Client:
        """Get a D1Client for the named D1 database."""
        return D1Client(self._http, database)

    def vector(self, index: str) -> VectorizeClient:
        """Get a VectorizeClient for the named Vectorize index.

        Args:
            index: The Vectorize index name, e.g. 'embeddings'.
        """
        return VectorizeClient(self._http, index)

    def vectorize(self, index: str) -> VectorizeClient:
        """Backwards-compatible alias for vector()."""
        return self.vector(index)

    def push(self) -> PushClient:
        """Get the PushClient for push notification management."""
        return self._push

    def functions(self) -> FunctionsClient:
        """Get the FunctionsClient for calling app functions."""
        return self._functions

    def analytics(self) -> AnalyticsClient:
        """Get the AnalyticsClient for metrics and custom events."""
        return self._analytics

    def broadcast(
        self,
        channel: str,
        event: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Send a broadcast message to a database-live channel."""
        self._admin.database_live_broadcast(
            {
                "channel": channel,
                "event": event,
                "payload": payload or {},
            },
        )

    def destroy(self) -> None:
        """Close the underlying HTTP client."""
        self._http.close()
