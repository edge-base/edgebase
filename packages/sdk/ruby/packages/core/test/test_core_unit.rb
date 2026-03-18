# frozen_string_literal: true

#
# @edgebase-fun/core Ruby SDK — unit tests
#
# Test targets:
#   - EdgebaseCore::TableRef (immutable query builder)
#   - EdgebaseCore::FilterTuple, ListResult, BatchResult, UpsertResult, OrBuilder, DbChange
#   - EdgebaseCore::FieldOps (increment / delete_field)
#   - EdgebaseCore::EdgeBaseError / EdgeBaseAuthError
#   - EdgebaseCore::HttpClient (URL building, headers)
#   - EdgebaseCore::ContextManager (set/get/clear/auth.id filtering)
#   - EdgebaseCore::StorageBucket (get_url)
#
# Run: cd packages/sdk/ruby/packages/core && ruby -Ilib -Itest test/test_core_unit.rb
#
# Principle: no server needed — pure Ruby logic only.
#

require "minitest/autorun"
require "edgebase_core"
require "edgebase_core/generated/api_core"
require "json"

# ── Minimal Mock Object ───────────────────────────────────────────────────────

class MockHttp
  attr_accessor :base_url, :last_method, :last_path, :last_body, :last_params
  attr_accessor :return_value

  def initialize
    @base_url = "http://localhost:8688"
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

class MockDatabaseLive
  attr_reader :last_channel

  def subscribe_callback(channel, _callback)
    @last_channel = channel
    -> {}
  end
end

# ── Helper ────────────────────────────────────────────────────────────────────

def make_table_ref
  http = MockHttp.new
  core = EdgebaseCore::GeneratedDbApi.new(http)
  EdgebaseCore::TableRef.new(core, "posts")
end

# ─── A. FilterTuple ──────────────────────────────────────────────────────────

class TestFilterTuple < Minitest::Test
  def test_to_json_array
    f = EdgebaseCore::FilterTuple.new("status", "==", "published")
    assert_equal ["status", "==", "published"], f.to_json_array
  end

  def test_to_json_any_value
    f = EdgebaseCore::FilterTuple.new("views", ">", 100)
    assert_equal ["views", ">", 100], f.to_json_array
  end

  def test_equality
    f1 = EdgebaseCore::FilterTuple.new("a", "==", 1)
    f2 = EdgebaseCore::FilterTuple.new("a", "==", 1)
    assert_equal f1, f2
  end

  def test_inequality
    f1 = EdgebaseCore::FilterTuple.new("a", "==", 1)
    f2 = EdgebaseCore::FilterTuple.new("b", "==", 1)
    refute_equal f1, f2
  end
end

# ─── B. OrBuilder ─────────────────────────────────────────────────────────────

class TestOrBuilder < Minitest::Test
  def test_empty_filters
    ob = EdgebaseCore::OrBuilder.new
    assert_equal [], ob.get_filters
  end

  def test_add_one_filter
    ob = EdgebaseCore::OrBuilder.new
    ob.where("status", "==", "draft")
    filters = ob.get_filters
    assert_equal 1, filters.length
    assert_equal "status", filters[0].field_name
  end

  def test_chain_returns_self
    ob = EdgebaseCore::OrBuilder.new
    result = ob.where("a", "==", 1)
    assert_same ob, result
  end

  def test_multiple_filters
    ob = EdgebaseCore::OrBuilder.new
    ob.where("a", "==", 1).where("b", "==", 2)
    assert_equal 2, ob.get_filters.length
  end

  def test_get_filters_copy
    ob = EdgebaseCore::OrBuilder.new
    ob.where("x", "==", "y")
    filters = ob.get_filters
    filters << EdgebaseCore::FilterTuple.new("z", "==", "w")
    assert_equal 1, ob.get_filters.length # original unchanged
  end
end

# ─── C. ListResult ────────────────────────────────────────────────────────────

