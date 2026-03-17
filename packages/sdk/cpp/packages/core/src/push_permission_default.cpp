// Platform push permission — Default implementation for non-Apple platforms.
// Android: permission must be handled via JNI or setPermissionRequester().
// Windows/Linux: no runtime permission needed, returns "granted".

#include "push_permission.h"

namespace client {
namespace internal {

std::string platformGetPermissionStatus() {
    // Android JNI integration would go here.
    // For now, return "notDetermined" — the developer can override via
    // setPermissionStatusProvider() for Android, or the SDK defaults to
    // "granted" on desktop platforms where no permission is needed.
#ifdef __ANDROID__
    return "notDetermined";
#else
    return "granted";
#endif
}

std::string platformRequestPermission() {
    // Android JNI integration would go here.
    // For now, return "granted" on desktop (no permission needed)
    // or "notDetermined" on Android (developer must set provider).
#ifdef __ANDROID__
    return "notDetermined";
#else
    return "granted";
#endif
}

} // namespace internal
} // namespace client
