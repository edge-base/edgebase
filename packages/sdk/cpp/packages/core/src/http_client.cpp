// EdgeBase C++ Core — HttpClient implementation (libcurl-based).
#include "edgebase/edgebase.h"

#include <curl/curl.h>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <chrono>
#include <cstdlib>
#include <random>

namespace client {

// ── Write callback for curl
// ───────────────────────────────────────────────────

static size_t writeCallback(char *ptr, size_t size, size_t nmemb,
                            std::string *data) {
  data->append(ptr, size * nmemb);
  return size * nmemb;
}

// ── HttpClient::Impl
// ──────────────────────────────────────────────────────────

struct HttpClient::Impl {
  std::string baseUrl;
  std::string serviceKey;
  std::string token;
  std::string refreshToken;
  std::string locale;
  std::map<std::string, std::string> context;

  std::string buildUrl(const std::string &path) const {
    if (path.rfind("/api", 0) == 0)
      return baseUrl + path;
    return baseUrl + "/api" + path;
  }

  static std::string urlEncode(CURL *curl, const std::string &s) {
    char *enc = curl_easy_escape(curl, s.c_str(), static_cast<int>(s.size()));
    std::string result(enc);
    curl_free(enc);
    return result;
  }

  Result perform(const std::string &method, const std::string &url,
                 const std::string &body,
                 const struct curl_slist *extraHeaders) const {
    CURL *curl = curl_easy_init();
    if (!curl)
      return {false, 0, "", "curl_easy_init failed"};

    std::string response;
    long statusCode = 0;

    struct curl_slist *headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    headers = curl_slist_append(headers, "Accept: application/json");

    if (!token.empty())
      headers = curl_slist_append(headers,
                                  ("Authorization: Bearer " + token).c_str());
    if (!serviceKey.empty()) {
      headers = curl_slist_append(
          headers, ("X-EdgeBase-Service-Key: " + serviceKey).c_str());
      headers = curl_slist_append(
          headers, ("Authorization: Bearer " + serviceKey).c_str());
    }
    if (!locale.empty()) {
      headers = curl_slist_append(headers,
                                  ("Accept-Language: " + locale).c_str());
    }
    // Copy extra headers (for multipart)
    const struct curl_slist *eh = extraHeaders;
    while (eh) {
      headers = curl_slist_append(headers, eh->data);
      eh = eh->next;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);

    if (method == "POST") {
      curl_easy_setopt(curl, CURLOPT_POST, 1L);
      curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
      curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, body.size());
    } else if (method == "PATCH") {
      curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PATCH");
      curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
      curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, body.size());
    } else if (method == "PUT") {
      curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
      curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
      curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, body.size());
    } else if (method == "DELETE") {
      curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
    }
    // GET is default

    CURLcode res = curl_easy_perform(curl);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK)
      return {false, 0, "", curl_easy_strerror(res)};

    bool ok = statusCode >= 200 && statusCode < 300;
    return {ok, static_cast<int>(statusCode), response, ok ? "" : response};
  }

  Result performWithRetry(const std::string &method, const std::string &url,
                   const std::string &body,
                   const struct curl_slist *extraHeaders) const {
    for (int attempt = 0; attempt <= 3; ++attempt) {
      Result result = perform(method, url, body, extraHeaders);
      if (result.statusCode == 429 && attempt < 3) {
        int baseDelayMs = 1000 * (1 << attempt);
        static thread_local std::mt19937 rng{std::random_device{}()};
        int jitter = std::uniform_int_distribution<int>(0, baseDelayMs / 4)(rng);
        int delayMs = std::min(baseDelayMs + jitter, 10000);
        std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
        continue;
      }
      if (!result.ok && result.statusCode == 0 && attempt < 2) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50 * (attempt + 1)));
        continue;
      }
      return result;
    }
    return {false, 0, "", "Request failed after retries"};
  }

  Result uploadMultipart(const std::string &url, const std::string &key,
                         const std::vector<uint8_t> &data,
                         const std::string &contentType) const {
    CURL *curl = curl_easy_init();
    if (!curl)
      return {false, 0, "", "curl_easy_init failed"};

    std::string response;
    long statusCode = 0;

    curl_mime *form = curl_mime_init(curl);
    curl_mimepart *field;

    // key field
    field = curl_mime_addpart(form);
    curl_mime_name(field, "key");
    curl_mime_data(field, key.c_str(), CURL_ZERO_TERMINATED);

    // file field
    field = curl_mime_addpart(form);
    curl_mime_name(field, "file");
    curl_mime_data(field, reinterpret_cast<const char *>(data.data()),
                   data.size());
    curl_mime_type(field, contentType.c_str());
    curl_mime_filename(field, key.c_str());

    struct curl_slist *headers = nullptr;
    if (!token.empty())
      headers = curl_slist_append(headers,
                                  ("Authorization: Bearer " + token).c_str());
    if (!serviceKey.empty()) {
      headers = curl_slist_append(
          headers, ("X-EdgeBase-Service-Key: " + serviceKey).c_str());
      headers = curl_slist_append(
          headers, ("Authorization: Bearer " + serviceKey).c_str());
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_MIMEPOST, form);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);

    CURLcode res = curl_easy_perform(curl);
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);

    curl_mime_free(form);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK)
      return {false, 0, "", curl_easy_strerror(res)};

    bool ok = statusCode >= 200 && statusCode < 300;
    return {ok, static_cast<int>(statusCode), response, ok ? "" : response};
  }
};

