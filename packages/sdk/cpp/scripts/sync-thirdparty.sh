#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="$(cd "${script_dir}/.." && pwd)"
core_root="${plugin_root}/packages/core"
build_root="${core_root}/build"
third_party_root="${plugin_root}/ThirdParty"
cmake_args=("-DCMAKE_BUILD_TYPE=Release")

if [[ "$(uname -s)" == "Darwin" ]]; then
  cmake_args+=("-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0")
fi

if [[ ! -f "${build_root}/libedgebase_core.a" ]]; then
  cmake -S "${core_root}" -B "${build_root}" "${cmake_args[@]}"
  cmake --build "${build_root}" -j4
fi

mkdir -p "${third_party_root}/include" "${third_party_root}/lib/mac"
rm -rf "${third_party_root}/include/edgebase"
rm -rf "${third_party_root}/include/nlohmann"
cp -R "${core_root}/include/edgebase" "${third_party_root}/include/"
cp -R "${build_root}/_deps/nlohmann_json-src/include/nlohmann" "${third_party_root}/include/"
cp "${build_root}/libedgebase_core.a" "${third_party_root}/lib/mac/libedgebase_core.a"

echo "Synced EdgeBase Unreal ThirdParty artifacts into ${third_party_root}"
