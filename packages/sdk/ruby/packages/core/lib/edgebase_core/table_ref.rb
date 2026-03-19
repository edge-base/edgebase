# frozen_string_literal: true

require "json"

module EdgebaseCore
  # Query filter tuple.
  FilterTuple = Struct.new(:field_name, :op, :value) do
    def to_json_array
      [field_name, op, value]
    end
  end

  # Builder for OR conditions.
  class OrBuilder
    def initialize
      @filters = []
    end

    def where(field_name, op, value)
      @filters << FilterTuple.new(field_name, op, value)
      self
    end

    def get_filters
      @filters.dup
    end
  end

  # Collection query result — unified type for offset and cursor pagination.
  ListResult = Struct.new(:items, :total, :page, :per_page, :has_more, :cursor, keyword_init: true) do
    def initialize(items: [], total: nil, page: nil, per_page: nil, has_more: nil, cursor: nil)
      super(items: items, total: total, page: page, per_page: per_page, has_more: has_more, cursor: cursor)
    end
  end

  # Batch operation result.
  BatchResult = Struct.new(:total_processed, :total_succeeded, :errors, keyword_init: true)

  # Upsert operation result.
  UpsertResult = Struct.new(:record, :inserted, keyword_init: true)

  # DatabaseLive database change event.
  DbChange = Struct.new(:event, :table, :id, :record, :old_record, keyword_init: true) do
    def self.from_json(data)
      new(
        event: data["event"] || "",
        table: data["table"] || "",
        id: data["id"],
        record: data["record"],
        old_record: data["oldRecord"]
      )
    end
  end

  def self.build_database_live_channel(namespace, table, instance_id = nil, doc_id = nil)
    base = instance_id ? "dblive:#{namespace}:#{instance_id}:#{table}" : "dblive:#{namespace}:#{table}"
    doc_id ? "#{base}:#{doc_id}" : base
  end

  # ── Core dispatch helpers ──────────────────────────────────────────────────

  module CoreDispatch
    module_function

    def core_get(core, method, namespace, instance_id, table, doc_id: nil, query: nil)
      if instance_id
        case method
        when "list"   then core.db_list_records(namespace, instance_id, table, query: query)
        when "get"    then core.db_get_record(namespace, instance_id, table, doc_id, query: query)
        when "count"  then core.db_count_records(namespace, instance_id, table, query: query)
        when "search" then core.db_search_records(namespace, instance_id, table, query: query)
        end
      else
        case method
        when "list"   then core.db_single_list_records(namespace, table, query: query)
        when "get"    then core.db_single_get_record(namespace, table, doc_id, query: query)
        when "count"  then core.db_single_count_records(namespace, table, query: query)
        when "search" then core.db_single_search_records(namespace, table, query: query)
        end
      end
    end

    def core_insert(core, namespace, instance_id, table, body, query = nil)
      if instance_id
        core.db_insert_record(namespace, instance_id, table, body, query: query)
      else
        core.db_single_insert_record(namespace, table, body, query: query)
      end
    end

    def core_update(core, namespace, instance_id, table, doc_id, body)
      if instance_id
        core.db_update_record(namespace, instance_id, table, doc_id, body)
      else
        core.db_single_update_record(namespace, table, doc_id, body)
      end
    end

    def core_delete(core, namespace, instance_id, table, doc_id)
      if instance_id
        core.db_delete_record(namespace, instance_id, table, doc_id)
      else
        core.db_single_delete_record(namespace, table, doc_id)
      end
    end

    def core_batch(core, namespace, instance_id, table, body, query = nil)
      if instance_id
        core.db_batch_records(namespace, instance_id, table, body, query: query)
      else
        core.db_single_batch_records(namespace, table, body, query: query)
      end
    end

    def core_batch_by_filter(core, namespace, instance_id, table, body)
      if instance_id
        core.db_batch_by_filter(namespace, instance_id, table, body, query: nil)
      else
        core.db_single_batch_by_filter(namespace, table, body, query: nil)
      end
    end
  end

  # ── TableRef ───────────────────────────────────────────────────────────────

  # Immutable table reference with query builder.
  #
  # All chaining methods return a new instance — safe for reference sharing.
  # All HTTP calls delegate to Generated Core (no hardcoded paths).
  #
  #   posts = client.db("shared").table("posts")
  #   result = posts.where("status", "==", "published")
  #                  .order_by("createdAt", "desc")
  #                  .limit(20)
  #                  .get_list
  class TableRef
    attr_reader :_name, :_namespace, :_instance_id, :_filters, :_or_filters,
                :_sorts, :_limit, :_offset, :_page, :_search, :_after, :_before

    def initialize(core, name, database_live: nil, namespace: "shared", instance_id: nil,
                   filters: nil, or_filters: nil, sorts: nil,
                   limit_value: nil, offset_value: nil, page_value: nil,
                   search_value: nil, after_value: nil, before_value: nil)
      @core = core
      @_name = name
      @database_live = database_live
      @_namespace = namespace
      @_instance_id = instance_id
      @_filters = filters || []
      @_or_filters = or_filters || []
      @_sorts = sorts || []
      @_limit = limit_value
      @_offset = offset_value
      @_page = page_value
      @_search = search_value
      @_after = after_value
      @_before = before_value
    end

    # ── Query Builder (immutable) ──────────────────────────────────────────

    def where(field_name, op, value)
      clone_with(filters: [*@_filters, FilterTuple.new(field_name, op, value)])
    end

    def or_(&block)
      builder = OrBuilder.new
      block.call(builder)
      clone_with(or_filters: [*@_or_filters, *builder.get_filters])
    end

    def order_by(field_name, direction = "asc")
      clone_with(sorts: [*@_sorts, [field_name, direction]])
    end

    def limit(n)
      clone_with(limit_value: n)
    end

    def offset(n)
      clone_with(offset_value: n)
    end

    # Set page number for offset pagination (1-based).
    def page(n)
      clone_with(page_value: n)
    end

    def search(query)
      clone_with(search_value: query)
    end

    # Set cursor for forward pagination. Mutually exclusive with offset().
    def after(cursor)
      clone_with(after_value: cursor, before_value: nil)
    end

    # Set cursor for backward pagination. Mutually exclusive with offset().
    def before(cursor)
      clone_with(before_value: cursor, after_value: nil)
    end

    # ── CRUD ───────────────────────────────────────────────────────────────

    def get_list
      params = build_query_params
      if @_search
        params["search"] = @_search
        data = CoreDispatch.core_get(@core, "search", @_namespace, @_instance_id, @_name, query: params)
      else
        data = CoreDispatch.core_get(@core, "list", @_namespace, @_instance_id, @_name, query: params)
      end
      return ListResult.new(items: []) unless data.is_a?(Hash)

      ListResult.new(
        items: data["items"] || [],
        total: data["total"],
        page: data["page"],
        per_page: data["perPage"],
        has_more: data["hasMore"],
        cursor: data["cursor"]
      )
    end

    # Get a single record by ID.
    def get_one(doc_id)
      CoreDispatch.core_get(
        @core, "get", @_namespace, @_instance_id, @_name,
        doc_id: doc_id, query: {}
      )
    end

    def insert(record)
      CoreDispatch.core_insert(@core, @_namespace, @_instance_id, @_name, record)
    end

    def upsert(record, conflict_target: nil)
      query = { "upsert" => "true" }
      query["conflictTarget"] = conflict_target if conflict_target
      data = CoreDispatch.core_insert(@core, @_namespace, @_instance_id, @_name, record, query)
      UpsertResult.new(
        record: data.is_a?(Hash) ? data : {},
        inserted: data.is_a?(Hash) && data["action"] == "inserted"
      )
    end

    def count
      params = build_query_params
      data = CoreDispatch.core_get(@core, "count", @_namespace, @_instance_id, @_name, query: params)
      data.is_a?(Hash) ? (data["total"] || 0) : 0
    end

    # Get the first record matching the current query conditions.
    def get_first
      result = self.limit(1).get_list
      result.items.first
    end

    def update(doc_id, data)
      doc(doc_id).update(data)
    end

    def delete(doc_id)
      doc(doc_id).delete
    end

    def sql(query, params = [])
      body = {
        "namespace" => @_namespace,
        "sql" => query,
        "params" => params
      }
      body["id"] = @_instance_id unless @_instance_id.nil?
      result = @core.http.post("/sql", body)
      result.is_a?(Hash) ? (result["items"] || []) : []
    end

    # ── Batch ──────────────────────────────────────────────────────────────

    # Create multiple records. Auto-chunks into 500-item batches.
    def insert_many(records)
      chunk_size = 500
      if records.length <= chunk_size
        data = CoreDispatch.core_batch(@core, @_namespace, @_instance_id, @_name, { "inserts" => records })
        return data.is_a?(Hash) ? (data["inserted"] || []) : []
      end

      all_inserted = []
      records.each_slice(chunk_size) do |chunk|
        data = CoreDispatch.core_batch(@core, @_namespace, @_instance_id, @_name, { "inserts" => chunk })
        all_inserted.concat(data["inserted"] || []) if data.is_a?(Hash)
      end
      all_inserted
    end

    # Upsert multiple records. Auto-chunks 500 items.
    def upsert_many(records, conflict_target: nil)
      chunk_size = 500
      query = { "upsert" => "true" }
      query["conflictTarget"] = conflict_target if conflict_target

      if records.length <= chunk_size
        data = CoreDispatch.core_batch(@core, @_namespace, @_instance_id, @_name, { "inserts" => records }, query)
        return data.is_a?(Hash) ? (data["inserted"] || []) : []
      end

      all_inserted = []
      records.each_slice(chunk_size) do |chunk|
        data = CoreDispatch.core_batch(@core, @_namespace, @_instance_id, @_name, { "inserts" => chunk }, query)
        all_inserted.concat(data["inserted"] || []) if data.is_a?(Hash)
      end
      all_inserted
    end

    # Update records matching query builder filters.
    def update_many(update)
      raise ArgumentError, "update_many requires at least one where() filter" if @_filters.empty?
      batch_by_filter("update", update)
    end

    # Delete records matching query builder filters.
    def delete_many
      raise ArgumentError, "delete_many requires at least one where() filter" if @_filters.empty?
      batch_by_filter("delete", nil)
    end

    # ── Doc ─────────────────────────────────────────────────────────────────

    def doc(doc_id)
      DocRef.new(
        @core, @_name, doc_id, @database_live,
        namespace: @_namespace, instance_id: @_instance_id
      )
    end

    # ── DatabaseLive ────────────────────────────────────────────────────────────

    def on_snapshot(&callback)
      raise "DatabaseLive not available" unless @database_live
      @database_live.subscribe_callback(
        EdgebaseCore.build_database_live_channel(@_namespace, @_name, @_instance_id),
        callback
      )
    end

    # ── Internal ────────────────────────────────────────────────────────────

    def build_query_params
      has_cursor = !@_after.nil? || !@_before.nil?
      has_offset = !@_offset.nil? || !@_page.nil?
      if has_cursor && has_offset
        raise ArgumentError,
              "Cannot use page()/offset() with after()/before() — choose offset or cursor pagination"
      end

      params = {}
      unless @_filters.empty?
        params["filter"] = JSON.generate(@_filters.map(&:to_json_array))
      end
      unless @_or_filters.empty?
        params["orFilter"] = JSON.generate(@_or_filters.map(&:to_json_array))
      end
      unless @_sorts.empty?
        params["sort"] = @_sorts.map { |f, d| "#{f}:#{d}" }.join(",")
      end
      params["limit"] = @_limit.to_s unless @_limit.nil?
      params["page"] = @_page.to_s unless @_page.nil?
      params["offset"] = @_offset.to_s unless @_offset.nil?
      params["after"] = @_after unless @_after.nil?
      params["before"] = @_before unless @_before.nil?
      params
    end

    private

    def clone_with(**kwargs)
      TableRef.new(
        @core, @_name,
        database_live: @database_live,
        namespace: @_namespace,
        instance_id: @_instance_id,
        filters: kwargs.fetch(:filters, @_filters),
        or_filters: kwargs.fetch(:or_filters, @_or_filters),
        sorts: kwargs.fetch(:sorts, @_sorts),
        limit_value: kwargs.fetch(:limit_value, @_limit),
        offset_value: kwargs.fetch(:offset_value, @_offset),
        page_value: kwargs.fetch(:page_value, @_page),
        search_value: kwargs.fetch(:search_value, @_search),
        after_value: kwargs.fetch(:after_value, @_after),
        before_value: kwargs.fetch(:before_value, @_before)
      )
    end

    def batch_by_filter(action, update)
      max_iterations = 100
      total_processed = 0
      total_succeeded = 0
      errors = []
      filter_json = @_filters.map(&:to_json_array)

      max_iterations.times do |chunk_index|
        body = {
          "action" => action,
          "filter" => filter_json,
          "limit" => 500
        }
        body["orFilter"] = @_or_filters.map(&:to_json_array) unless @_or_filters.empty?
        body["update"] = update if action == "update" && update

        begin
          data = CoreDispatch.core_batch_by_filter(@core, @_namespace, @_instance_id, @_name, body)
          processed = data.is_a?(Hash) ? (data["processed"] || 0) : 0
          succeeded = data.is_a?(Hash) ? (data["succeeded"] || 0) : 0
          total_processed += processed
          total_succeeded += succeeded

          break if processed == 0
          # For 'update', don't loop — updated records still match the filter
          break if action == "update"
        rescue StandardError => e
          errors << { "chunkIndex" => chunk_index, "chunkSize" => 500, "error" => e.to_s }
          break
        end
      end

      BatchResult.new(
        total_processed: total_processed,
        total_succeeded: total_succeeded,
        errors: errors
      )
    end
  end

  # ── DocRef ───────────────────────────────────────────────────────────────────

  # Document reference for single-document operations.
  class DocRef
    attr_reader :table_name, :id

    def initialize(core, table_name, doc_id, database_live = nil, namespace: "shared", instance_id: nil)
      @core = core
      @table_name = table_name
      @id = doc_id
      @database_live = database_live
      @_namespace = namespace
      @_instance_id = instance_id
    end

    def get
      CoreDispatch.core_get(
        @core, "get", @_namespace, @_instance_id, @table_name,
        doc_id: @id, query: {}
      )
    end

    def update(data)
      CoreDispatch.core_update(@core, @_namespace, @_instance_id, @table_name, @id, data)
    end

    def delete
      CoreDispatch.core_delete(@core, @_namespace, @_instance_id, @table_name, @id)
    end

    def on_snapshot(&callback)
      raise "DatabaseLive not available" unless @database_live
      @database_live.subscribe_callback(
        EdgebaseCore.build_database_live_channel(@_namespace, @table_name, @_instance_id, @id),
        callback
      )
    end
  end
end
