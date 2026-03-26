"""
@edge-base/core Python SDK — 단위 테스트

테스트 대상:
  - edgebase_core.table.TableRef (immutable query builder)
  - edgebase_core.table.FilterTuple, ListResult, BatchResult, UpsertResult, OrBuilder
  - edgebase_core.field_ops.FieldOps / increment / delete_field
  - edgebase_core.errors.EdgeBaseError / EdgeBaseAuthError

실행: cd packages/sdk/python/packages/core && pytest tests/test_core_unit.py -v

원칙: 서버 불필요 — 순수 Python 로직만 검증
"""

import pytest
import httpx
from unittest.mock import MagicMock
from edgebase_core.generated.api_core import GeneratedDbApi
from edgebase_core.table import (
    TableRef,
    FilterTuple,
    ListResult,
    BatchResult,
    UpsertResult,
    OrBuilder,
)
from edgebase_core.field_ops import FieldOps, increment, delete_field
from edgebase_core.errors import EdgeBaseError, EdgeBaseAuthError
from edgebase_core.http_client import HttpClient
from edgebase_core.storage import FileInfo, FileListResult, StorageBucket


# ─── A. FilterTuple ──────────────────────────────────────────────────────────


class TestFilterTuple:
    def test_to_json_list(self):
        f = FilterTuple("status", "==", "published")
        assert f.to_json() == ["status", "==", "published"]

    def test_to_json_any_value(self):
        f = FilterTuple("views", ">", 100)
        assert f.to_json() == ["views", ">", 100]

    def test_equality(self):
        f1 = FilterTuple("a", "==", 1)
        f2 = FilterTuple("a", "==", 1)
        assert f1 == f2

    def test_inequality(self):
        f1 = FilterTuple("a", "==", 1)
        f2 = FilterTuple("b", "==", 1)
        assert f1 != f2


# ─── B. OrBuilder ─────────────────────────────────────────────────────────────


class TestOrBuilder:
    def test_empty_filters(self):
        ob = OrBuilder()
        assert ob.get_filters() == []

    def test_add_one_filter(self):
        ob = OrBuilder()
        ob.where("status", "==", "draft")
        filters = ob.get_filters()
        assert len(filters) == 1
        assert filters[0].field_name == "status"

    def test_chain_returns_self(self):
        ob = OrBuilder()
        result = ob.where("a", "==", 1)
        assert result is ob

    def test_multiple_filters(self):
        ob = OrBuilder()
        ob.where("a", "==", 1).where("b", "==", 2)
        assert len(ob.get_filters()) == 2

    def test_get_filters_copy(self):
        ob = OrBuilder()
        ob.where("x", "==", "y")
        filters = ob.get_filters()
        filters.append(FilterTuple("z", "==", "w"))  # mutate copy
        assert len(ob.get_filters()) == 1  # original unchanged


# ─── C. ListResult ────────────────────────────────────────────────────────────


class TestListResult:
    def test_default_none_fields(self):
        r = ListResult(items=[])
        assert r.total is None
        assert r.page is None
        assert r.per_page is None
        assert r.has_more is None
        assert r.cursor is None

    def test_items_list(self):
        r = ListResult(items=[{"id": "1"}])
        assert len(r.items) == 1
        assert r.items[0]["id"] == "1"

    def test_pagination_fields(self):
        r = ListResult(items=[], total=100, page=2, per_page=20)
        assert r.total == 100
        assert r.page == 2
        assert r.per_page == 20

    def test_cursor_pagination(self):
        r = ListResult(items=[], has_more=True, cursor="some-cursor")
        assert r.has_more is True
        assert r.cursor == "some-cursor"


# ─── D. TableRef 불변성 ────────────────────────────────────────────────────────


def make_table_ref() -> TableRef:
    http = MagicMock()
    core = GeneratedDbApi(http)
    return TableRef(core, "posts")


class MockDatabaseLive:
    def __init__(self) -> None:
        self.last_channel: str | None = None

    def subscribe_callback(self, channel: str, _callback):
        self.last_channel = channel
        return lambda: None


