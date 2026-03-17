// EdgeBase Unreal Engine SDK — Build.cs
// Unreal Engine 5.x 전용 플러그인 빌드 설정.
//
// core/ 라이브러리를 ThirdParty로 링크합니다.
// 빌드 전 준비:
//   cd packages/sdk/cpp/core
//   cmake -B build -DCMAKE_BUILD_TYPE=Release
//   cmake --build build
//   cp build/libedgebase_core.a Source/ThirdParty/lib/
//   cp -r include/ Source/ThirdParty/include/

using System.IO;
using UnrealBuildTool;

public class EdgeBase : ModuleRules
{
    public EdgeBase(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        CppStandard = CppStandardVersion.Default;

        // ── Unreal 의존 모듈 ─────────────────────────────────────────
        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core", "CoreUObject", "Engine",
            "HTTP", "Json", "JsonUtilities"
        });

        // ── EdgeBase 순수 C++17 코어 (ThirdParty) ───────────────────
        var ThirdPartyPath = Path.Combine(ModuleDirectory, "..", "..", "ThirdParty");
        var CoreLibPath    = Path.Combine(ThirdPartyPath, "lib");
        var CoreIncPath    = Path.Combine(ThirdPartyPath, "include");
        bool bHasCoreLibrary = false;

        // 플랫폼별 정적 라이브러리 링크
        if (Target.Platform == UnrealTargetPlatform.Win64)
        {
            bHasCoreLibrary = true;
            PublicIncludePaths.Add(CoreIncPath);
            PublicAdditionalLibraries.Add(Path.Combine(CoreLibPath, "win64", "edgebase_core.lib"));
        }
        else if (Target.Platform == UnrealTargetPlatform.Mac)
        {
            bHasCoreLibrary = true;
            PublicIncludePaths.Add(CoreIncPath);
            PublicAdditionalLibraries.Add(Path.Combine(CoreLibPath, "mac", "libedgebase_core.a"));
        }
        else if (Target.Platform == UnrealTargetPlatform.Linux)
        {
            bHasCoreLibrary = true;
            PublicIncludePaths.Add(CoreIncPath);
            PublicAdditionalLibraries.Add(Path.Combine(CoreLibPath, "linux", "libedgebase_core.a"));
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
