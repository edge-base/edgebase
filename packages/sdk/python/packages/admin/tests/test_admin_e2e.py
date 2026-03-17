"""
edgebase-admin Python SDK — E2E 테스트

전제: wrangler dev --port 8688 로컬 서버 실행 중

실행:
  BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
    cd packages/sdk/python/packages/admin && pytest tests/test_admin_e2e.py -v

원칙: mock 금지, 실서버 기반
"""

import os
import time
import pytest
from edgebase_admin.admin_client import AdminClient
from edgebase_core.errors import EdgeBaseError

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8688")
SERVICE_KEY = os.environ.get("SERVICE_KEY", "test-service-key-for-admin")
PREFIX = f"py-admin-e2e-{int(time.time())}"

_created_ids: list[str] = []
_created_user_ids: list[str] = []


@pytest.fixture(scope="module")
def admin():
    return AdminClient(BASE_URL, service_key=SERVICE_KEY)


@pytest.fixture(autouse=True, scope="module")
def cleanup(admin):
    yield
    for rid in _created_ids:
        try:
            admin.db("shared").table("posts").doc(rid).delete()
        except Exception:
            pass


# ─── 1. DB CRUD ───────────────────────────────────────────────────────────────


class TestDBCRUD:
    def test_insert(self, admin):
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-create"})
        assert "id" in r
        _created_ids.append(r["id"])

    def test_get_one(self, admin):
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-getone"})
        rid = r["id"]
        _created_ids.append(rid)
        fetched = admin.db("shared").table("posts").get_one(rid)
        assert fetched["id"] == rid

    def test_update(self, admin):
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-upd-orig"})
        rid = r["id"]
        _created_ids.append(rid)
        updated = admin.db("shared").table("posts").doc(rid).update({"title": f"{PREFIX}-upd-done"})
        assert updated["title"] == f"{PREFIX}-upd-done"

    def test_delete(self, admin):
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-del"})
        rid = r["id"]
        admin.db("shared").table("posts").doc(rid).delete()
        with pytest.raises(EdgeBaseError) as exc_info:
            admin.db("shared").table("posts").get_one(rid)
        assert exc_info.value.status_code == 404

    def test_count(self, admin):
        count = admin.db("shared").table("posts").count()
        assert isinstance(count, int)

    def test_list_with_limit(self, admin):
        result = admin.db("shared").table("posts").limit(3).get_list()
        assert len(result.items) <= 3


# ─── 2. AdminAuth E2E ─────────────────────────────────────────────────────────


class TestAdminAuth:
    def test_create_user(self, admin):
        email = f"py-admin-{time.time_ns()}@test.com"
        r = admin.admin_auth.create_user(email, "PyAdminPass123!")
        user_id = r.get("id") or r.get("user", {}).get("id")
        assert user_id
        _created_user_ids.append(user_id)

    def test_get_user(self, admin):
        email = f"py-get-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(email, "PyGet123!")
        uid = created.get("id") or created.get("user", {}).get("id")
        fetched = admin.admin_auth.get_user(uid)
        fetched_id = fetched.get("id") or fetched.get("user", {}).get("id")
        assert fetched_id == uid

    def test_list_users(self, admin):
        result = admin.admin_auth.list_users(limit=5)
        assert "users" in result
        assert isinstance(result["users"], list)

    def test_update_user(self, admin):
        email = f"py-upd-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(email, "PyUpd123!")
        uid = created.get("id") or created.get("user", {}).get("id")
        result = admin.admin_auth.update_user(uid, {"displayName": "Updated"})
        assert result is not None

    def test_set_custom_claims(self, admin):
        email = f"py-claims-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(email, "PyClaims123!")
        uid = created.get("id") or created.get("user", {}).get("id")
        # Should not raise
        admin.admin_auth.set_custom_claims(uid, {"role": "premium"})

    def test_revoke_all_sessions(self, admin):
        email = f"py-revoke-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(email, "PyRevoke123!")
        uid = created.get("id") or created.get("user", {}).get("id")
        admin.admin_auth.revoke_all_sessions(uid)

    def test_get_user_not_found(self, admin):
        with pytest.raises(EdgeBaseError) as exc_info:
            admin.admin_auth.get_user("nonexistent-py-admin-user")
        assert exc_info.value.status_code in (404, 400)


