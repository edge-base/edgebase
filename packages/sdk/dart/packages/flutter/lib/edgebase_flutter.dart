/// EdgeBase Flutter SDK — client-side auth, database live, room, and app helpers.
library;

export 'src/client.dart';
export 'src/auth_client.dart';
export 'src/analytics_client.dart';
export 'src/functions_client.dart';
export 'src/token_manager.dart';
export 'src/room_client.dart' hide MessageHandler;
export 'src/captcha_provider.dart' show resolveCaptchaToken;

// Re-export core types for ergonomic single-import usage.
export 'package:edgebase_core/edgebase_core.dart'
    hide FilterTuple;

// NOTE: edgebase_admin is not re-exported here to avoid PushClient name
// conflicts. Import `package:edgebase_admin/edgebase_admin.dart` separately for
// trusted server-side admin operations.
