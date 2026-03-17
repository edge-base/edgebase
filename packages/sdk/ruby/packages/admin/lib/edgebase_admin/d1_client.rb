# frozen_string_literal: true

require "edgebase_core"

module EdgebaseAdmin
  # Client for a user-defined D1 database.
  #
  #   rows = admin.d1("analytics").exec("SELECT * FROM events WHERE type = ?", ["pageview"])
  class D1Client
    def initialize(http_client, database)
      @http = http_client
      @admin_core = EdgebaseAdmin::GeneratedAdminApi.new(http_client)
      @database = database
    end

    # Execute a SQL query. Use ? placeholders for bind parameters.
    def exec(query, params = nil)
      body = { "query" => query }
      body["params"] = params if params
      res = @admin_core.execute_d1_query(@database, body)
      res["results"] || []
    end

    alias query exec
  end
end
