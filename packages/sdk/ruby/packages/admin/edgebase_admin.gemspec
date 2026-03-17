# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name          = "edgebase_admin"
  spec.version       = "0.1.0"
  spec.summary       = "EdgeBase Admin SDK for Ruby — server-side admin operations."
  spec.description   = "Admin module for EdgeBase Ruby SDK. Provides AdminClient, AdminAuthClient, " \
                        "KvClient, D1Client, VectorizeClient, PushClient via Service Key auth."
  spec.authors       = ["EdgeBase"]
  spec.license       = "MIT"
  spec.homepage      = "https://edgebase.fun"

  spec.required_ruby_version = ">= 3.0"

  spec.files         = Dir["lib/**/*.rb"]
  spec.require_paths = ["lib"]

  spec.add_dependency "edgebase_core", "~> 0.1"
end
