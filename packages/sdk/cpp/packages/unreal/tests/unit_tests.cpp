/**
 * C++ Unreal SDK — 단위 테스트
 * packages/sdk/cpp/packages/unreal/tests/unit_tests.cpp
 *
 * 테스트 대상: namespace client (edgebase/edgebase.h)
 *   - Result struct
 *   - Filter / Sort struct
 *   - ListResult struct
 *   - FileInfo struct
 *   - DbChange struct
 *   - TableRef 불변 체인 (where/orderBy/limit/offset/after/before/search)
 *   - FieldOps (edgebase/field_ops.h)
 *   - RoomClient (edgebase/room_client.h)
 *   - StorageClient / DatabaseLive 구조 검증
 *   - EdgeBase Error 패턴 (Result 기반)
 *
 * 프레임워크: Catch2 (CMakeLists.txt에서 FetchContent로 포함)
 *
 * 빌드:
 *   cd packages/sdk/cpp/packages/unreal
 *   cmake . -B build && cmake --build build -j4
 *   ./build/edgebase_unreal_unit_tests
 */

#include <catch2/catch_all.hpp>
#include <edgebase/edgebase.h>
#include <edgebase/field_ops.h>
#include <edgebase/room_client.h>
#include <edgebase/turnstile_provider.h>
#include <nlohmann/json.hpp>
#include <cctype>
#include <memory>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

// ─── Helper: dummy HttpClient + GeneratedDbApi for structure-only tests ──────
static std::shared_ptr<client::HttpClient> dummyHttp() {
  return std::make_shared<client::HttpClient>("http://localhost:9999");
}
static std::shared_ptr<client::GeneratedDbApi> dummyCore() {
  // GeneratedDbApi takes HttpClient& (reference), so keep the HttpClient alive
  // via static to ensure the reference remains valid for the test lifetime.
  static auto http = dummyHttp();
  return std::make_shared<client::GeneratedDbApi>(*http);
}

// ─── A. Result ───────────────────────────────────────────────────────────────

TEST_CASE("Result default values", "[result]") {
  client::Result r;
  REQUIRE(r.ok == false);
  REQUIRE(r.statusCode == 0);
  REQUIRE(r.body.empty());
  REQUIRE(r.error.empty());
}

TEST_CASE("Result ok=true initialized", "[result]") {
  client::Result r;
  r.ok = true;
  r.statusCode = 200;
  r.body = R"({"id":"test-id"})";
  REQUIRE(r.ok);
  REQUIRE(r.statusCode == 200);
  REQUIRE(r.body == R"({"id":"test-id"})");
}

TEST_CASE("Result error populated", "[result]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 404;
  r.error = "Not found";
  REQUIRE(!r.ok);
  REQUIRE(r.error == "Not found");
}

// ─── B. Filter ───────────────────────────────────────────────────────────────

TEST_CASE("Filter construction", "[filter]") {
  client::Filter f;
  f.field = "status";
  f.op = "==";
  f.value = "active";
  REQUIRE(f.field == "status");
  REQUIRE(f.op == "==");
  REQUIRE(f.value == "active");
}

TEST_CASE("Filter default values empty", "[filter]") {
  client::Filter f;
  REQUIRE(f.field.empty());
  REQUIRE(f.op.empty());
  REQUIRE(f.value.empty());
}

TEST_CASE("Multiple Filters are independent", "[filter]") {
  client::Filter f1;
  f1.field = "status";
  f1.op = "==";
  f1.value = "active";

  client::Filter f2;
  f2.field = "views";
  f2.op = ">";
  f2.value = "100";

  REQUIRE(f1.field != f2.field);
  REQUIRE(f1.op != f2.op);
}

// ─── C. Sort ─────────────────────────────────────────────────────────────────

TEST_CASE("Sort default direction is asc", "[sort]") {
  client::Sort s;
  REQUIRE(s.direction == "asc");
}

TEST_CASE("Sort desc direction", "[sort]") {
  client::Sort s;
  s.field = "createdAt";
  s.direction = "desc";
  REQUIRE(s.field == "createdAt");
  REQUIRE(s.direction == "desc");
}

// ─── D. ListResult
// ────────────────────────────────────────────────────────────

TEST_CASE("ListResult default values", "[listresult]") {
  client::ListResult lr;
  REQUIRE(lr.items.empty());
  REQUIRE(!lr.total.has_value());
  REQUIRE(!lr.page.has_value());
  REQUIRE(!lr.perPage.has_value());
  REQUIRE(!lr.hasMore.has_value());
  REQUIRE(!lr.cursor.has_value());
}

TEST_CASE("ListResult with items", "[listresult]") {
  client::ListResult lr;
  std::map<std::string, std::string> item1 = {{"id", "1"}, {"title", "Post 1"}};
  std::map<std::string, std::string> item2 = {{"id", "2"}, {"title", "Post 2"}};
  lr.items.push_back(item1);
  lr.items.push_back(item2);
  REQUIRE(lr.items.size() == 2);
  REQUIRE(lr.items[0].at("id") == "1");
}

TEST_CASE("ListResult cursor pagination", "[listresult]") {
  client::ListResult lr;
  lr.cursor = "cursor-abc";
  lr.hasMore = true;
  REQUIRE(lr.cursor.has_value());
  REQUIRE(*lr.cursor == "cursor-abc");
  REQUIRE(*lr.hasMore == true);
}

