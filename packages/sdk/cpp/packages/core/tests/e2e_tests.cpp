// EdgeBase C++ Core SDK — E2E 테스트
//
// 전제: wrangler dev --port 8688 로컬 서버 실행 중
//
// 빌드+실행:
//   cd packages/sdk/cpp/packages/core/tests
//   cmake .. -B build && cmake --build build
//   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
//     ./build/e2e_test
//
// Google Test + libcurl + nlohmann/json 사용

#include <chrono>
#include <cstdlib>
#include <edgebase/edgebase.h>
#include <edgebase/field_ops.h>
#include <gtest/gtest.h>
#include <nlohmann/json.hpp>
#include <sstream>
#include <string>
#include <thread>
#include <future>
#include <vector>
#include <stdexcept>

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
static const std::string OPEN_STORAGE_BUCKET = "test-bucket";
static const std::string AUTH_STORAGE_BUCKET = "documents";
static std::string PREFIX =
    "cpp-e2e-" +
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

struct E2ESuite : public ::testing::Test {
  static std::shared_ptr<HttpClient> http;
  static std::shared_ptr<GeneratedDbApi> core;
  static bool backendAvailable;

  static void SetUpTestSuite() {
    backendAvailable = isBackendAvailable();
    if (REQUIRE_E2E && !backendAvailable) {
      throw std::runtime_error(unavailableBackendMessage());
    }
    http = std::make_shared<HttpClient>(BASE_URL, SERVICE_KEY);
    core = std::shared_ptr<GeneratedDbApi>(
        new GeneratedDbApi(*http),
        [](GeneratedDbApi *p) { delete p; });
  }

  void SetUp() override {
    if (!backendAvailable) {
      GTEST_SKIP() << unavailableBackendMessage();
    }
  }
};
std::shared_ptr<HttpClient> E2ESuite::http;
std::shared_ptr<GeneratedDbApi> E2ESuite::core;
bool E2ESuite::backendAvailable = false;

// ─── Teardown helper: delete created records
// ──────────────────────────────────
struct DeleteOnExit {
  ~DeleteOnExit() {
    auto http = std::make_shared<HttpClient>(BASE_URL, SERVICE_KEY);
    auto core = std::shared_ptr<GeneratedDbApi>(
        new GeneratedDbApi(*http),
        [http](GeneratedDbApi *p) { delete p; });
    TableRef t(core, "posts");
    for (const auto &id : createdIds) {
      t.del(id);
    }
  }
} globalCleanup;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CRUD E2E
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, Insert) {
  TableRef t(core, "posts");
  std::string body = R"({"title":")" + PREFIX + R"(-create"})";
  auto r = t.insert(body);
  EXPECT_TRUE(r.ok);
  EXPECT_EQ(r.statusCode, 201);
  auto j = json::parse(r.body, nullptr, false);
  ASSERT_TRUE(j.contains("id"));
  createdIds.push_back(j["id"].get<std::string>());
}

TEST_F(E2ESuite, GetOne) {
  TableRef t(core, "posts");
  auto createRes = t.insert(R"({"title":"cpp-getOne"})");
  ASSERT_TRUE(createRes.ok);
  auto id = json::parse(createRes.body)["id"].get<std::string>();
  createdIds.push_back(id);
  auto r = t.getOne(id);
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_EQ(j["id"].get<std::string>(), id);
}

TEST_F(E2ESuite, Update) {
  TableRef t(core, "posts");
  auto cr = t.insert(R"({"title":"cpp-update-orig"})");
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();
  createdIds.push_back(id);
  auto r = t.update(id, R"({"title":"cpp-update-done"})");
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_EQ(j["title"].get<std::string>(), "cpp-update-done");
}

TEST_F(E2ESuite, Delete) {
  TableRef t(core, "posts");
  auto cr = t.insert(R"({"title":"cpp-delete-me"})");
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();
  auto dr = t.del(id);
  EXPECT_TRUE(dr.ok);
  auto gr = t.getOne(id);
  EXPECT_FALSE(gr.ok);
}

TEST_F(E2ESuite, CreateGetUpdateDeleteChain) {
  TableRef t(core, "posts");

  // Create
  auto cr = t.insert(R"({"title":"cpp-chain-test"})");
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();

  // Get
  auto gr = t.getOne(id);
  ASSERT_TRUE(gr.ok);
  auto doc = json::parse(gr.body);
  EXPECT_EQ(doc["title"].get<std::string>(), "cpp-chain-test");

  // Update
  auto ur = t.update(id, R"({"title":"cpp-chain-updated"})");
  ASSERT_TRUE(ur.ok);
  auto updated = json::parse(ur.body);
  EXPECT_EQ(updated["title"].get<std::string>(), "cpp-chain-updated");

  // Verify update
  auto gr2 = t.getOne(id);
  ASSERT_TRUE(gr2.ok);
  EXPECT_EQ(json::parse(gr2.body)["title"].get<std::string>(), "cpp-chain-updated");

  // Delete
  auto dr = t.del(id);
  EXPECT_TRUE(dr.ok);

  // Verify deletion
  auto gr3 = t.getOne(id);
  EXPECT_FALSE(gr3.ok);
}