class TestTableRefImmutable:
    def test_where_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.where("status", "==", "published")
        assert t1 is not t2

    def test_where_does_not_mutate_original(self):
        t1 = make_table_ref()
        t2 = t1.where("status", "==", "published")
        assert len(t1._filters) == 0
        assert len(t2._filters) == 1

    def test_order_by_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.order_by("createdAt", "desc")
        assert t1 is not t2
        assert len(t1._sorts) == 0
        assert len(t2._sorts) == 1

    def test_limit_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.limit(10)
        assert t1 is not t2
        assert t1._limit is None
        assert t2._limit == 10

    def test_offset_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.offset(20)
        assert t1 is not t2
        assert t2._offset == 20

    def test_page_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.page(3)
        assert t1 is not t2
        assert t2._page == 3

    def test_after_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.after("cursor-abc")
        assert t1 is not t2
        assert t2._after == "cursor-abc"
        assert t2._before is None

    def test_before_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.before("cursor-xyz")
        assert t1 is not t2
        assert t2._before == "cursor-xyz"
        assert t2._after is None

    def test_after_clears_before(self):
        t1 = make_table_ref().before("b1")
        t2 = t1.after("a1")
        assert t2._before is None
        assert t2._after == "a1"

    def test_before_clears_after(self):
        t1 = make_table_ref().after("a1")
        t2 = t1.before("b1")
        assert t2._after is None
        assert t2._before == "b1"

    def test_search_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.search("hello world")
        assert t1 is not t2
        assert t2._search == "hello world"

    def test_chain_multiple_buildes(self):
        t = make_table_ref()
        result = (
            t.where("status", "==", "published")
            .where("views", ">", 100)
            .order_by("createdAt", "desc")
            .limit(20)
        )
        assert len(result._filters) == 2
        assert len(result._sorts) == 1
        assert result._limit == 20

    def test_or_returns_new(self):
        t1 = make_table_ref()
        t2 = t1.or_(lambda q: q.where("status", "==", "draft"))
        assert t1 is not t2

    def test_or_adds_or_filters(self):
        t = make_table_ref()
        result = t.or_(lambda q: q.where("a", "==", 1).where("b", "==", 2))
        assert len(result._or_filters) == 2

    def test_namespace_default_shared(self):
        t = make_table_ref()
        assert t._namespace == "shared"

    def test_namespace_custom(self):
        http = MagicMock()
        core = GeneratedDbApi(http)
        t = TableRef(core, "docs", namespace="workspace", instance_id="ws-123")
        assert t._namespace == "workspace"
        assert t._instance_id == "ws-123"

    def test_update_many_requires_filter(self):
        t = make_table_ref()
        with pytest.raises(ValueError, match="where()"):
            t.update_many({"title": "X"})


class TestStorageBucket:
    def make_bucket(self):
        http = MagicMock()
        http._base_url = "http://localhost:9999"
        http.post_multipart.return_value = {"key": "docs/file.txt"}
        http.get.return_value = {
            "files": [{"key": "docs/file.txt", "size": 12, "contentType": "text/plain"}],
            "cursor": "next-cursor",
            "truncated": True,
        }
        core = GeneratedDbApi(http)
        bucket = StorageBucket(http, "lab")
        bucket._core = core
        return bucket, http, core

    def test_upload_passes_custom_metadata(self):
        bucket, http, _core = self.make_bucket()

        bucket.upload(
            "docs/file.txt",
            b"hello",
            content_type="text/plain",
            custom_metadata={"scope": "admin-app"},
        )

        _, kwargs = http.post_multipart.call_args
        assert kwargs["data"]["key"] == "docs/file.txt"
        assert "customMetadata" in kwargs["data"]
        assert "admin-app" in kwargs["data"]["customMetadata"]

    def test_list_page_preserves_cursor_and_truncated(self):
        bucket, _http, _core = self.make_bucket()

        result = bucket.list_page(prefix="docs/", limit=5, cursor="abc")

        assert isinstance(result, FileListResult)
        assert result.cursor == "next-cursor"
        assert result.truncated is True
        assert result.has_more is True
        assert isinstance(result.files[0], FileInfo)
        assert result.files[0].key == "docs/file.txt"


