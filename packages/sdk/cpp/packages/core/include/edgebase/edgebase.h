// EdgeBase C++ Core SDK — Pure C++17, no Unreal dependencies.
//
// This library can be built with cmake (see core/CMakeLists.txt) and linked as
// a ThirdParty module inside Unreal Engine, or used directly in any C++
// project.
//
// Usage:
//   #include <edgebase/edgebase.h>
//
//   auto client = eb::EdgeBase("https://your-project.edgebase.fun");
//   auto result = client.auth().signUp("user@example.com", "password123");
//   if (result.ok) { /* use result.data */ }
//
//: Client-only SDK (no service key / server-only methods).
#pragma once

#include <atomic>
#include <condition_variable>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>
#include "edgebase/room_client.h"
#include "edgebase/generated/api_core.h"

namespace client {

// ── Primitive result
// ──────────────────────────────────────────────────────────

struct Result {
  bool ok = false;
  int statusCode = 0;
  std::string body; // raw JSON string
  std::string error;
};

// ── Filter / Sort
// ─────────────────────────────────────────────────────────────

struct Filter {
  std::string field;
  std::string op;
  std::string value;
};

struct Sort {
  std::string field;
  std::string direction = "asc";
};

class OrBuilder {
public:
  OrBuilder &where(const std::string &field, const std::string &op,
                   const std::string &value) {
    filters_.push_back({field, op, value});
    return *this;
  }
  const std::vector<Filter> &getFilters() const { return filters_; }

private:
  std::vector<Filter> filters_;
};

// ── ListResult
// ──────────────────────────────────────────────────────────────── Mirrors
// unified ListResult.

struct ListResult {
  std::vector<std::map<std::string, std::string>> items;
  std::optional<int> total;
  std::optional<int> page;
  std::optional<int> perPage;
  std::optional<bool> hasMore;
  std::optional<std::string> cursor;
};

// ── FileInfo
// ──────────────────────────────────────────────────────────────────

struct FileInfo {
  std::string key;
  std::string url;
  long long size = 0;
  std::string contentType;
  std::string createdAt;
};

// ── HttpClient (internal)
// ─────────────────────────────────────────────────────

class HttpClient {
public:
  explicit HttpClient(std::string baseUrl, std::string serviceKey = "");
  ~HttpClient();

  Result get(const std::string &path,
             const std::map<std::string, std::string> &query = {}) const;
  Result post(const std::string &path, const std::string &jsonBody) const;
  Result put(const std::string &path, const std::string &jsonBody) const;
  Result post_with_query(const std::string &path, const std::string &jsonBody,
                         const std::map<std::string, std::string> &query) const;
  Result post_bytes_with_query(const std::string &path,
                               const std::vector<uint8_t> &body,
                               const std::string &contentType,
                               const std::map<std::string, std::string> &query) const;
  Result patch(const std::string &path, const std::string &jsonBody) const;
  Result del(const std::string &path) const;
  /// DELETE request with body.
  Result del(const std::string &path, const std::string &jsonBody) const;

  /// HEAD request — returns true if resource exists (2xx).
  bool head(const std::string &path) const;

  // Multipart upload
  Result uploadMultipart(const std::string &path, const std::string &key,
                         const std::vector<uint8_t> &data,
                         const std::string &contentType) const;

  void setToken(const std::string &token);
  void clearToken();
  std::string getToken() const;
  void setRefreshToken(const std::string &token);
  void clearRefreshToken();
  std::string getRefreshToken() const;

  void setContext(const std::map<std::string, std::string> &ctx);
  std::map<std::string, std::string> getContext() const;
  void setLocale(const std::string &locale);
  std::string getLocale() const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

struct DbChange;
class DatabaseLiveClient;

// ── TableRef (immutable builder) ────────────────────────────────────────
// All HTTP calls delegate to GeneratedDbApi (api_core.h).
// No hardcoded API paths — the generated core is the single source of truth.

class TableRef {
public:
  TableRef(std::shared_ptr<GeneratedDbApi> core, std::string name,
           std::string ns = "shared", std::string instanceId = "",
           std::shared_ptr<DatabaseLiveClient> databaseLive = nullptr);

  TableRef where(const std::string &field, const std::string &op,
                 const std::string &value) const;
  TableRef or_(std::function<void(OrBuilder &)> builderFn) const;
  TableRef orderBy(const std::string &field,
                   const std::string &direction = "asc") const;
  TableRef limit(int n) const;
  TableRef offset(int n) const;
  TableRef page(int n) const;
  TableRef after(const std::string &cursor) const;
  TableRef before(const std::string &cursor) const;
  TableRef search(const std::string &q) const;
  TableRef doc(const std::string &id) const;

