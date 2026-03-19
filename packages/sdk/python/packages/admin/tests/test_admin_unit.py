"""
edgebase-admin Python SDK — 단위 테스트

테스트 대상:
  - edgebase_admin.admin_client.AdminClient (db/storage/admin_auth)
  - edgebase_admin.admin_client.DbRef (table 접근)
  - edgebase_admin.admin_auth.AdminAuthClient (service key 가드)
  - edgebase_core.errors.EdgeBaseError 가드 동작

실행: cd packages/sdk/python/packages/admin && pytest tests/test_admin_unit.py -v

원칙: 서버 불필요 — 순수 Python 로직만 검증
"""

import pytest
from unittest.mock import MagicMock
from edgebase_admin.admin_client import AdminClient, DbRef, create_admin_client
from edgebase_admin.analytics import AnalyticsClient
from edgebase_admin.admin_auth import AdminAuthClient
from edgebase_admin.d1 import D1Client
from edgebase_admin.functions import FunctionsClient
from edgebase_admin.kv import KvClient
from edgebase_admin.push import PushClient
from edgebase_admin.vectorize import VectorizeClient
from edgebase_core.errors import EdgeBaseError
from edgebase_core.generated.api_core import GeneratedDbApi
from edgebase_core.table import TableRef


# ─── A. AdminClient 생성 ──────────────────────────────────────────────────────


