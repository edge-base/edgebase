defmodule EdgeBaseAdmin.AdminAuth do
  alias EdgeBaseCore.HttpClient

  defstruct [:client]

  def new(client), do: %__MODULE__{client: client}

  def get_user(%__MODULE__{} = auth, user_id) do
    with {:ok, payload} <- HttpClient.get(auth.client, "/auth/admin/users/#{user_id}") do
      {:ok, unwrap_user_payload(payload)}
    end
  end

  def get_user!(%__MODULE__{} = auth, user_id), do: EdgeBaseCore.unwrap!(get_user(auth, user_id))

  def list_users(%__MODULE__{} = auth, opts \\ []) do
    params =
      %{}
      |> maybe_put("limit", Keyword.get(opts, :limit))
      |> maybe_put("cursor", Keyword.get(opts, :cursor))

    HttpClient.get(auth.client, "/auth/admin/users", params)
  end

  def list_users!(%__MODULE__{} = auth, opts \\ []), do: EdgeBaseCore.unwrap!(list_users(auth, opts))

  def create_user(%__MODULE__{} = auth, data) do
    with {:ok, payload} <- HttpClient.post(auth.client, "/auth/admin/users", data) do
      {:ok, unwrap_user_payload(payload)}
    end
  end

  def create_user!(%__MODULE__{} = auth, data), do: EdgeBaseCore.unwrap!(create_user(auth, data))

  def update_user(%__MODULE__{} = auth, user_id, data) do
    with {:ok, payload} <- HttpClient.patch(auth.client, "/auth/admin/users/#{user_id}", data) do
      {:ok, unwrap_user_payload(payload)}
    end
  end

  def update_user!(%__MODULE__{} = auth, user_id, data), do: EdgeBaseCore.unwrap!(update_user(auth, user_id, data))

  def delete_user(%__MODULE__{} = auth, user_id), do: HttpClient.delete(auth.client, "/auth/admin/users/#{user_id}")
  def delete_user!(%__MODULE__{} = auth, user_id), do: EdgeBaseCore.unwrap!(delete_user(auth, user_id))

  def set_custom_claims(%__MODULE__{} = auth, user_id, claims), do: HttpClient.put(auth.client, "/auth/admin/users/#{user_id}/claims", claims)
  def set_custom_claims!(%__MODULE__{} = auth, user_id, claims), do: EdgeBaseCore.unwrap!(set_custom_claims(auth, user_id, claims))

  def revoke_all_sessions(%__MODULE__{} = auth, user_id), do: HttpClient.post(auth.client, "/auth/admin/users/#{user_id}/revoke", %{})
  def revoke_all_sessions!(%__MODULE__{} = auth, user_id), do: EdgeBaseCore.unwrap!(revoke_all_sessions(auth, user_id))

  def import_users(%__MODULE__{} = auth, users) do
    HttpClient.post(auth.client, "/auth/admin/users/import", %{"users" => users})
  end

  def import_users!(%__MODULE__{} = auth, users), do: EdgeBaseCore.unwrap!(import_users(auth, users))

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, to_string(value))
  defp unwrap_user_payload(%{"user" => %{} = user}), do: user
  defp unwrap_user_payload(payload), do: payload
end