  // CRUD
  Result getList() const;
  Result getFirst() const;
  Result getOne(const std::string &id) const;
  Result insert(const std::string &jsonBody) const;
  Result update(const std::string &id, const std::string &jsonBody) const;
  Result del(const std::string &id) const;
  Result upsert(const std::string &jsonBody,
                const std::string &conflictTarget = "") const;
  Result count() const;

  // Batch
  Result insertMany(const std::string &jsonArray) const;
  Result upsertMany(const std::string &jsonArray,
                    const std::string &conflictTarget = "") const;
  Result updateMany(const std::string &jsonBody) const;
  Result deleteMany() const;
  int onSnapshot(std::function<void(const DbChange &)> handler) const;
  void unsubscribe(int id) const;

private:
  std::shared_ptr<GeneratedDbApi> core_;
  std::shared_ptr<DatabaseLiveClient> databaseLive_;
  std::string name_;
  std::string ns_;         // DB block namespace (#133 §2)
  std::string instanceId_; // Dynamic DO instance ID; empty for static DBs
  std::vector<Filter> filters_;
  std::vector<Filter> orFilters_;
  std::vector<Sort> sorts_;
  int limitVal_ = -1;
  int offsetVal_ = -1;
  int pageVal_ = -1;
  std::optional<std::string> afterCursor_;
  std::optional<std::string> beforeCursor_;
  std::string searchQ_;

  /// Build query string parameters from current filter/sort/pagination state.
  std::map<std::string, std::string> buildQueryParams() const;
  /// True when instanceId_ is non-empty (dynamic DO dispatch).
  bool isDynamic() const { return !instanceId_.empty(); }
};

// ── DbRef ────────────────────────────────────────────────────────────────────

/// Reference to a DB namespace block. Use .table(name) for CRUD (#133 §2).
class DbRef {
public:
  DbRef(std::shared_ptr<GeneratedDbApi> core, std::string ns,
        std::string instanceId = "",
        std::shared_ptr<DatabaseLiveClient> databaseLive = nullptr);

  /// Get a TableRef for the named table.
  TableRef table(const std::string &name) const;

private:
  std::shared_ptr<GeneratedDbApi> core_;
  std::shared_ptr<DatabaseLiveClient> databaseLive_;
  std::string ns_;
  std::string instanceId_;
};

// ── StorageBucket
// ─────────────────────────────────────────────────────────────

class StorageBucket {
public:
  StorageBucket(std::shared_ptr<HttpClient> http,
                std::shared_ptr<GeneratedDbApi> core, std::string baseUrl,
                std::string name);

  std::string getUrl(const std::string &key) const;

  Result
  upload(const std::string &key, const std::vector<uint8_t> &data,
         const std::string &contentType = "application/octet-stream") const;
  Result uploadString(const std::string &key, const std::string &content,
                      const std::string &encoding = "raw",
                      const std::string &contentType = "text/plain") const;
  Result download(const std::string &key) const;
  Result del(const std::string &key) const;
  Result list(const std::string &prefix = "", int limit = 100,
              int offset = 0) const;
  Result getMetadata(const std::string &key) const;
  Result updateMetadata(const std::string &key,
                        const std::string &jsonBody) const;
  Result createSignedUrl(const std::string &key,
                         const std::string &expiresIn = "1h") const;
  Result createSignedUrls(const std::vector<std::string> &keys,
                          const std::string &expiresIn = "1h") const;
  Result createSignedUploadUrl(const std::string &key,
                               const std::string &expiresIn = "1h") const;
  bool exists(const std::string &key) const;
  Result getUploadParts(const std::string &key,
                        const std::string &uploadId) const;

  /// Initiate a resumable upload. Returns upload ID in Result.body JSON.
  Result initiateResumableUpload(const std::string &key,
                                 const std::string &contentType = "") const;

  /// Upload a chunk for a resumable upload.
  Result resumeUpload(const std::string &key, const std::string &uploadId,
                      const std::vector<uint8_t> &chunk, int offset,
                      bool isLastChunk = false) const;

private:
  std::shared_ptr<HttpClient> http_;
  std::shared_ptr<GeneratedDbApi> core_;
  std::string baseUrl_;
  std::string name_;
};

// ── StorageClient
// ─────────────────────────────────────────────────────────────

class StorageClient {
public:
  explicit StorageClient(std::shared_ptr<HttpClient> http,
                         std::shared_ptr<GeneratedDbApi> core,
                         std::string baseUrl);

