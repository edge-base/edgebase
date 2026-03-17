// EdgeBase Unreal Engine Plugin — Wrapper implementation.
// Delegates all HTTP work to the core library (packages/sdk/cpp/core).
//
// Threading model:
//   - RunAsync: sends core (blocking libcurl) call to a background thread
//   - Callback: always executed back on the game thread via AsyncTask

#include "EdgeBase.h"
#include "Async/Async.h"
#include "Dom/JsonObject.h"
#include "HAL/PlatformTime.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

#if EDGEBASE_HAS_CORE
#include <edgebase/edgebase.h> // core header (ThirdParty link)
#endif

// ── Helpers
// ───────────────────────────────────────────────────────────────────

#if EDGEBASE_HAS_CORE

static FEdgeBaseResult ToUEResult(const eb::Result &r) {
  FEdgeBaseResult ur;
  ur.bSuccess = r.ok;
  ur.StatusCode = r.statusCode;
  ur.Json = FString(r.body.c_str());
  ur.Error = FString(r.error.c_str());
  return ur;
}

static std::string ToStd(const FString &s) { return TCHAR_TO_UTF8(*s); }

static std::map<std::string, std::string>
ToStringMap(const TSharedPtr<FJsonObject> &jsonObject) {
  std::map<std::string, std::string> values;
  for (const auto &pair : jsonObject->Values) {
    const FString &key = pair.Key;
    const TSharedPtr<FJsonValue> &value = pair.Value;
    switch (value->Type) {
    case EJson::String:
      values.emplace(ToStd(key), ToStd(value->AsString()));
      break;
    case EJson::Number:
      values.emplace(ToStd(key), TCHAR_TO_UTF8(*FString::SanitizeFloat(value->AsNumber())));
      break;
    case EJson::Boolean:
      values.emplace(ToStd(key), value->AsBool() ? "true" : "false");
      break;
    default:
      break;
    }
  }
  return values;
}

// ── UEdgeBase
// ─────────────────────────────────────────────────────────────────

UEdgeBase *UEdgeBase::Create(UObject *Outer, const FString &Url) {
  auto *JB = NewObject<UEdgeBase>(Outer);
  JB->BaseUrl_ = Url;
  JB->ResetCoreClient();
  return JB;
}

FString UEdgeBase::GetBaseUrl() const { return BaseUrl_; }

void UEdgeBase::BeginDestroy() {
  ResetCoreClient();
  Super::BeginDestroy();
}

void UEdgeBase::ResetCoreClient() {
  FScopeLock lock(&CoreMutex_);
  delete CoreClient_;
  CoreClient_ = nullptr;
}

client::EdgeBase *UEdgeBase::GetOrCreateCoreClient() {
  if (!CoreClient_ && !BaseUrl_.IsEmpty()) {
    CoreClient_ = new eb::EdgeBase(ToStd(BaseUrl_));
  }
  return CoreClient_;
}

void UEdgeBase::RunAsync(TFunction<FEdgeBaseResult(client::EdgeBase &)> CoreFn,
                         FEdgeBaseCallback Callback) {
  AsyncTask(ENamedThreads::AnyBackgroundThreadNormalTask,
            [this, CoreFn = MoveTemp(CoreFn), Callback]() mutable {
              FEdgeBaseResult result;
              {
                FScopeLock lock(&CoreMutex_);
                auto *core = GetOrCreateCoreClient();
                if (!core) {
                  result = {false, 0, TEXT(""), TEXT("SetUrl() not called")};
                } else {
                  result = CoreFn(*core);
                }
              }
              AsyncTask(ENamedThreads::GameThread,
                        [result, Callback]() mutable {
                          Callback.ExecuteIfBound(result);
                        });
            });
}

// ── Auth
// ──────────────────────────────────────────────────────────────────────

void UEdgeBase::SignUp(const FString &Email, const FString &Password,
                       FEdgeBaseCallback Callback) {
  std::string email = ToStd(Email), pass = ToStd(Password);
  RunAsync(
      [email, pass](client::EdgeBase &core) {
        return ToUEResult(core.auth().signUp(email, pass));
      },
      Callback);
}

