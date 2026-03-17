// EdgeBase C++ Core — TableRef implementation.
// All HTTP calls delegate to GeneratedDbApi (api_core.h).
// No hardcoded API paths — the generated core is the single source of truth.
#include "edgebase/edgebase.h"
#include <nlohmann/json.hpp>
#include <sstream>
#include <stdexcept>

namespace client {

static std::string buildDatabaseLiveChannel(const std::string &ns,
                                        const std::string &instanceId,
                                        const std::string &table) {
  return instanceId.empty() ? "dblive:" + ns + ":" + table
                            : "dblive:" + ns + ":" + instanceId + ":" + table;
}

TableRef::TableRef(std::shared_ptr<GeneratedDbApi> core, std::string name,
                   std::string ns, std::string instanceId,
                   std::shared_ptr<DatabaseLiveClient> databaseLive)
    : core_(std::move(core)), name_(std::move(name)), ns_(std::move(ns)),
      instanceId_(std::move(instanceId)), databaseLive_(std::move(databaseLive)) {}

TableRef TableRef::where(const std::string &field, const std::string &op,
                         const std::string &value) const {
  auto c = *this;
  c.filters_.push_back({field, op, value});
  return c;
}

TableRef TableRef::or_(std::function<void(OrBuilder &)> builderFn) const {
  auto c = *this;
  OrBuilder builder;
  builderFn(builder);
  for (const auto &f : builder.getFilters()) {
    c.orFilters_.push_back(f);
  }
  return c;
}

TableRef TableRef::orderBy(const std::string &field,
                           const std::string &direction) const {
  auto c = *this;
  c.sorts_.push_back({field, direction});
  return c;
}

TableRef TableRef::limit(int n) const {
  auto c = *this;
  c.limitVal_ = n;
  return c;
}

TableRef TableRef::offset(int n) const {
  auto c = *this;
  c.offsetVal_ = n;
  return c;
}

TableRef TableRef::page(int n) const {
  if (afterCursor_ || beforeCursor_)
    throw std::invalid_argument("Cannot combine page() with after()/before()");
  auto c = *this;
  c.pageVal_ = n;
  return c;
}

TableRef TableRef::after(const std::string &cursor) const {
  if (pageVal_ >= 0 || offsetVal_ >= 0)
    throw std::invalid_argument("Cannot combine after() with page()/offset()");
  auto c = *this;
  c.afterCursor_ = cursor;
  c.beforeCursor_.reset();
  return c;
}

TableRef TableRef::before(const std::string &cursor) const {
  if (pageVal_ >= 0 || offsetVal_ >= 0)
    throw std::invalid_argument("Cannot combine before() with page()/offset()");
  auto c = *this;
  c.beforeCursor_ = cursor;
  c.afterCursor_.reset();
  return c;
}

TableRef TableRef::search(const std::string &q) const {
  auto c = *this;
  c.searchQ_ = q;
  return c;
}

TableRef TableRef::doc(const std::string &id) const {
  return where("id", "==", id);
}

// ── Query parameter builder ─────────────────────────────────────────────────

std::map<std::string, std::string> TableRef::buildQueryParams() const {
  std::map<std::string, std::string> params;

  // Filters — bracket notation: filter[0][field]=..., filter[0][op]=..., etc.
  for (size_t i = 0; i < filters_.size(); ++i) {
    params["filter[" + std::to_string(i) + "][field]"] = filters_[i].field;
    params["filter[" + std::to_string(i) + "][op]"] = filters_[i].op;
    params["filter[" + std::to_string(i) + "][value]"] = filters_[i].value;
  }
  for (size_t i = 0; i < orFilters_.size(); ++i) {
    params["orFilter[" + std::to_string(i) + "][field]"] = orFilters_[i].field;
    params["orFilter[" + std::to_string(i) + "][op]"] = orFilters_[i].op;
    params["orFilter[" + std::to_string(i) + "][value]"] = orFilters_[i].value;
  }

  // Sort — orderBy=field&order=direction (server API format)
  if (!sorts_.empty()) {
    params["orderBy"] = sorts_[0].field;
    params["order"] = sorts_[0].direction;
  }
  if (limitVal_ > 0)
    params["limit"] = std::to_string(limitVal_);
  if (offsetVal_ >= 0)
    params["offset"] = std::to_string(offsetVal_);
  if (pageVal_ >= 0)
    params["page"] = std::to_string(pageVal_);
  if (afterCursor_)
    params["after"] = *afterCursor_;
  if (beforeCursor_)
    params["before"] = *beforeCursor_;

  return params;
}

// ── Core dispatch helpers ───────────────────────────────────────────────────
// Each helper dispatches to either db_single_* or db_* based on isDynamic().

static Result coreList(const GeneratedDbApi &core, bool dynamic,
                       const std::string &ns, const std::string &instanceId,
                       const std::string &table,
                       const std::map<std::string, std::string> &query) {
  if (dynamic)
    return core.db_list_records(ns, instanceId, table, query);
  return core.db_single_list_records(ns, table, query);
}

static Result coreSearch(const GeneratedDbApi &core, bool dynamic,
                         const std::string &ns, const std::string &instanceId,
                         const std::string &table,
                         const std::map<std::string, std::string> &query) {
  if (dynamic)
    return core.db_search_records(ns, instanceId, table, query);
  return core.db_single_search_records(ns, table, query);
}

static Result coreGetRecord(const GeneratedDbApi &core, bool dynamic,
                            const std::string &ns,
                            const std::string &instanceId,
                            const std::string &table, const std::string &id,
                            const std::map<std::string, std::string> &query) {
  if (dynamic)
    return core.db_get_record(ns, instanceId, table, id, query);
  return core.db_single_get_record(ns, table, id, query);
}

static Result coreInsert(const GeneratedDbApi &core, bool dynamic,
                         const std::string &ns, const std::string &instanceId,
                         const std::string &table, const std::string &body,
                         const std::map<std::string, std::string> &query) {
  if (dynamic)
    return core.db_insert_record(ns, instanceId, table, body, query);
  return core.db_single_insert_record(ns, table, body, query);
}

static Result coreUpdate(const GeneratedDbApi &core, bool dynamic,
                         const std::string &ns, const std::string &instanceId,
                         const std::string &table, const std::string &id,
                         const std::string &body) {
  if (dynamic)
    return core.db_update_record(ns, instanceId, table, id, body);
  return core.db_single_update_record(ns, table, id, body);
}

static Result coreDelete(const GeneratedDbApi &core, bool dynamic,
                         const std::string &ns, const std::string &instanceId,
                         const std::string &table, const std::string &id) {
  if (dynamic)
    return core.db_delete_record(ns, instanceId, table, id);
  return core.db_single_delete_record(ns, table, id);
}

static Result coreCount(const GeneratedDbApi &core, bool dynamic,
                        const std::string &ns, const std::string &instanceId,
                        const std::string &table,
                        const std::map<std::string, std::string> &query) {
  if (dynamic)
    return core.db_count_records(ns, instanceId, table, query);
  return core.db_single_count_records(ns, table, query);
}

static Result coreBatch(const GeneratedDbApi &core, bool dynamic,
                        const std::string &ns, const std::string &instanceId,
                        const std::string &table, const std::string &body,
                        const std::map<std::string, std::string> &query) {
  if (dynamic)
    return core.db_batch_records(ns, instanceId, table, body, query);
  return core.db_single_batch_records(ns, table, body, query);
}

static Result coreBatchByFilter(
    const GeneratedDbApi &core, bool dynamic, const std::string &ns,
    const std::string &instanceId, const std::string &table,
    const std::string &body,
    const std::map<std::string, std::string> &query) {
  if (dynamic)
    return core.db_batch_by_filter(ns, instanceId, table, body, query);
  return core.db_single_batch_by_filter(ns, table, body, query);
}

// ── CRUD ────────────────────────────────────────────────────────────────────

Result TableRef::getList() const {
  auto query = buildQueryParams();
  if (!searchQ_.empty()) {
    query["search"] = searchQ_;
    return coreSearch(*core_, isDynamic(), ns_, instanceId_, name_, query);
  }
  return coreList(*core_, isDynamic(), ns_, instanceId_, name_, query);
}

Result TableRef::getFirst() const {
  auto result = limit(1).getList();
  if (!result.ok)
    return result;
  // Parse items[0] from the response JSON
  try {
    auto json = nlohmann::json::parse(result.body);
    auto items = json.value("items", nlohmann::json::array());
    if (items.empty()) {
      return {true, result.statusCode, "null", ""};
    }
    return {true, result.statusCode, items[0].dump(), ""};
  } catch (...) {
    return {true, result.statusCode, "null", ""};
  }
}

Result TableRef::getOne(const std::string &id) const {
  return coreGetRecord(*core_, isDynamic(), ns_, instanceId_, name_, id, {});
}

Result TableRef::insert(const std::string &jsonBody) const {
  return coreInsert(*core_, isDynamic(), ns_, instanceId_, name_, jsonBody, {});
}

Result TableRef::update(const std::string &id,
                        const std::string &jsonBody) const {
  return coreUpdate(*core_, isDynamic(), ns_, instanceId_, name_, id, jsonBody);
}

Result TableRef::del(const std::string &id) const {
  return coreDelete(*core_, isDynamic(), ns_, instanceId_, name_, id);
}

Result TableRef::upsert(const std::string &jsonBody,
                        const std::string &conflictTarget) const {
  std::map<std::string, std::string> query;
  query["upsert"] = "true";
  if (!conflictTarget.empty())
    query["conflictTarget"] = conflictTarget;
  return coreInsert(*core_, isDynamic(), ns_, instanceId_, name_, jsonBody,
                    query);
}

Result TableRef::count() const {
  auto query = buildQueryParams();
  return coreCount(*core_, isDynamic(), ns_, instanceId_, name_, query);
}

// ── Batch ───────────────────────────────────────────────────────────────────

Result TableRef::insertMany(const std::string &jsonArray) const {
  return coreBatch(*core_, isDynamic(), ns_, instanceId_, name_, jsonArray, {});
}

Result TableRef::upsertMany(const std::string &jsonArray,
                            const std::string &conflictTarget) const {
  std::map<std::string, std::string> query;
  query["upsert"] = "true";
  if (!conflictTarget.empty())
    query["conflictTarget"] = conflictTarget;
  return coreBatch(*core_, isDynamic(), ns_, instanceId_, name_, jsonArray,
                   query);
}

Result TableRef::updateMany(const std::string &jsonBody) const {
  if (filters_.empty())
    return {false, 0, "", "updateMany() requires at least one where() filter"};
  nlohmann::json updateData = nlohmann::json::parse(jsonBody);
  nlohmann::json requestBody;
  requestBody["action"] = "update";
  requestBody["update"] = updateData;
  // Server expects FilterTuple format: [field, op, value]
  nlohmann::json filtersJson = nlohmann::json::array();
  for (const auto &f : filters_)
    filtersJson.push_back(nlohmann::json::array({f.field, f.op, f.value}));
  requestBody["filter"] = filtersJson;
  if (!orFilters_.empty()) {
    nlohmann::json orFiltersJson = nlohmann::json::array();
    for (const auto &f : orFilters_)
      orFiltersJson.push_back(nlohmann::json::array({f.field, f.op, f.value}));
    requestBody["orFilter"] = orFiltersJson;
  }
  return coreBatchByFilter(*core_, isDynamic(), ns_, instanceId_, name_,
                           requestBody.dump(), {});
}

Result TableRef::deleteMany() const {
  if (filters_.empty())
    return {false, 0, "", "deleteMany() requires at least one where() filter"};
  nlohmann::json requestBody;
  requestBody["action"] = "delete";
  // Server expects FilterTuple format: [field, op, value]
  nlohmann::json filtersJson = nlohmann::json::array();
  for (const auto &f : filters_)
    filtersJson.push_back(nlohmann::json::array({f.field, f.op, f.value}));
  requestBody["filter"] = filtersJson;
  if (!orFilters_.empty()) {
    nlohmann::json orFiltersJson = nlohmann::json::array();
    for (const auto &f : orFilters_)
      orFiltersJson.push_back(nlohmann::json::array({f.field, f.op, f.value}));
    requestBody["orFilter"] = orFiltersJson;
  }
  return coreBatchByFilter(*core_, isDynamic(), ns_, instanceId_, name_,
                           requestBody.dump(), {});
}

int TableRef::onSnapshot(std::function<void(const DbChange &)> handler) const {
  if (!databaseLive_) {
    throw std::runtime_error(
        "onSnapshot() is not available in this SDK surface. Use the client SDK to open database-live subscriptions.");
  }

  std::vector<FilterTuple> serverFilters;
  serverFilters.reserve(filters_.size());
  for (const auto &filter : filters_) {
    serverFilters.push_back({filter.field, filter.op, filter.value});
  }

  std::vector<FilterTuple> serverOrFilters;
  serverOrFilters.reserve(orFilters_.size());
  for (const auto &filter : orFilters_) {
    serverOrFilters.push_back({filter.field, filter.op, filter.value});
  }

  return databaseLive_->onSnapshot(buildDatabaseLiveChannel(ns_, instanceId_, name_),
                               std::move(handler), serverFilters,
                               serverOrFilters);
}

void TableRef::unsubscribe(int id) const {
  if (!databaseLive_) {
    throw std::runtime_error(
        "unsubscribe() is not available in this SDK surface. Use the client SDK to open database-live subscriptions.");
  }

  databaseLive_->unsubscribe(id);
}

} // namespace client
