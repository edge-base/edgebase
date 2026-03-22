<!-- Generated from packages/sdk/cpp/packages/unreal/llms.txt. Do not edit directly; update the source llms.txt and rerun `node tools/agent-skill-gen/generate.mjs`. -->

# EdgeBase Unreal SDK

Use this file as a quick-reference contract for AI coding assistants working with the Unreal Engine EdgeBase plugin in `packages/sdk/cpp/packages/unreal` and `packages/sdk/cpp/Source/EdgeBase`.

## Package Boundary

Use this package for Unreal Engine 5.x client apps that need Blueprint-callable and Unreal-friendly C++ wrappers around the EdgeBase C++ core.

This package is not a privileged backend/admin SDK. Do not assume Service Key access, raw SQL admin helpers, or trusted server-only APIs exist in the Unreal plugin. Use a backend or another EdgeBase admin SDK for privileged server work.

## Source Of Truth

- Package overview: https://github.com/edge-base/edgebase/blob/main/packages/sdk/cpp/README.md
- Unreal wrapper header: https://github.com/edge-base/edgebase/blob/main/packages/sdk/cpp/Source/EdgeBase/Public/EdgeBase.h
- Subsystem header: https://github.com/edge-base/edgebase/blob/main/packages/sdk/cpp/Source/EdgeBase/Public/EdgeBaseSubsystem.h
- Build setup: https://github.com/edge-base/edgebase/blob/main/packages/sdk/cpp/Source/EdgeBase/EdgeBase.Build.cs
- Quickstart: https://edgebase.fun/docs/getting-started/quickstart
- Authentication: https://edgebase.fun/docs/authentication
- Database client SDK: https://edgebase.fun/docs/database/client-sdk
- Storage upload/download: https://edgebase.fun/docs/storage/upload-download
- Functions client SDK: https://edgebase.fun/docs/functions/client-sdk
- Push client SDK: https://edgebase.fun/docs/push/client-sdk

If docs, snippets, and assumptions disagree, prefer the current Unreal public headers over guessed patterns from another runtime.

## Canonical Examples

### Use the subsystem in C++

```cpp
#include "EdgeBaseSubsystem.h"

void AMyGameMode::BeginPlay()
{
    Super::BeginPlay();

    auto* EdgeBase = GetGameInstance()->GetSubsystem<UEdgeBaseSubsystem>();
    EdgeBase->SetUrl(TEXT("https://your-project.edgebase.fun"));
    EdgeBase->SignIn(
        TEXT("user@example.com"),
        TEXT("Passw0rd!123"),
        FEdgeBaseCallback::CreateLambda([](const FEdgeBaseResult& Result)
        {
            UE_LOG(LogTemp, Log, TEXT("HTTP %d"), Result.StatusCode);
        }));
}
```

### Create the wrapper directly

```cpp
#include "EdgeBase.h"

UEdgeBase* Client = UEdgeBase::Create(GetTransientPackage(), TEXT("https://your-project.edgebase.fun"));
```

### Insert collection data

```cpp
EdgeBase->CollectionInsert(
    TEXT("scores"),
    TEXT("{\"uid\":\"user123\",\"score\":9999}"),
    FEdgeBaseCallback::CreateLambda([](const FEdgeBaseResult& Result)
    {
        UE_LOG(LogTemp, Log, TEXT("Insert success: %s"), Result.bSuccess ? TEXT("true") : TEXT("false"));
    }));
```

### Upload to storage

```cpp
TArray<uint8> Bytes;
Bytes.Add(0x01);
Bytes.Add(0x02);

EdgeBase->StorageUpload(
    TEXT("avatars"),
    TEXT("user123.bin"),
    Bytes,
    TEXT("application/octet-stream"),
    FEdgeBaseCallback());
```

## Hard Rules

- use `UEdgeBaseSubsystem` as the default entry point for gameplay code
- set the server URL with `SetUrl(...)` or configure it in `DefaultGame.ini` before calling auth/database/storage methods
- async methods report results through `FEdgeBaseCallback`
- `FEdgeBaseResult` contains `bSuccess`, `StatusCode`, raw `Json`, and `Error`
- Blueprint-friendly collection APIs are flat methods like `CollectionInsert`, `CollectionGetOne`, and `CollectionUpdate`
- if you need the richer query builder, use the pure C++ core SDK directly instead of the Blueprint wrapper
- the plugin links the pure C++ core through `ThirdParty/`; keep `scripts/sync-thirdparty.sh` and `EdgeBase.Build.cs` in sync with packaged binaries

## Common Mistakes

- do not invent admin/server-only APIs in the Unreal wrapper
- do not use browser-only assumptions like `window`, redirects, or DOM captcha widgets
- do not forget to prepare/sync the core library into `ThirdParty/` for native builds
- do not expect Blueprint collection helpers to expose the full core query-builder chain
- do not parse `FEdgeBaseResult.Json` as if it were already structured Unreal types; parse the JSON yourself when needed

## Quick Reference

```text
GetGameInstance()->GetSubsystem<UEdgeBaseSubsystem>()    -> recommended runtime entry point
UEdgeBase::Create(Outer, Url)                            -> direct wrapper creation
Subsystem->SetUrl(Url)                                   -> configure base URL
Subsystem->SignUp(Email, Password, Callback)             -> async auth
Subsystem->SignIn(Email, Password, Callback)             -> async auth
Subsystem->CollectionInsert(Name, JsonBody, Callback)    -> async collection create
Subsystem->CollectionGetOne(Name, Id, Callback)          -> async collection read
Subsystem->CollectionUpdate(Name, Id, JsonBody, Callback)-> async collection update
Subsystem->CollectionDelete(Name, Id, Callback)          -> async collection delete
Subsystem->StorageGetUrl(Bucket, Key)                    -> FString
Subsystem->StorageUpload(Bucket, Key, Data, Type, Callback) -> async upload
FEdgeBaseResult                                          -> { bSuccess, StatusCode, Json, Error }
```
