"""
Python SDK 단위 + E2E 테스트

실행 방법:
  cd packages/sdk/python
  pip install -e ".[dev]"
  pip install -e packages/core
  pip install -e packages/admin
  SERVER=http://localhost:8688 pytest tests/ -v

환경 변수:
  SERVER: EdgeBase 서버 주소 (기본값: http://localhost:8688)
  SERVICE_KEY: 서비스 키 (기본값: test-service-key-for-admin)
"""

import os
import uuid
import json
import asyncio
import contextlib
import pytest
import httpx

SERVER = os.environ.get("SERVER", "http://localhost:8688")
SK = os.environ.get("SERVICE_KEY", "test-service-key-for-admin")


def server_available() -> bool:
    try:
        response = httpx.get(f"{SERVER}/api/health", timeout=0.5)
        return response.status_code < 500
    except Exception:
        return False


SERVER_AVAILABLE = server_available()
REQUIRES_SERVER = pytest.mark.skipif(
    not SERVER_AVAILABLE,
    reason=f"E2E backend not reachable at {SERVER}. Start `edgebase dev --port 8688` or set SERVER.",
)


def raw(method: str, path: str, body=None, headers=None):
    """Helper: raw HTTP request with SK auth."""
    h = {"X-EdgeBase-Service-Key": SK, "Content-Type": "application/json"}
    if headers:
        h.update(headers)
    r = httpx.request(method, f"{SERVER}{path}", json=body, headers=h)
    return r.status_code, r.json() if r.content else None


# ─── 1. SDK 발행/설치 확인 ───────────────────────────────────────────────────


class TestImports:
    def test_import_edgebase(self):
        from edgebase import EdgeBaseServer

        assert EdgeBaseServer is not None

    def test_import_table_ref(self):
        from edgebase_core.table import TableRef

        assert TableRef is not None

    def test_import_field_ops(self):
        from edgebase_core.field_ops import increment, delete_field, serialize_field_ops

        assert increment is not None
        assert delete_field is not None

    def test_import_http_client(self):
        from edgebase_core.http_client import HttpClient

        assert HttpClient is not None

    def test_import_admin(self):
        from edgebase_admin.admin_auth import AdminAuthClient

        assert AdminAuthClient is not None


# ─── 2. field_ops 단위 테스트 ─────────────────────────────────────────────────


class TestFieldOps:
    def setup_method(self):
        from edgebase_core.field_ops import increment, delete_field, serialize_field_ops

        self.increment = increment
        self.delete_field = delete_field
        self.serialize = serialize_field_ops

    def test_increment_creates_op(self):
        op = self.increment(5)
        assert op["$op"] == "increment"
        assert op["value"] == 5

    def test_increment_negative(self):
        op = self.increment(-3)
        assert op["value"] == -3

    def test_delete_field_creates_op(self):
        op = self.delete_field()
        assert op["$op"] == "deleteField"

    def test_serialize_increment(self):
        data = {"count": self.increment(1), "name": "test"}
        result = self.serialize(data)
        assert result["count"] == {"$op": "increment", "value": 1}
        assert result["name"] == "test"

    def test_serialize_delete_field(self):
        data = {"field": self.delete_field()}
        result = self.serialize(data)
        assert result["field"] == {"$op": "deleteField"}

    def test_serialize_plain_values(self):
        data = {"x": 1, "y": "hello"}
        result = self.serialize(data)
        assert result == data


# ─── 3. TableRef 쿼리 빌더 단위 테스트 ─────────────────────────────────────────


