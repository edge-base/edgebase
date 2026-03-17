defmodule EdgeBaseCore.HttpClient do
  alias EdgeBaseCore.Error

  @max_transport_retries 2

  defstruct base_url: nil, service_key: nil, bearer_token: nil

  @type t :: %__MODULE__{
          base_url: String.t(),
          service_key: String.t() | nil,
          bearer_token: String.t() | nil
        }

  def new(base_url, opts \\ []) do
    %__MODULE__{
      base_url: String.trim_trailing(base_url, "/"),
      service_key: Keyword.get(opts, :service_key),
      bearer_token: Keyword.get(opts, :bearer_token)
    }
  end

  def get(client, path, params \\ %{}) do
    request(client, :get, path, params: params)
  end

  def post(client, path, body \\ %{}, opts \\ []) do
    request(client, :post, path, Keyword.merge(opts, json: body))
  end

  def patch(client, path, body \\ %{}, opts \\ []) do
    request(client, :patch, path, Keyword.merge(opts, json: body))
  end

  def put(client, path, body \\ %{}, opts \\ []) do
    request(client, :put, path, Keyword.merge(opts, json: body))
  end

  def delete(client, path) do
    request(client, :delete, path)
  end

  def head(client, path, opts \\ []) do
    ensure_started()

    request_fun = Keyword.get(opts, :request_fun, &:httpc.request/4)

    case request_with_retry(:head, {to_charlist(build_url(client, path)), headers(client, [])}, request_fun) do
      {:ok, {{_, status_code, _}, _headers, _body}} -> {:ok, status_code < 400}
      {:error, reason} -> {:error, %Error{message: inspect(reason), status_code: 0}}
    end
  end

  def get_raw(client, path) do
    request(client, :get, path, raw: true)
  end

  def post_raw(client, path, body, content_type \\ "application/octet-stream") do
    request(client, :post, path, body: body, content_type: content_type, raw_body: true)
  end

  def post_multipart(client, path, file_field, file_name, data, content_type, fields \\ %{}) do
    boundary = "edgebase-#{System.unique_integer([:positive])}"
    body = multipart_body(boundary, file_field, file_name, data, content_type, fields)

    request(
      client,
      :post,
      path,
      body: body,
      content_type: "multipart/form-data; boundary=#{boundary}",
      raw_body: true
    )
  end

  def request(client, method, path, opts \\ []) do
    ensure_started()

    url = build_url(client, path, Keyword.get(opts, :params, %{}))
    content_type = Keyword.get(opts, :content_type, "application/json")
    headers = headers(client, Keyword.get(opts, :headers, []))
    body = build_body(opts)
    request_fun = Keyword.get(opts, :request_fun, &:httpc.request/4)

    http_request =
      case {method, body} do
        {:get, _} -> {to_charlist(url), headers}
        {:head, _} -> {to_charlist(url), headers}
        {:delete, nil} -> {to_charlist(url), headers}
        _ -> {to_charlist(url), headers, to_charlist(content_type), body || ""}
      end

    case request_with_retry(method, http_request, request_fun) do
      {:ok, {{_, status_code, _}, _response_headers, response_body}} ->
        parse_response(status_code, response_body, Keyword.get(opts, :raw, false))

      {:error, reason} ->
        {:error, %Error{message: inspect(reason), status_code: 0}}
    end
  end

  defp ensure_started do
    Application.ensure_all_started(:inets)
    Application.ensure_all_started(:ssl)
  end

  defp build_url(client, path, params \\ %{}) do
    base =
      cond do
        String.starts_with?(path, "/api/") -> client.base_url <> path
        String.starts_with?(path, "/admin/api/") -> client.base_url <> path
        true -> client.base_url <> "/api" <> path
      end

    if params == %{} do
      base
    else
      base <> "?" <> URI.encode_query(params)
    end
  end

  defp headers(client, extra_headers) do
    auth_headers =
      []
      |> maybe_put_header("authorization", auth_token(client))
      |> maybe_put_header("x-edgebase-service-key", client.service_key)

    Enum.map(auth_headers ++ normalize_headers(extra_headers), fn {key, value} ->
      {to_charlist(key), to_charlist(value)}
    end)
  end

  defp auth_token(%__MODULE__{bearer_token: token}) when is_binary(token) and token != "", do: "Bearer " <> token
  defp auth_token(%__MODULE__{service_key: token}) when is_binary(token) and token != "", do: "Bearer " <> token
  defp auth_token(_client), do: nil

  defp maybe_put_header(headers, _key, nil), do: headers
  defp maybe_put_header(headers, _key, ""), do: headers
  defp maybe_put_header(headers, key, value), do: [{key, value} | headers]

  defp normalize_headers(headers) when is_list(headers), do: headers
  defp normalize_headers(_headers), do: []

  defp build_body(opts) do
    cond do
      Keyword.get(opts, :raw_body, false) -> Keyword.get(opts, :body)
      Keyword.has_key?(opts, :json) -> Jason.encode!(Keyword.get(opts, :json))
      Keyword.has_key?(opts, :body) -> Keyword.get(opts, :body)
      true -> nil
    end
  end

  defp parse_response(status_code, response_body, raw?) when status_code in 200..399 do
    if raw? do
      {:ok, response_body}
    else
      decode_success_body(status_code, response_body)
    end
  end

  defp parse_response(status_code, response_body, _raw?) do
    body = decode_error_body(response_body)
    {:error, Error.from_response(status_code, body)}
  end

  defp decode_success_body(_status_code, ""), do: {:ok, nil}

  defp decode_success_body(status_code, body) when is_binary(body) do
    case Jason.decode(body) do
      {:ok, decoded} -> {:ok, decoded}
      {:error, _reason} -> {:error, %Error{message: "Invalid JSON response body", status_code: status_code}}
    end
  end

  defp decode_error_body(""), do: %{}

  defp decode_error_body(body) when is_binary(body) do
    case Jason.decode(body) do
      {:ok, decoded} -> decoded
      {:error, _reason} -> body
    end
  end

  defp request_with_retry(method, http_request, request_fun, attempt \\ 0) do
    case request_fun.(method, http_request, [], body_options()) do
      {:error, reason} = error when attempt < @max_transport_retries ->
        if retryable_transport_error?(reason) do
          Process.sleep(50 * (attempt + 1))
          request_with_retry(method, http_request, request_fun, attempt + 1)
        else
          error
        end

      result ->
        result
    end
  end

  defp retryable_transport_error?({:failed_connect, reason}), do: retryable_transport_error?(reason)
  defp retryable_transport_error?({:inet, _opts, reason}), do: retryable_transport_error?(reason)
  defp retryable_transport_error?({key, reason}) when key in [:reason, :error], do: retryable_transport_error?(reason)
  defp retryable_transport_error?([{_key, reason} | rest]), do: retryable_transport_error?(reason) or retryable_transport_error?(rest)
  defp retryable_transport_error?([reason | rest]), do: retryable_transport_error?(reason) or retryable_transport_error?(rest)
  defp retryable_transport_error?([]), do: false

  defp retryable_transport_error?(reason)
       when reason in [:closed, :econnrefused, :econnreset, :enetunreach, :ehostunreach, :nxdomain, :timeout] do
    true
  end

  defp retryable_transport_error?(_reason), do: false

  defp body_options do
    [body_format: :binary]
  end

  defp multipart_body(boundary, file_field, file_name, data, content_type, fields) do
    parts =
      Enum.map(fields, fn {key, value} ->
        [
          "--", boundary, "\r\n",
          "Content-Disposition: form-data; name=\"", to_string(key), "\"\r\n\r\n",
          to_string(value), "\r\n"
        ]
      end)

    IO.iodata_to_binary([
      parts,
      "--", boundary, "\r\n",
      "Content-Disposition: form-data; name=\"", file_field, "\"; filename=\"", file_name, "\"\r\n",
      "Content-Type: ", content_type, "\r\n\r\n",
      data, "\r\n",
      "--", boundary, "--\r\n"
    ])
  end
end
