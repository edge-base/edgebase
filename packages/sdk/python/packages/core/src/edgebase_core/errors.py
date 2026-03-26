"""EdgeBase error types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class EdgeBaseError(Exception):
    """Base error for all EdgeBase API errors."""

    status_code: int
    message: str
    details: dict[str, list[str]] | None = field(default=None)

    def __str__(self) -> str:
        parts = [f"EdgeBaseError({self.status_code}): {self.message}"]
        if self.details:
            for k, v in self.details.items():
                rendered = ", ".join(str(item) for item in v) if isinstance(v, list) else str(v)
                parts.append(f"  {k}: {rendered}")
        return "\n".join(parts)

    @classmethod
    def from_json(cls, data: dict[str, Any], status_code: int) -> EdgeBaseError:
        """Create from API JSON response."""
        return cls(
            status_code=status_code,
            message=data.get("message")
            or data.get("error")
            or f"Request failed with HTTP {status_code} and no error message from the server.",
            details=data.get("details"),
        )


@dataclass
class EdgeBaseAuthError(EdgeBaseError):
    """Authentication-specific error."""

    def __str__(self) -> str:
        return f"EdgeBaseAuthError({self.status_code}): {self.message}"
