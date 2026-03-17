defmodule EdgeBaseCore.DbRef do
  alias EdgeBaseCore.TableRef

  defstruct [:client, :namespace, :instance_id]

  def new(client, namespace, instance_id \\ nil) do
    %__MODULE__{client: client, namespace: namespace, instance_id: instance_id}
  end

  def table(%__MODULE__{} = db, name) do
    TableRef.new(db.client, name, db.namespace, db.instance_id)
  end

  def namespace(%__MODULE__{} = db), do: db.namespace
  def instance_id(%__MODULE__{} = db), do: db.instance_id
end

defmodule EdgeBaseCore.DocRef do
  alias EdgeBaseCore.HttpClient

  defstruct [:client, :namespace, :instance_id, :table, :id]

  def new(client, namespace, instance_id, table, id) do
    %__MODULE__{client: client, namespace: namespace, instance_id: instance_id, table: table, id: id}
  end

  def get(%__MODULE__{} = doc) do
    HttpClient.get(doc.client, doc_path(doc))
  end

  def get!(%__MODULE__{} = doc), do: EdgeBaseCore.unwrap!(get(doc))

  def update(%__MODULE__{} = doc, data) do
    HttpClient.patch(doc.client, doc_path(doc), data)
  end

  def update!(%__MODULE__{} = doc, data), do: EdgeBaseCore.unwrap!(update(doc, data))

  def delete(%__MODULE__{} = doc) do
    HttpClient.delete(doc.client, doc_path(doc))
  end

  def delete!(%__MODULE__{} = doc), do: EdgeBaseCore.unwrap!(delete(doc))
  def collection_name(%__MODULE__{} = doc), do: doc.table
  def id(%__MODULE__{} = doc), do: doc.id

  def on_snapshot(%__MODULE__{}, _listener) do
    raise "on_snapshot/2 is not available on the server SDK"
  end

  defp doc_path(%__MODULE__{namespace: "shared", instance_id: nil, table: table, id: id}) do
    "/db/shared/tables/#{encode_path_segment(table)}/#{encode_path_segment(id)}"
  end

  defp doc_path(%__MODULE__{namespace: namespace, instance_id: instance_id, table: table, id: id}) do
    "/db/#{namespace}/#{instance_id}/tables/#{encode_path_segment(table)}/#{encode_path_segment(id)}"
  end

  defp encode_path_segment(value), do: URI.encode(to_string(value), &URI.char_unreserved?/1)
end