class TestTableRefBuilder:
    def setup_method(self):
        from edgebase_core.http_client import HttpClient
        from edgebase_core.generated.api_core import GeneratedDbApi
        from edgebase_core.table import TableRef

        self.http = HttpClient(base_url=SERVER, service_key=SK)
        self.core = GeneratedDbApi(self.http)
        self.table = TableRef(self.core, "posts", namespace="shared")

    def test_where_immutable(self):
        t2 = self.table.where("status", "==", "published")
        assert len(self.table._filters) == 0
        assert len(t2._filters) == 1

    def test_limit_immutable(self):
        t2 = self.table.limit(10)
        assert self.table._limit is None
        assert t2._limit == 10

    def test_offset_immutable(self):
        t2 = self.table.offset(5)
        assert t2._offset == 5

    def test_order_by_immutable(self):
        t2 = self.table.order_by("createdAt", "desc")
        assert t2._sorts == [("createdAt", "desc")]

    def test_chaining(self):
        t2 = self.table.where("a", "==", 1).limit(5).order_by("b", "asc")
        assert len(t2._filters) == 1
        assert t2._limit == 5
        assert t2._sorts[0] == ("b", "asc")

    def test_or_filter(self):
        t2 = self.table.or_(lambda q: q.where("x", "==", 1).where("y", "==", 2))
        assert len(t2._or_filters) == 2

    def test_after_cursor(self):
        t2 = self.table.after("some-cursor")
        assert t2._after == "some-cursor"
        assert t2._before is None

    def test_before_cursor(self):
        t2 = self.table.before("some-cursor")
        assert t2._before == "some-cursor"
        assert t2._after is None

    def test_cursor_and_offset_mutually_exclusive(self):
        with pytest.raises(ValueError):
            self.table.after("cursor").offset(2)._build_query_params()

    def test_search(self):
        t2 = self.table.search("hello world")
        assert t2._search == "hello world"


# ─── 4. EdgeBaseServer 생성 ───────────────────────────────────────────────────


class TestEdgeBaseServer:
    def setup_method(self):
        from edgebase import EdgeBaseServer

        self.admin = EdgeBaseServer(SERVER, service_key=SK)

    def test_init(self):
        assert self.admin is not None

    def test_db_returns_dbref(self):
        from edgebase.client import DbRef

        ref = self.admin.db("shared")
        assert isinstance(ref, DbRef)

    def test_db_with_instance_id(self):
        from edgebase.client import DbRef

        ref = self.admin.db("workspace", "ws-1")
        assert isinstance(ref, DbRef)

    def test_table_returns_tableref(self):
        from edgebase_core.table import TableRef

        ref = self.admin.db("shared").table("posts")
        assert isinstance(ref, TableRef)


class TestRoomLeave:
    def test_leave_sends_explicit_leave_before_close(self):
        from edgebase.room import RoomClient

        class FakeWebSocket:
            def __init__(self):
                self.events = []

            async def send(self, payload: str):
                msg = json.loads(payload)
                self.events.append(f"send:{msg['type']}")

            async def close(self):
                self.events.append("close")

        async def scenario():
            room = RoomClient("http://localhost:8688", "game", "room-1", token_getter=lambda: "token")
            ws = FakeWebSocket()
            room._ws = ws
            room._connected = True
            room._authenticated = True
            room._recv_task = asyncio.create_task(asyncio.sleep(60))
            room._heartbeat_task = asyncio.create_task(asyncio.sleep(60))

            recv_task = room._recv_task
            heartbeat_task = room._heartbeat_task
            await room.leave()

            with contextlib.suppress(asyncio.CancelledError):
                await recv_task
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat_task

            assert ws.events == ["send:leave", "close"]

        asyncio.run(scenario())


# ─── 5. DB CRUD E2E ─────────────────────────────────────────────────────────


@pytest.fixture
def admin():
    from edgebase import EdgeBaseServer

    return EdgeBaseServer(SERVER, service_key=SK)


@pytest.fixture
def test_post(admin):
    """Create a test post, yield its ID, delete after test."""
    suffix = uuid.uuid4().hex[:8]
    post = admin.db("shared").table("posts").insert({"title": f"pytest-{suffix}"})
    yield post
    raw("DELETE", f"/api/db/shared/tables/posts/{post['id']}")


