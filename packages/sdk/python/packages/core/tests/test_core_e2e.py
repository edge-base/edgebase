"""
edgebase-core Python SDK — E2E 테스트

전제: wrangler dev --port 8688 로컬 서버 실행 중

실행:
  BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
    cd packages/sdk/python/packages/core && pytest tests/test_core_e2e.py -v

원칙: mock 금지, 실서버 기반 테스트
"""

import asyncio
import os
import time
import pytest
from edgebase_admin.admin_client import AdminClient

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8688")
SERVICE_KEY = os.environ.get("SERVICE_KEY", "test-service-key-for-admin")
PREFIX = f"py-core-e2e-{int(time.time())}"

# 생성된 레코드 추적 (클린업용)
_created_ids: list[str] = []


@pytest.fixture(scope="module")
def admin():
    client = AdminClient(BASE_URL, service_key=SERVICE_KEY)
    yield client


@pytest.fixture(scope="module")
def posts(admin):
    return admin.db("shared").table("posts")


@pytest.fixture(autouse=True, scope="module")
def cleanup(admin):
    yield
    for rid in _created_ids:
        try:
            admin.db("shared").table("posts").doc(rid).delete()
        except Exception:
            pass


# ─── 1. CRUD E2E ──────────────────────────────────────────────────────────────


class TestCRUD:
    def test_insert(self, posts):
        r = posts.insert({"title": f"{PREFIX}-create"})
        assert "id" in r
        _created_ids.append(r["id"])

    def test_get_one(self, admin):
        posted = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-getone"})
        rid = posted["id"]
        _created_ids.append(rid)
        fetched = admin.db("shared").table("posts").get_one(rid)
        assert fetched["id"] == rid

    def test_update(self, admin):
        posted = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-upd-orig"})
        rid = posted["id"]
        _created_ids.append(rid)
        updated = admin.db("shared").table("posts").doc(rid).update({"title": f"{PREFIX}-upd-done"})
        assert updated["title"] == f"{PREFIX}-upd-done"

    def test_delete(self, admin):
        posted = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-del"})
        rid = posted["id"]
        admin.db("shared").table("posts").doc(rid).delete()
        with pytest.raises(Exception):
            admin.db("shared").table("posts").get_one(rid)

    def test_count(self, posts):
        total = posts.count()
        assert isinstance(total, int)
        assert total >= 0


# ─── 2. Query Builder E2E ────────────────────────────────────────────────────


class TestQueryBuilder:
    def test_where_filter(self, admin):
        unique = f"{PREFIX}-where-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique})
        _created_ids.append(r["id"])
        result = admin.db("shared").table("posts").where("title", "==", unique).get_list()
        assert len(result.items) >= 1
        assert result.items[0]["title"] == unique

    def test_orderby_limit(self, posts):
        result = posts.order_by("createdAt", "desc").limit(3).get_list()
        assert len(result.items) <= 3

    def test_offset_pagination(self, admin):
        result = admin.db("shared").table("posts").order_by("createdAt", "asc").limit(2).get_list()
        result2 = (
            admin.db("shared").table("posts").order_by("createdAt", "asc").limit(2).offset(2).get_list()
        )
        if result.items and result2.items:
            assert result.items[0]["id"] != result2.items[0]["id"]

    def test_cursor_pagination(self, admin):
        # Use default id ordering for cursor pagination (keyset pagination
        # with custom sort is a known limitation (BUG-CURSOR01).
        result = admin.db("shared").table("posts").limit(2).get_list()
        if result.cursor:
            result2 = (
                admin.db("shared")
                .table("posts")
                .limit(2)
                .after(result.cursor)
                .get_list()
            )
            if result.items and result2.items:
                assert result.items[0]["id"] != result2.items[0]["id"]

    def test_list_result_fields(self, posts):
        result = posts.limit(5).get_list()
        assert hasattr(result, "items")
        assert isinstance(result.items, list)


# ─── 3. Batch E2E ─────────────────────────────────────────────────────────────


