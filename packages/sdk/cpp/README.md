<p align="center">
  <a href="https://github.com/edge-base/edgebase">
    <img src="https://raw.githubusercontent.com/edge-base/edgebase/main/docs/static/img/logo-icon.svg" alt="EdgeBase Logo" width="72" />
  </a>
</p>

# EdgeBase C++ SDK for Unreal Engine

`packages/sdk/cpp` is an Unreal Engine plugin that wraps the EdgeBase C++ core.

- `packages/core`: pure C++17 client SDK
- `Source/EdgeBase`: Unreal `UCLASS` / Blueprint wrapper
- `EdgeBase.uplugin`: plugin descriptor
- `scripts/sync-thirdparty.sh`: builds and syncs the core library into `ThirdParty/`

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Requirements

- Unreal Engine 5.x
- C++17
- CMake toolchain for building the bundled core library

## Install

1. Copy or symlink this folder into your Unreal project as `Plugins/EdgeBase`.
2. Sync the bundled core library into `ThirdParty/`:

```bash
cd Plugins/EdgeBase
./scripts/sync-thirdparty.sh
```

3. Enable the `EdgeBase` plugin in your `.uproject` or from the Plugins UI.

The plugin descriptor lives at [EdgeBase.uplugin](./EdgeBase.uplugin).

## Unreal Usage

### Blueprint

Use `Get Game Instance -> Get Subsystem (EdgeBaseSubsystem)` and call the `EdgeBase|Auth`, `EdgeBase|Collection`, or `EdgeBase|Storage` nodes.

### C++

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
            UE_LOG(LogTemp, Log, TEXT("Sign-in HTTP %d"), Result.StatusCode);
        }));

    EdgeBase->CollectionInsert(
        TEXT("scores"),
        TEXT("{\"uid\":\"user123\",\"score\":9999}"),
        FEdgeBaseCallback::CreateLambda([](const FEdgeBaseResult& Result)
        {
            UE_LOG(LogTemp, Log, TEXT("Insert HTTP %d"), Result.StatusCode);
        }));
}
```

### DefaultGame.ini

```ini
[/Script/EdgeBase.EdgeBaseSubsystem]
Url=https://your-project.edgebase.fun
```

## Blueprint API

All async methods return `FEdgeBaseResult` via `FEdgeBaseCallback`.

```cpp
struct FEdgeBaseResult {
    bool bSuccess;
    int32 StatusCode;
    FString Json;
    FString Error;
};
```

### Auth

- `SignUp(Email, Password, Callback)`
- `SignIn(Email, Password, Callback)`
- `SignOut(Callback)`
- `SignInAnonymously(Callback)`
- `ChangePassword(CurrentPassword, NewPassword, Callback)`
- `UpdateProfile(JsonBody, Callback)`
- `ListSessions(Callback)`
- `RevokeSession(SessionId, Callback)`
- `VerifyEmail(Token, Callback)`
- `RequestPasswordReset(Email, Callback)`
- `ResetPassword(Token, NewPassword, Callback)`

### Collection

- `CollectionInsert(Name, JsonBody, Callback)`
- `CollectionGet(Name, FilterJson, Callback)`
- `CollectionGetOne(Name, Id, Callback)`
- `CollectionUpdate(Name, Id, JsonBody, Callback)`
- `CollectionDelete(Name, Id, Callback)`
- `CollectionUpsert(Name, JsonBody, ConflictTarget, Callback)`
- `CollectionCount(Name, FilterJson, Callback)`

### Storage

- `StorageGetUrl(Bucket, Key)`
- `StorageUpload(Bucket, Key, Data, ContentType, Callback)`
- `StorageDownload(Bucket, Key, Callback)`
- `StorageDelete(Bucket, Key, Callback)`
- `StorageList(Bucket, Prefix, Limit, Callback)`
- `StorageGetMetadata(Bucket, Key, Callback)`
- `StorageCreateSignedUrl(Bucket, Key, ExpiresIn, Callback)`
- `StorageCreateSignedUploadUrl(Bucket, Key, ExpiresIn, Callback)`

## Core C++ API

Use the pure C++ client directly when you need the query builder.

```cpp
#include <edgebase/edgebase.h>

eb::EdgeBase core("https://your-project.edgebase.fun");

auto result = core.db("shared")
    .table("scores")
    .where("stage", "==", "5")
    .orderBy("score", "desc")
    .limit(10)
    .getList();

auto insertResult = core.db("shared")
    .table("scores")
    .insert(R"({"uid":"user123","score":9999})");

auto url = core.storage().bucket("avatars").getUrl("user123.png");
```

## Build The Core Library

```bash
cd packages/sdk/cpp/packages/core
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

Then run `./scripts/sync-thirdparty.sh` from the plugin root to refresh `ThirdParty/`.
