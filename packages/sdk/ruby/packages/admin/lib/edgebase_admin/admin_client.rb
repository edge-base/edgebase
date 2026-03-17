# frozen_string_literal: true

require "edgebase_core"
require_relative "admin_auth"
require_relative "kv_client"
require_relative "d1_client"
require_relative "vectorize_client"
require_relative "push_client"
require_relative "functions_client"
require_relative "analytics_client"

module EdgebaseAdmin
  # DB namespace block reference for table access.
  #
  # Obtained via `admin.db("shared")`.
  class DbRef
    attr_reader :_namespace, :_instance_id

    def initialize(core, namespace, instance_id = nil)
      @core = core
      @_namespace = namespace
      @_instance_id = instance_id
    end

    # Get a TableRef for the named table.
    def table(name)
      EdgebaseCore::TableRef.new(
        @core, name,
        namespace: @_namespace,
        instance_id: @_instance_id
      )
    end
  end

  # Unified admin client — db, storage, auth access via Service Key.
  #
  #   admin = EdgebaseAdmin::AdminClient.new("http://localhost:8688", service_key: ENV.fetch("EDGEBASE_SERVICE_KEY"))
  #   table = admin.db("shared").table("posts")
  #   record = table.insert({ "title" => "Hello" })
  #
  #   bucket = admin.storage.bucket("documents")
  #   bucket.upload("file.txt", "Hello", content_type: "text/plain")
  class AdminClient
    attr_reader :admin_auth

    def initialize(base_url, service_key:)
      @http = EdgebaseCore::HttpClient.new(base_url, service_key: service_key)
      @core = EdgebaseCore::GeneratedDbApi.new(@http)
      @admin_auth = AdminAuthClient.new(@http)
    end

    # Get a DbRef for the given namespace.
    def db(namespace = "shared", instance_id: nil)
      DbRef.new(@core, namespace, instance_id)
    end

    # Get the StorageClient for file operations.
    def storage
      EdgebaseCore::StorageClient.new(@http)
    end

    # Get a KvClient for the named KV namespace.
    def kv(namespace)
      KvClient.new(@http, namespace)
    end

    # Get a D1Client for the named D1 database.
    def d1(database)
      D1Client.new(@http, database)
    end

    # Get a VectorizeClient for the named Vectorize index.
    def vector(index)
      VectorizeClient.new(@http, index)
    end

    # Get a PushClient for push notification operations.
    def push
      PushClient.new(@http)
    end

    # Get a FunctionsClient for calling app functions.
    def functions
      FunctionsClient.new(@http)
    end

    # Get an AnalyticsClient for metrics and custom event tracking.
    def analytics
      AnalyticsClient.new(@core, EdgebaseAdmin::GeneratedAdminApi.new(@http))
    end

    # Execute raw SQL via DatabaseDO.
    #
    #   rows = admin.sql("posts",
    #     "SELECT authorId, COUNT(*) as cnt FROM posts GROUP BY authorId ORDER BY cnt DESC LIMIT ?",
    #     [10])
    def sql(namespace = "shared", query = nil, params = nil, instance_id: nil)
      if !query.is_a?(String) || query.strip.empty?
        raise ArgumentError, "Invalid sql() signature: query must be a non-empty string"
      end

      body = {
        "namespace" => namespace,
        "sql" => query,
        "params" => params || [],
      }
      body["id"] = instance_id if instance_id
      admin_core = EdgebaseAdmin::GeneratedAdminApi.new(@http)
      result = admin_core.execute_sql(body)
      return result["rows"] if result.is_a?(Hash) && result["rows"].is_a?(Array)
      return result["items"] if result.is_a?(Hash) && result["items"].is_a?(Array)
      return result["results"] if result.is_a?(Hash) && result["results"].is_a?(Array)

      result
    end

    # Send a broadcast message to a database-live channel.
    #
    #   admin.broadcast("notifications", "alert", { "message" => "Maintenance in 5 min" })
    def broadcast(channel, event, payload = {})
      admin_core = EdgebaseAdmin::GeneratedAdminApi.new(@http)
      admin_core.database_live_broadcast({
        "channel" => channel,
        "event" => event,
        "payload" => payload
      })
    end

    # Stateless HTTP client; nothing to tear down, but final-suite runners
    # expect every admin SDK to expose a destroy/cleanup hook.
    def destroy
      nil
    end
  end
end