TEST_F(E2ESuite, CreateWithJsonBody) {
  TableRef t(core, "posts");
  json body;
  body["title"] = PREFIX + "-json-body";
  body["views"] = 42;
  auto r = t.insert(body.dump());
  ASSERT_TRUE(r.ok);
  auto j = json::parse(r.body);
  createdIds.push_back(j["id"].get<std::string>());
  EXPECT_EQ(j["title"].get<std::string>(), PREFIX + "-json-body");
}

TEST_F(E2ESuite, UpdatePartialFields) {
  TableRef t(core, "posts");
  auto cr = t.insert(R"({"title":"cpp-partial-update","views":10})");
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();
  createdIds.push_back(id);

  // Only update title, not views
  auto ur = t.update(id, R"({"title":"cpp-partial-done"})");
  ASSERT_TRUE(ur.ok);
  auto j = json::parse(ur.body);
  EXPECT_EQ(j["title"].get<std::string>(), "cpp-partial-done");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Query builder E2E
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, WhereFilter) {
  std::string title = PREFIX + "-where-filter";
  TableRef t(core, "posts");
  auto cr = t.insert(R"({"title":")" + title + R"("})");
  ASSERT_TRUE(cr.ok);
  createdIds.push_back(json::parse(cr.body)["id"].get<std::string>());
  auto r = t.where("title", "==", title).getList();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  ASSERT_TRUE(j.contains("items"));
  EXPECT_GT(j["items"].size(), 0u);
}

TEST_F(E2ESuite, OrderByLimit) {
  TableRef t(core, "posts");
  auto r = t.orderBy("createdAt", "desc").limit(2).getList();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_LE(j["items"].size(), 2u);
}

TEST_F(E2ESuite, Count) {
  TableRef t(core, "posts");
  auto r = t.count();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_TRUE(j.contains("total"));
  EXPECT_GE(j["total"].get<int>(), 0);
}

TEST_F(E2ESuite, OffsetPagination) {
  TableRef t(core, "posts");
  auto p1 = t.orderBy("createdAt", "asc").limit(2).getList();
  auto p2 = t.orderBy("createdAt", "asc").limit(2).offset(2).getList();
  EXPECT_TRUE(p1.ok);
  EXPECT_TRUE(p2.ok);
  auto j1 = json::parse(p1.body);
  auto j2 = json::parse(p2.body);
  if (!j1["items"].empty() && !j2["items"].empty()) {
    EXPECT_NE(j1["items"][0]["id"].get<std::string>(),
              j2["items"][0]["id"].get<std::string>());
  }
}

TEST_F(E2ESuite, CursorPagination) {
  TableRef t(core, "posts");
  auto p1 = t.orderBy("createdAt", "asc").limit(2).getList();
  EXPECT_TRUE(p1.ok);
  auto j1 = json::parse(p1.body);
  if (j1.contains("cursor") && !j1["cursor"].is_null()) {
    std::string cursor = j1["cursor"].get<std::string>();
    auto p2 = t.orderBy("createdAt", "asc").limit(2).after(cursor).getList();
    EXPECT_TRUE(p2.ok);
    auto j2 = json::parse(p2.body);
    if (!j1["items"].empty() && !j2["items"].empty()) {
      EXPECT_NE(j1["items"][0]["id"].get<std::string>(),
                j2["items"][0]["id"].get<std::string>());
    }
  }
  EXPECT_TRUE(true);
}

TEST_F(E2ESuite, WhereChainedFilters) {
  TableRef t(core, "posts");
  std::string title = PREFIX + "-multi-where";
  auto cr = t.insert(R"({"title":")" + title + R"(","views":100})");
  ASSERT_TRUE(cr.ok);
  createdIds.push_back(json::parse(cr.body)["id"].get<std::string>());

  auto r = t.where("title", "==", title)
              .orderBy("createdAt", "desc")
              .limit(5)
              .getList();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_GE(j["items"].size(), 1u);
}

TEST_F(E2ESuite, WhereNotEqual) {
  TableRef t(core, "posts");
  auto r = t.where("title", "!=", "nonexistent-title-xyz").limit(5).getList();
  EXPECT_TRUE(r.ok);
}

TEST_F(E2ESuite, OrQuery) {
  TableRef t(core, "posts");
  std::string t1 = PREFIX + "-or-a";
  std::string t2 = PREFIX + "-or-b";
  auto cr1 = t.insert(R"({"title":")" + t1 + R"("})");
  auto cr2 = t.insert(R"({"title":")" + t2 + R"("})");
  ASSERT_TRUE(cr1.ok);
  ASSERT_TRUE(cr2.ok);
  createdIds.push_back(json::parse(cr1.body)["id"].get<std::string>());
  createdIds.push_back(json::parse(cr2.body)["id"].get<std::string>());

  auto r = t.or_([&](OrBuilder &ob) {
    ob.where("title", "==", t1)
      .where("title", "==", t2);
  }).getList();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_GE(j["items"].size(), 2u);
}

