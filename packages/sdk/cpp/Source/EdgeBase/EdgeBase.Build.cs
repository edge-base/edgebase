// EdgeBase Unreal Engine SDK — Build.cs
// Unreal Engine 5.x 전용 플러그인 빌드 설정.
//
// EdgeBase core와 IXWebSocket 라이브러리를 ThirdParty로 링크합니다.
// 빌드 전 준비:
//   macOS/Linux: ./scripts/sync-thirdparty.sh
//   Win64: powershell -ExecutionPolicy Bypass -File .\scripts\sync-thirdparty.ps1

using System.IO;
using UnrealBuildTool;

public class EdgeBase : ModuleRules
{
    public EdgeBase(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        CppStandard = CppStandardVersion.Default;
        // Turnstile URL validation and platform factory isolation fail closed
        // through C++ exceptions; keep this module aligned with the C++17 SDK.
        bEnableExceptions = true;

        // ── Unreal 의존 모듈 ─────────────────────────────────────────
        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core", "CoreUObject", "Engine",
            "HTTP", "Json", "JsonUtilities",
            "Slate", "SlateCore", "WebBrowser", "WebBrowserWidget"
        });

        // ── EdgeBase 순수 C++17 코어 (ThirdParty) ───────────────────
        var ThirdPartyPath = Path.Combine(ModuleDirectory, "..", "..", "ThirdParty");
        var CoreLibPath    = Path.Combine(ThirdPartyPath, "lib");
        var CoreIncPath    = Path.Combine(ThirdPartyPath, "include");
        bool bHasCoreLibrary = false;
        string CoreLibraryPath = null;
        string IxWebSocketLibraryPath = null;

        // 플랫폼별 정적 라이브러리 링크
        if (Target.Platform == UnrealTargetPlatform.Win64)
        {
            CoreLibraryPath = Path.Combine(CoreLibPath, "win64", "edgebase_core.lib");
            IxWebSocketLibraryPath = Path.Combine(CoreLibPath, "win64", "ixwebsocket.lib");
            PublicSystemLibraries.AddRange(new string[]
            {
                "bcrypt.lib", "wsock32.lib", "ws2_32.lib", "shlwapi.lib", "crypt32.lib"
            });
        }
        else if (Target.Platform == UnrealTargetPlatform.Mac)
        {
            CoreLibraryPath = Path.Combine(CoreLibPath, "mac", "libedgebase_core.a");
            IxWebSocketLibraryPath = Path.Combine(CoreLibPath, "mac", "libixwebsocket.a");
            PublicFrameworks.AddRange(new string[] { "Foundation", "Security" });
        }
        else if (Target.Platform == UnrealTargetPlatform.Linux)
        {
            CoreLibraryPath = Path.Combine(CoreLibPath, "linux", "libedgebase_core.a");
            IxWebSocketLibraryPath = Path.Combine(CoreLibPath, "linux", "libixwebsocket.a");
        }
        else
        {
            throw new BuildException(
                "EdgeBase Unreal currently ships native ThirdParty artifacts only for " +
                "Win64, Mac, and Linux. Target platform {0} is unsupported; do not " +
                "package a core-less EDGEBASE_HAS_CORE=0 runtime.",
                Target.Platform);
        }

        if (CoreLibraryPath != null)
        {
            var CoreHeaderPath = Path.Combine(CoreIncPath, "edgebase", "edgebase.h");
            if (!File.Exists(CoreLibraryPath) ||
                !File.Exists(IxWebSocketLibraryPath) ||
                !File.Exists(CoreHeaderPath))
            {
                var SyncCommand = Target.Platform == UnrealTargetPlatform.Win64
                    ? "powershell -ExecutionPolicy Bypass -File .\\scripts\\sync-thirdparty.ps1"
                    : "./scripts/sync-thirdparty.sh";
                throw new BuildException(
                    "EdgeBase ThirdParty core artifacts are missing for {0}. " +
                    "Run `{1}` from the EdgeBase plugin root before packaging. " +
                    "Expected libraries: {2} and {3}",
                    Target.Platform,
                    SyncCommand,
                    CoreLibraryPath,
                    IxWebSocketLibraryPath);
            }
            bHasCoreLibrary = true;
            PublicIncludePaths.Add(CoreIncPath);
            PublicAdditionalLibraries.Add(CoreLibraryPath);
            PublicAdditionalLibraries.Add(IxWebSocketLibraryPath);
        }

        if (bHasCoreLibrary)
        {
            AddEngineThirdPartyPrivateStaticDependencies(
                Target,
                "libcurl",
                "OpenSSL",
                "nghttp2",
                "zlib");
        }

        // ── 정의 ─────────────────────────────────────────────────────
        PublicDefinitions.Add("EDGEBASE_UNREAL=1");
        PublicDefinitions.Add($"EDGEBASE_HAS_CORE={(bHasCoreLibrary ? 1 : 0)}");
    }
}