class TestHttpClient:
    def test_malformed_json_raises_edgebase_error(self):
        client = HttpClient("http://localhost:9999", service_key="sk-test")
        response = httpx.Response(200, content=b"{not-json")

        with pytest.raises(EdgeBaseError, match="malformed JSON"):
            client._parse_response(response)

    def test_delete_many_requires_filter(self):
        t = make_table_ref()
        with pytest.raises(ValueError, match="where()"):
            t.delete_many()

    def test_update_by_id_uses_generated_patch_route(self):
        http = MagicMock()
        http.patch.return_value = {"id": "post-1", "title": "patched"}
        t = TableRef(GeneratedDbApi(http), "posts")

        result = t.update("post-1", {"title": "patched"})

        assert result["title"] == "patched"
        http.patch.assert_called_once_with("/db/shared/tables/posts/post-1", {"title": "patched"})

    def test_delete_by_id_uses_generated_delete_route(self):
        http = MagicMock()
        http.delete.return_value = {"deleted": True}
        t = TableRef(GeneratedDbApi(http), "posts")

        result = t.delete("post-1")

        assert result["deleted"] is True
        http.delete.assert_called_once_with("/db/shared/tables/posts/post-1")


# ─── E. FieldOps ─────────────────────────────────────────────────────────────


class TestFieldOps:
    def test_increment_op_key(self):
        r = FieldOps.increment(5)
        assert r["$op"] == "increment"
        assert r["value"] == 5

    def test_increment_negative(self):
        r = FieldOps.increment(-3)
        assert r["value"] == -3

    def test_increment_default_1(self):
        r = FieldOps.increment()
        assert r["value"] == 1

    def test_delete_field_op(self):
        r = FieldOps.delete_field()
        assert r["$op"] == "deleteField"
        assert "value" not in r

    def test_module_level_increment(self):
        r = increment(10)
        assert r["$op"] == "increment"
        assert r["value"] == 10

    def test_module_level_delete_field(self):
        r = delete_field()
        assert r["$op"] == "deleteField"

    def test_increment_float(self):
        r = increment(1.5)
        assert r["value"] == 1.5


# ─── F. EdgeBaseError ─────────────────────────────────────────────────────────


class TestEdgeBaseError:
    def test_status_code_and_message(self):
        err = EdgeBaseError(404, "Not found")
        assert err.status_code == 404
        assert err.message == "Not found"

    def test_is_exception(self):
        assert isinstance(EdgeBaseError(500, "err"), Exception)

    def test_str_representation(self):
        err = EdgeBaseError(403, "Forbidden")
        s = str(err)
        assert "403" in s
        assert "Forbidden" in s

    def test_details_none_by_default(self):
        err = EdgeBaseError(400, "Bad input")
        assert err.details is None

    def test_details_field(self):
        err = EdgeBaseError(422, "Validation", details={"email": ["required"]})
        assert err.details == {"email": ["required"]}

    def test_scalar_details_render_without_crashing(self):
        err = EdgeBaseError(412, "Depth exceeded", details={"depth": 6})
        assert "depth: 6" in str(err)

    def test_from_json(self):
        data = {"message": "Email taken", "details": {"email": ["already in use"]}}
        err = EdgeBaseError.from_json(data, 409)
        assert err.status_code == 409
        assert err.message == "Email taken"
        assert err.details["email"] == ["already in use"]

    def test_from_json_missing_message(self):
        err = EdgeBaseError.from_json({}, 500)
        assert err.message == "Request failed with HTTP 500 and no error message from the server."


# ─── G. EdgeBaseAuthError ─────────────────────────────────────────────────────