defmodule EdgeBaseAdmin.Functions do
  alias EdgeBaseCore.HttpClient

  defstruct [:client]

  def new(client), do: %__MODULE__{client: client}

  def call(%__MODULE__{} = functions, path, opts \\ []) do
    method = opts[:method] || :post
    query = opts[:query] || %{}
    body = opts[:body] || %{}

    case method do
      :get -> HttpClient.get(functions.client, "/functions/#{path}", query)
      :delete -> HttpClient.delete(functions.client, "/functions/#{path}")
      :put -> HttpClient.put(functions.client, "/functions/#{path}", body)
      :patch -> HttpClient.patch(functions.client, "/functions/#{path}", body)
      _ -> HttpClient.post(functions.client, "/functions/#{path}", body, params: query)
    end
  end

  def call!(%__MODULE__{} = functions, path, opts \\ []), do: EdgeBaseCore.unwrap!(call(functions, path, opts))
  def get(%__MODULE__{} = functions, path, query \\ %{}), do: call(functions, path, method: :get, query: query)
  def get!(%__MODULE__{} = functions, path, query \\ %{}), do: EdgeBaseCore.unwrap!(get(functions, path, query))
  def post(%__MODULE__{} = functions, path, body \\ %{}), do: call(functions, path, method: :post, body: body)
  def post!(%__MODULE__{} = functions, path, body \\ %{}), do: EdgeBaseCore.unwrap!(post(functions, path, body))
  def put(%__MODULE__{} = functions, path, body), do: call(functions, path, method: :put, body: body)
  def put!(%__MODULE__{} = functions, path, body), do: EdgeBaseCore.unwrap!(put(functions, path, body))
  def patch(%__MODULE__{} = functions, path, body), do: call(functions, path, method: :patch, body: body)
  def patch!(%__MODULE__{} = functions, path, body), do: EdgeBaseCore.unwrap!(patch(functions, path, body))
  def delete(%__MODULE__{} = functions, path), do: call(functions, path, method: :delete)
  def delete!(%__MODULE__{} = functions, path), do: EdgeBaseCore.unwrap!(delete(functions, path))
end

defmodule EdgeBaseAdmin.Analytics do
  alias EdgeBaseCore.HttpClient

  defstruct [:client]

  def new(client), do: %__MODULE__{client: client}

  def overview(%__MODULE__{} = analytics, opts \\ []), do: HttpClient.get(analytics.client, "/analytics/query", query_with_metric("overview", opts))
  def overview!(%__MODULE__{} = analytics, opts \\ []), do: EdgeBaseCore.unwrap!(overview(analytics, opts))
  def time_series(%__MODULE__{} = analytics, opts \\ []), do: HttpClient.get(analytics.client, "/analytics/query", query_with_metric("timeSeries", opts))
  def time_series!(%__MODULE__{} = analytics, opts \\ []), do: EdgeBaseCore.unwrap!(time_series(analytics, opts))
  def breakdown(%__MODULE__{} = analytics, opts \\ []), do: HttpClient.get(analytics.client, "/analytics/query", query_with_metric("breakdown", opts))
  def breakdown!(%__MODULE__{} = analytics, opts \\ []), do: EdgeBaseCore.unwrap!(breakdown(analytics, opts))
  def top_endpoints(%__MODULE__{} = analytics, opts \\ []), do: HttpClient.get(analytics.client, "/analytics/query", query_with_metric("topEndpoints", opts))
  def top_endpoints!(%__MODULE__{} = analytics, opts \\ []), do: EdgeBaseCore.unwrap!(top_endpoints(analytics, opts))

  def track(%__MODULE__{} = analytics, name, properties \\ %{}, user_id \\ nil) do
    track_batch(analytics, [%{"name" => name, "properties" => properties, "userId" => user_id, "timestamp" => System.system_time(:millisecond)}])
  end

  def track!(%__MODULE__{} = analytics, name, properties \\ %{}, user_id \\ nil), do: EdgeBaseCore.unwrap!(track(analytics, name, properties, user_id))

  def track_batch(%__MODULE__{} = analytics, events) do
    normalized =
      Enum.map(events, fn
        %{} = event -> Map.put_new(event, "timestamp", System.system_time(:millisecond))
        other -> other
      end)

    HttpClient.post(analytics.client, "/analytics/track", %{"events" => normalized})
  end

  def track_batch!(%__MODULE__{} = analytics, events), do: EdgeBaseCore.unwrap!(track_batch(analytics, events))

  def query_events(%__MODULE__{} = analytics, opts \\ []), do: HttpClient.get(analytics.client, "/analytics/events", Map.new(opts))
  def query_events!(%__MODULE__{} = analytics, opts \\ []), do: EdgeBaseCore.unwrap!(query_events(analytics, opts))

  defp query_with_metric(metric, opts) do
    Map.new(opts)
    |> Map.put("metric", metric)
  end
