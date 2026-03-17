/// EdgeBase Dart SDK — Flutter 클라이언트 SDK 통합 진입점.
///
/// 이 패키지는 edgebase_flutter(인증, 실시간, 푸시)와
/// edgebase_core(HTTP, TableRef, Storage)를 하나로 묶어 제공합니다.
///
/// Usage:
/// ```dart
/// import 'package:edgebase/edgebase.dart';
/// ```
library edgebase;

export 'package:edgebase_core/edgebase_core.dart';
export 'package:edgebase_flutter/src/auth_client.dart';
export 'package:edgebase_flutter/src/token_manager.dart';
export 'package:edgebase_flutter/src/database_live_client.dart';
export 'package:edgebase_flutter/src/push_client.dart';
export 'package:edgebase_flutter/src/captcha_provider.dart' show resolveCaptchaToken;