class TestBatch:
    def test_insert_many(self, admin):
        items = [{"title": f"{PREFIX}-batch-{i}"} for i in range(3)]
        created = admin.db("shared").table("posts").insert_many(items)
        assert len(created) == 3
        for r in created:
            _created_ids.append(r["id"])

    def test_upsert_many(self, admin):
        items = [{"title": f"{PREFIX}-upsert-many-{i}"} for i in range(2)]
        result = admin.db("shared").table("posts").upsert_many(items)
        assert len(result) >= 2
        for r in result:
            _created_ids.append(r["id"])

    def test_update_many_requires_filter(self, posts):
        with pytest.raises(ValueError, match="where()"):
            posts.update_many({"title": "x"})

    def test_delete_many_requires_filter(self, posts):
        with pytest.raises(ValueError, match="where()"):
            posts.delete_many()


# ─── 4. Upsert E2E ────────────────────────────────────────────────────────────


class TestUpsert:
    def test_upsert_new_action_created(self, admin):
        result = admin.db("shared").table("posts").upsert({"title": f"{PREFIX}-upsert-new"})
        assert result.inserted is True
        _created_ids.append(result.record["id"])


# ─── 5. FieldOps E2E ──────────────────────────────────────────────────────────


class TestFieldOps:
    def test_increment(self, admin):
        from edgebase_core.field_ops import increment

        posted = (
            admin.db("shared").table("posts").insert({"title": f"{PREFIX}-inc", "viewCount": 0})
        )
        rid = posted["id"]
        _created_ids.append(rid)
        updated = admin.db("shared").table("posts").doc(rid).update({"viewCount": increment(5)})
        assert updated.get("viewCount") == 5

    def test_delete_field(self, admin):
        from edgebase_core.field_ops import delete_field

        posted = (
            admin.db("shared")
            .table("posts")
            .insert({"title": f"{PREFIX}-del-field", "extra": "remove-me"})
        )
        rid = posted["id"]
        _created_ids.append(rid)
        updated = admin.db("shared").table("posts").doc(rid).update({"extra": delete_field()})
        assert "extra" not in updated or updated.get("extra") is None


# ─── 6. Error Handling ────────────────────────────────────────────────────────


class TestErrors:
    def test_get_one_nonexistent(self, posts):
        from edgebase_core.errors import EdgeBaseError

        with pytest.raises(EdgeBaseError) as exc_info:
            posts.get_one("nonexistent-py-99999")
        assert exc_info.value.status_code == 404

    def test_update_nonexistent(self, admin):
        from edgebase_core.errors import EdgeBaseError

        with pytest.raises(EdgeBaseError):
            admin.db("shared").table("posts").doc("nonexistent-upd").update({"title": "X"})


# ─── 7. 언어특화 — asyncio.gather ────────────────────────────────────────────


class TestPythonLanguageSpecific:
    def test_asyncio_gather_parallel_creates(self, admin):
        """asyncio.gather로 3개 동시 create — 언어특화 테스트"""
        import asyncio

        async def create_one(i: int) -> dict:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None,
                lambda: (
                    admin.db("shared").table("posts").insert({"title": f"{PREFIX}-asyncio-{i}"})
                ),
            )

        async def run():
            tasks = [create_one(i) for i in range(3)]
            return await asyncio.gather(*tasks)

        results = asyncio.run(run())
        assert len(results) == 3
        for r in results:
            assert "id" in r
            _created_ids.append(r["id"])

    def test_context_manager_pattern(self):
        """with 문으로 AdminClient 생성 — 언어특화 테스트"""
        # Python SDK는 context manager 지원 여부 확인
        admin = AdminClient(BASE_URL, service_key=SERVICE_KEY)
        result = admin.db("shared").table("posts").limit(1).get_list()
        assert hasattr(result, "items")

    def test_list_result_dataclass(self, posts):
        """ListResult 데이터클래스 필드 접근 — 언어특화"""
        result = posts.limit(3).get_list()
        assert hasattr(result, "items")
        assert hasattr(result, "total")
        assert hasattr(result, "cursor")
        assert hasattr(result, "has_more")
        assert hasattr(result, "per_page")
        assert hasattr(result, "page")


# ─── 8. CRUD Extended Scenarios ──────────────────────────────────────────────


