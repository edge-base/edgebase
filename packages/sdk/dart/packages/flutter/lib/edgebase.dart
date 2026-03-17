/// EdgeBase Flutter SDK — client-side auth, database live, room, and app helpers.
library;

export 'src/client.dart';  // EdgeBase, ClientEdgeBase, JuneClientOptions
export 'src/auth_client.dart';  // AuthClient, SignUpOptions, SignInOptions, AuthResult, etc.
export 'src/analytics_client.dart';
export 'src/functions_client.dart';
export 'src/token_manager.dart'; // MemoryTokenStorage, SharedPrefsTokenStorage, TokenManager
export 'src/room_client.dart' hide MessageHandler;
export 'src/captcha_provider.dart' show resolveCaptchaToken;
// Core types (re-exported for ergonomic single-import usage)
export 'package:edgebase_core/edgebase_core.dart' hide FilterTuple, TokenManager, TokenPair, TokenStorage;
// NOTE: edgebase_admin is NOT re-exported here to avoid PushClient name conflict.
// Import `package:edgebase_admin/edgebase_admin.dart` separately for server-side admin ops.