end

defmodule EdgeBaseAdmin.KV do
  alias EdgeBaseCore.HttpClient

  defstruct [:client, :namespace]

  def new(client, namespace), do: %__MODULE__{client: client, namespace: namespace}

  def get(%__MODULE__{} = kv, key) do
    with {:ok, payload} <- HttpClient.post(kv.client, "/kv/#{kv.namespace}", %{"action" => "get", "key" => key}) do
      {:ok, unwrap_value(payload)}
    end
  end

  def get!(%__MODULE__{} = kv, key), do: EdgeBaseCore.unwrap!(get(kv, key))

  def set(%__MODULE__{} = kv, key, value, opts \\ []) do
    body =
      %{"action" => "set", "key" => key, "value" => value}
      |> maybe_put("ttl", Keyword.get(opts, :ttl))

    HttpClient.post(kv.client, "/kv/#{kv.namespace}", body)
  end

  def set!(%__MODULE__{} = kv, key, value, opts \\ []), do: EdgeBaseCore.unwrap!(set(kv, key, value, opts))
  def delete(%__MODULE__{} = kv, key), do: HttpClient.post(kv.client, "/kv/#{kv.namespace}", %{"action" => "delete", "key" => key})
  def delete!(%__MODULE__{} = kv, key), do: EdgeBaseCore.unwrap!(delete(kv, key))

  def list(%__MODULE__{} = kv, opts \\ []) do
    body =
      %{
        "action" => "list",
        "prefix" => Keyword.get(opts, :prefix, ""),
        "limit" => Keyword.get(opts, :limit, 100)
      }
      |> maybe_put("cursor", Keyword.get(opts, :cursor))

    HttpClient.post(kv.client, "/kv/#{kv.namespace}", body)
  end

  def list!(%__MODULE__{} = kv, opts \\ []), do: EdgeBaseCore.unwrap!(list(kv, opts))

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
  defp unwrap_value(%{"value" => value}), do: value
  defp unwrap_value(value), do: value
end

defmodule EdgeBaseAdmin.D1 do
  alias EdgeBaseCore.HttpClient

  defstruct [:client, :database]

  def new(client, database), do: %__MODULE__{client: client, database: database}

  def exec(%__MODULE__{} = d1, query, params \\ []) do
    HttpClient.post(d1.client, "/d1/#{d1.database}", %{"query" => query, "params" => params})
  end

  def exec!(%__MODULE__{} = d1, query, params \\ []), do: EdgeBaseCore.unwrap!(exec(d1, query, params))
end