void UEdgeBase::SignIn(const FString &Email, const FString &Password,
                       FEdgeBaseCallback Callback) {
  std::string email = ToStd(Email), pass = ToStd(Password);
  RunAsync(
      [email, pass](client::EdgeBase &core) {
        return ToUEResult(core.auth().signIn(email, pass));
      },
      Callback);
}

void UEdgeBase::SignOut(FEdgeBaseCallback Callback) {
  RunAsync(
      [](client::EdgeBase &core) {
        return ToUEResult(core.auth().signOut());
      },
      Callback);
}

void UEdgeBase::SignInAnonymously(FEdgeBaseCallback Callback) {
  RunAsync(
      [](client::EdgeBase &core) {
        return ToUEResult(core.auth().signInAnonymously());
      },
      Callback);
}

void UEdgeBase::ChangePassword(const FString &CurrentPassword,
                               const FString &NewPassword,
                               FEdgeBaseCallback Callback) {
  std::string cur = ToStd(CurrentPassword), nw = ToStd(NewPassword);
  RunAsync(
      [cur, nw](client::EdgeBase &core) {
        return ToUEResult(core.auth().changePassword(cur, nw));
      },
      Callback);
}

void UEdgeBase::UpdateProfile(const FString &JsonBody,
                              FEdgeBaseCallback Callback) {
  TSharedPtr<FJsonObject> jsonObject;
  const TSharedRef<TJsonReader<>> reader = TJsonReaderFactory<>::Create(JsonBody);
  if (!FJsonSerializer::Deserialize(reader, jsonObject) || !jsonObject.IsValid()) {
    Callback.ExecuteIfBound(
        {false, 400, TEXT(""), TEXT("UpdateProfile expects a JSON object body")});
    return;
  }
  const std::map<std::string, std::string> data = ToStringMap(jsonObject);
  RunAsync(
      [data](client::EdgeBase &core) {
        return ToUEResult(core.auth().updateProfile(data));
      },
      Callback);
}

void UEdgeBase::ListSessions(FEdgeBaseCallback Callback) {
  RunAsync(
      [](client::EdgeBase &core) {
        return ToUEResult(core.auth().listSessions());
      },
      Callback);
}

void UEdgeBase::RevokeSession(const FString &SessionId,
                              FEdgeBaseCallback Callback) {
  std::string sid = ToStd(SessionId);
  RunAsync(
      [sid](client::EdgeBase &core) {
        return ToUEResult(core.auth().revokeSession(sid));
      },
      Callback);
}

void UEdgeBase::VerifyEmail(const FString &Token, FEdgeBaseCallback Callback) {
  std::string tok = ToStd(Token);
  RunAsync(
      [tok](client::EdgeBase &core) {
        return ToUEResult(core.auth().verifyEmail(tok));
      },
      Callback);
}

void UEdgeBase::RequestPasswordReset(const FString &Email,
                                     FEdgeBaseCallback Callback) {
  std::string email = ToStd(Email);
  RunAsync(
      [email](client::EdgeBase &core) {
        return ToUEResult(core.auth().requestPasswordReset(email));
      },
      Callback);
}

void UEdgeBase::ResetPassword(const FString &Token, const FString &NewPassword,
                              FEdgeBaseCallback Callback) {
  std::string tok = ToStd(Token), nw = ToStd(NewPassword);
  RunAsync(
      [tok, nw](client::EdgeBase &core) {
        return ToUEResult(core.auth().resetPassword(tok, nw));
      },
      Callback);
}

// ── Collection
// ────────────────────────────────────────────────────────────────

void UEdgeBase::CollectionInsert(const FString &Name, const FString &JsonBody,
                                 FEdgeBaseCallback Callback) {
  std::string name = ToStd(Name), body = ToStd(JsonBody);
  RunAsync(
      [name, body](client::EdgeBase &core) {
        return ToUEResult(core.db("shared").table(name).insert(body));
      },
      Callback);
}

void UEdgeBase::CollectionGet(const FString &Name, const FString &FilterJson,
                              FEdgeBaseCallback Callback) {
  // FilterJson is ignored in this thin wrapper — full query builder is
  // available via the core C++ API directly. Blueprint gets raw list.
  std::string name = ToStd(Name);
  RunAsync(
      [name](client::EdgeBase &core) {
        return ToUEResult(core.db("shared").table(name).getList());
      },
      Callback);
}

