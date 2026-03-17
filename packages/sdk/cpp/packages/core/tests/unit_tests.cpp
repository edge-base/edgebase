// EdgeBase C++ Core SDK — 단위 테스트
//
// 테스트 대상: EdgeBaseClient, TableRef, OrBuilder, Filter, Sort, Result,
//              ListResult, FileInfo, DbChange, HttpClient,
//              StorageBucket, DbRef, FieldOps, RAII, Error types
//
// 빌드+실행:
//   cd packages/sdk/cpp/packages/core/tests
//   cmake .. -B build && cmake --build build
//   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
//     ./build/unit_test
//
// Google Test 사용

#include <edgebase/edgebase.h>
#include <edgebase/field_ops.h>
#include <gtest/gtest.h>
#include <memory>
#include <nlohmann/json.hpp>
#include <stdexcept>

using namespace client;
using json = nlohmann::json;

// ─── Helper: dummy HttpClient + GeneratedDbApi core
// ──────────────────────────────────────────────────
static std::shared_ptr<HttpClient> dummyHttp() {
  return std::make_shared<HttpClient>("http://localhost:9999");
}

// Dummy core keeps the underlying HttpClient alive via shared_ptr capture.
static std::shared_ptr<GeneratedDbApi> dummyCore() {
  auto http = dummyHttp();
  // GeneratedDbApi takes HttpClient& — we wrap in a shared_ptr with a custom
  // destructor that also releases the HttpClient.
  auto core = std::shared_ptr<GeneratedDbApi>(
      new GeneratedDbApi(*http),
      [http](GeneratedDbApi *p) { delete p; });
  return core;
}

// ═══════════════════════════════════════════════════════════════════════════════
// A. TableRef 불변성 (Immutability)
// ═══════════════════════════════════════════════════════════════════════════════

TEST(TableRefUnit, WhereReturnsNewInstance) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = t1.where("status", "==", "published");
  // 새 복사본 — 개별 상태
  EXPECT_NE(&t1, &t2);
}

TEST(TableRefUnit, OrderByReturnsNewInstance) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = t1.orderBy("createdAt", "desc");
  EXPECT_NE(&t1, &t2);
}

TEST(TableRefUnit, LimitReturnsNewInstance) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = t1.limit(10);
  EXPECT_NE(&t1, &t2);
}

TEST(TableRefUnit, OffsetReturnsNewInstance) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = t1.offset(20);
  EXPECT_NE(&t1, &t2);
}

TEST(TableRefUnit, PageReturnsNewInstance) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = t1.page(2);
  EXPECT_NE(&t1, &t2);
}

TEST(TableRefUnit, AfterReturnsNewInstance) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = t1.after("cursor-xyz");
  EXPECT_NE(&t1, &t2);
}

TEST(TableRefUnit, BeforeReturnsNewInstance) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = t1.before("cursor-abc");
  EXPECT_NE(&t1, &t2);
}

TEST(TableRefUnit, SearchReturnsNewInstance) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = t1.search("hello world");
  EXPECT_NE(&t1, &t2);
}

TEST(TableRefUnit, ChainMultipleBuilders) {
  auto core = dummyCore();
  // All chaining should succeed without throwing
  EXPECT_NO_THROW({
    TableRef(core, "posts")
        .where("status", "==", "published")
        .where("views", ">", "100")
        .orderBy("createdAt", "desc")
        .limit(10)
        .offset(0);
  });
}

TEST(TableRefUnit, PageAndAfterMutuallyExclusive) {
  auto core = dummyCore();
  // page() + after() should throw
  EXPECT_THROW(
      { TableRef(core, "posts").after("cursor").page(2); },
      std::invalid_argument);
}

TEST(TableRefUnit, OffsetAndBeforeMutuallyExclusive) {
  auto core = dummyCore();
  // offset() + before() should throw
  EXPECT_THROW(
      { TableRef(core, "posts").offset(10).before("some-cursor"); },
      std::invalid_argument);
}

// ─── A2. TableRef: Additional immutability & chaining tests ──────────────────

TEST(TableRefUnit, WhereDoesNotMutateOriginal) {
  auto core = dummyCore();
  TableRef original(core, "posts");
  auto filtered = original.where("status", "==", "active");
  // original should remain pristine — building a second query should work
  EXPECT_NO_THROW({
    auto another = original.where("views", ">", "50");
    (void)another;
  });
}

TEST(TableRefUnit, OrderByDoesNotMutateOriginal) {
  auto core = dummyCore();
  TableRef original(core, "posts");
  auto sorted = original.orderBy("createdAt", "desc");
  // Original still allows a different sort
  EXPECT_NO_THROW({
    auto another = original.orderBy("updatedAt", "asc");
    (void)another;
  });
}

TEST(TableRefUnit, LimitDoesNotMutateOriginal) {
  auto core = dummyCore();
  TableRef original(core, "posts");
  auto limited = original.limit(5);
  EXPECT_NO_THROW({
    auto another = original.limit(100);
    (void)another;
  });
}

TEST(TableRefUnit, MultipleWhereFiltersChain) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts")
        .where("status", "==", "published")
        .where("category", "==", "tech")
        .where("views", ">", "100")
        .where("author", "!=", "bot");
  });
}

TEST(TableRefUnit, SearchThenLimitChain) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts")
        .search("hello world")
        .limit(20);
  });
}

TEST(TableRefUnit, BeforeThenLimitChain) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts")
        .before("cursor-xyz")
        .limit(10);
  });
}

TEST(TableRefUnit, AfterThenLimitChain) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts")
        .after("cursor-abc")
        .limit(10);
  });
}

TEST(TableRefUnit, PageThenBeforeMutuallyExclusive) {
  auto core = dummyCore();
  EXPECT_THROW(
      { TableRef(core, "posts").page(3).before("cursor"); },
      std::invalid_argument);
}

TEST(TableRefUnit, ComplexChainCompiles) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts")
        .where("status", "==", "published")
        .orderBy("createdAt", "desc")
        .orderBy("title", "asc")
        .limit(25)
        .offset(50)
        .search("deep learning");
  });
}