class TestAdminClientCreation:
    def test_create_admin_client_helper(self):
        admin = create_admin_client("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin, AdminClient)

    def test_create_admin_client_helper_accepts_positional_service_key(self):
        admin = create_admin_client("http://localhost:9999", "sk-test")
        assert isinstance(admin, AdminClient)

    def test_admin_client_creates_admin_auth(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin.admin_auth, AdminAuthClient)

    def test_admin_client_db_returns_dbref(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        db = admin.db("shared")
        assert isinstance(db, DbRef)

    def test_admin_client_db_default_namespace(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        db = admin.db()
        assert db._namespace == "shared"

    def test_admin_client_db_custom_namespace(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        db = admin.db("workspace")
        assert db._namespace == "workspace"

    def test_admin_client_db_with_instance_id(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        db = admin.db("workspace", instance_id="ws-123")
        assert db._instance_id == "ws-123"

    def test_admin_client_storage_returns_storage_client(self):
        from edgebase_core.storage import StorageClient

        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        storage = admin.storage()
        assert isinstance(storage, StorageClient)

    def test_admin_client_push_returns_push_client(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin.push(), PushClient)

    def test_admin_client_kv_returns_kv_client(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin.kv("cache"), KvClient)

    def test_admin_client_d1_returns_d1_client(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin.d1("analytics"), D1Client)

    def test_admin_client_vector_returns_vectorize_client(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin.vector("embeddings"), VectorizeClient)

    def test_admin_client_vectorize_alias_returns_vectorize_client(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin.vectorize("embeddings"), VectorizeClient)

    def test_admin_client_functions_returns_functions_client(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin.functions(), FunctionsClient)

    def test_admin_client_analytics_returns_analytics_client(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        assert isinstance(admin.analytics(), AnalyticsClient)

    def test_admin_sql_requires_non_empty_query(self):
        admin = AdminClient("http://localhost:9999", service_key="sk-test")
        with pytest.raises(ValueError, match="non-empty query"):
            admin.sql()


# ─── B. DbRef.table() ─────────────────────────────────────────────────────────


class TestDbRef:
    def make_dbref(self, namespace="shared", instance_id=None):
        http = MagicMock()
        http._service_key = "sk-test"
        core = GeneratedDbApi(http)
        return DbRef(core, namespace, instance_id)

    def test_table_returns_tableref(self):
        db = self.make_dbref()
        t = db.table("posts")
        assert isinstance(t, TableRef)

    def test_table_name_set(self):
        db = self.make_dbref()
        t = db.table("posts")
        assert t._name == "posts"

    def test_table_namespace_propagated(self):
        db = self.make_dbref(namespace="workspace")
        t = db.table("docs")
        assert t._namespace == "workspace"

    def test_table_instance_id_propagated(self):
        db = self.make_dbref(namespace="workspace", instance_id="ws-42")
        t = db.table("items")
        assert t._instance_id == "ws-42"

    def test_table_immutable_chain(self):
        db = self.make_dbref()
        t1 = db.table("posts").where("status", "==", "published")
        t2 = db.table("posts")
        # t2 should have no filters
        assert len(t2._filters) == 0
        assert len(t1._filters) == 1


# ─── C. AdminAuthClient — service key 가드 ────────────────────────────────────


class TestAdminAuthServiceKeyGuard:
    def make_auth_no_key(self):
        http = MagicMock()
        http._service_key = None
        return AdminAuthClient(http)

    def make_auth_with_key(self):
        http = MagicMock()
        http._service_key = "sk-test"
        return AdminAuthClient(http)

    def test_get_user_without_key_raises(self):
        auth = self.make_auth_no_key()
        with pytest.raises(EdgeBaseError) as exc_info:
            auth.get_user("user-1")
        assert exc_info.value.status_code == 403

    def test_create_user_without_key_raises(self):
        auth = self.make_auth_no_key()
        with pytest.raises(EdgeBaseError) as exc_info:
            auth.create_user("test@test.com", "pass")
        assert exc_info.value.status_code == 403

    def test_update_user_without_key_raises(self):
        auth = self.make_auth_no_key()
        with pytest.raises(EdgeBaseError):
            auth.update_user("user-1", {"email": "x@x.com"})

    def test_delete_user_without_key_raises(self):
        auth = self.make_auth_no_key()
        with pytest.raises(EdgeBaseError):
            auth.delete_user("user-1")

    def test_list_users_without_key_raises(self):
        auth = self.make_auth_no_key()
        with pytest.raises(EdgeBaseError):
            auth.list_users()

    def test_set_custom_claims_without_key_raises(self):
        auth = self.make_auth_no_key()
        with pytest.raises(EdgeBaseError):
            auth.set_custom_claims("user-1", {"role": "admin"})

    def test_revoke_all_sessions_without_key_raises(self):
        auth = self.make_auth_no_key()
        with pytest.raises(EdgeBaseError):
            auth.revoke_all_sessions("user-1")

    def test_get_user_with_key_calls_http(self):
        auth = self.make_auth_with_key()
        auth._client.get.return_value = {"id": "u-1", "email": "a@b.com"}
        result = auth.get_user("u-1")
        auth._client.get.assert_called_once_with("/auth/admin/users/u-1")
        assert result["id"] == "u-1"

    def test_get_user_flattens_nested_user_payload(self):
        auth = self.make_auth_with_key()
        auth._client.get.return_value = {
            "user": {"id": "u-1", "role": "operator"},
            "customClaims": {"tier": "lab"},
        }

        result = auth.get_user("u-1")

        assert result["id"] == "u-1"
        assert result["role"] == "operator"
        assert result["customClaims"] == {"tier": "lab"}

    def test_create_user_with_key_sends_email_password(self):
        auth = self.make_auth_with_key()
        auth._client.post.return_value = {"id": "u-new"}
        auth.create_user("new@new.com", "SuperPass123!")
        call_args = auth._client.post.call_args
        assert call_args[0][0] == "/auth/admin/users"
        assert call_args[0][1]["email"] == "new@new.com"

    def test_create_user_with_data(self):
        auth = self.make_auth_with_key()
        auth._client.post.return_value = {"id": "u-new"}
        auth.create_user("a@b.com", "pass", data={"displayName": "Alice"})
        body = auth._client.post.call_args[0][1]
        assert body["data"]["displayName"] == "Alice"

    def test_list_users_default_limit(self):
        auth = self.make_auth_with_key()
        auth._client.get.return_value = {"users": []}
        auth.list_users()
        call_args = auth._client.get.call_args
        assert call_args[0][1]["limit"] == "20"

    def test_list_users_with_cursor(self):
        auth = self.make_auth_with_key()
        auth._client.get.return_value = {"users": []}
        auth.list_users(cursor="some-cursor")
        params = auth._client.get.call_args[0][1]
        assert params["cursor"] == "some-cursor"

    def test_set_custom_claims_sends_correct_path(self):
        auth = self.make_auth_with_key()
        auth._client.put = MagicMock()
        auth.set_custom_claims("u-42", {"tier": "pro"})
        auth._client.put.assert_called_once_with("/auth/admin/users/u-42/claims", {"tier": "pro"})

    def test_revoke_all_sends_correct_path(self):
        auth = self.make_auth_with_key()
        auth._client.post.return_value = {}
        auth.revoke_all_sessions("u-42")
        auth._client.post.assert_called_once_with("/auth/admin/users/u-42/revoke")

    def test_update_user_sends_correct_path(self):
        auth = self.make_auth_with_key()
        auth._client.patch = MagicMock(return_value={"id": "u-42"})
        auth.update_user("u-42", {"displayName": "Alice"})
        auth._client.patch.assert_called_once_with(
            "/auth/admin/users/u-42", {"displayName": "Alice"}
        )

    def test_delete_user_sends_correct_path(self):
        auth = self.make_auth_with_key()
        auth._client.delete = MagicMock(return_value={})
        auth.delete_user("u-42")
        auth._client.delete.assert_called_once_with("/auth/admin/users/u-42")

    def test_create_user_without_data(self):
        auth = self.make_auth_with_key()
        auth._client.post.return_value = {"id": "u-new"}
        auth.create_user("a@b.com", "pass")
        body = auth._client.post.call_args[0][1]
        assert "data" not in body

    def test_list_users_custom_limit(self):
        auth = self.make_auth_with_key()
        auth._client.get.return_value = {"users": []}
        auth.list_users(limit=50)
        params = auth._client.get.call_args[0][1]
        assert params["limit"] == "50"

    def test_list_users_returns_dict_fallback(self):
        auth = self.make_auth_with_key()
        auth._client.get.return_value = "not a dict"
        result = auth.list_users()
        assert result == {"users": [], "cursor": None}


# ─── D. KvClient 단위 ────────────────────────────────────────────────────────


from edgebase_admin.kv import KvClient


class TestKvClientUnit:
    def make_kv(self):
        http = MagicMock()
        http._service_key = "sk-test"
        return KvClient(http, "user-meta")

    def test_get_sends_action_get(self):
        kv = self.make_kv()
        kv._http.post.return_value = {"value": "hello"}
        result = kv.get("mykey")
        kv._http.post.assert_called_once_with(
            "/kv/user-meta", {"action": "get", "key": "mykey"}
        )
        assert result == "hello"

    def test_get_returns_none_when_missing(self):
        kv = self.make_kv()
        kv._http.post.return_value = {}
        result = kv.get("missing")
        assert result is None

    def test_set_sends_action_set(self):
        kv = self.make_kv()
        kv._http.post.return_value = {}
        kv.set("mykey", "myval")
        kv._http.post.assert_called_once_with(
            "/kv/user-meta", {"action": "set", "key": "mykey", "value": "myval"}
        )

    def test_set_with_ttl(self):
        kv = self.make_kv()
        kv._http.post.return_value = {}
        kv.set("mykey", "myval", ttl=300)
        body = kv._http.post.call_args[0][1]
        assert body["ttl"] == 300

    def test_delete_sends_action_delete(self):
        kv = self.make_kv()
        kv._http.post.return_value = {}
        kv.delete("mykey")
        kv._http.post.assert_called_once_with(
            "/kv/user-meta", {"action": "delete", "key": "mykey"}
        )

    def test_list_default(self):
        kv = self.make_kv()
        kv._http.post.return_value = {"keys": []}
        kv.list()
        body = kv._http.post.call_args[0][1]
        assert body["action"] == "list"
        assert "prefix" not in body

    def test_list_with_prefix_limit_cursor(self):
        kv = self.make_kv()
        kv._http.post.return_value = {"keys": []}
        kv.list(prefix="user:", limit=10, cursor="abc")
        body = kv._http.post.call_args[0][1]
        assert body["prefix"] == "user:"
        assert body["limit"] == 10
        assert body["cursor"] == "abc"


# ─── E. D1Client 단위 ────────────────────────────────────────────────────────


from edgebase_admin.d1 import D1Client


class TestD1ClientUnit:
    def make_d1(self):
        http = MagicMock()
        http._service_key = "sk-test"
        return D1Client(http, "analytics")

    def test_exec_sends_query(self):
        d1 = self.make_d1()
        d1._http.post.return_value = {"results": [{"num": 1}]}
        result = d1.exec("SELECT 1 as num")
        d1._http.post.assert_called_once_with(
            "/d1/analytics", {"query": "SELECT 1 as num"}
        )
        assert result == [{"num": 1}]

    def test_exec_with_params(self):
        d1 = self.make_d1()
        d1._http.post.return_value = {"results": []}
        d1.exec("SELECT * FROM events WHERE type = ?", ["click"])
        body = d1._http.post.call_args[0][1]
        assert body["params"] == ["click"]

    def test_exec_returns_empty_on_no_results(self):
        d1 = self.make_d1()
        d1._http.post.return_value = {}
        result = d1.exec("SELECT 1")
        assert result == []


# ─── F. VectorizeClient 단위 ──────────────────────────────────────────────────


from edgebase_admin.vectorize import VectorizeClient


class TestVectorizeClientUnit:
    def make_vec(self):
        http = MagicMock()
        http._service_key = "sk-test"
        return VectorizeClient(http, "embeddings")

    def test_upsert_sends_vectors(self):
        vec = self.make_vec()
        vec._http.post.return_value = {}
        vectors = [{"id": "v1", "values": [0.1, 0.2]}]
        vec.upsert(vectors)
        body = vec._http.post.call_args[0][1]
        assert body["action"] == "upsert"
        assert body["vectors"] == vectors

    def test_search_default_top_k(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"matches": []}
        vec.search([0.1, 0.2])
        body = vec._http.post.call_args[0][1]
        assert body["topK"] == 10
        assert body["action"] == "search"

    def test_search_custom_top_k(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"matches": []}
        vec.search([0.1], top_k=5)
        body = vec._http.post.call_args[0][1]
        assert body["topK"] == 5

    def test_search_with_filter(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"matches": []}
        vec.search([0.1], filter={"type": "doc"})
        body = vec._http.post.call_args[0][1]
        assert body["filter"] == {"type": "doc"}

    def test_search_returns_matches(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"matches": [{"id": "v1", "score": 0.95}]}
        result = vec.search([0.1])
        assert len(result) == 1
        assert result[0]["score"] == 0.95

    def test_delete_sends_ids(self):
        vec = self.make_vec()
        vec._http.post.return_value = {}
        vec.delete(["v1", "v2"])
        body = vec._http.post.call_args[0][1]
        assert body["action"] == "delete"
        assert body["ids"] == ["v1", "v2"]

    def test_insert_sends_vectors(self):
        vec = self.make_vec()
        vec._http.post.return_value = {}
        vectors = [{"id": "v1", "values": [0.1, 0.2]}]
        vec.insert(vectors)
        body = vec._http.post.call_args[0][1]
        assert body["action"] == "insert"
        assert body["vectors"] == vectors

    def test_query_by_id_sends_vector_id(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"matches": []}
        vec.query_by_id("v1")
        body = vec._http.post.call_args[0][1]
        assert body["action"] == "queryById"
        assert body["vectorId"] == "v1"
        assert body["topK"] == 10

    def test_get_by_ids_sends_ids(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"vectors": []}
        vec.get_by_ids(["v1", "v2"])
        body = vec._http.post.call_args[0][1]
        assert body["action"] == "getByIds"
        assert body["ids"] == ["v1", "v2"]

    def test_describe_sends_action(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"vectorCount": 0, "dimensions": 1536, "metric": "cosine"}
        result = vec.describe()
        body = vec._http.post.call_args[0][1]
        assert body["action"] == "describe"
        assert result["dimensions"] == 1536

    def test_search_with_namespace(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"matches": []}
        vec.search([0.1], namespace="test-ns")
        body = vec._http.post.call_args[0][1]
        assert body["namespace"] == "test-ns"

    def test_search_with_return_values(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"matches": []}
        vec.search([0.1], return_values=True)
        body = vec._http.post.call_args[0][1]
        assert body["returnValues"] is True

    def test_search_with_return_metadata(self):
        vec = self.make_vec()
        vec._http.post.return_value = {"matches": []}
        vec.search([0.1], return_metadata="all")
        body = vec._http.post.call_args[0][1]
        assert body["returnMetadata"] == "all"


# ─── G. PushClient 단위 ──────────────────────────────────────────────────────


from edgebase_admin.push import PushClient


class TestPushClientUnit:
    def make_push(self):
        http = MagicMock()
        http._service_key = "sk-test"
        return PushClient(http)

    def test_send_sends_correct_body(self):
        push = self.make_push()
        push._http.post.return_value = {"sent": 1}
        push.send("user-1", {"title": "Hi", "body": "Hello"})
        body = push._http.post.call_args[0][1]
        assert body["userId"] == "user-1"
        assert body["payload"]["title"] == "Hi"

    def test_send_many_sends_user_ids(self):
        push = self.make_push()
        push._http.post.return_value = {"sent": 2}
        push.send_many(["u1", "u2"], {"title": "News"})
        body = push._http.post.call_args[0][1]
        assert body["userIds"] == ["u1", "u2"]

    def test_send_to_token_body(self):
        push = self.make_push()
        push._http.post.return_value = {"sent": 1}
        push.send_to_token("fcm-token-123", {"title": "Test"})
        body = push._http.post.call_args[0][1]
        assert body["token"] == "fcm-token-123"
        assert body["payload"] == {"title": "Test"}

    def test_get_tokens_returns_list(self):
        push = self.make_push()
        push._http.get.return_value = {"items": [{"id": "tok-1"}]}
        result = push.get_tokens("user-1")
        assert len(result) == 1

    def test_get_tokens_non_dict_fallback(self):
        push = self.make_push()
        push._http.get.return_value = "bad response"
        result = push.get_tokens("user-1")
        assert result == []

    def test_get_logs_returns_list(self):
        push = self.make_push()
        push._http.get.return_value = {"items": [{"status": "sent"}]}
        result = push.get_logs("user-1")
        assert len(result) == 1

    def test_get_logs_with_limit(self):
        push = self.make_push()
        push._http.get.return_value = {"items": []}
        push.get_logs("user-1", limit=5)
        call_args = push._http.get.call_args
        assert call_args[0][0] == "/push/logs"
        params = call_args[1]["params"]
        assert params["limit"] == "5"
        assert params["userId"] == "user-1"

    def test_get_logs_non_dict_fallback(self):
        push = self.make_push()
        push._http.get.return_value = "bad"
        result = push.get_logs("user-1")
        assert result == []

    # ─── FCM 일원화: send_to_topic / broadcast ───

    def test_send_to_topic_sends_correct_body(self):
        push = self.make_push()
        push._http.post.return_value = {"success": True}
        push.send_to_topic("news", {"title": "Breaking", "body": "Hello"})
        push._http.post.assert_called_once()
        call_args = push._http.post.call_args
        assert call_args[0][0] == "/push/send-to-topic"
        body = call_args[0][1]
        assert body["topic"] == "news"
        assert body["payload"]["title"] == "Breaking"

    def test_broadcast_sends_correct_body(self):
        push = self.make_push()
        push._http.post.return_value = {"success": True}
        push.broadcast({"title": "Announcement", "body": "Hi all"})
        push._http.post.assert_called_once()
        call_args = push._http.post.call_args
        assert call_args[0][0] == "/push/broadcast"
        body = call_args[0][1]
        assert body["payload"]["title"] == "Announcement"
