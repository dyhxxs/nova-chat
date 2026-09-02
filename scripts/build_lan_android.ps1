param(
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

if ([string]::IsNullOrWhiteSpace($GatewayHost)) {
  $GatewayHost = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1 -ExpandProperty IPv4Address |
    Select-Object -ExpandProperty IPAddress
}
if ([string]::IsNullOrWhiteSpace($GatewayHost)) { throw '无法自动找到局域网 IPv4 地址。' }

$gatewayUrl = "http://${GatewayHost}:$Port"
$env:EXPO_PUBLIC_GATEWAY_URL = $gatewayUrl
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'D:\Android\Sdk' }
if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }
if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw "找不到 Android SDK: $($env:ANDROID_HOME)" }

Push-Location $androidDir
try {
  & .\gradlew.bat :app:assembleLan -PreactNativeArchitectures=arm64-v8a `
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
@(
  "Nova Chat $appVersion Android ARM64 LAN Test",
  "Gateway URL: $gatewayUrl",
  "APK: $target",
  "Bytes: $((Get-Item -LiteralPath $target).Length)",
  "SHA256: $($hash.Hash)",
  'WARNING: This build allows cleartext HTTP and is only for a trusted private Wi-Fi.'
) | Set-Content -LiteralPath (Join-Path $artifactDir $infoName) -Encoding utf8

Write-Host "局域网 APK 已生成: $target"
Write-Host "预置网关地址: $gatewayUrl"
Write-Host "SHA256: $($hash.Hash)"
