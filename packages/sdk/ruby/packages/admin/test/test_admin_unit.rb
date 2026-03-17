# frozen_string_literal: true

#
# edgebase-admin Ruby SDK — unit tests
#
# Test targets:
#   - EdgebaseAdmin::AdminClient (db/storage/admin_auth)
#   - EdgebaseAdmin::DbRef (table access)
#   - EdgebaseAdmin::AdminAuthClient (service key guard)
#   - EdgebaseAdmin::KvClient, D1Client, VectorizeClient, PushClient
#
# Run: cd packages/sdk/ruby/packages/admin && ruby -Ilib -I../core/lib -Itest test/test_admin_unit.rb
#
# Principle: no server needed — pure Ruby logic only.
#

require "minitest/autorun"
require "edgebase_core"
require "edgebase_admin"
require "json"

# ── Minimal Mock Object ───────────────────────────────────────────────────────

class MockHttp
  attr_accessor :base_url, :last_method, :last_path, :last_body, :last_params
  attr_accessor :return_value

  def initialize(service_key: nil)
    @base_url = "http://localhost:8688"
    @service_key = service_key
    @return_value = {}
  end

  def get(path, params: nil)
    @last_method = "GET"
    @last_path = path
    @last_params = params
    @return_value
  end

  def post(path, body = nil)
    @last_method = "POST"
    @last_path = path
    @last_body = body
    @return_value
  end

  def patch(path, body = nil)
    @last_method = "PATCH"
    @last_path = path
    @last_body = body
    @return_value
  end

  def put(path, body = nil)
    @last_method = "PUT"
    @last_path = path
    @last_body = body
    @return_value
  end

  def delete(path)
    @last_method = "DELETE"
    @last_path = path
    @return_value
  end

  def head(path)
    @last_method = "HEAD"
    @last_path = path
    true
  end
end

# ─── A. AdminClient creation ─────────────────────────────────────────────────

class TestAdminClientCreation < Minitest::Test
  def test_admin_client_creates_admin_auth
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    assert_kind_of EdgebaseAdmin::AdminAuthClient, admin.admin_auth
  end

  def test_admin_client_db_returns_dbref
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    db = admin.db("shared")
    assert_kind_of EdgebaseAdmin::DbRef, db
  end

  def test_admin_client_db_default_namespace
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    db = admin.db
    assert_equal "shared", db._namespace
  end

  def test_admin_client_db_custom_namespace
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    db = admin.db("workspace")
    assert_equal "workspace", db._namespace
  end

  def test_admin_client_db_with_instance_id
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    db = admin.db("workspace", instance_id: "ws-123")
    assert_equal "ws-123", db._instance_id
  end

  def test_admin_client_storage_returns_storage_client
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    storage = admin.storage
    assert_kind_of EdgebaseCore::StorageClient, storage
  end

  def test_admin_client_functions_returns_functions_client
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    assert_kind_of EdgebaseAdmin::FunctionsClient, admin.functions
  end

  def test_admin_client_analytics_returns_analytics_client
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    assert_kind_of EdgebaseAdmin::AnalyticsClient, admin.analytics
  end

  def test_admin_client_destroy_is_noop
    admin = EdgebaseAdmin::AdminClient.new("http://localhost:9999", service_key: "sk-test")
    assert_nil admin.destroy
  end
end

# ─── B. DbRef.table() ────────────────────────────────────────────────────────

class TestDbRef < Minitest::Test
  def make_dbref(namespace = "shared", instance_id = nil)
    http = MockHttp.new(service_key: "sk-test")
    core = EdgebaseCore::GeneratedDbApi.new(http)
    EdgebaseAdmin::DbRef.new(core, namespace, instance_id)
  end

  def test_table_returns_tableref
    db = make_dbref
    t = db.table("posts")
    assert_kind_of EdgebaseCore::TableRef, t
  end

  def test_table_name_set
    db = make_dbref
    t = db.table("posts")
    assert_equal "posts", t._name
  end

  def test_table_namespace_propagated
    db = make_dbref("workspace")
    t = db.table("docs")
    assert_equal "workspace", t._namespace
  end

  def test_table_instance_id_propagated
    db = make_dbref("workspace", "ws-42")
    t = db.table("items")
    assert_equal "ws-42", t._instance_id
  end

  def test_table_immutable_chain
    db = make_dbref
    t1 = db.table("posts").where("status", "==", "published")
    t2 = db.table("posts")
    assert_equal 0, t2._filters.length
    assert_equal 1, t1._filters.length
  end
end

# ─── C. AdminAuthClient — service key guard ──────────────────────────────────

