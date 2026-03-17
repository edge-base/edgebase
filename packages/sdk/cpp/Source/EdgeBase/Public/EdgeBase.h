// EdgeBase Unreal Engine Plugin — THIN WRAPPER
//
// The core SDK logic lives in `core/` (pure C++17, no UE dependency).
// This wrapper exposes the core as UCLASS/UFUNCTION for Blueprint use.
//
// To link the core library in your project's Build.cs:
//   PublicAdditionalLibraries.Add(Path.Combine(ThirdPartyPath,
//   "edgebase_core.a")); PublicIncludePaths.Add(Path.Combine(ThirdPartyPath,
//   "include"));
//
// (See EdgeBase.Build.cs for the full ThirdParty setup.)

#pragma once

#include "CoreMinimal.h"
#include "HAL/CriticalSection.h"
#include "UObject/NoExportTypes.h"
#include "EdgeBase.generated.h"

namespace client {
class EdgeBase;
}

// ── Result type
// ───────────────────────────────────────────────────────────────

USTRUCT(BlueprintType)
struct EDGEBASE_API FEdgeBaseResult {
  GENERATED_BODY()
  UPROPERTY(BlueprintReadOnly) bool bSuccess = false;
  UPROPERTY(BlueprintReadOnly) int32 StatusCode = 0;
  /** Raw JSON body returned by the server (parse with FJsonObject if needed).
   */
  UPROPERTY(BlueprintReadOnly) FString Json;
  UPROPERTY(BlueprintReadOnly) FString Error;
};

DECLARE_DYNAMIC_DELEGATE_OneParam(FEdgeBaseCallback, const FEdgeBaseResult &, Result);

// ── UEdgeBase (Blueprint-callable, delegates to core) ────────────────────────
//
// NOTE: This class is a lightweight Blueprint/C++ facade.
//       All HTTP logic is in the core library (packages/sdk/cpp/core).
//
// Subsystem 패턴 (권장):
//   UEdgeBaseSubsystem* JB =
//   GetGameInstance()->GetSubsystem<UEdgeBaseSubsystem>();
//   JB->Auth_SignIn("user@example.com", "password", Callback);
//
// 직접 생성 (테스트용):
//   UEdgeBase* JB = UEdgeBase::Create(GetTransientPackage(),
//   TEXT("https://..."));

UCLASS(Blueprintable, BlueprintType)
class EDGEBASE_API UEdgeBase : public UObject {
  GENERATED_BODY()
public:
  // ────────────────────────────────────────────────────────────────────────────
  // 생성
  // ────────────────────────────────────────────────────────────────────────────

  /** EdgeBase 클라이언트 인스턴스를 생성합니다. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase",
            meta = (DefaultToSelf = "Outer", HidePin = "Outer"))
  static UEdgeBase *Create(UObject *Outer, const FString &Url);

  UFUNCTION(BlueprintPure, Category = "EdgeBase")
  FString GetBaseUrl() const;

  // ────────────────────────────────────────────────────────────────────────────
  // Auth
  // ────────────────────────────────────────────────────────────────────────────

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void SignUp(const FString &Email, const FString &Password,
              FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void SignIn(const FString &Email, const FString &Password,
              FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void SignOut(FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void SignInAnonymously(FEdgeBaseCallback Callback);

  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void ChangePassword(const FString &CurrentPassword,
                      const FString &NewPassword, FEdgeBaseCallback Callback);

  /**
   * 프로필 정보를 수정합니다 (displayName, avatarUrl).
   * @param JsonBody  { "displayName": "...", "avatarUrl": "..." }
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void UpdateProfile(const FString &JsonBody, FEdgeBaseCallback Callback);

  /** 현재 사용자의 활성 세션 목록을 가져옵니다. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void ListSessions(FEdgeBaseCallback Callback);

  /**
   * 특정 세션을 만료시킵니다.
   * @param SessionId  ListSessions 결과에서 얻은 세션 ID.
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void RevokeSession(const FString &SessionId, FEdgeBaseCallback Callback);

  /**
   * 이메일 인증을 완료합니다.
   * @param Token  이메일로 전달된 인증 토큰.
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void VerifyEmail(const FString &Token, FEdgeBaseCallback Callback);

  /** 비밀번호 재설정 이메일을 요청합니다. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void RequestPasswordReset(const FString &Email, FEdgeBaseCallback Callback);

  /**
   * 재설정 토큰으로 비밀번호를 변경합니다.
   * @param Token       이메일로 전달된 재설정 토큰.
   * @param NewPassword 새 비밀번호.
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Auth")
  void ResetPassword(const FString &Token, const FString &NewPassword,
                     FEdgeBaseCallback Callback);

  // ────────────────────────────────────────────────────────────────────────────
  // Collection — CRUD (Blueprint-friendly flat API)
  //
  // 쿼리 빌더 패턴은 C++ 전용으로 core 라이브러리를 직접 사용하세요.
  // Blueprint에서는 CollectionGet(Name, FilterJson, Callback) 형태로
  // 제공합니다.
  // ────────────────────────────────────────────────────────────────────────────

  /** 레코드를 생성합니다. JsonBody: { "field": "value", ... } */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection")
  void CollectionInsert(const FString &Name, const FString &JsonBody,
                        FEdgeBaseCallback Callback);

