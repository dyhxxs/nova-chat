param(
  [Parameter(Mandatory=$true)][string]$GatewayUrl,
  [switch]$AllowTemporaryGateway,
  [switch]$OfflineBuild,
  [switch]$ExistingAccountsOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mobile = Join-Path $root 'apps\mobile'
$android = Join-Path $mobile 'android'
# Keep the release credential out of Gradle/Metro/npm and restore the caller's environment.
$environmentNames = @('NOVA_RELEASE_SESSION_TOKEN', 'EXPO_PUBLIC_GATEWAY_URL', 'ALLOW_CLEARTEXT', 'ANDROID_HOME', 'ANDROID_SDK_ROOT')
$originalEnvironment = @{}
foreach ($name in $environmentNames) { $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$releaseSessionToken = $originalEnvironment['NOVA_RELEASE_SESSION_TOKEN']
[Environment]::SetEnvironmentVariable('NOVA_RELEASE_SESSION_TOKEN', $null, 'Process')
function Invoke-ReleaseChatCheck {
  param([string]$Stage)
  try {
    [Environment]::SetEnvironmentVariable('NOVA_RELEASE_SESSION_TOKEN', $releaseSessionToken, 'Process')
    & node @chatCheckArgs
    if ($LASTEXITCODE -ne 0) { throw "$Stage 公网认证/流式聊天验收失败，禁止输出分享包。" }
  } finally {
    [Environment]::SetEnvironmentVariable('NOVA_RELEASE_SESSION_TOKEN', $null, 'Process')
  }
}
try {
  & node (Join-Path $PSScriptRoot 'check_release_metadata.mjs')
  if ($LASTEXITCODE -ne 0) { throw '发布版本、应用标识或锁文件不一致。' }
  $checker = Join-Path $PSScriptRoot 'check_gateway.mjs'
  $checkArgs = @($checker, $GatewayUrl)
  if ($AllowTemporaryGateway) { $checkArgs += '--allow-temporary' }
  if ($ExistingAccountsOnly) { $checkArgs += '--existing-accounts-only' }
  $gatewayCheck = & node @checkArgs
  if ($LASTEXITCODE -ne 0) { throw '网关发布前检查失败。' }
  if ($AllowTemporaryGateway) { Write-Warning '正在构建临时预览版：电脑/隧道离线后仍不可用，不能作为常驻正式服务。' }
  $config = Get-Content -LiteralPath (Join-Path $mobile 'app.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $version = [string]$config.expo.version
  $versionCode = [int]$config.expo.android.versionCode
  $verifiedGatewayUrl = [string](($gatewayCheck -join "`n" | ConvertFrom-Json).gatewayUrl)
  if (-not $verifiedGatewayUrl) { throw '网关检查未返回规范地址。' }
  Write-Output ($gatewayCheck -join "`n")
  $chatCheckArgs = @((Join-Path $PSScriptRoot 'check_gateway_chat.mjs'), $verifiedGatewayUrl)
  if ($AllowTemporaryGateway) { $chatCheckArgs += '--allow-temporary' }
  if ($ExistingAccountsOnly) { $chatCheckArgs += '--existing-accounts-only' }
  if ([string]::IsNullOrWhiteSpace($releaseSessionToken)) { throw '缺少专用发布验证会话 NOVA_RELEASE_SESSION_TOKEN；健康检查不等于聊天可用，禁止跳过真实聊天验收。' }
  Invoke-ReleaseChatCheck -Stage '构建前'
  $env:EXPO_PUBLIC_GATEWAY_URL = $verifiedGatewayUrl
  $env:ALLOW_CLEARTEXT = 'false'
  if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'D:\Android\Sdk' }
  if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }
  if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw '缺少 Android SDK，请设置 ANDROID_HOME。' }
  Push-Location $root
  try { & npm run verify; if ($LASTEXITCODE -ne 0) { throw '测试未通过，禁止打包。' } } finally { Pop-Location }
  Push-Location $mobile
  try {
    & npx expo install --check
    if ($LASTEXITCODE -ne 0) { throw 'Expo 依赖版本不兼容。' }
    & npx expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Android 原生配置同步失败。' }
    # Metro can reuse an old EXPO_PUBLIC_GATEWAY_URL even after changing the environment.
    # Clear the cache through Expo, not by deleting arbitrary filesystem paths.
    $preflight = Join-Path $root ".run\friend-android-preflight-$version"
    & npx expo export --platform android --clear --output-dir $preflight
    if ($LASTEXITCODE -ne 0) { throw 'Android 应用代码重新打包失败。' }
  } finally { Pop-Location }
  Push-Location $android
  try {
    $gradleArgs = @(':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', "-PnovaVersionCode=$versionCode", "-PnovaVersionName=$version", '--console=plain', '--no-daemon', '--rerun-tasks')
    if ($OfflineBuild) { $gradleArgs += '--offline' }
    & .\gradlew.bat @gradleArgs
    if ($LASTEXITCODE -ne 0) { throw 'Android APK 构建失败。' }
  } finally { Pop-Location }
  $source = Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
  $tools = Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending | Select-Object -First 1
  $aapt = Join-Path $tools.FullName 'aapt.exe'
  $signer = Join-Path $tools.FullName 'apksigner.bat'
  $badging = (& $aapt dump badging $source) -join "`n"
  if ($LASTEXITCODE -ne 0 -or -not $badging.Contains("package: name='com.novachat.mobile'")) { throw 'APK 包名验证失败。' }
  if (-not $badging.Contains("versionName='$version'") -or -not $badging.Contains("versionCode='$versionCode'")) { throw 'APK 版本号不正确。' }
  if (-not $badging.Contains("native-code: 'arm64-v8a'")) { throw 'APK 架构不正确。' }
  $manifest = (& $aapt dump xmltree $source AndroidManifest.xml) -join "`n"
  if ($manifest -match 'usesCleartextTraffic[^\r\n]*0xffffffff') { throw '公网包不得允许明文 HTTP。' }
  if ($manifest -match 'android:debuggable[^\r\n]*0xffffffff') { throw '分享包不得开启调试。' }
  $permissions = (& $aapt dump permissions $source) -join "`n"
  if (-not $permissions.Contains('android.permission.INTERNET') -or -not $permissions.Contains('android.permission.CAMERA') -or $permissions.Contains('android.permission.RECORD_AUDIO')) { throw 'APK 权限验证失败。' }
  & $signer verify $source
  if ($LASTEXITCODE -ne 0) { throw 'APK 签名验证失败。' }
  & node (Join-Path $PSScriptRoot 'check_apk_gateway.mjs') $source $verifiedGatewayUrl
  if ($LASTEXITCODE -ne 0) { throw 'APK 内置网关与本次发布地址不一致。' }
  & (Join-Path $tools.FullName 'zipalign.exe') -c -P 16 4 $source
  if ($LASTEXITCODE -ne 0) { throw 'APK 对齐验证失败。' }
  # Release-mode JavaScript, but the local Expo keystore is for previews, not production signing.
  $targetDir = Join-Path $root "artifacts\friend-$version"
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  $target = Join-Path $targetDir "NovaChat-$version-android-arm64-preview.apk"
  & node @checkArgs
  if ($LASTEXITCODE -ne 0) { throw '构建后公网复查失败，暂不输出分享包。' }
  Invoke-ReleaseChatCheck -Stage '构建后'
  Copy-Item -LiteralPath $source -Destination $target -Force
  $hash = Get-FileHash -LiteralPath $target -Algorithm SHA256
  "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($target))" | Set-Content -LiteralPath (Join-Path $targetDir 'SHA256SUMS.txt') -Encoding ascii
  Write-Output "已验证的预览包：$target"
  Write-Output "SHA-256: $($hash.Hash)"
} finally {
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process') }
  $releaseSessionToken = $null
}
