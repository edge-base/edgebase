# frozen_string_literal: true

require "minitest/autorun"
require "json"
require "securerandom"

require "edgebase_core"
require "edgebase_admin"

BASE_URL = ENV.fetch("BASE_URL", "http://localhost:8688")
SERVICE_KEY = ENV.fetch("SERVICE_KEY", ENV.fetch("EDGEBASE_SERVICE_KEY", "test-service-key-for-admin"))
IS_REMOTE_WORKERS_RUNTIME = BASE_URL.include?(".workers.dev")
KV_POLL_INTERVAL_SECONDS = 0.25
KV_TIMEOUT_SECONDS = IS_REMOTE_WORKERS_RUNTIME ? 15 : 5
PREFIX = "rb-admin-e2e-#{Time.now.to_i}-#{Process.pid}"

$created_post_ids = []
$created_user_ids = []
$created_file_keys = []
$created_kv_keys = []

def admin_client
  @admin_client ||= EdgebaseAdmin::AdminClient.new(BASE_URL, service_key: SERVICE_KEY)
end

def unique_suffix
  "#{Time.now.to_i}-#{SecureRandom.hex(4)}"
end

def wait_for_kv_value(kv, key, expected)
  deadline = Time.now + KV_TIMEOUT_SECONDS
  last_value = nil

  loop do
    last_value = kv.get(key)
    return last_value if last_value == expected
    break if Time.now >= deadline

    sleep(KV_POLL_INTERVAL_SECONDS)
  end

  raise "Timed out waiting for KV #{key.inspect}; expected #{expected.inspect}, got #{last_value.inspect}"
end

Minitest.after_run do
  admin = admin_client

  $created_post_ids.each do |record_id|
    begin
      admin.db("shared").table("posts").delete(record_id)
    rescue StandardError
      nil
    end
  end

  $created_user_ids.each do |user_id|
    begin
      admin.admin_auth.delete_user(user_id)
    rescue StandardError
      nil
    end
  end

  $created_file_keys.each do |key|
    begin
      admin.storage.bucket("test-bucket").delete(key)
    rescue StandardError
      nil
    end
  end

  $created_kv_keys.each do |key|
    begin
      admin.kv("cache").delete(key)
    rescue StandardError
      nil
    end
  end
end

class TestRubyAdminE2E < Minitest::Test
  def test_admin_auth_user_lifecycle
    email = "rb-admin-#{unique_suffix}@test.edgebase.fun"

    created = admin_client.admin_auth.create_user(
      "email" => email,
      "password" => "RubyAdminPass123!",
      "emailVerified" => true,
    )
    user_id = created["id"]

    refute_nil user_id
    $created_user_ids << user_id

    fetched = admin_client.admin_auth.get_user(user_id)
    assert_equal email, fetched["email"]

    updated = admin_client.admin_auth.update_user(user_id, { "displayName" => "Ruby Admin E2E" })
    assert_equal "Ruby Admin E2E", updated["displayName"]

    claimed = admin_client.admin_auth.set_custom_claims(user_id, { "role" => "editor", "level" => 7 })
    assert_equal "editor", claimed["customClaims"]["role"]

    assert admin_client.admin_auth.revoke_all_sessions(user_id)

    admin_client.admin_auth.delete_user(user_id)
    $created_user_ids.delete(user_id)

    err = assert_raises(EdgebaseCore::EdgeBaseError) do
      admin_client.admin_auth.get_user(user_id)
    end
    assert_equal 404, err.status_code
  end

  def test_database_crud_and_query_roundtrip
    created = admin_client.db("shared").table("posts").insert(
      "title" => "#{PREFIX}-post-#{unique_suffix}",
      "content" => "Inserted from Ruby admin E2E",
      "authorId" => "ruby-admin",
      "category" => "admin-e2e",
      "views" => 0,
      "published" => false,
    )
    record_id = created["id"]

    refute_nil record_id
    $created_post_ids << record_id

    fetched = admin_client.db("shared").table("posts").get_one(record_id)
    assert_equal record_id, fetched["id"]

    updated = admin_client.db("shared").table("posts").update(record_id, { "views" => 5, "published" => true })
    assert_equal 5, updated["views"]
    assert_equal true, updated["published"]

    list = admin_client.db("shared").table("posts")
      .where("id", "==", record_id)
      .limit(1)
      .get_list
    assert_equal 1, list.items.length

    sql_rows = admin_client.db("shared").table("posts")
      .sql("SELECT id, views FROM posts WHERE id = ?", [record_id])
    assert_kind_of Array, sql_rows
    assert_equal record_id, sql_rows.first["id"] unless sql_rows.empty?

    admin_client.db("shared").table("posts").delete(record_id)
    $created_post_ids.delete(record_id)

    err = assert_raises(EdgebaseCore::EdgeBaseError) do
      admin_client.db("shared").table("posts").get_one(record_id)
    end
    assert_equal 404, err.status_code
  end

  def test_storage_upload_download_and_delete
    bucket = admin_client.storage.bucket("test-bucket")
    key = "#{PREFIX}-file-#{unique_suffix}.txt"
    body = "Hello from Ruby admin E2E"

    bucket.upload(key, body, content_type: "text/plain")
    $created_file_keys << key

    url = bucket.get_url(key)
    assert_includes url, key

    downloaded = bucket.download(key)
    assert_equal body, downloaded

    files = bucket.list(prefix: PREFIX)
    assert files.any? { |file| file.key == key }

    bucket.delete(key)
    $created_file_keys.delete(key)

    err = assert_raises(EdgebaseCore::EdgeBaseError) do
      bucket.download(key)
    end
    assert_equal 404, err.status_code
  end

  def test_kv_set_get_list_and_delete
    kv = admin_client.kv("cache")
    key = "#{PREFIX}-kv-#{unique_suffix}"
    value = JSON.generate({ "hello" => "ruby", "n" => 1 })
    $created_kv_keys << key

    kv.set(key, value)
    assert_equal value, wait_for_kv_value(kv, key, value)

    list = kv.list(prefix: PREFIX)
    keys = list["keys"] || []
    assert keys.any? { |item| item == key || item["name"] == key || item["key"] == key }

    kv.delete(key)

    deleted_value = nil
    deadline = Time.now + KV_TIMEOUT_SECONDS
    loop do
      deleted_value = kv.get(key)
      break if deleted_value.nil?
      break if !IS_REMOTE_WORKERS_RUNTIME && Time.now >= deadline
      break if IS_REMOTE_WORKERS_RUNTIME && Time.now >= deadline

      sleep(KV_POLL_INTERVAL_SECONDS)
    end

    if IS_REMOTE_WORKERS_RUNTIME
      assert [nil, value].include?(deleted_value), "expected remote KV delete to return nil or stale value, got #{deleted_value.inspect}"
    else
      assert_nil deleted_value
    end

    $created_kv_keys.delete(key)
  end

  def test_invalid_service_key_fails_admin_operation
    bad_admin = EdgebaseAdmin::AdminClient.new(BASE_URL, service_key: "invalid-service-key")

    assert_raises(EdgebaseCore::EdgeBaseError) do
      bad_admin.admin_auth.list_users
    end
  end
end