// ── HttpClient public
// ─────────────────────────────────────────────────────────

// curl_global_init/cleanup must be called exactly once per process lifetime.
// Calling them per-instance (constructor/destructor) causes SIGABRT on
// the second instance when the first has already called curl_global_cleanup.
static std::once_flag s_curlInitFlag;

HttpClient::HttpClient(std::string baseUrl, std::string serviceKey)
    : impl_(std::make_unique<Impl>()) {
  // Trim trailing slash
  while (!baseUrl.empty() && baseUrl.back() == '/')
    baseUrl.pop_back();
  impl_->baseUrl = std::move(baseUrl);
  impl_->serviceKey = std::move(serviceKey);
  std::call_once(s_curlInitFlag,
                 []() { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

HttpClient::~HttpClient() {
  // Do NOT call curl_global_cleanup() here. It must be called exactly once
  // at process exit, not per-instance. curl_global_cleanup() per-instance
  // causes SIGABRT when a second HttpClient is created after the first cleaned
  // up. The OS reclaims all resources at process exit anyway.
}

Result HttpClient::get(const std::string &path,
                       const std::map<std::string, std::string> &query) const {
  std::string url = impl_->buildUrl(path);
  if (!query.empty()) {
    CURL *tmp = curl_easy_init();
    url += "?";
    bool first = true;
    for (const auto &[k, v] : query) {
      if (!first)
        url += "&";
      url += Impl::urlEncode(tmp, k) + "=" + Impl::urlEncode(tmp, v);
      first = false;
    }
    curl_easy_cleanup(tmp);
  }
  return impl_->performWithRetry("GET", url, "", nullptr);
}

Result HttpClient::post(const std::string &path,
                        const std::string &jsonBody) const {
  return impl_->performWithRetry("POST", impl_->buildUrl(path), jsonBody, nullptr);
}

Result HttpClient::put(const std::string &path,
                       const std::string &jsonBody) const {
  return impl_->performWithRetry("PUT", impl_->buildUrl(path), jsonBody, nullptr);
}

Result HttpClient::post_with_query(const std::string &path,
                                   const std::string &jsonBody,
                                   const std::map<std::string, std::string> &query) const {
  std::string url = impl_->buildUrl(path);
  if (!query.empty()) {
    CURL *tmp = curl_easy_init();
    url += "?";
    bool first = true;
    for (const auto &[k, v] : query) {
      if (!first)
        url += "&";
      url += Impl::urlEncode(tmp, k) + "=" + Impl::urlEncode(tmp, v);
      first = false;
    }
    curl_easy_cleanup(tmp);
  }
  return impl_->performWithRetry("POST", url, jsonBody, nullptr);
}

Result HttpClient::post_bytes_with_query(
    const std::string &path, const std::vector<uint8_t> &body,
    const std::string &contentType,
    const std::map<std::string, std::string> &query) const {
  std::string url = impl_->buildUrl(path);
  if (!query.empty()) {
    CURL *tmp = curl_easy_init();
    url += "?";
    bool first = true;
    for (const auto &[k, v] : query) {
      if (!first)
        url += "&";
      url += Impl::urlEncode(tmp, k) + "=" + Impl::urlEncode(tmp, v);
      first = false;
    }
    curl_easy_cleanup(tmp);
  }

  CURL *curl = curl_easy_init();
  if (!curl)
    return {false, 0, "", "curl_easy_init failed"};

  std::string response;
  long statusCode = 0;

  struct curl_slist *headers = nullptr;
  headers = curl_slist_append(headers, ("Content-Type: " + contentType).c_str());
  headers = curl_slist_append(headers, "Accept: application/json");

  if (!impl_->token.empty())
    headers = curl_slist_append(headers,
                                ("Authorization: Bearer " + impl_->token).c_str());
  if (!impl_->serviceKey.empty()) {
    headers = curl_slist_append(
        headers, ("X-EdgeBase-Service-Key: " + impl_->serviceKey).c_str());
    headers = curl_slist_append(
        headers, ("Authorization: Bearer " + impl_->serviceKey).c_str());
  }
  if (!impl_->locale.empty()) {
    headers = curl_slist_append(headers,
                                ("Accept-Language: " + impl_->locale).c_str());
  }

  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_POST, 1L);
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
  curl_easy_setopt(curl, CURLOPT_POSTFIELDS,
                   reinterpret_cast<const char *>(body.data()));
  curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE,
                   static_cast<long>(body.size()));
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);

  CURLcode res = curl_easy_perform(curl);
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);

  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);

  if (res != CURLE_OK)
    return {false, 0, "", curl_easy_strerror(res)};

  bool ok = statusCode >= 200 && statusCode < 300;
  return {ok, static_cast<int>(statusCode), response, ok ? "" : response};
}