  /**
   * 조건에 맞는 레코드 목록을 가져옵니다.
   * @param FilterJson  { "where": [["field","==","val"]], "limit": 20 }
   *                    (비어있으면 전체 조회)
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection")
  void CollectionGet(const FString &Name, const FString &FilterJson,
                     FEdgeBaseCallback Callback);

  /** 단일 레코드를 ID로 조회합니다. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection")
  void CollectionGetOne(const FString &Name, const FString &Id,
                        FEdgeBaseCallback Callback);

  /** 레코드를 수정합니다 (PATCH). */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection")
  void CollectionUpdate(const FString &Name, const FString &Id,
                        const FString &JsonBody, FEdgeBaseCallback Callback);

  /** 레코드를 삭제합니다. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection")
  void CollectionDelete(const FString &Name, const FString &Id,
                        FEdgeBaseCallback Callback);

  /**
   * 레코드를 upsert합니다 (없으면 생성, 있으면 업데이트).
   * @param ConflictTarget  충돌 감지 키 (비어있으면 서버 기본값 사용).
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection")
  void CollectionUpsert(const FString &Name, const FString &JsonBody,
                        const FString &ConflictTarget,
                        FEdgeBaseCallback Callback);

  /** 레코드 수를 반환합니다 (FilterJson으로 조건 지정 가능). */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Collection")
  void CollectionCount(const FString &Name, const FString &FilterJson,
                       FEdgeBaseCallback Callback);

  // ────────────────────────────────────────────────────────────────────────────
  // Storage
  // ────────────────────────────────────────────────────────────────────────────

  /** 파일의 공개 URL을 반환합니다 (네트워크 요청 없음). */
  UFUNCTION(BlueprintCallable, BlueprintPure, Category = "EdgeBase|Storage")
  FString StorageGetUrl(const FString &Bucket, const FString &Key);

  /** 파일을 업로드합니다. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage")
  void StorageUpload(const FString &Bucket, const FString &Key,
                     const TArray<uint8> &Data, const FString &ContentType,
                     FEdgeBaseCallback Callback);

  /** 파일을 바이트 배열로 다운로드합니다. 결과는 FEdgeBaseResult.Json
   * (base64)으로 반환. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage")
  void StorageDownload(const FString &Bucket, const FString &Key,
                       FEdgeBaseCallback Callback);

  /** 파일을 삭제합니다. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage")
  void StorageDelete(const FString &Bucket, const FString &Key,
                     FEdgeBaseCallback Callback);

  /**
   * 버킷 내 파일 목록을 가져옵니다.
   * @param Prefix  접두사 필터 (빈 문자열이면 전체).
   * @param Limit   최대 반환 수 (기본 100).
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage")
  void StorageList(const FString &Bucket, const FString &Prefix, int32 Limit,
                   FEdgeBaseCallback Callback);

  /** 파일 메타데이터를 가져옵니다. */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage")
  void StorageGetMetadata(const FString &Bucket, const FString &Key,
                          FEdgeBaseCallback Callback);

  /**
   * 서명된 다운로드 URL을 생성합니다.
   * @param ExpiresIn  만료 시간 (예: "1h", "30m").
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage")
  void StorageCreateSignedUrl(const FString &Bucket, const FString &Key,
                              const FString &ExpiresIn,
                              FEdgeBaseCallback Callback);

  /**
   * 서명된 업로드 URL을 생성합니다 (클라이언트 직접 업로드).
   * @param ExpiresIn  만료 시간 (예: "1h", "30m").
   */
  UFUNCTION(BlueprintCallable, Category = "EdgeBase|Storage")
  void StorageCreateSignedUploadUrl(const FString &Bucket, const FString &Key,
                                    const FString &ExpiresIn,
                                    FEdgeBaseCallback Callback);

private:
  virtual void BeginDestroy() override;

  FString BaseUrl_;
  client::EdgeBase *CoreClient_ = nullptr;
  mutable FCriticalSection CoreMutex_;

  // Runs a core eb:: call on a background thread, then fires Callback on the
  // game thread. Keeps UE's FHttpModule independent of the core library.
  void RunAsync(TFunction<FEdgeBaseResult(client::EdgeBase &)> CoreFn,
                FEdgeBaseCallback Callback);
  client::EdgeBase *GetOrCreateCoreClient();
  void ResetCoreClient();
};
