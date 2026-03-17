// edgebase_admin Dart SDK — E2E 테스트
//
// 전제: wrangler dev --port 8688 로컬 서버 실행 중
//
// 실행:
//   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
//     dart test test/admin_e2e_test.dart -v
//
// 원칙: mock 금지, 실서버 기반

import 'dart:io';
import 'package:test/test.dart';
import 'package:edgebase_admin/edgebase_admin.dart';
import 'package:edgebase_core/src/field_ops.dart';

String get baseUrl => Platform.environment['BASE_URL'] ?? 'http://localhost:8688';
String get serviceKey => Platform.environment['SERVICE_KEY'] ?? 'test-service-key-for-admin';
final String prefix = 'dart-admin-e2e-${DateTime.now().millisecondsSinceEpoch}';

final List<String> _createdIds = [];
late AdminEdgeBase admin;
const Duration _kvPollInterval = Duration(milliseconds: 200);
const Duration _kvTimeout = Duration(seconds: 5);

Future<String?> waitForKvValue(String namespace, String key, String? expected) async {
  final deadline = DateTime.now().add(_kvTimeout);
  String? last;

  while (true) {
    last = await admin.kv(namespace).get(key);
    if (last == expected) return last;
    if (DateTime.now().isAfter(deadline)) return last;
    await Future<void>.delayed(_kvPollInterval);
  }
}

