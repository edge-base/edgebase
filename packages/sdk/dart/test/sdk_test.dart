// Dart SDK 단위 + E2E 테스트
//
// 실행 방법:
//   cd packages/sdk/dart
//   dart pub get
//   SERVER=http://localhost:8688 dart test test/sdk_test.dart -v
//
// 환경 변수:
//   SERVER: EdgeBase 서버 주소 (기본값: http://localhost:8688)
//   SERVICE_KEY: 서비스 키 (기본값: test-service-key-for-admin)

import 'dart:convert';
import 'dart:io';
import 'package:test/test.dart';
import 'package:http/http.dart' as http;
import 'package:edgebase_core/edgebase_core.dart';
import 'package:edgebase_core/src/generated/api_core.dart';

final server = Platform.environment['SERVER'] ?? 'http://localhost:8688';
final serviceKey = Platform.environment['SERVICE_KEY'] ?? 'test-service-key-for-admin';

/// Raw HTTP request helper
Future<(int, Map<String, dynamic>?)> raw(
  String method,
  String path, {
  Map<String, dynamic>? body,
}) async {
  final uri = Uri.parse('$server$path');
  final headers = {
    'Content-Type': 'application/json',
    'X-EdgeBase-Service-Key': serviceKey,
  };

  final http.Response response;
  switch (method.toUpperCase()) {
    case 'GET':
      response = await http.get(uri, headers: headers);
    case 'POST':
      response = await http.post(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
    case 'PATCH':
      response = await http.patch(uri, headers: headers, body: body != null ? jsonEncode(body) : null);
    case 'DELETE':
      response = await http.delete(uri, headers: headers);
    default:
      throw ArgumentError('Unsupported method: $method');
  }

  final data = response.body.isNotEmpty ? jsonDecode(response.body) as Map<String, dynamic>? : null;
  return (response.statusCode, data);
}

void main() {
  // ─── 1. FilterTuple 단위 테스트 ─────────────────────────────────────────────

  group('FilterTuple', () {
    test('toJson 변환', () {
      final f = FilterTuple('status', '==', 'published');
      expect(f.toJson(), ['status', '==', 'published']);
    });

    test('숫자 값 변환', () {
      final f = FilterTuple('count', '>', 5);
      expect(f.toJson(), ['count', '>', 5]);
    });
  });

  // ─── 2. OrBuilder 단위 테스트 ───────────────────────────────────────────────

  group('OrBuilder', () {
    test('where 체이닝', () {
      final builder = OrBuilder()
        ..where('a', '==', 1)
        ..where('b', '==', 2);
      expect(builder.filters.length, 2);
    });

    test('filters 반환', () {
      final builder = OrBuilder()..where('x', '==', 'y');
      expect(builder.filters.first.field, 'x');
    });
  });

  // ─── 3. QueryBuilder 단위 테스트 ────────────────────────────────────────────

  group('TableRef QueryBuilder', () {
    late HttpClient httpClient;
    late GeneratedDbApi dbApi;
    late TableRef table;

    setUp(() {
      httpClient = HttpClient(
        baseUrl: server,
        serviceKey: serviceKey,
      );
      dbApi = GeneratedDbApi(httpClient);
      table = TableRef(dbApi, 'posts');
    });

    test('where — 불변성', () {
      final t2 = table.where('status', '==', 'published');
      expect(table._filters.isEmpty, isTrue);
      expect(t2._filters.length, 1);
    });

    test('limit — 불변성', () {
      final t2 = table.limit(10);
      expect(table._limitCount, isNull);
      expect(t2._limitCount, 10);
    });

    test('offset — 불변성', () {
      final t2 = table.offset(5);
      expect(t2._offset, 5);
    });

    test('orderBy — 누적', () {
      final t2 = table.orderBy('title', direction: 'asc');
      expect(t2._sorts, [['title', 'asc']]);
    });

    test('after cursor', () {
      final t2 = table.after('cursor-123');
      expect(t2._afterCursor, 'cursor-123');
      expect(t2._beforeCursor, isNull);
    });

    test('before cursor', () {
      final t2 = table.before('cursor-456');
      expect(t2._beforeCursor, 'cursor-456');
      expect(t2._afterCursor, isNull);
    });

    test('cursor + offset 동시 사용 → StateError', () {
      expect(
        () => table.after('cursor').offset(2).getList(),
        throwsA(isA<StateError>()),
      );
    });

    test('or() 체이닝', () {
      final t2 = table.or((b) {
        b.where('x', '==', 1);
        b.where('y', '==', 2);
      });
      expect(t2._orFilters.length, 2);
    });
  });

  // ─── 4. DB CRUD E2E ──────────────────────────────────────────────────────────

  group('DB CRUD E2E', () {
    late HttpClient httpClient;
    late GeneratedDbApi dbApi;
    late TableRef<Map<String, dynamic>> postsTable;
    final cleanupIds = <String>[];

    setUpAll(() async {
      httpClient = HttpClient(baseUrl: server, serviceKey: serviceKey);
      dbApi = GeneratedDbApi(httpClient);
      postsTable = TableRef(dbApi, 'posts');
    });

    tearDownAll(() async {
      for (final id in cleanupIds) {
        await raw('DELETE', '/api/db/shared/tables/posts/$id');
      }
    });

    test('insert → id 반환', () async {
      final suffix = DateTime.now().millisecondsSinceEpoch;
      final result = await postsTable.insert({'title': 'Dart-insert-$suffix'});
      expect(result.containsKey('id'), isTrue);
      cleanupIds.add(result['id'] as String);
    });

    test('getOne → title 일치', () async {
      final suffix = DateTime.now().millisecondsSinceEpoch;
      final post = await postsTable.insert({'title': 'Dart-getOne-$suffix'});
      cleanupIds.add(post['id'] as String);

      final got = await postsTable.getOne(post['id'] as String);
      expect(got['title'], post['title']);
    });

    test('doc(id).update() → 변경됨', () async {
      final post = await postsTable.insert({'title': 'Dart-update-orig'});
      cleanupIds.add(post['id'] as String);

      final updated = await postsTable.doc(post['id'] as String).update({'title': 'Dart-update-new'});
      expect(updated['title'], 'Dart-update-new');
    });

    test('doc(id).delete() → 삭제됨', () async {
      final post = await postsTable.insert({'title': 'Dart-delete-me'});
      final id = post['id'] as String;

      await postsTable.doc(id).delete();
      final (status, _) = await raw('GET', '/api/db/shared/tables/posts/$id');
      expect(status, 404);
    });

    test('getList() → items 배열', () async {
      final result = await postsTable.limit(5).getList();
      expect(result.items, isA<List>());
    });

    test('where filter → 결과 필터링', () async {
      final suffix = DateTime.now().millisecondsSinceEpoch.toString().substring(8);
      final post = await postsTable.insert({'title': 'Dart-filter-$suffix'});
      cleanupIds.add(post['id'] as String);

      final result = await postsTable.where('id', '==', post['id']).getList();
      expect(result.items.any((p) => p['id'] == post['id']), isTrue);
    });

    test('count() → int', () async {
      final total = await postsTable.count();
      expect(total, isA<int>());
      expect(total, greaterThanOrEqualTo(0));
    });

    test('insertMany 3개', () async {
      final records = [
        {'title': 'Dart-batch-1'},
        {'title': 'Dart-batch-2'},
        {'title': 'Dart-batch-3'},
      ];
      final created = await postsTable.insertMany(records);
      expect(created.length, 3);
      for (final r in created) {
        cleanupIds.add(r['id'] as String);
      }
    });

    test('upsert → inserted=true', () async {
      final suffix = DateTime.now().millisecondsSinceEpoch;
      final result = await postsTable.upsert({'title': 'Dart-upsert-$suffix'});
      expect(result.inserted, isTrue);
      cleanupIds.add(result.record['id'] as String);
    });
  });

  // ─── 5. FieldOps E2E ────────────────────────────────────────────────────────

  group('FieldOps E2E', () {
    late HttpClient httpClient;
    late GeneratedDbApi dbApi;
    late TableRef<Map<String, dynamic>> postsTable;
    final cleanupIds = <String>[];

    setUpAll(() async {
      httpClient = HttpClient(baseUrl: server, serviceKey: serviceKey);
      dbApi = GeneratedDbApi(httpClient);
      postsTable = TableRef(dbApi, 'posts');
    });

    tearDownAll(() async {
      for (final id in cleanupIds) {
        await raw('DELETE', '/api/db/shared/tables/posts/$id');
      }
    });

    test('increment(3) → viewCount 증가', () async {
      final post = await postsTable.insert({'title': 'Dart-inc', 'viewCount': 0});
      cleanupIds.add(post['id'] as String);

      final result = await raw('PATCH', '/api/db/shared/tables/posts/${post['id']}', body: {
        'viewCount': {'\$op': 'increment', 'value': 3},
      });
      expect(result.$2?['viewCount'], 3);
    });

    test('deleteField → null', () async {
      final post = await postsTable.insert({'title': 'Dart-del-field'});
      cleanupIds.add(post['id'] as String);

      final result = await raw('PATCH', '/api/db/shared/tables/posts/${post['id']}', body: {
        'title': {'\$op': 'deleteField'},
      });
      expect(result.$2?['title'], isNull);
    });
  });

  // ─── 6. Cursor Pagination E2E ────────────────────────────────────────────────

  group('Cursor Pagination', () {
    late HttpClient httpClient;
    late GeneratedDbApi dbApi;
    late TableRef<Map<String, dynamic>> postsTable;
    final cleanupIds = <String>[];

    setUpAll(() async {
      httpClient = HttpClient(baseUrl: server, serviceKey: serviceKey);
      dbApi = GeneratedDbApi(httpClient);
      postsTable = TableRef(dbApi, 'posts');
      for (var i = 0; i < 5; i++) {
        final post = await postsTable.insert({'title': 'Dart-pag-$i'});
        cleanupIds.add(post['id'] as String);
      }
    });

    tearDownAll(() async {
      for (final id in cleanupIds) {
        await raw('DELETE', '/api/db/shared/tables/posts/$id');
      }
    });

    test('after(cursor) → 다른 페이지', () async {
      final page1 = await postsTable.limit(2).getList();
      if (page1.cursor == null) return;
      final page2 = await postsTable.limit(2).after(page1.cursor!).getList();
      for (final item1 in page1.items) {
        expect(page2.items.any((i) => i['id'] == item1['id']), isFalse);
      }
    });
  });

  // ─── 7. OR Filter E2E ────────────────────────────────────────────────────────

  group('OR Filter E2E', () {
    late HttpClient httpClient;
    late GeneratedDbApi dbApi;
    late TableRef<Map<String, dynamic>> postsTable;
    final cleanupIds = <String>[];

    setUpAll(() async {
      httpClient = HttpClient(baseUrl: server, serviceKey: serviceKey);
      dbApi = GeneratedDbApi(httpClient);
      postsTable = TableRef(dbApi, 'posts');
      for (final t in ['Dart-OR-A', 'Dart-OR-B', 'Dart-OR-C']) {
        final post = await postsTable.insert({'title': t});
        cleanupIds.add(post['id'] as String);
      }
    });

    tearDownAll(() async {
      for (final id in cleanupIds) {
        await raw('DELETE', '/api/db/shared/tables/posts/$id');
      }
    });

    test('or() → 두 조건 중 하나 매칭', () async {
      final result = await postsTable.or((b) {
        b.where('title', '==', 'Dart-OR-A');
        b.where('title', '==', 'Dart-OR-B');
      }).get();

      final titles = result.items.map((i) => i['title'] as String).toList();
      expect(titles.contains('Dart-OR-A') || titles.contains('Dart-OR-B'), isTrue);
    });
  });
}
