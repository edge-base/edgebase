// Auth client for user authentication.
//
// Mirrors JS SDK AuthClient with Dart idioms.
//: onAuthStateChange (Stream)
//: signInAnonymously
//: signUp with data

import 'package:edgebase_core/src/http_client.dart';
import 'package:edgebase_core/src/generated/api_core.dart';
import 'token_manager.dart';
import 'captcha_provider.dart';
import 'push_client_stub.dart' if (dart.library.ui) 'push_client.dart';

class SignUpOptions {
  final String email;
  final String password;
  final Map<String, dynamic>? data;
  /// Captcha token. If provided, SDK built-in widget is skipped.
  final String? captchaToken;

  SignUpOptions({
    required this.email,
    required this.password,
    this.data,
    this.captchaToken,
  });
}

class SignInOptions {
  final String email;
  final String password;
  /// Captcha token. If provided, SDK built-in widget is skipped.
  final String? captchaToken;

  SignInOptions({required this.email, required this.password, this.captchaToken});
}

class AuthResult {
  final TokenUser user;
  final String accessToken;
  final String refreshToken;

  AuthResult({
    required this.user,
    required this.accessToken,
    required this.refreshToken,
  });

  factory AuthResult.fromJson(
    Map<String, dynamic> json,
    TokenUser user,
  ) {
    return AuthResult(
      user: user,
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
    );
  }

  // Backwards-compatible alias for older runners that expect a session payload.
  AuthResult get session => this;
}

/// Returned when MFA is required during sign-in.
class MfaRequiredResult {
  final bool mfaRequired;
  final String mfaTicket;
  final List<MfaFactor> factors;

  MfaRequiredResult({
    required this.mfaRequired,
    required this.mfaTicket,
    required this.factors,
  });

  factory MfaRequiredResult.fromJson(Map<String, dynamic> json) {
    final factorsList = (json['factors'] as List<dynamic>? ?? [])
        .map((e) => MfaFactor.fromJson(e as Map<String, dynamic>))
        .toList();
    return MfaRequiredResult(
      mfaRequired: json['mfaRequired'] as bool,
      mfaTicket: json['mfaTicket'] as String,
      factors: factorsList,
    );
  }
}

class MfaFactor {
  final String id;
  final String type;

  MfaFactor({required this.id, required this.type});

  factory MfaFactor.fromJson(Map<String, dynamic> json) {
    return MfaFactor(
      id: json['id'] as String,
      type: json['type'] as String,
    );
  }
}

/// Union result for signIn — either [AuthResult] or [MfaRequiredResult].
class SignInResult {
  final AuthResult? authResult;
  final MfaRequiredResult? mfaResult;

  bool get mfaRequired => mfaResult != null;
  String? get accessToken => authResult?.accessToken;
  AuthResult? get session => authResult;
  TokenUser? get user => authResult?.user;

  SignInResult._({this.authResult, this.mfaResult});

  factory SignInResult.auth(AuthResult result) =>
      SignInResult._(authResult: result);

  factory SignInResult.mfa(MfaRequiredResult result) =>
      SignInResult._(mfaResult: result);
}

class TotpEnrollResult {
  final String factorId;
  final String secret;
  final String qrCodeUri;
  final List<String> recoveryCodes;

  TotpEnrollResult({
    required this.factorId,
    required this.secret,
    required this.qrCodeUri,
    required this.recoveryCodes,
  });

  factory TotpEnrollResult.fromJson(Map<String, dynamic> json) {
    return TotpEnrollResult(
      factorId: json['factorId'] as String,
      secret: json['secret'] as String,
      qrCodeUri: json['qrCodeUri'] as String,
      recoveryCodes: (json['recoveryCodes'] as List<dynamic>)
          .map((e) => e as String)
          .toList(),
    );
  }
}

class Session {
  final String id;
  final String createdAt;
  final String? userAgent;
  final String? ip;

  Session({
    required this.id,
    required this.createdAt,
    this.userAgent,
    this.ip,
  });

