defmodule EdgeBaseCoreHttpClientTransportRetryTest do
  use ExUnit.Case, async: true

  alias EdgeBaseCore.{Error, HttpClient}

  test "retries transient transport failures before succeeding" do
    client = HttpClient.new("https://example.com")
    Process.put(:edgebase_retry_calls, 0)

    request_fun = fn :get, {_url, _headers}, [], [body_format: :binary] ->
      calls = Process.get(:edgebase_retry_calls, 0)
      Process.put(:edgebase_retry_calls, calls + 1)

      case calls do
        0 ->
          {:error,
           {:failed_connect,
            [{:to_address, {~c"example.com", 443}}, {:inet, [:inet], :nxdomain}]}}

        _ ->
          {:ok, {{~c"HTTP/1.1", 200, ~c"OK"}, [], ~s({"ok":true})}}
      end
    end

    assert {:ok, %{"ok" => true}} =
             HttpClient.request(client, :get, "/functions/retry", request_fun: request_fun)

    assert Process.get(:edgebase_retry_calls) == 2
  end

  test "surfaces transport error after exhausting retries" do
    client = HttpClient.new("https://example.com")
    Process.put(:edgebase_retry_calls, 0)

    request_fun = fn :get, {_url, _headers}, [], [body_format: :binary] ->
      calls = Process.get(:edgebase_retry_calls, 0)
      Process.put(:edgebase_retry_calls, calls + 1)

      {:error,
       {:failed_connect,
        [{:to_address, {~c"example.com", 443}}, {:inet, [:inet], :nxdomain}]}}
    end

    assert {:error, %Error{status_code: 0, message: message}} =
             HttpClient.request(client, :get, "/functions/retry", request_fun: request_fun)

    assert String.contains?(message, "nxdomain")
    assert Process.get(:edgebase_retry_calls) == 3
  end
end