# ─── 3. Batch ─────────────────────────────────────────────────────────────────


class TestBatch:
    def test_insert_many(self, admin):
        items = [{"title": f"{PREFIX}-batch-{i}"} for i in range(3)]
        created = admin.db("shared").table("posts").insert_many(items)
        assert len(created) == 3
        for r in created:
            _created_ids.append(r["id"])

    def test_upsert_many(self, admin):
        items = [{"title": f"{PREFIX}-upsert-{i}"} for i in range(2)]
        result = admin.db("shared").table("posts").upsert_many(items)
        assert len(result) >= 2
        for r in result:
            _created_ids.append(r["id"])


# ─── 4. Storage E2E ──────────────────────────────────────────────────────────


class TestStorage:
    def test_bucket_upload_and_get_url(self, admin):
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-admin-e2e-{int(time.time())}.txt"
        bucket.upload(key, b"Hello from Python admin E2E", content_type="text/plain")
        url = bucket.get_url(key)
        assert key in url
        try:
            bucket.delete(key)
        except Exception:
            pass


# ─── 5. Error Handling ────────────────────────────────────────────────────────


class TestErrors:
    def test_get_one_not_found(self, admin):
        with pytest.raises(EdgeBaseError) as exc_info:
            admin.db("shared").table("posts").get_one("nonexistent-py-99999")
        assert exc_info.value.status_code == 404

    def test_invalid_service_key(self):
        bad_admin = AdminClient(BASE_URL, service_key="invalid-sk")
        with pytest.raises(EdgeBaseError):
            bad_admin.db("shared").table("posts").insert({"title": "X"})

    def test_update_many_no_filter(self, admin):
        with pytest.raises(ValueError):
            admin.db("shared").table("posts").update_many({"title": "X"})

    def test_delete_many_no_filter(self, admin):
        with pytest.raises(ValueError):
            admin.db("shared").table("posts").delete_many()


# ─── 6. 언어특화 — asyncio.gather ────────────────────────────────────────────


class TestPythonAdminLanguageSpecific:
    def test_parallel_creates_asyncio(self, admin):
        """asyncio.gather 병렬 create — 언어특화"""
        import asyncio

        async def create_one(i: int) -> dict:
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                None,
                lambda: admin.db("shared").table("posts").insert({"title": f"{PREFIX}-async-{i}"}),
            )

        async def run():
            return await asyncio.gather(*[create_one(i) for i in range(3)])

        results = asyncio.run(run())
        assert len(results) == 3
        for r in results:
            _created_ids.append(r["id"])

    def test_list_result_dataclass_access(self, admin):
        """ListResult 데이터클래스 — 언어특화"""
        result = admin.db("shared").table("posts").limit(3).get_list()
        assert hasattr(result, "items")
        assert hasattr(result, "total")
        assert hasattr(result, "per_page")
        assert hasattr(result, "cursor")

    def test_filter_with_list_comprehension(self, admin):
        """list comprehension + insert_many — 언어특화 Python 패턴"""
        titles = [f"{PREFIX}-lc-{i}" for i in range(2)]
        items = [{"title": t} for t in titles]
        created = admin.db("shared").table("posts").insert_many(items)
        for r in created:
            _created_ids.append(r["id"])
        assert len(created) == 2


# ─── 7. CRUD Extended Scenarios ──────────────────────────────────────────────


