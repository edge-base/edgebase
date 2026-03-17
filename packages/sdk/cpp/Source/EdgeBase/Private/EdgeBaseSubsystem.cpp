// EdgeBase Unreal Engine SDK — GameInstance Subsystem Implementation
#include "EdgeBaseSubsystem.h"

void UEdgeBaseSubsystem::Initialize(FSubsystemCollectionBase &Collection) {
  Super::Initialize(Collection);

  // DefaultGame.ini에서 URL 읽기:
  // [/Script/EdgeBase.EdgeBaseSubsystem]
  // Url=https://your-project.edgebase.fun
  FString ConfigUrl;
  GConfig->GetString(TEXT("/Script/EdgeBase.EdgeBaseSubsystem"), TEXT("Url"),
                     ConfigUrl, GGameIni);

  if (!ConfigUrl.IsEmpty()) {
    Client = UEdgeBase::Create(this, ConfigUrl);
  }
}

void UEdgeBaseSubsystem::Deinitialize() {
  Client = nullptr;
  Super::Deinitialize();
}

void UEdgeBaseSubsystem::SetUrl(const FString &Url) {
  Client = UEdgeBase::Create(this, Url);
}

FString UEdgeBaseSubsystem::GetUrl() const {
  return Client ? Client->GetBaseUrl() : FString();
}

// ── Auth
// ──────────────────────────────────────────────────────────────────────

void UEdgeBaseSubsystem::SignUp(const FString &Email, const FString &Password,
                                FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->SignUp(Email, Password, Callback);
}

void UEdgeBaseSubsystem::SignIn(const FString &Email, const FString &Password,
                                FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->SignIn(Email, Password, Callback);
}

void UEdgeBaseSubsystem::SignOut(FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->SignOut(Callback);
}

void UEdgeBaseSubsystem::SignInAnonymously(FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->SignInAnonymously(Callback);
}

void UEdgeBaseSubsystem::ChangePassword(const FString &CurrentPassword,
                                        const FString &NewPassword,
                                        FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->ChangePassword(CurrentPassword, NewPassword, Callback);
}

// ── Collection
// ────────────────────────────────────────────────────────────────

void UEdgeBaseSubsystem::CollectionInsert(const FString &Collection,
                                          const FString &JsonBody,
                                          FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->CollectionInsert(Collection, JsonBody, Callback);
}

void UEdgeBaseSubsystem::CollectionGetOne(const FString &Collection,
                                          const FString &Id,
                                          FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->CollectionGetOne(Collection, Id, Callback);
}

void UEdgeBaseSubsystem::CollectionUpdate(const FString &Collection,
                                          const FString &Id,
                                          const FString &JsonBody,
                                          FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->CollectionUpdate(Collection, Id, JsonBody, Callback);
}

void UEdgeBaseSubsystem::CollectionDelete(const FString &Collection,
                                          const FString &Id,
                                          FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->CollectionDelete(Collection, Id, Callback);
}

// ── Storage
// ───────────────────────────────────────────────────────────────────

FString UEdgeBaseSubsystem::StorageGetUrl(const FString &Bucket,
                                          const FString &Key) {
  if (!Client)
    return FString();
  return Client->StorageGetUrl(Bucket, Key);
}

void UEdgeBaseSubsystem::StorageUpload(const FString &Bucket,
                                       const FString &Key,
                                       const TArray<uint8> &Data,
                                       const FString &ContentType,
                                       FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->StorageUpload(Bucket, Key, Data, ContentType, Callback);
}

void UEdgeBaseSubsystem::StorageDelete(const FString &Bucket,
                                       const FString &Key,
                                       FEdgeBaseCallback Callback) {
  if (!Client) {
    Callback.ExecuteIfBound({false, 0, TEXT(""), TEXT("SetUrl() not called")});
    return;
  }
  Client->StorageDelete(Bucket, Key, Callback);
}
