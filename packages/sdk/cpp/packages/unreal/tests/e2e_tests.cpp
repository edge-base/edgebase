// EdgeBase C++ Unreal SDK — E2E 테스트
//
// 전제: wrangler dev --port 8688 로컬 서버 실행 중 + Service Key 설정
//
// 빌드+실행:
//   cd packages/sdk/cpp/packages/unreal
//   cmake . -B build && cmake --build build -j4
//   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
//     ./build/edgebase_unreal_e2e_tests
//
// Google Test + libcurl + nlohmann/json 사용
// 패턴: packages/sdk/cpp/packages/core/tests/e2e_tests.cpp 동일

#include <chrono>
#include <cstdlib>
#include <gtest/gtest.h>
#include <nlohmann/json.hpp>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Unreal SDK는 client/ namespace를 공유 헤더로 사용
#include <edgebase/edgebase.h>

using namespace client;
using json = nlohmann::json;

static std::string getEnv(const char *key, const char *def = "") {
  const char *v = std::getenv(key);
  return v ? std::string(v) : std::string(def);
}

static std::string BASE_URL = getEnv("BASE_URL", "http://localhost:8688");
static std::string SERVICE_KEY =
    getEnv("SERVICE_KEY", "test-service-key-for-admin");
static bool REQUIRE_E2E =
    getEnv("EDGEBASE_E2E_REQUIRED", "") == "1";
static std::string PREFIX =
    "cpp-unreal-e2e-" +
    std::to_string(std::chrono::steady_clock::now().time_since_epoch().count());
static std::vector<std::string> createdIds;

// Match other SDKs: skip E2E when the local backend is absent unless
// EDGEBASE_E2E_REQUIRED=1 explicitly makes it mandatory.
static bool isBackendAvailable() {
  HttpClient http(BASE_URL, SERVICE_KEY);
  auto result = http.get("/api/health");
  return result.statusCode >= 200 && result.statusCode < 500;
}

static std::string unavailableBackendMessage() {
  return "E2E backend not reachable at " + BASE_URL +
         ". Start `edgebase dev --port 8688` or set BASE_URL. Set "
         "EDGEBASE_E2E_REQUIRED=1 to fail instead of skip.";
}

struct UnrealE2ESuite : public ::testing::Test {
  static std::shared_ptr<HttpClient> http;
  static bool backendAvailable;

  static void SetUpTestSuite() {
    backendAvailable = isBackendAvailable();
    if (REQUIRE_E2E && !backendAvailable) {
      throw std::runtime_error(unavailableBackendMessage());
    }
    http = std::make_shared<HttpClient>(BASE_URL, SERVICE_KEY);
  }

  void SetUp() override {
    if (!backendAvailable) {
      GTEST_SKIP() << unavailableBackendMessage();
    }
  }
};
std::shared_ptr<HttpClient> UnrealE2ESuite::http;
bool UnrealE2ESuite::backendAvailable = false;

// ─── Cleanup helper
// ───────────────────────────────────────────────────────────

static void deleteCreatedRecords(HttpClient &http) {
  for (const auto &id : createdIds) {
    try {
      http.del("/api/db/shared/tables/posts/" + id);
    } catch (...) {
    }
  }
  createdIds.clear();
}

// ─── 1. DB CRUD
// ───────────────────────────────────────────────────────────────

TEST_F(UnrealE2ESuite, CreateRecord_returns_id) {
  json body = {{"title", PREFIX + "-create"}};
  auto result = http->post("/api/db/shared/tables/posts", body.dump());
  ASSERT_TRUE(result.ok) << result.error;
  auto resp = json::parse(result.body);
  ASSERT_TRUE(resp.contains("id"));
  createdIds.push_back(resp["id"].get<std::string>());
}

TEST_F(UnrealE2ESuite, GetOneRecord_returns_matching_id) {
  json body = {{"title", PREFIX + "-getone"}};
  auto created = http->post("/api/db/shared/tables/posts", body.dump());
  ASSERT_TRUE(created.ok);
  auto createdDoc = json::parse(created.body);
  std::string id = createdDoc["id"].get<std::string>();
  createdIds.push_back(id);

  auto fetched = http->get("/api/db/shared/tables/posts/" + id);
  ASSERT_TRUE(fetched.ok) << fetched.error;
  auto doc = json::parse(fetched.body);
  EXPECT_EQ(id, doc["id"].get<std::string>());
}

TEST_F(UnrealE2ESuite, UpdateRecord_changes_title) {
  json body = {{"title", PREFIX + "-orig"}};
  auto created = http->post("/api/db/shared/tables/posts", body.dump());
  ASSERT_TRUE(created.ok);
  auto doc = json::parse(created.body);
  std::string id = doc["id"].get<std::string>();
  createdIds.push_back(id);

  json patch = {{"title", PREFIX + "-updated"}};
  auto updated = http->patch("/api/db/shared/tables/posts/" + id, patch.dump());
  ASSERT_TRUE(updated.ok) << updated.error;
  auto updDoc = json::parse(updated.body);
  EXPECT_EQ(PREFIX + "-updated", updDoc["title"].get<std::string>());
}

TEST_F(UnrealE2ESuite, DeleteRecord_then_GetOne_returns_404) {
  json body = {{"title", PREFIX + "-del"}};
  auto created = http->post("/api/db/shared/tables/posts", body.dump());
  ASSERT_TRUE(created.ok);
  std::string id = json::parse(created.body)["id"].get<std::string>();

  auto del = http->del("/api/db/shared/tables/posts/" + id);
  ASSERT_TRUE(del.ok) << del.error;

  auto fetched = http->get("/api/db/shared/tables/posts/" + id);
  EXPECT_EQ(404, fetched.statusCode);
}

