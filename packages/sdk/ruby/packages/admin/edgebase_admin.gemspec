# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = "edgebase_admin"
  spec.version       = "0.1.4"
  spec.summary       = "EdgeBase Admin SDK for Ruby — server-side admin operations."
  spec.description   = "Admin module for EdgeBase Ruby SDK. Provides AdminClient, AdminAuthClient, " \
                        "KvClient, D1Client, VectorizeClient, PushClient via Service Key auth."
  spec.authors       = ["EdgeBase"]
  spec.license       = "MIT"
  spec.homepage      = "https://edgebase.fun/docs/admin-sdk/reference"
  spec.metadata      = {
    "homepage_uri" => "https://edgebase.fun/docs/admin-sdk/reference",
    "source_code_uri" => "https://github.com/edge-base/edgebase",
    "documentation_uri" => "https://edgebase.fun/docs/sdks",
  }

  spec.required_ruby_version = ">= 3.0"

  spec.files         = Dir["lib/**/*.rb"] + %w[README.md llms.txt LICENSE]
  spec.require_paths = ["lib"]

  spec.add_dependency "edgebase_core", "~> 0.1.4"
end