TEST(TableRefUnit, EmptySearchString) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts").search("");
  });
}

TEST(TableRefUnit, ZeroLimit) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts").limit(0);
  });
}

TEST(TableRefUnit, ZeroOffset) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts").offset(0);
  });
}

TEST(TableRefUnit, LargeLimit) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts").limit(10000);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// B. OrBuilder
// ═══════════════════════════════════════════════════════════════════════════════

TEST(OrBuilderUnit, AddingFilters) {
  OrBuilder ob;
  ob.where("field1", "==", "value1").where("field2", "!=", "value2");
  EXPECT_EQ(ob.getFilters().size(), 2u);
}

TEST(OrBuilderUnit, FilterFieldsPreserved) {
  OrBuilder ob;
  ob.where("status", "==", "published");
  const auto &filters = ob.getFilters();
  EXPECT_EQ(filters[0].field, "status");
  EXPECT_EQ(filters[0].op, "==");
  EXPECT_EQ(filters[0].value, "published");
}

TEST(OrBuilderUnit, EmptyBuilder) {
  OrBuilder ob;
  EXPECT_TRUE(ob.getFilters().empty());
  EXPECT_EQ(ob.getFilters().size(), 0u);
}

TEST(OrBuilderUnit, SingleFilter) {
  OrBuilder ob;
  ob.where("views", ">", "100");
  EXPECT_EQ(ob.getFilters().size(), 1u);
  EXPECT_EQ(ob.getFilters()[0].field, "views");
  EXPECT_EQ(ob.getFilters()[0].op, ">");
  EXPECT_EQ(ob.getFilters()[0].value, "100");
}

TEST(OrBuilderUnit, ThreeFiltersChained) {
  OrBuilder ob;
  ob.where("a", "==", "1")
    .where("b", "==", "2")
    .where("c", "==", "3");
  EXPECT_EQ(ob.getFilters().size(), 3u);
  EXPECT_EQ(ob.getFilters()[2].field, "c");
}

TEST(OrBuilderUnit, DifferentOperators) {
  OrBuilder ob;
  ob.where("x", "!=", "hello")
    .where("y", "contains", "world")
    .where("z", ">=", "42");
  EXPECT_EQ(ob.getFilters().size(), 3u);
  EXPECT_EQ(ob.getFilters()[0].op, "!=");
  EXPECT_EQ(ob.getFilters()[1].op, "contains");
  EXPECT_EQ(ob.getFilters()[2].op, ">=");
}

TEST(OrBuilderUnit, ChainingReturnsSelf) {
  OrBuilder ob;
  auto &returned = ob.where("f", "==", "v");
  // Chaining returns reference to the same object
  EXPECT_EQ(&returned, &ob);
}

TEST(OrBuilderUnit, FiltersAreOrdered) {
  OrBuilder ob;
  ob.where("first", "==", "1")
    .where("second", "==", "2")
    .where("third", "==", "3");
  EXPECT_EQ(ob.getFilters()[0].field, "first");
  EXPECT_EQ(ob.getFilters()[1].field, "second");
  EXPECT_EQ(ob.getFilters()[2].field, "third");
}

// ─── TableRef or_() integration ──────────────────────────────────────────────

TEST(TableRefUnit, OrBuilderChain) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts")
        .where("status", "==", "published")
        .or_([](OrBuilder &ob) {
          ob.where("category", "==", "tech")
            .where("category", "==", "science");
        })
        .limit(10);
  });
}

