# frozen_string_literal: true

require "net/http"
require "uri"
require "json"

require_relative "context_manager"
require_relative "errors"

module EdgebaseCore
  DEFAULT_OPEN_TIMEOUT = 30
  DEFAULT_READ_TIMEOUT = 120

  # Synchronous HTTP client for server-side use.
  #
  # Features:
  # - Service Key header injection (X-EdgeBase-Service-Key)
  # - Optional Bearer token injection (for impersonation)
  # - Legacy context state for compatibility (not serialized into HTTP headers)
  class HttpClient
    attr_reader :base_url

    def initialize(base_url, context_manager: nil, service_key: nil, bearer_token: nil)
      @base_url = base_url.chomp("/")
      @context_manager = context_manager || ContextManager.new
      @service_key = service_key
      @bearer_token = bearer_token
    end

    def get(path, params: nil)
      request("GET", path, params: params)
    end

    def post(path, body = nil, params: nil)
      request("POST", path, params: params, json_body: body)
    end

    def patch(path, body = nil, params: nil)
      request("PATCH", path, params: params, json_body: body)
    end

    def put(path, body = nil, params: nil)
      request("PUT", path, params: params, json_body: body)
    end

    def delete(path, params: nil)
      request("DELETE", path, params: params)
    end

    # HEAD request — returns true if resource exists (2xx).
    def head(path)
      uri = URI(build_url(path))
      http = build_http(uri)
      req = Net::HTTP::Head.new(uri)
      auth_headers.each { |k, v| req[k] = v }
      response = http.request(req)
      response.code.to_i < 400
    end

    # POST multipart form data (for file uploads).
    def post_multipart(path, files:, data: nil)
      uri = URI(build_url(path))
      http = build_http(uri)

      boundary = "EdgeBase#{rand(10**16)}"
      body = build_multipart_body(files, data, boundary)

      req = Net::HTTP::Post.new(uri)
      headers = auth_headers
      headers.delete("Content-Type")
      headers["Content-Type"] = "multipart/form-data; boundary=#{boundary}"
      headers.each { |k, v| req[k] = v }
      req.body = body

      parse_response(http.request(req))
    end

    # POST raw binary data (for multipart upload-part).
    def post_raw(path, data:, content_type: "application/octet-stream")
      uri = URI(build_url(path))
      http = build_http(uri)

      req = Net::HTTP::Post.new(uri)
      headers = auth_headers
      headers["Content-Type"] = content_type
      headers.each { |k, v| req[k] = v }
      req.body = data

      parse_response(http.request(req))
    end

    # GET raw bytes (for file downloads).
    def get_raw(path)
      uri = URI(build_url(path))
      http = build_http(uri)
      req = Net::HTTP::Get.new(uri)
      auth_headers.each { |k, v| req[k] = v }
      response = http.request(req)
      if response.code.to_i >= 400
        raise EdgeBaseError.new(response.code.to_i, response.body)
      end
      response.body
    end

    private

    def parse_retry_after_delay(response, attempt)
      base_delay = 1.0 * (2 ** attempt)
      retry_after = response["retry-after"] || response["Retry-After"]
      if retry_after
        begin
          seconds = Integer(retry_after)
          base_delay = seconds.to_f if seconds > 0
        rescue ArgumentError
          # ignore non-integer Retry-After
        end
      end
      jitter = rand * base_delay * 0.25
      [base_delay + jitter, 10.0].min
    end

    RETRYABLE_ERRORS = [
      Net::OpenTimeout, Net::ReadTimeout, Errno::ECONNREFUSED,
      Errno::ECONNRESET, Errno::ENETUNREACH, Errno::EHOSTUNREACH,
      SocketError, EOFError
    ].freeze

    def request(method, path, params: nil, json_body: nil)
      url = build_url(path)
      if params && !params.empty?
        query = URI.encode_www_form(params)
        url = "#{url}?#{query}"
      end

      max_retries = 3
      last_response = nil

      (max_retries + 1).times do |attempt|
        uri = URI(url)
        http = build_http(uri)

        req = case method
              when "GET"    then Net::HTTP::Get.new(uri)
              when "POST"   then Net::HTTP::Post.new(uri)
              when "PATCH"  then Net::HTTP::Patch.new(uri)
              when "PUT"    then Net::HTTP::Put.new(uri)
              when "DELETE" then Net::HTTP::Delete.new(uri)
              else Net::HTTP::Get.new(uri)
              end

        auth_headers.each { |k, v| req[k] = v }
        req.body = JSON.generate(json_body) if json_body

        begin
          response = http.request(req)
          last_response = response
        rescue *RETRYABLE_ERRORS => e
          if attempt < 2
            sleep(0.05 * (attempt + 1))
            next
          end
          raise EdgeBaseError.new(0, "Request failed: #{e.message}")
        end

        if response.code.to_i == 429 && attempt < max_retries
          delay = parse_retry_after_delay(response, attempt)
          sleep(delay)
          next
        end

        return parse_response(response)
      end

      parse_response(last_response)
    end

    def build_url(path)
      if path.start_with?("/api/")
        "#{@base_url}#{path}"
      else
        "#{@base_url}/api#{path}"
      end
    end

    def auth_headers
      headers = { "Content-Type" => "application/json", "Connection" => "close" }
      begin
        if @bearer_token
          headers["Authorization"] = "Bearer #{@bearer_token}"
        end
        if @service_key
          headers["X-EdgeBase-Service-Key"] = @service_key
          headers["Authorization"] = "Bearer #{@service_key}"
        end
      rescue StandardError
        # Token refresh failed — proceed as unauthenticated
      end
      headers
    end

    def build_http(uri)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = (uri.scheme == "https")
      http.open_timeout = request_timeout_seconds(DEFAULT_OPEN_TIMEOUT)
      http.read_timeout = request_timeout_seconds(DEFAULT_READ_TIMEOUT)
      http.keep_alive_timeout = 0 if http.respond_to?(:keep_alive_timeout=)
      http
    end

    def request_timeout_seconds(default_seconds)
      raw = ENV.fetch("EDGEBASE_HTTP_TIMEOUT_MS", "").strip
      return default_seconds if raw.empty?

      timeout_ms = Integer(raw, exception: false)
      return default_seconds if timeout_ms.nil? || timeout_ms <= 0

      timeout_ms / 1000.0
    end

    def parse_response(response)
      code = response.code.to_i
      if code >= 400
        begin
          data = JSON.parse(response.body)
          raise EdgeBaseError.from_json(data, code)
        rescue EdgeBaseError
          raise
        rescue StandardError
          raise EdgeBaseError.new(code, response.body || "Request failed with HTTP #{code} and a non-JSON error response.")
        end
      end

      return nil if response.body.nil? || response.body.empty?

      begin
        JSON.parse(response.body)
      rescue StandardError
        raise EdgeBaseError.new(code, "Expected a JSON response but received malformed JSON.")
      end
    end

    def build_multipart_body(files, data, boundary)
      body = +""
      # Data fields
      if data
        data.each do |key, value|
          body << "--#{boundary}\r\n"
          body << "Content-Disposition: form-data; name=\"#{key}\"\r\n\r\n"
          body << "#{value}\r\n"
        end
      end
      # File fields
      files.each do |field_name, (filename, file_data, content_type)|
        body << "--#{boundary}\r\n"
        body << "Content-Disposition: form-data; name=\"#{field_name}\"; filename=\"#{filename}\"\r\n"
        body << "Content-Type: #{content_type}\r\n\r\n"
        body << file_data
        body << "\r\n"
      end
      body << "--#{boundary}--\r\n"
      body
    end
  end
end