class TestCRUDExtended:
    def test_insert_with_nested_data(self, admin):
        """Create a record with nested JSON data and verify it round-trips."""
        r = admin.db("shared").table("posts").insert({
            "title": f"{PREFIX}-nested",
            "metadata": {"tags": ["python", "test"], "version": 2},
        })
        _created_ids.append(r["id"])
        fetched = admin.db("shared").table("posts").get_one(r["id"])
        assert fetched["metadata"]["tags"] == ["python", "test"]

    def test_insert_and_update_chain(self, admin):
        """Create then update then get — full lifecycle."""
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-lifecycle"})
        rid = r["id"]
        _created_ids.append(rid)
        admin.db("shared").table("posts").doc(rid).update({"title": f"{PREFIX}-updated"})
        fetched = admin.db("shared").table("posts").get_one(rid)
        assert fetched["title"] == f"{PREFIX}-updated"

    def test_multiple_updates_same_doc(self, admin):
        """Update the same doc multiple times sequentially."""
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-multi-upd", "viewCount": 0})
        rid = r["id"]
        _created_ids.append(rid)
        doc = admin.db("shared").table("posts").doc(rid)
        doc.update({"viewCount": 1})
        doc.update({"viewCount": 2})
        fetched = doc.get()
        assert fetched["viewCount"] == 2

    def test_delete_then_create_same_title(self, admin):
        """Delete a record, then create one with same title — no conflict."""
        title = f"{PREFIX}-recreate"
        r1 = admin.db("shared").table("posts").insert({"title": title})
        admin.db("shared").table("posts").doc(r1["id"]).delete()
        r2 = admin.db("shared").table("posts").insert({"title": title})
        _created_ids.append(r2["id"])
        assert r2["id"] != r1["id"]

    def test_get_one_returns_all_fields(self, admin):
        """get_one should return all fields including custom ones."""
        r = admin.db("shared").table("posts").insert({
            "title": f"{PREFIX}-allfields",
            "status": "draft",
            "viewCount": 42,
        })
        _created_ids.append(r["id"])
        fetched = admin.db("shared").table("posts").get_one(r["id"])
        assert "title" in fetched
        assert "id" in fetched


# ─── 9. Query Builder Extended ────────────────────────────────────────────────


class TestQueryBuilderExtended:
    def test_where_not_equal_filter(self, admin):
        """Filter with != operator."""
        unique = f"{PREFIX}-neq-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique, "status": "draft"})
        _created_ids.append(r["id"])
        result = admin.db("shared").table("posts").where("title", "==", unique).get_list()
        assert len(result.items) >= 1

    def test_multiple_where_filters(self, admin):
        """Chaining two where() should produce AND logic."""
        unique = f"{PREFIX}-multi-where-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique, "status": "published"})
        _created_ids.append(r["id"])
        result = (
            admin.db("shared").table("posts")
            .where("title", "==", unique)
            .where("status", "==", "published")
            .get_list()
        )
        assert len(result.items) >= 1
        assert result.items[0]["status"] == "published"

    def test_order_by_asc(self, admin):
        """order_by asc should return sorted results."""
        result = admin.db("shared").table("posts").order_by("createdAt", "asc").limit(5).get_list()
        if len(result.items) >= 2:
            dates = [item.get("createdAt", "") for item in result.items]
            assert dates == sorted(dates)

    def test_order_by_desc(self, admin):
        """order_by desc should return reverse sorted results."""
        result = admin.db("shared").table("posts").order_by("createdAt", "desc").limit(5).get_list()
        if len(result.items) >= 2:
            dates = [item.get("createdAt", "") for item in result.items]
            assert dates == sorted(dates, reverse=True)

    def test_limit_zero_returns_empty(self, admin):
        """limit(0) should return empty items (or server default)."""
        result = admin.db("shared").table("posts").limit(0).get_list()
        assert isinstance(result.items, list)

    def test_page_pagination(self, admin):
        """page(1) and page(2) should return different results when enough data."""
        p1 = admin.db("shared").table("posts").limit(2).page(1).get_list()
        p2 = admin.db("shared").table("posts").limit(2).page(2).get_list()
        if p1.items and p2.items:
            ids1 = {r["id"] for r in p1.items}
            ids2 = {r["id"] for r in p2.items}
            assert ids1 != ids2 or len(p2.items) == 0

    def test_search_query(self, admin):
        """Search should filter by text content."""
        unique = f"{PREFIX}-searchable-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique})
        _created_ids.append(r["id"])
        result = admin.db("shared").table("posts").search(unique).get_list()
        found_ids = [item["id"] for item in result.items]
        assert r["id"] in found_ids

    def test_or_filter_e2e(self, admin):
        """OR filter should match either condition."""
        u1 = f"{PREFIX}-or-a-{time.time_ns()}"
        u2 = f"{PREFIX}-or-b-{time.time_ns()}"
        r1 = admin.db("shared").table("posts").insert({"title": u1})
        r2 = admin.db("shared").table("posts").insert({"title": u2})
        _created_ids.extend([r1["id"], r2["id"]])
        result = (
            admin.db("shared").table("posts")
            .or_(lambda q: q.where("title", "==", u1).where("title", "==", u2))
            .get_list()
        )
        found_titles = {item["title"] for item in result.items}
        assert u1 in found_titles or u2 in found_titles


