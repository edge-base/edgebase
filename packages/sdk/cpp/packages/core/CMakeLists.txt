cmake_minimum_required(VERSION 3.16)
project(EdgeBaseCore VERSION 1.0.0 LANGUAGES CXX)

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

# IXWebSocket (WebSocket transport for Realtime/Room)
FetchContent_Declare(
  ixwebsocket
  GIT_REPOSITORY https://github.com/machinezone/IXWebSocket.git
  GIT_TAG        v11.4.5
)
set(USE_TLS ON CACHE BOOL "Enable TLS for database-live websocket transport" FORCE)
FetchContent_MakeAvailable(ixwebsocket)

# Find libcurl
find_package(CURL REQUIRED)

# ── Core library (shared: HTTP, Collection, Storage, FieldOps) ────────────────

set(EDGEBASE_CORE_SOURCES
  src/generated/api_core.cpp
  src/http_client.cpp
  src/table_ref.cpp
  src/storage_bucket.cpp
  src/push_client.cpp
  src/edgebase.cpp
  src/database_live_client.cpp
  src/room_client.cpp
)

# Platform-specific push permission implementations
# Use the Objective-C++ iOS implementation only on iOS/tvOS/watchOS (where
# UNUserNotificationCenter is the only way to request push permissions).
# On macOS desktop and all non-Apple platforms, use the default C++ stub —
# macOS does not require runtime push permission requests.
if(APPLE AND CMAKE_SYSTEM_NAME MATCHES "iOS|tvOS|watchOS")
  enable_language(OBJCXX)
  list(APPEND EDGEBASE_CORE_SOURCES src/push_permission_ios.mm)
else()
  list(APPEND EDGEBASE_CORE_SOURCES src/push_permission_default.cpp)
endif()

add_library(edgebase_core STATIC ${EDGEBASE_CORE_SOURCES})

target_include_directories(edgebase_core
  PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${nlohmann_json_SOURCE_DIR}/include
  PRIVATE
    ${CURL_INCLUDE_DIRS}
)

target_link_libraries(edgebase_core
  PRIVATE ${CURL_LIBRARIES}
  PRIVATE ixwebsocket
)

# Link Apple UserNotifications framework for push permission handling (iOS only)
if(APPLE AND CMAKE_SYSTEM_NAME MATCHES "iOS|tvOS|watchOS")
  find_library(USER_NOTIFICATIONS_FRAMEWORK UserNotifications)
  if(USER_NOTIFICATIONS_FRAMEWORK)
    target_link_libraries(edgebase_core PRIVATE ${USER_NOTIFICATIONS_FRAMEWORK})
  endif()
endif()

# ── Tests (only when built standalone, not as subdirectory) ───────────────────

if(CMAKE_CURRENT_SOURCE_DIR STREQUAL CMAKE_SOURCE_DIR)
  # Catch2 is only needed when the core package builds its own test targets.
  FetchContent_Declare(
    Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG        v3.5.3
  )
  FetchContent_MakeAvailable(Catch2)

  enable_testing()
  add_subdirectory(tests)
endif()
