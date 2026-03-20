# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = "edgebase_core"
  spec.version       = "0.1.5"
  spec.summary       = "EdgeBase Core SDK for Ruby — shared HTTP client, query builder, and storage."
  spec.description   = "Core module for EdgeBase Ruby SDK. Provides HttpClient, TableRef, DocRef, " \
                        "StorageClient, and generated API layer from OpenAPI spec."
  spec.authors       = ["EdgeBase"]
  spec.license       = "MIT"
  spec.homepage      = "https://edgebase.fun/docs/sdks"
  spec.metadata      = {
    "allowed_push_host" => "https://rubygems.org",
    "homepage_uri" => "https://edgebase.fun/docs/sdks",
    "bug_tracker_uri" => "https://github.com/edge-base/edgebase/issues",
    "source_code_uri" => "https://github.com/edge-base/edgebase/tree/main/packages/sdk/ruby/packages/core",
    "documentation_uri" => "https://edgebase.fun/docs/sdks",
  }

  spec.required_ruby_version = ">= 3.0"

  spec.files         = Dir["lib/**/*.rb"] + %w[README.md llms.txt LICENSE]
  spec.require_paths = ["lib"]

  # Zero external dependencies — uses only Ruby stdlib (net/http, json, uri, base64)
end