defmodule EdgeBaseCore.TableRef do
  alias EdgeBaseCore.{DbRef, DocRef, HttpClient}

  defstruct [
    :client,
    :name,
    :namespace,
    :instance_id,
    filters: [],
    or_filters: [],
    sorts: [],
    limit: nil,
    offset: nil,
    page: nil,
    search: nil,
    after: nil,
    before: nil
  ]

  def new(client, name, namespace \\ "shared", instance_id \\ nil) do
    %__MODULE__{client: client, name: name, namespace: namespace, instance_id: instance_id}
  end

  def name(%__MODULE__{} = table), do: table.name
  def where(%__MODULE__{} = table, field, op, value) do
    %{table | filters: table.filters ++ [[field, op, value]]}
  end

  def or_where(%__MODULE__{} = table, filters) when is_list(filters) do
    %{table | or_filters: table.or_filters ++ Enum.map(filters, fn {field, op, value} -> [field, op, value] end)}
  end

  def order_by(%__MODULE__{} = table, field, direction \\ "asc") do
    %{table | sorts: table.sorts ++ [{field, direction}]}
  end

  def limit(%__MODULE__{} = table, value), do: %{table | limit: value}
  def offset(%__MODULE__{} = table, value), do: %{table | offset: value}
  def page(%__MODULE__{} = table, value), do: %{table | page: value}
  def search(%__MODULE__{} = table, value), do: %{table | search: value}
  def after_cursor(%__MODULE__{} = table, value), do: %{table | after: value, before: nil}
  def before_cursor(%__MODULE__{} = table, value), do: %{table | before: value, after: nil}

  def get_list(%__MODULE__{} = table) do
    params =
      table
      |> build_query_params()
      |> maybe_put("search", table.search)

    path =
      if is_binary(table.search) and table.search != "" do
        base_path(table) <> "/search"
      else
        base_path(table)
      end

    HttpClient.get(table.client, path, params)
  end

  def get_list!(%__MODULE__{} = table), do: EdgeBaseCore.unwrap!(get_list(table))

  def get_one(%__MODULE__{} = table, id) do
    HttpClient.get(table.client, base_path(table) <> "/#{encode_path_segment(id)}")
  end

  def get_one!(%__MODULE__{} = table, id), do: EdgeBaseCore.unwrap!(get_one(table, id))

  def get_first(%__MODULE__{} = table) do
    case get_list(limit(table, 1)) do
      {:ok, %{"items" => [item | _rest]}} -> {:ok, item}
      {:ok, %{"items" => []}} -> {:ok, nil}
      {:ok, _other} -> {:ok, nil}
      error -> error
    end
  end

  def get_first!(%__MODULE__{} = table), do: EdgeBaseCore.unwrap!(get_first(table))

  def insert(%__MODULE__{} = table, record, opts \\ []) do
    HttpClient.post(table.client, base_path(table), record, params: write_query_params(opts))
  end

  def insert!(%__MODULE__{} = table, record, opts \\ []), do: EdgeBaseCore.unwrap!(insert(table, record, opts))

  def upsert(%__MODULE__{} = table, record, opts \\ []) do
    params =
      opts
      |> Keyword.put(:upsert, true)
      |> write_query_params()

    HttpClient.post(table.client, base_path(table), record, params: params)
  end

  def upsert!(%__MODULE__{} = table, record, opts \\ []), do: EdgeBaseCore.unwrap!(upsert(table, record, opts))

  def count(%__MODULE__{} = table) do
    HttpClient.get(table.client, base_path(table) <> "/count", build_query_params(table))
  end

  def count!(%__MODULE__{} = table), do: EdgeBaseCore.unwrap!(count(table))

  def insert_many(%__MODULE__{} = table, records, opts \\ []) do
    HttpClient.post(table.client, base_path(table) <> "/batch", %{"inserts" => records}, params: write_query_params(opts))
  end

  def insert_many!(%__MODULE__{} = table, records, opts \\ []), do: EdgeBaseCore.unwrap!(insert_many(table, records, opts))

  def upsert_many(%__MODULE__{} = table, records, opts \\ []) do
    params =
      opts
      |> Keyword.put(:upsert, true)
      |> write_query_params()

    HttpClient.post(table.client, base_path(table) <> "/batch", %{"inserts" => records}, params: params)
  end

  def upsert_many!(%__MODULE__{} = table, records, opts \\ []), do: EdgeBaseCore.unwrap!(upsert_many(table, records, opts))

  def update_many(%__MODULE__{} = table, update) do
    batch_by_filter(table, "update", update)
  end

  def update_many!(%__MODULE__{} = table, update), do: EdgeBaseCore.unwrap!(update_many(table, update))

  def delete_many(%__MODULE__{} = table) do
    batch_by_filter(table, "delete", nil)
  end

  def delete_many!(%__MODULE__{} = table), do: EdgeBaseCore.unwrap!(delete_many(table))

  def doc(%__MODULE__{} = table, id) do
    DocRef.new(table.client, table.namespace, table.instance_id, table.name, id)
  end

  def db(%__MODULE__{} = table) do
    DbRef.new(table.client, table.namespace, table.instance_id)
  end

  def on_snapshot(%__MODULE__{}, _listener) do
    raise "on_snapshot/2 is not available on the server SDK"
  end

  defp batch_by_filter(%__MODULE__{} = table, action, update) do
    if table.filters == [] do
      {:error, %EdgeBaseCore.Error{message: "#{action}_many requires at least one where filter", status_code: 400}}
    else
      body =
        %{
          "action" => action,
          "filter" => table.filters,
          "limit" => 500
        }
        |> maybe_put("orFilter", if(table.or_filters == [], do: nil, else: table.or_filters))
        |> maybe_put("update", update)

      HttpClient.post(table.client, base_path(table) <> "/batch-by-filter", body)
    end
  end

  defp base_path(%__MODULE__{namespace: "shared", instance_id: nil, name: name}) do
    "/db/shared/tables/#{encode_path_segment(name)}"
  end

  defp base_path(%__MODULE__{namespace: namespace, instance_id: instance_id, name: name}) do
    "/db/#{namespace}/#{instance_id}/tables/#{encode_path_segment(name)}"
  end

  defp build_query_params(%__MODULE__{} = table) do
    %{}
    |> maybe_put_json("filter", table.filters)
    |> maybe_put_json("orFilter", table.or_filters)
    |> maybe_put("sort", encode_sort(table.sorts))
    |> maybe_put("limit", table.limit)
    |> maybe_put("offset", table.offset)
    |> maybe_put("page", table.page)
    |> maybe_put("after", table.after)
    |> maybe_put("before", table.before)
  end

  defp write_query_params(opts) do
    %{}
    |> maybe_put("upsert", if(Keyword.get(opts, :upsert), do: "true", else: nil))
    |> maybe_put("conflictTarget", Keyword.get(opts, :conflict_target))
  end

  defp encode_sort([]), do: nil
  defp encode_sort(sorts), do: Enum.map_join(sorts, ",", fn {field, direction} -> "#{field}:#{direction}" end)

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value) when is_map(value) or is_list(value), do: Map.put(map, key, value)
  defp maybe_put(map, key, value), do: Map.put(map, key, to_string(value))

  defp maybe_put_json(map, _key, []), do: map
  defp maybe_put_json(map, key, value), do: Map.put(map, key, Jason.encode!(value))

  defp encode_path_segment(value), do: URI.encode(to_string(value), &URI.char_unreserved?/1)
end