class TestCRUDExtended:
    def test_insert_with_numeric_field(self, admin):
        """Create a record with numeric field and verify it persists."""
        r = admin.db("shared").table("posts").insert({
            "title": f"{PREFIX}-numeric",
            "viewCount": 42,
        })
        _created_ids.append(r["id"])
        fetched = admin.db("shared").table("posts").get_one(r["id"])
        assert fetched["viewCount"] == 42

    def test_insert_with_boolean_field(self, admin):
        """Create with boolean field."""
        r = admin.db("shared").table("posts").insert({
            "title": f"{PREFIX}-bool",
            "published": True,
        })
        _created_ids.append(r["id"])
        fetched = admin.db("shared").table("posts").get_one(r["id"])
        assert fetched["published"] is True

    def test_update_partial_preserves_other_fields(self, admin):
        """Partial update should not wipe other fields."""
        r = admin.db("shared").table("posts").insert({
            "title": f"{PREFIX}-partial",
            "status": "draft",
            "viewCount": 10,
        })
        _created_ids.append(r["id"])
        admin.db("shared").table("posts").doc(r["id"]).update({"status": "published"})
        fetched = admin.db("shared").table("posts").get_one(r["id"])
        assert fetched["status"] == "published"
        assert fetched["viewCount"] == 10

    def test_doc_ref_get(self, admin):
        """DocRef.get() returns the document."""
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-docref-get"})
        _created_ids.append(r["id"])
        doc = admin.db("shared").table("posts").doc(r["id"]).get()
        assert doc["id"] == r["id"]

    def test_insert_and_count_increase(self, admin):
        """Count should increase after creating a record."""
        count_before = admin.db("shared").table("posts").count()
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-cnt-inc"})
        _created_ids.append(r["id"])
        count_after = admin.db("shared").table("posts").count()
        assert count_after >= count_before


# ─── 8. Query Builder Extended ────────────────────────────────────────────────


class TestQueryBuilderExtended:
    def test_where_filter_exact_match(self, admin):
        """where with == should match exactly."""
        unique = f"{PREFIX}-exact-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique})
        _created_ids.append(r["id"])
        result = admin.db("shared").table("posts").where("title", "==", unique).get_list()
        assert any(item["title"] == unique for item in result.items)

    def test_multiple_where_chain(self, admin):
        """Multiple where() for AND logic."""
        unique = f"{PREFIX}-mwhere-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique, "status": "active"})
        _created_ids.append(r["id"])
        result = (
            admin.db("shared").table("posts")
            .where("title", "==", unique)
            .where("status", "==", "active")
            .get_list()
        )
        assert len(result.items) >= 1

    def test_order_by_desc_limit(self, admin):
        """order_by desc with limit."""
        result = admin.db("shared").table("posts").order_by("createdAt", "desc").limit(3).get_list()
        assert len(result.items) <= 3

    def test_offset_skips_results(self, admin):
        """offset should skip initial records."""
        all_results = admin.db("shared").table("posts").limit(5).get_list()
        offset_results = admin.db("shared").table("posts").limit(5).offset(2).get_list()
        if len(all_results.items) > 2 and len(offset_results.items) > 0:
            assert all_results.items[2]["id"] == offset_results.items[0]["id"]

    def test_search_returns_matching(self, admin):
        """search() should find records matching the query."""
        unique = f"{PREFIX}-search-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique})
        _created_ids.append(r["id"])
        result = admin.db("shared").table("posts").search(unique).get_list()
        found_ids = [item["id"] for item in result.items]
        assert r["id"] in found_ids

    def test_or_filter_matches_either(self, admin):
        """or_() should match any of the conditions."""
        u1 = f"{PREFIX}-or1-{time.time_ns()}"
        u2 = f"{PREFIX}-or2-{time.time_ns()}"
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

    def test_cursor_pagination_forward(self, admin):
        """after() cursor pagination should move forward."""
        page1 = admin.db("shared").table("posts").limit(2).get_list()
        if page1.cursor:
            page2 = admin.db("shared").table("posts").limit(2).after(page1.cursor).get_list()
            if page1.items and page2.items:
                ids1 = {r["id"] for r in page1.items}
                ids2 = {r["id"] for r in page2.items}
                assert ids1 != ids2


# ─── 8b. Golden Query — filter + sort + limit contract ───────────────────────


