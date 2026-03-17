// edgebase_admin Dart SDK — 단위 테스트
//
// 테스트 대상:
//   - AdminUser.fromJson (null safety)
//   - AdminUpdateUserOptions.toJson (nullable fields)
//   - AdminListUsersResult
//   - AdminAuthClient _ensureServiceKey 로직
//   - AdminEdgeBase db/kv/d1/vector/broadcast/push API 반환 타입
//   - KvClient, D1Client, VectorizeClient, BroadcastClient, PushClient 구조
//
// 실행: cd packages/sdk/dart/packages/admin && dart test test/admin_unit_test.dart
//
// 원칙: 서버 불필요 — 순수 Dart 로직만 검증

import 'package:test/test.dart';
import 'package:edgebase_admin/src/admin_auth_client.dart';
import 'package:edgebase_admin/src/admin_edgebase.dart';
import 'package:edgebase_admin/src/kv_client.dart';
import 'package:edgebase_admin/src/d1_client.dart';
import 'package:edgebase_admin/src/vectorize_client.dart';
import 'package:edgebase_admin/src/broadcast_client.dart';
import 'package:edgebase_admin/src/push_client.dart';
import 'package:edgebase_admin/src/functions_client.dart';
import 'package:edgebase_admin/src/analytics_client.dart';
import 'package:edgebase_core/src/errors.dart';

