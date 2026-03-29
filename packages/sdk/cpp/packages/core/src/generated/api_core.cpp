// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

#include "edgebase/generated/api_core.h"
#include "edgebase/edgebase.h"

namespace client {
namespace {
std::string edgebase_encode_path_param(const std::string& value) {
  static constexpr char HEX[] = "0123456789ABCDEF";
  std::string encoded;
  encoded.reserve(value.size() * 3);
  for (unsigned char ch : value) {
    const bool is_unreserved =
        (ch >= 'A' && ch <= 'Z') ||
        (ch >= 'a' && ch <= 'z') ||
        (ch >= '0' && ch <= '9') ||
        ch == '-' || ch == '.' || ch == '_' || ch == '~';
    if (is_unreserved) {
      encoded.push_back(static_cast<char>(ch));
      continue;
    }
    encoded.push_back('%');
    encoded.push_back(HEX[(ch >> 4) & 0x0F]);
    encoded.push_back(HEX[ch & 0x0F]);
  }
  return encoded;
}
} // namespace

Result GeneratedDbApi::get_health() const {
  return http_.get("/api/health");
}

Result GeneratedDbApi::auth_signup(const std::string& json_body) const {
  return http_.post("/api/auth/signup", json_body);
}

Result GeneratedDbApi::auth_signin(const std::string& json_body) const {
  return http_.post("/api/auth/signin", json_body);
}

Result GeneratedDbApi::auth_signin_anonymous(const std::string& json_body) const {
  return http_.post("/api/auth/signin/anonymous", json_body);
}

Result GeneratedDbApi::auth_signin_magic_link(const std::string& json_body) const {
  return http_.post("/api/auth/signin/magic-link", json_body);
}

Result GeneratedDbApi::auth_verify_magic_link(const std::string& json_body) const {
  return http_.post("/api/auth/verify-magic-link", json_body);
}

Result GeneratedDbApi::auth_signin_phone(const std::string& json_body) const {
  return http_.post("/api/auth/signin/phone", json_body);
}

Result GeneratedDbApi::auth_verify_phone(const std::string& json_body) const {
  return http_.post("/api/auth/verify-phone", json_body);
}

Result GeneratedDbApi::auth_link_phone(const std::string& json_body) const {
  return http_.post("/api/auth/link/phone", json_body);
}

Result GeneratedDbApi::auth_verify_link_phone(const std::string& json_body) const {
  return http_.post("/api/auth/verify-link-phone", json_body);
}

Result GeneratedDbApi::auth_signin_email_otp(const std::string& json_body) const {
  return http_.post("/api/auth/signin/email-otp", json_body);
}

Result GeneratedDbApi::auth_verify_email_otp(const std::string& json_body) const {
  return http_.post("/api/auth/verify-email-otp", json_body);
}

Result GeneratedDbApi::auth_mfa_totp_enroll() const {
  return http_.post("/api/auth/mfa/totp/enroll", "{}");
}

Result GeneratedDbApi::auth_mfa_totp_verify(const std::string& json_body) const {
  return http_.post("/api/auth/mfa/totp/verify", json_body);
}

Result GeneratedDbApi::auth_mfa_verify(const std::string& json_body) const {
  return http_.post("/api/auth/mfa/verify", json_body);
}

Result GeneratedDbApi::auth_mfa_recovery(const std::string& json_body) const {
  return http_.post("/api/auth/mfa/recovery", json_body);
}

Result GeneratedDbApi::auth_mfa_totp_delete(const std::string& json_body) const {
  return http_.del("/api/auth/mfa/totp", json_body);
}

Result GeneratedDbApi::auth_mfa_factors() const {
  return http_.get("/api/auth/mfa/factors");
}

Result GeneratedDbApi::auth_refresh(const std::string& json_body) const {
  return http_.post("/api/auth/refresh", json_body);
}

Result GeneratedDbApi::auth_signout(const std::string& json_body) const {
  return http_.post("/api/auth/signout", json_body);
}

Result GeneratedDbApi::auth_change_password(const std::string& json_body) const {
  return http_.post("/api/auth/change-password", json_body);
}

Result GeneratedDbApi::auth_change_email(const std::string& json_body) const {
  return http_.post("/api/auth/change-email", json_body);
}

Result GeneratedDbApi::auth_verify_email_change(const std::string& json_body) const {
  return http_.post("/api/auth/verify-email-change", json_body);
}

Result GeneratedDbApi::auth_passkeys_register_options() const {
  return http_.post("/api/auth/passkeys/register-options", "{}");
}

Result GeneratedDbApi::auth_passkeys_register(const std::string& json_body) const {
  return http_.post("/api/auth/passkeys/register", json_body);
}

Result GeneratedDbApi::auth_passkeys_auth_options(const std::string& json_body) const {
  return http_.post("/api/auth/passkeys/auth-options", json_body);
}

Result GeneratedDbApi::auth_passkeys_authenticate(const std::string& json_body) const {
  return http_.post("/api/auth/passkeys/authenticate", json_body);
}

Result GeneratedDbApi::auth_passkeys_list() const {
  return http_.get("/api/auth/passkeys");
}

Result GeneratedDbApi::auth_passkeys_delete(const std::string& credential_id) const {
  return http_.del("/api/auth/passkeys/" + edgebase_encode_path_param(credential_id));
}

Result GeneratedDbApi::auth_get_me() const {
  return http_.get("/api/auth/me");
}

Result GeneratedDbApi::auth_update_profile(const std::string& json_body) const {
  return http_.patch("/api/auth/profile", json_body);
}

Result GeneratedDbApi::auth_get_sessions() const {
  return http_.get("/api/auth/sessions");
}

Result GeneratedDbApi::auth_delete_session(const std::string& id) const {
  return http_.del("/api/auth/sessions/" + edgebase_encode_path_param(id));
}

Result GeneratedDbApi::auth_get_identities() const {
  return http_.get("/api/auth/identities");
}

Result GeneratedDbApi::auth_delete_identity(const std::string& identity_id) const {
  return http_.del("/api/auth/identities/" + edgebase_encode_path_param(identity_id));
}

Result GeneratedDbApi::auth_link_email(const std::string& json_body) const {
  return http_.post("/api/auth/link/email", json_body);
}

Result GeneratedDbApi::auth_request_email_verification(const std::string& json_body) const {
  return http_.post("/api/auth/request-email-verification", json_body);
}

Result GeneratedDbApi::auth_verify_email(const std::string& json_body) const {
  return http_.post("/api/auth/verify-email", json_body);
}

Result GeneratedDbApi::auth_request_password_reset(const std::string& json_body) const {
  return http_.post("/api/auth/request-password-reset", json_body);
}

Result GeneratedDbApi::auth_reset_password(const std::string& json_body) const {
  return http_.post("/api/auth/reset-password", json_body);
}

Result GeneratedDbApi::oauth_redirect(const std::string& provider) const {
  return http_.get("/api/auth/oauth/" + edgebase_encode_path_param(provider));
}

Result GeneratedDbApi::oauth_callback(const std::string& provider) const {
  return http_.get("/api/auth/oauth/" + edgebase_encode_path_param(provider) + "/callback");
}

Result GeneratedDbApi::oauth_link_start(const std::string& provider) const {
  return http_.post("/api/auth/oauth/link/" + edgebase_encode_path_param(provider), "{}");
}

Result GeneratedDbApi::oauth_link_callback(const std::string& provider) const {
  return http_.get("/api/auth/oauth/link/" + edgebase_encode_path_param(provider) + "/callback");
}

Result GeneratedDbApi::db_single_count_records(const std::string& namespace_, const std::string& table, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table) + "/count", query);
}

