$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PluginRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$CoreRoot = Join-Path $PluginRoot "packages\core"
$BuildRoot = Join-Path $CoreRoot "build-win64"
$ThirdPartyRoot = Join-Path $PluginRoot "ThirdParty"
$ConsumerSource = Join-Path $PluginRoot "packages\unreal\tests\thirdparty_consumer"

# Reconfigure and rebuild every time so a stale archive cannot omit a newly
# added security-sensitive SDK symbol. GitHub-hosted Windows runners and common
# developer setups expose vcpkg through VCPKG_INSTALLATION_ROOT.
$ConfigureArgs = @(
  "-S", $CoreRoot,
  "-B", $BuildRoot,
  "-A", "x64",
  "-DCMAKE_BUILD_TYPE=Release"
)
if ($env:VCPKG_INSTALLATION_ROOT) {
  $ConfigureArgs += "-DCMAKE_TOOLCHAIN_FILE=$($env:VCPKG_INSTALLATION_ROOT)\scripts\buildsystems\vcpkg.cmake"
}
cmake @ConfigureArgs
if ($LASTEXITCODE -ne 0) { throw "CMake configure failed." }
cmake --build $BuildRoot --config Release --parallel 4
if ($LASTEXITCODE -ne 0) { throw "CMake build failed." }

$LibraryCandidates = @(
  (Join-Path $BuildRoot "Release\edgebase_core.lib"),
  (Join-Path $BuildRoot "edgebase_core.lib")
)
$CoreLibrary = $LibraryCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $CoreLibrary) {
  throw "edgebase_core.lib was not produced by the Windows build."
}
$IxLibraryCandidates = @(
  (Join-Path $BuildRoot "_deps\ixwebsocket-build\Release\ixwebsocket.lib"),
  (Join-Path $BuildRoot "_deps\ixwebsocket-build\ixwebsocket.lib")
)
$IxLibrary = $IxLibraryCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $IxLibrary) {
  throw "ixwebsocket.lib was not produced by the Windows build."
}

$IncludeRoot = Join-Path $ThirdPartyRoot "include"
$LibraryRoot = Join-Path $ThirdPartyRoot "lib\win64"
New-Item -ItemType Directory -Force -Path $IncludeRoot, $LibraryRoot | Out-Null
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $IncludeRoot "edgebase")
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $IncludeRoot "nlohmann")
Copy-Item -Recurse -Force (Join-Path $CoreRoot "include\edgebase") $IncludeRoot
Copy-Item -Recurse -Force `
  (Join-Path $BuildRoot "_deps\nlohmann_json-src\include\nlohmann") `
  $IncludeRoot
Copy-Item -Force $CoreLibrary (Join-Path $LibraryRoot "edgebase_core.lib")
Copy-Item -Force $IxLibrary (Join-Path $LibraryRoot "ixwebsocket.lib")

# Link a consumer from copied artifacts only. This intentionally does not use
# the edgebase_core or ixwebsocket CMake targets, matching UnrealBuildTool.
$ConsumerBuild = Join-Path $BuildRoot "thirdparty-consumer"
$ConsumerConfigureArgs = @(
  "-S", $ConsumerSource,
  "-B", $ConsumerBuild,
  "-DEDGEBASE_THIRDPARTY_ROOT=$ThirdPartyRoot"
)
if ($env:VCPKG_INSTALLATION_ROOT) {
  $ConsumerConfigureArgs += "-DCMAKE_TOOLCHAIN_FILE=$($env:VCPKG_INSTALLATION_ROOT)\scripts\buildsystems\vcpkg.cmake"
}
cmake @ConsumerConfigureArgs
if ($LASTEXITCODE -ne 0) { throw "ThirdParty consumer configure failed." }
cmake --build $ConsumerBuild --config Release --parallel 4
if ($LASTEXITCODE -ne 0) { throw "ThirdParty consumer link failed." }

Write-Host "Synced and link-verified EdgeBase Unreal Win64 ThirdParty artifacts in $ThirdPartyRoot"