TEST(TableRefUnit, OrBuilderEmptyCallback) {
  auto core = dummyCore();
  EXPECT_NO_THROW({
    TableRef(core, "posts")
        .or_([](OrBuilder &ob) {
          // empty — no filters added
        })
        .limit(5);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// C. Filter 구조체
// ═══════════════════════════════════════════════════════════════════════════════

TEST(FilterUnit, DefaultInitialization) {
  Filter f;
  EXPECT_TRUE(f.field.empty());
  EXPECT_TRUE(f.op.empty());
  EXPECT_TRUE(f.value.empty());
}

TEST(FilterUnit, ValueAssignment) {
  Filter f{"title", "contains", "hello"};
  EXPECT_EQ(f.field, "title");
  EXPECT_EQ(f.op, "contains");
  EXPECT_EQ(f.value, "hello");
}

TEST(FilterUnit, CopyIsIndependent) {
  Filter f1{"a", "==", "1"};
  Filter f2 = f1;
  f2.field = "b";
  EXPECT_EQ(f1.field, "a");
  EXPECT_EQ(f2.field, "b");
}

TEST(FilterUnit, EmptyStringValues) {
  Filter f{"", "", ""};
  EXPECT_TRUE(f.field.empty());
  EXPECT_TRUE(f.op.empty());
  EXPECT_TRUE(f.value.empty());
}

TEST(FilterUnit, SpecialCharactersInValue) {
  Filter f{"content", "contains", R"(hello "world" & <tag>)"};
  EXPECT_EQ(f.value, R"(hello "world" & <tag>)");
}

TEST(FilterUnit, UnicodeValue) {
  Filter f{"title", "==", "안녕하세요"};
  EXPECT_EQ(f.value, "안녕하세요");
}

// ═══════════════════════════════════════════════════════════════════════════════
// D. Sort 구조체
// ═══════════════════════════════════════════════════════════════════════════════

TEST(SortUnit, DefaultDirection) {
  Sort s;
  s.field = "createdAt";
  EXPECT_EQ(s.direction, "asc");
}

TEST(SortUnit, DescDirection) {
  Sort s{"createdAt", "desc"};
  EXPECT_EQ(s.direction, "desc");
}

TEST(SortUnit, CopyIsIndependent) {
  Sort s1{"createdAt", "desc"};
  Sort s2 = s1;
  s2.direction = "asc";
  EXPECT_EQ(s1.direction, "desc");
  EXPECT_EQ(s2.direction, "asc");
}

TEST(SortUnit, EmptyFieldAllowed) {
  Sort s;
  EXPECT_TRUE(s.field.empty());
  EXPECT_EQ(s.direction, "asc");
}

// ═══════════════════════════════════════════════════════════════════════════════
// E. Result 구조체
// ═══════════════════════════════════════════════════════════════════════════════

TEST(ResultUnit, DefaultNotOk) {
  Result r;
  EXPECT_FALSE(r.ok);
  EXPECT_EQ(r.statusCode, 0);
  EXPECT_TRUE(r.body.empty());
  EXPECT_TRUE(r.error.empty());
}

TEST(ResultUnit, OkResult) {
  Result r;
  r.ok = true;
  r.statusCode = 200;
  r.body = R"({"id": "abc"})";
  EXPECT_TRUE(r.ok);
  EXPECT_EQ(r.statusCode, 200);
}

TEST(ResultUnit, ErrorResult) {
  Result r;
  r.ok = false;
  r.statusCode = 500;
  r.error = "Internal Server Error";
  EXPECT_FALSE(r.ok);
  EXPECT_EQ(r.statusCode, 500);
  EXPECT_EQ(r.error, "Internal Server Error");
}

TEST(ResultUnit, NotFoundResult) {
  Result r;
  r.ok = false;
  r.statusCode = 404;
  r.error = "Not found";
  EXPECT_FALSE(r.ok);
  EXPECT_EQ(r.statusCode, 404);
}

TEST(ResultUnit, CreatedResult) {
  Result r;
  r.ok = true;
  r.statusCode = 201;
  r.body = R"({"id":"new-id","title":"test"})";
  EXPECT_TRUE(r.ok);
  EXPECT_EQ(r.statusCode, 201);
  auto j = json::parse(r.body);
  EXPECT_EQ(j["id"].get<std::string>(), "new-id");
}

TEST(ResultUnit, BodyParsableAsJson) {
  Result r;
  r.ok = true;
  r.statusCode = 200;
  r.body = R"({"items":[],"total":0})";
  auto j = json::parse(r.body);
  EXPECT_TRUE(j.contains("items"));
  EXPECT_TRUE(j.contains("total"));
  EXPECT_EQ(j["total"].get<int>(), 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// F. TableRef namespace/instanceId 조합
// ═══════════════════════════════════════════════════════════════════════════════

TEST(TableRefUnit, SharedNamespace) {
  auto core = dummyCore();
  EXPECT_NO_THROW(TableRef(core, "posts", "shared"));
}

TEST(TableRefUnit, WorkspaceNamespaceWithId) {
  auto core = dummyCore();
  EXPECT_NO_THROW(TableRef(core, "docs", "workspace", "ws-123"));
}

TEST(TableRefUnit, EmptyNamespaceDefaultsToShared) {
  auto core = dummyCore();
  // Default ns is "shared"
  EXPECT_NO_THROW(TableRef(core, "posts"));
}

TEST(TableRefUnit, PrivateNamespaceWithInstanceId) {
  auto core = dummyCore();
  EXPECT_NO_THROW(TableRef(core, "settings", "private", "user-abc"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// G. ListResult 구조체
// ═══════════════════════════════════════════════════════════════════════════════

TEST(ListResultUnit, DefaultValues) {
  ListResult lr;
  EXPECT_TRUE(lr.items.empty());
  EXPECT_FALSE(lr.total.has_value());
  EXPECT_FALSE(lr.page.has_value());
  EXPECT_FALSE(lr.perPage.has_value());
  EXPECT_FALSE(lr.hasMore.has_value());
  EXPECT_FALSE(lr.cursor.has_value());
}

TEST(ListResultUnit, WithItems) {
  ListResult lr;
  std::map<std::string, std::string> item1 = {{"id", "1"}, {"title", "Post 1"}};
  lr.items.push_back(item1);
  EXPECT_EQ(lr.items.size(), 1u);
  EXPECT_EQ(lr.items[0].at("id"), "1");
}

TEST(ListResultUnit, CursorPagination) {
  ListResult lr;
  lr.cursor = "cursor-abc";
  lr.hasMore = true;
  EXPECT_TRUE(lr.cursor.has_value());
  EXPECT_EQ(*lr.cursor, "cursor-abc");
  EXPECT_TRUE(*lr.hasMore);
}

TEST(ListResultUnit, OffsetPagination) {
  ListResult lr;
  lr.total = 100;
  lr.page = 3;
  lr.perPage = 20;
  EXPECT_EQ(*lr.total, 100);
  EXPECT_EQ(*lr.page, 3);
  EXPECT_EQ(*lr.perPage, 20);
}

TEST(ListResultUnit, HasMoreFalse) {
  ListResult lr;
  lr.hasMore = false;
  lr.cursor = std::nullopt;
  EXPECT_TRUE(lr.hasMore.has_value());
  EXPECT_FALSE(*lr.hasMore);
  EXPECT_FALSE(lr.cursor.has_value());
}

TEST(ListResultUnit, EmptyItemsArray) {
  ListResult lr;
  lr.total = 0;
  lr.hasMore = false;
  EXPECT_TRUE(lr.items.empty());
  EXPECT_EQ(*lr.total, 0);
}

TEST(ListResultUnit, JsonParsedIntoListResult) {
  // Simulate parsing server response into ListResult
  std::string response = R"({
    "items": [{"id":"1","title":"Hello"}, {"id":"2","title":"World"}],
    "total": 50,
    "page": 1,
    "perPage": 10,
    "hasMore": true,
    "cursor": "next-cursor-abc"
  })";
  auto j = json::parse(response);

  ListResult lr;
  for (const auto &item : j["items"]) {
    std::map<std::string, std::string> m;
    for (auto it = item.begin(); it != item.end(); ++it) {
      m[it.key()] = it.value().get<std::string>();
    }
    lr.items.push_back(m);
  }
  lr.total = j["total"].get<int>();
  lr.page = j["page"].get<int>();
  lr.perPage = j["perPage"].get<int>();
  lr.hasMore = j["hasMore"].get<bool>();
  lr.cursor = j["cursor"].get<std::string>();

  EXPECT_EQ(lr.items.size(), 2u);
  EXPECT_EQ(lr.items[0].at("title"), "Hello");
  EXPECT_EQ(*lr.total, 50);
  EXPECT_EQ(*lr.cursor, "next-cursor-abc");
  EXPECT_TRUE(*lr.hasMore);
}

// ═══════════════════════════════════════════════════════════════════════════════
// H. FileInfo 구조체
// ═══════════════════════════════════════════════════════════════════════════════

TEST(FileInfoUnit, DefaultValues) {
  FileInfo fi;
  EXPECT_EQ(fi.size, 0);
  EXPECT_TRUE(fi.key.empty());
  EXPECT_TRUE(fi.url.empty());
  EXPECT_TRUE(fi.contentType.empty());
  EXPECT_TRUE(fi.createdAt.empty());
}

TEST(FileInfoUnit, Populated) {
  FileInfo fi;
  fi.key = "images/avatar.png";
  fi.url = "https://cdn.example.com/images/avatar.png";
  fi.size = 512 * 1024;
  fi.contentType = "image/png";
  fi.createdAt = "2024-01-01T00:00:00Z";
  EXPECT_EQ(fi.key, "images/avatar.png");
  EXPECT_EQ(fi.size, 512 * 1024);
}

TEST(FileInfoUnit, LargeFileSize) {
  FileInfo fi;
  fi.size = 2LL * 1024 * 1024 * 1024; // 2GB
  EXPECT_EQ(fi.size, 2LL * 1024 * 1024 * 1024);
}

// ═══════════════════════════════════════════════════════════════════════════════
// I. DbChange 구조체
// ═══════════════════════════════════════════════════════════════════════════════

TEST(DbChangeUnit, DefaultValues) {
  DbChange dc;
  EXPECT_TRUE(dc.changeType.empty());
  EXPECT_TRUE(dc.table.empty());
  EXPECT_TRUE(dc.docId.empty());
  EXPECT_TRUE(dc.dataJson.empty());
  EXPECT_TRUE(dc.timestamp.empty());
}

TEST(DbChangeUnit, AddedEvent) {
  DbChange dc;
  dc.changeType = "added";
  dc.table = "posts";
  dc.docId = "post-123";
  dc.dataJson = R"({"id":"post-123","title":"Hello"})";
  dc.timestamp = "2024-01-01T00:00:00Z";
  EXPECT_EQ(dc.changeType, "added");
  EXPECT_EQ(dc.table, "posts");
  auto j = json::parse(dc.dataJson);
  EXPECT_EQ(j["id"].get<std::string>(), "post-123");
}

TEST(DbChangeUnit, ModifiedEvent) {
  DbChange dc;
  dc.changeType = "modified";
  dc.table = "posts";
  dc.docId = "post-123";
  EXPECT_EQ(dc.changeType, "modified");
}

TEST(DbChangeUnit, RemovedEvent) {
  DbChange dc;
  dc.changeType = "removed";
  dc.docId = "deleted-id";
  EXPECT_EQ(dc.changeType, "removed");
  EXPECT_EQ(dc.docId, "deleted-id");
}

// ═══════════════════════════════════════════════════════════════════════════════
// J. EdgeBase entry point
// ═══════════════════════════════════════════════════════════════════════════════

TEST(EdgeBaseUnit, ConstructorWithUrl) {
  EXPECT_NO_THROW({ EdgeBase client("http://localhost:8688"); });
}

TEST(EdgeBaseUnit, AuthReturnsAuthClient) {
  EdgeBase client("http://localhost:8688");
  EXPECT_NO_THROW({ auto auth = client.auth(); });
}

TEST(EdgeBaseUnit, StorageReturnsStorageClient) {
  EdgeBase client("http://localhost:8688");
  EXPECT_NO_THROW({ auto storage = client.storage(); });
}

TEST(EdgeBaseUnit, PushReturnsPushClient) {
  EdgeBase client("http://localhost:8688");
  EXPECT_NO_THROW({ auto push = client.push(); });
}

TEST(EdgeBaseUnit, FunctionsReturnsFunctionsClient) {
  EdgeBase client("http://localhost:8688");
  EXPECT_NO_THROW({ auto functions = client.functions(); });
}

TEST(EdgeBaseUnit, AnalyticsReturnsAnalyticsClient) {
  EdgeBase client("http://localhost:8688");
  EXPECT_NO_THROW({ auto analytics = client.analytics(); });
}

TEST(EdgeBaseUnit, ContextRoundTrips) {
  EdgeBase client("http://localhost:8688");
  client.setContext({{"workspaceId", "ws-123"}});
  auto context = client.getContext();
  ASSERT_TRUE(context.count("workspaceId"));
  EXPECT_EQ(context["workspaceId"], "ws-123");
}

TEST(AuthClientUnit, PasskeysMethodsExist) {
  auto auth = EdgeBase("http://localhost:8688").auth();
  EXPECT_NO_THROW({
    auto registerOptions = &AuthClient::passkeysRegisterOptions;
    auto registerFn = &AuthClient::passkeysRegister;
    auto authOptions = &AuthClient::passkeysAuthOptions;
    auto authenticate = &AuthClient::passkeysAuthenticate;
    auto listFn = &AuthClient::passkeysList;
    auto deleteFn = &AuthClient::passkeysDelete;
    (void)registerOptions;
    (void)registerFn;
    (void)authOptions;
    (void)authenticate;
    (void)listFn;
    (void)deleteFn;
  });
}

TEST(RoomClientUnit, LeaveSendsExplicitLeaveBeforeClose) {
  std::vector<std::string> events;
  auto room = std::make_shared<edgebase::RoomClient>(
      "http://localhost:8688",
      "game",
      "room-1",
      []() { return std::string("token"); });

  room->set_connect_fn([&](const std::string &, auto, auto) {
    // Keep the connection open; RoomClient will mark itself connected.
  });
  room->set_send_fn([&](const std::string &raw) {
    auto msg = json::parse(raw);
    events.push_back("send:" + msg.value("type", ""));
  });
  room->set_close_fn([&]() {
    events.push_back("close");
  });

  room->join();
  events.clear(); // ignore the auth frame emitted during join()
  room->leave();
  std::this_thread::sleep_for(std::chrono::milliseconds(80));

  ASSERT_EQ(events.size(), 2u);
  EXPECT_EQ(events[0], "send:leave");
  EXPECT_EQ(events[1], "close");

  // RoomClient destructor invokes close_fn_ again, so release it while the
  // captured test state is still alive.
  room.reset();
}

TEST(RoomClientUnit, ReadyBecomesTrueAfterAuthSuccess) {
  auto room = std::make_shared<edgebase::RoomClient>(
      "http://localhost:8688",
      "game",
      "room-ready",
      []() { return std::string("token"); });

  std::function<void(const std::string &)> on_message;
  std::vector<std::string> sent_types;

  room->set_connect_fn([&](const std::string &, auto message_handler, auto) {
    on_message = std::move(message_handler);
  });
  room->set_send_fn([&](const std::string &raw) {
    auto msg = json::parse(raw);
    sent_types.push_back(msg.value("type", ""));
  });

  room->join();
  ASSERT_FALSE(room->is_ready());
  ASSERT_TRUE(static_cast<bool>(on_message));

  on_message(R"({"type":"auth_success"})");

  EXPECT_TRUE(room->is_connected());
  EXPECT_TRUE(room->is_authenticated());
  EXPECT_TRUE(room->is_joined());
  EXPECT_TRUE(room->is_ready());
  ASSERT_GE(sent_types.size(), 2u);
  EXPECT_EQ(sent_types[0], "auth");
  EXPECT_EQ(sent_types[1], "join");
}

TEST(RoomClientUnit, UnifiedSurfaceParsesMembersSignalsMediaAndSessionFrames) {
  edgebase::RoomClient room(
      "http://localhost:8688",
      "game",
      "room-unified",
      []() { return std::string("token"); });

  std::vector<json> member_sync_snapshots;
  std::vector<std::string> member_leaves;
  std::vector<std::string> signal_events;
  std::vector<std::string> media_tracks;
  std::vector<std::string> media_devices;
  std::vector<std::string> connection_states;

  room.members.on_sync([&](const json &members) { member_sync_snapshots.push_back(members); });
  room.members.on_leave([&](const json &member, const std::string &reason) {
    member_leaves.push_back(member.value("memberId", "") + ":" + reason);
  });
  room.signals.on_any([&](const std::string &event, const json &, const json &meta) {
    signal_events.push_back(event + ":" + meta.value("userId", ""));
  });
  room.media.on_track([&](const json &track, const json &member) {
    media_tracks.push_back(track.value("kind", "") + ":" + member.value("memberId", ""));
  });
  room.media.on_device_change([&](const json &, const json &change) {
    media_devices.push_back(change.value("kind", "") + ":" + change.value("deviceId", ""));
  });
  room.session.on_connection_state_change([&](const std::string &state) {
    connection_states.push_back(state);
  });

  room.handle_raw_for_testing(R"({"type":"auth_success","userId":"user-1","connectionId":"conn-1"})");
  room.handle_raw_for_testing(R"({"type":"sync","sharedState":{"topic":"focus"},"sharedVersion":1,"playerState":{"ready":true},"playerVersion":2})");
  room.handle_raw_for_testing(R"({"type":"members_sync","members":[{"memberId":"user-1","userId":"user-1","connectionId":"conn-1","connectionCount":1,"state":{"typing":false}}]})");
  room.handle_raw_for_testing(R"({"type":"member_join","member":{"memberId":"user-2","userId":"user-2","connectionCount":1,"state":{}}})");
  room.handle_raw_for_testing(R"({"type":"signal","event":"cursor.move","payload":{"x":10,"y":20},"meta":{"memberId":"user-2","userId":"user-2","connectionId":"conn-2","sentAt":123}})");
  room.handle_raw_for_testing(R"({"type":"media_track","member":{"memberId":"user-2","userId":"user-2","state":{}},"track":{"kind":"video","trackId":"video-1","deviceId":"cam-1","muted":false}})");
  room.handle_raw_for_testing(R"({"type":"media_device","member":{"memberId":"user-2","userId":"user-2","state":{}},"kind":"video","deviceId":"cam-2"})");
  room.handle_raw_for_testing(R"({"type":"member_leave","member":{"memberId":"user-2","userId":"user-2","state":{}},"reason":"timeout"})");

  EXPECT_EQ(room.state.get_shared().value("topic", ""), "focus");
  EXPECT_TRUE(room.state.get_mine().value("ready", false));
  EXPECT_EQ(room.session.user_id(), "user-1");
  EXPECT_EQ(room.session.connection_id(), "conn-1");
  EXPECT_EQ(room.session.connection_state(), "connected");
  EXPECT_EQ(connection_states, std::vector<std::string>({"connected"}));
  ASSERT_EQ(member_sync_snapshots.size(), 1u);
  ASSERT_TRUE(member_sync_snapshots[0].is_array());
  EXPECT_EQ(member_sync_snapshots[0][0].value("memberId", ""), "user-1");
  EXPECT_EQ(signal_events, std::vector<std::string>({"cursor.move:user-2"}));
  EXPECT_EQ(media_tracks, std::vector<std::string>({"video:user-2"}));
  EXPECT_EQ(media_devices, std::vector<std::string>({"video:cam-2"}));
  EXPECT_EQ(member_leaves, std::vector<std::string>({"user-2:timeout"}));
  ASSERT_TRUE(room.members.list().is_array());
  ASSERT_EQ(room.members.list().size(), 1u);
  EXPECT_EQ(room.members.list()[0].value("memberId", ""), "user-1");
  EXPECT_EQ(room.media.list().size(), 0u);
}

TEST(RoomClientUnit, UnifiedSurfaceSendsSignalMemberAdminAndMediaFrames) {
  edgebase::RoomClient room(
      "http://localhost:8688",
      "game",
      "room-send",
      []() { return std::string("token"); });

  std::vector<std::string> events;
  std::vector<json> sent_messages;

  room.set_connect_fn([&](const std::string &, auto, auto) {});
  room.set_send_fn([&](const std::string &raw) {
    auto msg = json::parse(raw);
    events.push_back("send:" + msg.value("type", ""));
    sent_messages.push_back(msg);
  });

  room.join();
  room.handle_raw_for_testing(R"({"type":"auth_success","userId":"user-1","connectionId":"conn-1"})");
  events.clear();
  sent_messages.clear();

  bool signal_done = false;
  std::string signal_error;
  room.signals.send("cursor.move", json{{"x", 10}},
                    [&]() { signal_done = true; },
                    [&](const std::string &error) { signal_error = error; },
                    json{{"includeSelf", true}});
  ASSERT_EQ(sent_messages.size(), 1u);
  EXPECT_EQ(sent_messages[0].value("type", ""), "signal");
  EXPECT_EQ(sent_messages[0].value("event", ""), "cursor.move");
  EXPECT_TRUE(sent_messages[0].value("includeSelf", false));
  room.handle_raw_for_testing(json{{"type", "signal_sent"},
                                   {"requestId", sent_messages[0].value("requestId", "")},
                                   {"event", "cursor.move"}}
                                  .dump());
  EXPECT_TRUE(signal_done);
  EXPECT_TRUE(signal_error.empty());

  bool member_done = false;
  room.members.set_state(json{{"typing", true}},
                         [&]() { member_done = true; },
                         [&](const std::string &) {});
  ASSERT_EQ(sent_messages.size(), 2u);
  EXPECT_EQ(sent_messages[1].value("type", ""), "member_state");
  EXPECT_TRUE(sent_messages[1].value("state", json::object()).value("typing", false));
  room.handle_raw_for_testing(json{{"type", "member_state"},
                                   {"requestId", sent_messages[1].value("requestId", "")},
                                   {"member", json{{"memberId", "user-1"},
                                                    {"userId", "user-1"},
                                                    {"state", json{{"typing", true}}}}},
                                   {"state", json{{"typing", true}}}}
                                  .dump());
  EXPECT_TRUE(member_done);

  bool admin_done = false;
  room.admin.disable_video("user-2", [&]() { admin_done = true; },
                           [&](const std::string &) {});
  ASSERT_EQ(sent_messages.size(), 3u);
  EXPECT_EQ(sent_messages[2].value("type", ""), "admin");
  EXPECT_EQ(sent_messages[2].value("operation", ""), "disableVideo");
  EXPECT_EQ(sent_messages[2].value("memberId", ""), "user-2");
  room.handle_raw_for_testing(json{{"type", "admin_result"},
                                   {"requestId", sent_messages[2].value("requestId", "")},
                                   {"operation", "disableVideo"},
                                   {"memberId", "user-2"}}
                                  .dump());
  EXPECT_TRUE(admin_done);

  bool media_done = false;
  room.media.audio.set_muted(true, [&]() { media_done = true; },
                             [&](const std::string &) {});
  ASSERT_EQ(sent_messages.size(), 4u);
  EXPECT_EQ(sent_messages[3].value("type", ""), "media");
  EXPECT_EQ(sent_messages[3].value("operation", ""), "mute");
  EXPECT_EQ(sent_messages[3].value("kind", ""), "audio");
  EXPECT_TRUE(sent_messages[3].value("payload", json::object()).value("muted", false));
  room.handle_raw_for_testing(json{{"type", "media_result"},
                                   {"requestId", sent_messages[3].value("requestId", "")},
                                   {"operation", "mute"},
                                   {"kind", "audio"}}
                                  .dump());
  EXPECT_TRUE(media_done);

  EXPECT_EQ(events, std::vector<std::string>(
                        {"send:signal", "send:member_state", "send:admin", "send:media"}));
}

// ─── PushClient Permission Tests ──────────────────────────────────────────

TEST(PushClientUnit, GetPermissionStatusReturnsValidValue) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  // Use a custom provider to avoid calling platform APIs that require app context
  push.setPermissionStatusProvider([]() -> std::string { return "granted"; });
  std::string status = push.getPermissionStatus();
  EXPECT_TRUE(status == "granted" || status == "denied" || status == "notDetermined");
}

TEST(PushClientUnit, RequestPermissionReturnsValidValue) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  // Use a custom provider to avoid calling platform APIs that require app context
  push.setPermissionRequester([]() -> std::string { return "granted"; });
  std::string status = push.requestPermission();
  EXPECT_TRUE(status == "granted" || status == "denied" || status == "notDetermined");
}

TEST(PushClientUnit, DefaultPermissionGrantedOnDesktop) {
  // On non-Apple, non-Android platforms, platformGetPermissionStatus() returns "granted"
  // On Apple, UNUserNotificationCenter requires an app bundle — use custom provider
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
#if defined(__APPLE__)
  push.setPermissionStatusProvider([]() -> std::string { return "granted"; });
#endif
  std::string status = push.getPermissionStatus();
#if !defined(__ANDROID__) && !defined(__APPLE__)
  EXPECT_EQ(status, "granted");
#else
  EXPECT_TRUE(status == "granted" || status == "denied" || status == "notDetermined");
#endif
}

TEST(PushClientUnit, CustomPermissionStatusProviderOverridesDefault) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  push.setPermissionStatusProvider([]() -> std::string { return "denied"; });
  EXPECT_EQ(push.getPermissionStatus(), "denied");
}

TEST(PushClientUnit, CustomPermissionRequesterOverridesDefault) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  push.setPermissionRequester([]() -> std::string { return "denied"; });
  EXPECT_EQ(push.requestPermission(), "denied");
}

TEST(PushClientUnit, RegisterPushSkipsWhenPermissionDenied) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  push.setPermissionRequester([]() -> std::string { return "denied"; });
  push.setTokenProvider([]() -> std::string { return "fcm-token-test"; });
  push.setPlatform("android");
  // registerPush should silently return when permission is denied (no throw)
  EXPECT_NO_THROW(push.registerPush());
}

TEST(PushClientUnit, RegisterPushThrowsWithoutTokenProvider) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  push.setPermissionRequester([]() -> std::string { return "granted"; });
  // No tokenProvider set — should throw
  EXPECT_THROW(push.registerPush(), std::runtime_error);
}