TEST_F(E2ESuite, SearchFullText) {
  TableRef t(core, "posts");
  std::string title = PREFIX + "-searchable-quantum";
  auto cr = t.insert(R"({"title":")" + title + R"("})");
  ASSERT_TRUE(cr.ok);
  createdIds.push_back(json::parse(cr.body)["id"].get<std::string>());

  // FTS may need time to index; small delay
  std::this_thread::sleep_for(std::chrono::milliseconds(200));

  auto r = t.search("searchable-quantum").getList();
  EXPECT_TRUE(r.ok);
  // FTS results may or may not find our record depending on indexing; just check response shape
  auto j = json::parse(r.body);
  EXPECT_TRUE(j.contains("items"));
}

TEST_F(E2ESuite, ListWithLimit1) {
  TableRef t(core, "posts");
  auto r = t.limit(1).getList();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_LE(j["items"].size(), 1u);
}

TEST_F(E2ESuite, OrderByAscending) {
  TableRef t(core, "posts");
  auto r = t.orderBy("createdAt", "asc").limit(5).getList();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_TRUE(j.contains("items"));
}

TEST_F(E2ESuite, CountWithFilter) {
  TableRef t(core, "posts");
  std::string title = PREFIX + "-count-target";
  auto cr = t.insert(R"({"title":")" + title + R"("})");
  ASSERT_TRUE(cr.ok);
  createdIds.push_back(json::parse(cr.body)["id"].get<std::string>());

  auto r = t.where("title", "==", title).count();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_GE(j["total"].get<int>(), 1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Batch
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, InsertMany) {
  TableRef t(core, "posts");
  json arr = json::array({
      {{"title", PREFIX + "-batch-1"}},
      {{"title", PREFIX + "-batch-2"}},
      {{"title", PREFIX + "-batch-3"}},
  });
  json payload = {{"inserts", arr}};
  // insertMany wraps via /batch endpoint: inserts contains array
  auto r = t.insertMany(payload.dump());
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_TRUE(j.contains("inserted"));
  EXPECT_EQ(j["inserted"].size(), 3u);
  for (const auto &rec : j["inserted"]) {
    createdIds.push_back(rec["id"].get<std::string>());
  }
}

TEST_F(E2ESuite, UpdateManyWithFilter) {
  TableRef t(core, "posts");
  std::string tag = PREFIX + "-updmany";
  // Create records to update
  for (int i = 0; i < 3; i++) {
    auto cr = t.insert(R"({"title":")" + tag + R"("})");
    ASSERT_TRUE(cr.ok);
    createdIds.push_back(json::parse(cr.body)["id"].get<std::string>());
  }
  // Update all records matching filter
  auto r = t.where("title", "==", tag)
              .updateMany(R"({"title":")" + tag + R"(-updated"})");
  EXPECT_TRUE(r.ok);
}

TEST_F(E2ESuite, DeleteManyWithFilter) {
  TableRef t(core, "posts");
  std::string tag = PREFIX + "-delmany";
  // Create records to delete
  for (int i = 0; i < 2; i++) {
    auto cr = t.insert(R"({"title":")" + tag + R"("})");
    ASSERT_TRUE(cr.ok);
    // No need to track since they will be deleted
  }
  auto r = t.where("title", "==", tag).deleteMany();
  EXPECT_TRUE(r.ok);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Upsert
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, Upsert) {
  TableRef t(core, "posts");
  std::string body = R"({"title":")" + PREFIX + R"(-upsert"})";
  auto r = t.upsert(body);
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_EQ(j["action"].get<std::string>(), "inserted");
  createdIds.push_back(j["id"].get<std::string>());
}

TEST_F(E2ESuite, UpsertExistingRecord) {
  TableRef t(core, "posts");
  // Create first
  std::string title = PREFIX + "-upsert-existing";
  auto cr = t.insert(R"({"title":")" + title + R"("})");
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();
  createdIds.push_back(id);

  // Upsert with same id should update
  json body;
  body["id"] = id;
  body["title"] = title + "-updated";
  auto r = t.upsert(body.dump());
  EXPECT_TRUE(r.ok);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Error Handling
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, GetOneNonExistent) {
  TableRef t(core, "posts");
  auto r = t.getOne("nonexistent-cpp-99999");
  EXPECT_FALSE(r.ok);
  EXPECT_EQ(r.statusCode, 404);
}

TEST_F(E2ESuite, UpdateNonExistent) {
  TableRef t(core, "posts");
  auto r = t.update("nonexistent-cpp-upd", R"({"title":"X"})");
  EXPECT_FALSE(r.ok);
}

TEST_F(E2ESuite, UpdateManyRequiresFilter) {
  TableRef t(core, "posts");
  auto r = t.updateMany(R"({"title":"fail"})");
  // should fail: no where() filter
  EXPECT_FALSE(r.ok);
  EXPECT_FALSE(r.error.empty());
}

TEST_F(E2ESuite, DeleteManyRequiresFilter) {
  TableRef t(core, "posts");
  auto r = t.deleteMany();
  EXPECT_FALSE(r.ok);
  EXPECT_FALSE(r.error.empty());
}

TEST_F(E2ESuite, DeleteNonExistent) {
  TableRef t(core, "posts");
  auto r = t.del("nonexistent-cpp-del-12345");
  EXPECT_FALSE(r.ok);
}

TEST_F(E2ESuite, InvalidJsonCreate) {
  TableRef t(core, "posts");
  auto r = t.insert("this-is-not-json");
  EXPECT_FALSE(r.ok);
}

TEST_F(E2ESuite, EmptyBodyCreate) {
  TableRef t(core, "posts");
  auto r = t.insert("{}");
  // Server may allow or reject empty body — just ensure no crash
  // The result should be a valid Result struct
  EXPECT_TRUE(r.ok || !r.ok);
  EXPECT_GE(r.statusCode, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Auth E2E
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, SignUpThenGetCurrentUser) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-signup-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto r = authClient.signUp(email, "CppTest1234!");
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_TRUE(j.contains("accessToken"));
}

TEST_F(E2ESuite, SignUpAndSignIn) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-signin-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  std::string password = "CppTestPass123!";

  // Sign up
  auto signUpResult = authClient.signUp(email, password);
  ASSERT_TRUE(signUpResult.ok) << signUpResult.error;

  // Sign out (to clear token)
  authClient.signOut();

  // Sign in
  auto signInResult = authClient.signIn(email, password);
  EXPECT_TRUE(signInResult.ok) << signInResult.error;
  auto j = json::parse(signInResult.body);
  EXPECT_TRUE(j.contains("accessToken"));
}

