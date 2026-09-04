param(
  [string]$GatewayUrl = '',
  [string]$GatewayHost = '',
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$mobileDir = Join-Path $projectRoot 'apps\mobile'
$androidDir = Join-Path $mobileDir 'android'
$artifactDir = Join-Path $projectRoot 'artifacts'
$appConfig = Get-Content -LiteralPath (Join-Path $mobileDir 'app.json') -Raw -Encoding utf8 | ConvertFrom-Json
$appVersion = [string]$appConfig.expo.version
$appVersionCode = [int]$appConfig.expo.android.versionCode
if ([string]::IsNullOrWhiteSpace($appVersion)) { throw 'app.json 中缺少 Expo 版本号。' }
if ($appVersionCode -le 0) { throw 'app.json 中缺少有效的 Android versionCode。' }
$apkName = "NovaChat-$appVersion-android-arm64-lan.apk"
$infoName = "NovaChat-$appVersion-LAN-INFO.txt"

if ([string]::IsNullOrWhiteSpace($GatewayUrl)) {
  if ([string]::IsNullOrWhiteSpace($GatewayHost)) {
    $GatewayHost = Get-NetIPConfiguration |
      Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
      Select-Object -First 1 -ExpandProperty IPv4Address |
      Select-Object -ExpandProperty IPAddress
  }
  if ([string]::IsNullOrWhiteSpace($GatewayHost)) { throw '无法自动找到局域网 IPv4 地址。' }
  $GatewayUrl = "http://${GatewayHost}:$Port"
}

try {
  $gatewayUri = [System.Uri]$GatewayUrl
} catch {
  throw "GatewayUrl 不是有效 URL：$GatewayUrl"
}
if (-not $gatewayUri.IsAbsoluteUri -or $gatewayUri.Scheme -notin @('http', 'https') -or [string]::IsNullOrWhiteSpace($gatewayUri.Host)) {
  throw "GatewayUrl 必须是包含主机名的 http:// 或 https:// 地址：$GatewayUrl"
}
if (-not [string]::IsNullOrWhiteSpace($gatewayUri.UserInfo)) {
  throw 'GatewayUrl 不能包含用户名或密码。'
}
if ($gatewayUri.AbsolutePath -ne '/' -or -not [string]::IsNullOrWhiteSpace($gatewayUri.Query) -or -not [string]::IsNullOrWhiteSpace($gatewayUri.Fragment)) {
  throw 'GatewayUrl 只能包含协议、主机名、可选端口，不能包含路径、查询参数或片段。'
}
$gatewayUrl = $gatewayUri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
$env:EXPO_PUBLIC_GATEWAY_URL = $gatewayUrl
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'D:\Android\Sdk' }
if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }
if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw "找不到 Android SDK: $($env:ANDROID_HOME)" }

# The native directories are intentionally gitignored. Gradle does not re-run Expo
# config plugins, so keep the generated manifest aligned with app.json before every
# LAN build. Without this, launchCameraAsync would ship without CAMERA permission.
$mainManifestPath = Join-Path $androidDir 'app\src\main\AndroidManifest.xml'
if (-not (Test-Path -LiteralPath $mainManifestPath)) { throw "找不到 Android Manifest: $mainManifestPath" }
$mainManifest = Get-Content -LiteralPath $mainManifestPath -Raw -Encoding utf8
$removedCameraPermission = '<uses-permission android:name="android.permission.CAMERA" tools:node="remove"/>'
$cameraPermission = '<uses-permission android:name="android.permission.CAMERA"/>'
if ($mainManifest.Contains($removedCameraPermission)) {
  $mainManifest = $mainManifest.Replace($removedCameraPermission, $cameraPermission)
  Set-Content -LiteralPath $mainManifestPath -Value $mainManifest -Encoding utf8 -NoNewline
}
if (-not ((Get-Content -LiteralPath $mainManifestPath -Raw -Encoding utf8).Contains($cameraPermission))) {
  throw 'Android Manifest 未声明 CAMERA 权限，请先同步 Expo 原生配置。'
}