  factory Session.fromJson(Map<String, dynamic> json) {
    return Session(
      id: json['id'] as String,
      createdAt: json['createdAt'] as String,
      userAgent: json['userAgent'] as String?,
      ip: json['ip'] as String?,
    );
  }
}

class UpdateProfileOptions {
  final String? displayName;
  final String? avatarUrl;
  final String? emailVisibility;

  UpdateProfileOptions({this.displayName, this.avatarUrl, this.emailVisibility});

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{};
    if (displayName != null) map['displayName'] = displayName;
    if (avatarUrl != null) map['avatarUrl'] = avatarUrl;
    if (emailVisibility != null) map['emailVisibility'] = emailVisibility;
    return map;
  }
}

class PasskeysAuthOptions {
  final String? email;

  const PasskeysAuthOptions({this.email});

  Map<String, dynamic> toJson() {
    if (email == null) return const {};
    return {'email': email};
  }
}

class LinkedIdentity {
  final String id;
  final String kind;
  final String provider;
  final String providerUserId;
  final String createdAt;
  final bool canUnlink;

  LinkedIdentity({
    required this.id,
    required this.kind,
    required this.provider,
    required this.providerUserId,
    required this.createdAt,
    required this.canUnlink,
  });

  factory LinkedIdentity.fromJson(Map<String, dynamic> json) {
    return LinkedIdentity(
      id: json['id']?.toString() ?? '',
      kind: json['kind']?.toString() ?? 'oauth',
      provider: json['provider']?.toString() ?? '',
      providerUserId: json['providerUserId']?.toString() ?? '',
      createdAt: json['createdAt']?.toString() ?? '',
      canUnlink: json['canUnlink'] == true,
    );
  }
}

class IdentitiesResult {
  final bool? ok;
  final List<LinkedIdentity> identities;
  final Map<String, dynamic> methods;

  IdentitiesResult({
    this.ok,
    required this.identities,
    required this.methods,
  });

  factory IdentitiesResult.fromJson(Map<String, dynamic> json) {
    final rawIdentities = (json['identities'] as List<dynamic>? ?? const []);
    return IdentitiesResult(
      ok: json['ok'] as bool?,
      identities: rawIdentities
          .whereType<Map<String, dynamic>>()
          .map(LinkedIdentity.fromJson)
          .toList(),
      methods: (json['methods'] as Map<String, dynamic>?) ?? const {},
    );
  }
}

TokenUser? _normalizeAuthUser(dynamic source) {
  if (source is! Map<String, dynamic>) return null;
  final id = source['id'] ?? source['userId'] ?? source['sub'];
  if (id == null) return null;
  return TokenUser(
    id: '$id',
    email: source['email'] as String?,
    displayName: source['displayName'] as String?,
    avatarUrl: source['avatarUrl'] as String?,
    emailVerified: source['emailVerified'] as bool?,
    isAnonymous: source['isAnonymous'] as bool?,
    customClaims: source['customClaims'] as Map<String, dynamic>?,
  );
}

TokenUser _resolveAuthUser(TokenManager tokenManager, Map<String, dynamic> json) {
  return tokenManager.currentUser ??
      _normalizeAuthUser(json['user']) ??
      TokenUser(
        id: (json['userId'] ?? json['id'] ?? 'unknown-user').toString(),
        email: json['email'] as String?,
      );
}

class AuthClient {
  final HttpClient _client;
  final TokenManager _tokenManager;
  final GeneratedDbApi _core;

  AuthClient(this._client, this._tokenManager) : _core = GeneratedDbApi(_client);

