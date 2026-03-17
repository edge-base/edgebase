defmodule EdgeBaseCore do
  @moduledoc false

  alias EdgeBaseCore.HttpClient

  def new_http_client(base_url, opts \\ []) do
    HttpClient.new(base_url, opts)
  end

  def unwrap!({:ok, value}), do: value
  def unwrap!({:error, error}), do: raise(error)
end

defmodule EdgeBaseCore.FieldOps do
  def increment(value) when is_number(value) do
    %{"$op" => "increment", "value" => value}
  end

  def delete_field do
    %{"$op" => "deleteField"}
  end
end
