// Platform push permission — iOS/macOS via UNUserNotificationCenter.
// Compiled only on Apple platforms (see CMakeLists.txt).

#import <UserNotifications/UserNotifications.h>
#include "push_permission.h"
#include <dispatch/dispatch.h>

namespace client {
namespace internal {

std::string platformGetPermissionStatus() {
    __block std::string result = "notDetermined";
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[UNUserNotificationCenter currentNotificationCenter]
        getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
        switch (settings.authorizationStatus) {
            case UNAuthorizationStatusAuthorized:
            case UNAuthorizationStatusProvisional:
                result = "granted";
                break;
            case UNAuthorizationStatusDenied:
                result = "denied";
                break;
            default:
                // Covers UNAuthorizationStatusEphemeral (iOS 14+ only, unavailable on macOS)
                // and any future statuses
                if ((NSInteger)settings.authorizationStatus > UNAuthorizationStatusProvisional) {
                    result = "granted";
                } else {
                    result = "notDetermined";
                }
                break;
        }
        dispatch_semaphore_signal(sem);
    }];

    // Wait up to 5 seconds for the async callback
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    return result;
}

std::string platformRequestPermission() {
    // If already granted, skip the request
    std::string current = platformGetPermissionStatus();
    if (current == "granted") return "granted";
    if (current == "denied") return "denied";

    __block std::string result = "notDetermined";
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    UNAuthorizationOptions options = UNAuthorizationOptionAlert |
                                     UNAuthorizationOptionSound |
                                     UNAuthorizationOptionBadge;

    [[UNUserNotificationCenter currentNotificationCenter]
        requestAuthorizationWithOptions:options
        completionHandler:^(BOOL granted, NSError *error) {
        result = granted ? "granted" : "denied";
        dispatch_semaphore_signal(sem);
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    return result;
}

} // namespace internal
} // namespace client