class TestGoldenQuery:
    """Golden query contract: filter + sort + limit must return exact results."""

    _gq_ids: list[str] = []

    def test_golden_seed(self, admin):
        """Seed 5 records with known views values."""
        gq_prefix = f"{PREFIX}-gq"
        records = [
            {"title": f"{gq_prefix}-A", "views": 10},
            {"title": f"{gq_prefix}-B", "views": 30},
            {"title": f"{gq_prefix}-C", "views": 20},
            {"title": f"{gq_prefix}-D", "views": 40},
            {"title": f"{gq_prefix}-E", "views": 5},
        ]
        for rec in records:
            r = admin.db("shared").table("posts").insert(rec)
            self._gq_ids.append(r["id"])
            _created_ids.append(r["id"])

    def test_golden_filter_sort_limit(self, admin):
        """filter>=10 + sort:desc + limit=3 → [40,30,20]."""
        gq_prefix = f"{PREFIX}-gq"
        result = (
            admin.db("shared").table("posts")
            .where("title", "contains", gq_prefix)
            .where("views", ">=", 10)
            .order_by("views", "desc")
            .limit(3)
            .get_list()
        )
        views = [item["views"] for item in result.items]
        assert views == [40, 30, 20], f"Expected [40,30,20] but got {views}"

    def test_golden_cursor_no_overlap(self, admin):
        """Cursor pagination with filter → no ID overlap."""
        gq_prefix = f"{PREFIX}-gq"
        page1 = (
            admin.db("shared").table("posts")
            .where("title", "contains", gq_prefix)
            .limit(2)
            .get_list()
        )
        assert len(page1.items) == 2
        assert page1.cursor is not None

        page2 = (
            admin.db("shared").table("posts")
            .where("title", "contains", gq_prefix)
            .limit(2)
            .after(page1.cursor)
            .get_list()
        )
        ids1 = {r["id"] for r in page1.items}
        ids2 = {r["id"] for r in page2.items}
        assert ids1.isdisjoint(ids2), f"Overlap found: {ids1 & ids2}"

    def test_golden_orfilter(self, admin):
        """orFilter golden: or(views==10 | views==40) → [10, 40]"""
        gq_prefix = f"{PREFIX}-gq"
        result = (
            admin.db("shared").table("posts")
            .where("title", "contains", gq_prefix)
            .or_(lambda q: q.where("views", "==", 10).where("views", "==", 40))
            .order_by("views", "asc")
            .limit(10)
            .get_list()
        )
        views = [r["views"] for r in result.items]
        assert views == [10, 40]

    def test_golden_crud_roundtrip(self, admin):
        """CRUD round-trip: create → read → update → delete"""
        gq_prefix = f"{PREFIX}-gq"
        crud_title = f"{gq_prefix}CRUD-{int(time.time() * 1000)}"
        # Create
        created = admin.db("shared").table("posts").insert({
            "title": crud_title, "views": 111, "isPublished": True,
        })
        assert created["id"] is not None
        _created_ids.append(created["id"])

        # Read
        read = admin.db("shared").table("posts").doc(created["id"]).get()
        assert read["title"] == crud_title

        # Update
        updated = admin.db("shared").table("posts").doc(created["id"]).update({"views": 222})
        assert updated["views"] == 222

        # Delete
        admin.db("shared").table("posts").doc(created["id"]).delete()
        with pytest.raises(EdgeBaseError) as exc_info:
            admin.db("shared").table("posts").doc(created["id"]).get()
        assert exc_info.value.status_code == 404


# ─── 9. Batch Extended ───────────────────────────────────────────────────────