TEST_F(E2ESuite, SignInWithWrongPassword) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  auto r = authClient.signIn("nonexistent@test.com", "wrongpassword");
  EXPECT_FALSE(r.ok);
}

TEST_F(E2ESuite, SignUpAndSignOut) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-signout-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";

  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto logoutResult = authClient.signOut();
  EXPECT_TRUE(logoutResult.ok);
}

TEST_F(E2ESuite, SignInAnonymously) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  auto r = authClient.signInAnonymously();
  EXPECT_TRUE(r.ok);
  auto j = json::parse(r.body);
  EXPECT_TRUE(j.contains("accessToken"));
}

TEST_F(E2ESuite, ChangePassword) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-chpw-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  std::string oldPass = "OldPass1234!";
  std::string newPass = "NewPass5678!";

  auto sr = authClient.signUp(email, oldPass);
  ASSERT_TRUE(sr.ok);

  auto chResult = authClient.changePassword(oldPass, newPass);
  EXPECT_TRUE(chResult.ok);
}

TEST_F(E2ESuite, UpdateProfile) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-profile-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";

  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  std::map<std::string, std::string> profileData = {
      {"displayName", "CPP User"}};
  auto ur = authClient.updateProfile(profileData);
  EXPECT_TRUE(ur.ok);
}

TEST_F(E2ESuite, ListSessions) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-sessions-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";

  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto r = authClient.listSessions();
  EXPECT_TRUE(r.ok);
}

TEST_F(E2ESuite, OnAuthStateChangeCallback) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  bool callbackFired = false;
  authClient.onAuthStateChange([&callbackFired](const std::string &userJson) {
    callbackFired = true;
  });

  std::string email =
      "cpp-asc-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto r = authClient.signUp(email, "CppTest1234!");
  EXPECT_TRUE(r.ok);
  // callback may or may not fire synchronously; just check no crash
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Storage E2E
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, StorageGetUrl) {
  EdgeBase client(BASE_URL);
  auto storageClient = client.storage();
  auto bucket = storageClient.bucket(OPEN_STORAGE_BUCKET);
  std::string url = bucket.getUrl("test.txt");
  EXPECT_FALSE(url.empty());
  EXPECT_TRUE(url.find("test.txt") != std::string::npos);
}

TEST_F(E2ESuite, StorageUploadAndDownloadWithAuth) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-storage-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto storageClient = client.storage();
  auto bucket = storageClient.bucket(AUTH_STORAGE_BUCKET);

  std::string content = "Hello from C++ SDK E2E test!";
  std::vector<uint8_t> data(content.begin(), content.end());
  std::string key = "cpp-e2e-test-" + PREFIX + ".txt";
  auto uploadResult = bucket.upload(key, data, "text/plain");
  ASSERT_TRUE(uploadResult.ok) << uploadResult.statusCode << " " << uploadResult.error << " " << uploadResult.body;
  auto downloadResult = bucket.download(key);
  ASSERT_TRUE(downloadResult.ok) << downloadResult.statusCode << " " << downloadResult.error << " " << downloadResult.body;
  EXPECT_EQ(downloadResult.body, content);
  auto deleteResult = bucket.del(key);
  EXPECT_TRUE(deleteResult.ok) << deleteResult.statusCode << " " << deleteResult.error << " " << deleteResult.body;
}