class TestEdgeBaseAuthError:
    def test_is_edge_base_error(self):
        err = EdgeBaseAuthError(401, "Unauthorized")
        assert isinstance(err, EdgeBaseError)

    def test_str_contains_auth(self):
        err = EdgeBaseAuthError(401, "invalid_credentials")
        s = str(err)
        assert "EdgeBaseAuthError" in s
        assert "401" in s


class TestHttpClientResponseParsing:
    def test_parse_response_returns_none_for_204(self):
        response = MagicMock()
        response.status_code = 204
        response.content = b""
        assert HttpClient._parse_response(response) is None


# ─── H. BatchResult / UpsertResult / DbChange dataclasses ────────────────────


from edgebase_core.table import DbChange


class TestBatchResult:
    def test_fields_populated(self):
        r = BatchResult(total_processed=10, total_succeeded=8, errors=[{"msg": "fail"}])
        assert r.total_processed == 10
        assert r.total_succeeded == 8
        assert len(r.errors) == 1

    def test_empty_errors(self):
        r = BatchResult(total_processed=0, total_succeeded=0, errors=[])
        assert r.errors == []


class TestUpsertResult:
    def test_inserted_true(self):
        r = UpsertResult(record={"id": "r-1", "title": "X"}, inserted=True)
        assert r.inserted is True
        assert r.record["id"] == "r-1"

    def test_inserted_false(self):
        r = UpsertResult(record={"id": "r-2"}, inserted=False)
        assert r.inserted is False


class TestDbChange:
    def test_from_json_full(self):
        data = {
            "event": "INSERT",
            "table": "posts",
            "id": "r-1",
            "record": {"title": "Hello"},
            "oldRecord": {"title": "Old"},
        }
        c = DbChange.from_json(data)
        assert c.event == "INSERT"
        assert c.table == "posts"
        assert c.id == "r-1"
        assert c.record["title"] == "Hello"
        assert c.old_record["title"] == "Old"

    def test_from_json_minimal(self):
        data = {"event": "DELETE", "table": "posts"}
        c = DbChange.from_json(data)
        assert c.event == "DELETE"
        assert c.id is None
        assert c.record is None
        assert c.old_record is None


# ─── I. ContextManager ───────────────────────────────────────────────────────


from edgebase_core.context_manager import ContextManager


class TestContextManager:
    def test_set_and_get_context(self):
        cm = ContextManager()
        cm.set_context({"tenant": "acme"})
        assert cm.get_context() == {"tenant": "acme"}

    def test_auth_id_filtered(self):
        cm = ContextManager()
        cm.set_context({"tenant": "acme", "auth.id": "user-1"})
        ctx = cm.get_context()
        assert "auth.id" not in ctx
        assert ctx["tenant"] == "acme"

    def test_clear_context(self):
        cm = ContextManager()
        cm.set_context({"tenant": "acme"})
        cm.clear_context()
        assert cm.get_context() == {}

    def test_get_context_returns_copy(self):
        cm = ContextManager()
        cm.set_context({"tenant": "acme"})
        ctx = cm.get_context()
        ctx["mutated"] = True
        assert "mutated" not in cm.get_context()


# ─── J. HttpClient unit (URL building, headers) ──────────────────────────────


from edgebase_core.http_client import HttpClient


