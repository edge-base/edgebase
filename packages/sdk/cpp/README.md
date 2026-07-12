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
- `scripts/sync-thirdparty.sh` / `scripts/sync-thirdparty.ps1`: build and sync
  the platform core and IXWebSocket libraries into `ThirdParty/`, then link a
  metadata-free standalone consumer against the copied artifacts

EdgeBase is the open-source edge-native BaaS that runs on Edge, Docker, and Node.js.

This package is one part of the wider EdgeBase platform. For the full platform, CLI, Admin Dashboard, server runtime, docs, and all public SDKs, see the main repository: [edge-base/edgebase](https://github.com/edge-base/edgebase).

## Requirements

- Unreal Engine 5.x
- C++17
- CMake toolchain for building the bundled core library
- Win64, macOS, or Linux for the Unreal plugin. Android, iOS, and console
  plugin artifacts are not currently shipped and fail fast instead of
  packaging an `EDGEBASE_HAS_CORE=0` stub.

## Install

1. Copy or symlink this folder into your Unreal project as `Plugins/EdgeBase`.
2. Sync the bundled core and IXWebSocket libraries into `ThirdParty/`:

macOS/Linux:

```bash
cd Plugins/EdgeBase
./scripts/sync-thirdparty.sh
```

Windows PowerShell:

```powershell
cd Plugins\EdgeBase
powershell -ExecutionPolicy Bypass -File .\scripts\sync-thirdparty.ps1
```

The Unreal build fails immediately with the expected artifact path when this
step has not been run; it requires both the EdgeBase core and IXWebSocket
archives and never silently packages a no-core plugin. The sync command also
links a standalone executable using only the copied `ThirdParty/` headers and
archives, so missing transitive native dependencies are caught before UBT.

3. Enable the `EdgeBase` plugin in your `.uproject` or from the Plugins UI.

The plugin descriptor lives at [EdgeBase.uplugin](./EdgeBase.uplugin).

## Unreal Usage

### Blueprint

Use `Get Game Instance -> Get Subsystem (EdgeBaseSubsystem)` and call the `EdgeBase|Auth`, `EdgeBase|Collection`, or `EdgeBase|Storage` nodes.

### C++

Protected auth uses an interactive `SWebBrowser`. Call the synchronous core
`client::EdgeBase::auth()` API only from a background thread. Calling it on the
Unreal Game Thread now returns an explicit `captcha-unavailable` error instead
of sending an unprotected request. The Blueprint/subsystem methods already
dispatch their work off the Game Thread.

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

### Durable native auth tokens

Pure C++ has no portable secure credential vault. Supply an
`AuthTokenStorage` backed by the platform vault when a native application must
survive restarts or upgrade an anonymous account. `saveTokens` must atomically
and durably replace the complete pair or throw without modifying the previous
pair.

```cpp
class PlatformTokenStorage final : public client::AuthTokenStorage {
public:
  std::optional<client::AuthTokenPair> loadTokens() override;
  void saveTokens(const client::AuthTokenPair& tokens) override;
  void clearTokens() override;
};

auto tokenStorage = std::make_shared<PlatformTokenStorage>();
client::EdgeBase core("https://your-project.edgebase.fun", tokenStorage);
```

An anonymous `verifyLinkPhone` call is rejected before network I/O when no
durable storage is configured (or the current JWT cannot be classified). If
durable persistence fails after the server upgrade, the SDK keeps the old
in-memory pair and returns `token-persistence-failed`; retry the same phone and
code within the server's five-minute encrypted completion-checkpoint window.

## Build The Core Library

```bash
cd packages/sdk/cpp/packages/core
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

Then run `./scripts/sync-thirdparty.sh` from the plugin root to refresh and
standalone-link-verify both native archives in `ThirdParty/`.