defmodule EdgeBaseAdmin.Vector do
  alias EdgeBaseCore.HttpClient

  defstruct [:client, :index]

  def new(client, index), do: %__MODULE__{client: client, index: index}

  def upsert(%__MODULE__{} = vector, vectors), do: HttpClient.post(vector.client, "/vectorize/#{vector.index}", %{"action" => "upsert", "vectors" => vectors})
  def upsert!(%__MODULE__{} = vector, vectors), do: EdgeBaseCore.unwrap!(upsert(vector, vectors))
  def insert(%__MODULE__{} = vector, vectors), do: HttpClient.post(vector.client, "/vectorize/#{vector.index}", %{"action" => "insert", "vectors" => vectors})
  def insert!(%__MODULE__{} = vector, vectors), do: EdgeBaseCore.unwrap!(insert(vector, vectors))

  def search(%__MODULE__{} = vector, values, opts \\ []) do
    HttpClient.post(vector.client, "/vectorize/#{vector.index}", %{
      "action" => "search",
      "vector" => values,
      "topK" => Keyword.get(opts, :top_k, 10),
      "filter" => Keyword.get(opts, :filter, %{})
    })
  end

  def search!(%__MODULE__{} = vector, values, opts \\ []), do: EdgeBaseCore.unwrap!(search(vector, values, opts))

  def query_by_id(%__MODULE__{} = vector, id, opts \\ []) do
    HttpClient.post(vector.client, "/vectorize/#{vector.index}", %{
      "action" => "queryById",
      "vectorId" => id,
      "topK" => Keyword.get(opts, :top_k, 10),
      "filter" => Keyword.get(opts, :filter, %{})
    })
  end

  def query_by_id!(%__MODULE__{} = vector, id, opts \\ []), do: EdgeBaseCore.unwrap!(query_by_id(vector, id, opts))
  def get_by_ids(%__MODULE__{} = vector, ids), do: HttpClient.post(vector.client, "/vectorize/#{vector.index}", %{"action" => "getByIds", "ids" => ids})
  def get_by_ids!(%__MODULE__{} = vector, ids), do: EdgeBaseCore.unwrap!(get_by_ids(vector, ids))
  def delete(%__MODULE__{} = vector, ids), do: HttpClient.post(vector.client, "/vectorize/#{vector.index}", %{"action" => "delete", "ids" => ids})
  def delete!(%__MODULE__{} = vector, ids), do: EdgeBaseCore.unwrap!(delete(vector, ids))
  def describe(%__MODULE__{} = vector), do: HttpClient.post(vector.client, "/vectorize/#{vector.index}", %{"action" => "describe"})
  def describe!(%__MODULE__{} = vector), do: EdgeBaseCore.unwrap!(describe(vector))
end

defmodule EdgeBaseAdmin.Push do
  alias EdgeBaseCore.HttpClient

  defstruct [:client]

  def new(client), do: %__MODULE__{client: client}

  def send(%__MODULE__{} = push, user_id, payload), do: HttpClient.post(push.client, "/push/send", %{"userId" => user_id, "payload" => payload})
  def send!(%__MODULE__{} = push, user_id, payload), do: EdgeBaseCore.unwrap!(send(push, user_id, payload))
  def send_many(%__MODULE__{} = push, user_ids, payload), do: HttpClient.post(push.client, "/push/send-many", %{"userIds" => user_ids, "payload" => payload})
  def send_many!(%__MODULE__{} = push, user_ids, payload), do: EdgeBaseCore.unwrap!(send_many(push, user_ids, payload))
  def send_to_token(%__MODULE__{} = push, token, payload, platform \\ "web"), do: HttpClient.post(push.client, "/push/send-to-token", %{"token" => token, "payload" => payload, "platform" => platform})
  def send_to_token!(%__MODULE__{} = push, token, payload, platform \\ "web"), do: EdgeBaseCore.unwrap!(send_to_token(push, token, payload, platform))
  def get_tokens(%__MODULE__{} = push, user_id), do: HttpClient.get(push.client, "/push/tokens", %{"userId" => user_id})
  def get_tokens!(%__MODULE__{} = push, user_id), do: EdgeBaseCore.unwrap!(get_tokens(push, user_id))

  def get_logs(%__MODULE__{} = push, user_id, opts \\ []) do
    params =
      %{"userId" => user_id}
      |> maybe_put("limit", Keyword.get(opts, :limit))

    HttpClient.get(push.client, "/push/logs", params)
  end

  def get_logs!(%__MODULE__{} = push, user_id, opts \\ []), do: EdgeBaseCore.unwrap!(get_logs(push, user_id, opts))
  def send_to_topic(%__MODULE__{} = push, topic, payload), do: HttpClient.post(push.client, "/push/send-to-topic", %{"topic" => topic, "payload" => payload})
  def send_to_topic!(%__MODULE__{} = push, topic, payload), do: EdgeBaseCore.unwrap!(send_to_topic(push, topic, payload))
  def broadcast(%__MODULE__{} = push, payload), do: HttpClient.post(push.client, "/push/broadcast", %{"payload" => payload})
  def broadcast!(%__MODULE__{} = push, payload), do: EdgeBaseCore.unwrap!(broadcast(push, payload))

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, to_string(value))
end
