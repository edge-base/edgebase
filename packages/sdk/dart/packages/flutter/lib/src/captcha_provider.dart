/// Captcha provider — conditional import for platform-specific Turnstile implementation.
///: Auto-captcha across all platforms.
///
/// Web: Uses dart:html to load Turnstile JS SDK directly.
/// Native (Android/iOS/macOS/Windows/Linux): Uses flutter_inappwebview HeadlessInAppWebView.
export 'captcha_stub.dart'
    if (dart.library.html) 'captcha_web.dart'
    if (dart.library.ui) 'captcha_native.dart';