class TestAdminAuthServiceKeyGuard < Minitest::Test
  def make_auth_no_key
    http = MockHttp.new(service_key: nil)
    EdgebaseAdmin::AdminAuthClient.new(http)
  end

  def make_auth_with_key
    http = MockHttp.new(service_key: "sk-test")
    EdgebaseAdmin::AdminAuthClient.new(http)
  end

  def test_get_user_without_key_raises
    auth = make_auth_no_key
    err = assert_raises(EdgebaseCore::EdgeBaseError) { auth.get_user("user-1") }
    assert_equal 403, err.status_code
  end

  def test_create_user_without_key_raises
    auth = make_auth_no_key
    err = assert_raises(EdgebaseCore::EdgeBaseError) { auth.create_user("test@test.com", "pass") }
    assert_equal 403, err.status_code
  end

  def test_update_user_without_key_raises
    auth = make_auth_no_key
    assert_raises(EdgebaseCore::EdgeBaseError) { auth.update_user("user-1", "email" => "x@x.com") }
  end

  def test_delete_user_without_key_raises
    auth = make_auth_no_key
    assert_raises(EdgebaseCore::EdgeBaseError) { auth.delete_user("user-1") }
  end

  def test_list_users_without_key_raises
    auth = make_auth_no_key
    assert_raises(EdgebaseCore::EdgeBaseError) { auth.list_users }
  end

  def test_set_custom_claims_without_key_raises
    auth = make_auth_no_key
    assert_raises(EdgebaseCore::EdgeBaseError) { auth.set_custom_claims("user-1", "role" => "admin") }
  end

  def test_revoke_all_sessions_without_key_raises
    auth = make_auth_no_key
    assert_raises(EdgebaseCore::EdgeBaseError) { auth.revoke_all_sessions("user-1") }
  end

  def test_get_user_with_key_calls_http
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "id" => "u-1", "email" => "a@b.com" }
    result = auth.get_user("u-1")
    assert_equal "/auth/admin/users/u-1", http.last_path
    assert_equal "u-1", result["id"]
  end

  def test_create_user_with_key_sends_email_password
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "id" => "u-new" }
    auth.create_user("new@new.com", "SuperPass123!")
    assert_equal "/auth/admin/users", http.last_path
    assert_equal "new@new.com", http.last_body["email"]
  end

  def test_create_user_with_data
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "id" => "u-new" }
    auth.create_user("a@b.com", "pass", data: { "displayName" => "Alice" })
    assert_equal "Alice", http.last_body["data"]["displayName"]
  end

  def test_create_user_accepts_keyword_args
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "id" => "u-new" }
    auth.create_user(email: "kw@example.com", password: "pass", emailVerified: true)
    assert_equal "kw@example.com", http.last_body["email"]
    assert_equal "pass", http.last_body["password"]
    assert_equal true, http.last_body["emailVerified"]
  end

  def test_create_user_accepts_hash_payload
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "id" => "u-new" }
    auth.create_user("email" => "hash@example.com", "password" => "pass", "emailVerified" => true)
    assert_equal "hash@example.com", http.last_body["email"]
    assert_equal true, http.last_body["emailVerified"]
  end

  def test_list_users_default_limit
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "users" => [] }
    auth.list_users
    assert_equal "20", http.last_params["limit"]
  end

  def test_list_users_with_cursor
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "users" => [] }
    auth.list_users(cursor: "some-cursor")
    assert_equal "some-cursor", http.last_params["cursor"]
  end

  def test_set_custom_claims_sends_correct_path
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = {}
    auth.set_custom_claims("u-42", "tier" => "pro")
    assert_equal "/auth/admin/users/u-42/claims", http.last_path
    assert_equal "PUT", http.last_method
  end

  def test_revoke_all_sends_correct_path
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = {}
    auth.revoke_all_sessions("u-42")
    assert_equal "/auth/admin/users/u-42/revoke", http.last_path
    assert_equal "POST", http.last_method
  end

  def test_update_user_sends_correct_path
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "id" => "u-42" }
    auth.update_user("u-42", "displayName" => "Alice")
    assert_equal "/auth/admin/users/u-42", http.last_path
    assert_equal "PATCH", http.last_method
  end

  def test_delete_user_sends_correct_path
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = {}
    auth.delete_user("u-42")
    assert_equal "/auth/admin/users/u-42", http.last_path
    assert_equal "DELETE", http.last_method
  end

  def test_create_user_without_data
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "id" => "u-new" }
    auth.create_user("a@b.com", "pass")
    refute http.last_body.key?("data")
  end

  def test_list_users_custom_limit
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = { "users" => [] }
    auth.list_users(limit: 50)
    assert_equal "50", http.last_params["limit"]
  end

  def test_list_users_returns_dict_fallback
    auth = make_auth_with_key
    http = auth.instance_variable_get(:@client)
    http.return_value = "not a dict"
    result = auth.list_users
    assert_equal({ "users" => [], "cursor" => nil }, result)
  end
end

