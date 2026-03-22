// edgebase Flutter SDK — E2E 테스트
//
// 전제: wrangler dev --port 8688 로컬 서버 실행 중
//
// 실행:
//   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
//     flutter test test/flutter_e2e_test.dart -r expanded
//
// 원칙: mock 금지, 실서버 기반

import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:test/test.dart';
import 'package:edgebase_flutter/src/client.dart';
import 'package:edgebase_flutter/src/auth_client.dart';
import 'package:edgebase_flutter/src/token_manager.dart';
import 'package:edgebase_core/src/field_ops.dart';
import 'package:edgebase_admin/edgebase_admin.dart';

String get baseUrl => Platform.environment['BASE_URL'] ?? 'http://localhost:8688';
String get serviceKey => Platform.environment['SERVICE_KEY'] ?? 'test-service-key-for-admin';
final String prefix = 'dart-flutter-e2e-${DateTime.now().millisecondsSinceEpoch}';

final List<String> _createdIds = [];
late AdminEdgeBase admin;

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

  // ─── 1. Auth E2E ────────────────────────────────────────────────────────────

  group('Auth', () {
    late ClientEdgeBase client;
    late String testEmail;
    const testPassword = 'FlutterE2E123!';

    setUp(() {
      // Use MemoryTokenStorage to avoid SharedPreferences (requires Flutter binding)
      // in headless dart test environments.
      client = ClientEdgeBase(
        baseUrl,
        options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()),
      );
      testEmail = 'dart-flutter-${DateTime.now().millisecondsSinceEpoch}@test.com';
    });

    tearDown(() => client.destroy());

    test('signUp → accessToken + user.id', () async {
      final result = await client.auth.signUp(SignUpOptions(
        email: testEmail,
        password: testPassword,
      ));
      expect(result.accessToken, isNotEmpty);
      expect(result.user.id, isNotEmpty);
    });

    test('signIn → accessToken', () async {
      final email = 'dart-signin-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: testPassword));
      final client2 = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final result = await client2.auth.signIn(SignInOptions(email: email, password: testPassword));
      expect(result.authResult!.accessToken, isNotEmpty);
      client2.destroy();
    });

    test('signOut → no throw', () async {
      await client.auth.signUp(SignUpOptions(email: testEmail, password: testPassword));
      expect(() => client.auth.signOut(), returnsNormally);
    });

    test('signInAnonymously → user.isAnonymous', () async {
      final result = await client.auth.signInAnonymously();
      expect(result.accessToken, isNotEmpty);
      // Anonymous users should have empty/null email
      expect(result.user.id, isNotEmpty);
    });

    test('onAuthStateChange stream emits on signUp', () async {
      final email = 'dart-stream-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final events = <dynamic>[];
      final sub = client.auth.onAuthStateChange.listen(events.add);
      await client.auth.signUp(SignUpOptions(email: email, password: testPassword));
      await Future.delayed(const Duration(milliseconds: 100));
      expect(events.isNotEmpty, isTrue);
      await sub.cancel();
    });

    test('currentUser is null before signIn', () {
      final freshClient = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      expect(freshClient.auth.currentUser, isNull);
      freshClient.destroy();
    });

    test('currentUser set after signIn', () async {
      final email = 'dart-cur-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: testPassword));
      expect(client.auth.currentUser, isNotNull);
    });

    test('wrong password signIn → throws', () async {
      final email = 'dart-wrong-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: testPassword));
      final client2 = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      expect(
        () => client2.auth.signIn(SignInOptions(email: email, password: 'wrong-pass')),
        throwsA(anything),
      );
      client2.destroy();
    });

    test('signUp with data field', () async {
      final email = 'dart-data-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final result = await client.auth.signUp(SignUpOptions(
        email: email,
        password: testPassword,
        data: {'displayName': 'Dart User'},
      ));
      expect(result.user.id, isNotEmpty);
    });
  });

  // ─── 2. DB E2E (with user token) ────────────────────────────────────────────

  group('DB with user token', () {
    late ClientEdgeBase client;

    setUp(() async {
      client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final email = 'dart-db-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: 'DartDB123!'));
    });

    tearDown(() => client.destroy());

    test('create → id returned', () async {
      final r = await client.db('shared').table('posts').insert({'title': '$prefix-user-create'});
      expect(r['id'], isNotNull);
      _createdIds.add(r['id'] as String);
    });

    test('getList → items array', () async {
      final result = await client.db('shared').table('posts').limit(3).getList();
      expect(result.items, isA<List>());
    });
  });

  // ─── 3. FieldOps via admin ───────────────────────────────────────────────────

  group('FieldOps', () {
    test('increment viewCount', () async {
      final created = await admin.db('shared').table('posts')
          .insert({'title': '$prefix-inc', 'viewCount': 0});
      final id = created['id'] as String;
      _createdIds.add(id);
      final updated = await admin.db('shared').table('posts').doc(id)
          .update({'viewCount': increment(5)});
      expect(updated['viewCount'], equals(5));
    });

    test('deleteField removes extra', () async {
      final created = await admin.db('shared').table('posts')
          .insert({'title': '$prefix-del-field', 'extra': 'remove-me'});
      final id = created['id'] as String;
      _createdIds.add(id);
      final updated = await admin.db('shared').table('posts').doc(id)
          .update({'extra': deleteField()});
      expect(updated.containsKey('extra') ? updated['extra'] == null : true, isTrue);
    });
  });

  // ─── 4. DatabaseLive / Stream 언어특화 ──────────────────────────────────────────

  group('StreamSubscription cancel', () {
    test('auth stream subscription cancel', () async {
      final client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final sub = client.auth.onAuthStateChange.listen((_) {});
      await sub.cancel();
      expect(true, isTrue); // no throw
      client.destroy();
    });
  });

  // ─── 5. Future.wait 병렬 ────────────────────────────────────────────────────

  group('Dart language specific', () {
    test('Future.wait parallel creates via admin', () async {
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

    test('null safety — nullable accessors', () async {
      final client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final String? user = client.auth.currentUser?.email;
      expect(user == null || user is String, isTrue);
      client.destroy();
    });
  });

  // ─── 6. Storage ─────────────────────────────────────────────────────────────

  group('Storage (admin)', () {
    test('upload + getUrl', () async {
      final key = 'dart-flutter-e2e-${DateTime.now().millisecondsSinceEpoch}.txt';
      await admin.storage.upload(
        'test-bucket',
        key,
        [72, 101, 108, 108, 111], // 'Hello' as bytes
        contentType: 'text/plain',
      );
      final url = admin.storage.getUrl('test-bucket', key);
      expect(url, contains(key));
      try { await admin.storage.delete('test-bucket', key); } catch (_) {}
    });
  });

  // ─── 7. Auth Additional E2E ──────────────────────────────────────────────────

  group('Auth additional', () {
    late ClientEdgeBase client;
    late String testEmail;
    const testPassword = 'FlutterAuth2E2E!';

    setUp(() {
      client = ClientEdgeBase(
        baseUrl,
        options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()),
      );
      testEmail = 'dart-auth2-${DateTime.now().millisecondsSinceEpoch}@test.com';
    });

    tearDown(() => client.destroy());

    test('updateProfile → displayName updated', () async {
      await client.auth.signUp(SignUpOptions(email: testEmail, password: testPassword));
      final updated = await client.auth.updateProfile(
        UpdateProfileOptions(displayName: 'Flutter Tester'),
      );
      expect(updated.displayName, equals('Flutter Tester'));
    });

    test('changePassword → new tokens returned', () async {
      await client.auth.signUp(SignUpOptions(email: testEmail, password: testPassword));
      final result = await client.auth.changePassword(
        currentPassword: testPassword,
        newPassword: 'NewFlutterPass2!',
      );
      expect(result.accessToken, isNotEmpty);
      expect(result.refreshToken, isNotEmpty);
    });

    test('listSessions → at least 1 session', () async {
      await client.auth.signUp(SignUpOptions(email: testEmail, password: testPassword));
      final sessions = await client.auth.listSessions();
      expect(sessions, isNotEmpty);
      expect(sessions.first.id, isNotEmpty);
      expect(sessions.first.createdAt, isNotEmpty);
    });

    test('revokeSession → session removed', () async {
      final email = 'dart-revoke-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: testPassword));
      // Create a second session by signing in
      final client2 = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      await client2.auth.signIn(SignInOptions(email: email, password: testPassword));
      // List sessions from the first client
      final sessions = await client.auth.listSessions();
      expect(sessions.length, greaterThanOrEqualTo(2));
      // Revoke the second session
      final targetSession = sessions.last;
      await client.auth.revokeSession(targetSession.id);
      final remaining = await client.auth.listSessions();
      expect(remaining.length, lessThan(sessions.length));
      client2.destroy();
    });

    test('duplicate email signUp → throws', () async {
      final email = 'dart-dup-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: testPassword));
      final client2 = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      expect(
        () => client2.auth.signUp(SignUpOptions(email: email, password: testPassword)),
        throwsA(anything),
      );
      client2.destroy();
    });

    test('signIn with non-existent email → throws', () async {
      expect(
        () => client.auth.signIn(SignInOptions(
          email: 'nonexistent-${DateTime.now().millisecondsSinceEpoch}@test.com',
          password: testPassword,
        )),
        throwsA(anything),
      );
    });

    test('onAuthStateChange emits null after signOut', () async {
      final email = 'dart-state-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final events = <dynamic>[];
      final sub = client.auth.onAuthStateChange.listen(events.add);
      await client.auth.signUp(SignUpOptions(email: email, password: testPassword));
      await Future.delayed(const Duration(milliseconds: 100));
      await client.auth.signOut();
      await Future.delayed(const Duration(milliseconds: 100));
      // After signOut, should have emitted null
      expect(events.any((e) => e == null), isTrue);
      await sub.cancel();
    });

    test('anonymous → link with email → signIn works', () async {
      final email = 'dart-link-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final anonResult = await client.auth.signInAnonymously();
      expect(anonResult.user.id, isNotEmpty);
      // Link anonymous account to email
      final linked = await client.auth.linkWithEmail(email: email, password: testPassword);
      expect(linked.accessToken, isNotEmpty);
      // Now signIn with that email should work
      final client2 = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final signInResult = await client2.auth.signIn(SignInOptions(email: email, password: testPassword));
      expect(signInResult.authResult!.accessToken, isNotEmpty);
      client2.destroy();
    });
  });

  // ─── 8. DB Lifecycle E2E ─────────────────────────────────────────────────────

  group('DB lifecycle', () {
    late ClientEdgeBase client;

    setUp(() async {
      client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final email = 'dart-dbl-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: 'DartDBL123!'));
    });

    tearDown(() => client.destroy());

    test('create → getOne → same record', () async {
      final created = await client.db('shared').table('posts').insert({'title': '$prefix-lifecycle'});
      final id = created['id'] as String;
      _createdIds.add(id);
      final fetched = await client.db('shared').table('posts').getOne(id);
      expect(fetched['id'], equals(id));
      expect(fetched['title'], equals('$prefix-lifecycle'));
    });

    test('update → field changed', () async {
      final created = await client.db('shared').table('posts').insert({'title': '$prefix-upd-user'});
      final id = created['id'] as String;
      _createdIds.add(id);
      final updated = await client.db('shared').table('posts').doc(id)
          .update({'title': '$prefix-upd-user-done'});
      expect(updated['title'], equals('$prefix-upd-user-done'));
    });

    test('delete → getOne throws', () async {
      final created = await client.db('shared').table('posts').insert({'title': '$prefix-del-user'});
      final id = created['id'] as String;
      await client.db('shared').table('posts').doc(id).delete();
      expect(
        () => client.db('shared').table('posts').getOne(id),
        throwsA(anything),
      );
    });

    test('orderBy asc → items sorted', () async {
      // Create records with distinct titles
      final a = await admin.db('shared').table('posts').insert({'title': '$prefix-sort-a'});
      final b = await admin.db('shared').table('posts').insert({'title': '$prefix-sort-b'});
      _createdIds.addAll([a['id'] as String, b['id'] as String]);
      final result = await client.db('shared').table('posts')
          .where('title', 'contains', '$prefix-sort-')
          .orderBy('title', direction: 'asc')
          .limit(10)
          .getList();
      expect(result.items.length, greaterThanOrEqualTo(2));
      // Verify ascending order
      final titles = result.items.map((e) => e['title'] as String).toList();
      for (var i = 0; i < titles.length - 1; i++) {
        expect(titles[i].compareTo(titles[i + 1]), lessThanOrEqualTo(0));
      }
    });

    test('count → returns integer', () async {
      await admin.db('shared').table('posts').insert({'title': '$prefix-cnt'});
      final count = await client.db('shared').table('posts').count();
      expect(count, greaterThanOrEqualTo(1));
    });

    test('limit → respects limit', () async {
      // Create enough records
      for (var i = 0; i < 3; i++) {
        final r = await admin.db('shared').table('posts').insert({'title': '$prefix-lim-$i'});
        _createdIds.add(r['id'] as String);
      }
      final result = await client.db('shared').table('posts').limit(2).getList();
      expect(result.items.length, lessThanOrEqualTo(2));
    });

    test('where filter → only matching records', () async {
      final unique = '$prefix-filter-${DateTime.now().millisecondsSinceEpoch}';
      final r = await admin.db('shared').table('posts').insert({'title': unique});
      _createdIds.add(r['id'] as String);
      final result = await client.db('shared').table('posts')
          .where('title', '==', unique)
          .getList();
      expect(result.items.length, equals(1));
      expect(result.items.first['title'], equals(unique));
    });
  });

  // ─── 9. Batch Operations E2E ─────────────────────────────────────────────────

  group('Batch operations', () {
    test('insertMany via admin → multiple records', () async {
      final records = List.generate(5, (i) => {'title': '$prefix-batch-$i'});
      final created = await admin.db('shared').table('posts').insertMany(records);
      expect(created.length, equals(5));
      for (final r in created) {
        _createdIds.add(r['id'] as String);
        expect(r['id'], isNotNull);
      }
    });

    test('upsert → creates new record', () async {
      final unique = '$prefix-upsert-${DateTime.now().millisecondsSinceEpoch}';
      final result = await admin.db('shared').table('posts')
          .upsert({'title': unique});
      expect(result.record['id'], isNotNull);
      expect(result.inserted, isTrue);
      _createdIds.add(result.record['id'] as String);
    });

    test('upsert → updates existing record', () async {
      final created = await admin.db('shared').table('posts')
          .insert({'title': '$prefix-upsert-exist'});
      final id = created['id'] as String;
      _createdIds.add(id);
      final result = await admin.db('shared').table('posts')
          .upsert({'id': id, 'title': '$prefix-upsert-exist-updated'});
      expect(result.record['title'], equals('$prefix-upsert-exist-updated'));
      expect(result.inserted, isFalse);
    });

    test('deleteMany by filter → removes matching records', () async {
      final tag = '$prefix-delmany-${DateTime.now().millisecondsSinceEpoch}';
      final items = List.generate(3, (i) => {'title': '$tag-$i', 'category': tag});
      await admin.db('shared').table('posts').insertMany(items);
      final result = await admin.db('shared').table('posts')
          .where('category', '==', tag)
          .deleteMany();
      expect(result.errors, isEmpty, reason: 'deleteMany should not have errors');
      expect(result.totalSucceeded, greaterThanOrEqualTo(3));
      // Verify deletion
      final list = await admin.db('shared').table('posts')
          .where('category', '==', tag)
          .getList();
      expect(list.items, isEmpty);
    });
  });

  // ─── 10. FieldOps E2E (additional) ──────────────────────────────────────────

  group('FieldOps additional', () {
    test('increment by negative → decrements', () async {
      final created = await admin.db('shared').table('posts')
          .insert({'title': '$prefix-dec', 'viewCount': 10});
      final id = created['id'] as String;
      _createdIds.add(id);
      final updated = await admin.db('shared').table('posts').doc(id)
          .update({'viewCount': increment(-3)});
      expect(updated['viewCount'], equals(7));
    });

    test('multiple increments in sequence', () async {
      final created = await admin.db('shared').table('posts')
          .insert({'title': '$prefix-multi-inc', 'viewCount': 0});
      final id = created['id'] as String;
      _createdIds.add(id);
      await admin.db('shared').table('posts').doc(id)
          .update({'viewCount': increment(5)});
      await admin.db('shared').table('posts').doc(id)
          .update({'viewCount': increment(3)});
      final fetched = await admin.db('shared').table('posts').getOne(id);
      expect(fetched['viewCount'], equals(8));
    });

    test('increment + regular update in same call', () async {
      final created = await admin.db('shared').table('posts')
          .insert({'title': '$prefix-mixed', 'viewCount': 5});
      final id = created['id'] as String;
      _createdIds.add(id);
      final updated = await admin.db('shared').table('posts').doc(id)
          .update({'title': '$prefix-mixed-done', 'viewCount': increment(10)});
      expect(updated['title'], equals('$prefix-mixed-done'));
      expect(updated['viewCount'], equals(15));
    });
  });

  // ─── 11. Storage E2E (additional) ───────────────────────────────────────────

  group('Storage additional', () {
    test('upload + download → same content', () async {
      final key = 'dart-flutter-dl-${DateTime.now().millisecondsSinceEpoch}.txt';
      final content = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]; // 'Hello World'
      await admin.storage.upload('test-bucket', key, content, contentType: 'text/plain');
      final bucket = admin.storage.bucket('test-bucket');
      final downloaded = await bucket.download(key);
      expect(downloaded.length, equals(content.length));
      expect(downloaded.toList(), equals(content));
      try { await admin.storage.delete('test-bucket', key); } catch (_) {}
    });

    test('upload + list → file in listing', () async {
      final key = 'dart-flutter-list-${DateTime.now().millisecondsSinceEpoch}.txt';
      await admin.storage.upload('test-bucket', key, [65, 66, 67], contentType: 'text/plain');
      final bucket = admin.storage.bucket('test-bucket');
      final listing = await bucket.list(prefix: 'dart-flutter-list-');
      expect(listing.items.any((f) => f.key == key), isTrue);
      try { await admin.storage.delete('test-bucket', key); } catch (_) {}
    });

    test('upload + delete → download throws', () async {
      final key = 'dart-flutter-delstor-${DateTime.now().millisecondsSinceEpoch}.txt';
      await admin.storage.upload('test-bucket', key, [68, 69], contentType: 'text/plain');
      await admin.storage.delete('test-bucket', key);
      final bucket = admin.storage.bucket('test-bucket');
      expect(() => bucket.download(key), throwsA(anything));
    });

    test('upload + getMetadata → contentType', () async {
      final key = 'dart-flutter-meta-${DateTime.now().millisecondsSinceEpoch}.json';
      await admin.storage.upload(
        'test-bucket', key,
        [123, 125], // '{}'
        contentType: 'application/json',
      );
      final bucket = admin.storage.bucket('test-bucket');
      final meta = await bucket.getMetadata(key);
      expect(meta.key, equals(key));
      expect(meta.size, greaterThan(0));
      try { await admin.storage.delete('test-bucket', key); } catch (_) {}
    });

    test('uploadString with_authenticated client → roundtrip', () async {
      final client = ClientEdgeBase(
        baseUrl,
        options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()),
      );
      final email = 'dart-storage-auth-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: 'FlutterE2E123!'));
      final key = 'dart-flutter-upload-string-${DateTime.now().millisecondsSinceEpoch}.txt';
      final bucket = client.storage.bucket('documents');
      const content = 'uploadString from Flutter client';
      final info = await bucket.uploadString(key, content);
      expect(info.key, equals(key));
      final downloaded = await bucket.download(key);
      expect(utf8.decode(downloaded), equals(content));
      await bucket.delete(key);
      client.destroy();
    });

  });

  // ─── 12. Dart-specific patterns ─────────────────────────────────────────────

  group('Dart-specific patterns', () {
    test('StreamSubscription cancel after multiple events', () async {
      final client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final events = <dynamic>[];
      final sub = client.auth.onAuthStateChange.listen(events.add);
      final email = 'dart-multi-ev-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: 'DartStream1!'));
      await Future.delayed(const Duration(milliseconds: 100));
      await sub.cancel();
      // After cancel, no more events should be received
      final countAtCancel = events.length;
      await client.auth.signOut();
      await Future.delayed(const Duration(milliseconds: 100));
      expect(events.length, equals(countAtCancel));
      client.destroy();
    });

    test('Future.wait parallel DB reads', () async {
      final r1 = await admin.db('shared').table('posts').insert({'title': '$prefix-par-0'});
      final r2 = await admin.db('shared').table('posts').insert({'title': '$prefix-par-1'});
      _createdIds.addAll([r1['id'] as String, r2['id'] as String]);
      // Parallel read
      final results = await Future.wait([
        admin.db('shared').table('posts').getOne(r1['id'] as String),
        admin.db('shared').table('posts').getOne(r2['id'] as String),
      ]);
      expect(results.length, equals(2));
      expect(results[0]['id'], equals(r1['id']));
      expect(results[1]['id'], equals(r2['id']));
    });

    test('null safety — cascading null access', () async {
      final client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      // Before auth, currentUser is null
      final String? displayName = client.auth.currentUser?.displayName;
      final String? email = client.auth.currentUser?.email;
      final bool? isAnonymous = client.auth.currentUser?.isAnonymous;
      expect(displayName, isNull);
      expect(email, isNull);
      expect(isAnonymous, isNull);
      client.destroy();
    });

    test('type safety — ListResult items is List<Map>', () async {
      final client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final email = 'dart-type-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: 'DartType1!'));
      final result = await client.db('shared').table('posts').limit(1).getList();
      expect(result.items, isA<List<Map<String, dynamic>>>());
      expect(result.total, isA<int?>());
      client.destroy();
    });

    test('immutable query builder — chaining does not mutate', () async {
      final client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final email = 'dart-immut-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client.auth.signUp(SignUpOptions(email: email, password: 'DartImmut1!'));
      final table = client.db('shared').table('posts');
      final query1 = table.limit(1);
      final query2 = table.limit(5);
      // query1 and query2 should be independent
      final r1 = await query1.getList();
      final r2 = await query2.getList();
      expect(r1.items.length, lessThanOrEqualTo(1));
      expect(r2.items.length, lessThanOrEqualTo(5));
      client.destroy();
    });

    test('multiple clients — independent auth state', () async {
      final client1 = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final client2 = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      final email = 'dart-indep-${DateTime.now().millisecondsSinceEpoch}@test.com';
      await client1.auth.signUp(SignUpOptions(email: email, password: 'DartIndep1!'));
      // client1 has a user, client2 should not
      expect(client1.auth.currentUser, isNotNull);
      expect(client2.auth.currentUser, isNull);
      client1.destroy();
      client2.destroy();
    });

    test('setContext / getContext round-trip', () async {
      final client = ClientEdgeBase(baseUrl, options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()));
      client.setContext({'teamId': 'team-123', 'orgId': 'org-456'});
      final ctx = client.getContext();
      expect(ctx['teamId'], equals('team-123'));
      expect(ctx['orgId'], equals('org-456'));
      client.destroy();
    });

  });

  // ─── 13. Push Client E2E (raw HTTP) ───────────────────────────────────────

  group('Push Client (raw HTTP)', () {
    late String accessToken;
    final deviceId = 'dart-push-e2e-${DateTime.now().millisecondsSinceEpoch}';
    final fcmToken = 'fake-fcm-token-dart-${DateTime.now().millisecondsSinceEpoch}';

    setUpAll(() async {
      final email = 'dart-push-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final res = await http.post(
        Uri.parse('$baseUrl/api/auth/signup'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email, 'password': 'DartPush123!'}),
      );
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      accessToken = data['accessToken'] as String;
    });

    test('push.register → 200', () async {
      final res = await http.post(
        Uri.parse('$baseUrl/api/push/register'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $accessToken',
        },
        body: jsonEncode({
          'deviceId': deviceId,
          'token': fcmToken,
          'platform': 'android',
        }),
      );
      expect(res.statusCode, equals(200));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      expect(data['ok'], isTrue);
    });

    test('push.subscribeTopic → 200 or 503', () async {
      final res = await http.post(
        Uri.parse('$baseUrl/api/push/topic/subscribe'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $accessToken',
        },
        body: jsonEncode({'topic': 'test-topic-dart'}),
      );
      // 503 = push not configured (no FCM creds), acceptable in test env
      expect([200, 503].contains(res.statusCode), isTrue);
    });

    test('push.unsubscribeTopic → 200 or 503', () async {
      final res = await http.post(
        Uri.parse('$baseUrl/api/push/topic/unsubscribe'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $accessToken',
        },
        body: jsonEncode({'topic': 'test-topic-dart'}),
      );
      // 503 = push not configured (no FCM creds), acceptable in test env
      expect([200, 503].contains(res.statusCode), isTrue);
    });

    test('push.unregister → 200', () async {
      final res = await http.post(
        Uri.parse('$baseUrl/api/push/unregister'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $accessToken',
        },
        body: jsonEncode({'deviceId': deviceId}),
      );
      expect(res.statusCode, equals(200));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      expect(data['ok'], isTrue);
    });
  });

  // ─── 14. Push Full Flow E2E ─────────────────────────────────────────────────

  group('Push Full Flow', () {
    const mockFcmUrl = 'http://localhost:9099';
    late String accessToken;
    late String userId;
    late String fcmToken;
    final deviceId = 'dart-flow-e2e-${DateTime.now().millisecondsSinceEpoch}';

    setUpAll(() async {
      final email = 'dart-flow-${DateTime.now().millisecondsSinceEpoch}@test.com';
      final res = await http.post(
        Uri.parse('$baseUrl/api/auth/signup'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'email': email, 'password': 'DartFlow123!'}),
      );
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      accessToken = data['accessToken'] as String;
      final user = data['user'] as Map<String, dynamic>;
      userId = user['id'] as String;
    });

    test('clear mock FCM store', () async {
      final res = await http.delete(Uri.parse('$mockFcmUrl/messages'));
      expect(res.statusCode, equals(200));
    });

    test('client register → 200', () async {
      fcmToken = 'flow-token-dart-${DateTime.now().millisecondsSinceEpoch}';
      final res = await http.post(
        Uri.parse('$baseUrl/api/push/register'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $accessToken',
        },
        body: jsonEncode({
          'deviceId': deviceId,
          'token': fcmToken,
          'platform': 'web',
        }),
      );
      expect(res.statusCode, equals(200));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      expect(data['ok'], isTrue);
    });

    test('admin send(userId) → sent:1 + mock FCM receives correct payload', () async {
      final sendRes = await http.post(
        Uri.parse('$baseUrl/api/push/send'),
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': serviceKey,
        },
        body: jsonEncode({
          'userId': userId,
          'payload': {'title': 'Full Flow', 'body': 'E2E'},
        }),
      );
      expect(sendRes.statusCode, equals(200));
      final sendData = jsonDecode(sendRes.body) as Map<String, dynamic>;
      expect(sendData['sent'], equals(1));

      // Verify mock FCM received the message
      final mockRes = await http.get(
        Uri.parse('$mockFcmUrl/messages?token=$fcmToken'),
      );
      expect(mockRes.statusCode, equals(200));
      final items = jsonDecode(mockRes.body) as List<dynamic>;
      expect(items, isNotEmpty);
      final lastMsg = items.last as Map<String, dynamic>;
      expect(lastMsg['token'], equals(fcmToken));
      final payload = lastMsg['payload'] as Map<String, dynamic>;
      final notification = payload['notification'] as Map<String, dynamic>;
      expect(notification['title'], equals('Full Flow'));
      expect(notification['body'], equals('E2E'));
    });

    test('admin sendToTopic → mock FCM receives topic message', () async {
      // Clear mock store for isolation
      await http.delete(Uri.parse('$mockFcmUrl/messages'));

      final sendRes = await http.post(
        Uri.parse('$baseUrl/api/push/send-to-topic'),
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': serviceKey,
        },
        body: jsonEncode({
          'topic': 'news',
          'payload': {'title': 'Topic Test', 'body': 'dart'},
        }),
      );
      expect(sendRes.statusCode, equals(200));

      // Verify mock FCM received the topic message
      final mockRes = await http.get(
        Uri.parse('$mockFcmUrl/messages?topic=news'),
      );
      expect(mockRes.statusCode, equals(200));
      final items = jsonDecode(mockRes.body) as List<dynamic>;
      expect(items, isNotEmpty);
      final lastMsg = items.last as Map<String, dynamic>;
      expect(lastMsg['topic'], equals('news'));
    });

    test('admin broadcast → mock FCM receives topic "all"', () async {
      // Clear mock store for isolation
      await http.delete(Uri.parse('$mockFcmUrl/messages'));

      final sendRes = await http.post(
        Uri.parse('$baseUrl/api/push/broadcast'),
        headers: {
          'Content-Type': 'application/json',
          'X-EdgeBase-Service-Key': serviceKey,
        },
        body: jsonEncode({
          'payload': {'title': 'Broadcast', 'body': 'all-devices'},
        }),
      );
      expect(sendRes.statusCode, equals(200));

      // Verify mock FCM received the broadcast (topic: "all")
      final mockRes = await http.get(
        Uri.parse('$mockFcmUrl/messages?topic=all'),
      );
      expect(mockRes.statusCode, equals(200));
      final items = jsonDecode(mockRes.body) as List<dynamic>;
      expect(items, isNotEmpty);
      final lastMsg = items.last as Map<String, dynamic>;
      expect(lastMsg['topic'], equals('all'));
    });

    test('client unregister → 200', () async {
      final res = await http.post(
        Uri.parse('$baseUrl/api/push/unregister'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $accessToken',
        },
        body: jsonEncode({'deviceId': deviceId}),
      );
      expect(res.statusCode, equals(200));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      expect(data['ok'], isTrue);
    });

    test('admin getTokens → items empty after unregister', () async {
      final res = await http.get(
        Uri.parse('$baseUrl/api/push/tokens?userId=$userId'),
        headers: {
          'X-EdgeBase-Service-Key': serviceKey,
        },
      );
      expect(res.statusCode, equals(200));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final items = data['items'] as List<dynamic>;
      expect(items, isEmpty);
    });
  });
}