TEST_CASE("ListResult total + page + perPage", "[listresult]") {
  client::ListResult lr;
  lr.total = 150;
  lr.page = 2;
  lr.perPage = 20;
  REQUIRE(*lr.total == 150);
  REQUIRE(*lr.page == 2);
  REQUIRE(*lr.perPage == 20);
}

// ─── E. FileInfo ─────────────────────────────────────────────────────────────

TEST_CASE("FileInfo default size=0", "[fileinfo]") {
  client::FileInfo fi;
  REQUIRE(fi.size == 0);
  REQUIRE(fi.key.empty());
  REQUIRE(fi.url.empty());
}

TEST_CASE("FileInfo populated", "[fileinfo]") {
  client::FileInfo fi;
  fi.key = "images/avatar.png";
  fi.url = "https://cdn.example.com/images/avatar.png";
  fi.size = 1024 * 512; // 512KB
  fi.contentType = "image/png";
  fi.createdAt = "2024-01-01T00:00:00Z";

  REQUIRE(fi.key == "images/avatar.png");
  REQUIRE(fi.size == 1024 * 512);
  REQUIRE(fi.contentType == "image/png");
}

// ─── F. DbChange ─────────────────────────────────────────────────────────────

TEST_CASE("DbChange default values", "[dbchange]") {
  client::DbChange dc;
  REQUIRE(dc.changeType.empty());
  REQUIRE(dc.table.empty());
  REQUIRE(dc.docId.empty());
  REQUIRE(dc.dataJson.empty());
  REQUIRE(dc.timestamp.empty());
}

TEST_CASE("DbChange added event", "[dbchange]") {
  client::DbChange dc;
  dc.changeType = "added";
  dc.table = "posts";
  dc.docId = "post-123";
  dc.dataJson = R"({"id":"post-123","title":"Hello"})";
  REQUIRE(dc.changeType == "added");
  REQUIRE(dc.table == "posts");
}

TEST_CASE("DbChange modified event", "[dbchange]") {
  client::DbChange dc;
  dc.changeType = "modified";
  REQUIRE(dc.changeType == "modified");
}

TEST_CASE("DbChange removed event", "[dbchange]") {
  client::DbChange dc;
  dc.changeType = "removed";
  dc.docId = "deleted-id";
  REQUIRE(dc.changeType == "removed");
  REQUIRE(dc.docId == "deleted-id");
}

// ─── H. TableRef 불변 체인 (컴파일·메서드 반환 타입만 검증)
// ────────────────────

TEST_CASE("TableRef 불변 체인 — where returns new TableRef", "[tableref]") {
  // TableRef는 shared_ptr<HttpClient>가 필요 → null 포인터로 구조만 검증
  // (E2E에서 실제 HTTP 호출 검증)
  using TR = client::TableRef;
  // Just verify the class compiles and has the expected methods
  // by checking method signatures exist via decltype
  auto whereMethod = &TR::where;
  auto orderByMethod = &TR::orderBy;
  auto limitMethod = &TR::limit;
  auto offsetMethod = &TR::offset;
  auto afterMethod = &TR::after;
  auto beforeMethod = &TR::before;
  auto searchMethod = &TR::search;

  REQUIRE(whereMethod != nullptr);
  REQUIRE(orderByMethod != nullptr);
  REQUIRE(limitMethod != nullptr);
  REQUIRE(offsetMethod != nullptr);
  REQUIRE(afterMethod != nullptr);
  REQUIRE(beforeMethod != nullptr);
  REQUIRE(searchMethod != nullptr);
}

TEST_CASE("TableRef CRUD methods exist", "[tableref]") {
  // Verify method pointers compile → methods are defined
  auto getListMethod = &client::TableRef::getList;
  auto getFirstMethod = &client::TableRef::getFirst;
  auto getOneMethod = &client::TableRef::getOne;
  auto insertMethod = &client::TableRef::insert;
  auto updateMethod = &client::TableRef::update;
  auto delMethod = &client::TableRef::del;
  auto upsertMethod = &client::TableRef::upsert;
  auto countMethod = &client::TableRef::count;

  REQUIRE(getListMethod != nullptr);
  REQUIRE(getFirstMethod != nullptr);
  REQUIRE(getOneMethod != nullptr);
  REQUIRE(insertMethod != nullptr);
  REQUIRE(updateMethod != nullptr);
  REQUIRE(delMethod != nullptr);
  REQUIRE(upsertMethod != nullptr);
  REQUIRE(countMethod != nullptr);
}

TEST_CASE("TableRef batch methods exist", "[tableref]") {
  auto insertManyMethod = &client::TableRef::insertMany;
  auto upsertManyMethod = &client::TableRef::upsertMany;
  auto updateManyMethod = &client::TableRef::updateMany;
  auto deleteManyMethod = &client::TableRef::deleteMany;

  REQUIRE(insertManyMethod != nullptr);
  REQUIRE(upsertManyMethod != nullptr);
  REQUIRE(updateManyMethod != nullptr);
  REQUIRE(deleteManyMethod != nullptr);
}

// ─── I. EdgeBase entry point structure
// ────────────────────────────────────────

TEST_CASE("EdgeBase class compiles with constructor", "[edgebase]") {
  // Verify methods exist via pointer
  auto authMethod = &client::EdgeBase::auth;
  auto storageMethod = &client::EdgeBase::storage;
  auto pushMethod = &client::EdgeBase::push;
  auto dbMethod = &client::EdgeBase::db;
  auto setContextMethod = &client::EdgeBase::setContext;
  auto getContextMethod = &client::EdgeBase::getContext;

  REQUIRE(authMethod != nullptr);
  REQUIRE(storageMethod != nullptr);
  REQUIRE(pushMethod != nullptr);
  REQUIRE(dbMethod != nullptr);
  REQUIRE(setContextMethod != nullptr);
  REQUIRE(getContextMethod != nullptr);
}