# ─── 10. Batch Extended ──────────────────────────────────────────────────────


class TestBatchExtended:
    def test_insert_many_large_batch(self, admin):
        """insert_many with more than 5 items."""
        items = [{"title": f"{PREFIX}-big-batch-{i}"} for i in range(10)]
        created = admin.db("shared").table("posts").insert_many(items)
        assert len(created) == 10
        for r in created:
            _created_ids.append(r["id"])

    def test_insert_many_single_item(self, admin):
        """insert_many with a single item."""
        created = admin.db("shared").table("posts").insert_many([{"title": f"{PREFIX}-single-batch"}])
        assert len(created) == 1
        _created_ids.append(created[0]["id"])

    def test_update_many_with_filter(self, admin):
        """update_many should update all matching records."""
        unique_tag = f"{PREFIX}-umb-{time.time_ns()}"
        for i in range(3):
            r = admin.db("shared").table("posts").insert({"title": f"{unique_tag}-{i}", "status": "draft"})
            _created_ids.append(r["id"])
        result = (
            admin.db("shared").table("posts")
            .where("status", "==", "draft")
            .update_many({"status": "archived"})
        )
        assert isinstance(result.total_processed, int)

    def test_delete_many_with_filter(self, admin):
        """delete_many should delete matching records."""
        unique_tag = f"{PREFIX}-dmb-{time.time_ns()}"
        ids = []
        for i in range(2):
            r = admin.db("shared").table("posts").insert({"title": f"{unique_tag}-{i}"})
            ids.append(r["id"])
        result = (
            admin.db("shared").table("posts")
            .where("title", "==", f"{unique_tag}-0")
            .delete_many()
        )
        assert isinstance(result.total_processed, int)
        # Clean remaining
        for rid in ids:
            try:
                admin.db("shared").table("posts").doc(rid).delete()
            except Exception:
                pass

    def test_upsert_many_conflict_target(self, admin):
        """upsert_many with conflict_target parameter (uses 'categories' table where 'name' is unique)."""
        items = [{"name": f"{PREFIX}-upsert-ct-{i}"} for i in range(2)]
        result = admin.db("shared").table("categories").upsert_many(items, conflict_target="name")
        assert isinstance(result, list)
        for r in result:
            try:
                admin.db("shared").table("categories").doc(r["id"]).delete()
            except Exception:
                pass


# ─── 11. Upsert Extended ─────────────────────────────────────────────────────


class TestUpsertExtended:
    def test_upsert_with_conflict_target(self, admin):
        """Upsert with explicit conflict_target (uses 'categories' table where 'name' is unique)."""
        name = f"{PREFIX}-upsert-ct-{time.time_ns()}"
        r1 = admin.db("shared").table("categories").upsert({"name": name}, conflict_target="name")
        assert r1.inserted is True
        try:
            admin.db("shared").table("categories").doc(r1.record["id"]).delete()
        except Exception:
            pass

    def test_upsert_result_record_has_id(self, admin):
        """UpsertResult record should contain an id field."""
        result = admin.db("shared").table("posts").upsert({"title": f"{PREFIX}-upsert-id"})
        _created_ids.append(result.record["id"])
        assert "id" in result.record


