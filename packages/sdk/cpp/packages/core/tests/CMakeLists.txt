cmake_minimum_required(VERSION 3.16)
project(EdgeBaseCoreTests LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT TARGET edgebase_core)
  add_subdirectory(.. ${CMAKE_CURRENT_BINARY_DIR}/edgebase_core_build)
endif()

# ── Google Test ──────────────────────────────────────────────────────────────
if(NOT TARGET GTest::gtest)
  include(FetchContent)

  FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG        v1.14.0
    GIT_SHALLOW    TRUE
  )
  set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(googletest)
endif()

include(GoogleTest)

# ── unit_test ─────────────────────────────────────────────────────────────────
add_executable(unit_test unit_tests.cpp)
target_link_libraries(unit_test PRIVATE edgebase_core GTest::gtest GTest::gtest_main)
target_include_directories(unit_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../include
  ${nlohmann_json_SOURCE_DIR}/include
)
# Link ObjC runtime on Apple (needed for push_permission_ios.mm in edgebase_core)
if(APPLE)
  target_link_libraries(unit_test PRIVATE "-lobjc")
endif()
gtest_discover_tests(unit_test)

# ── e2e_test ──────────────────────────────────────────────────────────────────
add_executable(e2e_test e2e_tests.cpp)
target_link_libraries(e2e_test PRIVATE edgebase_core GTest::gtest GTest::gtest_main)
target_include_directories(e2e_test PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/../include
  ${nlohmann_json_SOURCE_DIR}/include
)
# Link ObjC runtime on Apple (needed for push_permission_ios.mm in edgebase_core)
if(APPLE)
  target_link_libraries(e2e_test PRIVATE "-lobjc")
endif()
gtest_discover_tests(e2e_test)
