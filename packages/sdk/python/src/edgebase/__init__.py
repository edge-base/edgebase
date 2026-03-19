"""EdgeBase Python SDK — server-side only."""

from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Optional


@dataclass
class EdgeBaseOptions:
    """SDK options for EdgeBase initialization."""

    token_storage: Optional[Any] = None
    service_key: Optional[str] = None
    base_url: str = ""


from edgebase.client import EdgeBaseServer, EdgeBase  # EdgeBase is alias for backwards compat
from edgebase.token_manager import MemoryTokenStorage, TokenPair, TokenManager
from edgebase_core.errors import EdgeBaseError, EdgeBaseAuthError
from edgebase_core.field_ops import FieldOps
from edgebase_core.table import TableRef, DocRef, ListResult, BatchResult, UpsertResult
from edgebase_core.storage import StorageClient, StorageBucket, SignedUrlResult, FileInfo
from edgebase_admin.admin_auth import AdminAuthClient
from edgebase_admin.kv import KvClient
from edgebase_admin.d1 import D1Client
from edgebase_admin.vectorize import VectorizeClient
from edgebase.room import RoomClient, Subscription

try:
    __version__ = version("edgebase")
except PackageNotFoundError:
    __version__ = "0.1.4"

__all__ = [
    "EdgeBaseServer",
    "EdgeBase",  # backwards-compatible alias
    "EdgeBaseOptions",
    "EdgeBaseError",
    "EdgeBaseAuthError",
    "FieldOps",
    "MemoryTokenStorage",
    "TokenPair",
    "TokenManager",
    "TableRef",
    "DocRef",
    "ListResult",
    "BatchResult",
    "UpsertResult",
    "StorageClient",
    "StorageBucket",
    "SignedUrlResult",
    "FileInfo",
    "AdminAuthClient",
    "KvClient",
    "D1Client",
    "VectorizeClient",
    "RoomClient",
    "Subscription",
]
