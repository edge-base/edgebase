"""Admin authentication client — Service Key-based user management.

Python SDK is server-only: AdminAuthClient validates the service key is present
before making any request. Without a service key the server always returns 403,
so we short-circuit locally to save a round-trip and give a clear error.
"""

from __future__ import annotations

from typing import Any

from edgebase_core.errors import EdgeBaseError
from edgebase_core.http_client import HttpClient


class AdminAuthClient:
    """Admin auth — server-side user management via Service Key.

    Usage::

        user = admin.admin_auth.get_user("user-id")
        new_user = admin.admin_auth.create_user(
            email="admin@example.com", password="secure"
        )
        admin.admin_auth.set_custom_claims("user-id", {"role": "pro"})
        admin.admin_auth.revoke_all_sessions("user-id")
    """

    def __init__(self, client: HttpClient) -> None:
        self._client = client

    # ── Guard ─────────────────────────────────────────────────────────────────

    def _require_service_key(self) -> None:
        """Raise EdgeBaseError(403) locally if no service key is configured.

        All admin operations require a service key.
        Failing fast here avoids an unnecessary network round-trip and surfaces
        the misconfiguration immediately with a clear error message.
        """
        if not getattr(self._client, "_service_key", None):
            raise EdgeBaseError(
                status_code=403,
                message="Service Key required for admin operations. "
                "Pass service_key= when constructing EdgeBaseServer.",
            )

    @staticmethod
    def _unwrap_user_payload(payload: dict[str, Any]) -> dict[str, Any]:
        user = payload.get("user")
        if isinstance(user, dict):
            merged = dict(user)
            for key, value in payload.items():
                if key != "user" and key not in merged:
                    merged[key] = value
            return merged
        return payload

    # ── Public API ────────────────────────────────────────────────────────────

    def get_user(self, user_id: str) -> dict[str, Any]:
        """Get a user by ID."""
        self._require_service_key()
        result = self._client.get(f"/auth/admin/users/{user_id}")
        return self._unwrap_user_payload(result if isinstance(result, dict) else {})

    def create_user(
        self,
        email: str,
        password: str,
        data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a new user."""
        self._require_service_key()
        body: dict[str, Any] = {"email": email, "password": password}
        if data:
            body["data"] = data
        result = self._client.post("/auth/admin/users", body)
        return self._unwrap_user_payload(result if isinstance(result, dict) else {})

    def update_user(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Update a user."""
        self._require_service_key()
        result = self._client.patch(f"/auth/admin/users/{user_id}", data)
        return self._unwrap_user_payload(result if isinstance(result, dict) else {})

    def delete_user(self, user_id: str) -> dict[str, Any]:
        """Delete a user."""
        self._require_service_key()
        return self._client.delete(f"/auth/admin/users/{user_id}")

    def list_users(
        self,
        limit: int = 20,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """List users with cursor-based pagination.

        Args:
            limit: Maximum number of users to return (default 20).
            cursor: Pagination cursor from previous response.

        Returns:
            Dict with 'users' list and optional 'cursor' for next page.
        """
        self._require_service_key()
        params: dict[str, str] = {"limit": str(limit)}
        if cursor:
            params["cursor"] = cursor
        result = self._client.get("/auth/admin/users", params)
        return result if isinstance(result, dict) else {"users": [], "cursor": None}

    def set_custom_claims(
        self,
        user_id: str,
        claims: dict[str, Any],
    ) -> None:
        """Set custom claims for a user (reflected in JWT on next token refresh)."""
        self._require_service_key()
        self._client.put(f"/auth/admin/users/{user_id}/claims", claims)

    def revoke_all_sessions(self, user_id: str) -> None:
        """Revoke all sessions for a user (force re-authentication)."""
        self._require_service_key()
        self._client.post(f"/auth/admin/users/{user_id}/revoke")

    def disable_mfa(self, user_id: str) -> None:
        """Disable MFA for a user (admin operation via Service Key).

        Removes all MFA factors for the specified user, allowing them
        to sign in without MFA verification.

        Args:
            user_id: The user's ID whose MFA should be disabled.
        """
        self._require_service_key()
        self._client.delete(f"/auth/admin/users/{user_id}/mfa")