void UEdgeBase::CollectionGetOne(const FString &Name, const FString &Id,
                                 FEdgeBaseCallback Callback) {
  std::string name = ToStd(Name), id = ToStd(Id);
  RunAsync(
      [name, id](client::EdgeBase &core) {
        return ToUEResult(core.db("shared").table(name).getOne(id));
      },
      Callback);
}

void UEdgeBase::CollectionUpdate(const FString &Name, const FString &Id,
                                 const FString &JsonBody,
                                 FEdgeBaseCallback Callback) {
  std::string name = ToStd(Name), id = ToStd(Id), body = ToStd(JsonBody);
  RunAsync(
      [name, id, body](client::EdgeBase &core) {
        return ToUEResult(core.db("shared").table(name).update(id, body));
      },
      Callback);
}

void UEdgeBase::CollectionDelete(const FString &Name, const FString &Id,
                                 FEdgeBaseCallback Callback) {
  std::string name = ToStd(Name), id = ToStd(Id);
  RunAsync(
      [name, id](client::EdgeBase &core) {
        return ToUEResult(core.db("shared").table(name).del(id));
      },
      Callback);
}

void UEdgeBase::CollectionUpsert(const FString &Name, const FString &JsonBody,
                                 const FString &ConflictTarget,
                                 FEdgeBaseCallback Callback) {
  std::string name = ToStd(Name), body = ToStd(JsonBody), ct = ToStd(ConflictTarget);
  RunAsync(
      [name, body, ct](client::EdgeBase &core) {
        return ToUEResult(core.db("shared").table(name).upsert(body, ct));
      },
      Callback);
}

void UEdgeBase::CollectionCount(const FString &Name, const FString &FilterJson,
                                FEdgeBaseCallback Callback) {
  std::string name = ToStd(Name);
  RunAsync(
      [name](client::EdgeBase &core) {
        return ToUEResult(core.db("shared").table(name).count());
      },
      Callback);
}

// ── Storage
// ───────────────────────────────────────────────────────────────────

FString UEdgeBase::StorageGetUrl(const FString &Bucket, const FString &Key) {
  FScopeLock lock(&CoreMutex_);
  auto *core = GetOrCreateCoreClient();
  if (!core) {
    return FString();
  }
  auto url = core->storage().bucket(ToStd(Bucket)).getUrl(ToStd(Key));
  return FString(url.c_str());
}

void UEdgeBase::StorageUpload(const FString &Bucket, const FString &Key,
                              const TArray<uint8> &Data,
                              const FString &ContentType,
                              FEdgeBaseCallback Callback) {
  std::string bucket = ToStd(Bucket), key = ToStd(Key), ct = ToStd(ContentType);
  std::vector<uint8_t> bytes(Data.GetData(), Data.GetData() + Data.Num());
  RunAsync(
      [bucket, key, bytes, ct](client::EdgeBase &core) {
        return ToUEResult(core.storage().bucket(bucket).upload(key, bytes, ct));
      },
      Callback);
}

void UEdgeBase::StorageDownload(const FString &Bucket, const FString &Key,
                                FEdgeBaseCallback Callback) {
  std::string bucket = ToStd(Bucket), key = ToStd(Key);
  RunAsync(
      [bucket, key](client::EdgeBase &core) {
        return ToUEResult(core.storage().bucket(bucket).download(key));
      },
      Callback);
}

void UEdgeBase::StorageDelete(const FString &Bucket, const FString &Key,
                              FEdgeBaseCallback Callback) {
  std::string bucket = ToStd(Bucket), key = ToStd(Key);
  RunAsync(
      [bucket, key](client::EdgeBase &core) {
        return ToUEResult(core.storage().bucket(bucket).del(key));
      },
      Callback);
}

void UEdgeBase::StorageList(const FString &Bucket, const FString &Prefix,
                            int32 Limit, FEdgeBaseCallback Callback) {
  std::string bucket = ToStd(Bucket), prefix = ToStd(Prefix);
  RunAsync(
      [bucket, prefix, Limit](client::EdgeBase &core) {
        return ToUEResult(core.storage().bucket(bucket).list(prefix, Limit));
      },
      Callback);
}

