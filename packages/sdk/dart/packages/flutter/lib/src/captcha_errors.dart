import 'package:edgebase_core/edgebase_core.dart';

/// Local runtime failure while CAPTCHA is configured but cannot produce a token.
class CaptchaUnavailableException extends EdgeBaseError {
  final String reason;
  final Object? cause;

  CaptchaUnavailableException(this.reason, {this.cause})
      : super(
          'CAPTCHA unavailable: $reason',
          code: 'captcha-unavailable',
        );
}