class TestHttpClientUnit:
    def test_build_url_with_api_prefix(self):
        h = HttpClient("http://localhost:8688", service_key="sk")
        assert h._build_url("/tables/posts") == "http://localhost:8688/api/tables/posts"

    def test_build_url_already_has_api(self):
        h = HttpClient("http://localhost:8688", service_key="sk")
        assert h._build_url("/api/tables/posts") == "http://localhost:8688/api/tables/posts"

    def test_auth_headers_service_key(self):
        h = HttpClient("http://localhost:8688", service_key="sk-test-123")
        headers = h._auth_headers()
        assert headers["X-EdgeBase-Service-Key"] == "sk-test-123"
        assert headers["Authorization"] == "Bearer sk-test-123"

    def test_auth_headers_bearer_token(self):
        h = HttpClient("http://localhost:8688", bearer_token="tok-abc")
        headers = h._auth_headers()
        assert headers["Authorization"] == "Bearer tok-abc"
        assert "X-EdgeBase-Service-Key" not in headers

    def test_auth_headers_do_not_serialize_legacy_context(self):
        cm = ContextManager()
        cm.set_context({"tenant": "acme"})
        h = HttpClient("http://localhost:8688", context_manager=cm, service_key="sk")
        headers = h._auth_headers()
        assert "X-EdgeBase-Context" not in headers

    def test_trailing_slash_stripped(self):
        h = HttpClient("http://localhost:8688/", service_key="sk")
        assert h._base_url == "http://localhost:8688"

    def test_timeout_uses_env_override(self, monkeypatch):
        monkeypatch.setenv("EDGEBASE_HTTP_TIMEOUT_MS", "12000")
        h = HttpClient("http://localhost:8688", service_key="sk")
        assert h._client.timeout.connect == 12.0

    def test_timeout_falls_back_to_default_on_invalid_env(self, monkeypatch):
        monkeypatch.setenv("EDGEBASE_HTTP_TIMEOUT_MS", "invalid")
        h = HttpClient("http://localhost:8688", service_key="sk")
        assert h._client.timeout.connect == 30.0


# ─── K. StorageClient / StorageBucket unit ───────────────────────────────────


from edgebase_core.storage import StorageClient, StorageBucket, SignedUrlResult, FileInfo


class TestStorageBucketUnit:
    def test_get_url_format(self):
        http = MagicMock()
        http._base_url = "http://localhost:8688"
        bucket = StorageBucket(http, "avatars")
        url = bucket.get_url("photo.png")
        assert url == "http://localhost:8688/api/storage/avatars/photo.png"

    def test_get_url_encodes_special_chars(self):
        http = MagicMock()
        http._base_url = "http://localhost:8688"
        bucket = StorageBucket(http, "docs")
        url = bucket.get_url("my file.txt")
        assert "my%20file.txt" in url

    def test_storage_client_bucket_returns_bucket(self):
        http = MagicMock()
        sc = StorageClient(http)
        bucket = sc.bucket("avatars")
        assert isinstance(bucket, StorageBucket)
        assert bucket.name == "avatars"


class TestSignedUrlResult:
    def test_fields(self):
        r = SignedUrlResult(url="https://signed.url/abc", expires_in=3600)
        assert r.url == "https://signed.url/abc"
        assert r.expires_in == 3600


class TestFileInfo:
    def test_from_json(self):
        data = {"key": "photo.png", "size": 1024, "contentType": "image/png", "etag": "abc"}
        fi = FileInfo.from_json(data)
        assert fi.key == "photo.png"
        assert fi.size == 1024
        assert fi.content_type == "image/png"
        assert fi.etag == "abc"

    def test_from_json_minimal(self):
        data = {"key": "file.txt", "size": 0}
        fi = FileInfo.from_json(data)
        assert fi.key == "file.txt"
        assert fi.content_type is None
        assert fi.etag is None


# ─── L. TableRef query param building ────────────────────────────────────────