// ─── J. AuthClient methods compilation
// ────────────────────────────────────────

TEST_CASE("AuthClient methods exist", "[auth]") {
  auto signUpMethod = &client::AuthClient::signUp;
  auto signInMethod = &client::AuthClient::signIn;
  auto signOutMethod = &client::AuthClient::signOut;
  auto signInAnonMethod = &client::AuthClient::signInAnonymously;
  auto changePassMethod = &client::AuthClient::changePassword;
  auto updateProfileMethod = &client::AuthClient::updateProfile;
  auto listSessionsMethod = &client::AuthClient::listSessions;
  auto revokeSessionMethod = &client::AuthClient::revokeSession;
  auto currentTokenMethod = &client::AuthClient::currentToken;
  auto currentUserMethod = &client::AuthClient::currentUser;

  REQUIRE(signUpMethod != nullptr);
  REQUIRE(signInMethod != nullptr);
  REQUIRE(signOutMethod != nullptr);
  REQUIRE(signInAnonMethod != nullptr);
  REQUIRE(changePassMethod != nullptr);
  REQUIRE(updateProfileMethod != nullptr);
  REQUIRE(listSessionsMethod != nullptr);
  REQUIRE(revokeSessionMethod != nullptr);
  REQUIRE(currentTokenMethod != nullptr);
  REQUIRE(currentUserMethod != nullptr);
}

// ─── K. StorageClient methods
// ─────────────────────────────────────────────────

TEST_CASE("StorageBucket methods exist", "[storage]") {
  auto uploadMethod = &client::StorageBucket::upload;
  auto downloadMethod = &client::StorageBucket::download;
  auto delMethod = &client::StorageBucket::del;
  auto listMethod = &client::StorageBucket::list;
  auto getUrlMethod = &client::StorageBucket::getUrl;
  auto getMetaMethod = &client::StorageBucket::getMetadata;
  auto createSignedUrlMethod = &client::StorageBucket::createSignedUrl;
  auto initiateResumableMethod =
      &client::StorageBucket::initiateResumableUpload;
  auto resumeMethod = &client::StorageBucket::resumeUpload;

  REQUIRE(uploadMethod != nullptr);
  REQUIRE(downloadMethod != nullptr);
  REQUIRE(delMethod != nullptr);
  REQUIRE(listMethod != nullptr);
  REQUIRE(getUrlMethod != nullptr);
  REQUIRE(getMetaMethod != nullptr);
  REQUIRE(createSignedUrlMethod != nullptr);
  REQUIRE(initiateResumableMethod != nullptr);
  REQUIRE(resumeMethod != nullptr);
}

// ─── L. TableRef database-live surface ───────────────────────────────────────

TEST_CASE("TableRef database-live methods exist", "[database-live]") {
  auto onSnapshotMethod = &client::TableRef::onSnapshot;
  auto unsubscribeMethod = &client::TableRef::unsubscribe;

  REQUIRE(onSnapshotMethod != nullptr);
  REQUIRE(unsubscribeMethod != nullptr);
}

// ═══════════════════════════════════════════════════════════════════════════════
// M. TableRef Query Builder — 불변 체인 인스턴스 검증
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("TableRef where returns new ref", "[tableref][query]") {
  auto core = dummyCore();
  client::TableRef t1(core, "posts");
  client::TableRef t2 = t1.where("status", "==", "published");
  REQUIRE(&t1 != &t2);
}

TEST_CASE("TableRef orderBy returns new ref", "[tableref][query]") {
  auto core = dummyCore();
  client::TableRef t1(core, "posts");
  client::TableRef t2 = t1.orderBy("createdAt", "desc");
  REQUIRE(&t1 != &t2);
}

TEST_CASE("TableRef limit returns new ref", "[tableref][query]") {
  auto core = dummyCore();
  client::TableRef t1(core, "posts");
  client::TableRef t2 = t1.limit(10);
  REQUIRE(&t1 != &t2);
}

TEST_CASE("TableRef offset returns new ref", "[tableref][query]") {
  auto core = dummyCore();
  client::TableRef t1(core, "posts");
  client::TableRef t2 = t1.offset(20);
  REQUIRE(&t1 != &t2);
}

TEST_CASE("TableRef page returns new ref", "[tableref][query]") {
  auto core = dummyCore();
  client::TableRef t1(core, "posts");
  client::TableRef t2 = t1.page(2);
  REQUIRE(&t1 != &t2);
}

TEST_CASE("TableRef search returns new ref", "[tableref][query]") {
  auto core = dummyCore();
  client::TableRef t1(core, "posts");
  client::TableRef t2 = t1.search("keyword");
  REQUIRE(&t1 != &t2);
}

TEST_CASE("TableRef after returns new ref", "[tableref][query]") {
  auto core = dummyCore();
  client::TableRef t1(core, "posts");
  client::TableRef t2 = t1.after("cursor-xyz");
  REQUIRE(&t1 != &t2);
}

TEST_CASE("TableRef before returns new ref", "[tableref][query]") {
  auto core = dummyCore();
  client::TableRef t1(core, "posts");
  client::TableRef t2 = t1.before("cursor-abc");
  REQUIRE(&t1 != &t2);
}