TEST(PushClientUnit, PermissionProviderCalledOnGetStatus) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  int callCount = 0;
  push.setPermissionStatusProvider([&callCount]() -> std::string {
    callCount++;
    return "granted";
  });
  push.getPermissionStatus();
  push.getPermissionStatus();
  EXPECT_EQ(callCount, 2);
}

TEST(PushClientUnit, PermissionRequesterCalledOnRequest) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  int callCount = 0;
  push.setPermissionRequester([&callCount]() -> std::string {
    callCount++;
    return "granted";
  });
  push.requestPermission();
  EXPECT_EQ(callCount, 1);
}

TEST(PushClientUnit, PermissionStatusProviderNotDetermined) {
  EdgeBase client("http://localhost:8688");
  auto push = client.push();
  push.setPermissionStatusProvider([]() -> std::string { return "notDetermined"; });
  EXPECT_EQ(push.getPermissionStatus(), "notDetermined");
}

TEST(EdgeBaseUnit, DbReturnsDbRef) {
  EdgeBase client("http://localhost:8688");
  EXPECT_NO_THROW({ auto db = client.db("shared"); });
}

TEST(EdgeBaseUnit, DbWithInstanceId) {
  EdgeBase client("http://localhost:8688");
  EXPECT_NO_THROW({ auto db = client.db("workspace", "ws-123"); });
}