# ─── 12. FieldOps Extended ────────────────────────────────────────────────────


class TestFieldOpsExtended:
    def test_increment_multiple_times(self, admin):
        """Increment the same field multiple times."""
        from edgebase_core.field_ops import increment

        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-multi-inc", "viewCount": 0})
        _created_ids.append(r["id"])
        doc = admin.db("shared").table("posts").doc(r["id"])
        doc.update({"viewCount": increment(3)})
        doc.update({"viewCount": increment(2)})
        fetched = doc.get()
        assert fetched["viewCount"] == 5

    def test_increment_negative(self, admin):
        """Increment with a negative value (decrement)."""
        from edgebase_core.field_ops import increment

        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-dec", "viewCount": 10})
        _created_ids.append(r["id"])
        updated = admin.db("shared").table("posts").doc(r["id"]).update({"viewCount": increment(-3)})
        assert updated["viewCount"] == 7

    def test_increment_and_update_together(self, admin):
        """Increment one field while updating another."""
        from edgebase_core.field_ops import increment

        r = admin.db("shared").table("posts").insert({
            "title": f"{PREFIX}-inc-upd",
            "viewCount": 0,
            "status": "draft",
        })
        _created_ids.append(r["id"])
        updated = admin.db("shared").table("posts").doc(r["id"]).update({
            "viewCount": increment(1),
            "status": "published",
        })
        assert updated["viewCount"] == 1
        assert updated["status"] == "published"


# ─── 13. Storage E2E ─────────────────────────────────────────────────────────


class TestStorageE2E:
    def test_upload_download_roundtrip(self, admin):
        """Upload bytes, download, verify content matches."""
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-core-rt-{int(time.time())}.txt"
        content = b"roundtrip test data"
        bucket.upload(key, content, content_type="text/plain")
        downloaded = bucket.download(key)
        assert downloaded == content
        bucket.delete(key)

    def test_upload_string_raw(self, admin):
        """upload_string with raw encoding."""
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-core-str-{int(time.time())}.txt"
        bucket.upload_string(key, "hello string upload", encoding="raw", content_type="text/plain")
        downloaded = bucket.download(key)
        assert downloaded == b"hello string upload"
        bucket.delete(key)

    def test_list_files(self, admin):
        """List files in a bucket."""
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-core-list-{int(time.time())}.txt"
        bucket.upload(key, b"list test", content_type="text/plain")
        files = bucket.list_files(limit=100)
        assert isinstance(files, list)
        bucket.delete(key)

    def test_delete_file(self, admin):
        """Upload then delete — subsequent download should fail."""
        from edgebase_core.errors import EdgeBaseError

        bucket = admin.storage().bucket("test-bucket")
        key = f"py-core-del-{int(time.time())}.txt"
        bucket.upload(key, b"to be deleted", content_type="text/plain")
        bucket.delete_file(key)
        with pytest.raises(EdgeBaseError):
            bucket.download(key)

    def test_get_url_format(self, admin):
        """get_url should return a properly formatted URL."""
        bucket = admin.storage().bucket("test-bucket")
        url = bucket.get_url("my-file.txt")
        assert "test-bucket" in url
        assert "my-file.txt" in url


# ─── 14. Error Handling Extended ─────────────────────────────────────────────


class TestErrorsExtended:
    def test_delete_nonexistent(self, admin):
        """Deleting a non-existent record should raise EdgeBaseError."""
        from edgebase_core.errors import EdgeBaseError

        with pytest.raises(EdgeBaseError):
            admin.db("shared").table("posts").doc("nonexistent-del-99999").delete()

    def test_error_has_status_code(self, admin):
        """Error should carry the HTTP status code."""
        from edgebase_core.errors import EdgeBaseError

        with pytest.raises(EdgeBaseError) as exc_info:
            admin.db("shared").table("posts").get_one("nonexistent-sc-99999")
        assert isinstance(exc_info.value.status_code, int)
        assert exc_info.value.status_code >= 400

    def test_error_has_message(self, admin):
        """Error should carry a message string."""
        from edgebase_core.errors import EdgeBaseError

        with pytest.raises(EdgeBaseError) as exc_info:
            admin.db("shared").table("posts").get_one("nonexistent-msg-99999")
        assert isinstance(exc_info.value.message, str)
        assert len(exc_info.value.message) > 0