TEST_CASE("TableRef chain combination compiles", "[tableref][query]") {
  auto core = dummyCore();
  // Full chain should compile and not throw
  auto ref = client::TableRef(core, "posts")
                 .where("status", "==", "published")
                 .orderBy("createdAt", "desc")
                 .limit(25)
                 .offset(50)
                 .search("deep learning");
  (void)ref;
  REQUIRE(true);
}

TEST_CASE("TableRef where with == operator", "[tableref][query]") {
  auto core = dummyCore();
  auto ref = client::TableRef(core, "posts").where("status", "==", "active");
  (void)ref;
  REQUIRE(true);
}

TEST_CASE("TableRef where with != operator", "[tableref][query]") {
  auto core = dummyCore();
  auto ref = client::TableRef(core, "posts").where("status", "!=", "deleted");
  (void)ref;
  REQUIRE(true);
}

TEST_CASE("TableRef where with > operator", "[tableref][query]") {
  auto core = dummyCore();
  auto ref = client::TableRef(core, "posts").where("views", ">", "100");
  (void)ref;
  REQUIRE(true);
}

TEST_CASE("TableRef where with < operator", "[tableref][query]") {
  auto core = dummyCore();
  auto ref = client::TableRef(core, "posts").where("views", "<", "50");
  (void)ref;
  REQUIRE(true);
}

TEST_CASE("TableRef where with contains operator", "[tableref][query]") {
  auto core = dummyCore();
  auto ref =
      client::TableRef(core, "posts").where("title", "contains", "hello");
  (void)ref;
  REQUIRE(true);
}

TEST_CASE("TableRef where with in operator", "[tableref][query]") {
  auto core = dummyCore();
  auto ref =
      client::TableRef(core, "posts").where("category", "in", "tech,science");
  (void)ref;
  REQUIRE(true);
}

TEST_CASE("TableRef multiple where clauses chain", "[tableref][query]") {
  auto core = dummyCore();
  auto ref = client::TableRef(core, "posts")
                 .where("status", "==", "published")
                 .where("category", "==", "tech")
                 .where("views", ">", "100")
                 .where("author", "!=", "bot");
  (void)ref;
  REQUIRE(true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// N. FieldOps (edgebase/field_ops.h)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("FieldOps increment positive", "[fieldops]") {
  auto j = edgebase::FieldOps::incrementJson(5.0);
  REQUIRE(j["$op"].get<std::string>() == "increment");
  REQUIRE(j["value"].get<double>() == Catch::Approx(5.0));
}

TEST_CASE("FieldOps increment negative", "[fieldops]") {
  auto j = edgebase::FieldOps::incrementJson(-3.0);
  REQUIRE(j["$op"].get<std::string>() == "increment");
  REQUIRE(j["value"].get<double>() == Catch::Approx(-3.0));
}

TEST_CASE("FieldOps increment zero", "[fieldops]") {
  auto j = edgebase::FieldOps::incrementJson(0.0);
  REQUIRE(j["$op"].get<std::string>() == "increment");
  REQUIRE(j["value"].get<double>() == Catch::Approx(0.0));
}

TEST_CASE("FieldOps increment float", "[fieldops]") {
  auto j = edgebase::FieldOps::incrementJson(0.5);
  REQUIRE(j["$op"].get<std::string>() == "increment");
  REQUIRE(j["value"].get<double>() == Catch::Approx(0.5));
}

TEST_CASE("FieldOps deleteField", "[fieldops]") {
  auto j = edgebase::FieldOps::deleteFieldJson();
  REQUIRE(j["$op"].get<std::string>() == "deleteField");
}

TEST_CASE("FieldOps increment result is map", "[fieldops]") {
  auto j = edgebase::FieldOps::incrementJson(1.0);
  REQUIRE(j.is_object());
  REQUIRE(j.size() == 2);
  REQUIRE(j.contains("$op"));
  REQUIRE(j.contains("value"));
}

TEST_CASE("FieldOps deleteField result has no value key", "[fieldops]") {
  auto j = edgebase::FieldOps::deleteFieldJson();
  REQUIRE(j.is_object());
  REQUIRE(j.size() == 1);
  REQUIRE(!j.contains("value"));
}

TEST_CASE("FieldOps increment creates proper op marker", "[fieldops]") {
  std::string s = edgebase::FieldOps::increment(10.0);
  auto j = nlohmann::json::parse(s);
  REQUIRE(j["$op"].get<std::string>() == "increment");
  REQUIRE(j["value"].get<double>() == Catch::Approx(10.0));
}

// ═══════════════════════════════════════════════════════════════════════════════
// O. EdgeBase Error 패턴 (Result 기반)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("Error result has code", "[error]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 403;
  r.error = "Forbidden";
  REQUIRE(r.statusCode == 403);
}

TEST_CASE("Error result has message", "[error]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 400;
  r.error = "Bad request: missing field 'title'";
  REQUIRE(r.error == "Bad request: missing field 'title'");
}

TEST_CASE("Error result is not ok", "[error]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 500;
  r.error = "Internal Server Error";
  REQUIRE(!r.ok);
}

TEST_CASE("Error result with JSON data in body", "[error]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 422;
  r.error = "Validation failed";
  r.body = R"({"errors":[{"field":"email","message":"invalid format"}]})";
  auto j = nlohmann::json::parse(r.body);
  REQUIRE(j.contains("errors"));
  REQUIRE(j["errors"].size() == 1);
}

TEST_CASE("Error result toString pattern", "[error]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 404;
  r.error = "Not found";
  std::string description =
      "Error " + std::to_string(r.statusCode) + ": " + r.error;
  REQUIRE(description == "Error 404: Not found");
}