  /// Register a new user.
  Future<AuthResult> signUp(SignUpOptions options) async {
    final body = <String, dynamic>{
      'email': options.email,
      'password': options.password,
    };
    if (options.data != null) body['data'] = options.data;
    //: auto-acquire captcha token if not manually provided
    final captchaToken = await resolveCaptchaToken(_client.baseUrl, 'signup', options.captchaToken, _client);
    if (captchaToken != null) body['captchaToken'] = captchaToken;

    final json = await _client.postPublic('/auth/signup', body)
        as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// Sign in with email and password. Returns [SignInResult] which may contain
  /// MFA challenge data if the user has MFA enabled.
  Future<SignInResult> signIn(SignInOptions options) async {
    final body = <String, dynamic>{
      'email': options.email,
      'password': options.password,
    };
    //: auto-acquire captcha token if not manually provided
    final captchaToken = await resolveCaptchaToken(_client.baseUrl, 'signin', options.captchaToken, _client);
    if (captchaToken != null) body['captchaToken'] = captchaToken;
    final json = await _client.postPublic('/auth/signin', body) as Map<String, dynamic>;
    if (json['mfaRequired'] == true) {
      return SignInResult.mfa(MfaRequiredResult.fromJson(json));
    }
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return SignInResult.auth(
      AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json)),
    );
  }

  /// Sign out (revokes current session).
  Future<void> signOut() async {
    // Auto-unregister push token
    try {
      final push = PushClient(_client);
      await push.unregister();
    } catch (_) {}

    try {
      final refreshToken = await _tokenManager.storage.getRefreshToken();
      if (refreshToken != null) {
        await _client.post('/auth/signout', {'refreshToken': refreshToken});
      }
    } catch (_) {
      // Continue even if server call fails
    }
    await _tokenManager.clearTokens();
  }

  /// Start OAuth sign-in flow. Returns the OAuth redirect URL.
  /// [captchaToken] — Captcha token.
  String signInWithOAuth(
    String provider, {
    String? redirectUrl,
    String? captchaToken,
  }) {
    final base = '${_client.baseUrl}/api/auth/oauth/${Uri.encodeComponent(provider)}';
    if (captchaToken != null) {
      return '$base?captcha_token=${Uri.encodeComponent(captchaToken)}';
    }
    return base;
  }

  /// Sign in anonymously.
  Future<AuthResult> signInAnonymously({String? captchaToken}) async {
    final body = <String, dynamic>{};
    //: auto-acquire captcha token if not manually provided
    final resolved = await resolveCaptchaToken(_client.baseUrl, 'anonymous', captchaToken, _client);
    if (resolved != null) body['captchaToken'] = resolved;
    final json = await _client.postPublic('/auth/signin/anonymous', body)
        as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// Send a magic link to the given email address.
  Future<void> signInWithMagicLink({
    required String email,
    String? captchaToken,
  }) async {
    final body = <String, dynamic>{'email': email};
    final resolved = await resolveCaptchaToken(_client.baseUrl, 'magic-link', captchaToken, _client);
    if (resolved != null) body['captchaToken'] = resolved;
    await _client.postPublic('/auth/signin/magic-link', body);
  }

  /// Verify a magic link token and sign in.
  Future<AuthResult> verifyMagicLink(String token) async {
    final json = await _client.postPublic('/auth/verify-magic-link', {
      'token': token,
    }) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  // ─── Phone / SMS Auth ───

  /// Send an SMS verification code to the given phone number.
  Future<void> signInWithPhone({
    required String phone,
    String? captchaToken,
  }) async {
    final body = <String, dynamic>{'phone': phone};
    final resolved = await resolveCaptchaToken(
      _client.baseUrl,
      'phone',
      captchaToken,
      _client,
    );
    if (resolved != null) body['captchaToken'] = resolved;
    await _client.postPublic('/auth/signin/phone', body);
  }

  /// Verify the SMS code and sign in.
  Future<AuthResult> verifyPhone({
    required String phone,
    required String code,
  }) async {
    final json = await _client.postPublic('/auth/verify-phone', {
      'phone': phone,
      'code': code,
    }) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// Link current account with a phone number. Sends an SMS code.
  Future<void> linkWithPhone({required String phone}) async {
    await _client.post('/auth/link/phone', {'phone': phone});
  }

  /// Verify phone link code. Completes phone linking for the current account.
  Future<void> verifyLinkPhone({
    required String phone,
    required String code,
  }) async {
    await _client.post('/auth/verify-link-phone', {
      'phone': phone,
      'code': code,
    });
  }

  /// Link anonymous account to email/password.
  Future<AuthResult> linkWithEmail({
    required String email,
    required String password,
  }) async {
    final json = await _client.post('/auth/link/email', {
      'email': email,
      'password': password,
    }) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// Link anonymous account to OAuth provider. Returns redirect URL.
  Future<String> linkWithOAuth(
    String provider, {
    String? redirectUrl,
  }) async {
    final json = await _client.post('/auth/oauth/link/${Uri.encodeComponent(provider)}', {
      'redirectUrl': redirectUrl ?? '',
    }) as Map<String, dynamic>;
    return json['redirectUrl'] as String;
  }

  /// Stream of auth state changes.
  Stream<TokenUser?> get onAuthStateChange =>
      _tokenManager.onAuthStateChange;

  /// Current authenticated user (from cached JWT).
  TokenUser? get currentUser => _tokenManager.currentUser;

  /// List active sessions.
  Future<List<Session>> listSessions() async {
    final result = await _client.get('/auth/sessions') as Map<String, dynamic>;
    final list = (result['sessions'] as List<dynamic>?) ?? [];
    return list
        .map((e) => Session.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Revoke a specific session.
  Future<void> revokeSession(String sessionId) async {
    await _client.delete('/auth/sessions/$sessionId');
  }

  /// List linked sign-in identities for the current user.
  Future<IdentitiesResult> listIdentities() async {
    final json = await _core.authGetIdentities() as Map<String, dynamic>;
    return IdentitiesResult.fromJson(json);
  }

  /// Unlink a linked OAuth identity by its identity ID.
  Future<IdentitiesResult> unlinkIdentity(String identityId) async {
    final json = await _client.delete('/auth/identities/${Uri.encodeComponent(identityId)}')
        as Map<String, dynamic>;
    return IdentitiesResult.fromJson(json);
  }

  /// Update current user's profile.
  Future<TokenUser> updateProfile(UpdateProfileOptions data) async {
    final json = await _client.patch('/auth/profile', data.toJson())
        as Map<String, dynamic>;
    if (json.containsKey('accessToken')) {
      // Server returns new accessToken when displayName changes (included in JWT).
      // refreshToken may not be returned — keep existing one.
      final newRefresh = json['refreshToken'] as String?
          ?? await _tokenManager.storage.getRefreshToken()
          ?? '';
      await _tokenManager.setTokens(
        json['accessToken'] as String,
        newRefresh,
      );
    }
    return _resolveAuthUser(_tokenManager, json);
  }

  Future<AuthResult> refreshToken() async {
    final refreshToken = await _tokenManager.storage.getRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      throw StateError('No refresh token available.');
    }
    final json = await _client.postPublic('/auth/refresh', {
      'refreshToken': refreshToken,
    }) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// Verify email address with token.
  Future<void> verifyEmail(String token) async {
    await _client.postPublic('/auth/verify-email', {'token': token});
  }

  Future<void> requestEmailVerification({String? redirectUrl}) async {
    final body = <String, dynamic>{};
    if (redirectUrl != null) body['redirectUrl'] = redirectUrl;
    await _client.post('/auth/request-email-verification', body);
  }

  /// Request password reset email.
  Future<void> requestPasswordReset(String email, {String? captchaToken}) async {
    final body = <String, dynamic>{'email': email};
    //: auto-acquire captcha token if not manually provided
    final resolved = await resolveCaptchaToken(_client.baseUrl, 'password-reset', captchaToken, _client);
    if (resolved != null) body['captchaToken'] = resolved;
    await _client.postPublic('/auth/request-password-reset', body);
  }

  /// Reset password with token.
  Future<void> resetPassword(String token, String newPassword) async {
    await _client.postPublic('/auth/reset-password', {
      'token': token,
      'newPassword': newPassword,
    });
  }

  /// Change password for authenticated user.
  Future<AuthResult> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final json = await _client.post('/auth/change-password', {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    }) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  Future<void> changeEmail(
    String newEmail, {
    String? password,
    String? redirectUrl,
  }) async {
    if (password == null || password.isEmpty) {
      throw ArgumentError('password is required for changeEmail');
    }
    final body = <String, dynamic>{
      'newEmail': newEmail,
      'password': password,
    };
    if (redirectUrl != null) body['redirectUrl'] = redirectUrl;
    await _client.post('/auth/change-email', body);
  }

  Future<void> verifyEmailChange(String token) async {
    await _core.authVerifyEmailChange({'token': token});
  }

  Future<void> signInWithEmailOtp(String email) async {
    await _client.post('/auth/signin/email-otp', {'email': email});
  }

  Future<AuthResult> verifyEmailOtp({
    required String email,
    required String code,
  }) async {
    final json = await _core.authVerifyEmailOtp({
      'email': email,
      'code': code,
    }) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// Generate WebAuthn registration options for the current authenticated user.
  Future<dynamic> passkeysRegisterOptions() {
    return _core.authPasskeysRegisterOptions();
  }

  /// Verify and store a passkey registration response from the platform credential API.
  Future<dynamic> passkeysRegister(Object? response) {
    return _core.authPasskeysRegister({'response': response});
  }

  /// Generate WebAuthn authentication options.
  Future<dynamic> passkeysAuthOptions([PasskeysAuthOptions options = const PasskeysAuthOptions()]) {
    return _core.authPasskeysAuthOptions(options.toJson());
  }

  /// Verify a WebAuthn assertion and establish a session.
  Future<AuthResult> passkeysAuthenticate(Object? response) async {
    final json = await _core.authPasskeysAuthenticate({'response': response}) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// List registered passkeys for the current authenticated user.
  Future<dynamic> passkeysList() {
    return _core.authPasskeysList();
  }

  /// Delete a registered passkey by credential ID.
  Future<dynamic> passkeysDelete(String credentialId) {
    return _core.authPasskeysDelete(credentialId);
  }

  // ─── MFA / TOTP ───

  /// MFA sub-namespace for TOTP enrollment, verification, and management.
  late final mfa = _MfaClient(_client, _tokenManager);

}

/// MFA sub-client — manages TOTP enrollment, verification, and factors.
class _MfaClient {
  final HttpClient _client;
  final TokenManager _tokenManager;

  _MfaClient(this._client, this._tokenManager);

  /// Enroll TOTP — returns secret, QR code URI, and recovery codes.
  Future<TotpEnrollResult> enrollTotp() async {
    final json = await _client.post('/auth/mfa/totp/enroll', {})
        as Map<String, dynamic>;
    return TotpEnrollResult.fromJson(json);
  }

  /// Verify TOTP enrollment with factorId and a TOTP code.
  Future<void> verifyTotpEnrollment(String factorId, String code) async {
    await _client.post('/auth/mfa/totp/verify', {
      'factorId': factorId,
      'code': code,
    });
  }

  /// Verify TOTP code during MFA challenge (after signIn returns mfaRequired).
  Future<AuthResult> verifyTotp(String mfaTicket, String code) async {
    final json = await _client.postPublic('/auth/mfa/verify', {
      'mfaTicket': mfaTicket,
      'code': code,
    }) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// Use a recovery code during MFA challenge.
  Future<AuthResult> useRecoveryCode(String mfaTicket, String recoveryCode) async {
    final json = await _client.postPublic('/auth/mfa/recovery', {
      'mfaTicket': mfaTicket,
      'recoveryCode': recoveryCode,
    }) as Map<String, dynamic>;
    await _tokenManager.setTokens(
      json['accessToken'] as String,
      json['refreshToken'] as String,
    );
    return AuthResult.fromJson(json, _resolveAuthUser(_tokenManager, json));
  }

  /// Disable TOTP for the current user. Requires password or TOTP code.
  Future<void> disableTotp({String? password, String? code}) async {
    final body = <String, dynamic>{};
    if (password != null) body['password'] = password;
    if (code != null) body['code'] = code;
    await _client.delete('/auth/mfa/totp', body);
  }

  /// List enrolled MFA factors for the current user.
  Future<List<MfaFactor>> listFactors() async {
    final json = await _client.get('/auth/mfa/factors') as Map<String, dynamic>;
    final list = (json['factors'] as List<dynamic>?) ?? [];
    return list
        .map((e) => MfaFactor.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