Result HttpClient::patch(const std::string &path,
                         const std::string &jsonBody) const {
  return impl_->performWithRetry("PATCH", impl_->buildUrl(path), jsonBody, nullptr);
}

Result HttpClient::del(const std::string &path) const {
  return impl_->performWithRetry("DELETE", impl_->buildUrl(path), "", nullptr);
}

Result HttpClient::del(const std::string &path,
                       const std::string &jsonBody) const {
  return impl_->performWithRetry("DELETE", impl_->buildUrl(path), jsonBody, nullptr);
}

bool HttpClient::head(const std::string &path) const {
  CURL *curl = curl_easy_init();
  if (!curl)
    return false;

  std::string url = impl_->buildUrl(path);
  long statusCode = 0;

  struct curl_slist *headers = nullptr;
  if (!impl_->token.empty())
    headers = curl_slist_append(headers,
                                ("Authorization: Bearer " + impl_->token).c_str());
  if (!impl_->serviceKey.empty()) {
    headers = curl_slist_append(
        headers, ("X-EdgeBase-Service-Key: " + impl_->serviceKey).c_str());
    headers = curl_slist_append(
        headers, ("Authorization: Bearer " + impl_->serviceKey).c_str());
  }

  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_NOBODY, 1L);
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);

  CURLcode res = curl_easy_perform(curl);
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &statusCode);

  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);

  if (res != CURLE_OK)
    return false;

  return statusCode >= 200 && statusCode < 300;
}

Result HttpClient::uploadMultipart(const std::string &path,
                                   const std::string &key,
                                   const std::vector<uint8_t> &data,
                                   const std::string &contentType) const {
  return impl_->uploadMultipart(impl_->buildUrl(path), key, data, contentType);
}

void HttpClient::setToken(const std::string &token) { impl_->token = token; }
void HttpClient::clearToken() { impl_->token.clear(); }
std::string HttpClient::getToken() const { return impl_->token; }
void HttpClient::setRefreshToken(const std::string &token) {
  impl_->refreshToken = token;
}
void HttpClient::clearRefreshToken() { impl_->refreshToken.clear(); }
std::string HttpClient::getRefreshToken() const { return impl_->refreshToken; }

void HttpClient::setContext(const std::map<std::string, std::string> &ctx) {
  impl_->context = ctx;
}
std::map<std::string, std::string> HttpClient::getContext() const {
  return impl_->context;
}
void HttpClient::setLocale(const std::string &locale) { impl_->locale = locale; }
std::string HttpClient::getLocale() const { return impl_->locale; }

} // namespace client