# ─── D. KvClient unit ────────────────────────────────────────────────────────

class TestKvClientUnit < Minitest::Test
  def make_kv
    http = MockHttp.new(service_key: "sk-test")
    EdgebaseAdmin::KvClient.new(http, "user-meta")
  end

  def test_get_returns_value
    kv = make_kv
    admin_core = kv.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = { "value" => "hello" }
    result = kv.get("mykey")
    assert_equal "hello", result
  end

  def test_get_returns_nil_when_missing
    kv = make_kv
    admin_core = kv.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = {}
    result = kv.get("missing")
    assert_nil result
  end

  def test_set_sends_key_value
    kv = make_kv
    admin_core = kv.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = {}
    kv.set("mykey", "myval")
    assert_equal "set", http.last_body["action"]
    assert_equal "mykey", http.last_body["key"]
    assert_equal "myval", http.last_body["value"]
  end

  def test_set_with_ttl
    kv = make_kv
    admin_core = kv.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = {}
    kv.set("mykey", "myval", ttl: 300)
    assert_equal 300, http.last_body["ttl"]
  end

  def test_delete_sends_action_delete
    kv = make_kv
    admin_core = kv.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = {}
    kv.delete("mykey")
    assert_equal "delete", http.last_body["action"]
    assert_equal "mykey", http.last_body["key"]
  end

  def test_list_default
    kv = make_kv
    admin_core = kv.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = { "keys" => [] }
    kv.list
    assert_equal "list", http.last_body["action"]
    refute http.last_body.key?("prefix")
  end

  def test_list_with_prefix_limit_cursor
    kv = make_kv
    admin_core = kv.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = { "keys" => [] }
    kv.list(prefix: "user:", limit: 10, cursor: "abc")
    assert_equal "user:", http.last_body["prefix"]
    assert_equal 10, http.last_body["limit"]
    assert_equal "abc", http.last_body["cursor"]
  end
end

# ─── E. D1Client unit ────────────────────────────────────────────────────────

class TestD1ClientUnit < Minitest::Test
  def make_d1
    http = MockHttp.new(service_key: "sk-test")
    EdgebaseAdmin::D1Client.new(http, "analytics")
  end

  def test_exec_sends_query
    d1 = make_d1
    admin_core = d1.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = { "results" => [{ "num" => 1 }] }
    result = d1.exec("SELECT 1 as num")
    assert_equal "SELECT 1 as num", http.last_body["query"]
    assert_equal [{ "num" => 1 }], result
  end

  def test_exec_with_params
    d1 = make_d1
    admin_core = d1.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = { "results" => [] }
    d1.exec("SELECT * FROM events WHERE type = ?", ["click"])
    assert_equal ["click"], http.last_body["params"]
  end

  def test_exec_returns_empty_on_no_results
    d1 = make_d1
    admin_core = d1.instance_variable_get(:@admin_core)
    http = admin_core.instance_variable_get(:@http)
    http.return_value = {}
    result = d1.exec("SELECT 1")
    assert_equal [], result
  end
end

# ─── F. VectorizeClient unit ─────────────────────────────────────────────────