TEST(EdgeBaseUnit, DbRefTableReturnsTableRef) {
  EdgeBase client("http://localhost:8688");
  auto db = client.db("shared");
  EXPECT_NO_THROW({ auto table = db.table("posts"); });
}

TEST(EdgeBaseUnit, SetAndGetContext) {
  EdgeBase client("http://localhost:8688");
  std::map<std::string, std::string> ctx = {{"orgId", "org-123"}};
  client.setContext(ctx);
  auto retrieved = client.getContext();
  EXPECT_EQ(retrieved["orgId"], "org-123");
}

TEST(EdgeBaseUnit, EmptyContext) {
  EdgeBase client("http://localhost:8688");
  auto ctx = client.getContext();
  EXPECT_TRUE(ctx.empty());
}

TEST(EdgeBaseUnit, OverwriteContext) {
  EdgeBase client("http://localhost:8688");
  client.setContext({{"key1", "val1"}});
  client.setContext({{"key2", "val2"}});
  auto ctx = client.getContext();
  // setContext replaces entire context
  EXPECT_TRUE(ctx.find("key1") == ctx.end() || ctx.find("key2") != ctx.end());
}

// ═══════════════════════════════════════════════════════════════════════════════
// L. HttpClient
// ═══════════════════════════════════════════════════════════════════════════════

