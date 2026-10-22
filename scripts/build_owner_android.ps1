param(
  [Parameter(Mandatory=$true)][string]$GatewayUrl,
  [switch]$AllowHttpIp
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$mobile = Join-Path $root 'apps\mobile'
$android = Join-Path $mobile 'android'
$names = @('EXPO_PUBLIC_GATEWAY_URL','ALLOW_CLEARTEXT','ANDROID_HOME','ANDROID_SDK_ROOT','NOVA_RELEASE_SESSION_TOKEN')
$original = @{}
foreach ($name in $names) { $original[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  # This is an owner installation/initialization package, NOT a friend chat release.
  # Keep the stricter authenticated friend-release pipeline unchanged.
  [Environment]::SetEnvironmentVariable('NOVA_RELEASE_SESSION_TOKEN', $null, 'Process')
  Push-Location $root
  try {
    & node scripts/check_release_metadata.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Release metadata mismatch.' }
    $ownerArgs = @('scripts/check_owner_gateway.mjs', $GatewayUrl)
    if ($AllowHttpIp) { $ownerArgs += '--allow-http-ip' }
    $gatewayCheck = & node @ownerArgs
    if ($LASTEXITCODE -ne 0) { throw 'Owner gateway preflight failed.' }
    $verifiedGateway = [string](($gatewayCheck -join "`n" | ConvertFrom-Json).gatewayUrl)
    Write-Output ($gatewayCheck -join "`n")
    & npm run verify
    if ($LASTEXITCODE -ne 0) { throw 'Validation failed.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Workspace build failed.' }
  } finally { Pop-Location }
  $config = Get-Content -LiteralPath (Join-Path $mobile 'app.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $version = [string]$config.expo.version
  $versionCode = [int]$config.expo.android.versionCode
  $env:EXPO_PUBLIC_GATEWAY_URL = $verifiedGateway
  $gatewayUri = [Uri]$verifiedGateway
  $usesCleartext = $gatewayUri.Scheme -eq 'http'
  if ($usesCleartext -and -not $AllowHttpIp) { throw 'HTTP 公网 IP 构建必须显式指定 -AllowHttpIp。' }
  $env:ALLOW_CLEARTEXT = if ($usesCleartext) { 'true' } else { 'false' }
  if ($usesCleartext) { Write-Warning '当前构建使用公网 IP + HTTP；Android/iOS 明文网络已显式开启，Session 会以明文传输。' }
  if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'D:\Android\Sdk' }
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  Push-Location $mobile
  try {
    & npx expo install --check
    if ($LASTEXITCODE -ne 0) { throw 'Expo dependency compatibility failed.' }
    & npx expo prebuild --platform android --no-install
    if ($LASTEXITCODE -ne 0) { throw 'Expo Android prebuild failed.' }
    & npx expo export --platform android --clear --output-dir (Join-Path $root ".run\owner-android-preflight-$version")
    if ($LASTEXITCODE -ne 0) { throw 'Fresh Android export failed.' }
  } finally { Pop-Location }
  Push-Location $android
  try {
    & .\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a "-PnovaVersionCode=$versionCode" "-PnovaVersionName=$version" --console=plain --no-daemon --rerun-tasks
    if ($LASTEXITCODE -ne 0) { throw 'Android native APK build failed.' }
  } finally { Pop-Location }
  $source = Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
  $tools = Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
  $aapt = Join-Path $tools.FullName 'aapt.exe'
  $signer = Join-Path $tools.FullName 'apksigner.bat'
  $badging = (& $aapt dump badging $source) -join "`n"
  if ($LASTEXITCODE -ne 0 -or -not $badging.Contains("package: name='com.novachat.mobile'") -or -not $badging.Contains("versionName='$version'") -or -not $badging.Contains("versionCode='$versionCode'") -or -not $badging.Contains("native-code: 'arm64-v8a'")) { throw 'APK identity/version/ABI mismatch.' }
  & $signer verify $source
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  $apkGatewayArgs = @((Join-Path $PSScriptRoot 'check_apk_gateway.mjs'), $source, $verifiedGateway)
  if ($AllowHttpIp) { $apkGatewayArgs += '--allow-http-ip' }
  & node @apkGatewayArgs
  if ($LASTEXITCODE -ne 0) { throw 'APK contains a stale gateway.' }
  & (Join-Path $tools.FullName 'zipalign.exe') -c -P 16 4 $source
  if ($LASTEXITCODE -ne 0) { throw 'APK alignment verification failed.' }
  $finalCheck = & node @ownerArgs
  if ($LASTEXITCODE -ne 0) { throw 'Gateway post-build check failed.' }
  $targetDir = Join-Path $root "artifacts\server-test-$version"
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  $target = Join-Path $targetDir "NovaChat-$version-android-arm64-server-test.apk"
  Copy-Item -LiteralPath $source -Destination $target -Force
  # Exact same signed bytes for the existing local-only download service.
  Copy-Item -LiteralPath $source -Destination (Join-Path $root "artifacts\NovaChat-$version-android-arm64-lan.apk") -Force
  $hash = Get-FileHash -LiteralPath $target -Algorithm SHA256
  "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($target))" | Set-Content -LiteralPath (Join-Path $targetDir 'SHA256SUMS.txt') -Encoding ascii
  $finalCheck -join "`n" | Set-Content -LiteralPath (Join-Path $targetDir 'gateway-check.json') -Encoding utf8
  Write-Output "OWNER TEST APK: $target"
  Write-Output "SHA-256: $($hash.Hash)"
  Write-Warning 'Owner test package only. Admin/provider setup and real authenticated chat may still be pending; inspect gateway-check.json.'
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $original[$name], 'Process') }
}
