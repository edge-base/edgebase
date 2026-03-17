// EdgeBase C++ SDK — Atomic field operation helpers.
// Usage:
//   client.db("shared").table("posts").update("id1",
//       R"({"views":)" + edgebase::FieldOps::increment(1) + R"(})");
//
//   // Or build with nlohmann::json:
//   nlohmann::json body;
//   body["views"] = edgebase::FieldOps::incrementJson(1);
//   body["temp"]  = edgebase::FieldOps::deleteFieldJson();
//   client.db("shared").table("posts").update("id1", body.dump());

#pragma once

#include <nlohmann/json.hpp>
#include <string>

namespace edgebase {
namespace FieldOps {

/// Increment a numeric field atomically (returns JSON object).
/// Server: field = COALESCE(field, 0) + value.
inline nlohmann::json incrementJson(double value = 1.0) {
  return {{"$op", "increment"}, {"value", value}};
}

/// Delete a field / set to NULL (returns JSON object).
/// Server: field = NULL.
inline nlohmann::json deleteFieldJson() { return {{"$op", "deleteField"}}; }

/// Increment — returns serialized JSON string for raw update calls.
inline std::string increment(double value = 1.0) {
  return incrementJson(value).dump();
}

/// DeleteField — returns serialized JSON string for raw update calls.
inline std::string deleteField() { return deleteFieldJson().dump(); }

} // namespace FieldOps
} // namespace edgebase
