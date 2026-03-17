// EdgeBase C++ Core — StorageBucket implementation.
// JSON-based API calls delegate to GeneratedDbApi (api_core.h).
// Binary upload/multipart operations remain on HttpClient directly.
#include "edgebase/edgebase.h"
#include <nlohmann/json.hpp>

namespace client {

// ── StorageBucket
// ─────────────────────────────────────────────────────────────

StorageBucket::StorageBucket(std::shared_ptr<HttpClient> http,
                             std::shared_ptr<GeneratedDbApi> core,
                             std::string baseUrl, std::string name)
    : http_(std::move(http)), core_(std::move(core)),
      baseUrl_(std::move(baseUrl)), name_(std::move(name)) {}

std::string StorageBucket::getUrl(const std::string &key) const {
  return baseUrl_ + ApiPaths::download_file(name_, key);
}

Result StorageBucket::upload(const std::string &key,
                             const std::vector<uint8_t> &data,
                             const std::string &contentType) const {
  // Binary multipart upload — not available in GeneratedDbApi.
  return http_->uploadMultipart("/storage/" + name_ + "/upload", key, data,
                                contentType);
}

Result StorageBucket::uploadString(const std::string &key,
                                   const std::string &content,
                                   const std::string &encoding,
                                   const std::string &contentType) const {
  std::vector<uint8_t> data;
  auto ct = contentType;

  // Helper: base64 decode (standard)
  auto b64decode = [](const std::string &in) -> std::vector<uint8_t> {
    static const std::string chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::vector<uint8_t> out;
    int val = 0, bits = -8;
    for (unsigned char c : in) {
      if (c == '=')
        break;
      auto pos = chars.find(c);
      if (pos == std::string::npos)
        continue;
      val = (val << 6) + static_cast<int>(pos);
      bits += 6;
      if (bits >= 0) {
        out.push_back(static_cast<uint8_t>((val >> bits) & 0xFF));
        bits -= 8;
      }
    }
    return out;
  };

  if (encoding == "base64") {
    data = b64decode(content);
  } else if (encoding == "base64url") {
    // Convert base64url to standard base64
    std::string b64 = content;
    for (auto &c : b64) {
      if (c == '-')
        c = '+';
      else if (c == '_')
        c = '/';
    }
    while (b64.size() % 4 != 0)
      b64 += '=';
    data = b64decode(b64);
  } else if (encoding == "data_url") {
    auto commaPos = content.find(',');
    if (commaPos != std::string::npos) {
      // Extract MIME type from header: data:mime/type;base64
      auto header = content.substr(0, commaPos);
      if (header.rfind("data:", 0) == 0) {
        auto semiPos = header.find(';');
        if (semiPos != std::string::npos && semiPos > 5) {
          ct = header.substr(5, semiPos - 5);
        }
      }
      data = b64decode(content.substr(commaPos + 1));
    } else {
      data.assign(content.begin(), content.end());
    }
  } else { // "raw"
    data.assign(content.begin(), content.end());
  }

  return upload(key, data, ct);
}

Result StorageBucket::download(const std::string &key) const {
  return core_->download_file(name_, key);
}

Result StorageBucket::del(const std::string &key) const {
  return core_->delete_file(name_, key);
}

// GET /api/storage/{bucket}?prefix=&limit=N&offset=N
Result StorageBucket::list(const std::string &prefix, int limit,
                           int offset) const {
  // GeneratedDbApi::list_files() doesn't support query params (prefix/limit/offset),
  // so we fall back to HttpClient for parameterized list requests.
  if (prefix.empty() && limit == 100 && offset == 0) {
    return core_->list_files(name_);
  }
  std::string path = "/storage/" + name_;
  std::string qs;
  if (!prefix.empty())
    qs += "prefix=" + prefix;
  if (limit > 0) {
    if (!qs.empty())
      qs += "&";
    qs += "limit=" + std::to_string(limit);
  }
  if (offset > 0) {
    if (!qs.empty())
      qs += "&";
    qs += "offset=" + std::to_string(offset);
  }
  if (!qs.empty())
    path += "?" + qs;
  return http_->get(path);
}

Result StorageBucket::getMetadata(const std::string &key) const {
  return core_->get_file_metadata(name_, key);
}

Result StorageBucket::updateMetadata(const std::string &key,
                                     const std::string &jsonBody) const {
  return core_->update_file_metadata(name_, key, jsonBody);
}

Result StorageBucket::createSignedUrl(const std::string &key,
                                      const std::string &expiresIn) const {
  nlohmann::json body = {{"key", key}, {"expiresIn", expiresIn}};
  return core_->create_signed_download_url(name_, body.dump());
}

Result StorageBucket::createSignedUrls(const std::vector<std::string> &keys,
                                       const std::string &expiresIn) const {
  nlohmann::json body = {{"keys", keys}, {"expiresIn", expiresIn}};
  return core_->create_signed_download_urls(name_, body.dump());
}

Result
StorageBucket::createSignedUploadUrl(const std::string &key,
                                     const std::string &expiresIn) const {
  nlohmann::json body = {{"key", key}, {"expiresIn", expiresIn}};
  return core_->create_signed_upload_url(name_, body.dump());
}

bool StorageBucket::exists(const std::string &key) const {
  return core_->check_file_exists(name_, key);
}

Result StorageBucket::getUploadParts(const std::string &key,
                                     const std::string &uploadId) const {
  auto result = http_->get(
      "/storage/" + name_ + "/uploads/" + uploadId + "/parts",
      {{"key", key}});
  if (!result.ok)
    return result;
  auto body = nlohmann::json::parse(result.body, nullptr, false);
  if (body.is_discarded() || !body.is_object()) {
    return {false, result.statusCode, result.body, "Invalid getUploadParts response"};
  }
  if (!body.contains("uploadId"))
    body["uploadId"] = uploadId;
  if (!body.contains("key"))
    body["key"] = key;
  if (!body.contains("parts"))
    body["parts"] = nlohmann::json::array();
  result.body = body.dump();
  return result;
}

Result
StorageBucket::initiateResumableUpload(const std::string &key,
                                       const std::string &contentType) const {
  nlohmann::json body = {{"key", key}};
  if (!contentType.empty())
    body["contentType"] = contentType;
  return core_->create_multipart_upload(name_, body.dump());
}

Result StorageBucket::resumeUpload(const std::string &key,
                                   const std::string &uploadId,
                                   const std::vector<uint8_t> &chunk,
                                   int offset, bool isLastChunk) const {
  const int partNumber = offset + 1;
  auto uploaded = http_->post_bytes_with_query(
      "/storage/" + name_ + "/multipart/upload-part", chunk,
      "application/octet-stream",
      {{"uploadId", uploadId},
       {"partNumber", std::to_string(partNumber)},
       {"key", key}});
  if (!uploaded.ok || !isLastChunk)
    return uploaded;

  const auto uploadedBody =
      nlohmann::json::parse(uploaded.body, nullptr, false);
  if (uploadedBody.is_discarded() || !uploadedBody.is_object()) {
    return {false, uploaded.statusCode, uploaded.body,
            "Invalid multipart upload-part response"};
  }

  nlohmann::json completeBody = {
      {"uploadId", uploadId},
      {"key", key},
      {"parts", nlohmann::json::array(
                    {{{"partNumber", uploadedBody.value("partNumber", partNumber)},
                      {"etag", uploadedBody.value("etag", "")}}})},
  };
  return core_->complete_multipart_upload(name_, completeBody.dump());
}

// ── StorageClient
// ─────────────────────────────────────────────────────────────

StorageClient::StorageClient(std::shared_ptr<HttpClient> http,
                             std::shared_ptr<GeneratedDbApi> core,
                             std::string baseUrl)
    : http_(std::move(http)), core_(std::move(core)),
      baseUrl_(std::move(baseUrl)) {}

StorageBucket StorageClient::bucket(const std::string &name) const {
  return StorageBucket(http_, core_, baseUrl_, name);
}

} // namespace client
