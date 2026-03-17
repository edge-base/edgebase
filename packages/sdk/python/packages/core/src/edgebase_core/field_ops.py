"""Field operation helpers for atomic updates."""

from __future__ import annotations

from typing import Any


class FieldOps:
    """Atomic field operation markers ($op pattern — mirrors JS SDK, server op-parser.ts)."""

    @staticmethod
    def increment(value: int | float = 1) -> dict[str, Any]:
        """Increment a numeric field atomically.

        Usage::

            doc_ref.update({"views": FieldOps.increment(1)})
            doc_ref.update({"score": FieldOps.increment(-5)})
        """
        return {"$op": "increment", "value": value}

    @staticmethod
    def delete_field() -> dict[str, str]:
        """Delete a field from a document.

        Usage::

            doc_ref.update({"oldField": FieldOps.delete_field()})
        """
        return {"$op": "deleteField"}


# Standalone module-level functions — enable `from edgebase_core.field_ops import increment, delete_field`
def increment(value: int | float = 1) -> dict[str, Any]:
    """Increment a numeric field atomically. See :meth:`FieldOps.increment`."""
    return FieldOps.increment(value)


def delete_field() -> dict[str, str]:
    """Delete a field from a document. See :meth:`FieldOps.delete_field`."""
    return FieldOps.delete_field()


def serialize_field_ops(data: dict[str, Any]) -> dict[str, Any]:
    """Pass through data dict, preserving field-op markers as-is.

    Field ops (``increment()``, ``delete_field()``) already produce the
    ``{"$op": ...}`` dict that the server expects, so this function simply
    returns a shallow copy.
    """
    return {k: v for k, v in data.items()}
