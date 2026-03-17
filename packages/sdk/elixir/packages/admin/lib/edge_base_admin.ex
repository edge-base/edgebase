defmodule EdgeBaseAdmin do
  alias EdgeBaseAdmin.{AdminAuth, Analytics, Client, D1, Functions, KV, Push, Vector}
  alias EdgeBaseCore.{DbRef, HttpClient, StorageClient}

  def new(base_url, opts \\ []) do
    Client.new(base_url, opts)
  end

  def db(%Client{http: http}, namespace \\ "shared", instance_id \\ nil) do
    DbRef.new(http, namespace, instance_id)
  end

  def table(%Client{} = client, name) do
    client
    |> db("shared", nil)
    |> DbRef.table(name)
  end

  def storage(%Client{http: http}) do
    StorageClient.new(http)
  end

  def admin_auth(%Client{http: http}), do: AdminAuth.new(http)
  def auth(%Client{} = client), do: admin_auth(client)
  def functions(%Client{http: http}), do: Functions.new(http)
  def analytics(%Client{http: http}), do: Analytics.new(http)
  def kv(%Client{http: http}, namespace), do: KV.new(http, namespace)
  def d1(%Client{http: http}, database), do: D1.new(http, database)
  def vector(%Client{http: http}, index), do: Vector.new(http, index)
  def vectorize(%Client{} = client, index), do: vector(client, index)
  def push(%Client{http: http}), do: Push.new(http)
  def set_context(%Client{} = client, context), do: %{client | context: context}
  def get_context(%Client{context: context}), do: context
  def destroy(%Client{}), do: :ok

  def sql(%Client{http: http}, query, opts \\ []) do
    body =
      %{
        "namespace" => Keyword.get(opts, :namespace, "shared"),
        "sql" => query,
        "params" => Keyword.get(opts, :params, [])
      }
      |> maybe_put("id", Keyword.get(opts, :instance_id))

    HttpClient.post(http, "/sql", body)
  end

  def sql!(%Client{} = client, query, opts \\ []), do: EdgeBaseCore.unwrap!(sql(client, query, opts))

  def broadcast(%Client{http: http}, channel, event, payload \\ %{}) do
    HttpClient.post(http, "/db/broadcast", %{"channel" => channel, "event" => event, "payload" => payload})
  end

  def broadcast!(%Client{} = client, channel, event, payload \\ %{}), do: EdgeBaseCore.unwrap!(broadcast(client, channel, event, payload))

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
