// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.0)

#include "edgebase/generated/client_wrappers.h"
#include "edgebase/generated/api_core.h"
#include "edgebase/edgebase.h"

namespace client {

Result GeneratedAuthMethods::sign_up(const std::string& json_body) const {
  return core_.auth_signup(json_body);
}

Result GeneratedAuthMethods::sign_in(const std::string& json_body) const {
  return core_.auth_signin(json_body);
}

Result GeneratedAuthMethods::sign_out(const std::string& json_body) const {
  return core_.auth_signout(json_body);
}

Result GeneratedAuthMethods::sign_in_anonymously(const std::string& json_body) const {
  return core_.auth_signin_anonymous(json_body);
}

Result GeneratedAuthMethods::sign_in_with_magic_link(const std::string& json_body) const {
  return core_.auth_signin_magic_link(json_body);
}

Result GeneratedAuthMethods::verify_magic_link(const std::string& json_body) const {
  return core_.auth_verify_magic_link(json_body);
}

Result GeneratedAuthMethods::sign_in_with_phone(const std::string& json_body) const {
  return core_.auth_signin_phone(json_body);
}

Result GeneratedAuthMethods::verify_phone(const std::string& json_body) const {
  return core_.auth_verify_phone(json_body);
}

Result GeneratedAuthMethods::sign_in_with_email_otp(const std::string& json_body) const {
  return core_.auth_signin_email_otp(json_body);
}

Result GeneratedAuthMethods::verify_email_otp(const std::string& json_body) const {
  return core_.auth_verify_email_otp(json_body);
}

Result GeneratedAuthMethods::link_with_phone(const std::string& json_body) const {
  return core_.auth_link_phone(json_body);
}

Result GeneratedAuthMethods::verify_link_phone(const std::string& json_body) const {
  return core_.auth_verify_link_phone(json_body);
}

Result GeneratedAuthMethods::link_with_email(const std::string& json_body) const {
  return core_.auth_link_email(json_body);
}

Result GeneratedAuthMethods::change_email(const std::string& json_body) const {
  return core_.auth_change_email(json_body);
}

Result GeneratedAuthMethods::verify_email_change(const std::string& json_body) const {
  return core_.auth_verify_email_change(json_body);
}

Result GeneratedAuthMethods::verify_email(const std::string& json_body) const {
  return core_.auth_verify_email(json_body);
}

Result GeneratedAuthMethods::request_password_reset(const std::string& json_body) const {
  return core_.auth_request_password_reset(json_body);
}

Result GeneratedAuthMethods::reset_password(const std::string& json_body) const {
  return core_.auth_reset_password(json_body);
}

Result GeneratedAuthMethods::change_password(const std::string& json_body) const {
  return core_.auth_change_password(json_body);
}

Result GeneratedAuthMethods::get_me() const {
  return core_.auth_get_me();
}

Result GeneratedAuthMethods::update_profile(const std::string& json_body) const {
  return core_.auth_update_profile(json_body);
}

Result GeneratedAuthMethods::list_sessions() const {
  return core_.auth_get_sessions();
}

Result GeneratedAuthMethods::revoke_session(const std::string& id) const {
  return core_.auth_delete_session(id);
}

Result GeneratedAuthMethods::enroll_totp() const {
  return core_.auth_mfa_totp_enroll();
}

Result GeneratedAuthMethods::verify_totp_enrollment(const std::string& json_body) const {
  return core_.auth_mfa_totp_verify(json_body);
}

Result GeneratedAuthMethods::verify_totp(const std::string& json_body) const {
  return core_.auth_mfa_verify(json_body);
}

Result GeneratedAuthMethods::use_recovery_code(const std::string& json_body) const {
  return core_.auth_mfa_recovery(json_body);
}

Result GeneratedAuthMethods::disable_totp(const std::string& json_body) const {
  return core_.auth_mfa_totp_delete(json_body);
}

Result GeneratedAuthMethods::list_factors() const {
  return core_.auth_mfa_factors();
}

Result GeneratedAuthMethods::passkeys_register_options() const {
  return core_.auth_passkeys_register_options();
}

Result GeneratedAuthMethods::passkeys_register(const std::string& json_body) const {
  return core_.auth_passkeys_register(json_body);
}

Result GeneratedAuthMethods::passkeys_auth_options(const std::string& json_body) const {
  return core_.auth_passkeys_auth_options(json_body);
}

Result GeneratedAuthMethods::passkeys_authenticate(const std::string& json_body) const {
  return core_.auth_passkeys_authenticate(json_body);
}

Result GeneratedAuthMethods::passkeys_list() const {
  return core_.auth_passkeys_list();
}

Result GeneratedAuthMethods::passkeys_delete(const std::string& credential_id) const {
  return core_.auth_passkeys_delete(credential_id);
}

Result GeneratedStorageMethods::delete(const std::string& bucket, const std::string& key) const {
  return core_.delete_file(bucket, key);
}

Result GeneratedStorageMethods::delete_many(const std::string& bucket, const std::string& json_body) const {
  return core_.delete_batch(bucket, json_body);
}

bool GeneratedStorageMethods::exists(const std::string& bucket, const std::string& key) const {
  return core_.check_file_exists(bucket, key);
}

Result GeneratedStorageMethods::get_metadata(const std::string& bucket, const std::string& key) const {
  return core_.get_file_metadata(bucket, key);
}

Result GeneratedStorageMethods::update_metadata(const std::string& bucket, const std::string& key, const std::string& json_body) const {
  return core_.update_file_metadata(bucket, key, json_body);
}

Result GeneratedStorageMethods::create_signed_url(const std::string& bucket, const std::string& json_body) const {
  return core_.create_signed_download_url(bucket, json_body);
}

Result GeneratedStorageMethods::create_signed_urls(const std::string& bucket, const std::string& json_body) const {
  return core_.create_signed_download_urls(bucket, json_body);
}

Result GeneratedStorageMethods::create_signed_upload_url(const std::string& bucket, const std::string& json_body) const {
  return core_.create_signed_upload_url(bucket, json_body);
}

Result GeneratedStorageMethods::create_multipart_upload(const std::string& bucket, const std::string& json_body) const {
  return core_.create_multipart_upload(bucket, json_body);
}

Result GeneratedStorageMethods::complete_multipart_upload(const std::string& bucket, const std::string& json_body) const {
  return core_.complete_multipart_upload(bucket, json_body);
}

Result GeneratedStorageMethods::abort_multipart_upload(const std::string& bucket, const std::string& json_body) const {
  return core_.abort_multipart_upload(bucket, json_body);
}

Result GeneratedAnalyticsMethods::track(const std::string& json_body) const {
  return core_.track_events(json_body);
}

} // namespace client