Result GeneratedDbApi::db_single_search_records(const std::string& namespace_, const std::string& table, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table) + "/search", query);
}

Result GeneratedDbApi::db_single_get_record(const std::string& namespace_, const std::string& table, const std::string& id, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table) + "/" + edgebase_encode_path_param(id), query);
}

Result GeneratedDbApi::db_single_update_record(const std::string& namespace_, const std::string& table, const std::string& id, const std::string& json_body) const {
  return http_.patch("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table) + "/" + edgebase_encode_path_param(id), json_body);
}

Result GeneratedDbApi::db_single_delete_record(const std::string& namespace_, const std::string& table, const std::string& id) const {
  return http_.del("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table) + "/" + edgebase_encode_path_param(id));
}

Result GeneratedDbApi::db_single_list_records(const std::string& namespace_, const std::string& table, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table), query);
}

Result GeneratedDbApi::db_single_insert_record(const std::string& namespace_, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query) const {
  return http_.post_with_query("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table), json_body, query);
}

Result GeneratedDbApi::db_single_batch_records(const std::string& namespace_, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query) const {
  return http_.post_with_query("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table) + "/batch", json_body, query);
}

Result GeneratedDbApi::db_single_batch_by_filter(const std::string& namespace_, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query) const {
  return http_.post_with_query("/api/db/" + edgebase_encode_path_param(namespace_) + "/tables/" + edgebase_encode_path_param(table) + "/batch-by-filter", json_body, query);
}

Result GeneratedDbApi::db_count_records(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table) + "/count", query);
}

Result GeneratedDbApi::db_search_records(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table) + "/search", query);
}

Result GeneratedDbApi::db_get_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table) + "/" + edgebase_encode_path_param(id), query);
}

Result GeneratedDbApi::db_update_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id, const std::string& json_body) const {
  return http_.patch("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table) + "/" + edgebase_encode_path_param(id), json_body);
}

Result GeneratedDbApi::db_delete_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id) const {
  return http_.del("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table) + "/" + edgebase_encode_path_param(id));
}

Result GeneratedDbApi::db_list_records(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table), query);
}