class TestVectorizeClientUnit < Minitest::Test
  def make_vec
    http = MockHttp.new(service_key: "sk-test")
    EdgebaseAdmin::VectorizeClient.new(http, "embeddings")
  end

  def get_http(vec)
    admin_core = vec.instance_variable_get(:@admin_core)
    admin_core.instance_variable_get(:@http)
  end

  def test_upsert_sends_vectors
    vec = make_vec
    http = get_http(vec)
    http.return_value = {}
    vectors = [{ "id" => "v1", "values" => [0.1, 0.2] }]
    vec.upsert(vectors)
    assert_equal "upsert", http.last_body["action"]
    assert_equal vectors, http.last_body["vectors"]
  end

  def test_search_default_top_k
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "matches" => [] }
    vec.search([0.1, 0.2])
    assert_equal 10, http.last_body["topK"]
    assert_equal "search", http.last_body["action"]
  end

  def test_search_custom_top_k
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "matches" => [] }
    vec.search([0.1], top_k: 5)
    assert_equal 5, http.last_body["topK"]
  end

  def test_search_with_filter
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "matches" => [] }
    vec.search([0.1], filter: { "type" => "doc" })
    assert_equal({ "type" => "doc" }, http.last_body["filter"])
  end

  def test_search_returns_matches
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "matches" => [{ "id" => "v1", "score" => 0.95 }] }
    result = vec.search([0.1])
    assert_equal 1, result.length
    assert_equal 0.95, result[0]["score"]
  end

  def test_delete_sends_ids
    vec = make_vec
    http = get_http(vec)
    http.return_value = {}
    vec.delete(["v1", "v2"])
    assert_equal "delete", http.last_body["action"]
    assert_equal ["v1", "v2"], http.last_body["ids"]
  end

  def test_insert_sends_vectors
    vec = make_vec
    http = get_http(vec)
    http.return_value = {}
    vectors = [{ "id" => "v1", "values" => [0.1, 0.2] }]
    vec.insert(vectors)
    assert_equal "insert", http.last_body["action"]
    assert_equal vectors, http.last_body["vectors"]
  end

  def test_query_by_id_sends_vector_id
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "matches" => [] }
    vec.query_by_id("v1")
    assert_equal "queryById", http.last_body["action"]
    assert_equal "v1", http.last_body["vectorId"]
    assert_equal 10, http.last_body["topK"]
  end

  def test_get_by_ids_sends_ids
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "vectors" => [] }
    vec.get_by_ids(["v1", "v2"])
    assert_equal "getByIds", http.last_body["action"]
    assert_equal ["v1", "v2"], http.last_body["ids"]
  end

  def test_describe_sends_action
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "vectorCount" => 0, "dimensions" => 1536, "metric" => "cosine" }
    result = vec.describe
    assert_equal "describe", http.last_body["action"]
    assert_equal 1536, result["dimensions"]
  end

  def test_search_with_namespace
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "matches" => [] }
    vec.search([0.1], namespace: "test-ns")
    assert_equal "test-ns", http.last_body["namespace"]
  end

  def test_search_with_return_values
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "matches" => [] }
    vec.search([0.1], return_values: true)
    assert_equal true, http.last_body["returnValues"]
  end

  def test_search_with_return_metadata
    vec = make_vec
    http = get_http(vec)
    http.return_value = { "matches" => [] }
    vec.search([0.1], return_metadata: "all")
    assert_equal "all", http.last_body["returnMetadata"]
  end
end

# ─── G. PushClient unit ──────────────────────────────────────────────────────

class TestPushClientUnit < Minitest::Test
  def make_push
    http = MockHttp.new(service_key: "sk-test")
    EdgebaseAdmin::PushClient.new(http)
  end

  def get_http(push)
    admin_core = push.instance_variable_get(:@admin_core)
    admin_core.instance_variable_get(:@http)
  end

  def test_send_sends_correct_body
    push = make_push
    http = get_http(push)
    http.return_value = { "sent" => 1 }
    push.send("user-1", "title" => "Hi", "body" => "Hello")
    assert_equal "user-1", http.last_body["userId"]
    assert_equal "Hi", http.last_body["payload"]["title"]
  end

  def test_send_many_sends_user_ids
    push = make_push
    http = get_http(push)
    http.return_value = { "sent" => 2 }
    push.send_many(["u1", "u2"], "title" => "News")
    assert_equal ["u1", "u2"], http.last_body["userIds"]
  end

  def test_send_to_token_body
    push = make_push
    http = get_http(push)
    http.return_value = { "sent" => 1 }
    push.send_to_token("fcm-token-123", "title" => "Test")
    assert_equal "fcm-token-123", http.last_body["token"]
    assert_equal({ "title" => "Test" }, http.last_body["payload"])
  end

  def test_get_tokens_returns_list
    push = make_push
    http = get_http(push)
    http.return_value = { "items" => [{ "id" => "tok-1" }] }
    result = push.get_tokens("user-1")
    assert_equal 1, result.length
  end

  def test_get_tokens_non_dict_fallback
    push = make_push
    http = get_http(push)
    http.return_value = "bad response"
    result = push.get_tokens("user-1")
    assert_equal [], result
  end

  def test_get_logs_returns_list
    push = make_push
    http = get_http(push)
    http.return_value = { "items" => [{ "status" => "sent" }] }
    result = push.get_logs("user-1")
    assert_equal 1, result.length
  end

  def test_get_logs_with_limit
    push = make_push
    http = get_http(push)
    http.return_value = { "items" => [] }
    push.get_logs("user-1", limit: 5)
    # get_logs passes query params via generated admin_core GET endpoint
    assert_equal "5", http.last_params["limit"]
  end

  def test_get_logs_non_dict_fallback
    push = make_push
    http = get_http(push)
    http.return_value = "bad"
    result = push.get_logs("user-1")
    assert_equal [], result
  end

  def test_send_to_topic_sends_correct_body
    push = make_push
    http = get_http(push)
    http.return_value = { "success" => true }
    push.send_to_topic("news", "title" => "Breaking", "body" => "Hello")
    assert_equal "news", http.last_body["topic"]
    assert_equal "Breaking", http.last_body["payload"]["title"]
  end

  def test_broadcast_sends_correct_body
    push = make_push
    http = get_http(push)
    http.return_value = { "success" => true }
    push.broadcast("title" => "Announcement", "body" => "Hi all")
    assert_equal "Announcement", http.last_body["payload"]["title"]
  end
end