class TestListResult < Minitest::Test
  def test_default_none_fields
    r = EdgebaseCore::ListResult.new(items: [])
    assert_nil r.total
    assert_nil r.page
    assert_nil r.per_page
    assert_nil r.has_more
    assert_nil r.cursor
  end

  def test_items_list
    r = EdgebaseCore::ListResult.new(items: [{ "id" => "1" }])
    assert_equal 1, r.items.length
    assert_equal "1", r.items[0]["id"]
  end

  def test_pagination_fields
    r = EdgebaseCore::ListResult.new(items: [], total: 100, page: 2, per_page: 20)
    assert_equal 100, r.total
    assert_equal 2, r.page
    assert_equal 20, r.per_page
  end

  def test_cursor_pagination
    r = EdgebaseCore::ListResult.new(items: [], has_more: true, cursor: "some-cursor")
    assert_equal true, r.has_more
    assert_equal "some-cursor", r.cursor
  end
end

# ─── D. TableRef immutability ─────────────────────────────────────────────────

class TestTableRefImmutable < Minitest::Test
  def test_where_returns_new
    t1 = make_table_ref
    t2 = t1.where("status", "==", "published")
    refute_same t1, t2
  end

  def test_where_does_not_mutate_original
    t1 = make_table_ref
    t2 = t1.where("status", "==", "published")
    assert_equal 0, t1._filters.length
    assert_equal 1, t2._filters.length
  end

  def test_order_by_returns_new
    t1 = make_table_ref
    t2 = t1.order_by("createdAt", "desc")
    refute_same t1, t2
    assert_equal 0, t1._sorts.length
    assert_equal 1, t2._sorts.length
  end

  def test_limit_returns_new
    t1 = make_table_ref
    t2 = t1.limit(10)
    refute_same t1, t2
    assert_nil t1._limit
    assert_equal 10, t2._limit
  end

  def test_offset_returns_new
    t1 = make_table_ref
    t2 = t1.offset(20)
    refute_same t1, t2
    assert_equal 20, t2._offset
  end

  def test_page_returns_new
    t1 = make_table_ref
    t2 = t1.page(3)
    refute_same t1, t2
    assert_equal 3, t2._page
  end

  def test_after_returns_new
    t1 = make_table_ref
    t2 = t1.after("cursor-abc")
    refute_same t1, t2
    assert_equal "cursor-abc", t2._after
    assert_nil t2._before
  end

  def test_before_returns_new
    t1 = make_table_ref
    t2 = t1.before("cursor-xyz")
    refute_same t1, t2
    assert_equal "cursor-xyz", t2._before
    assert_nil t2._after
  end

  def test_after_clears_before
    t1 = make_table_ref.before("b1")
    t2 = t1.after("a1")
    assert_nil t2._before
    assert_equal "a1", t2._after
  end

  def test_before_clears_after
    t1 = make_table_ref.after("a1")
    t2 = t1.before("b1")
    assert_nil t2._after
    assert_equal "b1", t2._before
  end

  def test_search_returns_new
    t1 = make_table_ref
    t2 = t1.search("hello world")
    refute_same t1, t2
    assert_equal "hello world", t2._search
  end

  def test_chain_multiple_builders
    t = make_table_ref
    result = t.where("status", "==", "published")
              .where("views", ">", 100)
              .order_by("createdAt", "desc")
              .limit(20)
    assert_equal 2, result._filters.length
    assert_equal 1, result._sorts.length
    assert_equal 20, result._limit
  end

  def test_or_returns_new
    t1 = make_table_ref
    t2 = t1.or_ { |q| q.where("status", "==", "draft") }
    refute_same t1, t2
  end

  def test_or_adds_or_filters
    t = make_table_ref
    result = t.or_ { |q| q.where("a", "==", 1).where("b", "==", 2) }
    assert_equal 2, result._or_filters.length
  end

  def test_namespace_default_shared
    t = make_table_ref
    assert_equal "shared", t._namespace
  end

  def test_namespace_custom
    http = MockHttp.new
    core = EdgebaseCore::GeneratedDbApi.new(http)
    t = EdgebaseCore::TableRef.new(core, "docs", namespace: "workspace", instance_id: "ws-123")
    assert_equal "workspace", t._namespace
    assert_equal "ws-123", t._instance_id
  end

  def test_update_many_requires_filter
    t = make_table_ref
    assert_raises(ArgumentError) { t.update_many("title" => "X") }
  end

  def test_delete_many_requires_filter
    t = make_table_ref
    assert_raises(ArgumentError) { t.delete_many }
  end
