"""PushClient — Push notification management for Admin SDK.

Usage::

    import os

    admin = EdgeBaseServer('https://...', service_key=os.environ['EDGEBASE_SERVICE_KEY'])
    result = client.push.send('userId', {'title': 'Hello', 'body': 'World'})
    result = client.push.send_many(['u1', 'u2'], {'title': 'News'})
    logs = client.push.get_logs('userId')
"""

from __future__ import annotations

from typing import Any

from edgebase_admin.generated.admin_api_core import GeneratedAdminApi
from edgebase_core.http_client import HttpClient


class PushClient:
    """Client for push notification operations."""

    def __init__(self, http_client: HttpClient) -> None:
        self._http = http_client
        self._admin_core = GeneratedAdminApi(http_client)

    def send(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send a push notification to a single user's devices."""
        return self._admin_core.push_send({"userId": user_id, "payload": payload})

    def send_many(self, user_ids: list[str], payload: dict[str, Any]) -> dict[str, Any]:
        """Send a push notification to multiple users (no limit — server chunks internally)."""
        return self._admin_core.push_send_many({"userIds": user_ids, "payload": payload})

    def send_to_token(
        self, token: str, payload: dict[str, Any], platform: str | None = None
    ) -> dict[str, Any]:
        """Send a push notification directly to a specific FCM token."""
        return self._admin_core.push_send_to_token(
            {"token": token, "payload": payload, **({"platform": platform} if platform else {})},
        )

    def get_tokens(self, user_id: str) -> list[dict[str, Any]]:
        """Get registered device tokens for a user — token values NOT exposed."""
        res = self._admin_core.get_push_tokens({"userId": user_id})
        return res.get("items", []) if isinstance(res, dict) else []

    def get_logs(self, user_id: str, limit: int | None = None) -> list[dict[str, Any]]:
        """Get push send logs for a user (last 24 hours)."""
        params: dict[str, str] = {"userId": user_id}
        if limit is not None:
            params["limit"] = str(limit)
        res = self._admin_core.get_push_logs(params)
        return res.get("items", []) if isinstance(res, dict) else []

    def send_to_topic(self, topic: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Send a push notification to an FCM topic."""
        return self._admin_core.push_send_to_topic({"topic": topic, "payload": payload})

    def broadcast(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Broadcast a push notification to all devices via /topics/all."""
        return self._admin_core.push_broadcast({"payload": payload})
