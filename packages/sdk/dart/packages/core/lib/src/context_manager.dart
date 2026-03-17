// Context manager for legacy isolateBy compatibility state.
//
// Dart equivalent of JS SDK's ContextManager. HTTP DB routing uses
// explicit `db(namespace, instanceId)` paths instead of a context header.

class ContextManager {
  Map<String, dynamic> _context = {};

  /// Set context keys. 'auth.id' is silently ignored (server extracts from JWT).
  void setContext(Map<String, dynamic> ctx) {
    final filtered = Map<String, dynamic>.from(ctx);
    filtered.remove('auth.id');
    _context = filtered;
  }

  /// Get current context.
  Map<String, dynamic> getContext() => Map.unmodifiable(_context);
}