end

# ─── E. FieldOps ─────────────────────────────────────────────────────────────

class TestFieldOps < Minitest::Test
  def test_increment_op_key
    r = EdgebaseCore::FieldOps.increment(5)
    assert_equal "increment", r["$op"]
    assert_equal 5, r["value"]
  end

  def test_increment_negative
    r = EdgebaseCore::FieldOps.increment(-3)
    assert_equal(-3, r["value"])
  end

  def test_increment_default_1
    r = EdgebaseCore::FieldOps.increment
    assert_equal 1, r["value"]
  end

  def test_delete_field_op
    r = EdgebaseCore::FieldOps.delete_field
    assert_equal "deleteField", r["$op"]
    refute r.key?("value")
  end

  def test_increment_float
    r = EdgebaseCore::FieldOps.increment(1.5)
    assert_equal 1.5, r["value"]
  end
end

# ─── F. EdgeBaseError ─────────────────────────────────────────────────────────

class TestEdgeBaseError < Minitest::Test
  def test_status_code_and_message
    err = EdgebaseCore::EdgeBaseError.new(404, "Not found")
    assert_equal 404, err.status_code
    assert_equal "Not found", err.message
  end

  def test_is_exception
    assert_kind_of Exception, EdgebaseCore::EdgeBaseError.new(500, "err")
  end

  def test_str_representation
    err = EdgebaseCore::EdgeBaseError.new(403, "Forbidden")
    s = err.to_s
    assert_includes s, "403"
    assert_includes s, "Forbidden"
  end

  def test_details_none_by_default
    err = EdgebaseCore::EdgeBaseError.new(400, "Bad input")
    assert_nil err.details
  end

  def test_details_field
    err = EdgebaseCore::EdgeBaseError.new(422, "Validation", details: { "email" => ["required"] })
    assert_equal({ "email" => ["required"] }, err.details)
  end

  def test_from_json
    data = { "message" => "Email taken", "details" => { "email" => ["already in use"] } }
    err = EdgebaseCore::EdgeBaseError.from_json(data, 409)
    assert_equal 409, err.status_code
    assert_equal "Email taken", err.message
    assert_equal ["already in use"], err.details["email"]
  end

  def test_from_json_missing_message
    err = EdgebaseCore::EdgeBaseError.from_json({}, 500)
    assert_equal "Unknown error", err.message
  end
end

# ─── G. EdgeBaseAuthError ─────────────────────────────────────────────────────

class TestEdgeBaseAuthError < Minitest::Test
  def test_is_edge_base_error
    err = EdgebaseCore::EdgeBaseAuthError.new(401, "Unauthorized")
    assert_kind_of EdgebaseCore::EdgeBaseError, err
  end

  def test_str_contains_auth
    err = EdgebaseCore::EdgeBaseAuthError.new(401, "invalid_credentials")
    s = err.to_s
    assert_includes s, "EdgeBaseAuthError"
    assert_includes s, "401"
  end
end

# ─── H. BatchResult / UpsertResult / DbChange ─────────────────────────────────

class TestBatchResult < Minitest::Test
  def test_fields_populated
    r = EdgebaseCore::BatchResult.new(total_processed: 10, total_succeeded: 8, errors: [{ "msg" => "fail" }])
    assert_equal 10, r.total_processed
    assert_equal 8, r.total_succeeded
    assert_equal 1, r.errors.length
  end

  def test_empty_errors
    r = EdgebaseCore::BatchResult.new(total_processed: 0, total_succeeded: 0, errors: [])
    assert_equal [], r.errors
  end
end

