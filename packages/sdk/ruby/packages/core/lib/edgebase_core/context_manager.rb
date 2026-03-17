# frozen_string_literal: true

module EdgebaseCore
  # Thread-safe context storage for multi-tenancy.
  class ContextManager
    def initialize
      @context = {}
    end

    def set_context(context)
      # Filter out auth.id — server extracts from JWT only
      @context = context.reject { |k, _| k == "auth.id" }
    end

    def get_context
      @context.dup
    end

    def clear_context
      @context = {}
    end
  end
end
