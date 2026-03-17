/// EdgeBase Admin SDK — admin auth, KV, D1, Vectorize, Broadcast.
library;

export 'src/admin_edgebase.dart';
export 'src/admin_auth_client.dart';
export 'src/kv_client.dart';
export 'src/d1_client.dart';
export 'src/vectorize_client.dart';
export 'src/push_client.dart';
export 'src/broadcast_client.dart';
export 'src/functions_client.dart';
export 'src/analytics_client.dart';
// Re-export core field ops so tests importing only edgebase_admin can use increment/deleteField
export 'package:edgebase_core/src/field_ops.dart';
// Re-export core errors so consumers can catch EdgeBaseError
export 'package:edgebase_core/src/errors.dart';