class TestUpsertResult < Minitest::Test
  def test_inserted_true
    r = EdgebaseCore::UpsertResult.new(record: { "id" => "r-1", "title" => "X" }, inserted: true)
    assert r.inserted
    assert_equal "r-1", r.record["id"]
  end

  def test_inserted_false
    r = EdgebaseCore::UpsertResult.new(record: { "id" => "r-2" }, inserted: false)
    refute r.inserted
  end
end

class TestDbChange < Minitest::Test
  def test_from_json_full
    data = {
      "event" => "INSERT",
      "table" => "posts",
      "id" => "r-1",
      "record" => { "title" => "Hello" },
      "oldRecord" => { "title" => "Old" }
    }
    c = EdgebaseCore::DbChange.from_json(data)
    assert_equal "INSERT", c.event
    assert_equal "posts", c.table
    assert_equal "r-1", c.id
    assert_equal "Hello", c.record["title"]
    assert_equal "Old", c.old_record["title"]
  end

  def test_from_json_minimal
    data = { "event" => "DELETE", "table" => "posts" }
    c = EdgebaseCore::DbChange.from_json(data)
    assert_equal "DELETE", c.event
    assert_nil c.id
    assert_nil c.record
    assert_nil c.old_record
  end
end

# ─── I. ContextManager ───────────────────────────────────────────────────────

class TestContextManager < Minitest::Test
  def test_set_and_get_context
    cm = EdgebaseCore::ContextManager.new
    cm.set_context("tenant" => "acme")
    assert_equal({ "tenant" => "acme" }, cm.get_context)
  end

  def test_auth_id_filtered
    cm = EdgebaseCore::ContextManager.new
    cm.set_context("tenant" => "acme", "auth.id" => "user-1")
    ctx = cm.get_context
    refute ctx.key?("auth.id")
    assert_equal "acme", ctx["tenant"]
  end

  def test_clear_context
    cm = EdgebaseCore::ContextManager.new
    cm.set_context("tenant" => "acme")
    cm.clear_context
    assert_equal({}, cm.get_context)
  end

  def test_get_context_returns_copy
    cm = EdgebaseCore::ContextManager.new
    cm.set_context("tenant" => "acme")
    ctx = cm.get_context
    ctx["mutated"] = true
    refute cm.get_context.key?("mutated")
  end
end

# ─── J. HttpClient unit (URL building, headers) ──────────────────────────────

class TestHttpClientUnit < Minitest::Test
  def test_build_url_with_api_prefix
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", service_key: "sk")
    # Use send to access private method
    assert_equal "http://localhost:8688/api/tables/posts", h.send(:build_url, "/tables/posts")
  end

  def test_build_url_already_has_api
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", service_key: "sk")
    assert_equal "http://localhost:8688/api/tables/posts", h.send(:build_url, "/api/tables/posts")
  end

  def test_auth_headers_service_key
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", service_key: "sk-test-123")
    headers = h.send(:auth_headers)
    assert_equal "sk-test-123", headers["X-EdgeBase-Service-Key"]
    assert_equal "Bearer sk-test-123", headers["Authorization"]
    assert_equal "close", headers["Connection"]
  end

  def test_auth_headers_bearer_token
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", bearer_token: "tok-abc")
    headers = h.send(:auth_headers)
    assert_equal "Bearer tok-abc", headers["Authorization"]
    refute headers.key?("X-EdgeBase-Service-Key")
  end

  def test_auth_headers_do_not_serialize_legacy_context
    cm = EdgebaseCore::ContextManager.new
    cm.set_context("tenant" => "acme")
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", context_manager: cm, service_key: "sk")
    headers = h.send(:auth_headers)
    refute headers.key?("X-EdgeBase-Context")
  end

  def test_trailing_slash_stripped
    h = EdgebaseCore::HttpClient.new("http://localhost:8688/", service_key: "sk")
    assert_equal "http://localhost:8688", h.base_url
  end

  def test_parse_response_returns_nil_for_empty_success
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", service_key: "sk")
    response = Struct.new(:code, :body).new("204", "")
    assert_nil h.send(:parse_response, response)
  end

  def test_parse_response_raises_on_non_json_success
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", service_key: "sk")
    response = Struct.new(:code, :body).new("200", "plain text")
    error = assert_raises(EdgebaseCore::EdgeBaseError) { h.send(:parse_response, response) }
    assert_equal 200, error.status_code
    assert_includes error.message, "JSON response"
  end

  def test_timeout_uses_env_override
    previous = ENV["EDGEBASE_HTTP_TIMEOUT_MS"]
    ENV["EDGEBASE_HTTP_TIMEOUT_MS"] = "15000"
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", service_key: "sk")
    assert_equal 15.0, h.send(:request_timeout_seconds, 30)
  ensure
    ENV["EDGEBASE_HTTP_TIMEOUT_MS"] = previous
  end

  def test_timeout_falls_back_to_default_on_invalid_env
    previous = ENV["EDGEBASE_HTTP_TIMEOUT_MS"]
    ENV["EDGEBASE_HTTP_TIMEOUT_MS"] = "invalid"
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", service_key: "sk")
    assert_equal 30, h.send(:request_timeout_seconds, 30)
  ensure
    ENV["EDGEBASE_HTTP_TIMEOUT_MS"] = previous
  end

  def test_build_http_disables_keep_alive_timeout
    h = EdgebaseCore::HttpClient.new("http://localhost:8688", service_key: "sk")
    http = h.send(:build_http, URI("http://localhost:8688/api/tables/posts"))
    assert_equal 0, http.keep_alive_timeout if http.respond_to?(:keep_alive_timeout)
  end