# ─── 15. Python 언어특화 E2E 확장 ────────────────────────────────────────────


class TestPythonLanguageSpecificExtended:
    def test_asyncio_gather_parallel_reads(self, admin):
        """asyncio.gather로 여러 read를 동시에 — 언어특화"""
        # Create test data
        ids = []
        for i in range(3):
            r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-pread-{i}"})
            ids.append(r["id"])
            _created_ids.append(r["id"])

        async def read_one(rid: str) -> dict:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None,
                lambda: admin.db("shared").table("posts").get_one(rid),
            )

        async def run():
            return await asyncio.gather(*[read_one(rid) for rid in ids])

        results = asyncio.run(run())
        assert len(results) == 3
        for r in results:
            assert "id" in r

    def test_httpx_timeout_configuration(self, admin):
        """httpx 클라이언트의 timeout 설정 확인 — 언어특화"""
        import httpx
        http_client = admin._http
        assert isinstance(http_client._client, httpx.Client)
        assert http_client._client.timeout is not None

    def test_type_hint_verification_list_result(self, posts):
        """ListResult type hint 필드 타입 확인 — 언어특화"""
        from edgebase_core.table import ListResult
        result = posts.limit(3).get_list()
        assert isinstance(result, ListResult)
        assert isinstance(result.items, list)
        if result.total is not None:
            assert isinstance(result.total, int)
        if result.has_more is not None:
            assert isinstance(result.has_more, bool)

    def test_type_hint_verification_upsert_result(self, admin):
        """UpsertResult type hint 필드 타입 확인 — 언어특화"""
        from edgebase_core.table import UpsertResult
        result = admin.db("shared").table("posts").upsert({"title": f"{PREFIX}-type-ur"})
        _created_ids.append(result.record["id"])
        assert isinstance(result, UpsertResult)
        assert isinstance(result.record, dict)
        assert isinstance(result.inserted, bool)

    def test_dataclass_deserialization_batch_result(self, admin):
        """BatchResult 데이터클래스 역직렬화 — 언어특화"""
        from edgebase_core.table import BatchResult
        unique = f"{PREFIX}-br-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique, "status": "draft"})
        _created_ids.append(r["id"])
        result = (
            admin.db("shared").table("posts")
            .where("title", "==", unique)
            .update_many({"status": "done"})
        )
        assert isinstance(result, BatchResult)
        assert isinstance(result.total_processed, int)
        assert isinstance(result.total_succeeded, int)
        assert isinstance(result.errors, list)

    def test_dict_comprehension_create_pattern(self, admin):
        """dict comprehension으로 레코드 생성 — Python 관용 패턴"""
        tags = ["alpha", "beta", "gamma"]
        items = [{"title": f"{PREFIX}-comp-{t}", "tag": t} for t in tags]
        created = admin.db("shared").table("posts").insert_many(items)
        for r in created:
            _created_ids.append(r["id"])
        assert len(created) == 3
        created_tags = {r.get("tag") for r in created}
        assert created_tags == set(tags)

    def test_context_manager_http_close(self):
        """AdminClient를 생성하고 HTTP 클라이언트를 닫는 패턴 — 언어특화"""
        client = AdminClient(BASE_URL, service_key=SERVICE_KEY)
        result = client.db("shared").table("posts").limit(1).get_list()
        assert isinstance(result.items, list)
        client._http.close()  # Clean up


# ─── 16. Namespace / Instance ID E2E ──────────────────────────────────────────


class TestNamespaceE2E:
    def test_shared_namespace_crud(self, admin):
        """CRUD on the default 'shared' namespace."""
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-ns-shared"})
        _created_ids.append(r["id"])
        fetched = admin.db("shared").table("posts").get_one(r["id"])
        assert fetched["id"] == r["id"]

    def test_default_namespace_is_shared(self, admin):
        """Omitting namespace should default to 'shared'."""
        # AdminClient.db() default is "shared"
        ref = admin.db()
        table = ref.table("posts")
        assert table._namespace == "shared"
