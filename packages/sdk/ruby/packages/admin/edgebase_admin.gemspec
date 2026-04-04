# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = "edgebase_admin"
  spec.version       = "0.2.8"
  spec.summary       = "EdgeBase Admin SDK for Ruby — server-side admin operations."
  spec.description   = "Admin module for EdgeBase Ruby SDK. Provides AdminClient, AdminAuthClient, " \
                        "KvClient, D1Client, VectorizeClient, PushClient via Service Key auth."
  spec.authors       = ["EdgeBase"]
  spec.license       = "MIT"
  spec.homepage      = "https://edgebase.fun/docs/admin-sdk/reference"
  spec.metadata      = {
    "allowed_push_host" => "https://rubygems.org",
    "homepage_uri" => "https://edgebase.fun/docs/admin-sdk/reference",
    "bug_tracker_uri" => "https://github.com/edge-base/edgebase/issues",
    "source_code_uri" => "https://github.com/edge-base/edgebase/tree/main/packages/sdk/ruby/packages/admin",
    "documentation_uri" => "https://edgebase.fun/docs/admin-sdk/reference",
  }

  spec.required_ruby_version = ">= 3.0"

  spec.files         = Dir["lib/**/*.rb"] + %w[README.md llms.txt LICENSE]
  spec.require_paths = ["lib"]

  spec.add_dependency "edgebase_core", "~> 0.2.8"
end