end

# ─── K. StorageClient / StorageBucket unit ───────────────────────────────────

class TestStorageBucketUnit < Minitest::Test
  def test_get_url_format
    http = MockHttp.new
    http.base_url = "http://localhost:8688"
    bucket = EdgebaseCore::StorageBucket.new(http, "avatars")
    url = bucket.get_url("photo.png")
    assert_equal "http://localhost:8688/api/storage/avatars/photo.png", url
  end

  def test_get_url_encodes_special_chars
    http = MockHttp.new
    http.base_url = "http://localhost:8688"
    bucket = EdgebaseCore::StorageBucket.new(http, "docs")
    url = bucket.get_url("my file.txt")
    assert_includes url, "my+file.txt"
  end

  def test_storage_client_bucket_returns_bucket
    http = MockHttp.new
    sc = EdgebaseCore::StorageClient.new(http)
    bucket = sc.bucket("avatars")
    assert_kind_of EdgebaseCore::StorageBucket, bucket
    assert_equal "avatars", bucket.name
  end

  def test_storage_bucket_list_alias
    http = MockHttp.new
    http.return_value = { "files" => [{ "key" => "a.txt", "size" => 1 }] }
    bucket = EdgebaseCore::StorageBucket.new(http, "avatars")
    items = bucket.list(prefix: "a")
    assert_equal "/storage/avatars", http.last_path
    assert_equal "a", http.last_params["prefix"]
    assert_equal 1, items.length
    assert_equal "a.txt", items[0].key
  end
end

class TestSignedUrlResult < Minitest::Test
  def test_fields
    r = EdgebaseCore::SignedUrlResult.new(url: "https://signed.url/abc", expires_in: 3600)
    assert_equal "https://signed.url/abc", r.url
    assert_equal 3600, r.expires_in
  end
end

class TestFileInfo < Minitest::Test
  def test_from_json
    data = { "key" => "photo.png", "size" => 1024, "contentType" => "image/png", "etag" => "abc" }
    fi = EdgebaseCore::FileInfo.from_json(data)
    assert_equal "photo.png", fi.key
    assert_equal 1024, fi.size
    assert_equal "image/png", fi.content_type
    assert_equal "abc", fi.etag
  end

  def test_from_json_minimal
    data = { "key" => "file.txt", "size" => 0 }
    fi = EdgebaseCore::FileInfo.from_json(data)
    assert_equal "file.txt", fi.key
    assert_nil fi.content_type
    assert_nil fi.etag
  end
end