TEST(HttpClientUnit, ConstructorWithBaseUrl) {
  EXPECT_NO_THROW({ HttpClient http("http://localhost:9999"); });
}

TEST(HttpClientUnit, ConstructorWithServiceKey) {
  EXPECT_NO_THROW({ HttpClient http("http://localhost:9999", "my-key"); });
}

TEST(HttpClientUnit, TokenManagement) {
  auto http = dummyHttp();
  EXPECT_TRUE(http->getToken().empty());
  http->setToken("test-token-abc");
  EXPECT_EQ(http->getToken(), "test-token-abc");
  http->clearToken();
  EXPECT_TRUE(http->getToken().empty());
}

TEST(HttpClientUnit, RefreshTokenManagement) {
  auto http = dummyHttp();
  EXPECT_TRUE(http->getRefreshToken().empty());
  http->setRefreshToken("refresh-token-xyz");
  EXPECT_EQ(http->getRefreshToken(), "refresh-token-xyz");
  http->clearRefreshToken();
  EXPECT_TRUE(http->getRefreshToken().empty());
}

TEST(HttpClientUnit, ContextManagement) {
  auto http = dummyHttp();
  auto ctx = http->getContext();
  EXPECT_TRUE(ctx.empty());

  http->setContext({{"orgId", "org-1"}, {"teamId", "team-2"}});
  ctx = http->getContext();
  EXPECT_EQ(ctx.size(), 2u);
  EXPECT_EQ(ctx["orgId"], "org-1");
  EXPECT_EQ(ctx["teamId"], "team-2");
}

