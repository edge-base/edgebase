// Admin Auth client for server-side user management.
//
// Mirrors JS SDK AdminAuthClient — requires Service Key.
// Only use in server-side (backend Dart) environments.

import 'package:edgebase_core/src/http_client.dart';
import 'package:edgebase_core/src/errors.dart';
import 'generated/admin_api_core.dart';

/// Admin user representation.
class AdminUser {
  final String id;
  final String? email;
  final String? displayName;
  final String? avatarUrl;
  final String? role;
  final String? locale;
  final String? emailVisibility;
  final bool? emailVerified;
  final bool? isAnonymous;
  final bool? disabled;
  final String? createdAt;
  final String? updatedAt;
  final Map<String, dynamic>? metadata;

  AdminUser({
    required this.id,
    this.email,
    this.displayName,
    this.avatarUrl,
    this.role,
    this.locale,
    this.emailVisibility,
    this.emailVerified,
    this.isAnonymous,
    this.disabled,
    this.createdAt,
    this.updatedAt,
    this.metadata,
  });

  factory AdminUser.fromJson(Map<String, dynamic> json) {
    return AdminUser(
      id: json['id'] as String,
      email: json['email'] as String?,
      displayName: json['displayName'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      role: json['role'] as String?,
      locale: json['locale'] as String?,
      emailVisibility: json['emailVisibility'] as String?,
      emailVerified: json['emailVerified'] == null ? null : (json['emailVerified'] == true || json['emailVerified'] == 1),
      isAnonymous: json['isAnonymous'] == null ? null : (json['isAnonymous'] == true || json['isAnonymous'] == 1),
      disabled: json['disabled'] == null ? null : (json['disabled'] == true || json['disabled'] == 1),
      createdAt: json['createdAt'] as String?,
      updatedAt: json['updatedAt'] as String?,
      metadata: json['metadata'] as Map<String, dynamic>?,
    );
  }
}

/// Options for updating a user via admin API.
class AdminUpdateUserOptions {
  final String? email;
  final String? password;
  final String? displayName;
  final String? avatarUrl;
  final String? role;
  final String? locale;
  final String? emailVisibility;
  final bool? emailVerified;
  final bool? disabled;
  final Map<String, dynamic>? metadata;

  AdminUpdateUserOptions({
    this.email,
    this.password,
    this.displayName,
    this.avatarUrl,
    this.role,
    this.locale,
    this.emailVisibility,
    this.emailVerified,
    this.disabled,
    this.metadata,
  });

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{};
    if (email != null) map['email'] = email;
    if (password != null) map['password'] = password;
    if (displayName != null) map['displayName'] = displayName;
    if (avatarUrl != null) map['avatarUrl'] = avatarUrl;
    if (role != null) map['role'] = role;
    if (locale != null) map['locale'] = locale;
    if (emailVisibility != null) map['emailVisibility'] = emailVisibility;
    if (emailVerified != null) map['emailVerified'] = emailVerified;
    if (disabled != null) map['disabled'] = disabled;
    if (metadata != null) map['metadata'] = metadata;
    return map;
  }
}

/// Admin Auth list result — aligned with server limit/cursor pagination.
class AdminListUsersResult {
  final List<AdminUser> users;
  final String? cursor; // null = no more pages

  AdminListUsersResult({
    required this.users,
    this.cursor,
  });
}

/// Admin Auth client — server-side user management.
class AdminAuthClient {
  final GeneratedAdminApi _core;
  final bool _hasServiceKey;

  AdminAuthClient(HttpClient client, this._hasServiceKey)
      : _core = GeneratedAdminApi(client);

  void _ensureServiceKey() {
    if (!_hasServiceKey) {
      throw EdgeBaseError(
        'AdminAuthClient requires a Service Key. '
        'Initialize EdgeBase with serviceKey option.',
      );
    }
  }

  /// Get a user by ID.
  Future<AdminUser> getUser(String userId) async {
    _ensureServiceKey();
    final resp = await _core.adminAuthGetUser(userId)
        as Map<String, dynamic>;
    // Server wraps response: {"user": {...}}
    final json = resp.containsKey('user')
        ? resp['user'] as Map<String, dynamic>
        : resp;
    return AdminUser.fromJson(json);
  }

  /// List users with cursor-based pagination (aligned with server API).
  Future<AdminListUsersResult> listUsers({
    int limit = 20,
    String? cursor,
  }) async {
    _ensureServiceKey();
    final query = <String, String>{
      'limit': limit.toString(),
    };
    if (cursor != null) query['cursor'] = cursor;

    final json = await _core.adminAuthListUsers(query)
        as Map<String, dynamic>;
    final users = (json['users'] as List<dynamic>)
        .map((e) => AdminUser.fromJson(e as Map<String, dynamic>))
        .toList();
    return AdminListUsersResult(
      users: users,
      cursor: json['cursor'] as String?,
    );
  }

  /// Update a user by ID.
  Future<AdminUser> updateUser(
    String userId,
    AdminUpdateUserOptions data,
  ) async {
    _ensureServiceKey();
    final resp = await _core.adminAuthUpdateUser(userId, data.toJson())
        as Map<String, dynamic>;
    // Server wraps response: {"user": {...}} — unwrap like getUser
    final json = resp.containsKey('user')
        ? resp['user'] as Map<String, dynamic>
        : resp;
    return AdminUser.fromJson(json);
  }

  /// Delete a user by ID.
  Future<void> deleteUser(String userId) async {
    _ensureServiceKey();
    await _core.adminAuthDeleteUser(userId);
  }

  /// Create a user (admin-initiated sign-up).
  Future<AdminUser> createUser({
    required String email,
    required String password,
    String? displayName,
    String? role,
    bool emailVerified = false,
    Map<String, dynamic>? metadata,
  }) async {
    _ensureServiceKey();
    final body = <String, dynamic>{
      'email': email,
      'password': password,
      'emailVerified': emailVerified,
    };
    if (displayName != null) body['displayName'] = displayName;
    if (role != null) body['role'] = role;
    if (metadata != null) body['metadata'] = metadata;

    final resp = await _core.adminAuthCreateUser(body)
        as Map<String, dynamic>;
    // Server wraps response: {"user": {...}, "accessToken": ...}
    final json = resp.containsKey('user')
        ? resp['user'] as Map<String, dynamic>
        : resp;
    return AdminUser.fromJson(json);
  }

  /// Set custom claims for a user (reflected in JWT on next token refresh).
  Future<void> setCustomClaims(
    String userId,
    Map<String, dynamic> claims,
  ) async {
    _ensureServiceKey();
    await _core.adminAuthSetClaims(userId, claims);
  }

  /// Revoke all sessions for a user (force re-authentication).
  Future<void> revokeAllSessions(String userId) async {
    _ensureServiceKey();
    await _core.adminAuthRevokeUserSessions(userId);
  }
}