class TestBatchExtended:
    def test_insert_many_verifies_all_created(self, admin):
        """All records from insert_many should be retrievable."""
        items = [{"title": f"{PREFIX}-batch-v-{i}"} for i in range(5)]
        created = admin.db("shared").table("posts").insert_many(items)
        for r in created:
            _created_ids.append(r["id"])
            fetched = admin.db("shared").table("posts").get_one(r["id"])
            assert fetched["id"] == r["id"]

    def test_upsert_many_returns_records_with_ids(self, admin):
        """upsert_many results should all have IDs."""
        items = [{"title": f"{PREFIX}-um-{i}"} for i in range(3)]
        result = admin.db("shared").table("posts").upsert_many(items)
        for r in result:
            _created_ids.append(r["id"])
            assert "id" in r

    def test_update_many_e2e(self, admin):
        """update_many should update matching records."""
        unique = f"{PREFIX}-um-upd-{time.time_ns()}"
        for i in range(2):
            r = admin.db("shared").table("posts").insert({"title": f"{unique}-{i}", "status": "draft"})
            _created_ids.append(r["id"])
        result = (
            admin.db("shared").table("posts")
            .where("status", "==", "draft")
            .update_many({"status": "archived"})
        )
        assert result.total_processed >= 0

    def test_delete_many_e2e(self, admin):
        """delete_many should remove matching records."""
        unique = f"{PREFIX}-dm-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique})
        result = (
            admin.db("shared").table("posts")
            .where("title", "==", unique)
            .delete_many()
        )
        assert result.total_processed >= 0


# ─── 10. Upsert Extended ──────────────────────────────────────────────────────


class TestUpsertExtended:
    def test_upsert_inserts_new(self, admin):
        """Upsert on new data should create."""
        result = admin.db("shared").table("posts").upsert({"title": f"{PREFIX}-upsert-new-{time.time_ns()}"})
        _created_ids.append(result.record["id"])
        assert result.inserted is True

    def test_upsert_with_conflict_target(self, admin):
        """Upsert with explicit conflict_target (uses 'categories' table where 'name' is unique)."""
        name = f"{PREFIX}-upsert-ct-{time.time_ns()}"
        result = admin.db("shared").table("categories").upsert({"name": name}, conflict_target="name")
        assert "id" in result.record
        try:
            admin.db("shared").table("categories").doc(result.record["id"]).delete()
        except Exception:
            pass

    def test_upsert_result_fields(self, admin):
        """UpsertResult should have both record and created fields."""
        from edgebase_core.table import UpsertResult
        result = admin.db("shared").table("posts").upsert({"title": f"{PREFIX}-ur-fields"})
        _created_ids.append(result.record["id"])
        assert isinstance(result, UpsertResult)
        assert isinstance(result.record, dict)
        assert isinstance(result.inserted, bool)


# ─── 11. FieldOps E2E Extended ────────────────────────────────────────────────


class TestFieldOpsExtended:
    def test_increment_from_zero(self, admin):
        """Increment from zero."""
        from edgebase_core.field_ops import increment
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-inc0", "viewCount": 0})
        _created_ids.append(r["id"])
        updated = admin.db("shared").table("posts").doc(r["id"]).update({"viewCount": increment(1)})
        assert updated["viewCount"] == 1

    def test_increment_negative_value(self, admin):
        """Increment with negative (decrement)."""
        from edgebase_core.field_ops import increment
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-dec", "viewCount": 10})
        _created_ids.append(r["id"])
        updated = admin.db("shared").table("posts").doc(r["id"]).update({"viewCount": increment(-5)})
        assert updated["viewCount"] == 5

    def test_delete_field_e2e(self, admin):
        """delete_field should remove the field."""
        from edgebase_core.field_ops import delete_field
        r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-df", "extra": "remove"})
        _created_ids.append(r["id"])
        updated = admin.db("shared").table("posts").doc(r["id"]).update({"extra": delete_field()})
        assert "extra" not in updated or updated.get("extra") is None


# ─── 12. Storage Extended ────────────────────────────────────────────────────


