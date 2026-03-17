"""Context manager for legacy isolateBy compatibility state.

: auth.id isolation uses JWT extraction server-side.
The 'auth.id' key is silently filtered from context to prevent
client-side override attempts.
"""

from __future__ import annotations

from typing import Any


class ContextManager:
    """Thread-safe context storage retained for compatibility helpers."""

    def __init__(self) -> None:
        self._context: dict[str, Any] = {}

    def set_context(self, context: dict[str, Any]) -> None:
        # Filter out auth.id — server extracts from JWT only
        self._context = {k: v for k, v in context.items() if k != "auth.id"}

    def get_context(self) -> dict[str, Any]:
        return dict(self._context)

    def clear_context(self) -> None:
        self._context = {}