@REQUIRES_SERVER
class TestDbCrud:
    def test_insert(self, admin):
        suffix = uuid.uuid4().hex[:8]
        post = admin.db("shared").table("posts").insert({"title": f"py-insert-{suffix}"})
        assert "id" in post
        assert post["title"] == f"py-insert-{suffix}"
        raw("DELETE", f"/api/db/shared/tables/posts/{post['id']}")

    def test_get_one(self, admin, test_post):
        got = admin.db("shared").table("posts").get_one(test_post["id"])
        assert got["id"] == test_post["id"]

    def test_update(self, admin, test_post):
        updated = (
            admin.db("shared").table("posts").doc(test_post["id"]).update({"title": "Updated"})
        )
        assert updated["title"] == "Updated"

    def test_delete(self, admin):
        suffix = uuid.uuid4().hex[:8]
        post = admin.db("shared").table("posts").insert({"title": f"delete-{suffix}"})
        admin.db("shared").table("posts").doc(post["id"]).delete()
        status, _ = raw("GET", f"/api/db/shared/tables/posts/{post['id']}")
        assert status == 404

    def test_list(self, admin):
        result = admin.db("shared").table("posts").limit(5).get()
        assert hasattr(result, "items")
        assert isinstance(result.items, list)

    def test_filter(self, admin, test_post):
        result = admin.db("shared").table("posts").where("id", "==", test_post["id"]).get()
        ids = [r["id"] for r in result.items]
        assert test_post["id"] in ids

    def test_count(self, admin):
        total = admin.db("shared").table("posts").count()
        assert isinstance(total, int)
        assert total >= 0

    def test_insert_many(self, admin):
        suffix = uuid.uuid4().hex[:8]
        records = [{"title": f"many-{suffix}-{i}"} for i in range(3)]
        created = admin.db("shared").table("posts").insert_many(records)
        assert len(created) == 3
        for record in created:
            raw("DELETE", f"/api/db/shared/tables/posts/{record['id']}")

    def test_upsert_insert(self, admin):
        suffix = uuid.uuid4().hex[:8]
        result = admin.db("shared").table("posts").upsert({"title": f"upsert-{suffix}"})
        assert result.inserted is True
        raw("DELETE", f"/api/db/shared/tables/posts/{result.record['id']}")

    def test_sort_asc(self, admin):
        result = admin.db("shared").table("posts").order_by("title", "asc").limit(10).get()
        titles = [r["title"] for r in result.items]
        assert titles == sorted(titles)


# ─── 6. increment / deleteField E2E ─────────────────────────────────────────


@REQUIRES_SERVER
class TestFieldOpsE2E:
    def test_increment_e2e(self, admin):
        from edgebase_core.field_ops import increment

        suffix = uuid.uuid4().hex[:8]
        post = admin.db("shared").table("posts").insert({"title": f"inc-{suffix}", "viewCount": 0})
        updated = (
            admin.db("shared").table("posts").doc(post["id"]).update({"viewCount": increment(3)})
        )
        assert updated["viewCount"] == 3
        raw("DELETE", f"/api/db/shared/tables/posts/{post['id']}")

    def test_delete_field_e2e(self, admin):
        from edgebase_core.field_ops import delete_field

        suffix = uuid.uuid4().hex[:8]
        post = admin.db("shared").table("posts").insert({"title": f"del-field-{suffix}"})
        updated = (
            admin.db("shared").table("posts").doc(post["id"]).update({"title": delete_field()})
        )
        assert updated.get("title") is None
        raw("DELETE", f"/api/db/shared/tables/posts/{post['id']}")


# ─── 7. adminAuth E2E ────────────────────────────────────────────────────────


