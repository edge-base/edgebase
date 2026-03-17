cmake_minimum_required(VERSION 3.16)
project(EdgeBaseUnreal VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Dependencies ──────────────────────────────────────────────────────────────

include(FetchContent)

# nlohmann/json
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(nlohmann_json)

# IXWebSocket (WebSocket for DatabaseLive)
FetchContent_Declare(
  ixwebsocket
  GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
  GIT_TAG        v11.4.5
)
option(USE_TLS "Enable TLS for database-live websocket transport" OFF)
FetchContent_MakeAvailable(ixwebsocket)

# Catch2 (for tests)
FetchContent_Declare(
  Catch2
  GIT_REPOSITORY https://github.com/catchorg/Catch2.git
  GIT_TAG        v3.5.3
)
FetchContent_MakeAvailable(Catch2)

# GoogleTest (for e2e_tests.cpp)
FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.14.0
  GIT_SHALLOW    TRUE
)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# Find libcurl
find_package(CURL REQUIRED)

# ── Core dependency ───────────────────────────────────────────────────────────

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../core ${CMAKE_CURRENT_BINARY_DIR}/core_build)

# ── Unreal client library (Auth, DatabaseLive, EdgeBase entry) ────────────────────

add_library(edgebase_unreal STATIC
  src/auth_client.cpp
  src/database_live_client.cpp
  src/turnstile_provider.cpp
)

target_include_directories(edgebase_unreal
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/../core/include
    ${nlohmann_json_SOURCE_DIR}/include
  PRIVATE
    ${CURL_INCLUDE_DIRS}
)

target_link_libraries(edgebase_unreal
  PUBLIC edgebase_core
  PRIVATE ${CURL_LIBRARIES}
  PRIVATE ixwebsocket
)

# ── Tests ─────────────────────────────────────────────────────────────────────

enable_testing()
include(CTest)
include(Catch)

# Unit tests (tests full client including EdgeBase entry point)
add_executable(unit_test tests/unit_tests.cpp)
target_link_libraries(unit_test PRIVATE edgebase_unreal edgebase_core Catch2::Catch2WithMain)
target_include_directories(unit_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/../core/include
  ${nlohmann_json_SOURCE_DIR}/include
)
catch_discover_tests(unit_test)

# E2E tests (requires running wrangler dev server)
add_executable(e2e_test tests/e2e_tests.cpp)
target_link_libraries(e2e_test PRIVATE edgebase_unreal edgebase_core gtest gtest_main)
target_include_directories(e2e_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/../core/include
  ${nlohmann_json_SOURCE_DIR}/include
)
include(GoogleTest)
gtest_discover_tests(e2e_test)