  StorageBucket bucket(const std::string &name) const;

private:
  std::shared_ptr<HttpClient> http_;
  std::shared_ptr<GeneratedDbApi> core_;
  std::string baseUrl_;
};

class FunctionsClient {
public:
  explicit FunctionsClient(std::shared_ptr<HttpClient> http);

  Result call(const std::string &path, const std::string &method = "POST",
              const std::string &jsonBody = "{}",
              const std::map<std::string, std::string> &query = {}) const;
  Result get(const std::string &path,
             const std::map<std::string, std::string> &query = {}) const;
  Result post(const std::string &path,
              const std::string &jsonBody = "{}") const;
  Result put(const std::string &path,
             const std::string &jsonBody = "{}") const;
  Result patch(const std::string &path,
               const std::string &jsonBody = "{}") const;
  Result del(const std::string &path) const;

private:
  std::shared_ptr<HttpClient> http_;
};

struct AnalyticsEvent {
  std::string name;
  std::string propertiesJson = "{}";
  std::optional<long long> timestamp;
};

class AnalyticsClient {
public:
  explicit AnalyticsClient(std::shared_ptr<GeneratedDbApi> core);

  Result track(const std::string &name,
               const std::string &propertiesJson = "{}") const;
  Result trackBatch(const std::vector<AnalyticsEvent> &events) const;
  void flush() const {}
  void destroy() const {}

private:
  std::shared_ptr<GeneratedDbApi> core_;
};

// ── AuthClient
// ────────────────────────────────────────────────────────────────

class AuthClient {
public:
  explicit AuthClient(std::shared_ptr<HttpClient> http,
                      std::shared_ptr<GeneratedDbApi> core = nullptr);

  Result signUp(const std::string &email, const std::string &password,
                const std::string &displayName = "",
                const std::string &captchaToken = "") const;
  Result signIn(const std::string &email, const std::string &password,
                const std::string &captchaToken = "") const;
  Result signOut() const;
  Result signInAnonymously(const std::string &captchaToken = "") const;

  /// Send a magic-link email to the given address.
  Result signInWithMagicLink(const std::string &email,
                             const std::string &captchaToken = "") const;

  /// Verify a magic-link token received from the email link.
  /// On success, stores access/refresh tokens and notifies auth listeners.
  Result verifyMagicLink(const std::string &token) const;

  /// OAuth login — returns the URL to open in browser/WebView.
  std::string signInWithOAuth(const std::string &provider,
                              const std::string &redirectUrl = "",
                              const std::string &captchaToken = "") const;

  // ── Phone / SMS Auth ──

  /// Send an SMS verification code to the given phone number.
  Result signInWithPhone(const std::string &phone) const;

  /// Verify the SMS code and sign in.
  Result verifyPhone(const std::string &phone,
                     const std::string &code) const;

  /// Link current account with a phone number. Sends an SMS code.
  Result linkWithPhone(const std::string &phone) const;

  /// Verify phone link code. Completes phone linking for the current account.
  Result verifyLinkPhone(const std::string &phone,
                         const std::string &code) const;

  /// Link anonymous account to email/password.
  Result linkWithEmail(const std::string &email,
                       const std::string &password) const;

  /// Link anonymous account with OAuth provider. Returns redirect URL.
  std::string linkWithOAuth(const std::string &provider,
                            const std::string &redirectUrl = "") const;

  Result changePassword(const std::string &currentPassword,
                        const std::string &newPassword) const;
  Result refreshToken() const;
  Result updateProfile(const std::map<std::string, std::string> &data) const;
  Result verifyEmail(const std::string &token) const;
  Result requestEmailVerification(const std::string &redirectUrl = "") const;
  Result verifyEmailChange(const std::string &token) const;
  Result requestPasswordReset(const std::string &email,
                              const std::string &captchaToken = "") const;
  Result resetPassword(const std::string &token,
                       const std::string &newPassword) const;
  Result changeEmail(const std::string &newEmail, const std::string &password,
                     const std::string &redirectUrl = "") const;
  Result signInWithEmailOtp(const std::string &email) const;
  Result verifyEmailOtp(const std::string &email,
                        const std::string &code) const;
  Result listSessions() const;
  Result revokeSession(const std::string &sessionId) const;
  Result listIdentities() const;
  Result unlinkIdentity(const std::string &identityId) const;

  std::string currentToken() const;

  /// Returns the current user as a JSON string (parsed from JWT).
  /// Returns empty string if not signed in.
  std::string currentUser() const;