TEST_CASE("Error result 404", "[error]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 404;
  r.error = "Resource not found";
  REQUIRE(r.statusCode == 404);
  REQUIRE(!r.ok);
  REQUIRE(!r.error.empty());
}

TEST_CASE("Error result 500", "[error]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 500;
  r.error = "Internal Server Error";
  REQUIRE(r.statusCode == 500);
  REQUIRE(!r.ok);
}

TEST_CASE("Error result 400 validation", "[error]") {
  client::Result r;
  r.ok = false;
  r.statusCode = 400;
  r.error = "Validation error: 'name' is required";
  r.body = R"({"code":"VALIDATION_ERROR","field":"name"})";
  REQUIRE(r.statusCode == 400);
  auto j = nlohmann::json::parse(r.body);
  REQUIRE(j["code"].get<std::string>() == "VALIDATION_ERROR");
}

// ═══════════════════════════════════════════════════════════════════════════════
// P. RoomClient 구조 검증 (edgebase/room_client.h)
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("RoomClient initial shared state empty", "[room]") {
  edgebase::RoomClient room(
      "http://localhost:8688", "shared", "test-room",
      []() -> std::string { return "fake-token"; });
  auto state = room.get_shared_state();
  REQUIRE(state.is_object());
  REQUIRE(state.empty());
}

TEST_CASE("RoomClient initial player state empty", "[room]") {
  edgebase::RoomClient room(
      "http://localhost:8688", "shared", "test-room",
      []() -> std::string { return "fake-token"; });
  auto state = room.get_player_state();
  REQUIRE(state.is_object());
  REQUIRE(state.empty());
}

TEST_CASE("RoomClient roomId matches", "[room]") {
  edgebase::RoomClient room(
      "http://localhost:8688", "shared", "my-game-lobby",
      []() -> std::string { return "fake-token"; });
  REQUIRE(room.room_id_ == "my-game-lobby");
}

TEST_CASE("RoomClient namespace matches", "[room]") {
  edgebase::RoomClient room(
      "http://localhost:8688", "game", "lobby-1",
      []() -> std::string { return "fake-token"; });
  REQUIRE(room.namespace_name_ == "game");
}

TEST_CASE("RoomClient has send method", "[room]") {
  auto method = &edgebase::RoomClient::send;
  REQUIRE(method != nullptr);
}

TEST_CASE("RoomClient has on_shared_state method", "[room]") {
  auto method = &edgebase::RoomClient::on_shared_state;
  REQUIRE(method != nullptr);
}