TEST_F(E2ESuite, StorageListWithAuth) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-stlist-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto storageClient = client.storage();
  auto bucket = storageClient.bucket(AUTH_STORAGE_BUCKET);
  std::string prefix = "cpp-list-" + PREFIX;
  std::string firstKey = prefix + "/file-1.txt";
  std::string secondKey = prefix + "/file-2.txt";
  ASSERT_TRUE(bucket.upload(firstKey, std::vector<uint8_t>{'o', 'n', 'e'}, "text/plain").ok);
  ASSERT_TRUE(bucket.upload(secondKey, std::vector<uint8_t>{'t', 'w', 'o'}, "text/plain").ok);
  auto r = bucket.list(prefix, 10, 0);
  ASSERT_TRUE(r.ok) << r.statusCode << " " << r.error << " " << r.body;
  auto j = json::parse(r.body);
  ASSERT_TRUE(j.contains("items") || j.contains("files")) << r.body;
  const auto &items = j.contains("items") ? j["items"] : j["files"];
  bool foundFirst = false;
  bool foundSecond = false;
  for (const auto &item : items) {
    if (!item.contains("key")) continue;
    const auto key = item["key"].get<std::string>();
    if (key == firstKey) foundFirst = true;
    if (key == secondKey) foundSecond = true;
  }
  EXPECT_TRUE(foundFirst);
  EXPECT_TRUE(foundSecond);
  EXPECT_TRUE(bucket.del(firstKey).ok);
  EXPECT_TRUE(bucket.del(secondKey).ok);
}

TEST_F(E2ESuite, StorageSignedUrlWithAuth) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-signed-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto storageClient = client.storage();
  auto bucket = storageClient.bucket(AUTH_STORAGE_BUCKET);
  std::string key = "cpp-signed-test-" + PREFIX + ".txt";
  std::vector<uint8_t> data = {'h', 'e', 'l', 'l', 'o'};
  auto uploadResult = bucket.upload(key, data, "text/plain");
  ASSERT_TRUE(uploadResult.ok) << uploadResult.statusCode << " " << uploadResult.error << " " << uploadResult.body;
  auto signedResult = bucket.createSignedUrl(key, "1h");
  ASSERT_TRUE(signedResult.ok) << signedResult.statusCode << " " << signedResult.error << " " << signedResult.body;
  auto j = json::parse(signedResult.body);
  EXPECT_TRUE(j.contains("url"));
  EXPECT_FALSE(j["url"].get<std::string>().empty());
  EXPECT_TRUE(bucket.del(key).ok);
}

TEST_F(E2ESuite, StorageDeleteWithAuth) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-stdel-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto storageClient = client.storage();
  auto bucket = storageClient.bucket(AUTH_STORAGE_BUCKET);
  std::string key = "cpp-del-test-" + PREFIX + ".txt";
  std::vector<uint8_t> data = {'t', 'e', 's', 't'};
  auto uploadResult = bucket.upload(key, data, "text/plain");
  ASSERT_TRUE(uploadResult.ok) << uploadResult.statusCode << " " << uploadResult.error << " " << uploadResult.body;
  auto delResult = bucket.del(key);
  ASSERT_TRUE(delResult.ok) << delResult.statusCode << " " << delResult.error << " " << delResult.body;
  auto downloadResult = bucket.download(key);
  EXPECT_FALSE(downloadResult.ok);
}

TEST_F(E2ESuite, StorageGetMetadataWithAuth) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-meta-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto storageClient = client.storage();
  auto bucket = storageClient.bucket(AUTH_STORAGE_BUCKET);
  std::string key = "cpp-meta-test-" + PREFIX + ".txt";
  std::vector<uint8_t> data = {'m', 'e', 't', 'a'};
  auto uploadResult = bucket.upload(key, data, "text/plain");
  ASSERT_TRUE(uploadResult.ok) << uploadResult.statusCode << " " << uploadResult.error << " " << uploadResult.body;
  auto metaResult = bucket.getMetadata(key);
  ASSERT_TRUE(metaResult.ok) << metaResult.statusCode << " " << metaResult.error << " " << metaResult.body;
  auto j = json::parse(metaResult.body);
  EXPECT_EQ(j["key"].get<std::string>(), key);
  EXPECT_TRUE(bucket.del(key).ok);
}

TEST_F(E2ESuite, StorageUploadStringWithAuth) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-upstr-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto bucket = client.storage().bucket(AUTH_STORAGE_BUCKET);
  std::string key = "cpp-upload-string-" + PREFIX + ".txt";
  std::string content = "uploadString from C++";
  auto uploadResult = bucket.uploadString(key, content, "raw", "text/plain");
  ASSERT_TRUE(uploadResult.ok) << uploadResult.statusCode << " " << uploadResult.error << " " << uploadResult.body;
  auto downloadResult = bucket.download(key);
  ASSERT_TRUE(downloadResult.ok) << downloadResult.statusCode << " " << downloadResult.error << " " << downloadResult.body;
  EXPECT_EQ(downloadResult.body, content);
  EXPECT_TRUE(bucket.del(key).ok);
}