  /// Register a callback for auth state changes.
  /// Callback receives the raw JSON body (or empty on sign-out).
  using AuthStateCallback = std::function<void(const std::string &userJson)>;
  void onAuthStateChange(AuthStateCallback callback);

  // ── MFA / TOTP ──

  /// Enroll TOTP — returns factorId, secret, qrCodeUri, recoveryCodes as JSON.
  Result enrollTotp() const;

  /// Verify TOTP enrollment with factorId and a TOTP code.
  Result verifyTotpEnrollment(const std::string &factorId,
                              const std::string &code) const;

  /// Verify TOTP code during MFA challenge (after signIn returns mfaRequired).
  Result verifyTotp(const std::string &mfaTicket,
                    const std::string &code) const;

  /// Use a recovery code during MFA challenge.
  Result useRecoveryCode(const std::string &mfaTicket,
                         const std::string &recoveryCode) const;

  /// Disable TOTP for the current user. Pass password or code.
  Result disableTotp(const std::string &password = "",
                     const std::string &code = "") const;

  /// List enrolled MFA factors for the current user.
  Result listFactors() const;

  /// Generate passkey registration options for the current authenticated user.
  Result passkeysRegisterOptions() const;

  /// Verify and store a passkey registration response.
  Result passkeysRegister(const std::string &responseJson) const;

  /// Generate passkey authentication options. If email is empty, server decides the account set.
  Result passkeysAuthOptions(const std::string &email = "") const;

  /// Authenticate with a passkey assertion and establish a session.
  Result passkeysAuthenticate(const std::string &responseJson) const;

  /// List registered passkeys for the current authenticated user.
  Result passkeysList() const;

  /// Delete a registered passkey by credential ID.
  Result passkeysDelete(const std::string &credentialId) const;

private:
  std::shared_ptr<HttpClient> http_;
  std::shared_ptr<GeneratedDbApi> core_;
  struct State;
  std::shared_ptr<State> state_;
  void notifyAuthChange(const std::string &userJson) const;
};

// ── DbChange
// ──────────────────────────────────────────────────────────────────

struct DbChange {
  std::string changeType; // "added" | "modified" | "removed"
  std::string table;
  std::string docId;
  std::string dataJson; // raw JSON string of the changed document
  std::string timestamp;
};

class DatabaseLiveClient; // forward declaration

// ── DatabaseLiveClient
// ────────────────────────────────────────────────────────────

using MessageHandler =
    std::function<void(const std::map<std::string, std::string> &msg)>;

/// Filter tuple for server-side filtering.
struct FilterTuple {
  std::string field;
  std::string op;
  std::string value;
};

/// Callback for subscription_revoked events.
using SubscriptionRevokedHandler =
    std::function<void(const std::string &channel)>;

class DatabaseLiveClient {
public:
  explicit DatabaseLiveClient(std::string baseUrl,
                          std::shared_ptr<HttpClient> http);
  ~DatabaseLiveClient();

  /// Subscribe to DB table changes.
  /// Returns a subscription id — pass to unsubscribe() to remove.
  /// Optional server-side filters.
  int onSnapshot(const std::string &tableName,
                 std::function<void(const DbChange &)> handler,
                 const std::vector<FilterTuple> &serverFilters = {},
                 const std::vector<FilterTuple> &serverOrFilters = {});

  void unsubscribe(int id);

  /// Send a raw message (used internally by Presence/Broadcast channels).
  void sendRaw(const std::string &json);

  /// Add a raw message handler (used internally by Presence/Broadcast
  /// channels).
  int addMessageHandler(MessageHandler handler);
  void removeMessageHandler(int id);

  /// Register a handler for subscription_revoked events.
  void onSubscriptionRevoked(SubscriptionRevokedHandler handler);

  void destroy();

private:
  std::string baseUrl_;
  std::shared_ptr<HttpClient> http_;

  std::atomic<bool> running_{false};
  std::atomic<bool> wsOpen_{false};
  std::atomic<bool> authenticated_{false};
  std::atomic<int> nextId_{1};

  std::mutex handlersMx_;
  std::map<int, MessageHandler> handlers_;
  std::map<int, std::pair<std::string, std::function<void(const DbChange &)>>>
      snapshotHandlers_;

  /// Server-side filters per channel for recovery after FILTER_RESYNC.
  std::map<std::string, std::vector<FilterTuple>> channelFilters_;
  /// Server-side OR filters per channel.
  std::map<std::string, std::vector<FilterTuple>> channelOrFilters_;
  /// Subscription revoked handlers.
  std::vector<SubscriptionRevokedHandler> revokedHandlers_;

