defmodule EdgeBaseCoreDbPathEncodingTest do
  use ExUnit.Case, async: true

  alias EdgeBaseCore.{DbRef, HttpClient, TableRef}

  test "encodes namespaced table names in list requests" do
    with_test_server(fn request ->
      assert String.starts_with?(request, "GET /api/db/shared/tables/cert-plugin%2Flifecycle_markers ")
    end, fn base_url ->
      client = HttpClient.new(base_url)

      assert {:ok, %{"items" => []}} =
               client
               |> DbRef.new("shared")
               |> DbRef.table("cert-plugin/lifecycle_markers")
               |> TableRef.get_list()
    end)
  end

  test "encodes namespaced table names and document ids in get_one requests" do
    with_test_server(fn request ->
      assert String.starts_with?(
               request,
               "GET /api/db/shared/tables/cert-plugin%2Fuser_notes/doc%2F1%20two "
             )
    end, fn base_url ->
      client = HttpClient.new(base_url)

      assert {:ok, %{"id" => "doc/1 two"}} =
               client
               |> DbRef.new("shared")
               |> DbRef.table("cert-plugin/user_notes")
               |> TableRef.get_one("doc/1 two")
    end)
  end

  defp with_test_server(assert_request, callback) do
    {:ok, listen_socket} =
      :gen_tcp.listen(0, [:binary, packet: :raw, active: false, reuseaddr: true])

    {:ok, port} = :inet.port(listen_socket)

    server_task =
      Task.async(fn ->
        {:ok, socket} = :gen_tcp.accept(listen_socket)
        {:ok, request} = :gen_tcp.recv(socket, 0)
        assert_request.(request)

        response_body = ~s({"items":[],"id":"doc/1 two"})

        response =
          "HTTP/1.1 200 OK\r\n" <>
            "Content-Type: application/json\r\n" <>
            "Content-Length: #{byte_size(response_body)}\r\n\r\n" <>
            response_body

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
