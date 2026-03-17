# frozen_string_literal: true

require "edgebase_core"

module EdgebaseAdmin
  # Client for a user-defined KV namespace.
  #
  #   admin.kv("cache").set("key", "value", ttl: 300)
  #   val = admin.kv("cache").get("key")
  class KvClient
    def initialize(http_client, namespace)
      @http = http_client
      @admin_core = EdgebaseAdmin::GeneratedAdminApi.new(http_client)
      @namespace = namespace
    end

    # Get a value by key. Returns nil if not found.
    def get(key)
      res = @admin_core.kv_operation(@namespace, { "action" => "get", "key" => key })
      res["value"]
    end

    # Set a key-value pair with optional TTL in seconds.
    def set(key, value, ttl: nil)
      body = { "action" => "set", "key" => key, "value" => value }
      body["ttl"] = ttl if ttl
      @admin_core.kv_operation(@namespace, body)
    end

    # Delete a key.
    def delete(key)
      @admin_core.kv_operation(@namespace, { "action" => "delete", "key" => key })
    end

    # List keys with optional prefix, limit, and cursor.
    def list(prefix: nil, limit: nil, cursor: nil)
      body = { "action" => "list" }
      body["prefix"] = prefix if prefix
      body["limit"] = limit if limit
      body["cursor"] = cursor if cursor
      @admin_core.kv_operation(@namespace, body)
    end
  end
end