void UEdgeBase::StorageGetMetadata(const FString &Bucket, const FString &Key,
                                   FEdgeBaseCallback Callback) {
  std::string bucket = ToStd(Bucket), key = ToStd(Key);
  RunAsync(
      [bucket, key](client::EdgeBase &core) {
        return ToUEResult(core.storage().bucket(bucket).getMetadata(key));
      },
      Callback);
}

void UEdgeBase::StorageCreateSignedUrl(const FString &Bucket,
                                       const FString &Key,
                                       const FString &ExpiresIn,
                                       FEdgeBaseCallback Callback) {
  std::string bucket = ToStd(Bucket), key = ToStd(Key), exp = ToStd(ExpiresIn);
  RunAsync(
      [bucket, key, exp](client::EdgeBase &core) {
        return ToUEResult(
            core.storage().bucket(bucket).createSignedUrl(key, exp));
      },
      Callback);
}

void UEdgeBase::StorageCreateSignedUploadUrl(const FString &Bucket,
                                             const FString &Key,
                                             const FString &ExpiresIn,
                                             FEdgeBaseCallback Callback) {
  std::string bucket = ToStd(Bucket), key = ToStd(Key), exp = ToStd(ExpiresIn);
  RunAsync(
      [bucket, key, exp](client::EdgeBase &core) {
        return ToUEResult(
            core.storage().bucket(bucket).createSignedUploadUrl(key, exp));
      },
      Callback);
}

#else

static FEdgeBaseResult MakeUnsupportedResult() {
  return {false, 0, TEXT(""),
          TEXT("EdgeBase core is not bundled for this platform in the Unreal example build.")};
}

static void CompleteUnsupported(FEdgeBaseCallback Callback) {
  Callback.ExecuteIfBound(MakeUnsupportedResult());
}

UEdgeBase *UEdgeBase::Create(UObject *Outer, const FString &Url) {
  auto *JB = NewObject<UEdgeBase>(Outer);
  JB->BaseUrl_ = Url;
  return JB;
}

FString UEdgeBase::GetBaseUrl() const { return BaseUrl_; }

void UEdgeBase::BeginDestroy() { Super::BeginDestroy(); }

void UEdgeBase::ResetCoreClient() {}

client::EdgeBase *UEdgeBase::GetOrCreateCoreClient() { return nullptr; }

void UEdgeBase::RunAsync(TFunction<FEdgeBaseResult(client::EdgeBase &)> /*CoreFn*/,
                         FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::SignUp(const FString &, const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::SignIn(const FString &, const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::SignOut(FEdgeBaseCallback Callback) { CompleteUnsupported(Callback); }

void UEdgeBase::SignInAnonymously(FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::ChangePassword(const FString &, const FString &,
                               FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::UpdateProfile(const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::ListSessions(FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::RevokeSession(const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::VerifyEmail(const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::RequestPasswordReset(const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::ResetPassword(const FString &, const FString &,
                              FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::CollectionInsert(const FString &, const FString &,
                                 FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::CollectionGet(const FString &, const FString &,
                              FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::CollectionGetOne(const FString &, const FString &,
                                 FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::CollectionUpdate(const FString &, const FString &, const FString &,
                                 FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::CollectionDelete(const FString &, const FString &,
                                 FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::CollectionUpsert(const FString &, const FString &, const FString &,
                                 FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::CollectionCount(const FString &, const FString &,
                                FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

FString UEdgeBase::StorageGetUrl(const FString &, const FString &) { return FString(); }

void UEdgeBase::StorageUpload(const FString &, const FString &, const TArray<uint8> &,
                              const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::StorageDownload(const FString &, const FString &,
                                FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::StorageDelete(const FString &, const FString &,
                              FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::StorageList(const FString &, const FString &, int32,
                            FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::StorageGetMetadata(const FString &, const FString &,
                                   FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::StorageCreateSignedUrl(const FString &, const FString &,
                                       const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

void UEdgeBase::StorageCreateSignedUploadUrl(const FString &, const FString &,
                                             const FString &, FEdgeBaseCallback Callback) {
  CompleteUnsupported(Callback);
}

#endif
