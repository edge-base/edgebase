"""EdgeBase Python SDK — Table type re-exports for convenience imports.

Allows: from edgebase.table import FilterTuple, DbChange
"""

from edgebase_core.table import FilterTuple, DbChange

__all__ = ["FilterTuple", "DbChange"]