  // Pending subscribe messages to send after WS open + auth
  std::mutex pendingMx_;
  std::vector<std::string> pendingSubscribes_;
  std::mutex wsReadyMx_;
  std::condition_variable wsReadyCv_;

  // IXWebSocket handle (held as void* to avoid header dependency in .h)
  void *ws_{nullptr};

  void connect(const std::string &channel = "");
  void dispatchMessage(const std::string &raw);
  void resubscribeAll();
  void resyncFilters();
};

// ── PushClient
// ──────────────────────────────────────────────────

class PushClient {
public:
  using MessageCallback = std::function<void(const std::string &messageJson)>;
  using PermissionProvider = std::function<std::string()>;
  using TokenProvider = std::function<std::string()>;

  explicit PushClient(std::shared_ptr<HttpClient> http);

  /// Register for push —.
  /// Obtains token via tokenProvider, caches, sends only on change (§9).
  void registerPush(const std::string &metadataJson = "");

  /// Set the platform string: "android", "ios", "macos", "web".
  /// Call once at startup based on the target platform.
  void setPlatform(const std::string &platform);

  /// Set token provider — app supplies native push token.
  void setTokenProvider(TokenProvider provider);

  /// Low-level: register a pre-obtained token with the server.
  Result registerToken(const std::string &deviceId, const std::string &token,
                       const std::string &platform,
                       const std::string &deviceInfoJson = "",
                       const std::string &metadataJson = "") const;

  /// Unregister current device (or a specific device).
  Result unregisterToken(const std::string &deviceId = "") const;

  /// Subscribe the current client token to a topic.
  Result subscribeTopic(const std::string &topic) const;

  /// Unsubscribe the current client token from a topic.
  Result unsubscribeTopic(const std::string &topic) const;

  /// Listen for push messages in foreground.
  void onMessage(MessageCallback callback);

  /// Listen for notification taps that opened the app.
  void onMessageOpenedApp(MessageCallback callback);

  /// Get notification permission status.
  std::string getPermissionStatus() const;

  /// Request notification permission.
  std::string requestPermission() const;

  /// Dispatch a foreground message. Called from native push handler.
  void dispatchMessage(const std::string &messageJson) const;

  /// Dispatch a notification-opened event.
  void dispatchMessageOpenedApp(const std::string &messageJson) const;

  /// Set device info JSON (app provides once at startup).
  /// e.g. '{"name":"Pixel 8","osVersion":"Android 14","locale":"ko-KR"}'
  void setDeviceInfo(const std::string &deviceInfoJson);

  /// Set provider for permission status (platform-specific).
  void setPermissionStatusProvider(PermissionProvider provider);

  /// Set provider for permission request (platform-specific).
  void setPermissionRequester(PermissionProvider requester);

private:
  std::shared_ptr<HttpClient> http_;
  struct State;
  std::shared_ptr<State> state_;

  std::string getOrCreateDeviceId();
};

// ── EdgeBase (entry point)
// ────────────────────────────────────

class EdgeBase {
public:
  explicit EdgeBase(std::string url);
  ~EdgeBase();

  AuthClient auth() const;
  StorageClient storage() const;
  PushClient push() const;
  FunctionsClient functions() const;
  AnalyticsClient analytics() const;
  /// Select a DB block by namespace and optional instance ID (#133 §2).
  DbRef db(const std::string &ns, const std::string &instanceId = "") const;

  /// Create a RoomClient v2 for the given namespace and room ID.
  /// @param namespace_name  Room namespace (e.g. "game", "chat")
  /// @param room_id         Room instance ID within the namespace
  /// @param opts            Connection options
  std::shared_ptr<edgebase::RoomClient>
  room(const std::string &namespace_name, const std::string &room_id,
       edgebase::RoomOptions opts = edgebase::RoomOptions()) const;

  /// Set isolateBy context.
  void setContext(const std::map<std::string, std::string> &ctx);
  /// Get current context.
  std::map<std::string, std::string> getContext() const;
  void setLocale(const std::string &locale);
  std::string getLocale() const;

private:
  std::string baseUrl_;
  std::shared_ptr<HttpClient> http_;
  std::shared_ptr<GeneratedDbApi> core_;
  mutable std::shared_ptr<DatabaseLiveClient> databaseLive_;
  mutable std::shared_ptr<AuthClient> authClient_;
  mutable std::shared_ptr<PushClient> pushClient_;

  std::shared_ptr<DatabaseLiveClient> databaseLive() const;
};

} // namespace client

namespace eb = client;
