# frozen_string_literal: true

module EdgebaseAdmin
  class AnalyticsClient
    def initialize(core, admin_core)
      @methods = EdgebaseCore::GeneratedAnalyticsMethods.new(core)
      @admin_core = admin_core
    end

    def overview(options = {})
      result = @admin_core.query_analytics(query: build_query("overview", options))
      result.is_a?(Hash) ? result : {}
    end

    def time_series(options = {})
      result = @admin_core.query_analytics(query: build_query("timeSeries", options))
      result.is_a?(Hash) ? Array(result["timeSeries"]) : []
    end

    def breakdown(options = {})
      result = @admin_core.query_analytics(query: build_query("breakdown", options))
      result.is_a?(Hash) ? Array(result["breakdown"]) : []
    end

    def top_endpoints(options = {})
      result = @admin_core.query_analytics(query: build_query("topEndpoints", options))
      result.is_a?(Hash) ? Array(result["topItems"]) : []
    end

    def track(name, properties = {}, user_id: nil)
      event = {
        "name" => name,
        "timestamp" => (Time.now.to_f * 1000).to_i
      }
      event["properties"] = properties unless properties.nil? || properties.empty?
      event["userId"] = user_id if user_id
      track_batch([event])
    end

    def track_batch(events)
      normalized = Array(events).map do |event|
        payload = event.dup
        payload["timestamp"] ||= (Time.now.to_f * 1000).to_i
        payload
      end
      return if normalized.empty?

      @methods.track({ "events" => normalized })
    end

    def query_events(options = {})
      @admin_core.query_custom_events(query: options)
    end

    private

    def build_query(metric, options)
      { "metric" => metric }.merge(options || {})
    end
  end
end
