defmodule EdgeBaseCore.MixProject do
  use Mix.Project

  def project do
    [
      app: :edgebase_core,
      version: "0.2.8",
      elixir: "~> 1.16",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      description: "EdgeBase core SDK for Elixir",
      package: package(),
      source_url: "https://github.com/edge-base/edgebase/tree/main/packages/sdk/elixir/packages/core",
      homepage_url: "https://edgebase.fun/docs/sdks"
    ]
  end

  def application do
    [
      extra_applications: [:logger, :inets, :ssl]
    ]
  end

  defp deps do
    [
      {:jason, "~> 1.4"}
    ]
  end

  defp package do
    [
      files: ~w(lib mix.exs README.md llms.txt LICENSE),
      licenses: ["MIT"],
      links: %{
        "Repository" => "https://github.com/edge-base/edgebase/tree/main/packages/sdk/elixir/packages/core",
        "Documentation" => "https://edgebase.fun/docs/sdks",
        "Issues" => "https://github.com/edge-base/edgebase/issues"
      }
    ]
  end
end
