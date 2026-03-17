# frozen_string_literal: true

module EdgebaseAdmin
  class FunctionsClient
    def initialize(http_client)
      @http = http_client
    end

    def call(path, method: "POST", body: nil, query: nil)
      normalized_path = "/functions/#{path.sub(%r{^/}, "")}"

      case method.to_s.upcase
      when "GET"
        @http.get(normalized_path, params: query)
      when "PUT"
        @http.put(normalized_path, body)
      when "PATCH"
        @http.patch(normalized_path, body)
      when "DELETE"
        @http.delete(normalized_path)
      else
        @http.post(normalized_path, body)
      end
    end

    def get(path, query: nil)
      call(path, method: "GET", query: query)
    end

    def post(path, body = nil)
      call(path, method: "POST", body: body)
    end

    def put(path, body = nil)
      call(path, method: "PUT", body: body)
    end

    def patch(path, body = nil)
      call(path, method: "PATCH", body: body)
    end

    def delete(path)
      call(path, method: "DELETE")
    end
  end
end