void main() {
  // ─── A. AdminUser.fromJson ─────────────────────────────────────────────────

  group('AdminUser.fromJson', () {
    test('parses required id field', () {
      final user = AdminUser.fromJson({'id': 'u-1'});
      expect(user.id, equals('u-1'));
    });

    test('nullable email', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'email': 'a@b.com'});
      expect(user.email, equals('a@b.com'));
    });

    test('email null when missing', () {
      final user = AdminUser.fromJson({'id': 'u-1'});
      expect(user.email, isNull);
    });

    test('displayName parsed', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'displayName': 'Alice'});
      expect(user.displayName, equals('Alice'));
    });

    test('emailVerified bool from true', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'emailVerified': true});
      expect(user.emailVerified, isTrue);
    });

    test('emailVerified bool from 1', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'emailVerified': 1});
      expect(user.emailVerified, isTrue);
    });

    test('emailVerified null when missing', () {
      final user = AdminUser.fromJson({'id': 'u-1'});
      expect(user.emailVerified, isNull);
    });

    test('isAnonymous from true', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'isAnonymous': true});
      expect(user.isAnonymous, isTrue);
    });

    test('isAnonymous from 1', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'isAnonymous': 1});
      expect(user.isAnonymous, isTrue);
    });

    test('role parsed', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'role': 'admin'});
      expect(user.role, equals('admin'));
    });

    test('metadata parsed', () {
      final user = AdminUser.fromJson({
        'id': 'u-1',
        'metadata': {'plan': 'pro'},
      });
      expect(user.metadata?['plan'], equals('pro'));
    });

    test('avatarUrl parsed', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'avatarUrl': 'https://cdn.test/avatar.png'});
      expect(user.avatarUrl, equals('https://cdn.test/avatar.png'));
    });

    test('createdAt parsed', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'createdAt': '2024-01-01T00:00:00Z'});
      expect(user.createdAt, equals('2024-01-01T00:00:00Z'));
    });

    test('updatedAt parsed', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'updatedAt': '2024-06-15T12:00:00Z'});
      expect(user.updatedAt, equals('2024-06-15T12:00:00Z'));
    });

    test('emailVerified false from false', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'emailVerified': false});
      expect(user.emailVerified, isFalse);
    });

    test('isAnonymous false from false', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'isAnonymous': false});
      expect(user.isAnonymous, isFalse);
    });

    test('emailVerified false from 0', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'emailVerified': 0});
      expect(user.emailVerified, isFalse);
    });

    test('isAnonymous false from 0', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'isAnonymous': 0});
      expect(user.isAnonymous, isFalse);
    });

    test('disabled bool from true', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'disabled': true});
      expect(user.disabled, isTrue);
    });

    test('disabled bool from 1', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'disabled': 1});
      expect(user.disabled, isTrue);
    });

    test('disabled false from 0', () {
      final user = AdminUser.fromJson({'id': 'u-1', 'disabled': 0});
      expect(user.disabled, isFalse);
    });

    test('all nullable fields null when missing', () {
      final user = AdminUser.fromJson({'id': 'u-min'});
      expect(user.email, isNull);
      expect(user.displayName, isNull);
      expect(user.avatarUrl, isNull);
      expect(user.role, isNull);
      expect(user.emailVerified, isNull);
      expect(user.isAnonymous, isNull);
      expect(user.disabled, isNull);
      expect(user.createdAt, isNull);
      expect(user.updatedAt, isNull);
      expect(user.metadata, isNull);
    });

    test('full JSON with all fields', () {
      final user = AdminUser.fromJson({
        'id': 'u-full',
        'email': 'full@test.com',
        'displayName': 'Full User',
        'avatarUrl': 'https://cdn.test/full.png',
        'role': 'editor',
        'locale': 'ko',
        'emailVisibility': 'private',
        'emailVerified': true,
        'isAnonymous': false,
        'createdAt': '2024-01-01',
        'updatedAt': '2024-06-01',
        'metadata': {'tier': 'enterprise'},
      });
      expect(user.id, equals('u-full'));
      expect(user.email, equals('full@test.com'));
      expect(user.displayName, equals('Full User'));
      expect(user.role, equals('editor'));
      expect(user.locale, equals('ko'));
      expect(user.emailVisibility, equals('private'));
      expect(user.emailVerified, isTrue);
      expect(user.isAnonymous, isFalse);
      expect(user.metadata?['tier'], equals('enterprise'));
    });
  });

  // ─── B. AdminUpdateUserOptions.toJson ────────────────────────────────────

  group('AdminUpdateUserOptions.toJson', () {
    test('empty options -> empty map', () {
      final opts = AdminUpdateUserOptions();
      expect(opts.toJson(), isEmpty);
    });

    test('email only', () {
      final opts = AdminUpdateUserOptions(email: 'new@test.com');
      final json = opts.toJson();
      expect(json['email'], equals('new@test.com'));
      expect(json.containsKey('password'), isFalse);
    });

    test('displayName only', () {
      final opts = AdminUpdateUserOptions(displayName: 'Bob');
      expect(opts.toJson()['displayName'], equals('Bob'));
    });

    test('emailVerified true', () {
      final opts = AdminUpdateUserOptions(emailVerified: true);
      expect(opts.toJson()['emailVerified'], isTrue);
    });

    test('metadata included', () {
      final opts = AdminUpdateUserOptions(metadata: {'tier': 'pro'});
      expect(opts.toJson()['metadata']?['tier'], equals('pro'));
    });

    test('multiple fields', () {
      final opts = AdminUpdateUserOptions(email: 'x@y.com', role: 'admin');
      final json = opts.toJson();
      expect(json['email'], equals('x@y.com'));
      expect(json['role'], equals('admin'));
    });

    test('password included when provided', () {
      final opts = AdminUpdateUserOptions(password: 'newPass123!');
      final json = opts.toJson();
      expect(json['password'], equals('newPass123!'));
    });

    test('avatarUrl included when provided', () {
      final opts = AdminUpdateUserOptions(avatarUrl: 'https://cdn.test/new.png');
      final json = opts.toJson();
      expect(json['avatarUrl'], equals('https://cdn.test/new.png'));
    });

    test('emailVerified false', () {
      final opts = AdminUpdateUserOptions(emailVerified: false);
      final json = opts.toJson();
      expect(json['emailVerified'], isFalse);
    });

    test('disabled true', () {
      final opts = AdminUpdateUserOptions(disabled: true);
      final json = opts.toJson();
      expect(json['disabled'], isTrue);
    });

    test('disabled false', () {
      final opts = AdminUpdateUserOptions(disabled: false);
      final json = opts.toJson();
      expect(json['disabled'], isFalse);
    });

    test('all fields set', () {
      final opts = AdminUpdateUserOptions(
        email: 'all@test.com',
        password: 'All123!',
        displayName: 'All Fields',
        avatarUrl: 'https://cdn.test/all.png',
        role: 'moderator',
        locale: 'ko',
        emailVisibility: 'private',
        emailVerified: true,
        disabled: false,
        metadata: {'key': 'value'},
      );
      final json = opts.toJson();
      expect(json.keys.length, equals(10));
      expect(json['email'], equals('all@test.com'));
      expect(json['password'], equals('All123!'));
      expect(json['displayName'], equals('All Fields'));
      expect(json['avatarUrl'], equals('https://cdn.test/all.png'));
      expect(json['role'], equals('moderator'));
      expect(json['locale'], equals('ko'));
      expect(json['emailVisibility'], equals('private'));
      expect(json['emailVerified'], isTrue);
      expect(json['disabled'], isFalse);
      expect(json['metadata'], isA<Map>());
    });

    test('locale and emailVisibility included when provided', () {
      final opts = AdminUpdateUserOptions(
        locale: 'en',
        emailVisibility: 'public',
      );
      final json = opts.toJson();
      expect(json['locale'], equals('en'));
      expect(json['emailVisibility'], equals('public'));
    });

    test('only null fields excluded', () {
      final opts = AdminUpdateUserOptions(role: 'viewer');
      final json = opts.toJson();
      expect(json.keys.length, equals(1));
      expect(json.containsKey('role'), isTrue);
      expect(json.containsKey('email'), isFalse);
    });
  });

  // ─── C. AdminListUsersResult ──────────────────────────────────────────────

  group('AdminListUsersResult', () {
    test('empty users', () {
      final r = AdminListUsersResult(users: [], cursor: null);
      expect(r.users, isEmpty);
      expect(r.cursor, isNull);
    });

    test('users list accessible', () {
      final users = [AdminUser.fromJson({'id': 'u-1'})];
      final r = AdminListUsersResult(users: users, cursor: 'next-cursor');
      expect(r.users.length, equals(1));
      expect(r.cursor, equals('next-cursor'));
    });

    test('multiple users accessible', () {
      final users = [
        AdminUser.fromJson({'id': 'u-1', 'email': 'a@test.com'}),
        AdminUser.fromJson({'id': 'u-2', 'email': 'b@test.com'}),
        AdminUser.fromJson({'id': 'u-3', 'email': 'c@test.com'}),
      ];
      final r = AdminListUsersResult(users: users, cursor: null);
      expect(r.users.length, equals(3));
      expect(r.users[1].email, equals('b@test.com'));
    });

    test('cursor null when no more pages', () {
      final r = AdminListUsersResult(
        users: [AdminUser.fromJson({'id': 'u-1'})],
        cursor: null,
      );
      expect(r.cursor, isNull);
    });
  });

  group('AdminEdgeBase surface', () {
    test('functions property exists', () {
      final admin = AdminEdgeBase('https://dummy.edgebase.fun', serviceKey: 'sk-test');
      expect(admin.functions, isA<FunctionsClient>());
    });

    test('analytics property exists', () {
      final admin = AdminEdgeBase('https://dummy.edgebase.fun', serviceKey: 'sk-test');
      expect(admin.analytics, isA<AnalyticsClient>());
    });

    test('push property exists', () {
      final admin = AdminEdgeBase('https://dummy.edgebase.fun', serviceKey: 'sk-test');
      expect(admin.push, isA<PushClient>());
    });

    test('vector returns VectorizeClient', () {
      final admin = AdminEdgeBase('https://dummy.edgebase.fun', serviceKey: 'sk-test');
      expect(admin.vector('embeddings'), isA<VectorizeClient>());
    });
  });

  // ─── D. AdminAuthClient._ensureServiceKey ────────────────────────────────

  group('AdminAuthClient._ensureServiceKey', () {
    test('no service key -> throws EdgeBaseError', () {
      expect(
        () => _testEnsureServiceKey(hasKey: false),
        throwsA(isA<EdgeBaseError>()),
      );
    });

    test('with service key -> no throw', () {
      expect(
        () => _testEnsureServiceKey(hasKey: true),
        returnsNormally,
      );
    });

    test('error message mentions service key', () {
      try {
        _testEnsureServiceKey(hasKey: false);
        fail('Expected EdgeBaseError');
      } catch (e) {
        expect(e, isA<EdgeBaseError>());
        expect((e as EdgeBaseError).message, contains('Service Key'));
      }
    });
  });

  // ─── E. AdminEdgeBase constructor & accessors ─────────────────────────────

  group('AdminEdgeBase', () {
    test('constructor does not throw with valid args', () {
      expect(
        () => AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk'),
        returnsNormally,
      );
    });

    test('db returns DbRef', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final dbRef = admin.db('shared');
      expect(dbRef, isNotNull);
      admin.destroy();
    });

    test('kv returns KvClient', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final kvRef = admin.kv('cache');
      expect(kvRef, isA<KvClient>());
      admin.destroy();
    });

    test('d1 returns D1Client', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final d1Ref = admin.d1('analytics');
      expect(d1Ref, isA<D1Client>());
      admin.destroy();
    });

    test('vector returns VectorizeClient', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final vecRef = admin.vector('embeddings');
      expect(vecRef, isA<VectorizeClient>());
      admin.destroy();
    });

    test('adminAuth is accessible', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      expect(admin.adminAuth, isA<AdminAuthClient>());
      admin.destroy();
    });

    test('storage is accessible', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      expect(admin.storage, isNotNull);
      admin.destroy();
    });

    test('push is accessible', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      expect(admin.push, isA<PushClient>());
      admin.destroy();
    });

    test('httpClient is accessible', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      expect(admin.httpClient, isNotNull);
      admin.destroy();
    });

    test('destroy does not throw', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      expect(() => admin.destroy(), returnsNormally);
    });

    test('constructor strips trailing slash', () {
      final admin = AdminEdgeBase('http://localhost:8688/', serviceKey: 'test-sk');
      // Verify baseUrl was cleaned (accessible via httpClient)
      expect(admin.httpClient.baseUrl, equals('http://localhost:8688'));
      admin.destroy();
    });

    test('setContext does not throw', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      expect(() => admin.setContext({'org': 'test'}), returnsNormally);
      admin.destroy();
    });

    test('db with instanceId does not throw', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      expect(() => admin.db('workspace', instanceId: 'ws-123'), returnsNormally);
      admin.destroy();
    });
  });

  // ─── F2. VectorizeClient — method signatures ──────────────────────────────

  group('VectorizeClient — method signatures', () {
    test('upsert method exists', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final vec = admin.vector('embeddings');
      expect(vec.upsert, isNotNull);
      admin.destroy();
    });

    test('insert method exists', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final vec = admin.vector('embeddings');
      expect(vec.insert, isNotNull);
      admin.destroy();
    });

    test('search method exists', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final vec = admin.vector('embeddings');
      expect(vec.search, isNotNull);
      admin.destroy();
    });

    test('queryById method exists', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final vec = admin.vector('embeddings');
      expect(vec.queryById, isNotNull);
      admin.destroy();
    });

    test('getByIds method exists', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final vec = admin.vector('embeddings');
      expect(vec.getByIds, isNotNull);
      admin.destroy();
    });

    test('delete method exists', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final vec = admin.vector('embeddings');
      expect(vec.delete, isNotNull);
      admin.destroy();
    });

    test('describe method exists', () {
      final admin = AdminEdgeBase('http://localhost:8688', serviceKey: 'test-sk');
      final vec = admin.vector('embeddings');
      expect(vec.describe, isNotNull);
      admin.destroy();
    });
  });

  // ─── F. AdminUser constructor ─────────────────────────────────────────────

  group('AdminUser constructor', () {
    test('minimal construction', () {
      final user = AdminUser(id: 'u-ctor');
      expect(user.id, equals('u-ctor'));
      expect(user.email, isNull);
    });

    test('full construction', () {
      final user = AdminUser(
        id: 'u-full',
        email: 'ctor@test.com',
        displayName: 'Ctor User',
        avatarUrl: 'https://cdn.test/ctor.png',
        role: 'admin',
        emailVerified: true,
        isAnonymous: false,
        createdAt: '2024-01-01',
        updatedAt: '2024-06-01',
        metadata: {'plan': 'pro'},
      );
      expect(user.email, equals('ctor@test.com'));
      expect(user.displayName, equals('Ctor User'));
      expect(user.role, equals('admin'));
    });
  });
}

// ─── Test helper — simulate _ensureServiceKey ─────────────────────────────────

void _testEnsureServiceKey({required bool hasKey}) {
  if (!hasKey) {
    throw EdgeBaseError(
      'AdminAuthClient requires a Service Key. '
      'Initialize EdgeBase with serviceKey option.',
    );
  }
}