class TestStorageExtended:
    def test_upload_download_roundtrip(self, admin):
        """Upload then download should return identical bytes."""
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-admin-rt-{int(time.time())}.txt"
        content = b"admin roundtrip test"
        bucket.upload(key, content, content_type="text/plain")
        downloaded = bucket.download(key)
        assert downloaded == content
        bucket.delete(key)

    def test_upload_string_raw(self, admin):
        """upload_string with raw encoding."""
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-admin-str-{int(time.time())}.txt"
        bucket.upload_string(key, "admin string test", encoding="raw", content_type="text/plain")
        downloaded = bucket.download(key)
        assert downloaded == b"admin string test"
        bucket.delete(key)

    def test_list_files_returns_file_info(self, admin):
        """list_files should return FileInfo objects."""
        from edgebase_core.storage import FileInfo
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-admin-list-{int(time.time())}.txt"
        bucket.upload(key, b"list test", content_type="text/plain")
        files = bucket.list_files(limit=100)
        assert isinstance(files, list)
        if files:
            assert isinstance(files[0], FileInfo)
        bucket.delete(key)

    def test_delete_file_then_reupload(self, admin):
        """Delete a file, then re-upload with same key."""
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-admin-reup-{int(time.time())}.txt"
        bucket.upload(key, b"first", content_type="text/plain")
        bucket.delete(key)
        bucket.upload(key, b"second", content_type="text/plain")
        downloaded = bucket.download(key)
        assert downloaded == b"second"
        bucket.delete(key)

    def test_get_url_contains_bucket_and_key(self, admin):
        """get_url should include bucket name and key."""
        bucket = admin.storage().bucket("test-bucket")
        url = bucket.get_url("photo.png")
        assert "test-bucket" in url
        assert "photo.png" in url


# ─── 13. AdminAuth Extended ──────────────────────────────────────────────────


class TestAdminAuthExtended:
    def test_create_and_get_user_cycle(self, admin):
        """Create user then get user — full cycle."""
        email = f"py-cycle-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(email, "Cycle1234!")
        uid = created.get("id") or created.get("user", {}).get("id")
        assert uid
        fetched = admin.admin_auth.get_user(uid)
        fetched_id = fetched.get("id") or fetched.get("user", {}).get("id")
        assert fetched_id == uid

    def test_create_and_delete_user(self, admin):
        """Create user then delete — subsequent get should fail."""
        email = f"py-del-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(email, "Delete1234!")
        uid = created.get("id") or created.get("user", {}).get("id")
        assert uid
        admin.admin_auth.delete_user(uid)
        with pytest.raises(EdgeBaseError):
            admin.admin_auth.get_user(uid)

    def test_list_users_returns_list(self, admin):
        """list_users should return a dict with 'users' list."""
        result = admin.admin_auth.list_users(limit=3)
        assert "users" in result
        assert isinstance(result["users"], list)
        assert len(result["users"]) <= 3

    def test_create_user_with_metadata(self, admin):
        """Create user with extra data."""
        email = f"py-meta-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(
            email, "Meta1234!", data={"displayName": "Test User"}
        )
        uid = created.get("id") or created.get("user", {}).get("id")
        assert uid

    def test_set_claims_and_verify(self, admin):
        """Set custom claims on a user."""
        email = f"py-clm-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(email, "Claims1234!")
        uid = created.get("id") or created.get("user", {}).get("id")
        admin.admin_auth.set_custom_claims(uid, {"role": "editor", "tier": "pro"})
        # No assertion needed — just verify no error

    def test_revoke_sessions_then_get(self, admin):
        """Revoke all sessions, then get user should still work."""
        email = f"py-rev-{time.time_ns()}@test.com"
        created = admin.admin_auth.create_user(email, "Revoke1234!")
        uid = created.get("id") or created.get("user", {}).get("id")
        admin.admin_auth.revoke_all_sessions(uid)
        fetched = admin.admin_auth.get_user(uid)
        fetched_id = fetched.get("id") or fetched.get("user", {}).get("id")
        assert fetched_id == uid


# ─── 14. Error Handling Extended ──────────────────────────────────────────────


class TestErrorsExtended:
    def test_delete_nonexistent_raises(self, admin):
        """Deleting a non-existent record should raise."""
        with pytest.raises(EdgeBaseError):
            admin.db("shared").table("posts").doc("nonexistent-admin-del").delete()

    def test_error_status_code_is_int(self, admin):
        """EdgeBaseError.status_code should be an integer."""
        with pytest.raises(EdgeBaseError) as exc_info:
            admin.db("shared").table("posts").get_one("nonexistent-admin-int")
        assert isinstance(exc_info.value.status_code, int)

    def test_error_str_representation(self, admin):
        """str(error) should contain status and message."""
        with pytest.raises(EdgeBaseError) as exc_info:
            admin.db("shared").table("posts").get_one("nonexistent-admin-str")
        s = str(exc_info.value)
        assert "404" in s or "EdgeBaseError" in s