class TestTableRefQueryParams:
    def test_build_query_params_empty(self):
        t = make_table_ref()
        assert t._build_query_params() == {}

    def test_build_query_params_limit(self):
        t = make_table_ref().limit(10)
        params = t._build_query_params()
        assert params["limit"] == "10"

    def test_build_query_params_offset(self):
        t = make_table_ref().offset(20)
        params = t._build_query_params()
        assert params["offset"] == "20"

    def test_build_query_params_page(self):
        t = make_table_ref().page(3)
        params = t._build_query_params()
        assert params["page"] == "3"

    def test_build_query_params_after_cursor(self):
        t = make_table_ref().after("cursor-123")
        params = t._build_query_params()
        assert params["after"] == "cursor-123"

    def test_build_query_params_before_cursor(self):
        t = make_table_ref().before("cursor-456")
        params = t._build_query_params()
        assert params["before"] == "cursor-456"

    def test_cursor_and_offset_raises(self):
        t = make_table_ref().after("cursor").offset(10)
        with pytest.raises(ValueError, match="Cannot use"):
            t._build_query_params()

    def test_cursor_and_page_raises(self):
        t = make_table_ref().before("cursor").page(2)
        with pytest.raises(ValueError, match="Cannot use"):
            t._build_query_params()

    def test_sort_params(self):
        t = make_table_ref().order_by("createdAt", "desc").order_by("title", "asc")
        params = t._build_query_params()
        assert params["sort"] == "createdAt:desc,title:asc"

    def test_filter_params_json(self):
        t = make_table_ref().where("status", "==", "active")
        params = t._build_query_params()
        import json
        parsed = json.loads(params["filter"])
        assert parsed == [["status", "==", "active"]]

    def test_or_filter_params_json(self):
        t = make_table_ref().or_(lambda q: q.where("a", "==", 1))
        params = t._build_query_params()
        import json
        parsed = json.loads(params["orFilter"])
        assert parsed == [["a", "==", 1]]


# ─── M. DocRef unit ──────────────────────────────────────────────────────────


from edgebase_core.table import DocRef


class TestDocRefUnit:
    def test_on_snapshot_no_database_live_raises(self):
        http = MagicMock()
        core = GeneratedDbApi(http)
        doc = DocRef(core, "posts", "doc-1")
        with pytest.raises(RuntimeError, match="DatabaseLive not available"):
            doc.on_snapshot(lambda c: None)

    def test_id_stored(self):
        http = MagicMock()
        core = GeneratedDbApi(http)
        doc = DocRef(core, "posts", "my-doc-id")
        assert doc.id == "my-doc-id"
        assert doc.table_name == "posts"

    def test_on_snapshot_uses_full_database_live_doc_channel(self):
        http = MagicMock()
        core = GeneratedDbApi(http)
        database_live = MockDatabaseLive()
        doc = DocRef(core, "posts", "doc-1", database_live, namespace="workspace", instance_id="ws-9")

        doc.on_snapshot(lambda c: None)

        assert database_live.last_channel == "dblive:workspace:ws-9:posts:doc-1"


# ─── N. TableRef.on_snapshot ─────────────────────────────────────────────────


class TestTableRefOnSnapshot:
    def test_on_snapshot_no_database_live_raises(self):
        t = make_table_ref()
        with pytest.raises(RuntimeError, match="DatabaseLive not available"):
            t.on_snapshot(lambda c: None)

    def test_on_snapshot_uses_full_database_live_table_channel(self):
        http = MagicMock()
        core = GeneratedDbApi(http)
        database_live = MockDatabaseLive()
        t = TableRef(core, "posts", database_live, namespace="workspace", instance_id="ws-9")

        t.on_snapshot(lambda c: None)

        assert database_live.last_channel == "dblive:workspace:ws-9:posts"


# ─── O. TableRef._matches_filters ────────────────────────────────────────────


class TestTableRefMatchesFilters:
    def test_matches_no_filters(self):
        t = make_table_ref()
        assert t._matches_filters({"status": "published"}) is True

    def test_matches_equal_filter_pass(self):
        t = make_table_ref().where("status", "==", "published")
        assert t._matches_filters({"status": "published"}) is True

    def test_matches_equal_filter_fail(self):
        t = make_table_ref().where("status", "==", "published")
        assert t._matches_filters({"status": "draft"}) is False

    def test_matches_not_equal_filter_pass(self):
        t = make_table_ref().where("status", "!=", "deleted")
        assert t._matches_filters({"status": "published"}) is True

    def test_matches_not_equal_filter_fail(self):
        t = make_table_ref().where("status", "!=", "deleted")
        assert t._matches_filters({"status": "deleted"}) is False

    def test_matches_none_record(self):
        t = make_table_ref().where("status", "==", "published")
        assert t._matches_filters(None) is True
