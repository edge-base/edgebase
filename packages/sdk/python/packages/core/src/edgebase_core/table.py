"""Table reference & document reference — immutable query builder.

All HTTP calls delegate to Generated Core (api_core.py).
No hardcoded API paths — the core is the single source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from edgebase_core.generated.api_core import GeneratedDbApi


# MARK: - Data types


@dataclass
class FilterTuple:
    """Query filter tuple."""

    field_name: str
    op: str
    value: Any

    def to_json(self) -> list[Any]:
        return [self.field_name, self.op, self.value]


class OrBuilder:
    """Builder for OR conditions."""

    def __init__(self) -> None:
        self._filters: list[FilterTuple] = []

    def where(self, field_name: str, op: str, value: Any) -> "OrBuilder":
        self._filters.append(FilterTuple(field_name, op, value))
        return self

    def get_filters(self) -> list[FilterTuple]:
        return list(self._filters)


@dataclass
class ListResult:
    """Collection query result — unified type for offset and cursor pagination.

: SDK ListResult unification + cursor pagination support.

    Offset mode (default):  total/page/perPage are populated, hasMore/cursor are None.
    Cursor mode (.after/.before): hasMore/cursor are populated, total/page/perPage are None.
    Rules-filtered mode:    total is None, hasMore/cursor are populated.
    """

    items: list[dict[str, Any]]
    total: int | None = None
    page: int | None = None
    per_page: int | None = None
    has_more: bool | None = None
    cursor: str | None = None


@dataclass
class BatchResult:
    """Batch operation result."""

    total_processed: int
    total_succeeded: int
    errors: list[dict]


@dataclass
class UpsertResult:
    """Upsert operation result."""

    record: dict[str, Any]
    inserted: bool


@dataclass
class DbChange:
    """DatabaseLive database change event."""

    event: str
    table: str
    id: str | None = None
    record: dict[str, Any] | None = None
    old_record: dict[str, Any] | None = None

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> DbChange:
        return cls(
            event=data.get("event", ""),
            table=data.get("table", ""),
            id=data.get("id"),
            record=data.get("record"),
            old_record=data.get("oldRecord"),
        )


def _build_database_live_channel(
    namespace: str,
    table: str,
    instance_id: str | None = None,
    doc_id: str | None = None,
) -> str:
    base = f"dblive:{namespace}:{table}" if instance_id is None else f"dblive:{namespace}:{instance_id}:{table}"
    return base if doc_id is None else f"{base}:{doc_id}"


# MARK: - Core dispatch helpers


def _core_get(
    core: GeneratedDbApi,
    method: str,
    namespace: str,
    instance_id: str | None,
    table: str,
    *,
    doc_id: str | None = None,
    query: dict[str, str] | None = None,
) -> Any:
    """Call the correct generated core method based on single-instance vs dynamic DB."""
    if instance_id:
        # Dynamic DB
        if method == "list":
            return core.db_list_records(namespace, instance_id, table, query)
        if method == "get":
            return core.db_get_record(namespace, instance_id, table, doc_id, query)
        if method == "count":
            return core.db_count_records(namespace, instance_id, table, query)
        if method == "search":
            return core.db_search_records(namespace, instance_id, table, query)
    # Single-instance DB
    if method == "list":
        return core.db_single_list_records(namespace, table, query)
    if method == "get":
        return core.db_single_get_record(namespace, table, doc_id, query)
    if method == "count":
        return core.db_single_count_records(namespace, table, query)
    if method == "search":
        return core.db_single_search_records(namespace, table, query)


def _core_insert(
    core: GeneratedDbApi,
    namespace: str,
    instance_id: str | None,
    table: str,
    body: Any,
    query: dict[str, str] | None = None,
) -> Any:
    if instance_id:
        return core.db_insert_record(namespace, instance_id, table, body, query)
    return core.db_single_insert_record(namespace, table, body, query)


def _core_update(
    core: GeneratedDbApi,
    namespace: str,
    instance_id: str | None,
    table: str,
    doc_id: str,
    body: Any,
) -> Any:
    if instance_id:
        return core.db_update_record(namespace, instance_id, table, doc_id, body)
    return core.db_single_update_record(namespace, table, doc_id, body)


def _core_delete(
    core: GeneratedDbApi,
    namespace: str,
    instance_id: str | None,
    table: str,
    doc_id: str,
) -> Any:
    if instance_id:
        return core.db_delete_record(namespace, instance_id, table, doc_id)
    return core.db_single_delete_record(namespace, table, doc_id)


def _core_batch(
    core: GeneratedDbApi,
    namespace: str,
    instance_id: str | None,
    table: str,
    body: Any,
    query: dict[str, str] | None = None,
) -> Any:
    if instance_id:
        return core.db_batch_records(namespace, instance_id, table, body, query)
    return core.db_single_batch_records(namespace, table, body, query)


def _core_batch_by_filter(
    core: GeneratedDbApi,
    namespace: str,
    instance_id: str | None,
    table: str,
    body: Any,
) -> Any:
    if instance_id:
        return core.db_batch_by_filter(namespace, instance_id, table, body)
    return core.db_single_batch_by_filter(namespace, table, body)


# MARK: - TableRef


class TableRef:
    """Immutable table reference with query builder.

    All chaining methods return a new instance — safe for reference sharing.
    All HTTP calls delegate to Generated Core (no hardcoded paths).

    Usage::

        posts = client.db("shared").table("posts")
        result = posts.where("status", "==", "published") \\
            .order_by("createdAt", "desc") \\
            .limit(20) \\
            .get_list()
    """

    def __init__(
        self,
        core: GeneratedDbApi,
        name: str,
        database_live: Any = None,
        *,
        namespace: str = "shared",
        instance_id: str | None = None,
        filters: list[FilterTuple] | None = None,
        or_filters: list[FilterTuple] | None = None,
        sorts: list[tuple[str, str]] | None = None,
        limit_value: int | None = None,
        offset_value: int | None = None,
        page_value: int | None = None,
        search_value: str | None = None,
        after_value: str | None = None,
        before_value: str | None = None,
    ) -> None:
        self._core = core
        self._name = name
        self._database_live = database_live
        # DB namespace + optional instance ID (#133 §2)
        self._namespace = namespace
        self._instance_id = instance_id
        self._filters = filters or []
        self._or_filters = or_filters or []
        self._sorts = sorts or []
        self._limit = limit_value
        self._offset = offset_value
        self._page = page_value
        self._search = search_value
        self._after = after_value
        self._before = before_value

    # MARK: - Query Builder (immutable)

    def where(self, field_name: str, op: str, value: Any) -> TableRef:
        return self._clone(filters=[*self._filters, FilterTuple(field_name, op, value)])

    def or_(self, builder_fn: Callable[[OrBuilder], OrBuilder]) -> TableRef:
        """Add OR conditions."""
        builder = builder_fn(OrBuilder())
        return self._clone(or_filters=[*self._or_filters, *builder.get_filters()])

    def order_by(self, field_name: str, direction: str = "asc") -> TableRef:
        return self._clone(sorts=[*self._sorts, (field_name, direction)])

    def limit(self, n: int) -> TableRef:
        return self._clone(limit_value=n)

    def offset(self, n: int) -> TableRef:
        return self._clone(offset_value=n)

    def page(self, n: int) -> TableRef:
        """Set page number for offset pagination (1-based)."""
        return self._clone(page_value=n)

    def search(self, query: str) -> TableRef:
        return self._clone(search_value=query)

    def after(self, cursor: str) -> TableRef:
        """Set cursor for forward pagination.
        Fetches records with id > cursor. Mutually exclusive with offset().
        """
        return self._clone(after_value=cursor, before_value=None)

    def before(self, cursor: str) -> TableRef:
        """Set cursor for backward pagination.
        Fetches records with id < cursor. Mutually exclusive with offset().
        """
        return self._clone(before_value=cursor, after_value=None)

    # MARK: - CRUD

    def get_list(self) -> ListResult:
        """Execute query and return results."""
        params = self._build_query_params()
        if self._search:
            params["search"] = self._search
            data = _core_get(self._core, "search", self._namespace, self._instance_id, self._name, query=params)
        else:
            data = _core_get(self._core, "list", self._namespace, self._instance_id, self._name, query=params)
        if not isinstance(data, dict):
            return ListResult(items=[])
        items = data.get("items", [])
        return ListResult(
            items=items,
            total=data.get("total"),
            page=data.get("page"),
            per_page=data.get("perPage"),
            has_more=data.get("hasMore"),
            cursor=data.get("cursor"),
        )

    def get_one(self, doc_id: str) -> dict[str, Any]:
        """Get a single record by ID."""
        return _core_get(
            self._core, "get", self._namespace, self._instance_id, self._name,
            doc_id=doc_id, query={},
        )

    def insert(self, record: dict[str, Any]) -> dict[str, Any]:
        return _core_insert(self._core, self._namespace, self._instance_id, self._name, record)

    def upsert(self, record: dict[str, Any], *, conflict_target: str | None = None) -> UpsertResult:
        """Upsert a record."""
        query: dict[str, str] = {"upsert": "true"}
        if conflict_target:
            query["conflictTarget"] = conflict_target
        data = _core_insert(self._core, self._namespace, self._instance_id, self._name, record, query)
        return UpsertResult(
            record=data if isinstance(data, dict) else {},
            inserted=(data.get("action") == "inserted" if isinstance(data, dict) else False),
        )

    def count(self) -> int:
        """Count records matching filters."""
        params = self._build_query_params()
        data = _core_get(self._core, "count", self._namespace, self._instance_id, self._name, query=params)
        return data.get("total", 0) if isinstance(data, dict) else 0

    def update(self, doc_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Update a single record by ID."""
        return _core_update(self._core, self._namespace, self._instance_id, self._name, doc_id, data)

    def delete(self, doc_id: str) -> dict[str, Any]:
        """Delete a single record by ID."""
        return _core_delete(self._core, self._namespace, self._instance_id, self._name, doc_id)

    def get_first(self) -> dict[str, Any] | None:
        """Get the first record matching the current query conditions.
        Returns None if no records match.
        """
        result = self.limit(1).get_list()
        return result.items[0] if result.items else None

    def sql(self, query: str, params: list[Any] | None = None) -> list[Any]:
        """Execute admin SQL scoped to this table's database namespace.

        This helper relies on the underlying HttpClient carrying admin credentials.
        Non-admin clients may receive authorization errors from the server.
        """
        body: dict[str, Any] = {
            "namespace": self._namespace,
            "sql": query,
            "params": params or [],
        }
        if self._instance_id is not None:
            body["id"] = self._instance_id
        data = self._core._http.post("/sql", body)
        return data.get("items", []) if isinstance(data, dict) else []

    # MARK: - Batch

    def insert_many(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Create multiple records. Auto-chunks into 500-item batches."""
        chunk_size = 500

        # Fast path: no chunking needed
        if len(records) <= chunk_size:
            data = _core_batch(self._core, self._namespace, self._instance_id, self._name, {"inserts": records})
            return data.get("inserted", []) if isinstance(data, dict) else []

        # Chunk into 500-item batches
        all_inserted: list[dict[str, Any]] = []
        for i in range(0, len(records), chunk_size):
            chunk = records[i : i + chunk_size]
            data = _core_batch(self._core, self._namespace, self._instance_id, self._name, {"inserts": chunk})
            if isinstance(data, dict):
                all_inserted.extend(data.get("inserted", []))
        return all_inserted

    def upsert_many(
        self, records: list[dict[str, Any]], *, conflict_target: str | None = None
    ) -> list[dict[str, Any]]:
        """Upsert multiple records. Auto-chunks 500 items."""
        chunk_size = 500
        query: dict[str, str] = {"upsert": "true"}
        if conflict_target:
            query["conflictTarget"] = conflict_target

        # Fast path: no chunking needed
        if len(records) <= chunk_size:
            data = _core_batch(self._core, self._namespace, self._instance_id, self._name, {"inserts": records}, query)
            return data.get("inserted", []) if isinstance(data, dict) else []

        # Chunk into 500-item batches
        all_inserted: list[dict[str, Any]] = []
        for i in range(0, len(records), chunk_size):
            chunk = records[i : i + chunk_size]
            data = _core_batch(self._core, self._namespace, self._instance_id, self._name, {"inserts": chunk}, query)
            if isinstance(data, dict):
                all_inserted.extend(data.get("inserted", []))
        return all_inserted

    def update_many(self, update: dict[str, Any]) -> BatchResult:
        """Update records matching query builder filters.
        Processes 500 records per call, max 100 iterations.
        """
        if not self._filters:
            raise ValueError("update_many requires at least one where() filter")
        return self._batch_by_filter("update", update)

    def delete_many(self) -> BatchResult:
        """Delete records matching query builder filters.
        Processes 500 records per call, max 100 iterations.
        """
        if not self._filters:
            raise ValueError("delete_many requires at least one where() filter")
        return self._batch_by_filter("delete", None)

    def _batch_by_filter(self, action: str, update: dict[str, Any] | None) -> BatchResult:
        """Internal: repeated batch-by-filter calls."""
        max_iterations = 100
        total_processed = 0
        total_succeeded = 0
        errors: list[dict] = []
        filter_json = [f.to_json() for f in self._filters]

        for chunk_index in range(max_iterations):
            body: dict[str, Any] = {
                "action": action,
                "filter": filter_json,
                "limit": 500,
            }
            if self._or_filters:
                body["orFilter"] = [f.to_json() for f in self._or_filters]
            if action == "update" and update is not None:
                body["update"] = update

            try:
                data = _core_batch_by_filter(self._core, self._namespace, self._instance_id, self._name, body)
                processed = data.get("processed", 0) if isinstance(data, dict) else 0
                succeeded = data.get("succeeded", 0) if isinstance(data, dict) else 0
                total_processed += processed
                total_succeeded += succeeded

                if processed == 0:
                    break  # No more matching records

                # For 'update', don't loop — updated records still match the filter,
                # so re-querying would process the same rows again (infinite loop).
                # Only 'delete' benefits from looping since deleted rows disappear.
                if action == "update":
                    break
            except Exception as e:
                errors.append({"chunkIndex": chunk_index, "chunkSize": 500, "error": str(e)})
                break  # Stop on error (partial failure)

        return BatchResult(
            total_processed=total_processed,
            total_succeeded=total_succeeded,
            errors=errors,
        )

    # MARK: - Doc

    def doc(self, doc_id: str) -> DocRef:
        return DocRef(
            self._core,
            self._name,
            doc_id,
            self._database_live,
            namespace=self._namespace,
            instance_id=self._instance_id,
        )

    # MARK: - DatabaseLive (callback-based for sync)

    def on_snapshot(self, callback: Callable[[DbChange], None]) -> Callable[[], None]:
        """Subscribe to table changes. Returns unsubscribe function.

        Usage::

            def on_change(change):
                print(change.event, change.record)

            unsubscribe = posts.on_snapshot(on_change)
            # ... later
            unsubscribe()
        """
        if self._database_live is None:
            raise RuntimeError("DatabaseLive not available")
        return self._database_live.subscribe_callback(
            _build_database_live_channel(self._namespace, self._name, self._instance_id),
            callback,
        )

    # MARK: - Internal

    def _clone(self, **kwargs: Any) -> TableRef:
        return TableRef(
            core=self._core,
            name=self._name,
            database_live=self._database_live,
            namespace=self._namespace,
            instance_id=self._instance_id,
            filters=kwargs.get("filters", self._filters),
            or_filters=kwargs.get("or_filters", self._or_filters),
            sorts=kwargs.get("sorts", self._sorts),
            limit_value=kwargs.get("limit_value", self._limit),
            offset_value=kwargs.get("offset_value", self._offset),
            page_value=kwargs.get("page_value", self._page),
            search_value=kwargs.get("search_value", self._search),
            after_value=kwargs.get("after_value", self._after),
            before_value=kwargs.get("before_value", self._before),
        )

    def _build_query_params(self) -> dict[str, str]:
        #: offset/cursor mutual exclusion
        has_cursor = self._after is not None or self._before is not None
        has_offset = self._offset is not None or self._page is not None
        if has_cursor and has_offset:
            raise ValueError(
                "Cannot use page()/offset() with after()/before() — choose offset or cursor pagination"
            )

        params: dict[str, str] = {}
        if self._filters:
            import json

            params["filter"] = json.dumps([f.to_json() for f in self._filters])
        if self._or_filters:
            import json

            params["orFilter"] = json.dumps([f.to_json() for f in self._or_filters])
        if self._sorts:
            params["sort"] = ",".join(f"{f}:{d}" for f, d in self._sorts)
        if self._limit is not None:
            params["limit"] = str(self._limit)
        if self._page is not None:
            params["page"] = str(self._page)
        if self._offset is not None:
            params["offset"] = str(self._offset)
        if self._after is not None:
            params["after"] = self._after
        if self._before is not None:
            params["before"] = self._before
        return params

    def _matches_filters(self, record: dict[str, Any] | None) -> bool:
        if not record or not self._filters:
            return True
        for f in self._filters:
            val = record.get(f.field_name)
            if f.op == "==" and val != f.value:
                return False
            if f.op == "!=" and val == f.value:
                return False
        return True


# MARK: - DocRef


class DocRef:
    """Document reference for single-document operations.

    All HTTP calls delegate to Generated Core (no hardcoded paths).
    """

    def __init__(
        self,
        core: GeneratedDbApi,
        table_name: str,
        doc_id: str,
        database_live: Any = None,
        *,
        namespace: str = "shared",
        instance_id: str | None = None,
    ) -> None:
        self._core = core
        self.table_name = table_name
        self.id = doc_id
        self._database_live = database_live
        self._namespace = namespace
        self._instance_id = instance_id

    def get(self) -> dict[str, Any]:
        return _core_get(
            self._core, "get", self._namespace, self._instance_id, self.table_name,
            doc_id=self.id, query={},
        )

    def update(self, data: dict[str, Any]) -> dict[str, Any]:
        return _core_update(
            self._core, self._namespace, self._instance_id, self.table_name, self.id, data,
        )

    def delete(self) -> dict[str, Any]:
        return _core_delete(
            self._core, self._namespace, self._instance_id, self.table_name, self.id,
        )

    def on_snapshot(self, callback: Callable[[DbChange], None]) -> Callable[[], None]:
        """Subscribe to this document's changes. Returns unsubscribe function."""
        if self._database_live is None:
            raise RuntimeError("DatabaseLive not available")
        return self._database_live.subscribe_callback(
            _build_database_live_channel(self._namespace, self.table_name, self._instance_id, self.id),
            callback,
        )