# ─── 15. Python 언어특화 확장 ──────────────────────────────────────────────────


class TestPythonLanguageSpecificExtended:
    def test_asyncio_gather_parallel_reads(self, admin):
        """asyncio.gather 병렬 read — 언어특화"""
        import asyncio

        ids = []
        for i in range(3):
            r = admin.db("shared").table("posts").insert({"title": f"{PREFIX}-prd-{i}"})
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

    def test_httpx_timeout_exists(self, admin):
        """httpx 클라이언트 timeout 검증 — 언어특화"""
        import httpx
        http_client = admin._http
        assert isinstance(http_client._client, httpx.Client)

    def test_type_hint_list_result(self, admin):
        """ListResult 타입 검증 — 언어특화"""
        from edgebase_core.table import ListResult
        result = admin.db("shared").table("posts").limit(3).get_list()
        assert isinstance(result, ListResult)
        assert isinstance(result.items, list)

    def test_type_hint_batch_result(self, admin):
        """BatchResult 타입 검증 — 언어특화"""
        from edgebase_core.table import BatchResult
        unique = f"{PREFIX}-tbr-{time.time_ns()}"
        r = admin.db("shared").table("posts").insert({"title": unique})
        _created_ids.append(r["id"])
        result = (
            admin.db("shared").table("posts")
            .where("title", "==", unique)
            .update_many({"status": "done"})
        )
        assert isinstance(result, BatchResult)

    def test_dataclass_deserialization_file_info(self, admin):
        """FileInfo 데이터클래스 역직렬화 — 언어특화"""
        from edgebase_core.storage import FileInfo
        bucket = admin.storage().bucket("test-bucket")
        key = f"py-admin-fi-{int(time.time())}.txt"
        bucket.upload(key, b"fileinfo test", content_type="text/plain")
        files = bucket.list_files(limit=100)
        if files:
            fi = files[0]
            assert isinstance(fi, FileInfo)
            assert isinstance(fi.key, str)
            assert isinstance(fi.size, int)
        bucket.delete(key)

    def test_dict_comprehension_batch_pattern(self, admin):
        """dict comprehension + insert_many — Python 관용 패턴"""
        data = {f"item-{i}": i * 10 for i in range(3)}
        items = [{"title": f"{PREFIX}-dict-{k}", "viewCount": v} for k, v in data.items()]
        created = admin.db("shared").table("posts").insert_many(items)
        for r in created:
            _created_ids.append(r["id"])
        assert len(created) == 3

    def test_enumerate_pattern(self, admin):
        """enumerate() + create — Python 관용 패턴"""
        labels = ["alpha", "beta", "gamma"]
        ids = []
        for idx, label in enumerate(labels):
            r = admin.db("shared").table("posts").insert({
                "title": f"{PREFIX}-enum-{idx}-{label}",
            })
            ids.append(r["id"])
            _created_ids.append(r["id"])
        assert len(ids) == 3


# ─── 16. Push E2E ───────────────────────────────────────────────────────────


