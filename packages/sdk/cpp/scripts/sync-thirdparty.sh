#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="$(cd "${script_dir}/.." && pwd)"
core_root="${plugin_root}/packages/core"
build_root="${core_root}/build"
third_party_root="${plugin_root}/ThirdParty"
consumer_source="${plugin_root}/packages/unreal/tests/thirdparty_consumer"
cmake_args=("-DCMAKE_BUILD_TYPE=Release")
platform=""

if [[ "$(uname -s)" == "Darwin" ]]; then
  cmake_args+=("-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0")
  platform="mac"
elif [[ "$(uname -s)" == "Linux" ]]; then
  platform="linux"
else
  echo "Unsupported host for Unreal ThirdParty sync: $(uname -s)" >&2
  exit 1
fi

# Always reconfigure and rebuild. Reusing a stale archive can silently omit
# security-sensitive API changes such as the hosted CAPTCHA provider hook.
cmake -S "${core_root}" -B "${build_root}" "${cmake_args[@]}"
cmake --build "${build_root}" --parallel 4

ix_archive="${build_root}/_deps/ixwebsocket-build/libixwebsocket.a"
if [[ ! -f "${ix_archive}" ]]; then
  echo "IXWebSocket archive was not produced: ${ix_archive}" >&2
  exit 1
fi

mkdir -p "${third_party_root}/include" "${third_party_root}/lib/${platform}"
rm -rf "${third_party_root}/include/edgebase"
rm -rf "${third_party_root}/include/nlohmann"
cp -R "${core_root}/include/edgebase" "${third_party_root}/include/"
cp -R "${build_root}/_deps/nlohmann_json-src/include/nlohmann" "${third_party_root}/include/"
cp "${build_root}/libedgebase_core.a" \
  "${third_party_root}/lib/${platform}/libedgebase_core.a"
cp "${ix_archive}" \
  "${third_party_root}/lib/${platform}/libixwebsocket.a"

# Reproduce UBT's metadata-free consumer link using only the copied headers
# and archives. A normal CMake target link would hide missing transitive
# archives through edgebase_core's link interface.
consumer_build="${build_root}/thirdparty-consumer"
cmake -S "${consumer_source}" -B "${consumer_build}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DEDGEBASE_THIRDPARTY_ROOT="${third_party_root}"
cmake --build "${consumer_build}" --parallel 4

echo "Synced and link-verified EdgeBase Unreal ThirdParty artifacts in ${third_party_root}"
