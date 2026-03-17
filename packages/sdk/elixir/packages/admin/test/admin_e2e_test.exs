defmodule EdgeBaseAdminE2ETest do
  use ExUnit.Case

  alias EdgeBaseAdmin.AdminAuth
  alias EdgeBaseCore.{DbRef, TableRef}

  setup_all do
    base_url = System.get_env("BASE_URL") || "http://localhost:8688"
    service_key = System.get_env("SERVICE_KEY") || System.get_env("EDGEBASE_SERVICE_KEY") || "test-service-key-for-admin"

    if server_available?(base_url) do
      {:ok, client: EdgeBaseAdmin.new(base_url, service_key: service_key)}
    else
      message =
        "E2E backend not reachable at #{base_url}. Start `edgebase dev --port 8688` or set BASE_URL."

      if System.get_env("EDGEBASE_E2E_REQUIRED") == "1" do
        flunk(message)
      end

      {:ok, skip: message}
    end
  end

  @tag :auth
  test "list_users returns a users collection", context do
    if runnable?(context) do
      assert {:ok, %{"users" => users}} =
               context.client
               |> EdgeBaseAdmin.admin_auth()
               |> AdminAuth.list_users(limit: 5)

      assert is_list(users)
    end
  end

  @tag :auth
  test "admin auth create/get/update/claims/revoke lifecycle", context do
    if runnable?(context) do
      auth = EdgeBaseAdmin.admin_auth(context.client)
      email = "elixir-admin-#{System.unique_integer([:positive])}@test.com"

      assert {:ok, created} =
               AdminAuth.create_user(auth, %{
                 "email" => email,
                 "password" => "ElixirAdmin123!"
               })

      id = extract_user_id(created)

      try do
        assert {:ok, fetched} = AdminAuth.get_user(auth, id)
        assert extract_user_id(fetched) == id

        assert {:ok, updated} =
                 AdminAuth.update_user(auth, id, %{"displayName" => "Elixir Admin"})

        assert extract_user_id(updated) == id

        assert {:ok, _claims} =
                 AdminAuth.set_custom_claims(auth, id, %{"role" => "admin", "tier" => "pro"})

        assert {:ok, _revoked} = AdminAuth.revoke_all_sessions(auth, id)
      after
        _ = AdminAuth.delete_user(auth, id)
      end
    end
  end

  @tag :auth
  test "admin auth delete removes user", context do
    if runnable?(context) do
      auth = EdgeBaseAdmin.admin_auth(context.client)
      email = "elixir-admin-delete-#{System.unique_integer([:positive])}@test.com"

      assert {:ok, created} =
               AdminAuth.create_user(auth, %{
                 "email" => email,
                 "password" => "ElixirAdmin123!"
               })

      id = extract_user_id(created)
      assert {:ok, _deleted} = AdminAuth.delete_user(auth, id)
      assert {:error, _} = AdminAuth.get_user(auth, id)
    end
  end

  @tag :auth
  test "admin auth duplicate email returns an error", context do
    if runnable?(context) do
      auth = EdgeBaseAdmin.admin_auth(context.client)
      email = "elixir-admin-dup-#{System.unique_integer([:positive])}@test.com"

      assert {:ok, created} =
               AdminAuth.create_user(auth, %{
                 "email" => email,
                 "password" => "ElixirAdmin123!"
               })

      id = extract_user_id(created)

      try do
        assert {:error, _} =
                 AdminAuth.create_user(auth, %{
                   "email" => email,
                   "password" => "ElixirAdmin456!"
                 })
      after
        _ = AdminAuth.delete_user(auth, id)
      end
    end
  end

  test "insert and fetch post", context do
    if runnable?(context) do
      table =
        context.client
        |> EdgeBaseAdmin.db("shared")
        |> DbRef.table("posts")

      now = System.system_time(:millisecond)

      {:ok, created} =
        TableRef.insert(table, %{
          "slug" => "elixir-admin-#{now}",
          "runId" => "elixir-admin-#{now}",
          "title" => "elixir-admin-#{now}",
          "notes" => "elixir admin smoke #{now}",
          "status" => "draft",
          "views" => 1,
          "sequence" => 1,
          "isPublished" => false,
          "sdk" => "elixir"
        })
      id = created["id"]

      try do
        assert is_binary(id)
        assert {:ok, %{"id" => ^id}} = TableRef.get_one(table, id)
      after
        _ = table |> TableRef.doc(id) |> EdgeBaseCore.DocRef.delete()
      end
    end
  end

  test "sql returns a response", context do
    if runnable?(context) do
      assert {:ok, response} = EdgeBaseAdmin.sql(context.client, "SELECT 1 AS value")
      assert response != nil
    end
  end

  defp runnable?(%{skip: message}) do
    IO.puts("Skipping EdgeBaseAdminE2ETest: #{message}")
    false
  end

  defp runnable?(_context), do: true

  defp extract_user_id(%{"id" => id}) when is_binary(id), do: id
  defp extract_user_id(%{"user" => %{"id" => id}}) when is_binary(id), do: id

  defp server_available?(base_url) do
    url = String.to_charlist(String.trim_trailing(base_url, "/") <> "/api/health")

    case :httpc.request(:get, {url, []}, [], body_format: :binary) do
      {:ok, {{_, status_code, _}, _headers, _body}} -> status_code in 200..499
      _ -> false
    end
  end
end
