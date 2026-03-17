// EdgeBase Unreal Engine SDK — GameInstance Subsystem
//
// UEdgeBaseSubsystem을 통해 Blueprint / C++ 어디서나
// `GetGameInstance()->GetSubsystem<UEdgeBaseSubsystem>()` 으로 접근합니다.
//
// 프로젝트 설정 → Project Settings → Plugins → EdgeBase에서 URL을 설정하세요.
#pragma once

#include "CoreMinimal.h"
#include "EdgeBase.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "EdgeBaseSubsystem.generated.h"

/// EdgeBase GameInstance 서브시스템.
///
/// 게임 인스턴스 생명주기에 연결된 전역 EdgeBase 클라이언트.
/// Blueprint에서는 "Get EdgeBase" → 모든 노드를 호출합니다.
///
/// C++ 예시:
/// @code
///   auto* JBSys = GetGameInstance()->GetSubsystem<UEdgeBaseSubsystem>();
///   JBSys->SignIn(Email, Password, FEdgeBaseCallback::CreateLambda([](auto&
///   R){ ... }));
/// @endcode
UCLASS()
class EDGEBASE_API UEdgeBaseSubsystem : public UGameInstanceSubsystem {
  GENERATED_BODY()

public:
  // ── USubsystem interface ──────────────────────────────────────
  virtual void Initialize(FSubsystemCollectionBase &Collection) override;
  virtual void Deinitialize() override;

  // ── 설정 ─────────────────────────────────────────────────────

  /// 연결할 EdgeBase 서버 URL.
  /// 사용 전 반드시 호출하거나 DefaultGame.ini에서 설정하세요.
  UFUNCTION(BlueprintCallable, Category = "EdgeBase")
  void SetUrl(const FString &Url);

  UFUNCTION(BlueprintPure, Category = "EdgeBase")
  FString GetUrl() const;

  // ── Auth ──────────────────────────────────────────────────────

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth",
            meta = (DisplayName = "Sign Up"))
  void SignUp(const FString &Email, const FString &Password,
              FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth",
            meta = (DisplayName = "Sign In"))
  void SignIn(const FString &Email, const FString &Password,
              FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth",
            meta = (DisplayName = "Sign Out"))
  void SignOut(FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth",
            meta = (DisplayName = "Sign In Anonymously"))
  void SignInAnonymously(FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth",
            meta = (DisplayName = "Change Password"))
  void ChangePassword(const FString &CurrentPassword,
                      const FString &NewPassword, FEdgeBaseCallback Callback);

  // ── Collection ────────────────────────────────────────────────

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection",
            meta = (DisplayName = "Collection: Insert"))
  void CollectionInsert(const FString &Collection, const FString &JsonBody,
                        FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection",
            meta = (DisplayName = "Collection: Get One"))
  void CollectionGetOne(const FString &Collection, const FString &Id,
                        FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection",
            meta = (DisplayName = "Collection: Update"))
  void CollectionUpdate(const FString &Collection, const FString &Id,
                        const FString &JsonBody, FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection",
            meta = (DisplayName = "Collection: Delete"))
  void CollectionDelete(const FString &Collection, const FString &Id,
                        FEdgeBaseCallback Callback);

  // ── Storage ───────────────────────────────────────────────────

  UFUNCTION(BlueprintCallable, BlueprintPure, Category = "EdgeBase|Storage",
            meta = (DisplayName = "Storage: Get URL"))
  FString StorageGetUrl(const FString &Bucket, const FString &Key);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage",
            meta = (DisplayName = "Storage: Upload"))
  void StorageUpload(const FString &Bucket, const FString &Key,
                     const TArray<uint8> &Data, const FString &ContentType,
                     FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage",
            meta = (DisplayName = "Storage: Delete"))
  void StorageDelete(const FString &Bucket, const FString &Key,
                     FEdgeBaseCallback Callback);

private:
  UPROPERTY()
  UEdgeBase *Client = nullptr;
};