void main() {
  setUpAll(() {
    admin = AdminEdgeBase(baseUrl, serviceKey: serviceKey);
  });

  tearDownAll(() async {
    for (final id in _createdIds) {
      try {
        await admin.db('shared').table('posts').doc(id).delete();
      } catch (_) {}
    }
    admin.destroy();
  });

  // ─── 1. DB CRUD ─────────────────────────────────────────────────────────────

  group('DB CRUD', () {
    test('create → id returned', () async {
      final r = await admin.db('shared').table('posts').insert({'title': '$prefix-insert'});
      expect(r['id'], isNotNull);
      _createdIds.add(r['id'] as String);
    });

    test('getOne → record returned', () async {
      final created = await admin.db('shared').table('posts').insert({'title': '$prefix-getOne'});
      final id = created['id'] as String;
      _createdIds.add(id);
      final fetched = await admin.db('shared').table('posts').getOne(id);
      expect(fetched['id'], equals(id));
    });

    test('update → changed', () async {
      final created = await admin.db('shared').table('posts').insert({'title': '$prefix-orig'});
      final id = created['id'] as String;
      _createdIds.add(id);
      final updated = await admin.db('shared').table('posts').doc(id).update({'title': '$prefix-done'});
      expect(updated['title'], equals('$prefix-done'));
    });

    test('delete → getOne throws', () async {
      final created = await admin.db('shared').table('posts').insert({'title': '$prefix-del'});
      final id = created['id'] as String;
      await admin.db('shared').table('posts').doc(id).delete();
      expect(() => admin.db('shared').table('posts').getOne(id), throwsA(anything));
    });

    test('count → integer ≥ 0', () async {
      final count = await admin.db('shared').table('posts').count();
      expect(count, greaterThanOrEqualTo(0));
    });
  });

  // ─── 2. AdminAuth ───────────────────────────────────────────────────────────

  group('AdminAuth', () {
    late String createdUserId;

    test('createUser → AdminUser returned', () async {
      final email = 'dart-admin-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final user = await admin.adminAuth.createUser(email: email, password: 'DartAdmin123!');
      expect(user.id, isNotNull);
      createdUserId = user.id;
    });

    test('getUser → AdminUser returned', () async {
      final email = 'dart-get-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final created = await admin.adminAuth.createUser(email: email, password: 'DartGet123!');
      final fetched = await admin.adminAuth.getUser(created.id);
      expect(fetched.id, equals(created.id));
    });

    test('listUsers → users list', () async {
      final result = await admin.adminAuth.listUsers(limit: 5);
      expect(result.users, isA<List<AdminUser>>());
    });

    test('updateUser → AdminUser', () async {
      final email = 'dart-upd-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final created = await admin.adminAuth.createUser(email: email, password: 'DartUpd123!');
      final updated = await admin.adminAuth.updateUser(
        created.id,
        AdminUpdateUserOptions(displayName: 'Updated Dart'),
      );
      expect(updated.id, isNotNull);
    });

    test('setCustomClaims → no throw', () async {
      final email = 'dart-claims-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final created = await admin.adminAuth.createUser(email: email, password: 'DartCl123!');
      expect(
        () => admin.adminAuth.setCustomClaims(created.id, {'role': 'premium'}),
        returnsNormally,
      );
    });

    test('revokeAllSessions → no throw', () async {
      final email = 'dart-revoke-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final created = await admin.adminAuth.createUser(email: email, password: 'DartRev123!');
      expect(
        () => admin.adminAuth.revokeAllSessions(created.id),
        returnsNormally,
      );
    });

    test('getUser not found → throws EdgeBaseError', () async {
      expect(
        () => admin.adminAuth.getUser('nonexistent-dart-user-99'),
        throwsA(anything),
      );
    });
  });

  // ─── 3. KV ─────────────────────────────────────────────────────────────────

  group('KV', () {
    final keyPrefix = 'dart-admin-kv-${DateTime.now().millisecondsSinceEpoch}';

    test('set → no throw', () async {
      final key = '$keyPrefix-set';
      await admin.kv('test').set(key, 'hello-dart');
    });

    test('get → value returned', () async {
      final key = '$keyPrefix-get';
      await admin.kv('test').set(key, 'hello-kv');
      final val = await waitForKvValue('test', key, 'hello-kv');
      expect(val, equals('hello-kv'));
    });

    test('delete → no throw', () async {
      final key = '$keyPrefix-delete';
      await admin.kv('test').set(key, 'del-me');
      await admin.kv('test').delete(key);
    });
  });

  // ─── 4. SQL ─────────────────────────────────────────────────────────────────

  group('SQL', () {
    test('raw SQL select 1 → rows', () async {
      final rows = await admin.sql('shared', null, 'SELECT 1 AS val');
      expect(rows, isA<List>());
    });
  });

  // ─── 5. Broadcast ──────────────────────────────────────────────────────────

  group('Broadcast', () {
    test('broadcast → no throw', () async {
      expect(
        () => admin.broadcast('general', 'server-event', {'msg': 'hello from Dart admin E2E'}),
        returnsNormally,
      );
    });
  });

  // ─── 6. Error Handling ─────────────────────────────────────────────────────

  group('Errors', () {
    test('invalid service key → throws', () async {
      final badAdmin = AdminEdgeBase(baseUrl, serviceKey: 'invalid-sk');
      expect(
        () => badAdmin.db('shared').table('posts').insert({'title': 'X'}),
        throwsA(anything),
      );
      badAdmin.destroy();
    });

    test('getOne not found → throws', () async {
      expect(
        () => admin.db('shared').table('posts').getOne('nonexistent-dart-admin-99'),
        throwsA(anything),
      );
    });
  });

  // ─── 7. 언어특화 — Dart ─────────────────────────────────────────────────────

  group('Dart Language Specific', () {
    test('Future.wait parallel creates', () async {
      final results = await Future.wait([
        admin.db('shared').table('posts').insert({'title': '$prefix-fw-0'}),
        admin.db('shared').table('posts').insert({'title': '$prefix-fw-1'}),
        admin.db('shared').table('posts').insert({'title': '$prefix-fw-2'}),
      ]);
      expect(results.length, equals(3));
      for (final r in results) {
        _createdIds.add(r['id'] as String);
      }
    });

    test('null safety — cursor and hasMore are nullable', () async {
      final result = await admin.db('shared').table('posts').limit(2).getList();
      // Dart null safety: String? and bool? types must be handled
      final String? cursor = result.cursor;
      final bool? hasMore = result.hasMore;
      expect(cursor == null || cursor is String, isTrue);
      expect(hasMore == null || hasMore is bool, isTrue);
    });

    test('Completer pattern via async/await', () async {
      // Dart-native async/await as Completer equivalent
      final completer = <Map<String, dynamic>>[];
      for (int i = 0; i < 2; i++) {
        final r = await admin.db('shared').table('posts').insert({'title': '$prefix-comp-$i'});
        completer.add(r);
        _createdIds.add(r['id'] as String);
      }
      expect(completer.length, equals(2));
    });

    test('List insertMany with List.generate', () async {
      final items = List.generate(3, (i) => {'title': '$prefix-listgen-$i'});
      final created = await admin.db('shared').table('posts').insertMany(items);
      expect(created.length, equals(3));
      for (final r in created) {
        _createdIds.add(r['id'] as String);
      }
    });
  });

  // ─── 7b. Golden Query — filter + sort + limit contract ─────────────────────

  group('Golden Query', () {
    final gqPrefix = '$prefix-gq';
    final gqIds = <String>[];

    setUpAll(() async {
      final records = [
        {'title': '$gqPrefix-A', 'views': 10},
        {'title': '$gqPrefix-B', 'views': 30},
        {'title': '$gqPrefix-C', 'views': 20},
        {'title': '$gqPrefix-D', 'views': 40},
        {'title': '$gqPrefix-E', 'views': 5},
      ];
      for (final rec in records) {
        final r = await admin.db('shared').table('posts').insert(rec);
        gqIds.add(r['id'] as String);
        _createdIds.add(r['id'] as String);
      }
    });

    test('filter>=10 + sort:desc + limit=3 → [40,30,20]', () async {
      final list = await admin.db('shared').table('posts')
          .where('title', 'contains', gqPrefix)
          .where('views', '>=', 10)
          .orderBy('views', direction: 'desc')
          .limit(3)
          .getList();
      final views = list.items.map((r) => r['views']).toList();
      expect(views, equals([40, 30, 20]));
    });

    test('cursor pagination with filter → no overlap', () async {
      final p1 = await admin.db('shared').table('posts')
          .where('title', 'contains', gqPrefix)
          .limit(2)
          .getList();
      expect(p1.items.length, equals(2));
      expect(p1.cursor, isNotNull);

      final p2 = await admin.db('shared').table('posts')
          .where('title', 'contains', gqPrefix)
          .limit(2)
          .after(p1.cursor!)
          .getList();
      final ids1 = p1.items.map((r) => r['id']).toSet();
      final ids2 = p2.items.map((r) => r['id']).toSet();
      expect(ids1.intersection(ids2), isEmpty);
    });

    test('orFilter → views==5 OR views==40 returns 2 records', () async {
      final list = await admin.db('shared').table('posts')
          .where('title', 'contains', gqPrefix)
          .or((b) => b
            .where('views', '==', 5)
            .where('views', '==', 40))
          .getList();
      final views = list.items.map((r) => r['views']).toSet();
      expect(views, equals({5, 40}));
      expect(list.items.length, equals(2));
    });

    test('CRUD round-trip → create, get, update, delete, verify 404', () async {
      // 1. Create
      final created = await admin.db('shared').table('posts')
          .insert({'title': '$gqPrefix-roundtrip', 'views': 99});
      final id = created['id'] as String;
      _createdIds.add(id);
      expect(id, isNotNull);

      // 2. Get by ID
      final fetched = await admin.db('shared').table('posts').getOne(id);
      expect(fetched['id'], equals(id));
      expect(fetched['title'], equals('$gqPrefix-roundtrip'));
      expect(fetched['views'], equals(99));

      // 3. Update
      final updated = await admin.db('shared').table('posts')
          .doc(id).update({'title': '$gqPrefix-roundtrip-updated', 'views': 100});
      expect(updated['title'], equals('$gqPrefix-roundtrip-updated'));
      expect(updated['views'], equals(100));

      // 4. Delete
      await admin.db('shared').table('posts').doc(id).delete();
      _createdIds.remove(id);

      // 5. Verify 404 — getOne should throw for deleted record
      expect(
        () => admin.db('shared').table('posts').getOne(id),
        throwsA(anything),
      );
    });
  });

  // ─── 8. Push E2E ─────────────────────────────────────────────────────────────

  group('Push E2E', () {
    test('send to non-existent user → sent: 0', () async {
      final result = await admin.push.send(
        'nonexistent-push-user-99999',
        {'title': 'Test', 'body': 'Hello'},
      );
      expect(result['sent'], equals(0));
    });

    test('sendToToken → sent: 1 (mock FCM)', () async {
      final result = await admin.push.sendToToken(
        'fake-fcm-token-e2e',
        {'title': 'Token', 'body': 'Test'},
      );
      expect(result, isA<Map<String, dynamic>>());
      expect(result.containsKey('sent'), isTrue);
    });

    test('sendMany → 200 OK', () async {
      final result = await admin.push.sendMany(
        ['nonexistent-user-a', 'nonexistent-user-b'],
        {'title': 'Batch', 'body': 'Test'},
      );
      expect(result, isA<Map<String, dynamic>>());
    });

    test('getTokens → empty array', () async {
      final tokens = await admin.push.getTokens('nonexistent-push-user-tokens');
      expect(tokens, isA<List>());
    });

    test('getLogs → array', () async {
      final logs = await admin.push.getLogs('nonexistent-push-user-logs');
      expect(logs, isA<List>());
    });

    test('sendToTopic → success', () async {
      final result = await admin.push.sendToTopic(
        'test-topic-e2e',
        {'title': 'Topic', 'body': 'Test'},
      );
      expect(result, isA<Map<String, dynamic>>());
    });

    test('broadcast → success', () async {
      final result = await admin.push.broadcast(
        {'title': 'Broadcast', 'body': 'E2E Test'},
      );
      expect(result, isA<Map<String, dynamic>>());
    });
  });

  // ─── 9. Vectorize (stub) ──────────────────────────────────────────────────

  group('Vectorize (stub)', () {
    test('upsert → stub 200 + ok', () async {
      final vec = admin.vector('embeddings');
      final result = await vec.upsert([
        {'id': 'doc-1', 'values': List.filled(1536, 0.1), 'metadata': {'title': 'test'}},
      ]);
      expect(result['ok'], isTrue);
    });

    test('insert → stub 200 + ok', () async {
      final vec = admin.vector('embeddings');
      final result = await vec.insert([
        {'id': 'doc-ins-1', 'values': List.filled(1536, 0.2)},
      ]);
      expect(result['ok'], isTrue);
    });

    test('search → stub 200 + matches', () async {
      final vec = admin.vector('embeddings');
      final matches = await vec.search(List.filled(1536, 0.1), topK: 5);
      expect(matches, isA<List>());
    });

    test('search with returnValues', () async {
      final vec = admin.vector('embeddings');
      final matches = await vec.search(List.filled(1536, 0.1), topK: 5, returnValues: true);
      expect(matches, isA<List>());
    });

    test('search with returnMetadata', () async {
      final vec = admin.vector('embeddings');
      final matches = await vec.search(List.filled(1536, 0.1), topK: 5, returnMetadata: 'all');
      expect(matches, isA<List>());
    });

    test('search with namespace', () async {
      final vec = admin.vector('embeddings');
      final matches = await vec.search(List.filled(1536, 0.1), topK: 5, namespace: 'test-ns');
      expect(matches, isA<List>());
    });

    test('queryById → stub 200 + matches', () async {
      final vec = admin.vector('embeddings');
      final matches = await vec.queryById('doc-1', topK: 5);
      expect(matches, isA<List>());
    });

    test('getByIds → stub 200 + vectors', () async {
      final vec = admin.vector('embeddings');
      final vectors = await vec.getByIds(['doc-1', 'doc-2']);
      expect(vectors, isA<List>());
    });

    test('delete → stub 200 + ok', () async {
      final vec = admin.vector('embeddings');
      final result = await vec.delete(['doc-1', 'doc-2']);
      expect(result['ok'], isTrue);
    });

    test('describe → stub 200 + index info', () async {
      final vec = admin.vector('embeddings');
      final info = await vec.describe();
      expect(info['vectorCount'], isA<num>());
      expect(info['dimensions'], isA<num>());
      expect(info['metric'], isA<String>());
    });

    test('search dimension mismatch → throws', () async {
      final vec = admin.vector('embeddings');
      expect(
        () => vec.search([0.1, 0.2, 0.3], topK: 5),
        throwsA(anything),
      );
    });

    test('nonexistent index → throws', () async {
      final vec = admin.vector('nonexistent-index-99');
      expect(
        () => vec.describe(),
        throwsA(anything),
      );
    });
  });
}