Result GeneratedDbApi::db_insert_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query) const {
  return http_.post_with_query("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table), json_body, query);
}

Result GeneratedDbApi::db_batch_records(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query) const {
  return http_.post_with_query("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table) + "/batch", json_body, query);
}

Result GeneratedDbApi::db_batch_by_filter(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query) const {
  return http_.post_with_query("/api/db/" + edgebase_encode_path_param(namespace_) + "/" + edgebase_encode_path_param(instance_id) + "/tables/" + edgebase_encode_path_param(table) + "/batch-by-filter", json_body, query);
}

Result GeneratedDbApi::check_database_subscription_connection(const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/connect-check", query);
}

Result GeneratedDbApi::connect_database_subscription(const std::map<std::string, std::string>& query) const {
  return http_.get("/api/db/subscribe", query);
}

Result GeneratedDbApi::get_schema() const {
  return http_.get("/api/schema");
}

Result GeneratedDbApi::upload_file(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/upload", json_body);
}

Result GeneratedDbApi::get_file_metadata(const std::string& bucket, const std::string& key) const {
  return http_.get("/api/storage/" + edgebase_encode_path_param(bucket) + "/" + edgebase_encode_path_param(key) + "/metadata");
}

Result GeneratedDbApi::update_file_metadata(const std::string& bucket, const std::string& key, const std::string& json_body) const {
  return http_.patch("/api/storage/" + edgebase_encode_path_param(bucket) + "/" + edgebase_encode_path_param(key) + "/metadata", json_body);
}

bool GeneratedDbApi::check_file_exists(const std::string& bucket, const std::string& key) const {
  return http_.head("/api/storage/" + edgebase_encode_path_param(bucket) + "/" + edgebase_encode_path_param(key));
}

Result GeneratedDbApi::download_file(const std::string& bucket, const std::string& key) const {
  return http_.get("/api/storage/" + edgebase_encode_path_param(bucket) + "/" + edgebase_encode_path_param(key));
}

Result GeneratedDbApi::delete_file(const std::string& bucket, const std::string& key) const {
  return http_.del("/api/storage/" + edgebase_encode_path_param(bucket) + "/" + edgebase_encode_path_param(key));
}

Result GeneratedDbApi::get_upload_parts(const std::string& bucket, const std::string& upload_id, const std::map<std::string, std::string>& query) const {
  return http_.get("/api/storage/" + edgebase_encode_path_param(bucket) + "/uploads/" + edgebase_encode_path_param(upload_id) + "/parts", query);
}

Result GeneratedDbApi::list_files(const std::string& bucket) const {
  return http_.get("/api/storage/" + edgebase_encode_path_param(bucket));
}

Result GeneratedDbApi::delete_batch(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/delete-batch", json_body);
}

Result GeneratedDbApi::create_signed_download_url(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/signed-url", json_body);
}

Result GeneratedDbApi::create_signed_download_urls(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/signed-urls", json_body);
}

Result GeneratedDbApi::create_signed_upload_url(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/signed-upload-url", json_body);
}

Result GeneratedDbApi::create_multipart_upload(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/multipart/create", json_body);
}

Result GeneratedDbApi::upload_part(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/multipart/upload-part", json_body);
}

Result GeneratedDbApi::complete_multipart_upload(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/multipart/complete", json_body);
}

Result GeneratedDbApi::abort_multipart_upload(const std::string& bucket, const std::string& json_body) const {
  return http_.post("/api/storage/" + edgebase_encode_path_param(bucket) + "/multipart/abort", json_body);
}

Result GeneratedDbApi::get_config() const {
  return http_.get("/api/config");
}

Result GeneratedDbApi::push_register(const std::string& json_body) const {
  return http_.post("/api/push/register", json_body);
}

Result GeneratedDbApi::push_unregister(const std::string& json_body) const {
  return http_.post("/api/push/unregister", json_body);
}

Result GeneratedDbApi::push_topic_subscribe(const std::string& json_body) const {
  return http_.post("/api/push/topic/subscribe", json_body);
}

Result GeneratedDbApi::push_topic_unsubscribe(const std::string& json_body) const {
  return http_.post("/api/push/topic/unsubscribe", json_body);
}

Result GeneratedDbApi::check_room_connection(const std::map<std::string, std::string>& query) const {
  return http_.get("/api/room/connect-check", query);
}

Result GeneratedDbApi::connect_room(const std::map<std::string, std::string>& query) const {
  return http_.get("/api/room", query);
}

Result GeneratedDbApi::get_room_metadata(const std::map<std::string, std::string>& query) const {
  return http_.get("/api/room/metadata", query);
}

Result GeneratedDbApi::track_events(const std::string& json_body) const {
  return http_.post("/api/analytics/track", json_body);
}

} // namespace client
