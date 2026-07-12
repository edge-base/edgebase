cmake_minimum_required(VERSION 3.16)
project(EdgeBaseThirdPartyConsumer LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT DEFINED EDGEBASE_THIRDPARTY_ROOT)
  message(FATAL_ERROR "EDGEBASE_THIRDPARTY_ROOT must point at the packaged ThirdParty directory")
endif()

if(WIN32)
  set(platform_dir win64)
  set(core_archive "${EDGEBASE_THIRDPARTY_ROOT}/lib/${platform_dir}/edgebase_core.lib")
  set(ix_archive "${EDGEBASE_THIRDPARTY_ROOT}/lib/${platform_dir}/ixwebsocket.lib")
elseif(APPLE)
  set(platform_dir mac)
  set(core_archive "${EDGEBASE_THIRDPARTY_ROOT}/lib/${platform_dir}/libedgebase_core.a")
  set(ix_archive "${EDGEBASE_THIRDPARTY_ROOT}/lib/${platform_dir}/libixwebsocket.a")
elseif(UNIX)
  set(platform_dir linux)
  set(core_archive "${EDGEBASE_THIRDPARTY_ROOT}/lib/${platform_dir}/libedgebase_core.a")
  set(ix_archive "${EDGEBASE_THIRDPARTY_ROOT}/lib/${platform_dir}/libixwebsocket.a")
else()
  message(FATAL_ERROR "The packaged Unreal SDK supports only Win64, macOS, and Linux")
endif()

foreach(required_path IN ITEMS
    "${EDGEBASE_THIRDPARTY_ROOT}/include/edgebase/edgebase.h"
    "${EDGEBASE_THIRDPARTY_ROOT}/include/nlohmann/json.hpp"
    "${core_archive}"
    "${ix_archive}")
  if(NOT EXISTS "${required_path}")
    message(FATAL_ERROR "Missing packaged consumer artifact: ${required_path}")
  endif()
endforeach()

# Import the copied archives by path. Deliberately do not add the EdgeBase or
# IXWebSocket source trees and do not consume either project's CMake targets:
# this reproduces the metadata-free link performed by UnrealBuildTool.
add_library(edgebase_core_packaged STATIC IMPORTED GLOBAL)
set_target_properties(edgebase_core_packaged PROPERTIES
  IMPORTED_LOCATION "${core_archive}")
add_library(ixwebsocket_packaged STATIC IMPORTED GLOBAL)
set_target_properties(ixwebsocket_packaged PROPERTIES
  IMPORTED_LOCATION "${ix_archive}")

find_package(CURL REQUIRED)
find_package(ZLIB REQUIRED)
find_package(Threads REQUIRED)

add_executable(edgebase_thirdparty_consumer main.cpp)
target_include_directories(edgebase_thirdparty_consumer PRIVATE
  "${EDGEBASE_THIRDPARTY_ROOT}/include")
target_link_libraries(edgebase_thirdparty_consumer PRIVATE
  edgebase_core_packaged
  ixwebsocket_packaged
  CURL::libcurl
  ZLIB::ZLIB
  Threads::Threads)

if(WIN32)
  find_package(OpenSSL REQUIRED)
  target_link_libraries(edgebase_thirdparty_consumer PRIVATE
    OpenSSL::SSL OpenSSL::Crypto
    bcrypt wsock32 ws2_32 shlwapi crypt32)
elseif(APPLE)
  target_link_libraries(edgebase_thirdparty_consumer PRIVATE
    "-framework Foundation" "-framework Security")
else()
  find_package(OpenSSL REQUIRED)
  target_link_libraries(edgebase_thirdparty_consumer PRIVATE
    OpenSSL::SSL OpenSSL::Crypto)
endif()