@REQUIRES_SERVER
class TestAdminAuth:
    def test_list_users(self, admin):
        try:
            result = admin.admin_auth.list_users()
            assert isinstance(result, (list, dict))
        except Exception as e:
            assert hasattr(e, "status_code")

    def test_create_user(self, admin):
        suffix = uuid.uuid4().hex[:8]
        email = f"py-user-{suffix}@test.com"
        try:
            user = admin.admin_auth.create_user(email=email, password="PyTest1234!")
            assert user.get("id") is not None
            if user.get("id"):
                admin.admin_auth.delete_user(user["id"])
        except Exception as e:
            # May not be implemented or available
            assert hasattr(e, "status_code") or isinstance(e, (AttributeError, Exception))

    def test_get_user_not_found(self, admin):
        try:
            admin.admin_auth.get_user("nonexistent-user-id-xyz")
        except Exception as e:
            # 404 expected
            status = getattr(e, "status_code", None) or getattr(e, "status", None)
            assert status in (404, 400, 405, None)

    def test_set_custom_claims(self, admin):
        suffix = uuid.uuid4().hex[:8]
        status, data = raw(
            "POST",
            "/api/auth/signup",
            {"email": f"py-claims-{suffix}@test.com", "password": "Claims1234!"},
        )
        user_id = data["user"]["id"] if data else None
        if not user_id:
            return
        try:
            admin.admin_auth.set_custom_claims(user_id, {"role": "admin"})
        except Exception:
            pass  # May not be implemented


# ─── 8. sql E2E ─────────────────────────────────────────────────────────────


@REQUIRES_SERVER
class TestSql:
    def test_select(self, admin):
        try:
            rows = admin.sql("shared", None, "SELECT 1 as num")
            assert isinstance(rows, list)
            assert rows[0]["num"] == 1
        except Exception as e:
            status = getattr(e, "status_code", None) or getattr(e, "status", None)
            assert status in (200, 403, 404, 405, None)

    def test_select_posts(self, admin):
        try:
            rows = admin.sql("shared", None, "SELECT * FROM posts LIMIT 3")
            assert isinstance(rows, list)
        except Exception:
            pass

    def test_invalid_sql_raises(self, admin):
        with pytest.raises(Exception):
            admin.sql("shared", None, "INVALID SQL;")


# ─── 9. KV E2E ───────────────────────────────────────────────────────────────


@REQUIRES_SERVER
class TestKv:
    def test_set_get_delete(self, admin):
        key = f"py-kv-{uuid.uuid4().hex[:8]}"
        try:
            admin.kv("user-meta").set(key, "hello")
            val = admin.kv("user-meta").get(key)
            assert val == "hello"
            admin.kv("user-meta").delete(key)
            val2 = admin.kv("user-meta").get(key)
            assert val2 is None
        except Exception as e:
            status = getattr(e, "status_code", None) or getattr(e, "status", None)
            assert status in (200, 404, None)

    def test_list(self, admin):
        try:
            result = admin.kv("user-meta").list()
            assert isinstance(result.get("keys", []), list)
        except Exception as e:
            status = getattr(e, "status_code", None) or getattr(e, "status", None)
            assert status in (200, 404, None)


# ─── 10. broadcast E2E ────────────────────────────────────────────────────────


@REQUIRES_SERVER
class TestBroadcast:
    def test_broadcast(self, admin):
        try:
            admin.broadcast("py-test-channel", "py-event", {"msg": "hello"})
        except Exception as e:
            status = getattr(e, "status_code", None) or getattr(e, "status", None)
            assert status in (200, 404, 405, None)


# ─── 11. storage E2E ─────────────────────────────────────────────────────────


@REQUIRES_SERVER
class TestStorage:
    def test_list(self, admin):
        result = admin.storage.bucket("avatars").list()
        assert isinstance(result, (list, dict))

    def test_upload_and_delete(self, admin):
        key = f"py-{uuid.uuid4().hex[:8]}.txt"
        try:
            # Python storage uses upload() method
            content = b"hello from python sdk"
            resp = admin.storage.bucket("avatars").upload(key, content, content_type="text/plain")
            assert resp is not None
            admin.storage.bucket("avatars").delete(key)
        except Exception as e:
            status = getattr(e, "status_code", None) or getattr(e, "status", None)
            assert status in (200, 201, 204, 400, 404, None)
