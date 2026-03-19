"""EdgeBase Python SDK — server-side only.

Python SDK is server-only: use with a Service Key for admin operations.

Usage::

    import os
    from edgebase import EdgeBaseServer

    admin = EdgeBaseServer('https://your-project.edgebase.fun',
                        service_key=os.environ['EDGEBASE_SERVICE_KEY'])

    # Admin Auth
    user = admin.admin_auth.get_user('user-id')
    admin.admin_auth.set_custom_claims('user-id', {'role': 'pro'})

    # Database (Service Key bypasses access rules) — #133 §2
    posts = admin.db('shared').table('posts').where('status', '==', 'published').get_list()

    # Per-workspace DB
    docs = admin.db('workspace', 'ws-456').table('documents').get_list()

    # Raw SQL (#136 §11)
    rows = admin.sql('shared', None, 'SELECT id, title FROM posts WHERE published = ?', [1])

    # Storage
    url = admin.storage.bucket('avatars').get_url('profile.png')
"""

from __future__ import annotations

from typing import Any

from edgebase_admin.admin_auth import AdminAuthClient
from edgebase_admin.generated.admin_api_core import GeneratedAdminApi
from edgebase_core.table import TableRef
from edgebase_admin.d1 import D1Client
from edgebase_core.generated.api_core import GeneratedDbApi
from edgebase_core.http_client import HttpClient
from edgebase_admin.kv import KvClient
from edgebase_core.storage import StorageClient
from edgebase_admin.vectorize import VectorizeClient


class PushAdminClient:
    """Server-side push notification client.

    Usage::

        result = admin.push.send('user-id', {'title': 'Hello', 'body': 'World'})
        # result = {'sent': 1, 'failed': 0}
    """

    def __init__(self, http: HttpClient, admin_core: GeneratedAdminApi) -> None:
        self._http = http
        self._admin_core = admin_core

    def send(self, user_id: str, notification: dict[str, Any]) -> dict[str, Any]:
        """Send a push notification to a user by their ID.

        Args:
            user_id: The user's ID to send the notification to.
            notification: Notification payload with at minimum 'title' and 'body'.

        Returns:
            Dict with 'sent' and 'failed' counts.
        """
        result = self._admin_core.push_send(
            {"userId": user_id, "notification": notification},
        )
        if isinstance(result, dict):
            return result
        return {"sent": 0, "failed": 0}


class DbRef:
    """Reference to a DB namespace block, returned by EdgeBaseServer.db().

    Use .table(name) to get a TableRef for CRUD operations (#133 §2).
    """

    def __init__(self, core: GeneratedDbApi, namespace: str, instance_id: str | None = None) -> None:
        self._core = core
        self._namespace = namespace
        self._instance_id = instance_id

    def table(self, name: str) -> TableRef:
        """Get a table reference for CRUD operations.

        Usage::

            posts = admin.db('shared').table('posts')
            result = posts.where('status', '==', 'published').get()
        """
        return TableRef(
            self._core,
            name,
            database_live=None,
            namespace=self._namespace,
            instance_id=self._instance_id,
        )


class EdgeBaseServer:
    """Server-side EdgeBase SDK entry point.

    Python SDK is server-only:
    - No auth client (signUp/signIn are client-side operations)
    - No database-live/presence/channel (WebSocket is client-side)
    - Exposes: admin_auth, db, storage, sql, broadcast

    Usage::

        import os

        admin = EdgeBaseServer('https://your-project.edgebase.fun',
                            service_key=os.environ['EDGEBASE_SERVICE_KEY'])
    """

    def __init__(
        self,
        url: str,
        *,
        service_key: str | None = None,
        bearer_token: str | None = None,
    ) -> None:
        """
        Args:
            url: EdgeBase project URL.
            service_key: Service Key for admin operations and rule bypass.
            bearer_token: Optional Bearer token for impersonating a user (advanced).
        """
        self._base_url = url.rstrip("/")
        self._http_client = HttpClient(
            base_url=self._base_url,
            service_key=service_key,
            bearer_token=bearer_token,
        )
        self._core = GeneratedDbApi(self._http_client)
        self._admin_core = GeneratedAdminApi(self._http_client)
        self.admin_auth = AdminAuthClient(self._http_client)
        self.storage = StorageClient(self._http_client)
        self.push = PushAdminClient(self._http_client, self._admin_core)

    # MARK: - DB (#133 §2)

    def db(self, namespace: str, instance_id: str | None = None) -> DbRef:
        """Select a DB block by namespace and optional instance ID (#133 §2).

        Args:
            namespace: DB block key (e.g. 'shared', 'workspace', 'user').
            instance_id: Instance ID for dynamic DOs (e.g. 'ws-456').

        Usage::

            posts = admin.db('shared').table('posts')
            docs = admin.db('workspace', 'ws-456').table('documents')
        """
        return DbRef(self._core, namespace, instance_id)

    # MARK: - Raw SQL (#136 §11)

    def sql(
        self,
        namespace: str = "shared",
        instance_id: str | None = None,
        query: str = "",
        params: list[Any] | None = None,
        *,
        table: str | None = None,
    ) -> list[Any]:
        """Execute raw SQL on a DB DO (#136 §11).

        Two calling styles are supported::

            # Positional (original API):
            rows = admin.sql('shared', None, 'SELECT * FROM posts', [])

            # Keyword shorthand (table= implies namespace='shared', instance_id=None):
            rows = admin.sql(table='posts', query='SELECT * FROM posts WHERE views > ?', params=[5])
        """
        # Keyword shorthand: table= overrides namespace/instance_id
        if table is not None:
            namespace = "shared"
            instance_id = None
        body: dict[str, Any] = {
            "namespace": namespace,
            "sql": query,
            "params": params or [],
        }
        if instance_id is not None:
            body["id"] = instance_id
        return self._admin_core.execute_sql(body)

    # MARK: - KV / D1 / Vectorize

    def kv(self, namespace: str) -> KvClient:
        """Access a user-defined KV namespace.

        Usage::

            admin.kv('cache').set('key', 'value', ttl=300)
            val = admin.kv('cache').get('key')
        """
        return KvClient(self._http_client, namespace)

    def d1(self, database: str) -> D1Client:
        """Access a user-defined D1 database.

        Usage::

            rows = admin.d1('analytics').exec('SELECT * FROM events WHERE type = ?', ['click'])
        """
        return D1Client(self._http_client, database)

    def vectorize(self, index: str) -> VectorizeClient:
        """Access a user-defined Vectorize index.

        Usage::

            results = admin.vectorize('embeddings').search([0.1, 0.2], top_k=5)
        """
        return VectorizeClient(self._http_client, index)

    def broadcast(self, channel: str, event: str, payload: dict[str, Any] | None = None) -> None:
        """Send a broadcast message to a database-live channel."""
        self._admin_core.database_live_broadcast(
            {
                "channel": channel,
                "event": event,
                "payload": payload or {},
            },
        )

    # MARK: - Cleanup

    def destroy(self) -> None:
        """Close the HTTP client."""
        self._http_client.close()


# Backwards-compatible alias
EdgeBase = EdgeBaseServer