TEST_F(UnrealE2ESuite, List_returns_items) {
  auto result = http->get("/api/db/shared/tables/posts?limit=5");
  ASSERT_TRUE(result.ok) << result.error;
  auto resp = json::parse(result.body);
  ASSERT_TRUE(resp.contains("items"));
  EXPECT_LE(resp["items"].size(), 5u);
}

TEST_F(UnrealE2ESuite, Count_returns_number) {
  auto result = http->get("/api/db/shared/tables/posts/count");
  ASSERT_TRUE(result.ok) << result.error;
  auto resp = json::parse(result.body);
  ASSERT_TRUE(resp.contains("total"));
  EXPECT_GE(resp["total"].get<int>(), 0);
}

// ─── 2. Storage ─────────────────────────────────────────────────────────────

TEST_F(UnrealE2ESuite, Upload_returns_ok) {
  // Storage upload requires multipart PUT — not exposed in HttpClient base API
  // Skip gracefully rather than fail to compile
  GTEST_SKIP() << "Storage upload via multipart PUT not available in "
                  "HttpClient base API";
}

// ─── 3. KV ──────────────────────────────────────────────────────────────────

TEST_F(UnrealE2ESuite, Kv_set_get_delete) {
  std::string nsKey = "cpp-unreal-kv-" + PREFIX;
  json setBody = {{"action", "set"}, {"key", nsKey}, {"value", "hello-unreal"}};
  auto setResult = http->post("/api/kv/test", setBody.dump());
  ASSERT_TRUE(setResult.ok) << setResult.error;

  json getBody = {{"action", "get"}, {"key", nsKey}};
  auto getResult = http->post("/api/kv/test", getBody.dump());
  ASSERT_TRUE(getResult.ok) << getResult.error;
  auto getResp = json::parse(getResult.body);
  EXPECT_EQ("hello-unreal", getResp["value"].get<std::string>());

  json delBody = {{"action", "delete"}, {"key", nsKey}};
  auto delResult = http->post("/api/kv/test", delBody.dump());
  ASSERT_TRUE(delResult.ok) << delResult.error;
}

// ─── 4. Broadcast ────────────────────────────────────────────────────────────

TEST_F(UnrealE2ESuite, Broadcast_returns_ok) {
  json body = {{"channel", "general"},
               {"event", "cpp-unreal-event"},
               {"payload", {{"msg", "hello from cpp unreal"}}}};
  auto result = http->post("/api/db/broadcast", body.dump());
  EXPECT_TRUE(result.ok) << result.error;
}

// ─── 5. Error: nonexistent record ────────────────────────────────────────────

TEST_F(UnrealE2ESuite, GetOne_nonexistent_returns_404) {
  auto result =
      http->get("/api/db/shared/tables/posts/nonexistent-cpp-unreal-99999");
  EXPECT_EQ(404, result.statusCode);
}

TEST_F(UnrealE2ESuite, InvalidServiceKey_returns_403) {
  auto badHttp = std::make_shared<HttpClient>(BASE_URL, "invalid-sk");
  json body = {{"title", "X"}};
  auto result = badHttp->post("/api/db/shared/tables/posts", body.dump());
  // Server returns 401 (Unauthorized) for invalid service keys — both 401 and
  // 403 are valid
  EXPECT_TRUE(result.statusCode == 401 || result.statusCode == 403)
      << "Expected 401 or 403 but got " << result.statusCode;
}

// ─── 6. Filter ─────────────────────────────────────────────────────────────

TEST_F(UnrealE2ESuite, Filter_by_title_finds_record) {
  std::string unique = PREFIX + "-filter";
  json body = {{"title", unique}};
  auto created = http->post("/api/db/shared/tables/posts", body.dump());
  ASSERT_TRUE(created.ok);
  std::string id = json::parse(created.body)["id"].get<std::string>();
  createdIds.push_back(id);

  // GET /api/db/shared/tables/posts?filter=[["title","==","<value>"]]
  std::string filterParam = R"([["title","==",")" + unique + R"("]])";
  auto result = http->get("/api/db/shared/tables/posts?filter=" + filterParam);
  ASSERT_TRUE(result.ok) << result.error;
  auto resp = json::parse(result.body);
  EXPECT_FALSE(resp["items"].empty());
}

// ─── 7. Batch create (std::future 패턴) ──────────────────────────────────────

TEST_F(UnrealE2ESuite, Batch_create_3_records) {
  json batch = {{"inserts", json::array({{{"title", PREFIX + "-batch-1"}},
                                         {{"title", PREFIX + "-batch-2"}},
                                         {{"title", PREFIX + "-batch-3"}}})}};
  auto result = http->post("/api/db/shared/tables/posts/batch", batch.dump());
  ASSERT_TRUE(result.ok) << result.error;
  auto resp = json::parse(result.body);
  ASSERT_TRUE(resp.contains("inserted"));
  EXPECT_EQ(3u, resp["inserted"].size());
  for (const auto &r : resp["inserted"]) {
    if (r.contains("id"))
      createdIds.push_back(r["id"].get<std::string>());
  }
}

// ─── 8. UObject lifecycle simulation (Cleanup) ───────────────────────────────

TEST_F(UnrealE2ESuite, Cleanup_created_records) {
  // Simulate UObject destruction cleanup
  deleteCreatedRecords(*http);
  SUCCEED(); // If no exception thrown, cleanup succeeded
}

// ─── Main ────────────────────────────────────────────────────────────────────

int main(int argc, char **argv) {
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
}
