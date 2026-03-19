defmodule EdgeBaseAdmin.MixProject do
  use Mix.Project

  def project do
    [
      app: :edgebase_admin,
      version: "0.1.4",
      elixir: "~> 1.16",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      description: "EdgeBase admin SDK for Elixir",
      package: package()
    ]
  end

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp deps do
    [
      {:edgebase_core, "~> 0.1.4", path: "../core"},
      {:jason, "~> 1.4"}
    ]
  end

  defp package do
    [
      files: ~w(lib mix.exs README.md llms.txt LICENSE),
      licenses: ["MIT"],
      links: %{
        "Repository" => "https://github.com/edge-base/edgebase",
        "Documentation" => "https://edgebase.fun/docs/admin-sdk/reference"
      }
    ]
  end
end
