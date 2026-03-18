// EdgeBase error types.
//
// Mirrors `@edge-base/sdk` error hierarchy.

class EdgeBaseError implements Exception {
  final String message;
  final int? statusCode;
  final String? code;
  final List<FieldError>? fieldErrors;

  EdgeBaseError(
    this.message, {
    this.statusCode,
    this.code,
    this.fieldErrors,
  });

  @override
  String toString() => 'EdgeBaseError: $message (code=$code, status=$statusCode)';

  /// Parse error from server JSON response.
  factory EdgeBaseError.fromJson(Map<String, dynamic> json, int statusCode) {
    final fieldErrors = (json['fieldErrors'] as List<dynamic>?)
        ?.map((e) => FieldError.fromJson(e as Map<String, dynamic>))
        .toList();
    return EdgeBaseError(
      (json['error'] as String?) ?? (json['message'] as String?) ?? 'Unknown error',
      statusCode: statusCode,
      code: json['code']?.toString(),
      fieldErrors: fieldErrors,
    );
  }
}

class EdgeBaseAuthError extends EdgeBaseError {
  EdgeBaseAuthError(super.message, {super.statusCode, super.code});
}

class FieldError {
  final String field;
  final String message;

  FieldError({required this.field, required this.message});

  factory FieldError.fromJson(Map<String, dynamic> json) {
    return FieldError(
      field: json['field'] as String,
      message: json['message'] as String,
    );
  }
}