TEST_CASE("RoomClient has on_player_state method", "[room]") {
  auto method = &edgebase::RoomClient::on_player_state;
  REQUIRE(method != nullptr);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Q. Database-live 구조 검증
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("TableRef has subscribe via onSnapshot", "[database-live][structure]") {
  auto onSnapshotMethod = &client::TableRef::onSnapshot;
  auto unsubscribeMethod = &client::TableRef::unsubscribe;
  REQUIRE(onSnapshotMethod != nullptr);
  REQUIRE(unsubscribeMethod != nullptr);
}

TEST_CASE("EdgeBase db table exposes database-live surface", "[database-live][structure]") {
  client::EdgeBase eb("http://localhost:8688");
  auto table = eb.db("shared").table("posts");
  auto onSnapshotMethod = &client::TableRef::onSnapshot;
  auto unsubscribeMethod = &client::TableRef::unsubscribe;
  (void)table;
  REQUIRE(onSnapshotMethod != nullptr);
  REQUIRE(unsubscribeMethod != nullptr);
  REQUIRE(true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// R. StorageClient 구조 검증
// ═══════════════════════════════════════════════════════════════════════════════

TEST_CASE("StorageClient bucket returns StorageBucket", "[storage][structure]") {
  client::EdgeBase eb("http://localhost:8688");
  auto storage = eb.storage();
  auto bucket = storage.bucket("my-bucket");
  (void)bucket;
  REQUIRE(true);
}

TEST_CASE("StorageBucket upload method exists", "[storage][structure]") {
  auto method = &client::StorageBucket::upload;
  REQUIRE(method != nullptr);
}

TEST_CASE("StorageBucket download method exists", "[storage][structure]") {
  auto method = &client::StorageBucket::download;
  REQUIRE(method != nullptr);
}

TEST_CASE("StorageBucket list method exists", "[storage][structure]") {
  auto method = &client::StorageBucket::list;
  REQUIRE(method != nullptr);
}

TEST_CASE("StorageBucket delete method exists", "[storage][structure]") {
  auto method = &client::StorageBucket::del;
  REQUIRE(method != nullptr);
}

TEST_CASE("StorageBucket getUrl returns non-empty string", "[storage][structure]") {
  client::EdgeBase eb("http://localhost:8688");
  auto storage = eb.storage();
  auto bucket = storage.bucket("assets");
  std::string url = bucket.getUrl("images/photo.jpg");
  REQUIRE(!url.empty());
  REQUIRE(url.find("images/photo.jpg") != std::string::npos);
}

// ═══════════════════════════════════════════════════════════════════════════════
// S. Hosted Turnstile protocol
// ═══════════════════════════════════════════════════════════════════════════════

namespace {
std::string percentEncodeForChallengeTest(const std::string &value) {
  static constexpr char hex[] = "0123456789ABCDEF";
  std::string encoded;
  for (const unsigned char ch : value) {
    if (std::isalnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == '~') {
      encoded.push_back(static_cast<char>(ch));
    } else {
      encoded.push_back('%');
      encoded.push_back(hex[(ch >> 4) & 0x0f]);
      encoded.push_back(hex[ch & 0x0f]);
    }
  }
  return encoded;
}
} // namespace

TEST_CASE("Turnstile challenge URL requires exact HTTPS origin and allowlist",
          "[turnstile][security]") {
  const std::string channel = "0123456789abcdef0123456789abcdef";
  REQUIRE(client::TurnstileProvider::buildChallengeUrl(
              "https://api.example.test/", "signin", channel) ==
          "https://api.example.test/api/captcha/challenge?action=signin&channel=" +
              channel + "&bridge=uri");

  REQUIRE_THROWS_AS(client::TurnstileProvider::buildChallengeUrl(
                        "http://api.example.test", "signin", channel),
                    std::invalid_argument);
  REQUIRE_THROWS_AS(client::TurnstileProvider::buildChallengeUrl(
                        "https://api.example.test/path", "signin", channel),
                    std::invalid_argument);
  REQUIRE_THROWS_AS(client::TurnstileProvider::buildChallengeUrl(
                        "https://user@api.example.test", "signin", channel),
                    std::invalid_argument);
  REQUIRE_THROWS_AS(client::TurnstileProvider::buildChallengeUrl(
                        "https://api.example.test?next=evil", "signin", channel),
                    std::invalid_argument);
  REQUIRE_THROWS_AS(client::TurnstileProvider::buildChallengeUrl(
                        "https://api.example.test:70000", "signin", channel),
                    std::invalid_argument);
  REQUIRE_THROWS_AS(client::TurnstileProvider::buildChallengeUrl(
                        "https://api.example.test", "custom", channel),
                    std::invalid_argument);
  REQUIRE_THROWS_AS(client::TurnstileProvider::buildChallengeUrl(
                        "https://api.example.test", "signin", "predictable"),
                    std::invalid_argument);
}

TEST_CASE("Turnstile channels use unique 128-bit secure URL-safe values",
          "[turnstile][security]") {
  std::set<std::string> channels;
  for (int i = 0; i < 64; ++i) {
    const std::string channel =
        client::TurnstileProvider::generateSecureChannel();
    REQUIRE(channel.size() == 32);
    for (const char ch : channel) {
      REQUIRE(((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f')));
    }
    channels.insert(channel);
  }
  REQUIRE(channels.size() == 64);
}

TEST_CASE("Turnstile message parser is versioned channel-bound and bounded",
          "[turnstile][security]") {
  const std::string channel = "0123456789abcdef0123456789abcdef";
  std::string type;
  std::string value;
  const std::string tokenMessage =
      R"({"v":1,"channel":")" + channel +
      R"(","type":"token","value":"verified"})";

  REQUIRE(client::TurnstileProvider::tryParseChallengeMessage(
      tokenMessage, channel, type, value));
  REQUIRE(type == "token");
  REQUIRE(value == "verified");
  const std::string otherChannel(32, 'f');
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeMessage(
      tokenMessage, otherChannel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeMessage(
      R"({"v":2,"channel":")" + channel +
          R"(","type":"token","value":"verified"})",
      channel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeMessage(
      R"({"v":1,"channel":")" + channel +
          R"(","type":"token","value":")" + std::string(2049, 'x') +
          R"("})",
      channel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeMessage(
      R"({"v":1,"channel":")" + channel +
          R"(","type":"error","value":")" + std::string(257, 'x') +
          R"("})",
      channel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeMessage(
      R"({"v":1,"channel":")" + channel +
          R"(","type":"ready","value":")" + std::string(33, 'x') +
          R"("})",
      channel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeMessage(
      R"({"v":1,"channel":")" + channel +
          R"(","type":"token","value":"verified","extra":true})",
      channel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeMessage(
      std::string(4097, 'x'), channel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeMessage(
      std::string(9, '[') + std::string(9, ']'), channel, type, value));
}

TEST_CASE("Turnstile URI parser accepts only strict encoded v1 messages",
          "[turnstile][security]") {
  const std::string channel = "0123456789abcdef0123456789abcdef";
  const std::string message =
      R"({"v":1,"channel":")" + channel +
      R"(","type":"interactive","value":"show"})";
  const std::string uri =
      "edgebase://message/" + percentEncodeForChallengeTest(message);
  std::string type;
  std::string value;
  REQUIRE(client::TurnstileProvider::tryParseChallengeUri(uri, channel, type,
                                                           value));
  REQUIRE(type == "interactive");
  REQUIRE(value == "show");
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeUri(
      "edgebase://token/legacy", channel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeUri(
      "edgebase://message/%ZZ", channel, type, value));
  REQUIRE_FALSE(client::TurnstileProvider::tryParseChallengeUri(
      uri + "/smuggled", channel, type, value));
}

TEST_CASE("Turnstile WebView factory runs outside provider mutex",
          "[turnstile][concurrency]") {
  bool invoked = false;
  client::TurnstileProvider::setWebViewFactory(
      [&invoked](const std::string &challengeUrl,
                 const std::string &channel) {
        invoked = true;
        REQUIRE(challengeUrl ==
                client::TurnstileProvider::buildChallengeUrl(
                    "https://api.example.test", "signup", channel));
        client::TurnstileProvider::setWebViewFactory(
            [](const std::string &, const std::string &) { return ""; });
        return "synthetic-token";
      });
  REQUIRE(client::TurnstileProvider::acquireCaptchaToken(
              "https://api.example.test", "signup") == "synthetic-token");
  REQUIRE(invoked);
  client::TurnstileProvider::setWebViewFactory({});
}