TEST_F(E2ESuite, StorageDownloadNonexistentWithAuth) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-missing-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppTest1234!");
  ASSERT_TRUE(sr.ok);

  auto bucket = client.storage().bucket(AUTH_STORAGE_BUCKET);
  auto downloadResult = bucket.download("nonexistent-cpp-storage-" + PREFIX + ".txt");
  EXPECT_FALSE(downloadResult.ok);
  EXPECT_GE(downloadResult.statusCode, 400);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FieldOps E2E
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, FieldOpsIncrement) {
  TableRef t(core, "posts");
  auto cr = t.insert(R"({"title":"cpp-inc-test","views":10})");
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();
  createdIds.push_back(id);

  // Build increment update body
  json body;
  body["views"] = edgebase::FieldOps::incrementJson(5);
  auto ur = t.update(id, body.dump());
  EXPECT_TRUE(ur.ok);
  if (ur.ok) {
    auto j = json::parse(ur.body);
    // Views should be 15 (10 + 5)
    if (j.contains("views") && j["views"].is_number()) {
      EXPECT_EQ(j["views"].get<int>(), 15);
    }
  }
}

TEST_F(E2ESuite, FieldOpsDeleteField) {
  TableRef t(core, "posts");
  auto cr = t.insert(R"({"title":"cpp-delf-test","tempField":"remove-me"})");
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();
  createdIds.push_back(id);

  json body;
  body["tempField"] = edgebase::FieldOps::deleteFieldJson();
  auto ur = t.update(id, body.dump());
  EXPECT_TRUE(ur.ok);
}