Push-Location $androidDir
try {
  & .\gradlew.bat :app:assembleLan --rerun-tasks -PreactNativeArchitectures=arm64-v8a `
    "-PnovaVersionCode=$appVersionCode" `
    "-PnovaVersionName=$appVersion"
  if ($LASTEXITCODE -ne 0) { throw 'Android LAN APK 构建失败。' }
} finally {
  Pop-Location
}

$source = Join-Path $androidDir 'app\build\outputs\apk\lan\app-lan.apk'
if (-not (Test-Path -LiteralPath $source)) { throw "没有找到构建产物: $source" }
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$target = Join-Path $artifactDir $apkName
Copy-Item -LiteralPath $source -Destination $target -Force
$hash = Get-FileHash -LiteralPath $target -Algorithm SHA256

$buildToolsRoot = Join-Path $env:ANDROID_SDK_ROOT 'build-tools'
$aaptPath = Get-ChildItem -LiteralPath $buildToolsRoot -Recurse -File -Filter 'aapt.exe' |
  Sort-Object { try { [version]$_.Directory.Name } catch { [version]'0.0.0' } } -Descending |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $aaptPath) { throw 'Android build-tools 中没有找到 aapt.exe，无法验证 APK。' }
$buildToolDir = Split-Path -Parent $aaptPath
$apkSignerPath = Join-Path $buildToolDir 'apksigner.bat'
$zipAlignPath = Join-Path $buildToolDir 'zipalign.exe'

$badging = (& $aaptPath dump badging $target) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) { throw '无法读取 APK 元数据。' }
$permissions = (& $aaptPath dump permissions $target) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0) { throw '无法读取 APK 权限。' }
$expectedPackage = 'com.novachat.mobile.lan'
$expectedVersionName = "$appVersion-lan"
if (-not $badging.Contains("package: name='$expectedPackage'")) { throw "APK 包名不正确，预期 $expectedPackage。" }
if (-not $badging.Contains("versionCode='$appVersionCode'")) { throw "APK versionCode 不正确，预期 $appVersionCode。" }
if (-not $badging.Contains("versionName='$expectedVersionName'")) { throw "APK versionName 不正确，预期 $expectedVersionName。" }
if (-not $badging.Contains("native-code: 'arm64-v8a'")) { throw 'APK 不是仅 ARM64 架构。' }
if (-not $permissions.Contains('android.permission.INTERNET')) { throw 'APK 缺少 INTERNET 权限。' }
if (-not $permissions.Contains('android.permission.CAMERA')) { throw 'APK 缺少 CAMERA 权限。' }
if ($permissions.Contains('android.permission.RECORD_AUDIO')) { throw 'APK 不应包含 RECORD_AUDIO 权限。' }

if (-not (Test-Path -LiteralPath $apkSignerPath)) { throw "找不到 APK 签名验证工具: $apkSignerPath" }
& $apkSignerPath verify $target | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'APK 签名验证失败。' }
if (-not (Test-Path -LiteralPath $zipAlignPath)) { throw "找不到 APK 对齐验证工具: $zipAlignPath" }
& $zipAlignPath -c 4 $target
if ($LASTEXITCODE -ne 0) { throw 'APK zipalign 验证失败。' }

$transportNote = if ($gatewayUri.Scheme -eq 'https') {
  'Gateway transport verified: HTTPS; suitable for remote mobile networks.'
} else {
  'WARNING: This build uses cleartext HTTP and is only for a trusted private Wi-Fi.'
}
@(
  "Nova Chat $appVersion Android ARM64 Test",
  "Package: $expectedPackage",
  "Version name: $expectedVersionName",
  "Version code: $appVersionCode",
  "Gateway URL: $gatewayUrl",
  "APK: $target",
  "Bytes: $((Get-Item -LiteralPath $target).Length)",
  "SHA256: $($hash.Hash)",
  'Permissions verified: INTERNET, CAMERA; no RECORD_AUDIO',
  'Architecture verified: arm64-v8a only',
  'Signature and zip alignment verified',
  $transportNote
) | Set-Content -LiteralPath (Join-Path $artifactDir $infoName) -Encoding utf8

Write-Host "Android APK 已生成: $target"
Write-Host "预置网关地址: $gatewayUrl"
Write-Host "SHA256: $($hash.Hash)"