TEST_CASE("Turnstile acquisition surfaces native adapter failures",
          "[turnstile][diagnostics]") {
  client::TurnstileProvider::setWebViewFactory({});
  REQUIRE_THROWS_WITH(
      client::TurnstileProvider::acquireCaptchaToken(
          "https://api.example.test", "signup"),
      Catch::Matchers::ContainsSubstring("captcha-unavailable"));

  client::TurnstileProvider::setWebViewFactory(
      [](const std::string &, const std::string &) { return ""; });
  REQUIRE_THROWS_WITH(
      client::TurnstileProvider::acquireCaptchaToken(
          "https://api.example.test", "signup"),
      Catch::Matchers::ContainsSubstring("did not return a token"));
  client::TurnstileProvider::setWebViewFactory({});
}

TEST_CASE("Core AuthClient does not send a protected request after CAPTCHA adapter failure",
          "[turnstile][diagnostics]") {
  auto http = std::make_shared<client::HttpClient>("https://api.example.test");
  auto core = std::make_shared<client::GeneratedDbApi>(*http);
  client::AuthClient auth(http, core);
  client::AuthClient::setCaptchaTokenProvider(
      [](const std::shared_ptr<client::HttpClient> &, const std::string &,
         const std::string &) -> std::string {
        throw std::runtime_error("Unreal Game Thread is not supported");
      });

  const auto result = auth.signUp("synthetic@example.com", "SyntheticPass123!");
  REQUIRE_FALSE(result.ok);
  REQUIRE(result.statusCode == 0);
  REQUIRE(result.error.find("captcha-unavailable") != std::string::npos);
  REQUIRE(result.error.find("Game Thread") != std::string::npos);
  client::AuthClient::setCaptchaTokenProvider({});
}

TEST_CASE("Core AuthClient invokes the registered CAPTCHA provider for OAuth",
          "[turnstile][integration]") {
  auto http = std::make_shared<client::HttpClient>("https://api.example.test");
  auto core = std::make_shared<client::GeneratedDbApi>(*http);
  client::AuthClient auth(http, core);
  std::string observedAction;
  client::AuthClient::setCaptchaTokenProvider(
      [&observedAction](const std::shared_ptr<client::HttpClient> &client,
                        const std::string &action,
                        const std::string &manualToken) {
        REQUIRE(client->getBaseUrl() == "https://api.example.test");
        REQUIRE(manualToken.empty());
        observedAction = action;
        return "hook-token";
      });
  const std::string url = auth.signInWithOAuth(
      "google", "https://app.example.test/callback?source=game");
  REQUIRE(observedAction == "oauth");
  REQUIRE(url.find("captcha_token=hook-token") != std::string::npos);
  REQUIRE(url.find("redirect_url=https%3A%2F%2Fapp.example.test%2Fcallback%3Fsource%3Dgame") !=
          std::string::npos);
  client::AuthClient::setCaptchaTokenProvider({});
}

TEST_CASE("Turnstile manual token bypass is preserved without an HTTP client",
          "[turnstile]") {
  REQUIRE(client::TurnstileProvider::resolveCaptchaToken(
              std::shared_ptr<client::HttpClient>{}, "signin", "manual-token") ==
          "manual-token");
  client::HttpClient http("https://api.example.test///");
  REQUIRE(http.getBaseUrl() == "https://api.example.test");
}

TEST_CASE("Turnstile platform preflight runs before synchronous config I/O",
          "[turnstile][diagnostics]") {
  int transportCalls = 0;
  auto http = std::make_shared<client::HttpClient>(
      "https://api.example.test", "",
      [&transportCalls](const std::string &, const std::string &,
                        const std::string &,
                        const std::map<std::string, std::string> &) {
        ++transportCalls;
        return client::Result{
            true, 200, R"({"captcha":{"siteKey":"synthetic-site"}})", ""};
      });
  client::TurnstileProvider::setPreflightGuard([]() {
    throw std::runtime_error("captcha-unavailable: Unreal Game Thread");
  });

  REQUIRE_THROWS_WITH(
      client::TurnstileProvider::resolveCaptchaToken(http, "signin", ""),
      Catch::Matchers::ContainsSubstring("Game Thread"));
  REQUIRE(transportCalls == 0);

  // A caller-supplied token does not need config or WebView work.
  REQUIRE(client::TurnstileProvider::resolveCaptchaToken(
              http, "signin", "manual-token") == "manual-token");
  REQUIRE(transportCalls == 0);
  client::TurnstileProvider::setPreflightGuard({});
}

TEST_CASE("Turnstile site-key cache expires after five monotonic minutes",
          "[turnstile][rotation]") {
  struct ResetClock {
    ~ResetClock() { client::TurnstileProvider::setClockForTesting({}); }
  } resetClock;

  auto now = std::chrono::steady_clock::time_point(std::chrono::seconds(100));
  client::TurnstileProvider::setClockForTesting([&now]() { return now; });
  int transportCalls = 0;
  auto http = std::make_shared<client::HttpClient>(
      "https://ttl-rotation.example.test", "",
      [&transportCalls](const std::string &, const std::string &,
                        const std::string &,
                        const std::map<std::string, std::string> &) {
        ++transportCalls;
        return client::Result{
            true, 200,
            std::string(R"({"captcha":{"siteKey":"site-key-)") +
                std::to_string(transportCalls) + R"("}})",
            ""};
      });

  REQUIRE(client::TurnstileProvider::fetchSiteKey(http) == "site-key-1");
  now += std::chrono::minutes(4);
  REQUIRE(client::TurnstileProvider::fetchSiteKey(http) == "site-key-1");
  REQUIRE(transportCalls == 1);

  now += std::chrono::minutes(1);
  REQUIRE(client::TurnstileProvider::fetchSiteKey(http) == "site-key-2");
  REQUIRE(transportCalls == 2);
}

