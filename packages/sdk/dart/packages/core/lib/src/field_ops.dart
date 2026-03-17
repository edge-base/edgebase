// Field operation helpers for atomic updates.
//
// Mirrors JS SDK field-ops.ts — uses $op key for server op-parser.ts.

/// Increment a numeric field by the given amount.
/// 
/// ```dart
/// await client.table('posts').doc('abc').update({
///   'viewCount': increment(1),
///   'score': increment(-0.5),
/// });
/// ```
Map<String, dynamic> increment(num value) => {
      '\$op': 'increment',
      'value': value,
    };

/// Delete a field from a document.
/// 
/// ```dart
/// await client.table('users').doc('abc').update({
///   'legacyField': deleteField(),
/// });
/// ```
Map<String, dynamic> deleteField() => {
      '\$op': 'deleteField',
    };
