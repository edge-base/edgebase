defmodule EdgeBaseCore.StorageClient do
  alias EdgeBaseCore.StorageBucket

  defstruct [:client]

  def new(client), do: %__MODULE__{client: client}

  def bucket(%__MODULE__{} = storage, name) do
    StorageBucket.new(storage.client, name)
  end
end

defmodule EdgeBaseCore.StorageBucket do
  alias EdgeBaseCore.HttpClient

  defstruct [:client, :name]

  def new(client, name), do: %__MODULE__{client: client, name: name}
  def name(%__MODULE__{} = bucket), do: bucket.name

  def upload(%__MODULE__{} = bucket, key, data, opts \\ []) do
    HttpClient.post_multipart(
      bucket.client,
      "/storage/#{bucket.name}/upload",
      "file",
      key,
      data,
      Keyword.get(opts, :content_type, "application/octet-stream"),
      %{"key" => key}
    )
  end

  def upload!(%__MODULE__{} = bucket, key, data, opts \\ []), do: EdgeBaseCore.unwrap!(upload(bucket, key, data, opts))

  def upload_string(%__MODULE__{} = bucket, key, data, opts \\ []) do
    encoding = Keyword.get(opts, :encoding, "raw")
    content_type = Keyword.get(opts, :content_type, "text/plain")

    bytes =
      case encoding do
        "base64" -> Base.decode64!(data)
        "base64url" -> Base.url_decode64!(data, padding: false)
        "data_url" -> data |> String.split(",", parts: 2) |> List.last() |> Base.decode64!()
        _ -> data
      end

    upload(bucket, key, bytes, content_type: content_type)
  end

  def download(%__MODULE__{} = bucket, key) do
    HttpClient.get_raw(bucket.client, "/storage/#{bucket.name}/#{URI.encode(key)}")
  end

  def download!(%__MODULE__{} = bucket, key), do: EdgeBaseCore.unwrap!(download(bucket, key))

  def delete(%__MODULE__{} = bucket, key) do
    HttpClient.delete(bucket.client, "/storage/#{bucket.name}/#{URI.encode(key)}")
  end

  def delete!(%__MODULE__{} = bucket, key), do: EdgeBaseCore.unwrap!(delete(bucket, key))

  def list(%__MODULE__{} = bucket, opts \\ []) do
    params =
      %{}
      |> maybe_put("prefix", Keyword.get(opts, :prefix))
      |> maybe_put("limit", Keyword.get(opts, :limit))
      |> maybe_put("cursor", Keyword.get(opts, :cursor))

    HttpClient.get(bucket.client, "/storage/#{bucket.name}", params)
  end

  def list!(%__MODULE__{} = bucket, opts \\ []), do: EdgeBaseCore.unwrap!(list(bucket, opts))

  def url(%__MODULE__{} = bucket, key) do
    bucket.client.base_url <> "/api/storage/#{bucket.name}/" <> URI.encode(key)
  end

  def get_url(%__MODULE__{} = bucket, key), do: url(bucket, key)

  def metadata(%__MODULE__{} = bucket, key) do
    HttpClient.get(bucket.client, "/storage/#{bucket.name}/#{URI.encode(key)}/metadata")
  end

  def metadata!(%__MODULE__{} = bucket, key), do: EdgeBaseCore.unwrap!(metadata(bucket, key))

  def update_metadata(%__MODULE__{} = bucket, key, metadata) do
    HttpClient.patch(bucket.client, "/storage/#{bucket.name}/#{URI.encode(key)}/metadata", metadata)
  end

  def update_metadata!(%__MODULE__{} = bucket, key, metadata), do: EdgeBaseCore.unwrap!(update_metadata(bucket, key, metadata))

  def create_signed_url(%__MODULE__{} = bucket, key, expires_in \\ "1h") do
    HttpClient.post(bucket.client, "/storage/#{bucket.name}/signed-url", %{"key" => key, "expiresIn" => expires_in})
  end

  def create_signed_url!(%__MODULE__{} = bucket, key, expires_in \\ "1h"), do: EdgeBaseCore.unwrap!(create_signed_url(bucket, key, expires_in))

  def create_signed_upload_url(%__MODULE__{} = bucket, key, expires_in \\ 3600) do
    HttpClient.post(bucket.client, "/storage/#{bucket.name}/signed-upload-url", %{"key" => key, "expiresIn" => "#{expires_in}s"})
  end

  def create_signed_upload_url!(%__MODULE__{} = bucket, key, expires_in \\ 3600), do: EdgeBaseCore.unwrap!(create_signed_upload_url(bucket, key, expires_in))

  def initiate_resumable_upload(%__MODULE__{} = bucket, key, opts \\ []) do
    body =
      %{"key" => key, "contentType" => Keyword.get(opts, :content_type, "application/octet-stream")}
      |> maybe_put("totalSize", Keyword.get(opts, :total_size))

    HttpClient.post(bucket.client, "/storage/#{bucket.name}/multipart/create", body)
  end

  def initiate_resumable_upload!(%__MODULE__{} = bucket, key, opts \\ []), do: EdgeBaseCore.unwrap!(initiate_resumable_upload(bucket, key, opts))

  def resume_upload(%__MODULE__{} = bucket, key, upload_id, chunk, opts \\ []) do
    part_number = Keyword.get(opts, :part_number, 1)
    params = URI.encode_query(%{"uploadId" => upload_id, "partNumber" => part_number, "key" => key})
    HttpClient.post_raw(bucket.client, "/storage/#{bucket.name}/multipart/upload-part?#{params}", chunk)
  end

  def resume_upload!(%__MODULE__{} = bucket, key, upload_id, chunk, opts \\ []), do: EdgeBaseCore.unwrap!(resume_upload(bucket, key, upload_id, chunk, opts))

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