TEST_CASE("Turnstile treats an explicit null CAPTCHA config as disabled",
          "[turnstile][config]") {
  struct ResetClock {
    ~ResetClock() { client::TurnstileProvider::setClockForTesting({}); }
  } resetClock;

  client::TurnstileProvider::setClockForTesting(
      []() { return std::chrono::steady_clock::time_point{}; });
  int transportCalls = 0;
  auto http = std::make_shared<client::HttpClient>(
      "https://captcha-disabled.example.test", "",
      [&transportCalls](const std::string &, const std::string &,
                        const std::string &,
                        const std::map<std::string, std::string> &) {
        ++transportCalls;
        return client::Result{true, 200, R"({"captcha":null})", ""};
      });

  REQUIRE(client::TurnstileProvider::resolveCaptchaToken(http, "signin", "")
              .empty());
  REQUIRE(transportCalls == 1);
}

TEST_CASE("Turnstile surfaces config request failures as CAPTCHA unavailable",
          "[turnstile][config][diagnostics]") {
  SECTION("network result") {
    auto http = std::make_shared<client::HttpClient>(
        "https://captcha-network-failure.example.test", "",
        [](const std::string &, const std::string &, const std::string &,
           const std::map<std::string, std::string> &) {
          return client::Result{false, 0, "", "connection refused"};
        });
    REQUIRE_THROWS_WITH(
        client::TurnstileProvider::fetchSiteKey(http),
        Catch::Matchers::ContainsSubstring(
            "captcha-unavailable: config_fetch_failed"));
  }

  SECTION("HTTP error") {
    auto http = std::make_shared<client::HttpClient>(
        "https://captcha-http-failure.example.test", "",
        [](const std::string &, const std::string &, const std::string &,
           const std::map<std::string, std::string> &) {
          return client::Result{false, 503, "", "temporarily unavailable"};
        });
    REQUIRE_THROWS_WITH(
        client::TurnstileProvider::fetchSiteKey(http),
        Catch::Matchers::ContainsSubstring(
            "captcha-unavailable: config_fetch_failed"));
  }

  SECTION("transport exception") {
    auto http = std::make_shared<client::HttpClient>(
        "https://captcha-transport-exception.example.test", "",
        [](const std::string &, const std::string &, const std::string &,
           const std::map<std::string, std::string> &) -> client::Result {
          throw std::runtime_error("synthetic transport failure");
        });
    REQUIRE_THROWS_WITH(
        client::TurnstileProvider::fetchSiteKey(http),
        Catch::Matchers::ContainsSubstring(
            "captcha-unavailable: config_fetch_failed"));
  }
}

TEST_CASE("Turnstile surfaces malformed config instead of disabling CAPTCHA",
          "[turnstile][config][diagnostics]") {
  const std::vector<std::string> malformedBodies = {
      "not-json",
      R"({})",
      R"({"captcha":{}})",
      R"({"captcha":true})",
      R"({"captcha":{"siteKey":""}})",
      R"({"captcha":{"siteKey":42}})",
      std::string(R"({"captcha":{"siteKey":")") +
          std::string(513, 'x') + R"("}})",
      std::string(65537, 'x'),
  };

  for (std::size_t index = 0; index < malformedBodies.size(); ++index) {
    const auto body = malformedBodies[index];
    auto http = std::make_shared<client::HttpClient>(
        "https://captcha-malformed-" + std::to_string(index) +
            ".example.test",
        "", [body](const std::string &, const std::string &,
                   const std::string &,
                   const std::map<std::string, std::string> &) {
          return client::Result{true, 200, body, ""};
        });
    INFO("malformed response index: " << index);
    REQUIRE_THROWS_WITH(
        client::TurnstileProvider::fetchSiteKey(http),
        Catch::Matchers::ContainsSubstring(
            "captcha-unavailable: config_invalid_response"));
  }
}

TEST_CASE("Turnstile does not cache malformed site keys",
          "[turnstile][rotation][config]") {
  struct ResetClock {
    ~ResetClock() { client::TurnstileProvider::setClockForTesting({}); }
  } resetClock;

  const auto now = std::chrono::steady_clock::time_point{};
  client::TurnstileProvider::setClockForTesting([now]() { return now; });
  int transportCalls = 0;
  auto http = std::make_shared<client::HttpClient>(
      "https://negative-cache.example.test", "",
      [&transportCalls](const std::string &, const std::string &,
                        const std::string &,
                        const std::map<std::string, std::string> &) {
        ++transportCalls;
        if (transportCalls == 1) {
          return client::Result{true, 200, R"({"captcha":{}})", ""};
        }
        return client::Result{
            true, 200, R"({"captcha":{"siteKey":"recovered-site-key"}})", ""};
      });

  REQUIRE_THROWS_WITH(
      client::TurnstileProvider::fetchSiteKey(http),
      Catch::Matchers::ContainsSubstring("config_invalid_response"));
  REQUIRE(client::TurnstileProvider::fetchSiteKey(http) ==
          "recovered-site-key");
  REQUIRE(transportCalls == 2);
}
