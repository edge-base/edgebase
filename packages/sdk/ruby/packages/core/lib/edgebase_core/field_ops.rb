# frozen_string_literal: true

module EdgebaseCore
  # Atomic field operation markers ($op pattern — mirrors JS SDK, server op-parser.ts).
  module FieldOps
    # Increment a numeric field atomically.
    #
    #   doc_ref.update("views" => EdgebaseCore::FieldOps.increment(1))
    #   doc_ref.update("score" => EdgebaseCore::FieldOps.increment(-5))
    def self.increment(value = 1)
      { "$op" => "increment", "value" => value }
    end

    # Delete a field from a document.
    #
    #   doc_ref.update("oldField" => EdgebaseCore::FieldOps.delete_field)
    def self.delete_field
      { "$op" => "deleteField" }
    end
  end
end
