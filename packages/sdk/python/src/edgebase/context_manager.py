"""EdgeBase Python SDK — legacy isolateBy context compatibility."""

from __future__ import annotations

from typing import Any


class ContextManager:
    """Stores legacy isolateBy context without serializing HTTP headers.

    The 'auth.id' key is silently filtered — it is set server-side from the JWT.
    """

    def __init__(self) -> None:
        self._context: dict[str, Any] = {}

    def set_context(self, ctx: dict[str, Any]) -> None:
        """Set context keys (replaces existing context)."""
        filtered = {k: v for k, v in ctx.items() if k != "auth.id"}
        self._context = filtered

    def get_context(self) -> dict[str, Any]:
        """Return a copy of the current context."""
        return dict(self._context)

    def clear_context(self) -> None:
        """Clear all context keys."""
        self._context = {}
