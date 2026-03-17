defmodule EdgeBaseAdminUnitTest do
  use ExUnit.Case, async: true

  alias EdgeBaseAdmin.{AdminAuth, Analytics, Client, D1, Functions, KV, Push, Vector}
  alias EdgeBaseCore.{DbRef, DocRef, FieldOps, StorageBucket, StorageClient, TableRef}

  test "builds the admin surface" do
    client = EdgeBaseAdmin.new("https://dummy.edgebase.fun/", service_key: "sk-test")

    assert %Client{} = client
    assert client.http.base_url == "https://dummy.edgebase.fun"
    assert client.http.service_key == "sk-test"
    assert %DbRef{} = EdgeBaseAdmin.db(client)
    assert %TableRef{name: "posts"} = EdgeBaseAdmin.table(client, "posts")
    assert %StorageClient{} = EdgeBaseAdmin.storage(client)
    assert %AdminAuth{} = EdgeBaseAdmin.admin_auth(client)
    assert %Functions{} = EdgeBaseAdmin.functions(client)
    assert %Analytics{} = EdgeBaseAdmin.analytics(client)
    assert %KV{} = EdgeBaseAdmin.kv(client, "cache")
    assert %D1{} = EdgeBaseAdmin.d1(client, "analytics")
    assert %Vector{} = EdgeBaseAdmin.vector(client, "embeddings")
    assert %Push{} = EdgeBaseAdmin.push(client)
  end

  test "table builder stays immutable" do
    client = EdgeBaseAdmin.new("https://dummy.edgebase.fun", service_key: "sk-test")
    original = EdgeBaseAdmin.table(client, "posts")
    filtered = TableRef.where(original, "status", "==", "published")
    sorted = TableRef.order_by(filtered, "createdAt", "desc")

    assert original != filtered
    assert filtered != sorted
    assert original.filters == []
    assert filtered.filters == [["status", "==", "published"]]
    assert sorted.sorts == [{"createdAt", "desc"}]
  end

  test "exports full admin helper surface" do
    Code.ensure_loaded!(EdgeBaseAdmin)

    assert function_exported?(EdgeBaseAdmin, :admin_auth, 1)
    assert function_exported?(EdgeBaseAdmin, :auth, 1)
    assert function_exported?(EdgeBaseAdmin, :db, 1)
    assert function_exported?(EdgeBaseAdmin, :db, 3)
    assert function_exported?(EdgeBaseAdmin, :table, 2)
    assert function_exported?(EdgeBaseAdmin, :storage, 1)
    assert function_exported?(EdgeBaseAdmin, :functions, 1)
    assert function_exported?(EdgeBaseAdmin, :analytics, 1)
    assert function_exported?(EdgeBaseAdmin, :kv, 2)
    assert function_exported?(EdgeBaseAdmin, :d1, 2)
    assert function_exported?(EdgeBaseAdmin, :vector, 2)
    assert function_exported?(EdgeBaseAdmin, :vectorize, 2)
    assert function_exported?(EdgeBaseAdmin, :push, 1)
    assert function_exported?(EdgeBaseAdmin, :sql, 2)
    assert function_exported?(EdgeBaseAdmin, :sql, 3)
    assert function_exported?(EdgeBaseAdmin, :broadcast, 3)
    assert function_exported?(EdgeBaseAdmin, :broadcast, 4)
    assert function_exported?(EdgeBaseAdmin, :set_context, 2)
    assert function_exported?(EdgeBaseAdmin, :get_context, 1)
    assert function_exported?(EdgeBaseAdmin, :destroy, 1)
  end

  test "exports full module helpers" do
    Code.ensure_loaded!(AdminAuth)
    Code.ensure_loaded!(Functions)
    Code.ensure_loaded!(Analytics)
    Code.ensure_loaded!(KV)
    Code.ensure_loaded!(D1)
    Code.ensure_loaded!(Vector)
    Code.ensure_loaded!(Push)

    assert function_exported?(AdminAuth, :get_user, 2)
    assert function_exported?(AdminAuth, :list_users, 2)
    assert function_exported?(AdminAuth, :create_user, 2)
    assert function_exported?(AdminAuth, :update_user, 3)
    assert function_exported?(AdminAuth, :delete_user, 2)
    assert function_exported?(AdminAuth, :set_custom_claims, 3)
    assert function_exported?(AdminAuth, :revoke_all_sessions, 2)

    assert function_exported?(Functions, :call, 3)
    assert function_exported?(Functions, :get, 3)
    assert function_exported?(Functions, :post, 3)
    assert function_exported?(Functions, :put, 3)
    assert function_exported?(Functions, :patch, 3)
    assert function_exported?(Functions, :delete, 2)

    assert function_exported?(Analytics, :overview, 2)
    assert function_exported?(Analytics, :time_series, 2)
    assert function_exported?(Analytics, :breakdown, 2)
    assert function_exported?(Analytics, :top_endpoints, 2)
    assert function_exported?(Analytics, :track, 4)
    assert function_exported?(Analytics, :track_batch, 2)
    assert function_exported?(Analytics, :query_events, 2)

    assert function_exported?(KV, :get, 2)
    assert function_exported?(KV, :set, 4)
    assert function_exported?(KV, :delete, 2)
    assert function_exported?(KV, :list, 2)

    assert function_exported?(D1, :exec, 3)
    assert function_exported?(Vector, :upsert, 2)
    assert function_exported?(Vector, :insert, 2)
    assert function_exported?(Vector, :search, 3)
    assert function_exported?(Vector, :query_by_id, 3)
    assert function_exported?(Vector, :get_by_ids, 2)
    assert function_exported?(Vector, :delete, 2)
    assert function_exported?(Vector, :describe, 1)

    assert function_exported?(Push, :send, 3)
    assert function_exported?(Push, :send_many, 3)
    assert function_exported?(Push, :send_to_token, 4)
    assert function_exported?(Push, :get_tokens, 2)
    assert function_exported?(Push, :get_logs, 3)
    assert function_exported?(Push, :send_to_topic, 3)
    assert function_exported?(Push, :broadcast, 2)
  end

  test "core helpers expose structural utilities" do
    bucket = StorageBucket.new(EdgeBaseAdmin.new("https://dummy.edgebase.fun", service_key: "sk-test").http, "avatars")
    Code.ensure_loaded!(DbRef)
    Code.ensure_loaded!(DocRef)
    Code.ensure_loaded!(TableRef)
    Code.ensure_loaded!(StorageBucket)

    assert function_exported?(DbRef, :namespace, 1)
    assert function_exported?(DbRef, :instance_id, 1)
    assert function_exported?(DocRef, :collection_name, 1)
    assert function_exported?(DocRef, :id, 1)
    assert function_exported?(DocRef, :get, 1)
    assert function_exported?(DocRef, :update, 2)
    assert function_exported?(DocRef, :delete, 1)
    assert function_exported?(DocRef, :on_snapshot, 2)
    assert function_exported?(TableRef, :name, 1)
    assert function_exported?(TableRef, :get_list, 1)
    assert function_exported?(TableRef, :get_first, 1)
    assert function_exported?(TableRef, :count, 1)
    assert function_exported?(TableRef, :insert_many, 3)
    assert function_exported?(TableRef, :upsert_many, 3)
    assert function_exported?(TableRef, :update_many, 2)
    assert function_exported?(TableRef, :delete_many, 1)
    assert function_exported?(TableRef, :on_snapshot, 2)
    assert function_exported?(StorageBucket, :name, 1)
    assert function_exported?(StorageBucket, :upload, 4)
    assert function_exported?(StorageBucket, :upload_string, 4)
    assert function_exported?(StorageBucket, :download, 2)
    assert function_exported?(StorageBucket, :delete, 2)
    assert function_exported?(StorageBucket, :list, 2)
    assert function_exported?(StorageBucket, :get_url, 2)
    assert function_exported?(StorageBucket, :metadata, 2)
    assert function_exported?(StorageBucket, :update_metadata, 3)
    assert function_exported?(StorageBucket, :create_signed_url, 3)
    assert function_exported?(StorageBucket, :create_signed_upload_url, 3)
    assert function_exported?(StorageBucket, :initiate_resumable_upload, 3)
    assert function_exported?(StorageBucket, :resume_upload, 5)
    assert StorageBucket.name(bucket) == "avatars"
    assert FieldOps.increment(3) == %{"$op" => "increment", "value" => 3}
    assert FieldOps.delete_field() == %{"$op" => "deleteField"}
  end
end
