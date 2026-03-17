defmodule EdgeBaseCore.Error do
  defexception message: "EdgeBase request failed", status_code: 0, details: %{}

  @type t :: %__MODULE__{
          message: String.t(),
          status_code: integer(),
          details: map()
        }

  def from_response(status_code, body) when is_map(body) do
    message =
      body["message"] ||
        body[:message] ||
        "HTTP #{status_code}"

    details =
      body["details"] ||
        body[:details] ||
        %{}

    %__MODULE__{
      message: message,
      status_code: status_code,
      details: details
    }
  end

  def from_response(status_code, body) when is_binary(body) do
    %__MODULE__{message: body, status_code: status_code}
  end

  def from_response(status_code, _body) do
    %__MODULE__{message: "HTTP #{status_code}", status_code: status_code}
  end
end
