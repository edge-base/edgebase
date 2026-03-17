"""FunctionsClient — call EdgeBase App Functions from the admin SDK."""

from __future__ import annotations

from typing import Any

from edgebase_core.http_client import HttpClient


class FunctionsClient:
    """Client for calling app functions with the admin service key."""

    def __init__(self, http_client: HttpClient) -> None:
        self._http = http_client

    def call(
        self,
        path: str,
        *,
        method: str = "POST",
        body: Any = None,
        query: dict[str, str] | None = None,
    ) -> Any:
        normalized_path = f"/functions/{path.lstrip('/')}"
        normalized_method = method.upper()

        if normalized_method == "GET":
            return self._http.get(normalized_path, params=query)
        if normalized_method == "PUT":
            return self._http.put(normalized_path, body)
        if normalized_method == "PATCH":
            return self._http.patch(normalized_path, body)
        if normalized_method == "DELETE":
            return self._http.delete(normalized_path)
        return self._http.post(normalized_path, body)

    def get(self, path: str, *, query: dict[str, str] | None = None) -> Any:
        return self.call(path, method="GET", query=query)

    def post(self, path: str, body: Any = None) -> Any:
        return self.call(path, method="POST", body=body)

    def put(self, path: str, body: Any = None) -> Any:
        return self.call(path, method="PUT", body=body)

    def patch(self, path: str, body: Any = None) -> Any:
        return self.call(path, method="PATCH", body=body)

    def delete(self, path: str) -> Any:
        return self.call(path, method="DELETE")
