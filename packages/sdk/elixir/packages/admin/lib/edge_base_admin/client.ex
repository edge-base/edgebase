defmodule EdgeBaseAdmin.Client do
  alias EdgeBaseCore.HttpClient

  defstruct [:http, context: %{}]

  def new(base_url, opts \\ []) do
    service_key = Keyword.fetch!(opts, :service_key)
    %__MODULE__{
      http: HttpClient.new(base_url, service_key: service_key),
      context: Keyword.get(opts, :context, %{})
    }
  end
end
