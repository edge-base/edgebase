# frozen_string_literal: true

require "edgebase_core"

module EdgebaseAdmin
  # Client for a user-defined Vectorize index.
  #
  #   admin.vector("embeddings").upsert([{ "id" => "doc-1", "values" => [0.1, 0.2] }])
  #   results = admin.vector("embeddings").search([0.1, 0.2], top_k: 10)
  class VectorizeClient
    def initialize(http_client, index)
      @http = http_client
      @admin_core = EdgebaseAdmin::GeneratedAdminApi.new(http_client)
      @index = index
    end

    def upsert(vectors)
      @admin_core.vectorize_operation(@index, { "action" => "upsert", "vectors" => vectors })
    end

    def insert(vectors)
      @admin_core.vectorize_operation(@index, { "action" => "insert", "vectors" => vectors })
    end

    def search(vector, top_k: 10, filter: nil, namespace: nil, return_values: nil, return_metadata: nil)
      body = { "action" => "search", "vector" => vector, "topK" => top_k }
      body["filter"] = filter if filter
      body["namespace"] = namespace if namespace
      body["returnValues"] = return_values unless return_values.nil?
      body["returnMetadata"] = return_metadata if return_metadata
      res = @admin_core.vectorize_operation(@index, body)
      res["matches"] || []
    end

    def query_by_id(vector_id, top_k: 10, filter: nil, namespace: nil, return_values: nil, return_metadata: nil)
      body = { "action" => "queryById", "vectorId" => vector_id, "topK" => top_k }
      body["filter"] = filter if filter
      body["namespace"] = namespace if namespace
      body["returnValues"] = return_values unless return_values.nil?
      body["returnMetadata"] = return_metadata if return_metadata
      res = @admin_core.vectorize_operation(@index, body)
      res["matches"] || []
    end

    def get_by_ids(ids)
      res = @admin_core.vectorize_operation(@index, { "action" => "getByIds", "ids" => ids })
      res["vectors"] || []
    end

    def delete(ids)
      @admin_core.vectorize_operation(@index, { "action" => "delete", "ids" => ids })
    end

    def describe
      @admin_core.vectorize_operation(@index, { "action" => "describe" })
    end
  end
end
