defmodule EdgeBaseCoreHttpClientJsonContractTest do
  use ExUnit.Case, async: true

  alias EdgeBaseCore.{Error, HttpClient}

  test "returns nil for empty success bodies" do
    with_test_server("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n", fn base_url ->
      client = HttpClient.new(base_url)
      assert {:ok, nil} = HttpClient.get(client, "/functions/no-content")
    end)
  end

  test "rejects plain-text success bodies" do
    with_test_server(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok",
      fn base_url ->
        client = HttpClient.new(base_url)

        assert {:error, %Error{status_code: 200, message: message}} =
                 HttpClient.get(client, "/functions/plain-text")

        assert String.contains?(String.downcase(message), "json")
      end
    )
  end

  test "rejects malformed json success bodies" do
    with_test_server(
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 12\r\n\r\n{\"broken\":[]",
      fn base_url ->
        client = HttpClient.new(base_url)

        assert {:error, %Error{status_code: 200, message: message}} =
                 HttpClient.get(client, "/functions/malformed")

        assert String.contains?(String.downcase(message), "json")
      end
    )
  end

  defp with_test_server(response, callback) do
    {:ok, listen_socket} =
      :gen_tcp.listen(0, [:binary, packet: :raw, active: false, reuseaddr: true])

    {:ok, port} = :inet.port(listen_socket)

    server_task =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listen_socket)
        {:ok, _request} = :gen_tcp.recv(socket, 0)
        :ok = :gen_tcp.send(socket, response)
        :gen_tcp.close(socket)
        :gen_tcp.close(listen_socket)
      end)

    try do
      callback.("http://127.0.0.1:#{port}")
    after
      Task.await(server_task, 1_000)
    end
  end
end
