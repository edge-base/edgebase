"""VectorizeClient — Vectorize index access for server-side use.

Usage::

    import os

    admin = EdgeBaseServer('https://...', service_key=os.environ['EDGEBASE_SERVICE_KEY'])
    admin.vector('embeddings').upsert([{'id': 'doc-1', 'values': [0.1, 0.2, ...]}])
    results = admin.vector('embeddings').search([0.1, 0.2, ...], top_k=10)

Note: Vectorize is Cloudflare Edge-only. In local/Docker, the server returns stub responses.
"""

from __future__ import annotations

from typing import Any

from edgebase_admin.generated.admin_api_core import GeneratedAdminApi
from edgebase_core.http_client import HttpClient


class VectorizeClient:
    """Client for a user-defined Vectorize index."""

    def __init__(self, http_client: HttpClient, index: str) -> None:
        self._http = http_client
        self._admin_core = GeneratedAdminApi(http_client)
        self._index = index

    def upsert(self, vectors: list[dict[str, Any]]) -> dict[str, Any]:
        """Insert or update vectors.

        Each vector dict should have 'id' (str) and 'values' (list[float]).
        Optional 'metadata' (dict) and 'namespace' (str).

        Returns dict with 'ok', optional 'count' and 'mutationId'.
        """
        res = self._admin_core.vectorize_operation(
            self._index,
            {
                "action": "upsert",
                "vectors": vectors,
            },
        )
        return res

    def insert(self, vectors: list[dict[str, Any]]) -> dict[str, Any]:
        """Insert vectors (errors on duplicate ID — server returns 409).

        Each vector dict should have 'id' (str) and 'values' (list[float]).
        Optional 'metadata' (dict) and 'namespace' (str).

        Returns dict with 'ok', optional 'count' and 'mutationId'.
        """
        res = self._admin_core.vectorize_operation(
            self._index,
            {
                "action": "insert",
                "vectors": vectors,
            },
        )
        return res

    def search(
        self,
        vector: list[float],
        *,
        top_k: int = 10,
        filter: dict[str, Any] | None = None,
        namespace: str | None = None,
        return_values: bool | None = None,
        return_metadata: str | None = None,
    ) -> list[dict[str, Any]]:
        """Search for similar vectors.

        Returns list of matches with 'id', 'score', and optional 'metadata', 'values', 'namespace'.
        """
        body: dict[str, Any] = {
            "action": "search",
            "vector": vector,
            "topK": top_k,
        }
        if filter is not None:
            body["filter"] = filter
        if namespace is not None:
            body["namespace"] = namespace
        if return_values is not None:
            body["returnValues"] = return_values
        if return_metadata is not None:
            body["returnMetadata"] = return_metadata
        res = self._admin_core.vectorize_operation(self._index, body)
        return res.get("matches", [])

    def query_by_id(
        self,
        vector_id: str,
        *,
        top_k: int = 10,
        filter: dict[str, Any] | None = None,
        namespace: str | None = None,
        return_values: bool | None = None,
        return_metadata: str | None = None,
    ) -> list[dict[str, Any]]:
        """Search by an existing vector's ID (Vectorize v2 only).

        Returns list of matches with 'id', 'score', and optional 'metadata', 'values', 'namespace'.
        """
        body: dict[str, Any] = {
            "action": "queryById",
            "vectorId": vector_id,
            "topK": top_k,
        }
        if filter is not None:
            body["filter"] = filter
        if namespace is not None:
            body["namespace"] = namespace
        if return_values is not None:
            body["returnValues"] = return_values
        if return_metadata is not None:
            body["returnMetadata"] = return_metadata
        res = self._admin_core.vectorize_operation(self._index, body)
        return res.get("matches", [])

    def get_by_ids(self, ids: list[str]) -> list[dict[str, Any]]:
        """Retrieve vectors by their IDs.

        Returns list of dicts with 'id', 'values', optional 'metadata' and 'namespace'.
        """
        res = self._admin_core.vectorize_operation(
            self._index,
            {
                "action": "getByIds",
                "ids": ids,
            },
        )
        return res.get("vectors", [])

    def delete(self, ids: list[str]) -> dict[str, Any]:
        """Delete vectors by IDs.

        Returns dict with 'ok', optional 'count' and 'mutationId'.
        """
        res = self._admin_core.vectorize_operation(
            self._index,
            {
                "action": "delete",
                "ids": ids,
            },
        )
        return res

    def describe(self) -> dict[str, Any]:
        """Get index info (vector count, dimensions, metric).

        Returns dict with 'vectorCount', 'dimensions', 'metric'.
        """
        res = self._admin_core.vectorize_operation(
            self._index,
            {"action": "describe"},
        )
        return res
