// EdgeBase C++ Core — HttpClient implementation (libcurl-based).
#include "edgebase/edgebase.h"

#include <curl/curl.h>
#include <sstream>
#include <stdexcept>

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
  // context removed — namespace+id are now in the URL path (#133 §2)

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

    try {
      if (!token.empty())
        headers = curl_slist_append(headers,
                                    ("Authorization: Bearer " + token).c_str());
    } catch (...) {
      // Token refresh failed — proceed as unauthenticated
    }
    if (!serviceKey.empty()) {
      headers = curl_slist_append(
          headers, ("X-EdgeBase-Service-Key: " + serviceKey).c_str());
      headers = curl_slist_append(
          headers, ("Authorization: Bearer " + serviceKey).c_str());
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
    try {
      if (!token.empty())
        headers = curl_slist_append(headers,
                                    ("Authorization: Bearer " + token).c_str());
    } catch (...) {
      // Token refresh failed — proceed as unauthenticated
    }
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

HttpClient::HttpClient(std::string baseUrl, std::string serviceKey)
    : impl_(std::make_unique<Impl>()) {
  // Trim trailing slash
  while (!baseUrl.empty() && baseUrl.back() == '/')
    baseUrl.pop_back();
  impl_->baseUrl = std::move(baseUrl);
  impl_->serviceKey = std::move(serviceKey);
  curl_global_init(CURL_GLOBAL_DEFAULT);
}

HttpClient::~HttpClient() { curl_global_cleanup(); }

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
  return impl_->perform("GET", url, "", nullptr);
}

Result HttpClient::post(const std::string &path,
                        const std::string &jsonBody) const {
  return impl_->perform("POST", impl_->buildUrl(path), jsonBody, nullptr);
}

Result HttpClient::patch(const std::string &path,
                         const std::string &jsonBody) const {
  return impl_->perform("PATCH", impl_->buildUrl(path), jsonBody, nullptr);
}

Result HttpClient::del(const std::string &path) const {
  return impl_->perform("DELETE", impl_->buildUrl(path), "", nullptr);
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

} // namespace client
