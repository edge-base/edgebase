# frozen_string_literal: true

module EdgebaseCore
  # Base error for all EdgeBase API errors.
  class EdgeBaseError < StandardError
    attr_reader :status_code, :message, :details

    def initialize(status_code, message, details: nil)
      @status_code = status_code
      @message = message
      @details = details
      super(to_s)
    end

    def to_s
      parts = ["EdgeBaseError(#{@status_code}): #{@message}"]
      if @details
        @details.each do |k, v|
          parts << "  #{k}: #{Array(v).join(', ')}"
        end
      end
      parts.join("\n")
    end

    # Create from API JSON response.
    def self.from_json(data, status_code)
      new(
        status_code,
        data["message"] || data["error"] || "Request failed with HTTP #{status_code} and no error message from the server.",
        details: data["details"]
      )
    end
  end

  # Authentication-specific error.
  class EdgeBaseAuthError < EdgeBaseError
    def to_s
      "EdgeBaseAuthError(#{@status_code}): #{@message}"
    end
  end
end
