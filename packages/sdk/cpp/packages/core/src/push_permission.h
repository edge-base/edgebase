// Internal push permission platform abstractions.
// Implemented per-platform:
//   push_permission_ios.mm    — iOS/macOS via UNUserNotificationCenter
//   push_permission_default.cpp — Other platforms (returns sensible defaults)

#pragma once
#include <string>

namespace client {
namespace internal {

/// Get the current notification permission status from the OS.
/// Returns "granted", "denied", or "notDetermined".
std::string platformGetPermissionStatus();

/// Request notification permission from the OS.
/// Returns "granted", "denied", or "notDetermined".
std::string platformRequestPermission();

} // namespace internal
} // namespace client