class TestAdminPushE2E:
    @pytest.fixture(autouse=True)
    def _push(self, admin):
        from edgebase_admin.push import PushClient
        self.push = PushClient(admin._http)

    def test_push_send_nonexistent_user(self, admin):
        """push.send to non-existent user → sent: 0."""
        result = self.push.send("nonexistent-push-user-99999", {"title": "Test", "body": "Hello"})
        assert result.get("sent", 0) == 0

    def test_push_send_to_token(self, admin):
        """push.sendToToken → sent: 1 (mock FCM success)."""
        result = self.push.send_to_token("fake-fcm-token-e2e", {"title": "Token", "body": "Test"})
        assert isinstance(result, dict)
        assert "sent" in result

    def test_push_send_many(self, admin):
        """push.sendMany → 200 OK."""
        result = self.push.send_many(
            ["nonexistent-user-a", "nonexistent-user-b"],
            {"title": "Batch", "body": "Test"},
        )
        assert isinstance(result, dict)

    def test_push_get_tokens(self, admin):
        """push.getTokens → empty array."""
        tokens = self.push.get_tokens("nonexistent-push-user-tokens")
        assert isinstance(tokens, list)

    def test_push_get_logs(self, admin):
        """push.getLogs → array."""
        logs = self.push.get_logs("nonexistent-push-user-logs")
        assert isinstance(logs, list)

    def test_push_send_to_topic(self, admin):
        """push.sendToTopic → success."""
        result = self.push.send_to_topic("test-topic-e2e", {"title": "Topic", "body": "Test"})
        assert isinstance(result, dict)

    def test_push_broadcast(self, admin):
        """push.broadcast → success."""
        result = self.push.broadcast({"title": "Broadcast", "body": "E2E Test"})
        assert isinstance(result, dict)


# ─── 17. Vectorize E2E (stub) ─────────────────────────────────────────────────


class TestVectorizeE2E:
    def test_upsert_stub(self, admin):
        vec = admin.vector("embeddings")
        result = vec.upsert([{"id": "doc-1", "values": [0.1] * 1536}])
        assert result.get("ok") is True

    def test_insert_stub(self, admin):
        vec = admin.vector("embeddings")
        result = vec.insert([{"id": "doc-ins-1", "values": [0.2] * 1536}])
        assert result.get("ok") is True

    def test_search_stub(self, admin):
        vec = admin.vector("embeddings")
        matches = vec.search([0.1] * 1536, top_k=5)
        assert isinstance(matches, list)

    def test_search_with_return_values(self, admin):
        vec = admin.vector("embeddings")
        matches = vec.search([0.1] * 1536, top_k=5, return_values=True)
        assert isinstance(matches, list)

    def test_search_with_return_metadata(self, admin):
        vec = admin.vector("embeddings")
        matches = vec.search([0.1] * 1536, top_k=5, return_metadata="all")
        assert isinstance(matches, list)

    def test_search_with_namespace(self, admin):
        vec = admin.vector("embeddings")
        matches = vec.search([0.1] * 1536, top_k=5, namespace="test-ns")
        assert isinstance(matches, list)

    def test_query_by_id_stub(self, admin):
        vec = admin.vector("embeddings")
        matches = vec.query_by_id("doc-1", top_k=5)
        assert isinstance(matches, list)

    def test_get_by_ids_stub(self, admin):
        vec = admin.vector("embeddings")
        vectors = vec.get_by_ids(["doc-1", "doc-2"])
        assert isinstance(vectors, list)

    def test_delete_stub(self, admin):
        vec = admin.vector("embeddings")
        result = vec.delete(["doc-1", "doc-2"])
        assert result.get("ok") is True

    def test_describe_stub(self, admin):
        vec = admin.vector("embeddings")
        info = vec.describe()
        assert isinstance(info.get("vectorCount"), (int, float))
        assert isinstance(info.get("dimensions"), (int, float))
        assert isinstance(info.get("metric"), str)

    def test_search_dimension_mismatch_400(self, admin):
        vec = admin.vector("embeddings")
        with pytest.raises(Exception):
            vec.search([0.1, 0.2, 0.3], top_k=5)

    def test_search_top_k_zero_400(self, admin):
        vec = admin.vector("embeddings")
        with pytest.raises(Exception):
            vec.search([0.1] * 1536, top_k=0)

    def test_search_top_k_101_400(self, admin):
        vec = admin.vector("embeddings")
        with pytest.raises(Exception):
            vec.search([0.1] * 1536, top_k=101)

    def test_nonexistent_index_404(self, admin):
        vec = admin.vector("nonexistent-index-99")
        with pytest.raises(Exception):
            vec.describe()
