/// DatabaseLive subscription protocol for TableRef.
/// Full implementation lives in edgebase (flutter) package.

/// Type of database change event emitted by onSnapshot/subscribe.
enum ChangeType { create, update, delete }

class DbChange {
  final ChangeType type;
  final String table;
  final String? id;
  final Map<String, dynamic>? record;
  final Map<String, dynamic>? oldRecord;
  DbChange({required this.type, required this.table, this.id, this.record, this.oldRecord});
}

/// Filter tuple for server-side database-live filtering.
/// Named DatabaseLiveFilterTuple to avoid conflict with table_ref.dart's FilterTuple class.
typedef DatabaseLiveFilterTuple = List<dynamic>;

abstract class DatabaseLiveClient {
  Stream<DbChange> subscribe(String tableName, {
    List<DatabaseLiveFilterTuple>? serverFilters,
    List<DatabaseLiveFilterTuple>? serverOrFilters,
  });
  void unsubscribe(String id);
}