# ─── L. TableRef query param building ────────────────────────────────────────

class TestTableRefQueryParams < Minitest::Test
  def test_build_query_params_empty
    t = make_table_ref
    assert_equal({}, t.build_query_params)
  end

  def test_build_query_params_limit
    t = make_table_ref.limit(10)
    params = t.build_query_params
    assert_equal "10", params["limit"]
  end

  def test_build_query_params_offset
    t = make_table_ref.offset(20)
    params = t.build_query_params
    assert_equal "20", params["offset"]
  end

  def test_build_query_params_page
    t = make_table_ref.page(3)
    params = t.build_query_params
    assert_equal "3", params["page"]
  end

  def test_build_query_params_after_cursor
    t = make_table_ref.after("cursor-123")
    params = t.build_query_params
    assert_equal "cursor-123", params["after"]
  end

  def test_build_query_params_before_cursor
    t = make_table_ref.before("cursor-456")
    params = t.build_query_params
    assert_equal "cursor-456", params["before"]
  end

  def test_cursor_and_offset_raises
    t = make_table_ref.after("cursor").offset(10)
    assert_raises(ArgumentError) { t.build_query_params }
  end

  def test_cursor_and_page_raises
    t = make_table_ref.before("cursor").page(2)
    assert_raises(ArgumentError) { t.build_query_params }
  end

  def test_sort_params
    t = make_table_ref.order_by("createdAt", "desc").order_by("title", "asc")
    params = t.build_query_params
    assert_equal "createdAt:desc,title:asc", params["sort"]
  end

  def test_filter_params_json
    t = make_table_ref.where("status", "==", "active")
    params = t.build_query_params
    parsed = JSON.parse(params["filter"])
    assert_equal [["status", "==", "active"]], parsed
  end

  def test_or_filter_params_json
    t = make_table_ref.or_ { |q| q.where("a", "==", 1) }
    params = t.build_query_params
    parsed = JSON.parse(params["orFilter"])
    assert_equal [["a", "==", 1]], parsed
  end
end

# ─── M. DocRef unit ──────────────────────────────────────────────────────────

class TestDocRefUnit < Minitest::Test
  def test_on_snapshot_no_database_live_raises
    http = MockHttp.new
    core = EdgebaseCore::GeneratedDbApi.new(http)
    doc = EdgebaseCore::DocRef.new(core, "posts", "doc-1")
    assert_raises(RuntimeError) { doc.on_snapshot { |_c| nil } }
  end

  def test_id_stored
    http = MockHttp.new
    core = EdgebaseCore::GeneratedDbApi.new(http)
    doc = EdgebaseCore::DocRef.new(core, "posts", "my-doc-id")
    assert_equal "my-doc-id", doc.id
    assert_equal "posts", doc.table_name
  end

  def test_on_snapshot_uses_full_database_live_doc_channel
    http = MockHttp.new
    core = EdgebaseCore::GeneratedDbApi.new(http)
    database_live = MockDatabaseLive.new
    doc = EdgebaseCore::DocRef.new(core, "posts", "doc-1", database_live, namespace: "workspace", instance_id: "ws-9")

    doc.on_snapshot { |_c| nil }

    assert_equal "dblive:workspace:ws-9:posts:doc-1", database_live.last_channel
  end
end

# ─── N. TableRef.on_snapshot ─────────────────────────────────────────────────

class TestTableRefOnSnapshot < Minitest::Test
  def test_on_snapshot_no_database_live_raises
    t = make_table_ref
    assert_raises(RuntimeError) { t.on_snapshot { |_c| nil } }
  end

  def test_on_snapshot_uses_full_database_live_table_channel
    http = MockHttp.new
    core = EdgebaseCore::GeneratedDbApi.new(http)
    database_live = MockDatabaseLive.new
    t = EdgebaseCore::TableRef.new(core, "posts", database_live: database_live, namespace: "workspace", instance_id: "ws-9")

    t.on_snapshot { |_c| nil }

    assert_equal "dblive:workspace:ws-9:posts", database_live.last_channel
  end
end
