"""D1Client — D1 database access for server-side use.

Usage::

    import os

    admin = EdgeBaseServer('https://...', service_key=os.environ['EDGEBASE_SERVICE_KEY'])
    rows = admin.d1('analytics').exec('SELECT * FROM events WHERE type = ?', ['pageview'])
"""

from __future__ import annotations

from typing import Any

from edgebase_admin.generated.admin_api_core import GeneratedAdminApi
from edgebase_core.http_client import HttpClient


class D1Client:
    """Client for a user-defined D1 database."""

    def __init__(self, http_client: HttpClient, database: str) -> None:
        self._http = http_client
        self._admin_core = GeneratedAdminApi(http_client)
        self._database = database

    def exec(self, query: str, params: list[Any] | None = None) -> list[Any]:
        """Execute a SQL query. Use ? placeholders for bind parameters.

        All SQL is allowed (DDL included) — Service Key holders are admin-level trusted.

        Args:
            query: SQL query string with ? placeholders.
            params: Bind parameters.

        Returns:
            List of result rows.
        """
        body: dict[str, Any] = {"query": query}
        if params is not None:
            body["params"] = params
        res = self._admin_core.execute_d1_query(self._database, body)
        return res.get("results", [])

    def query(self, query: str, params: list[Any] | None = None) -> list[Any]:
        """Alias for exec() to match SDK parity across runtimes."""
        return self.exec(query, params)