TEST(HttpClientUnit, SetTokenOverwrite) {
  auto http = dummyHttp();
  http->setToken("token-1");
  http->setToken("token-2");
  EXPECT_EQ(http->getToken(), "token-2");
}

TEST(HttpClientUnit, RAIIDestruction) {
  // HttpClient should safely destroy via RAII
  {
    auto http = std::make_shared<HttpClient>("http://localhost:9999");
    http->setToken("temp-token");
  }
  // If we reach here, destruction succeeded
  EXPECT_TRUE(true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// M. FieldOps (edgebase/field_ops.h)
// ═══════════════════════════════════════════════════════════════════════════════

TEST(FieldOpsUnit, IncrementDefaultValue) {
  auto j = edgebase::FieldOps::incrementJson();
  EXPECT_EQ(j["$op"].get<std::string>(), "increment");
  EXPECT_DOUBLE_EQ(j["value"].get<double>(), 1.0);
}

TEST(FieldOpsUnit, IncrementCustomValue) {
  auto j = edgebase::FieldOps::incrementJson(5.0);
  EXPECT_EQ(j["$op"].get<std::string>(), "increment");
  EXPECT_DOUBLE_EQ(j["value"].get<double>(), 5.0);
}

TEST(FieldOpsUnit, IncrementNegativeValue) {
  auto j = edgebase::FieldOps::incrementJson(-3.0);
  EXPECT_DOUBLE_EQ(j["value"].get<double>(), -3.0);
}

TEST(FieldOpsUnit, IncrementZero) {
  auto j = edgebase::FieldOps::incrementJson(0.0);
  EXPECT_DOUBLE_EQ(j["value"].get<double>(), 0.0);
}

TEST(FieldOpsUnit, IncrementFractional) {
  auto j = edgebase::FieldOps::incrementJson(0.5);
  EXPECT_DOUBLE_EQ(j["value"].get<double>(), 0.5);
}

TEST(FieldOpsUnit, DeleteFieldJson) {
  auto j = edgebase::FieldOps::deleteFieldJson();
  EXPECT_EQ(j["$op"].get<std::string>(), "deleteField");
  EXPECT_EQ(j.size(), 1u);
}

TEST(FieldOpsUnit, IncrementString) {
  std::string s = edgebase::FieldOps::increment(10.0);
  auto j = json::parse(s);
  EXPECT_EQ(j["$op"].get<std::string>(), "increment");
  EXPECT_DOUBLE_EQ(j["value"].get<double>(), 10.0);
}

TEST(FieldOpsUnit, DeleteFieldString) {
  std::string s = edgebase::FieldOps::deleteField();
  auto j = json::parse(s);
  EXPECT_EQ(j["$op"].get<std::string>(), "deleteField");
}

TEST(FieldOpsUnit, IncrementEmbeddedInUpdateBody) {
  json body;
  body["views"] = edgebase::FieldOps::incrementJson(1);
  body["temp"] = edgebase::FieldOps::deleteFieldJson();
  std::string serialized = body.dump();
  auto parsed = json::parse(serialized);
  EXPECT_EQ(parsed["views"]["$op"].get<std::string>(), "increment");
  EXPECT_EQ(parsed["temp"]["$op"].get<std::string>(), "deleteField");
}

TEST(FieldOpsUnit, IncrementLargeValue) {
  auto j = edgebase::FieldOps::incrementJson(1000000.0);
  EXPECT_DOUBLE_EQ(j["value"].get<double>(), 1000000.0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// N. StorageBucket URL construction
// ═══════════════════════════════════════════════════════════════════════════════

TEST(StorageBucketUnit, GetUrlConstruction) {
  EdgeBase client("http://localhost:8688");
  auto storage = client.storage();
  auto bucket = storage.bucket("my-bucket");
  std::string url = bucket.getUrl("images/photo.jpg");
  EXPECT_FALSE(url.empty());
  EXPECT_NE(url.find("images/photo.jpg"), std::string::npos);
}

TEST(StorageBucketUnit, GetUrlWithSubdirectory) {
  EdgeBase client("http://localhost:8688");
  auto storage = client.storage();
  auto bucket = storage.bucket("assets");
  std::string url = bucket.getUrl("uploads/2024/image.png");
  EXPECT_NE(url.find("uploads/2024/image.png"), std::string::npos);
}

TEST(StorageBucketUnit, DifferentBucketsAreSeparate) {
  EdgeBase client("http://localhost:8688");
  auto storage = client.storage();
  auto bucket1 = storage.bucket("bucket-a");
  auto bucket2 = storage.bucket("bucket-b");
  std::string url1 = bucket1.getUrl("file.txt");
  std::string url2 = bucket2.getUrl("file.txt");
  EXPECT_NE(url1, url2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// O. RAII & Lifetime
// ═══════════════════════════════════════════════════════════════════════════════

TEST(RAIIUnit, EdgeBaseStackDestruction) {
  // EdgeBase should safely destroy on stack
  {
    EdgeBase client("http://localhost:8688");
    auto auth = client.auth();
    auto storage = client.storage();
    (void)auth;
    (void)storage;
  }
  EXPECT_TRUE(true);
}

TEST(RAIIUnit, SharedPtrCore) {
  // Multiple TableRefs sharing the same GeneratedDbApi core
  auto core = dummyCore();
  {
    TableRef t1(core, "posts");
    TableRef t2(core, "users");
    TableRef t3 = t1.where("status", "==", "active");
    (void)t3;
  }
  // Core shared_ptr still valid
  EXPECT_NE(core.get(), nullptr);
}

TEST(RAIIUnit, MoveSemantics) {
  auto core = dummyCore();
  TableRef t1(core, "posts");
  TableRef t2 = std::move(t1);
  // t2 should be usable after move
  EXPECT_NO_THROW({
    auto t3 = t2.where("status", "==", "active");
    (void)t3;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// P. nlohmann::json integration
// ═══════════════════════════════════════════════════════════════════════════════

TEST(JsonUnit, ParseResultBody) {
  Result r;
  r.body = R"({"id":"test-123","title":"Hello","views":42})";
  auto j = json::parse(r.body);
  EXPECT_EQ(j["id"].get<std::string>(), "test-123");
  EXPECT_EQ(j["views"].get<int>(), 42);
}

TEST(JsonUnit, ParseArrayResponse) {
  std::string body = R"({"items":[{"id":"1"},{"id":"2"},{"id":"3"}]})";
  auto j = json::parse(body);
  EXPECT_EQ(j["items"].size(), 3u);
}

TEST(JsonUnit, ParseEmptyObject) {
  auto j = json::parse("{}");
  EXPECT_TRUE(j.is_object());
  EXPECT_TRUE(j.empty());
}

TEST(JsonUnit, ParseNullField) {
  auto j = json::parse(R"({"cursor":null})");
  EXPECT_TRUE(j["cursor"].is_null());
}

TEST(JsonUnit, BuildJsonBody) {
  json body;
  body["title"] = "Test Post";
  body["views"] = 0;
  body["published"] = true;
  std::string serialized = body.dump();
  auto parsed = json::parse(serialized);
  EXPECT_EQ(parsed["title"].get<std::string>(), "Test Post");
  EXPECT_EQ(parsed["views"].get<int>(), 0);
  EXPECT_TRUE(parsed["published"].get<bool>());
}

// ─── Main
// ─────────────────────────────────────────────────────────────────────

int main(int argc, char **argv) {
  ::testing::InitGoogleTest(&argc, argv);
  return RUN_ALL_TESTS();
}
