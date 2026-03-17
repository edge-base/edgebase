"""EdgeBase Core SDK — shared types, HTTP client, table, storage."""

from edgebase_core.http_client import HttpClient
from edgebase_core.table import TableRef, DocRef, ListResult
from edgebase_core.storage import StorageClient, StorageBucket
from edgebase_core.field_ops import FieldOps
from edgebase_core.context_manager import ContextManager
from edgebase_core.errors import EdgeBaseError
from edgebase_core.push import PushClient

# Convenience aliases
increment = FieldOps.increment
delete_field = FieldOps.delete_field