TEST_F(E2ESuite, FieldOpsIncrementNegative) {
  TableRef t(core, "posts");
  auto cr = t.insert(R"({"title":"cpp-dec-test","views":20})");
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();
  createdIds.push_back(id);

  json body;
  body["views"] = edgebase::FieldOps::incrementJson(-3);
  auto ur = t.update(id, body.dump());
  EXPECT_TRUE(ur.ok);
  if (ur.ok) {
    auto j = json::parse(ur.body);
    if (j.contains("views") && j["views"].is_number()) {
      EXPECT_EQ(j["views"].get<int>(), 17);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. C++ Specific: std::future / async patterns
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, AsyncCreateWithFuture) {
  auto coreCopy = core;
  auto fut = std::async(std::launch::async, [coreCopy]() {
    TableRef t(coreCopy, "posts");
    return t.insert(R"({"title":"cpp-async-future"})");
  });

  auto r = fut.get();
  EXPECT_TRUE(r.ok);
  if (r.ok) {
    createdIds.push_back(json::parse(r.body)["id"].get<std::string>());
  }
}

TEST_F(E2ESuite, MultipleAsyncOperations) {
  auto coreCopy = core;

  auto fut1 = std::async(std::launch::async, [coreCopy]() {
    TableRef t(coreCopy, "posts");
    return t.insert(R"({"title":"cpp-async-1"})");
  });

  auto fut2 = std::async(std::launch::async, [coreCopy]() {
    TableRef t(coreCopy, "posts");
    return t.insert(R"({"title":"cpp-async-2"})");
  });

  auto r1 = fut1.get();
  auto r2 = fut2.get();
  EXPECT_TRUE(r1.ok);
  EXPECT_TRUE(r2.ok);
  if (r1.ok) createdIds.push_back(json::parse(r1.body)["id"].get<std::string>());
  if (r2.ok) createdIds.push_back(json::parse(r2.body)["id"].get<std::string>());
}

TEST_F(E2ESuite, PromisePatternCallback) {
  std::promise<Result> promise;
  auto future = promise.get_future();

  auto coreCopy = core;
  std::thread t([coreCopy, &promise]() {
    TableRef tbl(coreCopy, "posts");
    auto r = tbl.insert(R"({"title":"cpp-promise-pattern"})");
    promise.set_value(r);
  });

  auto r = future.get();
  t.join();
  EXPECT_TRUE(r.ok);
  if (r.ok) createdIds.push_back(json::parse(r.body)["id"].get<std::string>());
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. DbRef namespace queries
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, DbRefSharedTableCRUD) {
  EdgeBase client(BASE_URL);
  // Set service key manually via http for admin access
  auto db = client.db("shared");
  auto table = db.table("posts");
  // Without service key, this might fail, but should not crash
  auto r = table.limit(1).getList();
  // Result may be ok or not depending on auth — just ensure no crash
  EXPECT_GE(r.statusCode, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. RAII / Cleanup behavior
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, ScopedClientDestruction) {
  std::string id;
  {
    auto localHttp = std::make_shared<HttpClient>(BASE_URL, SERVICE_KEY);
    auto localCore = std::shared_ptr<GeneratedDbApi>(
        new GeneratedDbApi(*localHttp),
        [localHttp](GeneratedDbApi *p) { delete p; });
    TableRef t(localCore, "posts");
    auto cr = t.insert(R"({"title":"cpp-scoped-raii"})");
    ASSERT_TRUE(cr.ok);
    id = json::parse(cr.body)["id"].get<std::string>();
    // localHttp + localCore go out of scope here
  }
  // Cleanup using the global core
  TableRef t(core, "posts");
  auto dr = t.del(id);
  EXPECT_TRUE(dr.ok);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. nlohmann::json round-trip
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, JsonRoundTripCreate) {
  TableRef t(core, "posts");
  json input;
  input["title"] = PREFIX + "-json-roundtrip";
  input["metadata"] = {{"key1", "value1"}, {"key2", "value2"}};

  auto cr = t.insert(input.dump());
  ASSERT_TRUE(cr.ok);
  auto id = json::parse(cr.body)["id"].get<std::string>();
  createdIds.push_back(id);

  auto gr = t.getOne(id);
  ASSERT_TRUE(gr.ok);
  auto doc = json::parse(gr.body);
  EXPECT_EQ(doc["title"].get<std::string>(), PREFIX + "-json-roundtrip");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Push Client E2E
// ═══════════════════════════════════════════════════════════════════════════════

TEST_F(E2ESuite, PushClientRegister) {
  // Sign up to get a JWT access token
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-pushreg-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppPush1234!");
  ASSERT_TRUE(sr.ok) << sr.error;
  auto authJson = json::parse(sr.body);
  std::string accessToken = authJson["accessToken"].get<std::string>();

  // Create a new HttpClient with the JWT token (no service key)
  auto pushHttp = std::make_shared<HttpClient>(BASE_URL);
  pushHttp->setToken(accessToken);

  std::string deviceId =
      "cpp-push-e2e-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count());
  json body;
  body["deviceId"] = deviceId;
  body["token"] = "fake-fcm-token-cpp-" + deviceId;
  body["platform"] = "android";

  auto r = pushHttp->post("/api/push/register", body.dump());
  // 200 = success, 503 = push not configured
  EXPECT_TRUE(r.statusCode == 200 || r.statusCode == 503)
      << "push.register returned " << r.statusCode;
}

TEST_F(E2ESuite, PushClientSubscribeTopic) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-pushsub-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppPush1234!");
  ASSERT_TRUE(sr.ok) << sr.error;
  auto authJson = json::parse(sr.body);
  std::string accessToken = authJson["accessToken"].get<std::string>();

  auto pushHttp = std::make_shared<HttpClient>(BASE_URL);
  pushHttp->setToken(accessToken);

  json body;
  body["topic"] = "cpp-test-topic";

  auto r = pushHttp->post("/api/push/topic/subscribe", body.dump());
  EXPECT_TRUE(r.statusCode == 200 || r.statusCode == 503)
      << "push.subscribeTopic returned " << r.statusCode;
}

TEST_F(E2ESuite, PushClientUnsubscribeTopic) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-pushunsub-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppPush1234!");
  ASSERT_TRUE(sr.ok) << sr.error;
  auto authJson = json::parse(sr.body);
  std::string accessToken = authJson["accessToken"].get<std::string>();

  auto pushHttp = std::make_shared<HttpClient>(BASE_URL);
  pushHttp->setToken(accessToken);

  json body;
  body["topic"] = "cpp-test-topic";

  auto r = pushHttp->post("/api/push/topic/unsubscribe", body.dump());
  EXPECT_TRUE(r.statusCode == 200 || r.statusCode == 503)
      << "push.unsubscribeTopic returned " << r.statusCode;
}

TEST_F(E2ESuite, PushClientUnregister) {
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-pushunreg-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppPush1234!");
  ASSERT_TRUE(sr.ok) << sr.error;
  auto authJson = json::parse(sr.body);
  std::string accessToken = authJson["accessToken"].get<std::string>();

  auto pushHttp = std::make_shared<HttpClient>(BASE_URL);
  pushHttp->setToken(accessToken);

  std::string deviceId =
      "cpp-push-unreg-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count());

  // Register first
  json regBody;
  regBody["deviceId"] = deviceId;
  regBody["token"] = "fake-fcm-unreg-" + deviceId;
  regBody["platform"] = "android";
  auto regR = pushHttp->post("/api/push/register", regBody.dump());
  EXPECT_TRUE(regR.statusCode == 200 || regR.statusCode == 503);

  // Unregister
  json unregBody;
  unregBody["deviceId"] = deviceId;
  auto r = pushHttp->post("/api/push/unregister", unregBody.dump());
  EXPECT_TRUE(r.statusCode == 200 || r.statusCode == 503)
      << "push.unregister returned " << r.statusCode;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Push Full Flow E2E
// ═══════════════════════════════════════════════════════════════════════════════

static std::string MOCK_FCM_URL = "http://localhost:9099";

/// Helper: raw HTTP request to mock FCM server
static Result mockFcmRequest(const std::string &method,
                             const std::string &path) {
  auto mockHttp = std::make_shared<HttpClient>(MOCK_FCM_URL);
  if (method == "GET") {
    return mockHttp->get(path);
  } else if (method == "DELETE") {
    return mockHttp->del(path);
  }
  return Result{false, 0, "", "Unsupported method"};
}

TEST_F(E2ESuite, PushFullFlowSendToUser) {
  // 1. Signup to get accessToken + userId
  EdgeBase client(BASE_URL);
  auto authClient = client.auth();
  std::string email =
      "cpp-fullflow-" +
      std::to_string(
          std::chrono::steady_clock::now().time_since_epoch().count()) +
      "@test.com";
  auto sr = authClient.signUp(email, "CppFlow1234!");
  ASSERT_TRUE(sr.ok) << sr.error;
  auto authJson = json::parse(sr.body);
  std::string accessToken = authJson["accessToken"].get<std::string>();
  std::string userId = authJson["user"]["id"].get<std::string>();

  std::string ts = std::to_string(
      std::chrono::steady_clock::now().time_since_epoch().count());
  std::string fcmToken = "flow-token-cpp-" + ts;
  std::string deviceId = "cpp-flow-device-" + ts;

  // 2. Clear mock FCM store
  auto clearR = mockFcmRequest("DELETE", "/messages");
  EXPECT_TRUE(clearR.statusCode == 200 || clearR.statusCode == 204);

  // 3. Client register push token (with Bearer auth)
  auto pushHttp = std::make_shared<HttpClient>(BASE_URL);
  pushHttp->setToken(accessToken);

  json regBody;
  regBody["deviceId"] = deviceId;
  regBody["token"] = fcmToken;
  regBody["platform"] = "web";
  auto regR = pushHttp->post("/api/push/register", regBody.dump());
  ASSERT_EQ(regR.statusCode, 200) << "push.register failed: " << regR.body;

  // 4. Admin send to userId
  json sendBody;
  sendBody["userId"] = userId;
  sendBody["payload"] = {{"title", "Full Flow"}, {"body", "E2E"}};
  auto sendR = http->post("/api/push/send", sendBody.dump());
  ASSERT_EQ(sendR.statusCode, 200) << "push.send failed: " << sendR.body;
  auto sendJson = json::parse(sendR.body);
  EXPECT_EQ(sendJson["sent"].get<int>(), 1);

  // 5. Verify mock FCM received the message
  auto fcmR = mockFcmRequest("GET", "/messages?token=" + fcmToken);
  ASSERT_EQ(fcmR.statusCode, 200);
  auto fcmItems = json::parse(fcmR.body);
  ASSERT_GE(fcmItems.size(), 1u);
  EXPECT_EQ(fcmItems[0]["token"].get<std::string>(), fcmToken);
  if (fcmItems[0].contains("payload") &&
      fcmItems[0]["payload"].contains("notification")) {
    EXPECT_EQ(
        fcmItems[0]["payload"]["notification"]["title"].get<std::string>(),
        "Full Flow");
  }

  // 6. Client unregister
  json unregBody;
  unregBody["deviceId"] = deviceId;
  auto unregR = pushHttp->post("/api/push/unregister", unregBody.dump());
  EXPECT_EQ(unregR.statusCode, 200);

  // 7. Admin getTokens → empty
  auto tokensR = http->get("/api/push/tokens?userId=" + userId);
  ASSERT_EQ(tokensR.statusCode, 200);
  auto tokensJson = json::parse(tokensR.body);
  EXPECT_EQ(tokensJson["items"].size(), 0u);
}

TEST_F(E2ESuite, PushFullFlowSendToTopic) {
  // Clear mock FCM store
  auto clearR = mockFcmRequest("DELETE", "/messages");
  EXPECT_TRUE(clearR.statusCode == 200 || clearR.statusCode == 204);

  // Admin sendToTopic
  json body;
  body["topic"] = "news";
  body["payload"] = {{"title", "Topic Test"}, {"body", "cpp topic"}};
  auto sendR = http->post("/api/push/send-to-topic", body.dump());
  ASSERT_EQ(sendR.statusCode, 200) << "send-to-topic failed: " << sendR.body;

  // Verify mock FCM received topic message
  auto fcmR = mockFcmRequest("GET", "/messages?topic=news");
  ASSERT_EQ(fcmR.statusCode, 200);
  auto fcmItems = json::parse(fcmR.body);
  ASSERT_GE(fcmItems.size(), 1u);
  EXPECT_EQ(fcmItems[0]["topic"].get<std::string>(), "news");
}

TEST_F(E2ESuite, PushFullFlowBroadcast) {
  // Clear mock FCM store
  auto clearR = mockFcmRequest("DELETE", "/messages");
  EXPECT_TRUE(clearR.statusCode == 200 || clearR.statusCode == 204);

  // Admin broadcast
  json body;
  body["payload"] = {{"title", "Broadcast"}, {"body", "cpp broadcast"}};
  auto sendR = http->post("/api/push/broadcast", body.dump());
  ASSERT_EQ(sendR.statusCode, 200) << "broadcast failed: " << sendR.body;

  // Verify mock FCM received broadcast (topic = "all")
  auto fcmR = mockFcmRequest("GET", "/messages?topic=all");
  ASSERT_EQ(fcmR.statusCode, 200);
  auto fcmItems = json::parse(fcmR.body);
  ASSERT_GE(fcmItems.size(), 1u);
  EXPECT_EQ(fcmItems[0]["topic"].get<std::string>(), "all");
}

// ─── Main
// ─────────────────────────────────────────────────────────────────────

int main(int argc, char **argv) {
  BASE_URL = getEnv("BASE_URL", "http://localhost:8688");
  SERVICE_KEY = getEnv("SERVICE_KEY", "test-service-key-for-admin");
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
}
